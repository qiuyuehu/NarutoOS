import fs from 'fs';
import path from 'path';
import { msg } from '../../shared/i18n';
import type { SavedTab } from '../../shared/model';
import { newTab } from '../../main/config';
import type { GameSessions, GameTab } from '../../main/game';
import type { LoginSessions } from '../../main/login-sessions';
import type { Navigation } from '../../main/navigation';
import type { WebLogin } from '../../main/web-login';
import type { core } from './client';

export type Profile = { id: string; region: 'br' | 'cn'; slot: number; generation: number; name: string; deleting?: boolean };
export type Task = { operationId: string; profileId: string; generation: number; profile: Profile; status: string; tabId?: string; ownerOperationId?: string; recoveryOriginalId?: string };

type Dependencies = {
  games: GameSessions;
  navigation: Navigation;
  login: WebLogin;
  loginPages: ReadonlyMap<string, WebLogin>;
  openInitialLogin: (task: Task, saved: SavedTab, onWaiting: () => void) => Promise<void>;
  sessions: LoginSessions;
  project: string;
  packaged: boolean;
  fixture: boolean;
  fixtureEntry?: string;
  core: typeof core;
  isShuttingDown: () => boolean;
  focusExisting: (tabId: string) => void;
  clearPendingSave: (task: Task) => void;
  hostEvent: (kind: string, detail: Record<string, unknown>) => void;
  report: (message: string, kind?: 'info' | 'error', scope?: string) => void;
  clearNotice: (scope?: string) => void;
  paint: () => void;
  persist: () => void;
  poll: () => Promise<void>;
  shutdown: () => Promise<void>;
};

export function sameAttempt(a: Task, b: Task) {
  return a.profileId === b.profileId && a.generation === b.generation && (a.ownerOperationId ?? a.operationId) === (b.ownerOperationId ?? b.operationId);
}

// Owns task attempts and aliases. GameSessions owns tabs, and LoginSessions
// owns profile leases and storage. Core still supplies tasks via host.poll.
export class TaskQueue {
  readonly tasks = new Map<string, Task>();
  private readonly queue: Task[] = [];
  private readonly recoveryQueue: string[] = [];
  private executing?: Task;
  private executingRecovery = false;
  private recoveryAwait = false;
  private executionIdle?: Promise<void>;
  private everHadTask = false;

  constructor(private readonly deps: Dependencies) { }

  get active() { return this.executing; }
  get idle() { return this.executionIdle; }
  get hasQueuedTasks() { return this.queue.some(task => task.status === 'queued'); }
  isRecoveryQueued(tabId: string) { return this.recoveryQueue.includes(tabId); }

  dropAcknowledged() {
    // Terminal tasks have been acknowledged by Core on this poll.
    for (const [id, task] of this.tasks) {
      if (['closed', 'cancelled'].includes(task.status)) this.tasks.delete(id);
    }
  }

  updateProfiles(profiles?: Profile[]) {
    for (const task of this.tasks.values()) {
      const current = profiles?.find(profile => profile.id === task.profileId && profile.generation === task.generation);
      if (current) task.profile = current;
    }
  }

  registerTasks(incomingTasks: Task[]) {
    const { hostEvent } = this.deps;
    for (const incoming of incomingTasks) {
      if (this.tasks.has(incoming.operationId)) continue;
      const existing = Array.from(this.tasks.values()).find(task =>
        task.profileId === incoming.profileId && task.generation === incoming.generation &&
        !['closed', 'failed', 'cancelled'].includes(task.status));
      const task = {
        ...incoming,
        ownerOperationId: existing?.ownerOperationId ?? existing?.operationId ?? incoming.operationId,
        recoveryOriginalId: existing?.recoveryOriginalId,
        status: existing?.status ?? 'queued',
        ...(existing?.tabId ? { tabId: existing.tabId } : {}),
      };
      hostEvent('task-registered', { operationId: task.operationId, profileId: task.profileId, tabId: task.tabId ?? null, existing: !!existing });
      this.tasks.set(task.operationId, task);
      this.everHadTask = true;
      if (!existing) this.queue.push(task);
      else if (existing.tabId) this.deps.focusExisting(existing.tabId);
    }
  }

  cancelAll() {
    for (const task of this.tasks.values()) {
      if (!['closed', 'cancelled'].includes(task.status)) task.status = 'cancelled';
    }
    this.queue.length = 0;
    this.recoveryQueue.length = 0;
  }

  resumeAfterRecovery(owner = this.executing) {
    if (this.executing === owner && this.executingRecovery && !this.recoveryAwait) {
      this.executing = undefined;
      this.executingRecovery = false;
      void this.executeNext();
    }
  }

  private restoreRecoveryPage(task: Task) {
    const { games, login } = this.deps;
    if (!task.recoveryOriginalId || login?.busy || login?.operation || (this.executingRecovery && this.recoveryAwait)) return;
    if (!games.tabs.some(tab => tab.id === task.tabId) && games.tabs.some(tab => tab.id === task.recoveryOriginalId)) task.tabId = task.recoveryOriginalId;
    task.recoveryOriginalId = undefined;
  }

  updateFromPages() {
    const { games, login } = this.deps;
    const { clearNotice } = this.deps;
    if (this.executing && this.executingRecovery && !this.recoveryAwait && !login?.busy) {
      for (const task of this.tasks.values()) if (sameAttempt(task, this.executing)) this.restoreRecoveryPage(task);
      this.executing = undefined;
      this.executingRecovery = false;
      void Promise.resolve().then(() => this.executeNext());
    }
    const operation = login?.operation;
    if (!operation && !this.recoveryQueue.length && !this.executingRecovery) clearNotice('recovery');
    for (const task of this.tasks.values()) {
      if (['cancelled', 'closed'].includes(task.status)) continue;
      this.restoreRecoveryPage(task);
      if (operation && this.executing && sameAttempt(task, this.executing)) {
        task.tabId = operation.tabId;
        task.status = operation.stage === 'login' ? 'login-required' : operation.stage === 'loading' ? 'loading' : 'ready';
        continue;
      }
      const tab = games.tabs.find(t => t.id === task.tabId);
      if (tab?.state === 'ready') clearNotice(JSON.stringify(['startup', task.profileId, task.generation, task.ownerOperationId ?? task.operationId, tab.id]));
      if (tab) {
        task.tabId = tab.id;
        if (!['cancelled', 'closed'].includes(task.status)) {
          task.status = tab.state === 'ready' ? 'ready' : ['failed', 'crashed'].includes(tab.state) ? 'failed' : 'loading';
        }
      }
    }
  }

  enqueueRecovery(tab: GameTab) {
    const { login } = this.deps;
    const { report, paint } = this.deps;
    if (tab.recoveryStage || login.operation?.originalId === tab.id || this.recoveryQueue.includes(tab.id)) return;
    this.recoveryQueue.push(tab.id);
    report(msg('ui.re_entry_queued'), 'info', 'recovery');
    void this.executeNext();
    paint();
  }

  executeNext(): Promise<void> {
    if (this.executing || this.deps.isShuttingDown()) return Promise.resolve();
    const work = this.runNext();
    this.executionIdle = work;
    void work.finally(() => {
      if (this.executionIdle === work) this.executionIdle = undefined;
    });
    return work;
  }

  private async runNext() {
    const { games, login, navigation } = this.deps;
    const { core, report, paint, persist, hostEvent, fixture, fixtureEntry, openInitialLogin, sessions, project, packaged } = this.deps;
    if (this.executing || this.deps.isShuttingDown()) return;
    if (this.recoveryQueue.length) {
      const id = this.recoveryQueue.shift()!;
      const tab = games.tabs.find(t => t.id === id);
      const task = tab && Array.from(this.tasks.values()).find(t => t.tabId === tab.id && !['closed', 'cancelled'].includes(t.status));
      if (!tab || !task || tab.recoveryStage || ['closed', 'cancelled'].includes(task.status)) {
        void this.executeNext();
        return;
      }
      this.executing = task;
      this.executingRecovery = true;
      this.recoveryAwait = true;
      for (const alias of this.tasks.values()) if (sameAttempt(alias, task)) alias.recoveryOriginalId = tab.id;
      try { await login.recover(tab); } catch { report(msg('ui.recovery_incomplete_the_original_tab_was_kept')); }
      this.recoveryAwait = false;
      if (login.operation?.stage !== 'confirming' && this.executing === task) {
        for (const alias of this.tasks.values()) {
          if (sameAttempt(alias, task)) this.restoreRecoveryPage(alias);
        }
        this.executing = undefined;
        this.executingRecovery = false;
        void this.executeNext();
      }
      paint();
      return;
    }
    if (!this.queue.length) return;
    const task = this.queue.shift()!;
    if (task.status !== 'queued') {
      void this.executeNext();
      return;
    }
    this.executing = task;
    this.executingRecovery = false;
    hostEvent('task-run', { operationId: task.operationId, profileId: task.profileId });
    const isCancelled = () => task.status === 'cancelled';
    try {
      // Revalidate against the core immediately before acquiring the slot.
      const snapshot = await core('snapshot');
      if (isCancelled()) return;
      if (!snapshot.profiles.some((p: Profile) => p.id === task.profileId && p.generation === task.generation && !p.deleting)) throw new Error(msg('ui.profile_changed'));
      // A fresh attempt owns a fresh page; failed pages from previous attempts are retired.
      const stalePages = games.tabs.filter(tab => tab.profileId === task.profileId && ['failed', 'crashed'].includes(tab.state) && tab.id !== login.operation?.originalId && tab.id !== login.operation?.candidateId);
      for (const tab of stalePages) {
        for (const old of this.tasks.values()) if (old.tabId === tab.id && !sameAttempt(old, task)) old.status = 'closed';
        games.close(tab.id, { deferDestroy: true });
      }
      const saved = { ...newTab(task.profile.region), profileId: task.profileId, name: task.profile.name };
      task.tabId = saved.id;
      if (fixture && !(fixtureEntry && task.profile.region === "br")) {
        const lease = sessions.acquireSlot(task.profile.region, task.profile.slot);
        await lease.ready;
        await lease.session.cookies.set({ url: 'https://fixture.invalid', name: 'proto-synthetic', value: task.profile.region, httpOnly: true });
        if (isCancelled()) { lease.release(); return; }
        await lease.session.protocol.interceptBufferProtocol('https', (request, callback) => {
          // Fixture mode is strictly offline, including every cross-origin asset.
          if (request.url.endsWith('/fixture.swf')) {
            const bytes = fs.readFileSync(path.join(project, packaged ? 'assets/checks/quality.swf' : 'tests/fixtures/native-core/quality.swf'));
            callback({ mimeType: 'application/x-shockwave-flash', data: bytes });
          } else callback({ mimeType: 'text/html', data: Buffer.from('<!doctype html><title>隔离账号游戏</title><style>body{background:#26382f;color:white;font:22px system-ui}object{display:block}</style><p>原生核心原型 · 合成游戏持续运行</p><output id="ticks">0</output><script>setInterval(()=>document.getElementById("ticks").textContent=String(Number(document.getElementById("ticks").textContent)+1),250)</script><object id="flash" type="application/x-shockwave-flash" data="https://fixture.invalid/fixture.swf" width="400" height="250"><param name="allowscriptaccess" value="always"></object>') });
        });
        if (isCancelled()) { lease.release(); return; }
        const tab = games.create(saved, 'https://fixture.invalid/game', lease);
        task.tabId = tab.id;
        navigation.selectGame(tab.id);
        await games.waitForReady(tab.id, 20000);
        if (!['closed', 'cancelled'].includes(task.status)) task.status = 'ready';
      } else if (task.profile.region === 'br') {
        task.status = 'login-required';
        await openInitialLogin(task, saved, () => {
          this.executing = undefined;
          void this.executeNext();
        });
        const tab = games.tabs.find(t => t.id === task.tabId);
        task.status = tab ? 'loading' : task.status === 'cancelled' ? 'cancelled' : 'failed';
      } else {
        const tab = games.create(saved, undefined, undefined, task.profile.slot);
        task.tabId = tab.id;
        navigation.selectGame(tab.id);
        // CN login stays independently owned by the tab. The next task starts only once the top-level page is ready.
        await games.waitForReady(tab.id, 30000);
        if (!['closed', 'cancelled'].includes(task.status)) task.status = 'ready';
      }
    } catch (error) {
      if (!['closed', 'cancelled'].includes(task.status)) {
        task.status = 'failed';
        const message = error instanceof Error && error.message === 'game-tab-timeout'
          ? msg('ui.game_page_timed_out_and_is_still')
          : msg('ui.this_account_could_not_start_close_it');
        report(message, 'error', JSON.stringify(['startup', task.profileId, task.generation, task.ownerOperationId ?? task.operationId, task.tabId]));
      }
    } finally {
      for (const alias of this.tasks.values()) {
        if (sameAttempt(alias, task) && !['closed', 'cancelled'].includes(alias.status)) {
          alias.status = task.status;
          alias.tabId = task.tabId;
        }
      }
      if (this.executing === task) this.executing = undefined;
      paint();
      persist();
      void this.executeNext();
    }
  }

  async cancel(task: Task, pageId = task.tabId) {
    const { games, login, loginPages } = this.deps;
    const { report, hostEvent, paint, persist, poll, shutdown } = this.deps;
    const owner = this.executing;
    const tab = games.tabs.find(t => t.id === pageId);
    if (tab && login.canCloseOriginal(tab.id)) {
      report(msg('ui.cancel_recovery_before_closing_the_original_game'));
      return;
    }
    for (let i = this.recoveryQueue.length - 1; i >= 0; i--) {
      if (this.recoveryQueue[i] === pageId) this.recoveryQueue.splice(i, 1);
    }
    for (const t of this.tasks.values()) if (sameAttempt(t, task)) t.status = 'cancelled';
    this.deps.clearPendingSave(task);
    if (pageId) await loginPages.get(pageId)?.cancel();
    if (owner && sameAttempt(owner, task) && login.busy) {
      await login.cancel();
      this.resumeAfterRecovery(owner);
    }
    if (tab && games.tabs.some(t => t.id === tab.id)) {
      hostEvent('task-closed', { operationId: task.operationId, profileId: task.profileId, tabId: tab.id });
      games.close(tab.id, { deferDestroy: true });
      for (const t of this.tasks.values()) if (sameAttempt(t, task)) t.status = 'closed';
    }
    paint();
    persist();
    await poll();
    if (this.everHadTask && !this.executing && !this.hasQueuedTasks && !games.tabs.length && !login.busy && !loginPages.size) {
      void shutdown();
    }
  }

  retry(task: Task) {
    const { games } = this.deps;
    const { fixture, paint } = this.deps;
    if (!['failed', 'cancelled', 'closed'].includes(task.status)) return;
    const previous = games.tabs.find(t => t.id === task.tabId);
    if (previous) {
      if (!['failed', 'crashed'].includes(previous.state)) return;
      if (previous.region === 'br' && !fixture) this.enqueueRecovery(previous);
      else games.refresh(previous.id);
      paint();
      return;
    }
    task.status = 'queued';
    this.queue.push(task);
    void this.executeNext();
    paint();
  }
}
