import { BrowserWindow, Cookie, CookiesSetDetails, Session } from 'electron';
import { newTab } from './config';
import { allowedDomain } from '../../scripts/webkit-handoff.cjs';
import { RecoveryStage, SavedTab, TabInfo } from '../shared/model';
import { GameSessions, GameTab } from './game';
import { LoginSessions } from './login-sessions';
import { startEmbeddedLogin } from './embedded-login';
import type { LoginNavigation, NavigationOperation } from './navigation';

// Chromium retains the leading dot on domain cookies in its name/domain/path
// key. A host-only cookie and a domain cookie can coexist at the same host.
const identity = (c: { name?: string; domain?: string; path?: string; url?: string }) => {
  if (!c.name) throw new Error('invalid-cookie');
  return JSON.stringify([c.name, c.domain ?? new URL(c.url!).hostname, c.path ?? '/']);
};
export function cookieSeed(cookies: Cookie[], fixture?: string) {
  return cookies.filter(c => fixture ? c.domain?.replace(/^\./, '') === '127.0.0.1' : allowedDomain(c.domain!)).map(c => ({
    name: c.name, value: c.value, domain: c.domain!, path: c.path!, hostOnly: !!c.hostOnly, secure: !!c.secure,
    httpOnly: !!c.httpOnly, session: !!c.session,
    ...(!c.session && c.expirationDate !== undefined ? { expirationDate: c.expirationDate } : {}),
    ...(c.sameSite && c.sameSite !== 'unspecified' ? { sameSite: c.sameSite === 'no_restriction' ? 'none' : c.sameSite } : {})
  }));
}
function details(c: Cookie, fixture?: string): CookiesSetDetails {
  const host = c.domain!.replace(/^\./, '');
  return { url: `${c.secure ? 'https' : 'http'}://${host}${fixture ? ':' + new URL(fixture).port : ''}${c.path}`,
    name: c.name, value: c.value, path: c.path, ...(c.hostOnly ? {} : { domain: c.domain }),
    secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite,
    ...(!c.session ? { expirationDate: c.expirationDate } : {}) };
}

// Only a complete, validated final snapshot reaches this transaction. The slot
// has one owner; its Keychain save queue is paused while changes/rollback run.
export async function reconcileCookies(ses: Session, seed: Cookie[], snapshot: CookiesSetDetails[], fixture?: string) {
  const original = await ses.cookies.get({});
  const next = new Map<string, CookiesSetDetails>();
  for (const c of snapshot) {
    const key = identity(c), previous = next.get(key);
    if (previous) {
      const fields: (keyof CookiesSetDetails)[] = ['value', 'secure', 'httpOnly', 'sameSite', 'expirationDate', 'domain', 'path', 'url'];
      const different = fields.filter(field => previous[field] !== c[field]);
      if (different.length) throw new Error('duplicate-cookie-conflict-' + different.join('-'));
    }
    next.set(key, c);
  }
  snapshot = [...next.values()];
  const removed = seed.filter(c => !next.has(identity(c)));
  const touched = new Set([...snapshot, ...removed].map(identity));
  try {
    for (const c of removed) await ses.cookies.remove(details(c, fixture).url, c.name);
    for (const c of snapshot) {
      try { await ses.cookies.set(c); }
      catch { throw new Error(`cookie-set-${c.secure ? 'secure' : 'plain'}-${c.httpOnly ? 'httpOnly' : 'script'}-${c.sameSite ?? 'unspecified'}-${c.domain ? 'domain' : 'host'}`); }
    }
  } catch (error) {
    // Electron has no cookie transaction API. Restore all touched identities on
    // any failure, including a write which may have succeeded before rejecting.
    const current = await ses.cookies.get({});
    for (const c of current) if (touched.has(identity(c))) await ses.cookies.remove(details(c, fixture).url, c.name);
    for (const c of original) if (touched.has(identity(c))) await ses.cookies.set(details(c, fixture));
    const code = (error as Error).message;
    throw new Error(/^cookie-set-[a-zA-Z_-]{1,80}$/.test(code) ? code : 'cookie-sync-failed');
  }
}

type CancelIntent = 'restore-original' | 'closed-original' | 'exit';
type Attempt = { saved: SavedTab; task: Promise<void>; cancelled: boolean; completed?: boolean; completing?: boolean; stage: RecoveryStage; cancelIntent?: CancelIntent; foregroundAtCancel?: boolean; selectionVersionAtCancel?: number; originalSelected?: boolean; handle?: ReturnType<typeof startEmbeddedLogin>; replacesTabId?: string; replacementTabId?: string };
export class WebLogin {
  private pending?: Attempt;
  private stopping = false;
  private readonly onGameChanged = (context: { id: string; state: string }) => {
    const attempt = this.pending;
    if (attempt?.stage === 'confirming' && attempt.replacementTabId === context.id &&
      (context.state === 'failed' || context.state === 'crashed')) {
      this.failCandidate(attempt, '新游戏页面随后加载失败，原游戏标签仍保留；可重新获取入口');
    }
  };
  private readonly onGameClosed = (id: string) => {
    const attempt = this.pending;
    if (!attempt || attempt.cancelled || attempt.completed || attempt.completing) return;
    if (id === attempt.replacesTabId) {
      void this.cancel('closed-original');
    } else if (id === attempt.replacementTabId) {
      this.failCandidate(attempt, '新游戏标签已关闭，原游戏标签仍保留');
    }
  };
  get tabInfo() {
    const p = this.pending;
    if (!p || p.cancelled || (p.replacementTabId && this.games.tabs.some(tab => tab.id === p.replacementTabId))) return undefined;
    return { ...p.saved, name: p.replacesTabId ? '重新获取游戏入口…' : p.saved.name,
      title: '巴西服', state: 'loading' as const, ...(p.replacesTabId ? { recoveryStage: p.stage } : {}) } as TabInfo;
  }
  get operation() {
    const p = this.pending;
    if (!p || p.cancelled || p.completed || p.completing) return undefined;
    return { tabId: p.replacementTabId ?? p.saved.id, stage: p.stage, recovering: !!p.replacesTabId,
      ...(p.saved.profileId ? { profileId: p.saved.profileId } : {}),
      ...(p.replacesTabId ? { originalId: p.replacesTabId } : {}),
      ...(p.replacementTabId ? { candidateId: p.replacementTabId } : {}) };
  }
  get busy() { return !!this.pending; }
  constructor(private window: BrowserWindow, private games: GameSessions, private profiles: LoginSessions,
    private readonly navigation: LoginNavigation, private binary: string, private report: (message: string) => void,
    private test?: { fixture: string; visible?: boolean; timeout?: number }, private changed: () => void = () => {},
    private diagnostic: (code: string) => void = () => {},
    private readonly onForegroundHandoff: () => void = () => {},
    private readonly credentials?: {
      list(requestId: string, origin: string, query: string): Promise<Array<{ id: string; username: string }>>;
      select(requestId: string, origin: string, id: string): Promise<{ username: string; password: string }>;
    }, private readonly independent = false) {
    this.games.lifecycle.on('changed', this.onGameChanged);
    this.games.lifecycle.on('closed', this.onGameClosed);
  }

  open(saved: SavedTab, profileSlot?: number): Promise<void> {
    return this.start(saved, undefined, undefined, profileSlot);
  }

  recover(tab: GameTab): Promise<void> {
    if (tab.region !== 'br' || tab.view.webContents.isDestroyed()) return Promise.resolve();
    if (this.pending) {
      if (!this.pending.cancelled && this.pending.replacesTabId === tab.id) return this.pending.task;
      throw new Error(this.pending.cancelled ? '上一项登录或恢复流程正在结束，请稍后重试' : '另一个账号正在登录或恢复，请先完成或取消当前流程');
    }
    if (!tab.profile) {
      this.report('无法沿用当前游戏会话；原游戏标签仍保留');
      return Promise.resolve();
    }
    let retained: ReturnType<LoginSessions['retain']>;
    try { retained = this.profiles.retain(tab.profile.partition); }
    catch { this.report('无法保留当前账号会话；原游戏标签仍保留'); return Promise.resolve(); }
    const saved = { id: newTab('br').id, name: tab.name, region: 'br' as const, ...(tab.profileId ? { profileId: tab.profileId } : {}) };
    this.navigation.selectLogin(saved.id);
    return this.start(saved, { replacesTabId: tab.id }, retained);
  }

  focus() {
    if (process.env.NARUTO_TEST_HIDDEN === '1' || this.test?.visible === false) return;
    this.pending?.handle?.focus();
  }

  private start(saved: SavedTab, replacement?: { replacesTabId: string }, retainedProfile?: ReturnType<LoginSessions['retain']>, profileSlot?: number): Promise<void> {
    if (this.stopping || this.window.isDestroyed()) { retainedProfile?.release(); return Promise.resolve(); }
    if (this.pending) {
      retainedProfile?.release();
      if (this.pending.cancelled) throw new Error('上一项登录或恢复流程正在结束，请稍后重试');
      if (this.pending.saved.id !== saved.id || this.pending.replacesTabId !== replacement?.replacesTabId) {
        throw new Error('另一个账号正在登录或恢复，请先完成或取消当前流程');
      }
      if (this.taskIsForeground(this.pending)) this.pending.handle?.focus();
      return this.pending.task;
    }
    const region = saved.region === 'cn' ? 'cn' : 'br';
    const profile = retainedProfile ?? (profileSlot === undefined ? this.profiles.acquire(region) : this.profiles.acquireSlot(region, profileSlot));
    const attempt: Attempt = { saved, task: Promise.resolve(), cancelled: false, stage: 'login', ...replacement };
    this.pending = attempt;
    this.changed();
    attempt.task = (async () => {
      let transferred = false;
      try {
        await profile.ready;
        if (attempt.cancelled) return;
        const all = await profile.session.cookies.get({});
        let seed = all.filter(c => this.test ? c.domain?.replace(/^\./, '') === '127.0.0.1' : allowedDomain(c.domain!));
        if (attempt.cancelled) return;
        const credentialOrigin = (origin: string) => {
          if (this.test) { try { if (new URL(this.test.fixture).origin === origin) return 'https://naruto.narutowebgame.com'; } catch { /* Invalid fixtures never authorize credential access. */ } }
          return origin;
        };
        const handle = startEmbeddedLogin(this.binary, this.window, { ...this.test, independent: this.independent, initialCookies: cookieSeed(seed, this.test?.fixture),
          onSnapshot: snapshot => profile.updateCookies(async ses => {
            await reconcileCookies(ses, seed, snapshot, this.test?.fixture);
            if (this.independent) seed = (await ses.cookies.get({})).filter(c => this.test ? c.domain?.replace(/^\./, '') === '127.0.0.1' : allowedDomain(c.domain!));
          }),
          onCredentialQuery: this.credentials ? (requestId, origin, query) => this.credentials!.list(requestId, credentialOrigin(origin), query) : undefined,
          onCredentialSelect: this.credentials ? (requestId, origin, id) => this.credentials!.select(requestId, credentialOrigin(origin), id) : undefined,
          onStatus: code => {
            this.diagnostic('WEB_LOGIN_' + code);
            if (code.startsWith('HTTP_')) this.report(attempt.replacesTabId
              ? `官网登录/选服页返回 ${code.slice(5)}；请按页面提示重新登录或选择区服，取消后原游戏标签仍保留`
              : `官网返回 ${code.slice(5)}，可检查网络后手动刷新`);
          } });
        attempt.handle = handle;
        handle.hide(!this.taskIsForeground(attempt));
        const handoff = await handle.result;
        attempt.handle = undefined;
        if (attempt.cancelled || this.stopping || this.window.isDestroyed()) return;
        if (attempt.replacesTabId) {
          attempt.stage = 'loading';
          attempt.replacementTabId = saved.id;
          this.changed();
        }
        const tab = this.games.create(saved, handoff.url, profile);
        transferred = true;
        if (attempt.replacesTabId) tab.recoveryStage = 'loading';
        if (this.navigation.handoffGame(saved.id, tab.id)) this.onForegroundHandoff();
        if (attempt.replacesTabId) {
          try {
            await this.games.waitForReady(tab.id);
            if (attempt.cancelled || this.stopping || tab.state !== 'ready' || tab.view.webContents.isDestroyed()) throw new Error('cancelled');
            attempt.stage = 'confirming'; tab.recoveryStage = 'confirming';
            this.changed();
          } catch {
            if (!attempt.cancelled) throw new Error('replacement-game-not-ready');
          }
        }
      } catch (error) {
        const code = (error as Error).message;
        const wasCancelled = attempt.cancelled;
        this.diagnostic('WEB_LOGIN_' + (/^[a-zA-Z0-9_-]{1,60}$/.test(code) ? code : 'FAILED'));
        if (attempt.replacesTabId && !wasCancelled) {
          attempt.foregroundAtCancel = this.taskIsForeground(attempt);
          attempt.selectionVersionAtCancel = this.navigation.selectionVersion;
          attempt.cancelIntent = 'restore-original';
          attempt.cancelled = true;
          const candidate = attempt.replacementTabId && this.games.tabs.find(tab => tab.id === attempt.replacementTabId);
          if (candidate) this.closeCandidate(attempt);
          attempt.replacementTabId = undefined;
        }
        this.returnToOriginal(attempt);
        if (!wasCancelled && (error as Error).message !== 'cancelled') this.report(attempt.replacesTabId
          ? code === 'replacement-game-not-ready' ? '新游戏页面未成功启动，原游戏标签仍保留；可检查网络后重试'
            : '重新获取游戏入口未完成；原游戏标签仍保留，可再次尝试或取消'
          : '巴西服登录未完成，请重新打开登录窗口');
      } finally {
        if (!transferred) profile.release();
        if (this.pending === attempt && (attempt.cancelled || !attempt.replacesTabId || attempt.stage !== 'confirming')) this.pending = undefined;
        this.changed();
      }
    })();
    return attempt.task;
  }

  async close() {
    this.stopping = true;
    await this.cancel('exit');
    this.games.lifecycle.removeListener('changed', this.onGameChanged);
    this.games.lifecycle.removeListener('closed', this.onGameClosed);
  }
  get loginViewVisible() { return this.pending?.handle?.visible() ?? false; }
  hide(hidden: boolean) { if (this.pending?.stage === 'login') this.pending.handle?.hide(hidden || !!this.pending.cancelled); }
  refresh() { if (this.operation?.stage === 'login') this.pending?.handle?.reload(); }
  completeRecovery(candidateId: string): boolean {
    const attempt = this.pending;
    if (!attempt || attempt.cancelled || attempt.completed || attempt.completing || attempt.stage !== 'confirming' ||
      attempt.replacementTabId !== candidateId || !attempt.replacesTabId) return false;
    const candidate = this.games.tabs.find(tab => tab.id === candidateId);
    if (!candidate || candidate.state !== 'ready' || candidate.view.webContents.isDestroyed() ||
      !this.games.tabs.some(tab => tab.id === attempt.replacesTabId)) return false;
    attempt.completing = true; attempt.completed = true;
    candidate.recoveryStage = undefined;
    this.pending = undefined;
    this.navigation.completeRecovery(attempt.replacesTabId, candidateId);
    this.games.close(attempt.replacesTabId, { deferDestroy: true });
    this.changed();
    return true;
  }
  async cancelRecovery(candidateId: string) {
    const attempt = this.pending;
    if (!attempt || attempt.stage !== 'confirming' || attempt.replacementTabId !== candidateId || attempt.cancelled || attempt.completed) return;
    await this.cancel('restore-original');
  }
  canCloseOriginal(id: string) {
    const attempt = this.pending;
    return !!attempt && !attempt.cancelled && !attempt.completed && attempt.replacesTabId === id && attempt.stage !== 'confirming';
  }
  private returnToOriginal(attempt: Attempt) {
    const id = attempt.replacesTabId;
    if (!id || attempt.originalSelected || this.stopping || this.window.isDestroyed() ||
      attempt.cancelIntent !== 'restore-original') return;
    attempt.originalSelected = this.navigation.restoreOriginal(id, attempt.selectionVersionAtCancel ?? 0, !!attempt.foregroundAtCancel);
  }
  async cancel(intent: CancelIntent = 'restore-original') {
    const attempt = this.pending;
    if (!attempt || attempt.completed) return;
    if (!attempt.cancelled) {
      attempt.foregroundAtCancel = this.taskIsForeground(attempt);
      attempt.selectionVersionAtCancel = this.navigation.selectionVersion;
      attempt.cancelIntent = intent;
      attempt.cancelled = true;
      if (attempt.stage === 'login') { attempt.handle?.hide(true); attempt.handle?.cancel(); }
      this.changed();
      if (attempt.replacesTabId && attempt.replacementTabId) this.closeCandidate(attempt);
    }
    await attempt.task;
    if (this.pending === attempt) this.pending = undefined;
    this.returnToOriginal(attempt);
    this.changed();
  }
  private failCandidate(attempt: Attempt, message: string) {
    if (this.pending !== attempt || attempt.cancelled || attempt.completed || attempt.completing || !attempt.replacesTabId) return;
    attempt.foregroundAtCancel = this.taskIsForeground(attempt);
    attempt.selectionVersionAtCancel = this.navigation.selectionVersion;
    attempt.cancelIntent = 'restore-original';
    attempt.cancelled = true;
    this.closeCandidate(attempt);
    this.pending = undefined;
    this.returnToOriginal(attempt);
    if (!this.stopping) this.report(message);
    this.changed();
  }
  private closeCandidate(attempt: Attempt) {
    const id = attempt.replacementTabId;
    if (!id || !this.games.tabs.some(tab => tab.id === id)) return;
    if (!this.stopping) this.navigation.prepareCandidateClose(id, attempt.replacesTabId);
    this.games.close(id, { deferDestroy: true });
  }
  private taskIsForeground(attempt: Attempt) {
    const operation: NavigationOperation = {
      tabId: attempt.replacementTabId ?? attempt.saved.id,
      stage: attempt.stage,
      recovering: !!attempt.replacesTabId,
      ...(attempt.replacesTabId ? { originalId: attempt.replacesTabId } : {}),
      ...(attempt.replacementTabId ? { candidateId: attempt.replacementTabId } : {})
    };
    return this.navigation.isLoginForeground(attempt.saved.id, operation);
  }
}
