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
import { WebLogin } from '../../main/web-login';
import { findFlash } from '../../main/flash';
import { createGameLocalization } from '../../main/localization-experiment';
import { createActivityAssist } from '../../main/activity-assist';
import { createAssistManager } from '../../main/assist-manager';
import { ResourceProbe } from '../../main/resource-probe';
import { newTab } from '../../main/config';
import { credentialOrigin, savePromptDestination } from '../../main/policy';
import { core, root, project } from './client';
import { createExitGuard } from './exit-guard';
import { redactURL } from './safe-url';
import { attachTrafficLights, measureTrafficLights } from '../../main/traffic-lights';
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

// SIGUSR2 is the update handoff request. It can arrive before the host is ready,
// so the early handler only records it; start() attaches the real wiring and
// replays a pending request once the host is running.
let updateHandoffPending = false;
process.on('SIGUSR2', () => { updateHandoffPending = true; });

type Profile = { id: string; region: 'br' | 'cn'; slot: number; generation: number; name: string };
type Task = { operationId: string; profileId: string; generation: number; profile: Profile; status: string; tabId?: string; ownerOperationId?: string; recoveryOriginalId?: string };
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
  const tasks = new Map<string, Task>(); const queue: Task[] = [];
  const recoveryQueue: string[] = [];
  const deletionResults: any[] = [];
  const clearing = new Set<string>();
  let pendingSave: any;
  let savingPassword: any;
  let executionIdle: Promise<void> | undefined;
  let exitState: 'running' | 'confirming' | 'saving' | 'save-failed' | 'closed' = 'running';
  // Only a confirmed shutdown that hangs while saving may be force-finished.
  const exitGuard = createExitGuard(() => app.exit(0));
  let exitAttempt: Promise<void> | undefined;
  let exitPrepared = false;
  // Update handoff: the native centre asks this host to save and quit through the
  // same shutdown path the user sees. A cancelled dialog or a failed save aborts
  // the update instead of forcing a process kill.
  let updateHandoffRequested = false;
  async function reportUpdateHandoff(state: string) {
    if (!updateHandoffRequested) return;
    hostEvent('update-handoff-state', { state });
    try { await core('host.updateHandoff', { instance, state }); } catch { /* The centre aborts on timeout. */ }
  }
  let executingRecovery=false,recoveryAwait=false;
  let executing: Task | undefined, shutting = false, busyPoll = false, failures = 0, notice = '', everHadTask = false, pollPhase = 'prepare';
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
  let games: GameSessions; let login: WebLogin; let navigation: Navigation;
  const loginPages = new Map<string, WebLogin>();
  const service = `cn.youye.naruto-os.test.sessions.native-core.${path.basename(root)}`;
  const sessionTransport=keychainTransport(path.join(project, 'dist/native/keychain'), service);
  const sessions = new LoginSessions((action,value) => fixture && action==='write' && fs.existsSync(path.join(root,'fixture-fail-session-write')) ? Promise.reject(new Error(msg('ui.synthetic_save_failure'))) : sessionTransport(action,value), () => report(msg('ui.session_save_failed_keep_the_window_open')));
  const assistsEnabled = startupPrefs.assistsEnabled === true;
  const localizationEnabled = startupPrefs.localization === true;
  const activityAssist = createActivityAssist(project, localizationEnabled, assistsEnabled);
  const assistManager = createAssistManager(project, app.isPackaged, assistsEnabled,
    path.join(app.getPath('userData'), 'assists'), () => {}, activityAssist && assistsEnabled ? [activityAssist.resource] : []);
  const localization = createGameLocalization(project, localizationEnabled, () => {},
    assistManager ? assistManager.resources : (activityAssist ? [activityAssist.resource] : []));
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
  function sameAttempt(a: Task, b: Task) {
    return a.profileId===b.profileId && a.generation===b.generation && (a.ownerOperationId??a.operationId)===(b.ownerOperationId??b.operationId);
  }
  function restoreRecoveryPage(task: Task) {
    if(!task.recoveryOriginalId || login?.busy || login?.operation || (executingRecovery&&recoveryAwait))return;
    if(!games.tabs.some(tab=>tab.id===task.tabId) && games.tabs.some(tab=>tab.id===task.recoveryOriginalId))task.tabId=task.recoveryOriginalId;
    task.recoveryOriginalId=undefined;
  }
  function runtimeChanged() {
    if (!games || win.isDestroyed()) return;
    if (executing && executingRecovery && !recoveryAwait && !login?.busy) {
      for(const task of tasks.values())if(sameAttempt(task,executing))restoreRecoveryPage(task);
      executing = undefined; executingRecovery = false;
      void Promise.resolve().then(executeNext);
    }
    const operation=login?.operation;
    if(!operation&&!recoveryQueue.length&&!executingRecovery)clearNotice('recovery');
    for (const task of tasks.values()) {
      if(['cancelled','closed'].includes(task.status))continue;
      restoreRecoveryPage(task);
      if(operation && executing && sameAttempt(task,executing)) {
        task.tabId=operation.tabId;
        task.status=operation.stage==='login'?'login-required':operation.stage==='loading'?'loading':'ready';
        continue;
      }
      const tab = games.tabs.find(t => t.id === task.tabId);
      if (tab?.state === 'ready') clearNotice(JSON.stringify(['startup',task.profileId,task.generation,task.ownerOperationId??task.operationId,tab.id]));
      if (tab) { task.tabId = tab.id; if (!['cancelled', 'closed'].includes(task.status)) task.status = tab.state === 'ready' ? 'ready' : ['failed', 'crashed'].includes(tab.state) ? 'failed' : 'loading'; }
    }
    paint();
  }
  function foregroundLogin() {
    return [...loginPages.values(),login].find(page => {
      const op=page?.operation; return op && navigation.isLoginForeground(op.tabId,op);
    });
  }
  function refreshState() {
    const operation=foregroundLogin()?.operation ?? login?.operation;
    if(shutting)return {enabled:false,label:msg('ui.refresh_current_page')};
    if(operation?.stage==='login'&&navigation.isLoginForeground(operation.tabId,operation))return {enabled:true,label:msg('ui.refresh_login_server_selection_page')};
    const tab=games.active;
    if(!tab)return {enabled:false,label:msg('ui.refresh_current_page')};
    if(tab.recoveryStage || operation?.originalId===tab.id || recoveryQueue.includes(tab.id))return {enabled:false,label:msg('ui.re_entering')};
    return {enabled:true,label:tab.region==='br'&&!fixture?msg('ui.re_enter_game'):msg('ui.refresh_current_page')};
  }
  function enqueueRecovery(tab: typeof games.tabs[number]) {
    if(tab.recoveryStage || login.operation?.originalId===tab.id || recoveryQueue.includes(tab.id))return;
    recoveryQueue.push(tab.id);report(msg('ui.re_entry_queued'),'info','recovery');void executeNext();paint();
  }
  function visibleTabs() {
    const rows:any[]=[];
    const seen=new Set<string>();
    for(const task of tasks.values()) {
      if(['closed','cancelled'].includes(task.status)||seen.has(task.profileId))continue;
      seen.add(task.profileId);
      const operation=loginPages.get(task.tabId ?? "")?.operation ?? login?.operation;
      const pages=games.tabs.filter(tab=>tab.profileId===task.profileId);
      for(const tab of pages)rows.push({...task,id:tab.id,tabId:tab.id,status:['failed','crashed'].includes(tab.state)?'failed':tab.state==='ready'?'ready':'loading',active:games.activeId===tab.id,suffix:operation?.originalId===tab.id?msg('ui.original_game'):operation?.candidateId===tab.id?msg('ui.new_game'):''});
      if(operation?.profileId===task.profileId&&!pages.some(tab=>tab.id===operation.tabId))rows.push({...task,id:operation.tabId,status:'login-required',active:navigation.isLoginForeground(operation.tabId,operation),suffix:operation.recovering?msg('ui.re_entering_150'):''});
      else if(!pages.length)rows.push({...task,id:task.operationId,active:false,suffix:''});
    }
    return rows;
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
    const state = { notice, noticeKind, stopping: shutting, exitState, muted: games.muted, preferences: { language: prefs.language, theme: prefs.theme, titleBarColor: prefs.titleBarColor }, loginActive:!!login?.operation, savePrompt: saveVisible ? {username:pendingSave.username,update:pendingSave.update,failed:!!pendingSave.saveFailed} : null, tabs: visibleTabs(), failedPage: games.active && ['failed','crashed'].includes(games.active.state) && !loginVisible ? {id:games.active.id,state:games.active.state,region:games.active.region} : null, refresh: refreshState(), recovery: operation?.stage === 'confirming' && games.activeId === operation.candidateId ? { candidateId: operation.candidateId } : null, tasks: Array.from(tasks.values()).filter(t => !['cancelled', 'closed'].includes(t.status)).map(t => ({ ...t, active: loginVisible ? operation?.profileId === t.profileId : games.activeId === t.tabId })) };
    const serialized = JSON.stringify(state);
    if (serialized === lastToolbarState) return;
    win.webContents.send('prototype:state', state);
    lastToolbarState = serialized;
  }
  // 国服主线：游戏会话在应用内部直连；系统代理仍留给其他应用使用。
  const directGameSession = true;
  const resourceProbe = process.env.NARUTO_RESOURCE_PROBE === '1' ? new ResourceProbe(path.join(root, 'host', 'resource-probe')) : undefined;
  const prepareGame = resourceProbe ? (wc: Electron.WebContents) => resourceProbe.attach(wc)
    : localization ? (wc: Electron.WebContents) => localization.attach(wc)
    : assistManager && assistManager.bridge ? (wc: Electron.WebContents) => assistManager.attach(wc)
    : activityAssist ? (wc: Electron.WebContents) => activityAssist.attach(wc)
    : undefined;
  games = new GameSessions(win, runtimeChanged, report, undefined, directGameSession, sessions, () => {}, prepareGame);
  navigation = new Navigation(games);
  games.muted = prefs.muted; games.syncAudio();
  const fixtureEntry=fixture && /^http:\/\/127\.0\.0\.1:\d+\/$/.test(process.env.NARUTO_C_LOGIN_FIXTURE || '') ? process.env.NARUTO_C_LOGIN_FIXTURE : undefined;
  login = makeLogin();
  function makeLogin(owner?:Task) {
    const offers = new Map<string, { origin:string; ids:string[]; expires:number; operationId:string; offerId:string }>();
    return new WebLogin(win, games, sessions, navigation, path.join(project, 'dist/native/embedded-login.node'), report, fixtureEntry ? {fixture:fixtureEntry+(owner?.profileId ?? '')} : undefined, runtimeChanged, () => {}, () => win.focus(), {
    list: async (id, origin, query) => {
      const task=owner ?? executing;
      if (!task || credentialOrigin(origin) !== origin) return [];
      await poll();
      const result = await core('credentials.list', { operationId: task.operationId, origin });
      const records = result.records.filter((r: any) => r.username.toLowerCase().includes(query.toLowerCase()));
      offers.set(id, { origin, ids: records.map((r: any) => r.id), expires: Date.now() + 30000, operationId: task.operationId, offerId: result.offerId }); return records;
    },
    select: async (id, origin, recordId) => {
      const offer = offers.get(id); offers.delete(id);
      if (!offer || offer.expires < Date.now() || offer.origin !== origin || !offer.ids.includes(recordId) || (owner ?? executing)?.operationId !== offer.operationId) throw new Error(msg('ui.selection_expired'));
      return core('credentials.select', { operationId: offer.operationId, origin, id: recordId, offerId: offer.offerId });
    }
  },!!owner); }
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
  function executeNext(): Promise<void> {
    if(executing || shutting)return Promise.resolve();
    const work=runNext();executionIdle=work;
    void work.finally(()=>{if(executionIdle===work)executionIdle=undefined});
    return work;
  }
  async function runNext() {
    if (executing || shutting) return;
    if (recoveryQueue.length) {
      const id=recoveryQueue.shift()!;const tab=games.tabs.find(t=>t.id===id);
      const task=tab&&Array.from(tasks.values()).find(t=>t.tabId===tab.id&&!['closed','cancelled'].includes(t.status));
      if(!tab||!task||tab.recoveryStage||['closed','cancelled'].includes(task.status)){void executeNext();return;}
      executing=task;executingRecovery=true;recoveryAwait=true;
      for(const alias of tasks.values())if(sameAttempt(alias,task))alias.recoveryOriginalId=tab.id;
      try {await login.recover(tab);} catch {report(msg('ui.recovery_incomplete_the_original_tab_was_kept'));}
      recoveryAwait=false;
      if(login.operation?.stage!=='confirming'&&executing===task){for(const alias of tasks.values())if(sameAttempt(alias,task))restoreRecoveryPage(alias);executing=undefined;executingRecovery=false;void executeNext();}
      paint();return;
    }
    if(!queue.length)return;
    const task = queue.shift()!; if (task.status !== 'queued') { void executeNext(); return; }
    executing = task;executingRecovery=false;
    hostEvent('task-run', { operationId: task.operationId, profileId: task.profileId });
    const isCancelled = () => task.status === 'cancelled';
    try {
      // Revalidate against the core immediately before acquiring the slot.
      const snapshot = await core('snapshot');
      if (isCancelled()) return;
      if (!snapshot.profiles.some((p: Profile) => p.id === task.profileId && p.generation === task.generation && !(p as any).deleting)) throw new Error(msg('ui.profile_changed'));
      // A fresh attempt owns a fresh page; failed pages from previous attempts are retired.
      const stalePages=games.tabs.filter(tab=>tab.profileId===task.profileId && ['failed','crashed'].includes(tab.state) && tab.id!==login.operation?.originalId && tab.id!==login.operation?.candidateId);
      for(const tab of stalePages){
        for(const old of tasks.values())if(old.tabId===tab.id&&!sameAttempt(old,task))old.status='closed';
        games.close(tab.id,{deferDestroy:true});
      }
      const saved = { ...newTab(task.profile.region), profileId: task.profileId, name: task.profile.name };
      task.tabId=saved.id;
      if (fixture && !(fixtureEntry && task.profile.region==="br")) {
        const lease = sessions.acquireSlot(task.profile.region, task.profile.slot);
        await lease.ready;
        await lease.session.cookies.set({url:'https://fixture.invalid',name:'proto-synthetic',value:task.profile.region,httpOnly:true});
        if (isCancelled()) { lease.release(); return; }
        await lease.session.protocol.interceptBufferProtocol('https', (request, callback) => {
          // Fixture mode is strictly offline, including every cross-origin asset.
          if (request.url.endsWith('/fixture.swf')) {
            const bytes = fs.readFileSync(path.join(project, app.isPackaged?'assets/checks/quality.swf':'tests/fixtures/native-core/quality.swf'));
            callback({ mimeType: 'application/x-shockwave-flash', data: bytes });
          } else callback({ mimeType: 'text/html', data: Buffer.from('<!doctype html><title>隔离账号游戏</title><style>body{background:#26382f;color:white;font:22px system-ui}object{display:block}</style><p>原生核心原型 · 合成游戏持续运行</p><output id="ticks">0</output><script>setInterval(()=>document.getElementById("ticks").textContent=String(Number(document.getElementById("ticks").textContent)+1),250)</script><object id="flash" type="application/x-shockwave-flash" data="https://fixture.invalid/fixture.swf" width="400" height="250"><param name="allowscriptaccess" value="always"></object>') });
        });
        if (isCancelled()) {lease.release();return;}
        const tab = games.create(saved, 'https://fixture.invalid/game', lease); task.tabId = tab.id; navigation.selectGame(tab.id);
        await games.waitForReady(tab.id, 20000); if(!['closed','cancelled'].includes(task.status)) task.status = 'ready';
      } else if (task.profile.region === 'br') {
        task.status = 'login-required'; navigation.selectLogin(saved.id);
        const page=makeLogin(task);loginPages.set(saved.id,page);
        const opened=page.open(saved,task.profile.slot);
        executing=undefined;void executeNext();
        try {await opened;} finally {await page.close();loginPages.delete(saved.id);}
        const tab = games.tabs.find(t => t.id === task.tabId);
        task.status = tab ? 'loading' : task.status === 'cancelled' ? 'cancelled' : 'failed';
      } else {
        const tab = games.create(saved, undefined, undefined, task.profile.slot); task.tabId = tab.id; navigation.selectGame(tab.id);
        // CN login stays independently owned by the tab. The next task starts only once the top-level page is ready.
        await games.waitForReady(tab.id, 30000); if(!['closed','cancelled'].includes(task.status)) task.status = 'ready';
      }
    } catch (error) { if (!['closed','cancelled'].includes(task.status)) {task.status = 'failed'; report(error instanceof Error && error.message==='game-tab-timeout' ? msg('ui.game_page_timed_out_and_is_still') : msg('ui.this_account_could_not_start_close_it'), 'error', JSON.stringify(['startup',task.profileId,task.generation,task.ownerOperationId??task.operationId,task.tabId]));} }
    finally { for (const t of tasks.values()) if (sameAttempt(t,task) && !['closed','cancelled'].includes(t.status)) {t.status=task.status;t.tabId=task.tabId;}if(executing===task)executing = undefined; paint(); persist(); void executeNext(); }
  }
  function flashRuntimeVersion(){return process.env.NARUTO_C_FLASH==='31'?'31':'34';}
  async function poll() {
    if (busyPoll || shutting) return; busyPoll = true;
    try {
      pollPhase = 'prepare';
      if (pendingSave) {
        const tab = games.tabs.find(t => t.id === pendingSave.tabId);
        if (pendingSave.expires <= Date.now() || !tab || tab.view.webContents.isDestroyed() ||
            !savePromptDestination(pendingSave.origin, tab.view.webContents.getURL())) pendingSave = undefined;
      }
      runtimeChanged(); persist();
      pollPhase = 'rpc';
      const response = await core('host.poll', { pid: process.pid, instance, windowShown: win.isVisible(), runtime:{preferences:startupPrefs,localizationActive:!!localization,assistsEnabled,assistsActive:assistsEnabled,assists:assistManager ? assistManager.status() : null,flash:flashRuntimeVersion(),loginOperation:login.operation||null,slots:[...new Set([...knownSlots,...(fs.existsSync(path.join(root,'host','Partitions'))?fs.readdirSync(path.join(root,'host','Partitions'),{withFileTypes:true}):[]).filter(d=>d.isDirectory()&&/^naruto-(br|cn)-[1-9]\d*$/.test(d.name)).map(d=>'persist:'+d.name)])]},deletionResults, tasks: Array.from(tasks.values()).map(t => ({ operationId: t.operationId, profileId: t.profileId, status: t.status })) });
      pollPhase = 'apply';
      if(shutting)return;
      failures = 0;clearNotice('connection');
      // Terminal tasks have been acknowledged by the core and need not grow host IPC.
      for(const [id,task] of tasks)if(['closed','cancelled'].includes(task.status))tasks.delete(id);
      for(const profile of response.deletions || []) {
        if(clearing.has(profile.id)||deletionResults.some(r=>r.id===profile.id&&r.requestId===profile.deleteRequest))continue;
        clearing.add(profile.id);
        try {
          if(Array.from(tasks.values()).some(t=>t.profileId===profile.id&&!['closed','cancelled','failed'].includes(t.status))||games.tabs.some(t=>t.profileId===profile.id)||executing?.profileId===profile.id)throw new Error(msg('ui.profile_is_busy'));
          await sessions.clearProfile(profile.region,profile.slot);
          deletionResults.push({id:profile.id,requestId:profile.deleteRequest,ok:true});
        }catch {deletionResults.push({id:profile.id,requestId:profile.deleteRequest,ok:false});}
        finally{clearing.delete(profile.id)}
      }
      if(response.deletions?.length===0&&deletionResults.length&&!games.tabs.length&&!executing&&!queue.some(t=>t.status==='queued')){void shutdown();return;}

      if (response.preferences.quality !== prefs.quality) for (const tab of games.tabs) tab.view.webContents.send('game:quality', response.preferences.quality);
      if (response.preferences.muted !== prefs.muted) {games.muted = response.preferences.muted; games.syncAudio();}
      const languageChanged = prefs.language !== response.preferences.language;
      prefs = response.preferences;
      if(languageChanged){setLanguage(prefs.language);app.setName(resolveText(msg('ui.naruto_os_game')));for(const tab of games.tabs)tab.view.webContents.send('game:language',prefs.language);updateMenu();win.setTitle(resolveText(`Naruto OS · ${buildLabel}`));}
      for(const task of tasks.values()){
        const current=response.profiles?.find((profile:Profile)=>profile.id===task.profileId&&profile.generation===task.generation);
        if(current)task.profile=current;
      }
      if (response.tasks.length) {if (win.isMinimized()) win.restore();win.show();}
      if (response.tasks.length) hostEvent('tasks-received', { ids: (response.tasks as Task[]).map(t=>t.profileId) });
      for (const incoming of response.tasks as Task[]) {
        if (tasks.has(incoming.operationId)) continue;
        const existing = Array.from(tasks.values()).find(t => t.profileId === incoming.profileId && t.generation===incoming.generation && !['closed', 'failed', 'cancelled'].includes(t.status));
        const task = { ...incoming, ownerOperationId: existing?.ownerOperationId??existing?.operationId??incoming.operationId, recoveryOriginalId:existing?.recoveryOriginalId, status: existing?.status ?? 'queued', ...(existing?.tabId ? { tabId: existing.tabId } : {}) };
        hostEvent('task-registered', { operationId: task.operationId, profileId: task.profileId, tabId: task.tabId ?? null, existing: !!existing });
        tasks.set(task.operationId, task); everHadTask = true;
        if (!existing) queue.push(task); else if (existing.tabId) { if(loginPages.has(existing.tabId))navigation.selectLogin(existing.tabId);else navigation.selectGame(existing.tabId); win.show(); win.focus(); }
      }
      persist(); // ACK is sent on the next poll, after tasks are actually registered and the window is shown.
      void executeNext(); paint();
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
    } finally { busyPoll = false; }
  }
  async function cancel(task: Task, pageId = task.tabId) {
    const owner=executing;
    const tab=games.tabs.find(t=>t.id===pageId);
    if(tab&&login.canCloseOriginal(tab.id)){report(msg('ui.cancel_recovery_before_closing_the_original_game'));return;}
    for(let i=recoveryQueue.length-1;i>=0;i--)if(recoveryQueue[i]===pageId)recoveryQueue.splice(i,1);
    for(const t of tasks.values())if(sameAttempt(t,task))t.status='cancelled';
    if(pendingSave&&Array.from(tasks.values()).some(t=>sameAttempt(t,task)&&t.operationId===pendingSave.operationId))pendingSave=undefined;
    if(pageId)await loginPages.get(pageId)?.cancel();
    if(owner&&sameAttempt(owner,task)&&login.busy) {
      await login.cancel();
      if(executing===owner&&executingRecovery&&!recoveryAwait){executing=undefined;executingRecovery=false;void executeNext();}
    }
    if(tab&&games.tabs.some(t=>t.id===tab.id)) {
      hostEvent('task-closed', { operationId: task.operationId, profileId: task.profileId, tabId: tab.id });
      games.close(tab.id,{deferDestroy:true});
      for(const t of tasks.values())if(sameAttempt(t,task))t.status='closed';
    }
    paint();persist();await poll();
    if(everHadTask&&!executing&&!queue.some(t=>t.status==='queued')&&!games.tabs.length&&!login.busy&&!loginPages.size)void shutdown();
  }
  ipcMain.handle('prototype:command', async (event, input) => {
    if (event.sender !== win.webContents || !['center','settings','focus','cancel','refresh','mute','complete','cancel-recovery','retry','save','dismiss','retry-exit','notice-details','fullscreen-exit'].includes(input?.type)) return;
    const ownPage = loginPages.get(input.id);
    if(ownPage && !shutting && (input.type==='focus'||input.type==='cancel')){
      if(input.type==='focus'){navigation.selectLogin(input.id);ownPage.focus();paint();}
      else {const task=Array.from(tasks.values()).find(t=>t.tabId===input.id);if(task)await cancel(task);}
      return;
    }
    if(input.type==='fullscreen-exit'){if(win.isFullScreen())win.setFullScreen(false);return;}
    if(input.type==='notice-details'){if(notice)await dialog.showMessageBox({message:resolveText(notice),buttons:[resolveText(msg('ui.ok'))]});return;}
    if(input.type==='retry-exit'){await shutdown();return;}
    if(shutting)return;
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
      const operation=login.operation;const owner=executing;
      if(!operation||!owner||operation.profileId!==owner.profileId||operation.stage!=='confirming'||input.id!==operation.candidateId||games.activeId!==operation.candidateId)return;
      if(operation.stage==='confirming')await login.cancelRecovery(operation.tabId);else await login.cancel();
      if(executing===owner&&executingRecovery&&!recoveryAwait){executing=undefined;executingRecovery=false;void executeNext();}
      paint();return;
    }
    if (input.type === 'center' || input.type === 'settings') { await openCenter(input.type === 'settings'); return; }
    if (input.type === 'mute') { games.muted = !games.muted; games.syncAudio(); report(games.muted?msg('ui.muted'):msg('ui.unmuted'),'info'); return; }
    if (input.type === 'complete' && login.operation) { if(input.id!==login.operation.candidateId||games.activeId!==input.id)return; if(login.completeRecovery(input.id)){clearNotice();if(executingRecovery&&!recoveryAwait){executing=undefined;executingRecovery=false;void executeNext();}paint();}return; }
    if (input.type === 'refresh') {
      const page=foregroundLogin();if(page?.operation?.stage==='login'){page.refresh();return;}
      if(!refreshState().enabled)return;
      const operation=login.operation;
      if(operation?.stage==='login'&&navigation.isLoginForeground(operation.tabId,operation)){login.refresh();return;}
      const tab = games.active; if (!tab) return;
      if (tab.region === 'br' && !fixture) {
        enqueueRecovery(tab);
      } else games.refresh(tab.id); return;
    }
    const operation=login.operation;
    const page=games.tabs.find(tab=>tab.id===input.id);
    const pageTask=page&&Array.from(tasks.values()).find(task=>task.tabId===page.id&&!['closed','cancelled'].includes(task.status));
    const loginTask=operation?.tabId===input.id&&executing&&tasks.get(executing.operationId);
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
        if(!operation.recovering&&loginTask){await cancel(loginTask);return;}
        await login.cancel('restore-original');runtimeChanged();return;
      }
    }
    const task = tasks.get(input.id)||pageTask||loginTask; if (!task) return;
    if(input.type==='retry') {
      if(!['failed','cancelled','closed'].includes(task.status))return;
      const previous = games.tabs.find(t=>t.id===task.tabId);
      if(previous){
        if(!['failed','crashed'].includes(previous.state))return;
        if(previous.region==='br'&&!fixture){enqueueRecovery(previous);}
        else games.refresh(previous.id);
        paint();return;
      }
      task.status='queued';queue.push(task);void executeNext();paint();return;
    }
    if (input.type === 'cancel') await cancel(task,page?.id??task.tabId);
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
    { label: resolveText(msg('ui.quit_all_games')), accelerator:'CmdOrCtrl+Q', click: () => { void shutdown(); } }
  ] }, { id:'naruto-edit', label:resolveText(msg('ui.edit')), submenu:[{label:resolveText(msg('ui.cut')),role:'cut'},{label:resolveText(msg('ui.copy')),role:'copy'},{label:resolveText(msg('ui.paste')),role:'paste'},{label:resolveText(msg('ui.select_all')),role:'selectAll'}] }]));
  }
  updateMenu();
  const hostReady = { ready: false };
  function handleUpdateHandoffSignal() {
    if (!updateHandoffPending) return;
    // Replaying before the first successful poll would start shutdown before the
    // host instance is registered, and the core would reject its close acknowledgement.
    if (!hostReady.ready) return;
    updateHandoffPending = false;
    if (updateHandoffRequested || exitState === 'closed') return;
    updateHandoffRequested = true;
    hostEvent('update-handoff-requested');
    void reportUpdateHandoff('confirming');
    void shutdown();
  }
  // Clear disk cache before the poll timer can register game tasks or open tabs.
  await clearLocalizationCacheOnce();
  // The interval must exist before an early SIGUSR2 replay can reach
  // performShutdown(), which clears it synchronously when no dialog is shown.
  let interval = setInterval(() => void poll(), 500);
  process.on('SIGUSR2', handleUpdateHandoffSignal);
  function shutdown(): Promise<void> {
    if(exitState==='closed')return Promise.resolve();
    if(exitAttempt)return exitAttempt;
    const attempt=performShutdown();exitAttempt=attempt;
    void attempt.finally(()=>{if(exitAttempt===attempt)exitAttempt=undefined});
    return attempt;
  }
  async function performShutdown() {
    if(exitState==='running'){
      shutting=true;exitState='confirming';
      if(!fixture && games.tabs.length){
        const answer=await dialog.showMessageBox({message:resolveText(msg('ui.quit_all_games_173')),buttons:[resolveText(msg('common.cancel')),resolveText(msg('ui.quit'))],cancelId:0});
        if(answer.response!==1){exitState='running';shutting=false;exitGuard.clear();paint();if(updateHandoffRequested)void reportUpdateHandoff('cancelled').then(()=>{updateHandoffRequested=false});return;}
      }
    }
    shutting=true;exitState='saving';clearInterval(interval);paint();
    if(updateHandoffRequested)void reportUpdateHandoff('saving');
    if (typeof setTimeout === 'function') exitGuard.arm(() => exitState);
    try {
      if(!exitPrepared){
        persist();
        for(const task of tasks.values())if(!['closed','cancelled'].includes(task.status))task.status='cancelled';
        queue.length=0;recoveryQueue.length=0;pendingSave=undefined;
        await Promise.all([login.close(),...Array.from(loginPages.values(),page=>page.close())]);games.destroy();await executionIdle;
        exitPrepared=true;
      }
      await sessions.flush();
      try{await core('host.closed',{instance});}catch{/* A dead host is reconciled on the next connection. */}
      if(updateHandoffRequested)await reportUpdateHandoff('closed');
      exitState='closed';app.exit(0);
    }catch{
      exitState='save-failed';exitGuard.clear();report(msg('ui.session_has_not_been_saved_retry_saving'));
      if(updateHandoffRequested)void reportUpdateHandoff('save-failed').then(()=>{updateHandoffRequested=false});
      if(!fixture)void dialog.showMessageBox({type:'error',message:resolveText(msg('ui.session_has_not_been_saved')),detail:resolveText(msg('ui.check_keychain_access_then_click_retry_save')),buttons:[resolveText(msg('ui.keep_window_open'))]});
    }
  }
  win.on('close',event=>{if(exitState!=='closed'){event.preventDefault();void shutdown();}});
  app.on('before-quit',event=>{if(exitState!=='closed'){event.preventDefault();void shutdown();}});
  app.on('second-instance', () => { win.show(); win.focus(); });
  app.on('activate', () => { win.show(); win.focus(); });
  await poll();
  hostReady.ready = true;
  handleUpdateHandoffSignal();
  if (fixture) {
    const timer = setInterval(async () => {
      const status: any = { appName:app.getName(), packaged:app.isPackaged, executable:app.getPath('exe'), pid: process.pid, instance, exitState, sessionMarkers: {}, tasks: Array.from(tasks.values()).map(t => ({ operationId: t.operationId, profileId: t.profileId, status: t.status })), ticks: {}, quality: {}, activeProfile: games.active?.profileId || null, window: { trafficLights: measureTrafficLights(win), bounds: win.getBounds(), contentBounds: win.getContentBounds(), settingsMenu: !!Menu.getApplicationMenu()?.items[0]?.submenu?.items.some(item => item.label === resolveText(msg('ui.settings'))) } };
      if(process.env.NARUTO_C_UI_CHECKS==='i18n')status.interface=await win.webContents.executeJavaScript("({language:document.documentElement.lang,settings:document.getElementById('settings').getAttribute('aria-label'),text:document.body.innerText})");
      if(fixtureEntry){
        status.loginTabs=visibleTabs().map(t=>({profile:t.profileId,active:t.active,visible:loginPages.get(t.id)?.loginViewVisible,status:t.status}));
        status.notice=await win.webContents.executeJavaScript("document.getElementById('notice').textContent");
        if(fs.existsSync(path.join(root,'fixture-mute'))){fs.unlinkSync(path.join(root,'fixture-mute'));await win.webContents.executeJavaScript("document.getElementById('mute').click()");}
      }
      const cookieFile=path.join(root,'fixture-session-cookie');
      const cookieTab=games.tabs.find(tab=>tab.profileId==='br-1')||games.active;
      if(fs.existsSync(cookieFile)&&cookieTab){
        fs.unlinkSync(cookieFile);await cookieTab.profile!.session.cookies.set({url:'https://fixture.invalid',name:'exit-retry',value:'synthetic-exit-retry',httpOnly:true});
      }
      for (const tab of games.tabs) try {
        status.sessionMarkers[tab.profileId!]=(await tab.profile!.session.cookies.get({url:'https://fixture.invalid',name:'exit-retry'}))[0]?.value||null;
        status.ticks[tab.profileId!] = await tab.view.webContents.executeJavaScript('Number(document.getElementById("ticks")?.textContent || 0)');
        status.quality[tab.profileId!] = await tab.view.webContents.executeJavaScript('document.getElementById("flash")?.readQuality?.() ?? null');
      } catch { /* A fixture tab may have just closed. */ }
      status.toolbar=await win.webContents.executeJavaScript('({tabCount:document.querySelectorAll(".tab").length,retryExitVisible:!document.getElementById("retry-exit").hidden&&!document.getElementById("retry-exit").disabled})');
      if(fs.existsSync(path.join(root,'fixture-open-center'))){fs.unlinkSync(path.join(root,'fixture-open-center'));await openCenter();}
      const focusFile=path.join(root,'fixture-focus');
      if(fs.existsSync(focusFile)){
        const id=fs.readFileSync(focusFile,'utf8');fs.unlinkSync(focusFile);
        if(/^(br|cn)-[1-9][0-9]*$/.test(id))await win.webContents.executeJavaScript(`document.querySelector('[data-profile-id="${id}"] .tab-select')?.click()`);
      }
      fs.writeFileSync(path.join(root, 'fixture-status.json'), JSON.stringify(status), { mode: 0o600 });
      if (fs.existsSync(path.join(root, 'fixture-stop'))) { fs.unlinkSync(path.join(root,'fixture-stop')); void shutdown(); }
    }, 500);
  }
}
