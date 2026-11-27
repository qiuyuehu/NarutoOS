import { msg, resolveText, messageCode, setLanguage } from '../../shared/i18n';
import { app, BrowserWindow, ipcMain, Menu, dialog, screen, session } from 'electron';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn, execFileSync } from 'child_process';
import { GameSessions } from '../../main/game';
import { LoginSessions } from '../../main/login-sessions';
import { keychainTransport } from '../../main/credentials';
import { Navigation } from '../../main/navigation';
import { HostLogin } from './host-login';
import { findFlash } from '../../main/flash';
import { loadGameResources } from './game-resources';
import { ResourceProbe } from '../../main/resource-probe';
import { speedSignal } from '../../main/game-speed';
import { validCnEntry } from '../../shared/model';
import { credentialOrigin, savePromptDestination } from '../../main/policy';
import { core, root, project } from './client';
import { createShutdown } from './shutdown';
import { createSpeedCoordinator, SPEED_RETRY_MS } from './speed-coordinator';
import { TaskQueue, sameAttempt, type Task } from './task-queue';
import { buildToolbarState, toolbarRefreshState, toolbarTabs } from './toolbar-state';
import { redactURL } from './safe-url';
import { attachTrafficLights } from '../../main/traffic-lights';
import { startHostFixture } from './host-fixture';
function hostEvent(kind: string, detail: Record<string, unknown> = {}) {
  try {
    const file = path.join(root, 'host', 'events.log');
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (fs.existsSync(file) && fs.statSync(file).size > 512 * 1024) fs.writeFileSync(file, '');
    fs.appendFileSync(file, JSON.stringify({ time: new Date().toISOString(), kind, pid: process.pid, ...detail }) + '\n', { mode: 0o600 });
  } catch {}
}
app.on('child-process-gone', (_event, details: any) => hostEvent('child-process-gone', { type: details.type, reason: details.reason, exitCode: details.exitCode, name: details.name, serviceName: details.serviceName }));
app.on('render-process-gone', (_event, contents: any, details: any) => hostEvent('render-process-gone', { reason: details.reason, exitCode: details.exitCode, url: redactURL(contents?.getURL?.()) }));

// SIGUSR2 can arrive before the host has registered with Core.
let updateHandoffPending = false;
let requestUpdateHandoff: (() => void) | undefined;
process.on('SIGUSR2', () => {
  if (requestUpdateHandoff) requestUpdateHandoff();
  else updateHandoffPending = true;
});

let allowedRoot=root?.startsWith(project + '/.test-artifacts/native-core-');
if(process.env.NARUTO_C_DEV_REAL==='1'&&process.env.NARUTO_C_FIXTURE!=='1')try{allowedRoot=JSON.parse(fs.readFileSync(path.join(app.getPath('appData'),'Naruto OS C/data-location.json'),'utf8')).root===root&&fs.existsSync(path.join(root,'management.json'));}catch{allowedRoot=false;}
if(app.isPackaged&&process.env.NARUTO_C_PACKAGED==='1') {
  if(process.env.NARUTO_C_FIXTURE==='1')try{allowedRoot=path.basename(root).startsWith('native-core-package-check-')&&path.basename(path.dirname(root))==='.test-artifacts'&&JSON.parse(fs.readFileSync(path.join(root,'package-fixture.json'),'utf8')).fixture===true;}catch{allowedRoot=false;}
  else try{allowedRoot=JSON.parse(fs.readFileSync(path.join(app.getPath('appData'),'Naruto OS C/data-location.json'),'utf8')).root===root;}catch{allowedRoot=false;}
}
if(!allowedRoot||fs.realpathSync(root)!==root)throw new Error(msg('ui.invalid_startup_data_directory'));
app.setName(resolveText(msg('ui.naruto_os_game')));
app.setPath('userData', path.join(root, 'host'));
if(app.isPackaged)app.dock?.setIcon(path.join(project,'assets/game-icon.png'));
if (!app.requestSingleInstanceLock()) { app.quit(); } else {
  const flash = findFlash(project, process.env.NARUTO_C_FLASH === '31' ? '31' : '34');
  if (!flash.available) throw new Error(msg('ui.flash_component_not_ready'));
  app.commandLine.appendSwitch('ppapi-flash-path', flash.path); app.commandLine.appendSwitch('ppapi-flash-version', flash.version);
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  void app.whenReady().then(start).catch(() => app.exit(1));
}
async function start() {
  app.setAboutPanelOptions({ applicationName: resolveText(msg('ui.naruto_os_game')), applicationVersion: app.getVersion(),
    copyright: 'Qiuyue · Codex', credits: 'github.com/qiuyuehu/NarutoOS' });
  const instance = crypto.randomBytes(16).toString('hex');
  const runtimePath = path.join(root, 'host-receipts.json');
  let prefs: any = (await core('snapshot')).preferences;
  setLanguage(prefs.language);
  app.setName(resolveText(msg('ui.naruto_os_game')));
  const startupPrefs = { ...prefs };
  ipcMain.handle('game:language', event => games?.fromSender(event.sender.id) ? prefs.language : 'zh-CN');
  let savedWindow: any;
  try { savedWindow = JSON.parse(fs.readFileSync(runtimePath, 'utf8')).window; } catch {}
  const raw = savedWindow?.bounds;
  const validBounds = raw && ['x','y','width','height'].every(key => Number.isFinite(raw[key]));
  const area = (validBounds ? screen.getDisplayMatching(raw) : screen.getPrimaryDisplay()).workArea;
  const width = Math.min(area.width, Math.max(800, validBounds ? raw.width : 1100));
  const height = Math.min(area.height, Math.max(560, validBounds ? raw.height : 760));
  const bounds = { width, height, ...(validBounds ? { x: Math.max(area.x, Math.min(raw.x, area.x+area.width-width)), y: Math.max(area.y, Math.min(raw.y, area.y+area.height-height)) } : {}) };

  const sourceRevision = (() => { try { return execFileSync('git', ['-C', project, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return ''; } })();
  const buildLabel = app.isPackaged ? msg('ui.installed_version') : msg('ui.development_version', { p0: sourceRevision ? ` · ${sourceRevision}` : '' });
  hostEvent('host-start', { buildLabel });
  let win = new BrowserWindow({ ...bounds, title: resolveText(`Naruto OS · ${buildLabel}`), minWidth: 800, minHeight: 560, titleBarStyle: 'hidden', trafficLightPosition: { x: 14, y: 15 }, webPreferences: {
    preload: path.join(__dirname, 'host-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true
  } });
  win.webContents.on('render-process-gone', (_event, details) => {
    hostEvent('window-renderer-gone', { reason: details.reason });
    // A dead window renderer leaves the whole window blank; reload the shell.
    setTimeout(() => { if (!win.isDestroyed()) win.reload(); }, 250);
  });
  win.webContents.on('unresponsive', () => hostEvent('window-unresponsive'));
  win.webContents.on('responsive', () => hostEvent('window-responsive'));
  win.on('closed', () => hostEvent('window-closed'));
  attachTrafficLights(win);
  const fixture = process.env.NARUTO_C_FIXTURE === '1';
  const deletionResults: any[] = [];
  const clearing = new Set<string>();
  let pendingSave: any;
  let savingPassword: any;
  let interval: ReturnType<typeof setInterval> | undefined;
  let busyPoll = false, failures = 0, notice = '', pollPhase = 'prepare';
  // Partition discovery touches the Keychain helper, which may wait up to a minute
  // for authorisation. It is refreshed here and never awaited by poll().
  let knownSlots: string[] = [];
  let refreshingSlots = false;
  async function refreshSlots() {
    if (refreshingSlots) return;
    refreshingSlots = true;
    try { knownSlots = await sessions.listStoredPartitions(); } catch { /* keep the last known list */ }
    finally { refreshingSlots = false; }
  }
  void refreshSlots();
  // A config fetched before this localization pack was installed stays in the
  // game's disk cache, where the Fetch override cannot see it. Clear each game
  // partition's HTTP cache once per app build so those configs are fetched again
  // through the localization bridge.
  async function clearLocalizationCacheOnce() {
    if (!localizationEnabled) return;
    try {
      let build = app.getVersion();
      try { build = app.getVersion() + '-' + String(JSON.parse(fs.readFileSync(path.join(project, 'build-info.json'), 'utf8')).buildID || ''); } catch {}
      const key = build.replace(/[^a-zA-Z0-9_.-]/g, '_');
      const marker = path.join(root, 'host', 'localization', 'cache-cleared-' + key);
      if (fs.existsSync(marker)) return;
      const dir = path.join(root, 'host', 'Partitions');
      const names = fs.existsSync(dir)
        ? fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory() && /^naruto-(br|cn)-[1-9]\d*$/.test(entry.name)).map(entry => entry.name)
        : [];
      for (const name of names) await session.fromPartition('persist:' + name).clearCache();
      fs.mkdirSync(path.dirname(marker), { recursive: true, mode: 0o700 });
      fs.writeFileSync(marker, JSON.stringify({ key, partitions: names.length, at: new Date().toISOString() }), { mode: 0o600 });
      hostEvent('localization-cache-cleared', { partitions: names.length });
    } catch (error) { hostEvent('localization-cache-clear-failed', { error: String(error) }); }
  }
  const slotTimer = setInterval(() => { void refreshSlots(); }, 30000);
  slotTimer.unref?.();
  let games: GameSessions; let navigation: Navigation;
  const service = `cn.youye.naruto-os.test.sessions.native-core.${path.basename(root)}`;
  const sessionTransport=keychainTransport(path.join(project, 'dist/native/keychain'), service);
  const sessions = new LoginSessions((action,value) => fixture && action==='write' && fs.existsSync(path.join(root,'fixture-fail-session-write')) ? Promise.reject(new Error(msg('ui.synthetic_save_failure'))) : sessionTransport(action,value), () => report(msg('ui.session_save_failed_keep_the_window_open')));
  const assistsEnabled = startupPrefs.assistsEnabled === true;
  const localizationEnabled = startupPrefs.localization === true;
  // 游戏变速：核心在宿主生成时注入了时间挂钩（NARUTO_C_SPEED=1 为注入凭据）。
  // 会话从 1 倍起步。所有打开的游戏页都须确认本次加载已替换对应补丁。
  const speedEnabled = startupPrefs.gameSpeed === true && process.env.NARUTO_C_SPEED === '1';
  // 多档定向信号：每个档位一个信号（内核投递、沙箱免疫），幂等不落盘。
  function wakeAllPpapi(pids: number[], rate: number): number {
    const signo = speedSignal(rate);
    if (!signo) return 0;
    let delivered = 0;
    for (const pid of pids) { try { process.kill(pid, signo); delivered++; } catch {} }
    return delivered;
  }
  function pushSpeed(rate: number): number {
    const pids = findPpapiPIDs();
    if (!pids.length) return 0;
    return wakeAllPpapi(pids, rate);
  }
  function findPpapiPIDs(): number[] {
    try {
      const out = execFileSync('ps', ['-axo', 'pid=,ppid=,etime=,command='], { encoding: 'utf8' });
      const pids: number[] = [];
      for (const line of out.split('\n')) {
        const columns = line.trim().split(/\s+/);
        // Leave newly spawned plugins time to install their signal handlers.
        if (columns[1] === String(process.pid) && columns[2] !== '00:00' && line.includes('--type=ppapi')) pids.push(Number(columns[0]));
      }
      return pids;
    } catch {}
    return [];
  }
  const speed = createSpeedCoordinator({
    enabled: speedEnabled,
    rememberedRate: startupPrefs.gameSpeedRate,
    getTabs: () => games?.tabs,
    trackedStatus: contents => gameBridge?.trackedOverrideStatus(contents),
    isShuttingDown: () => hostShutdown.stopping,
    now: Date.now,
    pushSpeed,
    saveRate: rate => core('host.speedRate', { rate }),
    report,
    hostEvent,
    paint,
  });
  function openSpeedMenu() {
    // 原生菜单置于 BrowserView 上方，游戏画面不会遮挡它。
    const { rate: currentRate, allowRaise } = speed.menuState();
    Menu.buildFromTemplate(Array.from({ length: 10 }, (_, index) => {
      const rate = index + 1;
      return { label: `${rate}×`, type: 'radio' as const, checked: currentRate === rate,
        enabled: rate === 1 || allowRaise, click: () => { void speed.setSpeed(rate); } };
    })).popup({ window: win });
  }
  const resources = loadGameResources(project, {
    localization: localizationEnabled, assists: assistsEnabled, speed: speedEnabled,
  }, speed.applySpeed);
  if (speedEnabled && !resources.speedOverrides.size) hostEvent('speed-patches-unavailable');
  for (const item of resources.status?.extraResources ?? []) {
    if (item.state !== 'accepted') hostEvent('local-resource-rejected', item);
  }
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let noticeKind: 'info' | 'error' = 'info', noticeScope = '';
  function clearNotice(scope?: string) {
    if(scope && noticeScope!==scope)return;
    if(noticeTimer)clearTimeout(noticeTimer);
    noticeTimer=undefined;notice='';noticeScope='';noticeKind='info';
  }
  function logPollFailure(phase: string, message: string, error: unknown) {
    try {
      const line = JSON.stringify({ time: new Date().toISOString(), phase, failures, message,
        stack: error instanceof Error ? (error.stack || '').split('\n').slice(0, 3).join(' | ') : '' });
      const file = path.join(root, 'host', 'poll-errors.log');
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      if (fs.existsSync(file) && fs.statSync(file).size > 256 * 1024) fs.writeFileSync(file, '');
      fs.appendFileSync(file, line + '\n', { mode: 0o600 });
    } catch { /* Diagnostics must never break polling. */ }
  }
  function report(message: string, kind: 'info' | 'error' = 'error', scope = '') {
    clearNotice();notice=message;noticeKind=kind;noticeScope=scope;
    noticeTimer=setTimeout(()=>{clearNotice();paint();},5000);
    paint();
  }
  async function openCenter(settings = false) {
    try { await core('center.ensure', settings ? { page: 'settings' } : {}); }
    catch { report(msg('ui.could_not_open_the_launch_center_try')); }
  }
  let lastReceipt: string | undefined;
  function persist() {
    const receipt = JSON.stringify({ instance, pid: process.pid, window: { bounds: win.getNormalBounds(), maximized: win.isMaximized(), fullscreen: win.isFullScreen() }, tasks: Array.from(tasks.values()).map(t => ({ operationId: t.operationId, profileId: t.profileId, status: t.status })) });
    if (receipt === lastReceipt) return;
    const file = runtimePath + '.tmp';
    fs.writeFileSync(file, receipt, { mode: 0o600 });
    fs.renameSync(file, runtimePath);
    lastReceipt = receipt;
  }
  function runtimeChanged() {
    if (!games || win.isDestroyed()) return;
    taskQueue.updateFromPages();
    speed.applySpeed();
    paint();
  }
  function foregroundLogin() {
    return [...loginPages.values(),login].find(page => {
      const op=page?.operation; return op && navigation.isLoginForeground(op.tabId,op);
    });
  }
  function refreshState() {
    const operation=foregroundLogin()?.operation ?? login?.operation;
    return toolbarRefreshState({
      stopping: hostShutdown.stopping, active: games.active, operation, navigation, fixture,
      isRecoveryQueued: id => taskQueue.isRecoveryQueued(id),
    });
  }
  function visibleTabs() {
    return toolbarTabs({
      tasks: tasks.values(), tabs: games.tabs, activeId: games.activeId, navigation,
      operationForTab: tabId => loginPages.get(tabId ?? "")?.operation ?? login?.operation,
    });
  }
  let lastToolbarState: string | undefined;
  function paint() {
    if (!games || win.isDestroyed()) return;
    const foreground = foregroundLogin();
    const operation = foreground?.operation ?? login?.operation;
    const loginVisible = !!operation && operation.stage === 'login' && navigation.isLoginForeground(operation.tabId, operation);
    const saveVisible=!!pendingSave&&pendingSave.expires>Date.now()&&pendingSave.tabId===games.activeId&&!loginVisible;
    games.top=42+(saveVisible?44:0);
    games.hidden = loginVisible; for(const page of loginPages.values())page.hide(page!==foreground); login?.hide(login!==foreground); games.layout();
    const state = buildToolbarState({
      notice, noticeKind, shutdown: hostShutdown, muted: games.muted, speed: speed.toolbarState(), preferences: prefs,
      loginActive: !!login?.operation, visibleSave: saveVisible ? pendingSave : undefined, tabs: visibleTabs(),
      active: games.active, activeId: games.activeId, loginVisible, operation, refresh: refreshState(), tasks: tasks.values(),
    });
    const serialized = JSON.stringify(state);
    if (serialized === lastToolbarState) return;
    win.webContents.send('prototype:state', state);
    lastToolbarState = serialized;
  }
  // 国服主线：游戏会话在应用内部直连；系统代理仍留给其他应用使用。
  const directGameSession = true;
  const resourceProbe = process.env.NARUTO_RESOURCE_PROBE === '1' ? new ResourceProbe(path.join(root, 'host', 'resource-probe')) : undefined;
  const gameBridge = resourceProbe ? undefined : resources.bridge;
  const prepareGame = resourceProbe ? (wc: Electron.WebContents) => resourceProbe.attach(wc)
    : gameBridge ? (wc: Electron.WebContents) => {
      const tab = games.fromSender(wc.id);
      return gameBridge.attach(wc, tab?.region && resources.speedOverrides.get(tab.region));
    }
    : undefined;
  games = new GameSessions(win, runtimeChanged, report, undefined, directGameSession, sessions, () => {}, prepareGame);
  if (speedEnabled) {
    games.lifecycle.on('opened', speed.applySpeed);
    setInterval(speed.applySpeed, SPEED_RETRY_MS).unref();
  }
  navigation = new Navigation(games);
  games.muted = prefs.muted; games.syncAudio();
  games.cnEntry = validCnEntry(prefs.cnEntry) ? prefs.cnEntry : 'qq';
  const fixtureEntry=fixture && /^http:\/\/127\.0\.0\.1:\d+\/$/.test(process.env.NARUTO_C_LOGIN_FIXTURE || '') ? process.env.NARUTO_C_LOGIN_FIXTURE : undefined;
  const hostLogin: HostLogin = new HostLogin({
    window: win, games, sessions, navigation,
    binary: path.join(project, 'dist/native/embedded-login.node'),
    fixtureEntry, changed: runtimeChanged, report, activeTask: () => taskQueue.active, poll, core,
  });
  const { pages: loginPages, recovery: login } = hostLogin;
  const taskQueue: TaskQueue = new TaskQueue({
    games, login, loginPages, navigation,
    openInitialLogin: (task, saved, onWaiting) => hostLogin.open(task, saved, onWaiting),
    sessions, project, packaged: app.isPackaged, fixture, fixtureEntry, core,
    isShuttingDown: () => hostShutdown.stopping,
    focusExisting(tabId) {
      if (loginPages.has(tabId)) navigation.selectLogin(tabId);
      else navigation.selectGame(tabId);
      win.show();
      win.focus();
    },
    clearPendingSave(task) {
      if (pendingSave && Array.from(tasks.values()).some(t => sameAttempt(t, task) && t.operationId === pendingSave.operationId)) {
        pendingSave = undefined;
      }
    },
    hostEvent, report, clearNotice, paint, persist, poll,
    shutdown: () => hostShutdown.shutdown(),
  });
  const tasks = taskQueue.tasks;
  const hostShutdown = createShutdown({
    confirmExit() {
      if (fixture || !games.tabs.length) return;
      return dialog.showMessageBox({message:resolveText(msg('ui.quit_all_games_173')),buttons:[resolveText(msg('common.cancel')),resolveText(msg('ui.quit'))],cancelId:0})
        .then(answer => answer.response === 1);
    },
    stopPolling: () => clearInterval(interval),
    async prepareExit() {
      persist();
      taskQueue.cancelAll();
      pendingSave = undefined;
      await hostLogin.close();
      games.destroy();
      await taskQueue.idle;
    },
    saveSessions: () => sessions.flush(),
    acknowledgeExit: () => core('host.closed', { instance }),
    exit: () => app.exit(0),
    paint,
    showSaveFailure() {
      report(msg('ui.session_has_not_been_saved_retry_saving'));
      if (!fixture) void dialog.showMessageBox({type:'error',message:resolveText(msg('ui.session_has_not_been_saved')),detail:resolveText(msg('ui.check_keychain_access_then_click_retry_save')),buttons:[resolveText(msg('ui.keep_window_open'))]});
    },
    sendUpdateHandoff(state) {
      if (state === 'confirming') hostEvent('update-handoff-requested');
      hostEvent('update-handoff-state', { state });
      return core('host.updateHandoff', { instance, state });
    },
  });
  const offers = new Map<string, {origin:string;ids:string[];expires:number;operationId:string;offerId:string}>();
  function gameHandler(channel: string, fn: (event: Electron.IpcMainInvokeEvent, input: any) => any) {
    ipcMain.handle(channel, async (event, input) => {try {return {ok:true,value:await fn(event,input)}} catch(error) {return {ok:false,message:error instanceof Error ? error.message : msg('ui.operation_incomplete')}}});
  }
  function pageTask(event: Electron.IpcMainInvokeEvent, origin: string) {
    const tab=games.fromSender(event.sender.id);
    if (!tab || tab.id!==games.activeId || credentialOrigin(event.sender.getURL())!==origin) throw new Error(msg('ui.page_changed'));
    const task=Array.from(tasks.values()).find(t=>t.tabId===tab.id && !['closed','cancelled'].includes(t.status));
    if (!task) throw new Error(msg('ui.task_ended'));return {tab,task};
  }
  gameHandler('game:quality', event => {if (!games.fromSender(event.sender.id)) throw new Error(msg('ui.invalid_game_request'));return prefs.quality;});
  gameHandler('game:candidates', async (event,input) => {
    const {tab,task}=pageTask(event,input?.origin);const generation=tab.generation;
    if(typeof input.query!=='string'||input.query.length>320) throw new Error(msg('ui.invalid_query'));
    const result=await core('credentials.list',{operationId:task.operationId,origin:input.origin});
    if(tab.generation!==generation||games.activeId!==tab.id)return [];
    const records=result.records.filter((r:any)=>r.username.toLowerCase().includes(input.query.toLowerCase()));
    offers.set(tab.id,{origin:input.origin,ids:records.map((r:any)=>r.id),expires:Date.now()+30000,operationId:task.operationId,offerId:result.offerId});return records;
  });
  gameHandler('game:choose',async(event,input)=>{
    const {tab,task}=pageTask(event,input?.origin);const offer=offers.get(tab.id);offers.delete(tab.id);const generation=tab.generation;
    if(!offer||offer.expires<Date.now()||offer.origin!==input.origin||!offer.ids.includes(input.id))throw new Error(msg('ui.selection_expired'));
    const result=await core('credentials.select',{operationId:task.operationId,origin:input.origin,id:input.id,offerId:offer.offerId});
    if(tab.generation!==generation||games.activeId!==tab.id)throw new Error(msg('ui.page_changed'));return result;
  });
  gameHandler('game:submit',async(event,input)=>{
    const {tab,task}=pageTask(event,input?.origin);
    if(typeof input.username!=='string'||typeof input.password!=='string'||input.username.length>320||input.password.length>4096)return;
    const submission={...input,operationId:task.operationId,tabId:tab.id,expires:Date.now()+60000,update:false};pendingSave=submission;
    const result=await core('credentials.needsSave',submission);
    if(pendingSave!==submission)return;
    if(!result.needed)pendingSave=undefined;else {pendingSave.update=result.update;paint();}
  });
  function flashRuntimeVersion(){return process.env.NARUTO_C_FLASH==='31'?'31':'34';}
  async function poll() {
    if (busyPoll || hostShutdown.stopping) return; busyPoll = true;
    let registered = false;
    try {
      pollPhase = 'prepare';
      if (pendingSave) {
        const tab = games.tabs.find(t => t.id === pendingSave.tabId);
        if (pendingSave.expires <= Date.now() || !tab || tab.view.webContents.isDestroyed() ||
            !savePromptDestination(pendingSave.origin, tab.view.webContents.getURL())) pendingSave = undefined;
      }
      runtimeChanged(); persist();
      pollPhase = 'rpc';
      const response = await core('host.poll', { pid: process.pid, instance, windowShown: win.isVisible(), runtime:{preferences:startupPrefs,localizationActive:resources.localizationActive,assistsEnabled,assistsActive:assistsEnabled,speedActive:speedEnabled,assists:resources.status,flash:flashRuntimeVersion(),loginOperation:login.operation||null,slots:[...new Set([...knownSlots,...(fs.existsSync(path.join(root,'host','Partitions'))?fs.readdirSync(path.join(root,'host','Partitions'),{withFileTypes:true}):[]).filter(d=>d.isDirectory()&&/^naruto-(br|cn)-[1-9]\d*$/.test(d.name)).map(d=>'persist:'+d.name)])]},deletionResults, tasks: Array.from(tasks.values()).map(t => ({ operationId: t.operationId, profileId: t.profileId, status: t.status })) });
      registered = true;
      pollPhase = 'apply';
      if(hostShutdown.stopping)return;
      failures = 0;clearNotice('connection');
      taskQueue.dropAcknowledged();
      for(const profile of response.deletions || []) {
        if(clearing.has(profile.id)||deletionResults.some(r=>r.id===profile.id&&r.requestId===profile.deleteRequest))continue;
        clearing.add(profile.id);
        try {
          if(Array.from(tasks.values()).some(t=>t.profileId===profile.id&&!['closed','cancelled','failed'].includes(t.status))||games.tabs.some(t=>t.profileId===profile.id)||taskQueue.active?.profileId===profile.id)throw new Error(msg('ui.profile_is_busy'));
          await sessions.clearProfile(profile.region,profile.slot);
          deletionResults.push({id:profile.id,requestId:profile.deleteRequest,ok:true});
        }catch {deletionResults.push({id:profile.id,requestId:profile.deleteRequest,ok:false});}
        finally{clearing.delete(profile.id)}
      }
      if(response.deletions?.length===0&&deletionResults.length&&!games.tabs.length&&!taskQueue.active&&!taskQueue.hasQueuedTasks){void hostShutdown.shutdown();return;}

      if (response.preferences.quality !== prefs.quality) for (const tab of games.tabs) tab.view.webContents.send('game:quality', response.preferences.quality);
      if (response.preferences.muted !== prefs.muted) {games.muted = response.preferences.muted; games.syncAudio();}
      if (response.preferences.cnEntry !== prefs.cnEntry && validCnEntry(response.preferences.cnEntry)) games.cnEntry = response.preferences.cnEntry;
      const languageChanged = prefs.language !== response.preferences.language;
      prefs = response.preferences;
      if(languageChanged){setLanguage(prefs.language);app.setName(resolveText(msg('ui.naruto_os_game')));for(const tab of games.tabs)tab.view.webContents.send('game:language',prefs.language);updateMenu();win.setTitle(resolveText(`Naruto OS · ${buildLabel}`));}
      taskQueue.updateProfiles(response.profiles);
      if (response.tasks.length) {if (win.isMinimized()) win.restore();win.show();}
      if (response.tasks.length) hostEvent('tasks-received', { ids: (response.tasks as Task[]).map(t=>t.profileId) });
      taskQueue.registerTasks(response.tasks);
      persist(); // ACK is sent on the next poll, after tasks are actually registered and the window is shown.
      void taskQueue.executeNext(); paint();
    } catch (error) {
      failures++;
      const message = error instanceof Error ? error.message : String(error);
      logPollFailure(pollPhase, message, error);
      const code = messageCode(message);
      if (code === 'host-identity' || code === 'error.staleHost') {
        // Another host instance owns the core; retrying can never succeed here.
        report(msg('ui.this_window_lost_control_of_the_game'),'error','connection');
        clearInterval(interval); setTimeout(() => app.exit(0), 1200);
        return;
      }
      if (code === 'host-window-not-ready') {
        if (!win.isVisible()) win.show();
        return;
      }
      if (failures >= 10 && !/ECONNREFUSED|ENOENT/.test(message) && !['error.coreTimeout','error.coreClosed','error.coreDisconnected'].includes(code)) {
        // A window that cannot register must not sit there blank forever.
        clearInterval(interval); setTimeout(() => app.exit(0), 600);
        return;
      }
      if (failures >= 2) report(msg('ui.reconnecting_existing_games_can_keep_running'),'error','connection');
      if ((failures === 3 || failures % 20 === 0) && (/ECONNREFUSED|ENOENT/.test(message) || ['error.coreTimeout','error.coreClosed','error.coreDisconnected'].includes(messageCode(message)))) {
        spawn(path.join(project, 'dist/prototype/native/core'), [], { env: process.env, detached: true, stdio: 'ignore' }).unref();
      }
    } finally {
      busyPoll = false;
      // An unsuccessful first poll leaves Core without an instance to acknowledge.
      if (registered && interval !== undefined && !requestUpdateHandoff) {
        requestUpdateHandoff = hostShutdown.requestUpdateHandoff;
        if (updateHandoffPending) {
          updateHandoffPending = false;
          requestUpdateHandoff();
        }
      }
    }
  }
  ipcMain.handle('prototype:command', async (event, input) => {
    if (event.sender !== win.webContents || !['center','settings','focus','cancel','refresh','mute','speed','complete','cancel-recovery','retry','save','dismiss','retry-exit','notice-details','fullscreen-exit'].includes(input?.type)) return;
    const ownPage = loginPages.get(input.id);
    if(ownPage && !hostShutdown.stopping && (input.type==='focus'||input.type==='cancel')){
      if(input.type==='focus'){navigation.selectLogin(input.id);ownPage.focus();paint();}
      else {const task=Array.from(tasks.values()).find(t=>t.tabId===input.id);if(task)await taskQueue.cancel(task);}
      return;
    }
    if(input.type==='fullscreen-exit'){if(win.isFullScreen())win.setFullScreen(false);return;}
    if(input.type==='notice-details'){if(notice)await dialog.showMessageBox({message:resolveText(notice),buttons:[resolveText(msg('ui.ok'))]});return;}
    if(input.type==='retry-exit'){await hostShutdown.shutdown();return;}
    if(hostShutdown.stopping)return;
    if(input.type==='save') {
      const submission=pendingSave;
      if(!submission)return;
      if(submission.expires<Date.now()){if(pendingSave===submission)pendingSave=undefined;paint();return;}
      if(savingPassword===submission)return;
      savingPassword=submission;
      try {
        await core('credentials.stageSave',submission);
        if(pendingSave===submission){pendingSave=undefined;report(msg('ui.password_saved'),'info');}
      }catch{
        if(pendingSave===submission){
          if(submission.expires>Date.now()){submission.saveFailed=true;report(msg('ui.password_not_saved_retry_or_skip_for'));}
          else pendingSave=undefined;
        }
      }finally{if(savingPassword===submission)savingPassword=undefined;paint();}
      return;
    }
    if(input.type==='dismiss'){pendingSave=undefined;paint();return;}
    if(input.type==='cancel-recovery') {
      const operation=login.operation;const owner=taskQueue.active;
      if(!operation||!owner||operation.profileId!==owner.profileId||operation.stage!=='confirming'||input.id!==operation.candidateId||games.activeId!==operation.candidateId)return;
      if(operation.stage==='confirming')await login.cancelRecovery(operation.tabId);else await login.cancel();
      taskQueue.resumeAfterRecovery(owner);
      paint();return;
    }
    if (input.type === 'center' || input.type === 'settings') { await openCenter(input.type === 'settings'); return; }
    if (input.type === 'mute') { games.muted = !games.muted; games.syncAudio(); report(games.muted?msg('ui.muted'):msg('ui.unmuted'),'info'); return; }
    if (input.type === 'speed') {
      openSpeedMenu();
      return;
    }
    if (input.type === 'complete' && login.operation) { if(input.id!==login.operation.candidateId||games.activeId!==input.id)return; if(login.completeRecovery(input.id)){clearNotice();taskQueue.resumeAfterRecovery();paint();}return; }
    if (input.type === 'refresh') {
      const page=foregroundLogin();if(page?.operation?.stage==='login'){page.refresh();return;}
      if(!refreshState().enabled)return;
      const operation=login.operation;
      if(operation?.stage==='login'&&navigation.isLoginForeground(operation.tabId,operation)){login.refresh();return;}
      const tab = games.active; if (!tab) return;
      if (tab.region === 'br' && !fixture) {
        taskQueue.enqueueRecovery(tab);
      } else games.refresh(tab.id); return;
    }
    const operation=login.operation;
    const page=games.tabs.find(tab=>tab.id===input.id);
    const pageTask=page&&Array.from(tasks.values()).find(task=>task.tabId===page.id&&!['closed','cancelled'].includes(task.status));
    const owner=taskQueue.active;
    const loginTask=operation?.tabId===input.id&&owner&&tasks.get(owner.operationId);
    if(input.type==='focus'&&(page||loginTask)) {
      if(noticeKind==='info')clearNotice();
      if(page)navigation.selectGame(page.id);else {navigation.selectLogin(operation!.tabId);login.focus();}
      paint();return;
    }
    if(input.type==='cancel'&&operation&&(page||loginTask)) {
      if(input.id===operation.originalId) {
        if(operation.stage==='confirming'){login.completeRecovery(operation.candidateId!);clearNotice();paint();}
        else report(msg('ui.cancel_recovery_before_closing_the_original_game'));
        return;
      }
      if(input.id===operation.tabId) {
        if(!operation.recovering&&loginTask){await taskQueue.cancel(loginTask);return;}
        await login.cancel('restore-original');runtimeChanged();return;
      }
    }
    const task = tasks.get(input.id)||pageTask||loginTask; if (!task) return;
    if (input.type === 'retry') { taskQueue.retry(task); return; }
    if (input.type === 'cancel') await taskQueue.cancel(task,page?.id??task.tabId);
    if (input.type === 'focus') {
      if(noticeKind==='info')clearNotice();
      const operation = login.operation;
      if(operation?.profileId===task.profileId){
        const candidate=operation.candidateId&&games.tabs.find(t=>t.id===operation.candidateId);
        if(candidate)navigation.selectGame(candidate.id);
        else {navigation.selectLogin(operation.tabId);login.focus();}
      } else {
        const tab=games.tabs.find(t=>t.profileId===task.profileId&&!t.recoveryStage)||games.tabs.find(t=>t.profileId===task.profileId);
        if(tab)navigation.selectGame(tab.id);
      }
      paint();
    }
  });
  win.on('resize', () => { games.layout(); });
  win.webContents.on('did-finish-load', () => { lastToolbarState = undefined; paint(); });
  await win.loadFile(path.join(__dirname, 'toolbar.html'));
  if(savedWindow?.maximized)win.maximize();
  if(savedWindow?.fullscreen)win.setFullScreen(true);
  win.show();
  const fullscreen = () => win.webContents.send('prototype:fullscreen', win.isFullScreen());
  win.on('enter-full-screen', fullscreen); win.on('leave-full-screen', fullscreen);
  function updateMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: resolveText(msg('ui.naruto_os_game')), submenu: [
    { label: resolveText(msg('ui.about_naruto_os_game')),role:'about' },
    { label: resolveText(msg('ui.open_launch_center')), accelerator: 'CmdOrCtrl+Shift+H', click: () => { void openCenter(); } },
    { label: resolveText(msg('ui.settings')), accelerator: 'CmdOrCtrl+,', click: () => { void openCenter(true); } },
    { label: resolveText(msg('ui.toggle_full_screen')), accelerator: 'Ctrl+Cmd+F', click: () => { win.setFullScreen(!win.isFullScreen()); } },
    { type: 'separator' },
    { label: resolveText(msg('ui.quit_all_games')), accelerator:'CmdOrCtrl+Q', click: () => { void hostShutdown.shutdown(); } }
  ] }, { id:'naruto-edit', label:resolveText(msg('ui.edit')), submenu:[{label:resolveText(msg('ui.cut')),role:'cut'},{label:resolveText(msg('ui.copy')),role:'copy'},{label:resolveText(msg('ui.paste')),role:'paste'},{label:resolveText(msg('ui.select_all')),role:'selectAll'}] }]));
  }
  updateMenu();
  // Clear disk cache before the poll timer can register game tasks or open tabs.
  await clearLocalizationCacheOnce();
  interval = setInterval(() => void poll(), 500);
  win.on('close',event=>{if(hostShutdown.state!=='closed'){event.preventDefault();void hostShutdown.shutdown();}});
  app.on('before-quit',event=>{if(hostShutdown.state!=='closed'){event.preventDefault();void hostShutdown.shutdown();}});
  app.on('second-instance', () => { win.show(); win.focus(); });
  app.on('activate', () => { win.show(); win.focus(); });
  await poll();
  if (fixture) startHostFixture({
    root, instance, win, games, tasks, hostShutdown, loginFixture: !!fixtureEntry, loginPages, visibleTabs, openCenter,
  });
}
