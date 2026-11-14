import { BrowserView, BrowserWindow, nativeTheme } from 'electron';
import path from 'path';
import { LoadState, SavedTab, TabInfo, CHROME_HEIGHT, REGIONS, validRegion } from '../shared/model';
import { ENTRY_URL, webURL } from './policy';
import { GameLifecycle } from './extensions';
import { isBrazilLoginPage, loginRequestKey, retryAfterSeconds } from '../shared/brazil-login';
import { LoginSessions, LoginProfile } from './login-sessions';

export interface GameTab extends TabInfo { view: BrowserView; generation: number; entry: string; profile?: LoginProfile }
export class GameSessions {
  tabs: GameTab[] = [];
  activeId: string | null = null;
  muted = false;
  hidden = false;
  top = CHROME_HEIGHT;
  readonly lifecycle = new GameLifecycle();
  private inspectNextGame = false;
  private refreshIntents = new Map<number, ReturnType<typeof setTimeout>>();
  private sessionCleanup = new Map<number, () => void>();
  private sessionListeners = new Map<Electron.Session, Map<number, {
    error: (details: Electron.OnErrorOccurredListenerDetails) => void;
    response: (details: Electron.OnResponseStartedListenerDetails) => void;
    matchesNavigation: (url: string) => boolean;
  }>>();
  constructor(private window: BrowserWindow, private changed: () => void, private report: (message: string) => void,
    private entry = ENTRY_URL, private direct = false, private loginSessions?: LoginSessions,
    private diagnostic: (code: string) => void = () => {},
    private prepareGame?: (contents: Electron.WebContents) => Promise<void>) {}
  create(saved: SavedTab, entry?: string, preparedProfile?: LoginProfile, profileSlot?: number) {
    const inspectOnStart = this.inspectNextGame;
    this.inspectNextGame = false;
    const region = validRegion(saved.region) ? saved.region : 'br';
    const initialURL = entry ?? (this.entry === ENTRY_URL ? REGIONS[region].url : this.entry);
    const profile = preparedProfile ?? (profileSlot === undefined ? this.loginSessions?.acquire(region) : this.loginSessions?.acquireSlot(region, profileSlot));
    const view = new BrowserView({ webPreferences: {
      partition: profile?.partition ?? `naruto-${saved.id}`, plugins: true, preload: path.join(__dirname, '../preload/game.js'),
      nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
      contextIsolation: true, worldSafeExecuteJavaScript: true, sandbox: true, enableRemoteModule: false,
      backgroundThrottling: false, webSecurity: true, allowRunningInsecureContent: false,
      nativeWindowOpen: false, spellcheck: false
    } });
    const tab: GameTab = { ...saved, region, entry: initialURL, state: 'loading', title: '火影忍者 Online', view, generation: 0, profile };
    this.tabs.push(tab);
    this.window.addBrowserView(view);
    view.setBounds({ x: -10000, y: this.top, width: 1280, height: 700 });
    view.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1c1c1c' : '#f5f5f5');
    view.webContents.setAudioMuted(true);
    const contents = view.webContents;
    const session = contents.session;
    session.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'fullscreen'));
    session.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen');
    const blockDownload = (event: Electron.Event) => { event.preventDefault(); this.report('暂不支持文件下载'); };
    session.on('will-download', blockDownload);
    const contentsId = view.webContents.id;
    let listeners = this.sessionListeners.get(session);
    if (!listeners) {
      listeners = new Map();
      this.sessionListeners.set(session, listeners);
      const shared = listeners;
      session.webRequest.onErrorOccurred({ urls: ['http://*/*', 'https://*/*'] }, details => {
        const listener = details.webContentsId === undefined ? Array.from(shared.values())[0] : shared.get(details.webContentsId);
        listener?.error(details);
      });
      session.webRequest.onResponseStarted({ urls: ['http://*/*', 'https://*/*'] }, details => {
        if (details.webContentsId === undefined && details.resourceType !== 'mainFrame') {
          for (const listener of shared.values()) listener.response(details);
          return;
        }
        const matches = details.webContentsId === undefined && details.resourceType === 'mainFrame'
          ? Array.from(shared.values()).filter(listener => listener.matchesNavigation(details.url)) : [];
        const listener = details.webContentsId !== undefined ? shared.get(details.webContentsId)
          : matches.length === 1 ? matches[0] : undefined;
        listener?.response(details);
      });
    }
    // Electron 11 keeps partition Sessions alive after their WebContents closes.
    // Release callbacks which otherwise keep this tab and its owner reachable.
    this.sessionCleanup.set(contentsId, () => {
      session.removeListener('will-download', blockDownload);
      listeners!.delete(contentsId);
      if (!listeners!.size) {
        session.webRequest.onResponseStarted(null);
        session.webRequest.onErrorOccurred(null);
        session.setPermissionRequestHandler(null);
        session.setPermissionCheckHandler(null);
        this.sessionListeners.delete(session);
      }
      profile?.release();
    });
    const clearRefresh = () => this.clearRefreshIntent(contentsId);
    view.webContents.on('will-prevent-unload', event => {
      // A website/Flash leave prompt otherwise silently cancels reload in Electron.
      // Only the launcher's explicit refresh may override it, once.
      if (!this.refreshIntents.has(contentsId)) return;
      clearRefresh(); event.preventDefault();
    });
    view.webContents.once('destroyed', () => { clearRefresh(); this.releaseSession(contentsId); });
    const update = (state: LoadState) => {
      if (contents.isDestroyed()) return;
      tab.state = state; this.lifecycle.changed(this.context(tab)); this.changed();
    };
    // Session webRequest events may omit webContentsId in Electron 11. When
    // A and B navigate to the same URL, the committed page owns its status.
    view.webContents.on('did-navigate', (_event, _url, httpResponseCode) => {
      clearRefresh();
      if (httpResponseCode >= 400) update('failed');
    });
    let pendingNavigation = '';
    view.webContents.on('did-start-navigation', (_event, url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) { pendingNavigation = url; tab.generation++; update('loading'); }
    });
    const ready = () => { if (tab.state === 'loading') update('ready'); };
    view.webContents.on('dom-ready', ready);
    view.webContents.on('did-finish-load', ready);
    view.webContents.on('did-stop-loading', ready);
    const service = (url: string) => {
      try { const host = new URL(url).hostname;
        return ['passport.oasgames.com', 'odp3.oasgames.com', 'naruto.narutowebgame.com', 'naruto.oasgames.com'].includes(host) ? host.replace(/\./g, '_') : 'OTHER';
      } catch { return 'UNKNOWN'; }
    };
    const onError = (details: Electron.OnErrorOccurredListenerDetails) => {
      if (/^net::ERR_[A-Z_]+$/.test(details.error)) this.diagnostic('GAME_NETWORK_' + service(details.url) + '_' + details.error.slice(5));
    };
    const onResponse = (details: Electron.OnResponseStartedListenerDetails) => {
      if (details.statusCode >= 400) this.diagnostic('GAME_HTTP_' + details.statusCode + '_' + service(details.url));
      if ((details.webContentsId === contents.id || (details.webContentsId === undefined && pendingNavigation === details.url)) && details.resourceType === 'mainFrame' && details.statusCode >= 400 && !contents.isDestroyed()) {
        // A committed HTTP error page can still emit dom-ready/did-finish-load.
        // Keep it failed so recovery never treats a 403/404 page as a game.
        clearRefresh(); update('failed');
      }
      if (details.statusCode === 403 && details.resourceType === 'mainFrame') {
        try {
          if (new URL(details.url).pathname === '/') {
            this.diagnostic('GAME_ROOT_403_' + service(details.url));
            this.report('游戏入口返回根路径 403；这是恢复阶段信号，不代表已确认故障原因，可尝试“重新获取游戏入口”');
          }
        } catch { /* Do not retain malformed or credential-bearing URLs. */ }
      }
      if (view.webContents.isDestroyed() || !isBrazilLoginPage(view.webContents.getURL()) || ![403, 429, 500, 502, 503, 504].includes(details.statusCode)) return;
      const key = loginRequestKey(details.url); if (!key) return;
      const headers = details.responseHeaders ?? {};
      const retry = Object.keys(headers).find(name => name.toLowerCase() === 'retry-after');
      view.webContents.send('game:login-network-error', { ...key, status: details.statusCode, retryAfter: retryAfterSeconds(retry ? headers[retry]?.[0] : undefined) });
    };
    listeners.set(contentsId, { error: onError, response: onResponse, matchesNavigation: url => pendingNavigation === url });
    view.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => { if (mainFrame && code !== -3) { clearRefresh(); update('failed'); } });
    view.webContents.on('render-process-gone', () => { clearRefresh(); update('crashed'); });
    view.webContents.on('plugin-crashed', () => update('crashed'));
    view.webContents.on('page-title-updated', (event, title) => { event.preventDefault(); tab.title = title.slice(0, 120); this.changed(); });
    const navigate = (event: Electron.Event, url: string) => {
      if (webURL(url)) return;
      event.preventDefault(); this.report('此链接不是网页，无法在启动器内打开');
    };
    view.webContents.on('will-navigate', (event, url) => { clearRefresh(); navigate(event, url); });
    view.webContents.on('will-redirect', (event, url, _inPlace, mainFrame) => {
      if (mainFrame) pendingNavigation = url;
      navigate(event, url);
    });
    view.webContents.on('new-window', (event, url) => {
      clearRefresh(); event.preventDefault();
      if (webURL(url)) void view.webContents.loadURL(url).catch(() => {});
      else if (url !== 'about:blank') this.report('此链接不是网页，无法在启动器内打开');
    });
    view.webContents.on('will-attach-webview', event => event.preventDefault());
    this.lifecycle.opened(this.context(tab));
    const open = () => {
      if (contents.isDestroyed()) return;
      const load = () => {
        if (contents.isDestroyed()) return;
        if (inspectOnStart) contents.openDevTools({ mode: 'detach' });
        void contents.loadURL(initialURL).catch(() => {});
      };
      // Resource and memory experiment bridges are specific to the Brazil game.
      // Use the immutable tab region, independent of the home page selection.
      if (region === 'br' && this.prepareGame) void this.prepareGame(contents).then(load).catch(() => {
        if (!contents.isDestroyed()) { update('failed'); this.report('实验资源桥初始化失败'); }
      });
      else load();
    };
    // Configure this tab's private session before its first network request.
    // Keep each tab explicit; system network settings are never changed.
    const restore = profile?.ready.catch(() => {}) ?? Promise.resolve();
    if (this.direct) void Promise.all([restore, session.setProxy({ proxyRules: 'direct://' })]).then(open).catch(() => {
      update('failed'); this.report('游戏直连测试会话初始化失败');
    });
    else if (profile) void restore.then(open);
    else open();
    return tab;
  }
  private context(tab: GameTab) { return { id: tab.id, state: tab.state, refresh: () => this.refresh(tab.id), setMuted: (muted: boolean) => tab.view.webContents.setAudioMuted(muted) }; }
  waitForReady(id: string, timeoutMs = 60000): Promise<void> {
    const tab = this.tabs.find(item => item.id === id);
    if (!tab) return Promise.reject(new Error('game-tab-missing'));
    if (tab.state === 'ready') return Promise.resolve();
    if (tab.state === 'failed' || tab.state === 'crashed') return Promise.reject(new Error('game-tab-failed'));
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = () => {
        clearTimeout(timer);
        this.lifecycle.removeListener('changed', check);
        this.lifecycle.removeListener('closed', closed);
      };
      const check = (context: { id: string; state: string }) => {
        if (context.id !== id) return;
        if (context.state === 'ready') { cleanup(); resolve(); }
        else if (context.state === 'failed' || context.state === 'crashed') { cleanup(); reject(new Error('game-tab-failed')); }
      };
      const closed = (closedId: string) => {
        if (closedId === id) { cleanup(); reject(new Error('game-tab-closed')); }
      };
      timer = setTimeout(() => { cleanup(); reject(new Error('game-tab-timeout')); }, timeoutMs);
      this.lifecycle.on('changed', check);
      this.lifecycle.on('closed', closed);
      check({ id, state: tab.state });
    });
  }
  get active() { return this.tabs.find(tab => tab.id === this.activeId); }
  toggleDeveloperTools() {
    const contents = this.active?.view.webContents;
    if (!contents || contents.isDestroyed()) {
      this.inspectNextGame = !this.inspectNextGame;
      this.report(this.inspectNextGame ? '下次打开游戏时将自动打开开发者工具' : '已取消下次自动打开开发者工具');
      return;
    }
    if (contents.isDevToolsOpened()) { contents.closeDevTools(); return; }
    contents.openDevTools({ mode: 'detach' });
  }
  fromSender(id: number) { return this.tabs.find(tab => tab.view.webContents.id === id); }
  select(id: string | null) {
    if (id && !this.tabs.some(t => t.id === id)) return;
    this.activeId = id; this.layout(); this.syncAudio(); this.changed();
    if (!this.hidden) this.active?.view.webContents.focus();
  }
  updateSurfaceTheme() {
    for (const tab of this.tabs) if (!tab.view.webContents.isDestroyed()) tab.view.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1c1c1c' : '#f5f5f5');
  }
  syncAudio() { for (const tab of this.tabs) if (!tab.view.webContents.isDestroyed()) tab.view.webContents.setAudioMuted(this.muted || tab.id !== this.activeId); }
  layout() {
    const active = this.active;
    const target = !this.hidden && active && !['crashed', 'failed'].includes(active.state) ? active.view : null;
    const [width, height] = this.window.getContentSize();
    // Keep native views attached: detaching and reattaching a BrowserView on
    // recent macOS can leave Electron 11 with an unpainted native surface.
    for (const tab of this.tabs) {
      const next = { x: tab.view === target ? 0 : -10000, y: this.top, width, height: Math.max(0, height - this.top) };
      const previous = tab.view.getBounds();
      if (Object.keys(next).some(key => next[key as keyof typeof next] !== previous[key as keyof typeof next])) tab.view.setBounds(next);
    }
    if (target && this.window.getBrowserViews().slice(-1)[0] !== target) this.window.setTopBrowserView(target);
  }
  private clearRefreshIntent(id: number) {
    const timer = this.refreshIntents.get(id);
    if (timer) clearTimeout(timer);
    this.refreshIntents.delete(id);
  }
  private releaseSession(id: number) {
    const cleanup = this.sessionCleanup.get(id);
    this.sessionCleanup.delete(id);
    cleanup?.();
  }
  refresh(id = this.activeId) {
    const tab = this.tabs.find(t => t.id === id);
    if (!tab || tab.view.webContents.isDestroyed()) return;
    const contentsId = tab.view.webContents.id;
    this.clearRefreshIntent(contentsId);
    // Expire an intent if navigation never commits (e.g. an unresponsive page).
    this.refreshIntents.set(contentsId, setTimeout(() => this.clearRefreshIntent(contentsId), 30000));
    tab.state = 'loading'; this.layout(); this.changed();
    // Recreate a crashed renderer using its existing per-tab session partition.
    if (!tab.view.webContents.getURL() || tab.view.webContents.isCrashed()) void tab.view.webContents.loadURL(tab.entry).catch(() => {});
    else tab.view.webContents.reload();
  }
  close(id: string, options: { deferDestroy?: boolean } = {}) {
    const index = this.tabs.findIndex(t => t.id === id); if (index < 0) return;
    const [tab] = this.tabs.splice(index, 1);
    this.clearRefreshIntent(tab.view.webContents.id);
    this.releaseSession(tab.view.webContents.id);
    this.window.removeBrowserView(tab.view);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.stop();
    // Electron 11's public typings omit destroy(), although WebContents implements it.
    const contents = tab.view.webContents as Electron.WebContents & { destroy(): void };
    // Destroying a just-detached, active Flash view synchronously can stall Electron 11.
    if (options.deferDestroy) setTimeout(() => { if (!contents.isDestroyed()) contents.destroy(); }, 50);
    else contents.destroy();
    this.lifecycle.closed(id);
    if (this.activeId === id) this.activeId = this.tabs[Math.min(index, this.tabs.length - 1)]?.id ?? null;
    this.layout(); this.syncAudio(); this.changed();
  }
  destroy() { for (const tab of [...this.tabs]) this.close(tab.id); }
}
