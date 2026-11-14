import { app, BrowserWindow, ipcMain, Menu, dialog, nativeTheme, screen } from 'electron';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { ConfigStore, newTab } from './config';
import { AccountProfile, AccountProfileStore, AccountProfiles } from './account-profiles';
import { CredentialVault, keychainTransport } from './credentials';
import { findFlash } from './flash';
import { GameSessions, GameTab } from './game';
import { LoginSessions } from './login-sessions';
import { WebLogin } from './web-login';
import { Navigation } from './navigation';
import { credentialOrigin, manualCredentialSite, manualCredentialSiteOptions, savePromptDestination } from './policy';
import { AppState, Command, Layout, Preferences, TabInfo, CHROME_HEIGHT, SAVE_PROMPT_HEIGHT, RECOVERY_PROMPT_HEIGHT, RecoveryStage, validRegion } from '../shared/model';
import { attachTrafficLights } from './traffic-lights';
import { validTheme, validTitleColor } from '../shared/appearance';

const root = path.resolve(__dirname, '../..');
const testLoginFixture = (() => {
  const value = process.env.NARUTO_TEST_LOGIN_FIXTURE_URL;
  if (!value) return undefined;
  if (process.env.NARUTO_TEST_MODE !== '1') throw new Error('login fixture requires isolated test mode');
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('login fixture must use loopback HTTP');
  return url.href;
})();
// Keep Chromium under the OS/system proxy by default. The explicit direct-test
// launcher uses per-Session direct:// rules; a process-wide switch would defeat routing.
app.setName('Naruto OS');
if (process.env.NARUTO_DATA_DIR) app.setPath('userData', path.resolve(process.env.NARUTO_DATA_DIR));
const config = new ConfigStore(app.getPath('userData'));
let layout = config.read();
nativeTheme.themeSource = layout.preferences.theme;
const flash = findFlash(root, layout.preferences.flash);
if (flash.available) {
  app.commandLine.appendSwitch('ppapi-flash-path', flash.path);
  app.commandLine.appendSwitch('ppapi-flash-version', flash.version);
}
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const vault = new CredentialVault(keychainTransport(path.join(root, 'dist/native/keychain'),
  process.env.NARUTO_TEST_MODE === '1' ? 'cn.youye.naruto-os.test.integration' : undefined));
const loginSessions = new LoginSessions(keychainTransport(path.join(root, 'dist/native/keychain'),
  process.env.NARUTO_TEST_MODE === '1'
    ? `cn.youye.naruto-os.test.sessions.${createHash('sha256').update(app.getPath('userData')).digest('hex').slice(0, 16)}`
    : 'cn.youye.naruto-os.sessions'), () => { log('LOGIN_STATE_SAVE_FAILED'); report('登录状态保存或读取失败，下次可能需要重新登录'); });
const accountProfiles = new AccountProfiles(new AccountProfileStore(app.getPath('userData')), app.getPath('userData'), () => loginSessions.listStoredPartitions());
let win: BrowserWindow;
let games: GameSessions;
let navigation: Navigation;
let webLogin: WebLogin;
let settingsOpen = false;
let modalOpen = false;
let profilePickerOpen = false;
let profilePickerIntent: 'select' | 'open' = 'select';
let notice = '';
let noticeTimer: NodeJS.Timeout | undefined;
let shuttingDown = false;
const deletingProfiles = new Map<string, string>();
let refreshMenuItem: Electron.MenuItem | undefined;
let closeMenuItem: Electron.MenuItem | undefined;
let quitApproved = false;
let confirming = false;
type Pending = { origin: string; username: string; password: string; expires: number; update: boolean; ready: boolean; checked: boolean };
const pending = new Map<string, Pending>();
const candidates = new Map<string, { origin: string; ids: string[]; expires: number }>();
const queries = new Map<string, number>();
const nativeCredentialOffers = new Map<string, { origin: string; ids: string[]; expires: number }>();
let latestNativeCredentialRequest = '';

function log(code: string) {
  // Deliberately structured: never log URLs, web errors, form contents, or credentials.
  try { const file = path.join(app.getPath('userData'), 'errors.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 256 * 1024) fs.writeFileSync(file, '', { mode: 0o600 });
    fs.appendFileSync(file, `${new Date().toISOString()} ${code}\n`, { mode: 0o600 });
  } catch { /* logging must not prevent gameplay */ }
}
function report(message: string) {
  notice = message;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice = ''; broadcast(); }, 6000); broadcast();
}
async function discoverProfiles(retry = false) {
  try { await accountProfiles.discover(retry); } catch { /* State carries the user-facing retry message. */ }
  broadcast();
}
function profileTabsFor(id: string) { return games?.tabs.filter(tab => tab.profileId === id) ?? []; }
function profileDeletionBlockReason(profile: AccountProfile) {
  if (profileTabsFor(profile.id).length || webLogin?.operation?.profileId === profile.id || loginSessions.leaseCount(profile.region, profile.slot) > 0) {
    return '请先结束该档案的游戏标签或登录/恢复任务';
  }
  return '';
}
async function deleteProfile(id: string) {
  if (typeof id !== 'string' || !/^(br|cn)-[1-9]\d*$/.test(id)) throw new Error('账号档案无效');
  if (deletingProfiles.has(id)) throw new Error('该账号档案正在清理，请稍后重试');
  const profile = accountProfiles.get(id);
  if (!profile) throw new Error('账号档案已不存在');
  const blocked = profileDeletionBlockReason(profile);
  if (blocked) throw new Error(blocked);
  if (!accountProfiles.isPendingDelete(id)) {
    accountProfiles.beginDelete(id);
    changed();
  }
  deletingProfiles.set(id, '准备清理');
  changed();
  try {
    await loginSessions.clearProfile(profile.region, profile.slot, stage => {
      deletingProfiles.set(id, stage); broadcast();
    });
    accountProfiles.completeDelete(id);
    deletingProfiles.delete(id);
    changed();
    report(`已删除账号档案“${profile.name}”`);
  } catch (error) {
    deletingProfiles.delete(id);
    changed();
    throw error;
  }
}
function focusWindow() {
  if (!win || win.isDestroyed() || process.env.NARUTO_TEST_HIDDEN === '1') return;
  win.show(); win.focus();
}
function focusGameTab(id: string) {
  profilePickerOpen = false; modalOpen = false; settingsOpen = false;
  navigation.selectGame(id); focusWindow(); broadcast();
}
function focusLoginTab(id: string) {
  profilePickerOpen = false; modalOpen = false; settingsOpen = false;
  navigation.selectLogin(id); broadcast(); webLogin.focus(); focusWindow();
}
function focusProfile(profile: AccountProfile) {
  const operation = webLogin?.operation;
  const candidate = operation?.candidateId ? games.tabs.find(tab => tab.id === operation.candidateId) : undefined;
  const original = operation?.originalId ? games.tabs.find(tab => tab.id === operation.originalId) : undefined;
  const operationProfileId = webLogin?.tabInfo?.profileId ?? candidate?.profileId ?? original?.profileId;
  if (operation && operationProfileId === profile.id) {
    accountProfiles.select(profile.id);
    if (candidate) focusGameTab(candidate.id);
    else focusLoginTab(operation.tabId);
    return 'focused';
  }
  const tab = profileTabsFor(profile.id).find(item => !item.recoveryStage) ?? profileTabsFor(profile.id)[0];
  if (tab) {
    accountProfiles.select(profile.id); focusGameTab(tab.id); return 'focused';
  }
  if (webLogin?.busy) { report('另一个账号正在登录或恢复，请先完成或取消当前流程'); return 'busy'; }
  return 'none';
}
function openProfile(profile: AccountProfile): boolean {
  if (shuttingDown || !win || win.isDestroyed()) return false;
  if (accountProfiles.isPendingDelete(profile.id)) { report('该账号档案清理未完成，请在设置中重试清理'); return false; }
  const focused = focusProfile(profile);
  if (focused !== 'none') return focused === 'focused';
  try {
    const saved = { ...newTab(profile.region), name: '', profileId: profile.id };
    profilePickerOpen = false; modalOpen = false; settingsOpen = false;
    accountProfiles.select(profile.id);
    if (profile.region === 'br' && (process.env.NARUTO_TEST_MODE !== '1' || process.env.NARUTO_TEST_MANUAL_LOGIN === '1')) {
      navigation.selectLogin(saved.id);
      void webLogin.open(saved, profile.slot);
    }
    else {
      const tab = games.create(saved, undefined, undefined, profile.slot);
      navigation.selectGame(tab.id); focusWindow();
    }
    broadcast();
    return true;
  } catch (error) {
    report(error instanceof Error ? error.message : '无法打开该账号档案，请重试');
    return false;
  }
}
function startSelectedProfile(): boolean {
  const selected = accountProfiles.selected(layout.preferences.region);
  const profile = selected ? accountProfiles.get(selected) : undefined;
  if (!profile) {
    profilePickerIntent = 'select'; profilePickerOpen = true; modalOpen = true; void discoverProfiles(); broadcast(); return false;
  }
  if (accountProfiles.isPendingDelete(profile.id)) { report('该账号档案清理未完成，请在设置中重试清理'); return false; }
  return openProfile(profile);
}
function visibleActiveId(): string | null {
  const snapshot = navigation?.snapshot(webLogin?.operation?.tabId);
  return snapshot && snapshot.target.kind !== 'home' ? snapshot.target.id : null;
}
function tabInfos(): TabInfo[] {
  const operation = webLogin?.operation;
  const withProfileName = (tab: GameTab): TabInfo => {
    const profile = tab.profileId ? accountProfiles.get(tab.profileId) : undefined;
    return { id: tab.id, name: tab.name, region: tab.region, state: tab.state, title: tab.title,
      ...(tab.profileId ? { profileId: tab.profileId } : {}), ...(profile ? { profileName: profile.name } : {}),
    ...(operation?.candidateId === tab.id ? { recoveryStage: operation.stage } : {}),
      ...(operation?.originalId === tab.id && operation.stage !== 'confirming' ? { closeDisabled: true } : {}) };
  };
  const tabs = (games?.tabs ?? []).map(withProfileName);
  const loginTab = webLogin?.tabInfo;
  if (loginTab && !tabs.some(tab => tab.id === loginTab.id)) {
    const profile = loginTab.profileId ? accountProfiles.get(loginTab.profileId) : undefined;
    tabs.push({ ...loginTab, ...(profile ? { profileName: profile.name } : {}) });
  }
  return tabs;
}
function refreshState(): AppState['refresh'] {
  const operation = webLogin?.operation;
  if (navigation?.isObscured || shuttingDown) return { enabled: false, label: operation?.stage === 'loading' ? '正在重新进入…' : '刷新当前页面' };
  if (operation && navigation.isLoginForeground(operation.tabId, operation) && operation.stage === 'login') {
    return { enabled: true, label: '刷新登录/选服页面' };
  }
  const tab = games?.tabs.find(item => item.id === games?.activeId);
  if (!tab) return { enabled: false, label: '刷新当前页面' };
  if (tab.recoveryStage) return { enabled: false, label: tab.recoveryStage === 'loading' ? '正在重新进入…' : '等待确认新游戏' };
  return tab.region === 'br' ? { enabled: true, label: '重新进入游戏' } : { enabled: true, label: '刷新当前页面' };
}
function saveLayout(): boolean {
  if (!games || shuttingDown || !win || win.isDestroyed()) return false;
  layout = { ...layout, tabs: tabInfos().map(({ id, name, region, profileId }) => ({ id, name, region, ...(profileId ? { profileId } : {}) })), activeId: visibleActiveId(),
    bounds: win.getNormalBounds(), maximized: win.isMaximized(), fullscreen: win.isFullScreen() };
  try { config.write(layout); return true; } catch { log('CONFIG_WRITE_FAILED'); report('布局保存失败，请检查磁盘空间'); return false; }
}
function saveLobbyPreference<K extends 'lobbyBackground' | 'lobbyMotion'>(key: K, value: Preferences[K]) {
  const previous = layout.preferences[key];
  layout.preferences[key] = value;
  if (!saveLayout()) { layout.preferences[key] = previous; broadcast(); return false; }
  broadcast(); return true;
}
function state(): AppState {
  const active = visibleActiveId();
  const item = active ? pending.get(active) : undefined;
  const prompt = item?.ready && item.expires > Date.now() ? { tabId: active!, username: item.username, origin: item.origin, update: item.update } : null;
  const operation = webLogin?.operation;
  const recovery = operation?.recovering && operation.stage === 'confirming' && operation.originalId && operation.candidateId && active === operation.candidateId
    ? { originalId: operation.originalId, candidateId: operation.candidateId } : null;
  return { tabs: tabInfos(), activeId: active, preferences: layout.preferences, settingsOpen, prompt, recovery,
    refresh: refreshState(), flash, notice,
    profiles: accountProfiles.list().map(({ id, region, slot, name, serverNote }) => ({
      id, region, name, serverNote, identityNeedsConfirmation: name === `历史登录槽位${slot}`,
      cleanupStatus: deletingProfiles.has(id) ? 'deleting' as const : accountProfiles.isPendingDelete(id) ? 'pending' as const : null,
      cleanupStage: deletingProfiles.get(id) ?? '',
      deleteBlockedReason: profileDeletionBlockReason({ id, region, slot, name, serverNote })
    })),
    selectedProfileId: accountProfiles.selected(layout.preferences.region), profileDiscovery: accountProfiles.status,
    profileError: accountProfiles.error, canCreateProfile: accountProfiles.canCreate,
    profilePickerOpen, profilePickerIntent };
}
function broadcast() {
  if (!win || win.isDestroyed() || !games) return;
  navigation.syncOperation(webLogin?.operation?.tabId);
  navigation.syncOverlay(settingsOpen, modalOpen);
  // Navigation can leave the credential origin before the next form scan.
  // Drop unrelated/expired submissions and recompute the UI and viewport together.
  for (const [id, item] of pending) {
    const tab = games.tabs.find(tab => tab.id === id);
    if (item.expires <= Date.now() || !tab || tab.view.webContents.isDestroyed() || !savePromptDestination(item.origin, tab.view.webContents.getURL())) pending.delete(id);
  }
  const nextState = state();
  games.top = CHROME_HEIGHT + (!settingsOpen && nextState.prompt ? SAVE_PROMPT_HEIGHT : 0) + (!settingsOpen && nextState.recovery ? RECOVERY_PROMPT_HEIGHT : 0);
  const operation = webLogin?.operation;
  const loginVisible = !!operation && operation.stage === 'login' && navigation.isLoginForeground(operation.tabId, operation);
  webLogin?.hide(!loginVisible);
  games.layout(); win.webContents.send('shell:state', nextState);
  updateMenuItems(nextState);
}
function changed() { if (!shuttingDown) { broadcast(); saveLayout(); } }
function assertShell(event: Electron.IpcMainInvokeEvent) {
  if (!win || event.sender !== win.webContents || event.sender.getURL() !== shellURL) throw new Error('无效的界面请求');
}
function assertGame(event: Electron.IpcMainInvokeEvent, origin: unknown): GameTab {
  const tab = games.fromSender(event.sender.id);
  if (!tab || tab.id !== games.activeId || settingsOpen || typeof origin !== 'string' || credentialOrigin(event.sender.getURL()) !== origin) throw new Error('无效的网站请求');
  return tab;
}
function safeHandler(channel: string, handler: (event: Electron.IpcMainInvokeEvent, input: any) => any) {
  ipcMain.handle(channel, async (event, input) => {
    try { return { ok: true, value: await handler(event, input) }; }
    catch (error) {
      const message = error instanceof Error ? error.message : '操作失败，请重试';
      // Only fixed local messages are returned, never serialized exceptions or records.
      log(`${channel.replace(/[^a-z:-]/g, '').toUpperCase()}_FAILED`);
      return { ok: false, message: message.length < 100 ? message : '操作失败，请重试' };
    }
  });
}
const shellURL = require('url').pathToFileURL(path.join(root, 'dist/renderer/index.html')).href as string;
safeHandler('shell:state', event => { assertShell(event); return state(); });
safeHandler('shell:command', async (event, input: Command) => { assertShell(event); return command(input); });
safeHandler('shell:credentials', event => { assertShell(event); return vault.list(); });
safeHandler('shell:credential-sites', event => {
  assertShell(event); if (!settingsOpen) throw new Error('请先打开设置');
  return manualCredentialSiteOptions();
});
safeHandler('shell:credential-add', (event, input) => {
  assertShell(event);
  if (!settingsOpen || !input || typeof input.siteId !== 'string' || typeof input.username !== 'string' || typeof input.password !== 'string') throw new Error('账号信息无效');
  const site = manualCredentialSite(input.siteId);
  if (!site) throw new Error('登录站点无效');
  const expected = input.expected;
  if (expected !== undefined && (!expected || typeof expected.id !== 'string' || typeof expected.version !== 'string')) throw new Error('确认信息无效，请重新操作');
  return vault.addManual(site.origin, input.username, input.password, expected);
});
safeHandler('shell:reveal', (event, id: string) => { assertShell(event); if (!settingsOpen || typeof id !== 'string') throw new Error('请先打开设置'); return vault.reveal(id); });
safeHandler('shell:edit', async (event, input) => {
  assertShell(event); if (!settingsOpen || !input || typeof input.id !== 'string' || typeof input.username !== 'string' || typeof input.password !== 'string') throw new Error('账号信息无效');
  const item = (await vault.list()).find(item => item.id === input.id); if (!item) throw new Error('账号已不存在');
  await vault.save(item.origin, input.username, input.password, item.id);
});
safeHandler('shell:remove', (event, id) => { assertShell(event); if (!settingsOpen || typeof id !== 'string') throw new Error('请先打开设置'); return vault.remove(id); });
safeHandler('game:candidates', async (event, input) => {
  const tab = assertGame(event, input?.origin);
  if (typeof input.query !== 'string' || input.query.length > 320) throw new Error('账号信息无效');
  const generation = tab.generation;
  const sequence = (queries.get(tab.id) ?? 0) + 1; queries.set(tab.id, sequence);
  const records = await vault.list(input.origin, input.query);
  if (queries.get(tab.id) !== sequence || generation !== tab.generation || tab.id !== games.activeId || !games.tabs.includes(tab)) return [];
  candidates.set(tab.id, { origin: input.origin, ids: records.map(r => r.id), expires: Date.now() + 30000 });
  return records;
});
safeHandler('game:choose', async (event, input) => {
  const tab = assertGame(event, input?.origin); const offered = candidates.get(tab.id);
  if (!offered || offered.expires < Date.now() || offered.origin !== input.origin || !offered.ids.includes(input.id)) throw new Error('请重新选择账号');
  candidates.delete(tab.id); const generation = tab.generation;
  const record = await vault.selected(input.id, input.origin);
  if (!record || generation !== tab.generation || tab.id !== games.activeId || credentialOrigin(event.sender.getURL()) !== input.origin) throw new Error('页面已变化，请重新选择');
  return { username: record.username, password: record.password };
});
safeHandler('game:submit', async (event, input) => {
  const tab = assertGame(event, input?.origin);
  if (typeof input.username !== 'string' || typeof input.password !== 'string' || !input.username.trim() || !input.password || input.username.length > 320 || input.password.length > 4096) return;
  // Stage before awaiting the keychain: a normal form navigation can happen while
  // it is being read. A newer submission or a closed tab invalidates this object.
  const submission: Pending = { origin: input.origin, username: input.username.trim(), password: input.password,
    expires: Date.now() + 120000, update: false, ready: false, checked: false };
  pending.set(tab.id, submission);
  broadcast();
  try {
    const result = await vault.needsSave(input.origin, submission.username, submission.password);
    if (pending.get(tab.id) !== submission) return;
    if (!result.needed || !games.tabs.includes(tab) || tab.view.webContents.isDestroyed() || !savePromptDestination(submission.origin, event.sender.getURL())) { pending.delete(tab.id); broadcast(); return; }
    submission.update = result.update; submission.checked = true;
  } catch (error) { if (pending.get(tab.id) === submission) { pending.delete(tab.id); broadcast(); } throw error; }
});
safeHandler('game:form-state', (event, input) => {
  const tab = games.fromSender(event.sender.id);
  if (!tab || typeof input?.hasPassword !== 'boolean') return;
  const item = pending.get(tab.id);
  if (item && (item.expires <= Date.now() || !savePromptDestination(item.origin, event.sender.getURL()))) { pending.delete(tab.id); broadcast(); }
  else if (item?.checked && !item.ready && !input.hasPassword && tab.state === 'ready') { item.ready = true; broadcast(); }
});

async function command(input: Command) {
  if (!input || typeof input !== 'object') return;
  switch (input.type) {
    case 'new': {
      if (shuttingDown) break;
      profilePickerIntent = 'open'; profilePickerOpen = true; modalOpen = true;
      broadcast(); void discoverProfiles(); break;
    }
    case 'profile-start': return startSelectedProfile();
    case 'profiles-picker':
      profilePickerIntent = 'select'; profilePickerOpen = true; modalOpen = true;
      broadcast(); void discoverProfiles(); break;
    case 'profiles-close-picker': profilePickerOpen = false; modalOpen = false; broadcast(); break;
    case 'profiles-retry': void discoverProfiles(true); break;
    case 'profile-select': {
      const profile = accountProfiles.get(input.id);
      if (!profile || profile.region !== layout.preferences.region || accountProfiles.isPendingDelete(profile.id)) break;
      accountProfiles.select(profile.id); profilePickerOpen = false; modalOpen = false; changed(); break;
    }
    case 'profile-open': {
      const profile = accountProfiles.get(input.id);
      if (!profile || profile.region !== layout.preferences.region) break;
      openProfile(profile); break;
    }
    case 'profile-create': {
      if (!validRegion(layout.preferences.region)) break;
      const profile = accountProfiles.create(layout.preferences.region, input.name, input.serverNote);
      profilePickerOpen = false; modalOpen = false; changed(); report(`已创建账号档案“${profile.name}”`); break;
    }
    case 'profile-update': {
      const profile = accountProfiles.update(input.id, input.name, input.serverNote);
      changed(); report(`已保存账号档案“${profile.name}”`); break;
    }
    case 'profile-delete': await deleteProfile(input.id); break;
    case 'region': if (validRegion(input.value)) { layout.preferences.region = input.value; changed(); } break;
    case 'home': profilePickerOpen = false; modalOpen = false; settingsOpen = false; navigation.selectHome(); win.webContents.focus(); broadcast(); break;
    case 'select': if (!navigation.isObscured && typeof input.id === 'string') {
      const operation = webLogin.operation;
      if (operation?.tabId === input.id && !games.tabs.some(tab => tab.id === input.id)) focusLoginTab(input.id);
      else if (games.tabs.some(tab => tab.id === input.id)) focusGameTab(input.id);
    } break;
    case 'close': if (typeof input.id === 'string') {
      if (navigation.isObscured) break;
      if (games.activeId === input.id) navigation.closeGame(input.id);
      const operation = webLogin.operation;
      const isTaskTab = operation?.tabId === input.id && !games.tabs.some(tab => tab.id === input.id);
      if (isTaskTab || operation?.candidateId === input.id) {
        void webLogin.cancel('restore-original');
        navigation.clearLoginTask(input.id);
        break;
      }
      if (operation?.originalId === input.id) {
        if (operation.stage === 'confirming') webLogin.completeRecovery(operation.candidateId!);
        else report('请先取消恢复，再关闭原游戏');
        break;
      }
      pending.delete(input.id); candidates.delete(input.id); queries.delete(input.id);
      if (games.tabs.some(tab => tab.id === input.id)) {
        games.close(input.id, { deferDestroy: true });
      } else changed();
    } break;
    case 'rename': { const tab = games.tabs.find(t => t.id === input.id); if (tab && typeof input.name === 'string') { tab.name = input.name.trim().slice(0, 40); changed(); } break; }
    case 'refresh': {
      const status = refreshState();
      if (!status.enabled) break;
      const operation = webLogin.operation;
      if (operation?.stage === 'login' && navigation.isLoginForeground(operation.tabId, operation)) { webLogin.refresh(); break; }
      const tab = games.tabs.find(item => item.id === games.activeId);
      if (!tab) break;
      if (webLogin.busy && tab.region === 'br') { report('另一个账号正在登录或恢复，请先完成或取消当前流程'); break; }
      pending.delete(tab.id); candidates.delete(tab.id); queries.delete(tab.id);
      if (tab.region === 'br') {
        try {
          void webLogin.recover(tab);
          broadcast();
        } catch (error) { report(error instanceof Error ? error.message : '重新获取游戏入口未完成，请重试'); }
      }
      else games.refresh(tab.id);
      break;
    }
    case 'complete-recovery': if (typeof input.id === 'string') webLogin.completeRecovery(input.id); break;
    case 'cancel-recovery': if (typeof input.id === 'string') await webLogin.cancelRecovery(input.id); break;
    case 'mute': layout.preferences.muted = !layout.preferences.muted; games.muted = layout.preferences.muted; games.syncAudio(); changed(); break;
    case 'settings':
      if (profilePickerOpen) { profilePickerOpen = false; modalOpen = false; }
      settingsOpen = !settingsOpen;
      broadcast(); if (settingsOpen) { win.webContents.focus(); void discoverProfiles(); } break;
    case 'overlay': modalOpen = input.shown === true; broadcast(); if (modalOpen) win.webContents.focus(); break;
    case 'theme':
      if (validTheme(input.value)) { layout.preferences.theme = input.value; nativeTheme.themeSource = input.value; changed(); } break;
    case 'title-color':
      if (input.value === null || validTitleColor(input.value)) { layout.preferences.titleBarColor = input.value?.toLowerCase() ?? null; changed(); } break;
    case 'lobby-background':
      if (input.value !== null && !validTitleColor(input.value)) throw new Error('启动页背景颜色无效');
      return saveLobbyPreference('lobbyBackground', input.value?.toLowerCase() ?? null);
    case 'lobby-motion':
      if (typeof input.value !== 'boolean') throw new Error('启动页动态效果设置无效');
      return saveLobbyPreference('lobbyMotion', input.value);
    case 'flash':
      if (input.version === '34' || input.version === '31') {
        if (!findFlash(root, input.version).available) { report('该版本组件尚未准备，请运行开发环境准备脚本'); break; }
        layout.preferences.flash = input.version; changed(); report('Flash 偏好已保存，下次启动生效');
      } break;
    case 'dismiss-prompt': if (games.activeId) pending.delete(games.activeId); broadcast(); break;
    case 'save-password': {
      const id = games.activeId; const item = id ? pending.get(id) : undefined;
      if (!item || !item.ready || item.expires < Date.now()) { if (id) pending.delete(id); broadcast(); return; }
      await vault.save(item.origin, item.username, item.password);
      pending.delete(id!); broadcast(); report('账号已保存到 macOS 钥匙串'); break;
    }
  }
}
function menu() {
  const perform = (type: Command['type']) => () => { void command({ type } as Command).catch(() => report('操作失败，请重试')); };
  const switchTab = (offset: number) => () => {
    const tabs = tabInfos(); const index = tabs.findIndex(t => t.id === visibleActiveId());
    if (tabs.length) { const next = index < 0 ? (offset > 0 ? 0 : tabs.length - 1) : (index + offset + tabs.length) % tabs.length; void command({ type: 'select', id: tabs[next].id }); }
  };
  const applicationMenu = Menu.buildFromTemplate([
    { label: 'Naruto OS', submenu: [{ role: 'about' }, { type: 'separator' }, { label: '设置…', accelerator: 'CmdOrCtrl+,', click: perform('settings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { label: '游戏', submenu: [
      { label: '启动页', accelerator: 'CmdOrCtrl+Shift+H', click: perform('home') },
      { label: '新建标签', accelerator: 'CmdOrCtrl+T', click: perform('new') },
      { id: 'close-current-tab', label: '关闭标签', accelerator: 'CmdOrCtrl+W', click: () => { const id = visibleActiveId(); if (id) void command({ type: 'close', id }); } },
      { id: 'refresh-current-tab', label: '刷新当前页面', accelerator: 'CmdOrCtrl+R', click: perform('refresh') },
      { label: '开发者工具（Network）', accelerator: 'F2', click: () => games.toggleDeveloperTools() },
      { label: '总静音', accelerator: 'CmdOrCtrl+Shift+M', click: perform('mute') },
      { type: 'separator' }, { label: '下一个标签', accelerator: 'Ctrl+Tab', click: switchTab(1) },
      { label: '上一个标签', accelerator: 'Ctrl+Shift+Tab', click: switchTab(-1) },
      ...Array.from({ length: 9 }, (_, i) => ({ label: `切换到标签 ${i + 1}`, accelerator: `CmdOrCtrl+${i + 1}`, click: () => { const tabs = tabInfos(); const tab = tabs[i === 8 ? tabs.length - 1 : i]; if (tab) void command({ type: 'select', id: tab.id }); } }))
    ] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'togglefullscreen' }, { type: 'separator' }, { label: '关闭窗口', accelerator: 'CmdOrCtrl+Shift+W', click: () => win.close() }] }
  ]);
  Menu.setApplicationMenu(applicationMenu);
  refreshMenuItem = applicationMenu.getMenuItemById('refresh-current-tab') ?? undefined;
  closeMenuItem = applicationMenu.getMenuItemById('close-current-tab') ?? undefined;
  updateMenuItems();
}
function updateMenuItems(current = state()) {
  if (refreshMenuItem) { refreshMenuItem.label = current.refresh.label; refreshMenuItem.enabled = current.refresh.enabled; }
  if (closeMenuItem) {
    const id = visibleActiveId();
    const active = id ? tabInfos().find(tab => tab.id === id) : undefined;
    closeMenuItem.enabled = !settingsOpen && !modalOpen && !!id && !active?.closeDisabled;
  }
}
async function createWindow() {
  const restoreMaximized = layout.maximized;
  const restoreFullscreen = layout.fullscreen;
  const b = layout.bounds;
  if (!screen.getAllDisplays().some(d => b.x !== undefined && b.y !== undefined && b.x < d.workArea.x + d.workArea.width && b.x + b.width > d.workArea.x && b.y < d.workArea.y + d.workArea.height && b.y + b.height > d.workArea.y)) { delete b.x; delete b.y; }
  win = new BrowserWindow({ ...b, minWidth: 800, minHeight: 560, title: 'Naruto OS', titleBarStyle: 'hidden', trafficLightPosition: { x: 14, y: 15 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#202020' : '#fafafa', show: false,
    webPreferences: { preload: path.join(root, 'dist/preload/shell.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, enableRemoteModule: false, webviewTag: false }
  });
  attachTrafficLights(win);
  const icon = path.join(root, 'assets/app-icon.png');
  if (fs.existsSync(icon)) app.dock?.setIcon(icon);
  else if (fs.existsSync(path.join(root, 'assets/character-icon-chibi.png'))) app.dock?.setIcon(path.join(root, 'assets/character-icon-chibi.png'));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.on('new-window', e => e.preventDefault());
  const qqProbe = process.env.NARUTO_TEST_PROBE === 'qq';
  const direct = process.env.NARUTO_DIRECT === '1';
  games = new GameSessions(win, changed, report, process.env.NARUTO_TEST_MODE === '1' ? 'about:blank' : qqProbe ? 'https://huoying.qq.com/server/website/' : undefined, direct, loginSessions, log);
  navigation = new Navigation(games);
  webLogin = new WebLogin(win, games, loginSessions, navigation, path.join(root, 'dist/native/embedded-login.node'), report,
    testLoginFixture ? { fixture: testLoginFixture, visible: true } : undefined, changed, log, focusWindow, {
      list: async (requestId, origin, query) => {
        latestNativeCredentialRequest = requestId; nativeCredentialOffers.clear();
        if (typeof origin !== 'string' || credentialOrigin(origin) !== origin || typeof query !== 'string' || query.length > 320) throw new Error('invalid credential query');
        const items = await vault.list(origin, query);
        if (latestNativeCredentialRequest !== requestId) return [];
        nativeCredentialOffers.set(requestId, { origin, ids: items.map(item => item.id), expires: Date.now() + 30000 });
        return items.map(({ id, username }) => ({ id, username }));
      },
      select: async (requestId, origin, id) => {
        const offered = nativeCredentialOffers.get(requestId);
        if (!offered || offered.expires < Date.now() || offered.origin !== origin || !offered.ids.includes(id) || latestNativeCredentialRequest !== requestId) throw new Error('stale credential selection');
        nativeCredentialOffers.delete(requestId);
        const record = await vault.selected(id, origin);
        if (!record || latestNativeCredentialRequest !== requestId) throw new Error('credential no longer available');
        return { username: record.username, password: record.password };
      }
    });
  games.muted = layout.preferences.muted;
  nativeTheme.on('updated', () => {
    if (win.isDestroyed()) return;
    win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#202020' : '#fafafa');
    games.updateSurfaceTheme();
  });
  menu();
  win.on('resize', () => { games.layout(); saveLayout(); }); win.on('move', saveLayout);
  win.on('enter-full-screen', () => { win.webContents.send('shell:fullscreen', true); saveLayout(); });
  win.on('leave-full-screen', () => { win.webContents.send('shell:fullscreen', false); saveLayout(); });
  let savingSessions = false, sessionsSaved = false;
  win.on('close', event => {
    if (!quitApproved && games.tabs.length && process.env.NARUTO_TEST_MANUAL_ACCEPTANCE !== '1') {
      event.preventDefault(); if (confirming) return; confirming = true;
      void dialog.showMessageBox(win, { type: 'question', title: '结束游戏？', message: '退出 Naruto OS？', detail: '所有游戏会话都会结束。下次启动显示主页面，游戏需重新打开。', buttons: ['继续游戏', '退出'], defaultId: 0, cancelId: 0, noLink: true }).then(result => {
        confirming = false; if (result.response === 1) { quitApproved = true; win.close(); }
      });
      return;
    }
    if (!sessionsSaved) {
      event.preventDefault(); if (savingSessions) return; savingSessions = true;
      saveLayout(); shuttingDown = true; pending.clear(); candidates.clear(); games.destroy();
      void webLogin.close().then(() => loginSessions.flush()).catch(async () => {
        await dialog.showMessageBox(win, { type: 'warning', message: '登录状态未能保存', detail: '下次打开游戏可能需要重新登录。', buttons: ['关闭'], noLink: true });
      }).finally(() => { sessionsSaved = true; win.close(); });
    }
  });
  await win.loadURL(shellURL);
  // Every launch starts with home alone: do not restore tabs or guest sessions.
  navigation.selectHome(); if (restoreMaximized) win.maximize(); if (process.env.NARUTO_TEST_HIDDEN !== '1') win.show(); if (restoreFullscreen) win.setFullScreen(true); broadcast(); void discoverProfiles();
  if (!flash.available) report(app.isPackaged ? 'Flash 组件缺失，请重新获取完整应用' : 'Flash 组件尚未准备，请运行开发环境准备脚本');
  games.lifecycle.on('changed', context => { if (context.state === 'failed' || context.state === 'crashed') log('GAME_' + context.state.toUpperCase()); });
  if (process.env.NARUTO_TEST_MODE === '1' && process.env.NARUTO_TEST_MANUAL_PREVIEW !== '1') {
    const { runIntegration } = await import('./integration');
    void runIntegration(win, games, vault, root, code => {
      if (code) log('INTEGRATION_FAILED');
      process.exitCode = code;
      if (process.env.NARUTO_TEST_MANUAL_ACCEPTANCE !== '1') { quitApproved = true; win.close(); }
    }, webLogin);
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(createWindow).catch(() => { log('STARTUP_FAILED'); dialog.showErrorBox('Naruto OS 启动失败', app.isPackaged ? '请重新打开应用，错误记录保存在应用数据目录中。' : '请检查开发构建与运行组件，错误记录保存在独立数据目录中。'); app.exit(1); });
  app.on('window-all-closed', () => app.quit());
}
setInterval(() => { for (const [id, item] of pending) if (item.expires < Date.now()) { pending.delete(id); broadcast(); } }, 15000).unref();
