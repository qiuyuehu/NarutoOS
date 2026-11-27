import { msg } from '../../shared/i18n';
import type { SavedTab } from '../../shared/model';
import type { GameSessions } from '../../main/game';
import type { LoginSessions } from '../../main/login-sessions';
import type { Navigation } from '../../main/navigation';
import { credentialOrigin } from '../../main/policy';
import { WebLogin } from '../../main/web-login';
import type { core } from './client';
import type { Task } from './task-queue';

type Dependencies = {
  window: Electron.BrowserWindow;
  games: GameSessions;
  sessions: LoginSessions;
  navigation: Navigation;
  binary: string;
  fixtureEntry?: string;
  changed: () => void;
  report: (message: string) => void;
  activeTask: () => Task | undefined;
  poll: () => Promise<void>;
  core: typeof core;
};

type CredentialOffer = {
  origin: string;
  ids: string[];
  expires: number;
  operationId: string;
  offerId: string;
};

// Independent initial logins can coexist. A recovery keeps its original tab
// until WebLogin can hand off to a ready candidate with the same profile lease.
export class HostLogin {
  readonly recovery: WebLogin;
  private readonly initialPages = new Map<string, WebLogin>();

  constructor(private readonly deps: Dependencies) {
    this.recovery = this.createPage();
  }

  get pages(): ReadonlyMap<string, WebLogin> { return this.initialPages; }

  async open(task: Task, saved: SavedTab, onWaitingForLogin: () => void) {
    this.deps.navigation.selectLogin(saved.id);
    const page = this.createPage(task);
    this.initialPages.set(saved.id, page);
    const opened = page.open(saved, task.profile.slot);
    // The login page now owns this attempt. The queue can start another account
    // while this document is still waiting for the user or WebKit handoff.
    onWaitingForLogin();
    try {
      await opened;
    } finally {
      await page.close();
      this.initialPages.delete(saved.id);
    }
  }

  async close() {
    await Promise.all([this.recovery.close(), ...Array.from(this.initialPages.values(), page => page.close())]);
  }

  private createPage(owner?: Task) {
    const { window, games, sessions, navigation, binary, report, fixtureEntry, changed, activeTask, poll, core } = this.deps;
    const fixture = fixtureEntry ? { fixture: fixtureEntry + (owner?.profileId ?? '') } : undefined;
    const offers = new Map<string, CredentialOffer>();
    return new WebLogin(window, games, sessions, navigation, binary, report, fixture, changed, () => {}, () => window.focus(), {
      list: async (id, origin, query) => {
        const task = owner ?? activeTask();
        if (!task || credentialOrigin(origin) !== origin) return [];
        await poll();
        const result = await core('credentials.list', { operationId: task.operationId, origin });
        const records = result.records.filter((record: { username: string }) => record.username.toLowerCase().includes(query.toLowerCase()));
        offers.set(id, {
          origin, ids: records.map((record: { id: string }) => record.id),
          expires: Date.now() + 30000, operationId: task.operationId, offerId: result.offerId,
        });
        return records;
      },
      select: async (id, origin, recordId) => {
        const offer = offers.get(id);
        offers.delete(id);
        if (!offer || offer.expires < Date.now() || offer.origin !== origin || !offer.ids.includes(recordId)
          || (owner ?? activeTask())?.operationId !== offer.operationId) {
          throw new Error(msg('ui.selection_expired'));
        }
        return core('credentials.select', { operationId: offer.operationId, origin, id: recordId, offerId: offer.offerId });
      },
    }, !!owner);
  }
}
