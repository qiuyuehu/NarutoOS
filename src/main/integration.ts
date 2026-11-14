// Opt-in, offline development checks. Uses a dedicated data dir and keychain service.
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { app, BrowserWindow, Menu, nativeTheme, session } from 'electron';
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { GameSessions, GameTab } from './game';
import { WebLogin } from './web-login';
import { CredentialVault } from './credentials';
import { ENTRY_URL } from './policy';
import { newTab } from './config';
import { measureTrafficLights } from './traffic-lights';
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean) { for (let i = 0; i < 200; i++) { if (check()) return; await pause(50); } throw new Error('integration-state-timeout'); }
async function untilUI(ui: (js: string) => Promise<any>, check: string) {
  for (let i = 0; i < 200; i++) { if (await ui(check)) return; await pause(50); }
  throw new Error('integration-ui-timeout');
}
function captureWithin<T>(capture: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    capture.then(value => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); resolve(undefined); });
  });
}
const origin = new URL(ENTRY_URL).origin;
const fixture = `<!doctype html><html><head><meta charset="utf-8"><title>Offline fixture</title><style>body{margin:0;background:#e8ede3;color:#38432f;font:16px sans-serif}main{padding:50px}form{display:grid;gap:12px;width:280px}input,button{padding:12px;font:inherit}h1{font-size:22px}p{font-size:13px}object{margin:0 auto}</style></head><body><main><h1>Naruto OS · 隔离验证页面</h1><p>合成账号 · 不连接游戏服务器</p><form method="post" action="/pt/fixture-success"><label>Conta<input name="username" id="username" autocomplete="username"></label><label>Senha<input name="password" id="password" type="password"></label><button type="submit">Entrar</button></form></main></body></html>`;
const success = `<!doctype html><html><head><meta charset="utf-8"><title>Flash fixture</title><style>body{margin:0;background:#202420;color:#dae1d3;text-align:center;font:14px sans-serif}p{margin:15px}</style></head><body><p>Flash 测试画面 · 绿色区域应由真实 PPAPI 插件渲染</p><object id="flash" type="application/x-shockwave-flash" data="/fixture.swf" width="600" height="300"><param name="movie" value="/fixture.swf"><param name="wmode" value="opaque"></object></body></html>`;
function swf(): Buffer {
  // A tiny authored SWF: a 400×200 stage, one green frame, no external resources.
  const bits = '01110' + [0, 8000, 0, 4000].map(v => v.toString(2).padStart(14, '0')).join('');
  const rect = Buffer.from((bits + '0'.repeat((8 - bits.length % 8) % 8)).match(/.{8}/g)!.map(v => parseInt(v, 2)));
  const body = Buffer.concat([rect, Buffer.from([0, 24, 1, 0, 0x43, 0x02, 100, 129, 90, 0x40, 0, 0, 0])]);
  const header = Buffer.alloc(8); header.write('FWS', 0); header[3] = 10; header.writeUInt32LE(body.length + 8, 4);
  return Buffer.concat([header, body]);
}
async function install(tab: GameTab) {
  // Direct mode configures each new session asynchronously before its first URL.
  // Let that navigation settle before replacing it with our offline fixture.
  if (tab.state === 'loading') await new Promise<void>(resolve => tab.view.webContents.once('did-stop-loading', () => resolve()));
  const installed = tab.view.webContents.session.protocol.interceptBufferProtocol('https', (request, callback) => {
      const url = new URL(request.url);
      if (url.pathname === '/fixture.swf') callback({ mimeType: 'application/x-shockwave-flash', data: swf() });
      else callback({ mimeType: 'text/html', data: Buffer.from(url.pathname === '/pt/fixture-success' ? success : fixture) });
    });
  assert(installed, 'fixture protocol installed');
  await tab.view.webContents.loadURL(ENTRY_URL);
}
async function recoveryFixtureTab(games: GameSessions) {
  const partition = `naruto-integration-recovery-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const profile = { partition, session: session.fromPartition(partition), ready: Promise.resolve(), release: () => {}, updateCookies: async () => {} };
  const tab = games.create(newTab('br'), ENTRY_URL, profile);
  await install(tab);
  return tab;
}
export async function runIntegration(win: BrowserWindow, games: GameSessions, vault: CredentialVault, root: string, finish: (code: number) => void, webLogin: WebLogin) {
  const watchdog = setTimeout(() => { console.error('Integration timeout'); finish(1); }, 90000);
  const directory = process.env.NARUTO_TEST_ARTIFACTS || path.join(root, '.test-artifacts'); fs.mkdirSync(directory, { recursive: true });
  const results: string[] = [];
  const skipped: string[] = [];
  const diagnostics: Record<string, unknown> = {};
  const check = (name: string, condition: unknown) => { assert(condition, name); results.push(name); console.log('PASS', name); };
  const skip = (name: string) => { skipped.push(name); console.log('SKIP', name); };
  const ui = (js: string) => win.webContents.executeJavaScript(js);
  const chooseProfile = async (id: string) => {
    await ui('document.getElementById("lobby-current").click()');
    await untilUI(ui, `document.querySelector('#profile-deck [data-id="${id}"]') !== null`);
    await ui(`document.querySelector('#profile-deck [data-id="${id}"]').click()`);
    await untilUI(ui, `window.naruto.state().then(s=>s.selectedProfileId===${JSON.stringify(id)})`);
  };
  const sessionService = `cn.youye.naruto-os.test.sessions.${createHash('sha256').update(app.getPath('userData')).digest('hex').slice(0, 16)}`;
  const readSessionSnapshot = () => {
    const response = JSON.parse(execFileSync(path.join(root, 'dist/native/keychain'), [], {
      input: JSON.stringify({ action: 'read', service: sessionService }), encoding: 'utf8'
    }));
    if (!response.ok) throw new Error('Synthetic session snapshot read failed');
    return JSON.parse(response.value || '[]');
  };
  let releaseRecoveryProbe: (() => void) | undefined;
  try {
    if (process.env.NARUTO_TEST_HIDDEN !== '1') { app.focus({ steal: true }); win.focus(); }
    check('startup creates zero game WebContents before an explicit open', games.tabs.length === 0 && win.getBrowserViews().length === 0);
    check('startup has zero game tabs in state and in the visible tab bar', await ui('window.naruto.state().then(s=>s.tabs.length===0 && document.getElementById("tabs").children.length===0)'));
    check('startup shows only launcher home with start button', await ui('!document.getElementById("lobby").hidden && !document.getElementById("open-game").hidden && document.getElementById("new-tab").hidden'));
    await untilUI(ui, 'window.naruto.state().then(s=>s.profileDiscovery==="ready")');
    const initialProfiles = await ui('window.naruto.state()');
    check('startup discovers directory-only and keychain-only legacy slots without creating Sessions',
      initialProfiles.profileDiscovery === 'ready' && initialProfiles.profiles.some((profile: any) => profile.id === 'br-7') &&
      initialProfiles.profiles.some((profile: any) => profile.id === 'cn-8') && initialProfiles.tabs.length === 0 &&
      !fs.existsSync(path.join(app.getPath('userData'), 'Partitions', 'naruto-br-1')));
    check('home shows the remembered account in the v9 capsule without opening a popup',
      await ui('document.getElementById("lobby-account-name").textContent === "合成巴西账号A" && document.getElementById("profile-deck").hidden && document.getElementById("profile-picker-backdrop").hidden && document.getElementById("open-game").disabled === false'));
    await ui('document.getElementById("lobby-current").click()');
    const keyboardOption = await ui(`(()=>{const deck=document.getElementById('profile-deck');deck.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));return deck.getAttribute('aria-activedescendant')})()`);
    check('capsule account list supports listbox arrow navigation and stable profile ids', keyboardOption === 'lobby-option-br-2' &&
      await ui(`document.querySelector('#profile-deck [data-id="br-2"]').getAttribute('role')==='option'`));
    await ui('document.getElementById("profile-deck").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}))');
    await untilUI(ui, 'window.naruto.state().then(s=>s.selectedProfileId==="br-2")');
    check('choosing a capsule account changes only the next launch account', games.tabs.length === 0 && await ui('document.getElementById("lobby-account-name").textContent === "合成巴西账号B"'));
    await chooseProfile('br-1');
    void webLogin.open({ id: 'c'.repeat(24), name: '', region: 'br', profileId: 'br-1' }, 1);
    await until(() => webLogin.busy);
    await ui('window.naruto.command({type:"home"})'); await untilUI(ui, 'window.naruto.state().then(s=>!s.activeId)');
    await chooseProfile('br-2');
    await ui('document.getElementById("open-game").click()'); await pause(50);
    const busyLaunchState = await ui('window.naruto.state()');
    check('busy launch rejection restores the home button and leaves no launch animation behind',
      !busyLaunchState.activeId && busyLaunchState.notice.includes('另一个账号') && games.tabs.length === 0 &&
      await ui('!document.getElementById("open-game").disabled && !document.getElementById("lobby").classList.contains("leaving")'));
    await webLogin.cancel('restore-original'); await until(() => !webLogin.busy);
    await chooseProfile('br-1');
    await ui('window.naruto.command({type:"settings"})'); await untilUI(ui, 'window.naruto.state().then(s=>s.canCreateProfile)');
    await ui('(()=>{const select=document.getElementById("lobby-bg-mode");select.value="#e8bf55";select.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
    await untilUI(ui, 'window.naruto.state().then(s=>s.preferences.lobbyBackground==="#e8bf55")');
    let savedLayout = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'layout.json'), 'utf8'));
    check('background preset saves to the existing preferences file', savedLayout.preferences.lobbyBackground === '#e8bf55');
    const rejectedBackground = await ui('window.naruto.command({type:"lobby-background",value:"url(https://invalid.test)"}).then(()=>false,e=>e.message.includes("颜色"))');
    check('main process rejects non-hex background values', rejectedBackground && (await ui('window.naruto.state()')).preferences.lobbyBackground === '#e8bf55');
    await ui('(()=>{const select=document.getElementById("lobby-bg-mode");select.value="custom";select.dispatchEvent(new Event("change",{bubbles:true}));const input=document.getElementById("lobby-bg-custom");input.value="#a1b2c3";input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
    await untilUI(ui, 'window.naruto.state().then(s=>s.preferences.lobbyBackground==="#a1b2c3")');
    savedLayout = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'layout.json'), 'utf8'));
    check('custom background input persists its final selected color', savedLayout.preferences.lobbyBackground === '#a1b2c3');
    await ui('(()=>{const select=document.getElementById("lobby-bg-mode");select.value="theme";select.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
    await untilUI(ui, 'window.naruto.state().then(s=>s.preferences.lobbyBackground===null)');
    await ui('(()=>{const select=document.getElementById("lobby-bg-mode");select.value="#e8bf55";select.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
    await untilUI(ui, 'window.naruto.state().then(s=>s.preferences.lobbyBackground==="#e8bf55")');
    await ui('document.getElementById("lobby-motion").click()');
    await untilUI(ui, 'window.naruto.state().then(s=>s.preferences.lobbyMotion===false)');
    check('motion preference can be disabled and persisted', JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'layout.json'), 'utf8')).preferences.lobbyMotion === false);
    const rejectedMotion = await ui('window.naruto.command({type:"lobby-motion",value:"off"}).then(()=>false,e=>e.message.includes("动态"))');
    check('main process rejects non-boolean motion values', rejectedMotion && (await ui('window.naruto.state()')).preferences.lobbyMotion === false);
    const settingsPreview = await captureWithin(win.capturePage(), 3000);
    if (settingsPreview) fs.writeFileSync(path.join(directory, 'lobby-settings-yellow-motion-off.png'), settingsPreview.toPNG());
    await ui('document.getElementById("lobby-motion").click()'); await untilUI(ui, 'window.naruto.state().then(s=>s.preferences.lobbyMotion===true)');
    await ui('(()=>{const select=document.getElementById("lobby-bg-mode");select.value="theme";select.dispatchEvent(new Event("change",{bubbles:true}));return true})()'); await untilUI(ui, 'window.naruto.state().then(s=>s.preferences.lobbyBackground===null)');
    check('unnamed legacy slot warns that its website identity must be checked manually',
      await ui('document.querySelector("#profile-list [data-id=br-7] .profile-detail").textContent === "登录身份待自行确认"'));
    await ui('document.querySelector("#profile-list [data-id=br-7] [data-action=edit]").click()'); await pause(60);
    await ui('document.getElementById("edit-name").value="合成命名历史槽位";document.getElementById("edit-server-note").value="合成旧区服";document.getElementById("edit-form").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))');
    await untilUI(ui, 'window.naruto.state().then(s=>s.profiles.some(p=>p.id==="br-7"&&p.name==="合成命名历史槽位"&&p.serverNote==="合成旧区服"))');
    const savedProfiles = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'account-profiles.json'), 'utf8'));
    check('editing a discovered history slot persists its name without changing selection or slot',
      savedProfiles.profiles.some((profile: any) => profile.id === 'br-7' && profile.slot === 7 && profile.name === '合成命名历史槽位') && savedProfiles.selectedByRegion.br === 'br-1');
    await ui('document.getElementById("profile-create").click()'); await pause(60);
    await ui(`(()=>{document.getElementById('edit-name').value='合成账号C';document.getElementById('edit-server-note').value='合成三区';document.getElementById('edit-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return true})()`);
    await untilUI(ui, 'window.naruto.state().then(s=>s.profiles.some(p=>p.id==="br-8"&&p.name==="合成账号C"&&p.serverNote==="合成三区"))');
    await ui(`document.querySelector('#profile-list [data-id="br-8"] [data-action=edit]').click()`); await pause(60);
    await ui(`(()=>{document.getElementById('edit-name').value='合成账号C改名';document.getElementById('edit-server-note').value='';document.getElementById('edit-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));return true})()`);
    await untilUI(ui, 'window.naruto.state().then(s=>s.profiles.some(p=>p.id==="br-8"&&p.name==="合成账号C改名"&&p.serverNote===""))');
    await ui('document.getElementById("profile-create").click()'); await pause(60);
    await ui('document.getElementById("edit-name").value="应取消的新档案";document.getElementById("edit-server-note").value="未保存";document.getElementById("dialog-cancel").click()');
    await untilUI(ui, 'document.getElementById("dialog-backdrop").hidden');
    const afterCreateCancel = await ui('window.naruto.state()');
    check('cancelling profile creation leaves no saved draft', afterCreateCancel.profiles.length === 6 && afterCreateCancel.selectedProfileId === 'br-8');
    await ui('document.querySelector("#profile-list [data-id=br-8] [data-action=edit]").click()'); await pause(60);
    await ui('document.getElementById("edit-name").value="未保存的改名";document.getElementById("edit-server-note").value="未保存的备注";document.getElementById("dialog-cancel").click()');
    await untilUI(ui, 'document.getElementById("dialog-backdrop").hidden');
    const afterEditCancel = await ui('window.naruto.state()');
    const savedC = afterEditCancel.profiles.find((profile: any) => profile.id === 'br-8');
    check('cancelling profile edits preserves saved name and server note', savedC?.name === '合成账号C改名' && savedC.serverNote === '');
    await ui('document.getElementById("close-settings").click()'); await pause(80);
    await chooseProfile('br-8'); await untilUI(ui, `document.getElementById('profile-choice-note').hidden`);
    check('profile management creates, renames, and clears a server note through the actual controls',
      (await ui('window.naruto.state()')).selectedProfileId === 'br-8' && await ui(`document.getElementById('profile-choice-note').hidden`));
    await chooseProfile('br-2');
    check('selecting an account updates the capsule and informational server note',
      await ui(`document.getElementById('lobby-account-name').textContent==='合成巴西账号B'&&document.getElementById('profile-choice-note').textContent==='常用区服：合成二区'`));
    await ui('document.getElementById("open-game").click()'); await pause(150);
    const syntheticB = games.tabs.find(tab => tab.profileId === 'br-2');
    if (!syntheticB?.profile) throw new Error('Profile B did not open with an explicit session');
    check('starting the selected home account displays its game surface', !games.hidden && syntheticB.view.getBounds().height > 0);
    await syntheticB.profile.ready;
    await syntheticB.profile.session.cookies.set({ url: 'https://synthetic.example', name: 'profile-proof', value: 'br-2' });
    await ui('document.getElementById("new-tab").click()'); await pause(100);
    check('plus picker remains limited to the current region',
      await ui(`(()=>Array.from(document.querySelectorAll('#profile-picker-list .profile-option')).map(e=>e.dataset.id).sort().join(',')==='br-1,br-2,br-7,br-8')()`));
    await ui(`document.querySelector('#profile-picker-list [data-id="br-1"] button:last-child').click()`); await pause(150);
    const syntheticA = games.tabs.find(tab => tab.profileId === 'br-1');
    if (!syntheticA?.profile) throw new Error('Profile A did not open with an explicit session');
    check('opening a profile from the plus picker displays its game surface', !games.hidden && games.activeId === syntheticA.id && syntheticA.view.getBounds().height > 0);
    await syntheticA.profile.ready;
    await syntheticA.profile.session.cookies.set({ url: 'https://synthetic.example', name: 'profile-proof', value: 'br-1' });
    check('opening B then A preserves their explicit slots and synthetic Cookie separation',
      syntheticB.profile.partition === 'persist:naruto-br-2' && syntheticA.profile.partition === 'persist:naruto-br-1' &&
      (await syntheticA.profile.session.cookies.get({ url: 'https://synthetic.example', name: 'profile-proof' }))[0]?.value === 'br-1' &&
      (await syntheticB.profile.session.cookies.get({ url: 'https://synthetic.example', name: 'profile-proof' }))[0]?.value === 'br-2');
    await ui('document.getElementById("new-tab").click()'); await pause(100);
    await ui(`document.querySelector('#profile-picker-list [data-id="br-2"] button:last-child').click()`); await pause(100);
    check('opening an already open profile focuses its existing visible tab', games.tabs.length === 2 && games.activeId === syntheticB.id && !games.hidden && syntheticB.view.getBounds().height > 0);
    await ui('window.naruto.command({type:"settings"})'); await untilUI(ui, 'window.naruto.state().then(s=>s.settingsOpen)');
    check('delete control is disabled while its profile has an active game tab',
      await ui('document.querySelector("#profile-list [data-id=br-2] [data-action=delete]").disabled'));
    const activeDeleteRefused = await ui('window.naruto.command({type:"profile-delete",id:"br-2"}).then(()=>false,e=>e.message.includes("结束"))');
    check('main process independently refuses deletion of an active profile', activeDeleteRefused && !(await ui('window.naruto.state()')).profiles.find((profile: any) => profile.id === 'br-2')?.cleanupStatus);
    await ui('document.getElementById("new-tab").click()'); await pause(100);
    await ui(`document.querySelector('#profile-picker-list [data-id="br-2"] button:last-child').click()`); await pause(100);
    check('opening a profile from the plus picker while settings are open closes settings and shows the game',
      !games.hidden && games.activeId === syntheticB.id && syntheticB.view.getBounds().height > 0 && await ui('document.getElementById("settings-panel").hidden'));
    games.close(syntheticA.id); games.close(syntheticB.id); await pause(700);
    await chooseProfile('br-1');
    await ui('document.getElementById("open-game").click()'); await pause(150);
    const reopenedA = games.tabs.find(tab => tab.profileId === 'br-1');
    await ui('document.getElementById("new-tab").click()'); await pause(100);
    await ui(`document.querySelector('#profile-picker-list [data-id="br-2"] button:last-child').click()`); await pause(150);
    const reopenedB = games.tabs.find(tab => tab.profileId === 'br-2');
    check('opening A then B also preserves the same sessions after closing and reopening',
      games.tabs.length === 2 && reopenedA?.profile?.partition === 'persist:naruto-br-1' && reopenedB?.profile?.partition === 'persist:naruto-br-2' &&
      (await reopenedA!.profile!.session.cookies.get({ url: 'https://synthetic.example', name: 'profile-proof' }))[0]?.value === 'br-1' &&
      (await reopenedB!.profile!.session.cookies.get({ url: 'https://synthetic.example', name: 'profile-proof' }))[0]?.value === 'br-2');
    games.close(reopenedA!.id); games.close(reopenedB!.id); await pause(700);
    await ui('window.naruto.command({type:"settings"})'); await untilUI(ui, 'window.naruto.state().then(s=>s.settingsOpen)');
    await vault.save(origin, 'profile-delete-proof', 'synthetic-password-preserved');
    const passwordsBeforeDelete = (await vault.list()).map(({ id, username }) => [id, username]);
    const snapshotBeforeDelete = readSessionSnapshot();
    check('synthetic deletion target has an isolated Keychain login snapshot', Object.prototype.hasOwnProperty.call(snapshotBeforeDelete.partitions, 'persist:naruto-br-7'));
    await ui('document.querySelector("#profile-list [data-id=br-7] [data-action=delete]").click()'); await pause(80);
    const deletionDescription = await ui('document.getElementById("dialog-description").textContent');
    check('delete confirmation identifies local data and preserves website account and saved passwords',
      deletionDescription.includes('合成命名历史槽位') && deletionDescription.includes('Cookie') && deletionDescription.includes('不会注销官网账号') && deletionDescription.includes('已保存的密码会保留'));
    await ui('document.getElementById("dialog-cancel").click()'); await untilUI(ui, 'document.getElementById("dialog-backdrop").hidden');
    const afterDeleteCancel = await ui('window.naruto.state()');
    check('cancelling deletion leaves the profile and its Keychain snapshot untouched',
      afterDeleteCancel.profiles.some((profile: any) => profile.id === 'br-7') && !afterDeleteCancel.profiles.find((profile: any) => profile.id === 'br-7')?.cleanupStatus &&
      Object.prototype.hasOwnProperty.call(readSessionSnapshot().partitions, 'persist:naruto-br-7'));
    await ui('document.querySelector("#profile-list [data-id=br-7] [data-action=delete]").click()'); await pause(60);
    await ui('document.getElementById("dialog-save").click()');
    await untilUI(ui, 'window.naruto.state().then(s=>!s.profiles.some(p=>p.id==="br-7"))');
    await untilUI(ui, 'document.getElementById("dialog-backdrop").hidden');
    const deletedMetadata = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'account-profiles.json'), 'utf8'));
    const snapshotAfterDelete = readSessionSnapshot();
    check('confirmed deletion removes the profile and leaves a tombstone against legacy rediscovery',
      !deletedMetadata.profiles.some((profile: any) => profile.id === 'br-7') && deletedMetadata.deletedIds.includes('br-7') && !deletedMetadata.pendingDeletes.includes('br-7'));
    check('confirmed deletion removes only its session snapshot and preserves other profiles',
      !Object.prototype.hasOwnProperty.call(snapshotAfterDelete.partitions, 'persist:naruto-br-7') &&
      Object.prototype.hasOwnProperty.call(snapshotAfterDelete.partitions, 'persist:naruto-br-2') &&
      Object.prototype.hasOwnProperty.call(snapshotAfterDelete.partitions, 'persist:naruto-cn-8'));
    await ui('window.naruto.command({type:"profiles-retry"})'); await untilUI(ui, 'window.naruto.state().then(s=>s.profileDiscovery==="ready")');
    check('rediscovery does not resurrect a deleted directory-only profile', !(await ui('window.naruto.state()')).profiles.some((profile: any) => profile.id === 'br-7'));
    check('profile deletion leaves the independent saved-password vault unchanged', JSON.stringify((await vault.list()).map(({ id, username }) => [id, username])) === JSON.stringify(passwordsBeforeDelete));
    await vault.remove((await vault.list()).find(item => item.username === 'profile-delete-proof')!.id);
    await ui('document.getElementById("close-settings").click()'); await pause(80);
    await chooseProfile('br-1');
    await ui('document.getElementById("lobby-region").click()');
    await untilUI(ui, 'window.naruto.state().then(s=>s.preferences.region==="cn")');
    check('changing region on cold home creates no tabs or game WebContents', games.tabs.length === 0 && win.getBrowserViews().length === 0 && await ui('window.naruto.state().then(s=>s.tabs.length===0)'));
    await untilUI(ui, 'window.naruto.state().then(s=>s.selectedProfileId==="cn-1" && !document.getElementById("open-game").disabled)');
    check('changing the home region immediately updates its account selector',
      await ui('document.getElementById("lobby-account-name").textContent==="合成国服账号" && !document.getElementById("open-game").disabled'));
    await ui('window.naruto.command({type:"region",value:"br"})');
    await ui('document.getElementById("open-game").click()');
    const first = games.active;
    if (!first) throw new Error('Start button did not create a game tab');
    check('start creates exactly one visible game tab and one guest', games.tabs.length === 1 && win.getBrowserViews().length === 1 && !games.hidden && first.view.getBounds().height > 0);
    if (first.state === 'loading') await new Promise<void>(resolve => first.view.webContents.once('did-stop-loading', () => resolve()));
    const initialGeneration = first.generation;
    await ui('window.naruto.command({type:"home"})'); await pause(200);
    check('home keeps existing game session alive offscreen', games.activeId === null && games.tabs.length === 1 && first.view.getBounds().x < 0);
    check('launcher character loads from bundled local WebP', await ui('document.querySelector(".lobby-character").complete && document.querySelector(".lobby-character").naturalWidth > 0'));
    for (const theme of ['light', 'dark']) {
      await ui(`window.naruto.command({type:"theme",value:"${theme}"})`); await pause(100);
      for (const region of ['br', 'cn']) {
      await ui(`window.naruto.command({type:"region",value:"${region}"})`); await pause(100);
      check(`region ${region} uses its dedicated local WebP illustration`, await ui(`document.getElementById('lobby-character').getAttribute('src') === 'lobby-art-${region}.webp' && document.getElementById('lobby-character').complete && document.getElementById('lobby-character').naturalWidth>0`));
      for (const [width, height] of [[1280, 850], [800, 560], [1920, 1080], [2560, 1080]]) {
        win.setContentSize(width, height); await pause(150);
        check(`launcher controls stay in the window at ${region} ${theme} ${width}x${height}`, await ui(`(()=>{const button=document.getElementById('open-game'),r=button.getBoundingClientRect(),image=document.querySelector('.lobby-character').getBoundingClientRect(),title=document.getElementById('lobby-title').getBoundingClientRect();return !document.getElementById('lobby').hidden && r.left>=0 && r.right<=innerWidth && r.bottom<innerHeight && image.top>=42 && title.bottom<r.top && document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===button})()`));
        // Keep selected desktop screenshots as visual artifacts. On Electron 11,
        // later BrowserWindow.capturePage calls can stall after native resize.
        if (theme === 'light' && region === 'br' && (width === 1280 || width === 1920)) {
          const image = await captureWithin(win.capturePage(), 3000);
          if (image) fs.writeFileSync(path.join(directory, `lobby-${region}-${theme}-${width}x${height}.png`), image.toPNG());
        }
      }
      }
    }
    win.setContentSize(1280, 850);
    await ui('window.naruto.command({type:"theme",value:"system"})');
    await ui('document.getElementById("region-select").value="cn";document.getElementById("region-select").dispatchEvent(new Event("change"))'); await pause(150);
    check('region selector changes next launch without navigating existing game', first.generation === initialGeneration && await ui('window.naruto.state().then(s=>s.preferences.region==="cn" && s.tabs[0].region==="br")'));
    await ui('document.getElementById("open-game").click()'); await pause(250);
    const regionalTab = games.active;
    check('start button creates a China-labelled isolated tab', regionalTab?.region === 'cn' && games.tabs.length === 2 && regionalTab.view.webContents.session !== first.view.webContents.session);
    if (regionalTab) games.close(regionalTab.id);
    await ui('window.naruto.command({type:"region",value:"br"})');
    games.select(first.id);
    first.view.webContents.on('preload-error', (_e, _file, error) => console.log('PRELOAD_ERROR', error.message));
    await install(first); await pause(1200);
    first.state = 'failed'; games.select(first.id); await pause(100);
    check('failed Brazil game offers the unified refresh action', await ui(`(() => {
      const pane = document.getElementById('placeholder'), button = document.getElementById('placeholder-recover');
      const toolbar = document.getElementById('refresh');
      return !pane.hidden && !button.hidden && button.textContent === '重新进入游戏' && button.getBoundingClientRect().width > 0 && !document.getElementById('recover-game');
    })()`));
    first.state = 'ready'; games.select(first.id);
    let recovered: GameTab[] = [];
    const realRecover = webLogin.recover;
    const realLoginRefresh = webLogin.refresh.bind(webLogin); let loginRefreshes = 0;
    webLogin.recover = async tab => { recovered.push(tab); };
    webLogin.refresh = () => { loginRefreshes++; };
    const refreshMenu = Menu.getApplicationMenu()?.getMenuItemById('refresh-current-tab') as (Electron.MenuItem & { click?: (...args: any[]) => void }) | undefined;
    const generationsPreserved: boolean[] = [];
    for (const route of [
      'https://naruto-pt.oasgames.com/main.html?user_name=fixture&server_id=776&time=123&sign=synthetic',
      'https://huoying.qq.com/redirected-error',
      'https://fixture.invalid/403-error'
    ]) {
      await first.view.webContents.loadURL(route);
      first.state = 'failed'; games.select(first.id);
      const generation = first.generation;
      await ui('document.getElementById("refresh").click()');
      generationsPreserved.push(first.generation === generation);
    }
    check('Brazil signed, redirected-error, and failed pages all use the same fresh-entry route', recovered.length === 3 && recovered.every(tab => tab === first) && generationsPreserved.every(Boolean));
    check('application menu refresh label and availability match the active Brazil game', refreshMenu?.label === '重新进入游戏' && refreshMenu.enabled);
    if (refreshMenu?.click) refreshMenu.click(undefined, win, win.webContents);
    check('application menu refresh invokes the same Brazil recovery action', recovered.length === 4 && recovered[3] === first);
    await ui('window.naruto.command({type:"settings"})');
    check('settings disables refresh in both toolbar and application menu', refreshMenu?.enabled === false && await ui('document.getElementById("refresh").disabled'));
    await ui('window.naruto.command({type:"settings"})');
    await ui('window.naruto.command({type:"overlay",shown:true})');
    check('modal editor overlay disables refresh in both toolbar and application menu', refreshMenu?.enabled === false && await ui('document.getElementById("refresh").disabled'));
    await ui('window.naruto.command({type:"overlay",shown:false})');
    const backgroundGeneration = first.generation;
    games.select(null);
    check('refresh menu and toolbar disable together on home while background game stays unchanged', refreshMenu?.enabled === false && await ui('document.getElementById("refresh").disabled') && first.generation === backgroundGeneration);
    games.select(first.id);
    await first.view.webContents.loadURL(ENTRY_URL);
    if (app.isPackaged) {
      check('actual application bundle runs without development dependencies', fs.existsSync(path.join(root, 'assets/app-icon.png')) && !fs.existsSync(path.join(root, 'node_modules')));
      check('packaged game session follows the system proxy route',
        await first.view.webContents.session.resolveProxy(ENTRY_URL) === await session.defaultSession.resolveProxy(ENTRY_URL));
    }
    const nativeControlsMatch = () => measureTrafficLights(win).every((b,i) => Math.abs(b.circle - 14) < .01 && Math.abs(b.x + b.width / 2 - (21 + i*22)) < .01 && Math.abs(b.y + b.height / 2 - 21) < .01 && b.nativeHit);
    check('actual shell uses 14pt native window controls', nativeControlsMatch());
    if (process.env.NARUTO_TEST_HIDDEN !== '1') { win.blur(); await pause(200); win.focus(); await pause(350); }
    check('packaged controls retain centers and hit areas after activation', nativeControlsMatch());
    check('Intel Electron 11 host', process.arch === 'x64' && process.versions.electron === '11.5.0');
    check('remote has no Node or shell API', await first.view.webContents.executeJavaScript('typeof require === "undefined" && typeof window.naruto === "undefined" && typeof process === "undefined"'));
    check('sandbox enabled', (first.view.webContents as Electron.WebContents & { getLastWebPreferences(): { sandbox: boolean } }).getLastWebPreferences().sandbox === true);
    check('PPAPI Flash registered', await first.view.webContents.executeJavaScript('Array.from(navigator.plugins).some(p=>/Shockwave Flash/.test(p.name))'));
    await vault.save(origin, 'fixture-alpha', 'synthetic-password-one'); await vault.save(origin, 'fixture-beta', 'synthetic-password-two');
    check('keychain metadata omits secrets', (await vault.list(origin)).every(r => !('password' in r)));
    const second = games.create(newTab()); await install(second); games.select(second.id);
    await first.view.webContents.executeJavaScript('document.cookie="naruto_fixture=alpha; path=/; SameSite=Lax"; localStorage.setItem("naruto_fixture","alpha"); window.fixtureTicks=0; setInterval(()=>window.fixtureTicks++,100)');
    check('cookie isolation', await second.view.webContents.executeJavaScript('!document.cookie.includes("naruto_fixture")'));
    check('storage isolation', await second.view.webContents.executeJavaScript('localStorage.getItem("naruto_fixture") === null'));
    await pause(400); check('background keeps executing', await first.view.webContents.executeJavaScript('window.fixtureTicks > 1'));
    check('only active audible', first.view.webContents.isAudioMuted() && !second.view.webContents.isAudioMuted());
    games.muted = true; games.syncAudio(); check('global mute', games.tabs.every(t => t.view.webContents.isAudioMuted()));
    games.select(first.id); check('mute persists on tab switch', games.tabs.every(t => t.view.webContents.isAudioMuted())); games.muted = false; games.syncAudio();
    const cancellationIntents: (string | undefined)[] = [], cancellationTasks: Promise<void>[] = [];
    const realCancel = webLogin.cancel.bind(webLogin);
    webLogin.cancel = intent => { cancellationIntents.push(intent); const task = realCancel(intent); cancellationTasks.push(task); return task; };
    let probeNumber = 0;
    const pendingRecovery = (replacesTabId: string, stage: 'login' | 'loading' | 'confirming' = 'login', candidateId?: string, profileId?: string) => {
      let finish!: () => void;
      const task = new Promise<void>(resolve => { finish = resolve; });
      const saved = { id: candidateId ?? String(++probeNumber).padStart(24, '0'), name: '', region: 'br' as const, ...(profileId ? { profileId } : {}) };
      const attempt = { saved, task, cancelled: false, replacesTabId, stage, ...(candidateId ? { replacementTabId: candidateId } : {}) };
      (webLogin as any).pending = attempt;
      releaseRecoveryProbe = finish;
      return { id: attempt.saved.id, attempt, finish, clear: () => { if ((webLogin as any).pending === attempt) delete (webLogin as any).pending; } };
    };
    const pendingLogin = (profileId: string) => {
      let finish!: () => void;
      const task = new Promise<void>(resolve => { finish = resolve; });
      const saved = { id: String(++probeNumber).padStart(24, '0'), name: '', region: 'br' as const, profileId };
      const attempt = { saved, task, cancelled: false, stage: 'login' as const };
      (webLogin as any).pending = attempt;
      releaseRecoveryProbe = finish;
      return { id: saved.id, attempt, finish, clear: () => { if ((webLogin as any).pending === attempt) delete (webLogin as any).pending; } };
    };
    const settleCancellation = async (attempt: { finish: () => void; clear: () => void }, offset: number) => {
      attempt.finish(); await Promise.all(cancellationTasks.slice(offset)); attempt.clear(); cancellationTasks.length = offset;
      if (releaseRecoveryProbe === attempt.finish) releaseRecoveryProbe = undefined;
    };
    const loginProbe = pendingRecovery(first.id);
    await ui(`window.naruto.command({type:"select",id:${JSON.stringify(loginProbe.id)}})`); await pause(100);
    check('refresh switches to the visible WK login page while recovery is in progress', refreshMenu?.label === '刷新登录/选服页面' && refreshMenu.enabled && await ui('window.naruto.state().then(s=>s.refresh.enabled)'));
    await ui('document.getElementById("refresh").click()');
    if (refreshMenu?.click) refreshMenu.click(undefined, win, win.webContents);
    check('toolbar and menu share WK refresh, and the menu binds ⌘R to that same item', loginRefreshes === 2 && refreshMenu?.accelerator === 'CmdOrCtrl+R');
    const loginCancelOffset = cancellationTasks.length;
    await ui(`window.naruto.command({type:"close",id:${JSON.stringify(loginProbe.id)}})`);
    await settleCancellation(loginProbe, loginCancelOffset);
    webLogin.refresh = realLoginRefresh; webLogin.recover = realRecover;
    games.select(first.id);

    const ordinary = pendingLogin('br-2');
    const hiddenLoginDeleteRefused = await ui('window.naruto.command({type:"profile-delete",id:"br-2"}).then(()=>false,e=>e.message.includes("登录/恢复任务"))');
    check('main process refuses deletion while the profile has a hidden login task', hiddenLoginDeleteRefused && !(await ui('window.naruto.state()')).profiles.find((profile: any) => profile.id === 'br-2')?.cleanupStatus);
    games.select(second.id);
    const cancelsBeforeNavigation = cancellationIntents.length;
    await ui(`window.naruto.command({type:"select",id:${JSON.stringify(ordinary.id)}})`);
    check('ordinary login tab becomes the selected foreground page', games.activeId === null && (await ui('window.naruto.state()')).activeId === ordinary.id);
    await ui(`window.naruto.command({type:"select",id:${JSON.stringify(first.id)}})`);
    check('switching from B login to existing A preserves B and selects A', games.activeId === first.id && (webLogin as any).pending === ordinary.attempt && !ordinary.attempt.cancelled && (await ui('window.naruto.state()')).activeId === first.id);
    await ui(`window.naruto.command({type:"select",id:${JSON.stringify(ordinary.id)}})`);
    check('returning to B restores the same pending login tab', games.activeId === null && (webLogin as any).pending === ordinary.attempt && (await ui('window.naruto.state()')).activeId === ordinary.id);
    await ui('window.naruto.command({type:"home"})');
    check('home hides ordinary login without cancelling its task', games.activeId === null && (webLogin as any).pending === ordinary.attempt && !ordinary.attempt.cancelled && (await ui('window.naruto.state()')).activeId === null);
    await ui(`window.naruto.command({type:"select",id:${JSON.stringify(ordinary.id)}})`);
    await ui('window.naruto.command({type:"new"})');
    await ui('window.naruto.command({type:"profile-open",id:"br-2"})');
    check('opening the already pending B profile focuses the same login task', (webLogin as any).pending === ordinary.attempt && games.activeId === null && (await ui('window.naruto.state()')).activeId === ordinary.id);
    await ui('window.naruto.command({type:"new"})');
    await ui('window.naruto.command({type:"profile-open",id:"br-1"})');
    check('an existing A profile remains selectable while B is logging in', games.activeId === first.id && (webLogin as any).pending === ordinary.attempt && !ordinary.attempt.cancelled);
    await ui('window.naruto.command({type:"new"})');
    await ui('window.naruto.command({type:"profile-open",id:"br-8"})');
    await untilUI(ui, 'document.getElementById("profile-picker-status").textContent.includes("另一个账号正在登录或恢复")');
    check('opening an unopened C profile reports busy and keeps B alive', games.tabs.length === 2 && (webLogin as any).pending === ordinary.attempt && !ordinary.attempt.cancelled && (await ui('window.naruto.state()')).profilePickerOpen);
    check('busy notice is visible inside the profile picker', await ui('document.getElementById("profile-picker-status").textContent.includes("另一个账号正在登录或恢复")'));
    await ui('window.naruto.command({type:"profiles-close-picker"})');
    const ordinaryCancelOffset = cancellationTasks.length;
    await ui(`window.naruto.command({type:"close",id:${JSON.stringify(ordinary.id)}})`);
    await settleCancellation(ordinary, ordinaryCancelOffset);
    check('explicitly closing background B cancels it without moving away from A', games.activeId === first.id && !(webLogin as any).pending);
    check('home and tab navigation did not send cancellation to B', cancellationIntents.length === cancelsBeforeNavigation + 1 && cancellationIntents[cancellationIntents.length - 1] === 'restore-original');

    let offset = cancellationTasks.length, probe = pendingRecovery(first.id);
    games.select(first.id); await pause(100);
    const cancelsBeforeBlockedClose = cancellationIntents.length;
    await ui(`window.naruto.command({type:"close",id:${JSON.stringify(first.id)}})`);
    check('closing the original game is blocked during WK recovery, with its tab close disabled', games.tabs.includes(first) && cancellationIntents.length === cancelsBeforeBlockedClose && await ui(`document.querySelector('[data-id="${first.id}"] .tab-close').disabled`));
    await ui('window.naruto.command({type:"home"})');
    check('home hides recovery without cancelling its task', cancellationIntents.length === cancelsBeforeBlockedClose && !probe.attempt.cancelled && (webLogin as any).pending === probe.attempt && games.activeId === null);
    await settleCancellation(probe, offset);
    check('home remains selected after recovery cancellation finishes', games.activeId === null && games.tabs.includes(first));
    games.select(first.id);
    offset = cancellationTasks.length; probe = pendingRecovery(first.id);
    const cancelsBeforeSelect = cancellationIntents.length;
    await ui(`window.naruto.command({type:"select",id:${JSON.stringify(second.id)}})`);
    check('selecting another game hides recovery without cancelling it', cancellationIntents.length === cancelsBeforeSelect && !probe.attempt.cancelled && (webLogin as any).pending === probe.attempt && games.activeId === second.id);
    await settleCancellation(probe, offset);
    check('selected tab remains active after recovery cancellation finishes', games.activeId === second.id && games.tabs.includes(first));
    games.select(second.id);
    offset = cancellationTasks.length; probe = pendingRecovery(first.id);
    await ui(`window.naruto.command({type:"select",id:${JSON.stringify(probe.id)}})`);
    await ui(`window.naruto.command({type:"close",id:${JSON.stringify(probe.id)}})`);
    check('closing the recovery tab sends return-to-original intent', cancellationIntents[cancellationIntents.length - 1] === 'restore-original');
    await settleCancellation(probe, offset);
    check('closing the recovery tab returns to the original game', games.activeId === first.id && games.tabs.includes(first));
    const closingTarget = games.create(newTab('cn')); await install(closingTarget);
    const closeNeighbor = games.create(newTab('br')); await install(closeNeighbor);
    games.select(closingTarget.id);
    offset = cancellationTasks.length; probe = pendingRecovery(first.id);
    await ui(`window.naruto.command({type:"close",id:${JSON.stringify(probe.id)}})`);
    check('closing the recovery tab starts return-to-original cancellation', cancellationIntents[cancellationIntents.length - 1] === 'restore-original');
    await ui(`window.naruto.command({type:"close",id:${JSON.stringify(closingTarget.id)}})`);
    const selectedByClose = games.activeId;
    await settleCancellation(probe, offset);
    check('closing the selected destination during cancellation preserves GameSessions selection', selectedByClose === closeNeighbor.id && games.activeId === closeNeighbor.id && games.tabs.includes(first));
    games.close(closeNeighbor.id); games.select(first.id);
    const backgroundDuringCancel = await recoveryFixtureTab(games);
    offset = cancellationTasks.length; probe = pendingRecovery(first.id);
    await ui(`window.naruto.command({type:"select",id:${JSON.stringify(probe.id)}})`);
    await ui(`window.naruto.command({type:"close",id:${JSON.stringify(probe.id)}})`);
    await ui(`window.naruto.command({type:"close",id:${JSON.stringify(backgroundDuringCancel.id)}})`);
    await settleCancellation(probe, offset);
    check('closing a background game while recovery cancellation is pending still returns to the original',
      !games.tabs.includes(backgroundDuringCancel) && games.tabs.includes(first) && games.activeId === first.id);
    games.select(first.id);
    offset = cancellationTasks.length; probe = pendingRecovery(first.id);
    await ui(`window.naruto.command({type:"select",id:${JSON.stringify(probe.id)}})`);
    await ui(`window.naruto.command({type:"close",id:${JSON.stringify(probe.id)}})`);
    await ui(`window.naruto.command({type:"select",id:${JSON.stringify(second.id)}})`);
    await settleCancellation(probe, offset);
    check('selection after closing the recovery tab overrides the earlier return intent', games.activeId === second.id && games.tabs.includes(first));
    webLogin.cancel = realCancel;
    delete (webLogin as any).pending;
    games.select(first.id);
    const embeddedLogin = require(path.join(root, 'dist/native/embedded-login.node'));
    const previousManualLogin = process.env.NARUTO_TEST_MANUAL_LOGIN;
    process.env.NARUTO_TEST_MANUAL_LOGIN = '1';
    await ui('window.naruto.command({type:"profile-open",id:"br-8"})');
    await until(() => !!(webLogin as any).pending?.handle);
    const foregroundLogin = webLogin.operation!;
    const foregroundLoginState = await ui('window.naruto.state()');
    check('starting another account login from A shows WK and preserves A in the background',
      embeddedLogin.attached() && embeddedLogin.visible() && games.activeId === null && games.tabs.includes(first) &&
      foregroundLoginState.activeId === foregroundLogin.tabId);
    await until(() => !webLogin.busy && games.tabs.some(tab => tab.profileId === 'br-8'));
    const profileGame = games.tabs.find(tab => tab.profileId === 'br-8')!;
    await games.waitForReady(profileGame.id);
    check('synthetic profile login hands off into its own isolated game tab',
      profileGame.profile?.partition === 'persist:naruto-br-8' && games.activeId === profileGame.id);
    const profileGameContents = profileGame.view.webContents;
    await ui('window.naruto.command({type:"refresh"})');
    await until(() => webLogin.operation?.recovering === true && webLogin.operation.stage === 'login' && !!(webLogin as any).pending?.handle);
    const recoveryLogin = webLogin.operation!;
    const recoveryLoginState = await ui('window.naruto.state()');
    check('real refresh command keeps the recovery WK page visible over the original game',
      embeddedLogin.attached() && embeddedLogin.visible() && games.tabs.includes(profileGame) && games.activeId === null &&
      recoveryLoginState.activeId === recoveryLogin.tabId && recoveryLoginState.tabs.some((tab: any) => tab.id === profileGame.id));
    await until(() => webLogin.operation?.stage === 'confirming' && games.activeId === webLogin.operation.candidateId);
    const recoveryCandidate = games.tabs.find(tab => tab.id === webLogin.operation?.candidateId)!;
    check('real recovery handoff selects a ready candidate without losing its original',
      recoveryCandidate.state === 'ready' && recoveryCandidate.profileId === profileGame.profileId && games.tabs.includes(profileGame));
    const originalContents = profileGameContents;
    await ui('document.getElementById("complete-recovery").click()');
    await until(() => !games.tabs.includes(profileGame) && !webLogin.operation);
    await until(() => originalContents.isDestroyed());
    check('real recovery completion keeps the candidate and closes only the original game',
      games.tabs.includes(recoveryCandidate) && games.activeId === recoveryCandidate.id &&
      recoveryCandidate.profile?.partition === profileGame.profile?.partition);
    const recoveryCandidateContents = recoveryCandidate.view.webContents;
    await ui(`window.naruto.command({type:"close",id:${JSON.stringify(recoveryCandidate.id)}})`);
    await until(() => recoveryCandidateContents.isDestroyed());
    games.select(first.id);
    if (previousManualLogin === undefined) delete process.env.NARUTO_TEST_MANUAL_LOGIN;
    else process.env.NARUTO_TEST_MANUAL_LOGIN = previousManualLogin;
    const before = second.generation; games.refresh(first.id); await pause(1400); check('underlying GameSessions reload remains scoped to the requested tab', second.generation === before && first.state === 'ready');
    if (process.env.NARUTO_TEST_HIDDEN === '1') {
      skip('trusted game-page keyboard input requires a focused native window; hidden integration keeps the desktop undisturbed');
    } else {
    // Record only fixed UI metadata and request counts; never capture query text or credentials.
    const candidateDiagnostics: Record<string, any> = { targetTabId: first.id, targetWebContentsId: first.view.webContents.id, attempts: [] };
    diagnostics.savedCandidates = candidateDiagnostics;
    let activeCandidateAttempt: Record<string, any> | undefined;
    const originalVaultList = vault.list;
    vault.list = async function(requestOrigin?: string, query = '') {
      const isCandidateRequest = requestOrigin === origin;
      if (isCandidateRequest && activeCandidateAttempt) {
        activeCandidateAttempt.requestCount++;
        activeCandidateAttempt.activeTabAtRequest = games.activeId;
        activeCandidateAttempt.targetContentsFocusedAtRequest = first.view.webContents.isFocused();
        activeCandidateAttempt.pageGenerationAtRequest = first.generation;
      }
      const records = await originalVaultList.call(vault, requestOrigin, query);
      if (isCandidateRequest && activeCandidateAttempt) {
        activeCandidateAttempt.responseCount++;
        activeCandidateAttempt.candidateCount = records.length;
      }
      return records;
    };
    const readGuestState = () => first.view.webContents.executeJavaScript(`(()=>{
      const active=document.activeElement;
      return {input:!!document.querySelector('input'),activeTag:active?.tagName??null,activeId:active?.id??null,
        usernameFocused:active?.id==='username',shadowHostCount:Array.from(document.querySelectorAll('div')).filter(x=>x.style.zIndex==='2147483647').length,
        filled:document.getElementById('username')?.value==='fixture-alpha'&&document.getElementById('password')?.value==='synthetic-password-one',
        stillOnLogin:location.pathname==='/pt/serverlist'};
    })()`);
    const waitForGuest = async (predicate: (state: any) => boolean, phase: string) => {
      for (let attempt = 0; attempt < 200; attempt++) {
        const state = await readGuestState();
        if (predicate(state)) return state;
        await pause(50);
      }
      throw new Error(`saved-candidate-${phase}-timeout`);
    };
    try {
      for (let index = 1; index <= 3; index++) {
        if (index > 1) {
          await first.view.webContents.loadURL(ENTRY_URL);
          await until(() => first.state === 'ready');
        }
        const attempt: Record<string, any> = {
          iteration: index, pageGeneration: first.generation, targetWebContentsId: first.view.webContents.id,
          activeTabBeforeInput: games.activeId, windowFocusedAtInput: null, targetContentsFocusedAtInput: null,
          requestCount: 0, responseCount: 0, candidateCount: null, activeTabAtRequest: null,
          targetContentsFocusedAtRequest: null, pageGenerationAtRequest: null,
          usernameFocusState: null, candidateListState: null, fillState: null
        };
        candidateDiagnostics.attempts.push(attempt); activeCandidateAttempt = attempt;
        // Tab creates a trusted focusin event; script-driven focus is ignored by design.
        win.focus(); first.view.webContents.focus();
        attempt.windowFocusedAtInput = win.isFocused();
        attempt.targetContentsFocusedAtInput = first.view.webContents.isFocused();
        first.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
        first.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
        const focusedState = await waitForGuest(state => state.usernameFocused, `username-focus-${index}`);
        attempt.usernameFocusState = { activeElement: { tag: focusedState.activeTag, id: focusedState.activeId },
          usernameFocused: focusedState.usernameFocused, shadowHostCount: focusedState.shadowHostCount };
        check(`login form account input receives focus on attempt ${index}`, focusedState.usernameFocused);
        await until(() => attempt.requestCount > 0);
        await until(() => attempt.responseCount > 0);
        const guestState = await waitForGuest(state => state.shadowHostCount > 0, `list-render-${index}`);
        attempt.candidateListState = { activeElement: { tag: guestState.activeTag, id: guestState.activeId },
          usernameFocused: guestState.usernameFocused, shadowHostCount: guestState.shadowHostCount };
        check(`attempt ${index} requests and displays candidates for the selected page generation`,
          attempt.requestCount === 1 && attempt.responseCount === 1 && attempt.candidateCount === 2 &&
          attempt.activeTabAtRequest === first.id &&
          (process.env.NARUTO_TEST_HIDDEN === '1' || attempt.targetContentsFocusedAtRequest) &&
          attempt.pageGenerationAtRequest === attempt.pageGeneration && guestState.shadowHostCount > 0);
        if (index === 1) {
          first.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
          first.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' });
          first.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
          first.view.webContents.sendInputEvent({ type: 'char', keyCode: 'Return' });
          first.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
          const filledState = await waitForGuest(state => state.filled, 'selection-fill');
          attempt.fillState = { activeElement: { tag: filledState.activeTag, id: filledState.activeId },
            filled: filledState.filled, stillOnLogin: filledState.stillOnLogin, shadowHostCount: filledState.shadowHostCount };
          check('chosen credential fills without submit', filledState.filled && filledState.stillOnLogin);
        } else {
          first.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
          first.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
          await waitForGuest(state => state.shadowHostCount === 0, `dismiss-${index}`);
        }
      }
    } finally { vault.list = originalVaultList; }
    }
    if (process.env.NARUTO_TEST_MANUAL_ACCEPTANCE === '1') {
      fs.writeFileSync(path.join(directory, 'integration.json'), JSON.stringify({ ok: true, results, skipped, diagnostics, manualAcceptancePending: true }, null, 2));
      process.env.NARUTO_TEST_MANUAL_LOGIN = '1';
      console.log('MANUAL_ACCEPTANCE_READY', results.length);
      finish(0); return;
    }
    await ui('window.naruto.command({type:"rename",id:' + JSON.stringify(first.id) + ',name:"验证标签"})');
    check('rename independent of credential', first.name === '验证标签' && (await vault.list(origin)).length === 2);
    await ui('window.naruto.command({type:"settings"})'); await pause(900);
    check('settings hides game views', win.getBrowserViews().every(view => view.getBounds().x < 0));
    check('credential manager loaded', await ui('document.querySelectorAll(".credential").length === 2'));
    const manualUsername = `synthetic-manual-${process.pid}`;
    const manualPassword = '  引号"反斜线\\与Unicode忍者  ';
    const changedManualPassword = 'updated-synthetic-password';
    const chinaManualPassword = '国服-synthetic-password';
    const openManualDialog = async () => {
      await ui('document.getElementById("credential-create").click()');
      await untilUI(ui, '!document.getElementById("dialog-backdrop").hidden && document.getElementById("credential-site").options.length===2');
    };
    const fillManualDialog = async (siteId: string, password: string, usernameValue = manualUsername) => {
      const [site, username, secret] = [siteId, usernameValue, password].map(value => JSON.stringify(value));
      await ui(`(()=>{document.getElementById("credential-site").value=${site};document.getElementById("edit-name").value=${username};document.getElementById("edit-password").value=${secret};return true})()`);
    };
    const submitManualDialog = () => ui('document.getElementById("edit-form").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))');
    await openManualDialog();
    check('manual password form offers only Brazil and China and masks the password', await ui('(()=>{const s=document.getElementById("credential-site"),p=document.getElementById("edit-password");return s.options.length===2&&s.options[0].value==="br"&&s.options[1].value==="cn"&&p.type==="password"})()'));
    const runtimeVault = vault as any;
    const originalCredentialTransport = runtimeVault.transport;
    let failNextCredentialWrite = true;
    runtimeVault.transport = async (action: string, value?: string) => {
      if (action === 'write' && failNextCredentialWrite) { failNextCredentialWrite = false; throw new Error('synthetic keychain write failure'); }
      return originalCredentialTransport(action, value);
    };
    try {
      await fillManualDialog('br', manualPassword); await submitManualDialog();
      await untilUI(ui, 'document.getElementById("dialog-error").textContent.length>0');
      check('a failed keychain write keeps the masked form and entered values for retry', await ui(`(()=>{const n=document.getElementById("edit-name"),p=document.getElementById("edit-password");return !document.getElementById("dialog-backdrop").hidden&&n.value===${JSON.stringify(manualUsername)}&&p.value===${JSON.stringify(manualPassword)}&&p.type==="password"})()`));
      await submitManualDialog();
      await untilUI(ui, 'document.getElementById("dialog-backdrop").hidden && document.querySelectorAll("#credentials .credential").length===3');
    } finally { runtimeVault.transport = originalCredentialTransport; }
    let manualRecords = await vault.list();
    const brazilManual = manualRecords.find(record => record.username === manualUsername && record.origin === 'https://naruto.narutowebgame.com');
    check('manual Brazil credential saves trimmed username and exact password without exposing password in list', !!brazilManual &&
      (await vault.selected(brazilManual.id, brazilManual.origin))?.password === manualPassword &&
      manualRecords.every(record => !Object.prototype.hasOwnProperty.call(record, 'password')));
    await openManualDialog(); await fillManualDialog('br', manualPassword); await submitManualDialog();
    await untilUI(ui, 'document.getElementById("dialog-backdrop").hidden');
    check('same site username and password does not create a duplicate', (await vault.list()).filter(record => record.origin === brazilManual!.origin && record.username === manualUsername).length === 1);
    await openManualDialog(); await fillManualDialog('br', changedManualPassword); await submitManualDialog();
    await untilUI(ui, 'document.getElementById("dialog-title").textContent==="更新已保存密码？"');
    check('updating an existing password requires confirmation and does not show the secret in the confirmation step', await ui('(()=>{const p=document.getElementById("edit-password");return p.hidden&&p.value===""&&document.getElementById("dialog-save").textContent==="确认更新"})()'));
    await ui('document.getElementById("dialog-cancel").click()'); await untilUI(ui, 'document.getElementById("dialog-backdrop").hidden');
    check('cancelling a duplicate update leaves the old password unchanged', (await vault.selected(brazilManual!.id, brazilManual!.origin))?.password === manualPassword);
    await openManualDialog(); await fillManualDialog('br', changedManualPassword); await submitManualDialog();
    await untilUI(ui, 'document.getElementById("dialog-title").textContent==="更新已保存密码？"');
    await ui('document.getElementById("dialog-save").click()'); await untilUI(ui, 'document.getElementById("dialog-backdrop").hidden');
    check('confirmed update replaces the same Brazil record', (await vault.selected(brazilManual!.id, brazilManual!.origin))?.password === changedManualPassword && (await vault.list()).length === 3);
    await openManualDialog(); await fillManualDialog('cn', chinaManualPassword); await submitManualDialog();
    await untilUI(ui, 'document.getElementById("dialog-backdrop").hidden && document.querySelectorAll("#credentials .credential").length===4');
    manualRecords = await vault.list();
    const chinaManual = manualRecords.find(record => record.username === manualUsername && record.origin === 'https://huoying.qq.com');
    check('same username on China and Brazil stays in separate site records', !!chinaManual && chinaManual.id !== brazilManual!.id &&
      (await vault.selected(chinaManual.id, chinaManual.origin))?.password === chinaManualPassword && manualRecords.length === 4);
    const invalidManualRequests = await ui(`Promise.all([
      window.naruto.addCredential("unsupported",${JSON.stringify(manualUsername)},"synthetic-password").then(()=>false,()=>true),
      window.naruto.addCredential("br","","synthetic-password").then(()=>false,()=>true)
    ])`);
    check('main process rejects unsupported sites and empty usernames', invalidManualRequests[0] && invalidManualRequests[1]);
    check('credential list API returns metadata without password fields', await ui('window.naruto.credentials().then(items=>items.every(item=>!Object.prototype.hasOwnProperty.call(item,"password")))'));
    let notifyPendingWrite: () => void = () => {};
    let releasePendingWrite: () => void = () => {};
    const pendingWriteStarted = new Promise<void>(resolve => { notifyPendingWrite = resolve; });
    const pendingWriteGate = new Promise<void>(resolve => { releasePendingWrite = resolve; });
    const lateUsername = `${manualUsername}-late`;
    let delayNextCredentialWrite = true;
    runtimeVault.transport = async (action: string, value?: string) => {
      if (action === 'write' && delayNextCredentialWrite) { delayNextCredentialWrite = false; notifyPendingWrite(); await pendingWriteGate; }
      return originalCredentialTransport(action, value);
    };
    try {
      await openManualDialog(); await fillManualDialog('br', 'synthetic-late-write', lateUsername); await submitManualDialog();
      await pendingWriteStarted;
      check('saving disables account fields and repeat submission while keeping cancel available', await ui('(()=>{const ids=["edit-name","edit-password","credential-site","dialog-save"],c=document.getElementById("dialog-cancel");return ids.every(id=>document.getElementById(id).disabled)&&!c.disabled})()'));
      await ui('document.getElementById("dialog-cancel").click()'); await untilUI(ui, 'document.getElementById("dialog-backdrop").hidden');
      await openManualDialog();
      releasePendingWrite();
      await untilUI(ui, 'document.getElementById("toast").textContent==="已保存到 macOS 钥匙串"');
      check('a late save result does not close or overwrite a newly opened form', await ui('!document.getElementById("dialog-backdrop").hidden&&document.getElementById("dialog-title").textContent==="新增已保存密码"&&document.getElementById("edit-name").value===""&&document.getElementById("edit-password").value===""'));
    } finally { releasePendingWrite(); runtimeVault.transport = originalCredentialTransport; }
    const lateRecord = (await vault.list()).find(record => record.username === lateUsername && record.origin === 'https://naruto.narutowebgame.com');
    check('closing during a write clears temporary form values and keeps the submitted test record isolated', !!lateRecord &&
      await ui('document.getElementById("edit-name").value===""&&document.getElementById("edit-password").value===""'));
    await fillManualDialog('br', 'synthetic-cleared-on-exit');
    await ui('window.naruto.command({type:"settings"})'); await untilUI(ui, 'window.naruto.state().then(s=>!s.settingsOpen)&&document.getElementById("dialog-backdrop").hidden');
    check('leaving Settings while the add form is open clears temporary values', await ui('document.getElementById("edit-name").value===""&&document.getElementById("edit-password").value===""&&document.getElementById("credential-site").options.length===0'));
    if (lateRecord) await vault.remove(lateRecord.id);
    await ui('window.naruto.command({type:"settings"})'); await untilUI(ui, 'window.naruto.state().then(s=>s.settingsOpen)');
    await openManualDialog(); await fillManualDialog('br', 'synthetic-preview-only-password');
    await untilUI(ui, 'document.getElementById("toast").hidden');
    for (const [width, height] of [[1280, 850], [800, 560]]) {
      win.setContentSize(width, height); await pause(120);
      const image = await captureWithin(win.capturePage(), 3000);
      if (!image) throw new Error(`manual-credential-preview-capture-timeout-${width}x${height}`);
      fs.writeFileSync(path.join(directory, `manual-credential-${width}x${height}.png`), image.toPNG());
      check(`manual password form fits the ${width}x${height} preview with its password masked`, await ui(`(()=>{const p=document.getElementById("edit-password"),r=document.getElementById("dialog-backdrop").getBoundingClientRect();return !document.getElementById("dialog-backdrop").hidden&&p.type==="password"&&r.top>=0&&r.bottom<=innerHeight})()`));
    }
    win.setContentSize(1280, 850); await ui('document.getElementById("dialog-cancel").click()'); await untilUI(ui, 'document.getElementById("dialog-backdrop").hidden');
    check('cancelling clears temporary username and password inputs', await ui('document.getElementById("edit-name").value===""&&document.getElementById("edit-password").value===""&&document.getElementById("credential-site").options.length===0'));
    await vault.remove(brazilManual!.id); await vault.remove(chinaManual!.id);
    await ui('document.getElementById("reload-credentials").click()'); await untilUI(ui, 'document.querySelectorAll("#credentials .credential").length===2');
    await ui('document.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));document.getElementById("theme-select").focus()');
    check('actual shell suppresses pointer focus frames on all settings selects', await ui('document.documentElement.dataset.inputModality === "pointer" && ["theme-select","title-mode","lobby-bg-mode","flash-select"].every(id=>{const e=document.getElementById(id);e.focus();const s=getComputedStyle(e);return s.outlineStyle==="none"&&s.boxShadow==="none"})'));
    const keyboardFocus = await ui('(()=>{const e=document.getElementById("theme-select");e.blur();document.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",bubbles:true}));e.focus();return {modality:document.documentElement.dataset.inputModality,active:document.activeElement.id,boxShadow:getComputedStyle(e).boxShadow}})()');
    if (keyboardFocus.modality !== 'keyboard' || keyboardFocus.boxShadow === 'none') console.log('FOCUS_MODALITY_DIAGNOSTIC', JSON.stringify(keyboardFocus));
    check('actual shell retains keyboard focus frames on settings selects', keyboardFocus.modality === 'keyboard' && keyboardFocus.boxShadow !== 'none');
    nativeTheme.themeSource = 'light'; await pause(200);
    check('system theme follows native light appearance', await ui('document.documentElement.dataset.dark === "false"'));
    check('scheme C toolbar and tab dimensions', await ui('document.querySelector(".chrome").getBoundingClientRect().height === 42 && document.querySelector(".tab").getBoundingClientRect().height === 28'));
    check('game surface starts below compact toolbar', games.top === 42 && first.view.getBounds().y === 42);
    await ui('document.getElementById("theme-select").value="dark";document.getElementById("theme-select").dispatchEvent(new Event("change"))'); await pause(200);
    check('theme control updates native and shell appearance', String(nativeTheme.themeSource) === 'dark' && await ui('document.documentElement.dataset.dark === "true"'));
    await ui('document.getElementById("title-mode").value="custom";document.getElementById("title-mode").dispatchEvent(new Event("change"))'); await pause(200);
    await ui('document.getElementById("title-color").value="#294059";document.getElementById("title-color").dispatchEvent(new Event("input"));document.getElementById("title-color").dispatchEvent(new Event("change"))'); await pause(200);
    check('custom color affects titlebar only', await ui('getComputedStyle(document.querySelector(".chrome")).backgroundColor === "rgb(41, 64, 89)" && getComputedStyle(document.getElementById("settings-panel")).backgroundColor === "rgb(32, 32, 32)"'));
    const persisted = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'layout.json'), 'utf8'));
    check('appearance saved to isolated configuration', persisted.preferences.theme === 'dark' && persisted.preferences.titleBarColor === '#294059');
    await ui('window.naruto.command({type:"title-color",value:null})');
    check('default titlebar color restored', await ui('getComputedStyle(document.querySelector(".chrome")).backgroundColor === "rgb(39, 39, 39)"'));
    await ui('window.naruto.command({type:"theme",value:"system"})');
    await ui('window.naruto.command({type:"settings"})');
    await first.view.webContents.loadURL(origin + '/pt/fixture-success'); await pause(3000);
    const pluginInfo = await first.view.webContents.executeJavaScript('Array.from(navigator.plugins).map(p=>({name:p.name,description:p.description}))');
    if (process.env.NARUTO_TEST_HIDDEN === '1') {
      skip('real Flash pixel rendering requires a visible compositor; hidden integration keeps the user desktop undisturbed');
    } else {
      const bounds = await first.view.webContents.executeJavaScript('(()=>{let r=document.getElementById("flash").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),width:1,height:1}})()');
      const flashImage = await captureWithin(first.view.webContents.capturePage(bounds), 5000);
      const pixel = flashImage?.getBitmap();
      check('real Flash renders authored SWF', !!pixel && Math.abs(pixel[0] - 90) < 8 && Math.abs(pixel[1] - 129) < 8 && Math.abs(pixel[2] - 100) < 8);
    }
    check('Flash preserves aspect ratio', await first.view.webContents.executeJavaScript('(()=>{const r=document.getElementById("flash").getBoundingClientRect();return Math.abs(r.width/r.height-2)<.01})()'));
    // Exercise the GameSessions reload on a live Flash document. Brazil's shell
    // button now intentionally starts the WebKit recovery flow instead.
    const gameContents = first.view.webContents;
    const oldDocument = await gameContents.executeJavaScript('performance.timeOrigin');
    const otherGeneration = second.generation;
    let unloadPrompts = 0;
    const observedUnload = () => { unloadPrompts++; };
    gameContents.on('will-prevent-unload', observedUnload);
    await gameContents.executeJavaScript('window.onbeforeunload=()=>false;document.body.click()', true);
    games.refresh(first.id); await pause(1200);
    check('GameSessions reloads the Flash document despite website unload protection', unloadPrompts === 1 && await gameContents.executeJavaScript('performance.timeOrigin') > oldDocument && first.state === 'ready');
    check('GameSessions refresh preserves session and leaves other tab unchanged', await gameContents.executeJavaScript('document.cookie.includes("naruto_fixture=alpha") && !!document.getElementById("flash")') && second.generation === otherGeneration);
    gameContents.removeListener('will-prevent-unload', observedUnload);
    const chinaContents = second.view.webContents;
    second.region = 'cn'; games.select(second.id);
    const chinaDocument = await chinaContents.executeJavaScript('performance.timeOrigin');
    await chinaContents.executeJavaScript('window.onbeforeunload=()=>false;document.body.click()', true);
    let chinaUnloadPrompts = 0; const observedChinaUnload = () => { chinaUnloadPrompts++; };
    chinaContents.on('will-prevent-unload', observedChinaUnload);
    await ui('document.getElementById("refresh").click()'); await pause(1200);
    check('China toolbar refresh remains an ordinary page reload', chinaUnloadPrompts === 1 && await chinaContents.executeJavaScript('performance.timeOrigin') > chinaDocument && second.state === 'ready');
    chinaContents.removeListener('will-prevent-unload', observedChinaUnload); second.region = 'br'; games.select(first.id);
    await first.view.webContents.loadURL(ENTRY_URL);
    await first.view.webContents.executeJavaScript('void window.open("https://navigation-fixture.test/news/example", "_blank")'); await pause(900);
    check('cross-site popup stays inside launcher', first.view.webContents.getURL().startsWith('https://navigation-fixture.test/') && !first.view.webContents.isDestroyed());
    await first.view.webContents.loadURL(ENTRY_URL); await pause(400);
    await first.view.webContents.executeJavaScript('document.getElementById("username").value="fixture-alpha"; document.getElementById("password").value="synthetic-password-updated";document.querySelector("form").requestSubmit()');
    await pause(1600);
    check('password update prompt after login', await ui('window.naruto.state().then(s=>s.prompt?.username==="fixture-alpha" && s.prompt.update)'));
    const promptPoint = () => ui('(()=>{const b=document.getElementById("save-password"),r=b.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.id}})()');
    check('save prompt is visible and hit-testable above background', (await promptPoint()).hit === 'save-password' && first.view.getBounds().y === 86);
    await first.view.webContents.loadURL('https://s776-naruto.oasgames.com/pt/fixture-success'); await pause(1000);
    check('save prompt survives Brazil server navigation with original credential origin', await ui('window.naruto.state().then(s=>s.prompt?.origin==="https://naruto.narutowebgame.com" && !document.getElementById("save-prompt").hidden)'));
    const savePoint = await promptPoint(); win.webContents.focus();
    win.webContents.sendInputEvent({ type: 'mouseDown', x: savePoint.x, y: savePoint.y, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: savePoint.x, y: savePoint.y, button: 'left', clickCount: 1 });
    await pause(500);
    const alpha = (await vault.list(origin)).find(r => r.username === 'fixture-alpha')!;
    check('password update saved to test keychain', (await vault.selected(alpha.id, origin))?.password === 'synthetic-password-updated');
    check('saving removes prompt and restores 42px game inset', first.view.getBounds().y === 42 && await ui('document.getElementById("save-prompt").hidden'));
    await first.view.webContents.loadURL(ENTRY_URL); await pause(250);
    await first.view.webContents.executeJavaScript('document.getElementById("username").value="fixture-alpha";document.getElementById("password").value="synthetic-unused-update";document.querySelector("form").requestSubmit()');
    await pause(1400);
    check('new submission stages another save decision', await ui('window.naruto.state().then(s=>!!s.prompt)'));
    await first.view.webContents.loadURL('https://navigation-fixture.test/unrelated'); await pause(1000);
    check('unrelated navigation clears prompt and inset together', first.view.getBounds().y === 42 && await ui('window.naruto.state().then(s=>!s.prompt && document.getElementById("save-prompt").hidden)'));

    const confirmOriginal = await recoveryFixtureTab(games);
    const confirmCandidate = await recoveryFixtureTab(games);
    const loadingProbe = pendingRecovery(confirmOriginal.id, 'loading', confirmCandidate.id);
    confirmCandidate.recoveryStage = 'loading'; games.select(confirmCandidate.id); await pause(120);
    check('candidate loading keeps unique tabs, blocks original close, and disables refresh',
      (await ui('window.naruto.state().then(s=>!s.refresh.enabled && new Set(s.tabs.map(t=>t.id)).size===s.tabs.length && s.tabs.find(t=>t.id===' + JSON.stringify(confirmOriginal.id) + ').closeDisabled)')) &&
      refreshMenu?.enabled === false && confirmOriginal.view.webContents && games.tabs.includes(confirmOriginal));
    const loadingGeneration = confirmCandidate.generation;
    await ui('window.naruto.command({type:"refresh"})');
    check('refresh during candidate loading does not navigate or start another attempt', confirmCandidate.generation === loadingGeneration && (webLogin as any).pending === loadingProbe.attempt);
    await ui(`window.naruto.command({type:"close",id:${JSON.stringify(confirmOriginal.id)}})`);
    check('direct original close command is refused before candidate confirmation', games.tabs.includes(confirmOriginal) && games.tabs.includes(confirmCandidate) && (webLogin as any).pending === loadingProbe.attempt);
    loadingProbe.attempt.stage = 'confirming'; confirmCandidate.recoveryStage = 'confirming'; games.select(confirmCandidate.id); await pause(150);
    for (const [width, height] of [[800, 560], [1280, 850]]) {
      win.setContentSize(width, height); await pause(150);
      const preview = await ui(`(()=>{const bar=document.getElementById('recovery-prompt'),done=document.getElementById('complete-recovery'),cancel=document.getElementById('cancel-recovery'),b=bar.getBoundingClientRect(),d=done.getBoundingClientRect(),c=cancel.getBoundingClientRect();return {visible:!bar.hidden,text:document.getElementById('recovery-text').textContent,buttons:done.textContent==='完成切换'&&cancel.textContent==='取消',inside:b.top>=42&&b.bottom<=innerHeight&&d.right<=innerWidth&&c.bottom<=innerHeight}})()`);
      const uniqueTabs = await ui('window.naruto.state().then(s=>new Set(s.tabs.map(t=>t.id)).size===s.tabs.length)');
      check(`confirmation bar and controls are visible at ${width}x${height}`, preview.visible && preview.text === '确认新游戏可以正常操作后，完成切换。' && preview.buttons && preview.inside && uniqueTabs && games.top === 86 && confirmCandidate.view.getBounds().y === 86);
    }
    await ui('document.getElementById("complete-recovery").click()');
    check('explicit completion click closes old page and keeps the new page active', !games.tabs.includes(confirmOriginal) && games.tabs.includes(confirmCandidate) && games.activeId === confirmCandidate.id && !(webLogin as any).pending);
    loadingProbe.clear(); games.close(confirmCandidate.id);

    const closeOriginal = await recoveryFixtureTab(games);
    const closeCandidate = await recoveryFixtureTab(games);
    const unrelatedActive = await recoveryFixtureTab(games);
    const closeProbe = pendingRecovery(closeOriginal.id, 'confirming', closeCandidate.id, 'br-2');
    closeCandidate.recoveryStage = 'confirming'; games.select(closeCandidate.id); await pause(120);
    const recoveryDeleteRefused = await ui('window.naruto.command({type:"profile-delete",id:"br-2"}).then(()=>false,e=>e.message.includes("登录/恢复任务"))');
    check('main process refuses deletion while the account is held by a recovery task', recoveryDeleteRefused && !(await ui('window.naruto.state()')).profiles.find((profile: any) => profile.id === 'br-2')?.cleanupStatus);
    await ui(`window.naruto.command({type:"select",id:${JSON.stringify(unrelatedActive.id)}})`);
    await ui(`window.naruto.command({type:"close",id:${JSON.stringify(closeOriginal.id)}})`);
    check('closing the original during background confirmation preserves the selected game', !games.tabs.includes(closeOriginal) && games.tabs.includes(closeCandidate) && games.activeId === unrelatedActive.id && !(webLogin as any).pending);
    closeProbe.clear(); games.close(closeCandidate.id); games.close(unrelatedActive.id);

    const foregroundCloseOriginal = await recoveryFixtureTab(games);
    const foregroundCloseNeighbor = await recoveryFixtureTab(games);
    const foregroundCloseCandidate = await recoveryFixtureTab(games);
    const foregroundCloseProbe = pendingRecovery(foregroundCloseOriginal.id, 'confirming', foregroundCloseCandidate.id, 'br-2');
    foregroundCloseCandidate.recoveryStage = 'confirming'; games.select(foregroundCloseOriginal.id); await pause(120);
    await ui(`window.naruto.command({type:"close",id:${JSON.stringify(foregroundCloseOriginal.id)}})`);
    check('closing the selected original during confirmation selects the candidate, not its tab neighbor',
      !games.tabs.includes(foregroundCloseOriginal) && games.tabs.includes(foregroundCloseNeighbor) &&
      games.tabs.includes(foregroundCloseCandidate) && games.activeId === foregroundCloseCandidate.id && !(webLogin as any).pending);
    foregroundCloseProbe.clear(); games.close(foregroundCloseNeighbor.id); games.close(foregroundCloseCandidate.id);

    const destroyedOriginal = await recoveryFixtureTab(games);
    const destroyedCandidate = await recoveryFixtureTab(games);
    const destroyedProbe = pendingRecovery(destroyedOriginal.id, 'loading', destroyedCandidate.id);
    destroyedCandidate.recoveryStage = 'loading'; games.select(destroyedCandidate.id);
    const destroyedCancelOffset = cancellationTasks.length;
    games.close(destroyedOriginal.id);
    destroyedProbe.finish(); await until(() => !(webLogin as any).pending);
    cancellationTasks.length = destroyedCancelOffset; destroyedProbe.clear();
    check('unexpected original destruction cancels recovery and removes its candidate without restoring a stale tab', !games.tabs.includes(destroyedOriginal) && !games.tabs.includes(destroyedCandidate) && !(webLogin as any).pending && (!games.activeId || games.tabs.some(t=>t.id===games.activeId)));

    const secondContents = second.view.webContents;
    games.close(second.id); check('closing destroys only target', secondContents.isDestroyed() && !first.view.webContents.isDestroyed());
    await ui(`window.naruto.command({type:"close",id:"${first.id}"})`); check('last tab stays empty', games.tabs.length === 0 && games.activeId === null && await ui('window.naruto.state().then(s=>s.tabs.length===0)'));
    await pause(300); check('empty state open button', await ui('!document.getElementById("open-game").hidden'));
    await ui('window.naruto.command({type:"region",value:"br"})');
    for (let index = 0; index < 10; index++) await ui(`window.naruto.command({type:"profile-create",name:${JSON.stringify(`合成滚动档案${index + 1}`)},serverNote:""})`);
    const longName = '合成演示用的超长账号名称用于检查胶囊和列表省略显示';
    await ui(`window.naruto.command({type:"profile-update",id:"br-2",name:${JSON.stringify(longName)},serverNote:""})`);
    await ui('window.naruto.command({type:"profile-select",id:"br-2"})');
    await untilUI(ui, 'window.naruto.state().then(s=>s.preferences.region==="br" && s.selectedProfileId==="br-2")');
    win.setContentSize(800, 560); await pause(150);
    await ui('document.getElementById("lobby-current").click()');
    const longOption = await ui(`(()=>{const option=document.querySelector('#profile-deck [data-id="br-2"]'),name=option.querySelector('b'),deck=document.getElementById('profile-deck'),r=deck.getBoundingClientRect();return {title:option.title,text:name.textContent,overflow:getComputedStyle(name).textOverflow,truncated:name.scrollWidth>name.clientWidth,emptyNote:!option.querySelector('small')&&document.getElementById('profile-choice-note').hidden,scrollable:deck.scrollHeight>deck.clientHeight,inside:r.top>=42&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth}})()`);
    await ui('document.getElementById("profile-deck").dispatchEvent(new KeyboardEvent("keydown",{key:"End",bubbles:true}))'); await pause(50);
    const deckScroll = await ui('(()=>{const deck=document.getElementById("profile-deck");return {top:deck.scrollTop,height:deck.clientHeight,scrollHeight:deck.scrollHeight}})()');
    check('long account names truncate with a full-name tooltip, empty notes stay hidden, and long profile lists scroll',
      longOption.title === longName && longOption.text === longName && longOption.overflow === 'ellipsis' && longOption.truncated && longOption.emptyNote &&
      longOption.scrollable && longOption.inside && deckScroll.top > 0 && deckScroll.scrollHeight > deckScroll.height);
    const longListPreview = await captureWithin(win.capturePage(), 3000);
    if (longListPreview) fs.writeFileSync(path.join(directory, 'lobby-long-list-800x560.png'), longListPreview.toPNG());
    await ui('document.getElementById("profile-deck").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    await ui('window.naruto.command({type:"profile-update",id:"br-2",name:"合成巴西账号B",serverNote:"合成二区"})');
    await untilUI(ui, 'window.naruto.state().then(s=>s.profiles.find(p=>p.id==="br-2").name==="合成巴西账号B")');
    win.setContentSize(1280, 850); await pause(100);
    let remainingBrazil = (await ui('window.naruto.state()')).profiles.filter((profile: any) => profile.region === 'br').map((profile: any) => profile.id);
    if (!await ui('window.naruto.state().then(s=>s.settingsOpen)')) await ui('window.naruto.command({type:"settings"})');
    await untilUI(ui, 'window.naruto.state().then(s=>s.settingsOpen)');
    for (const id of remainingBrazil) {
      await ui(`document.querySelector('#profile-list [data-id="${id}"] [data-action=delete]').click()`);
      await pause(50); await ui('document.getElementById("dialog-save").click()');
      await untilUI(ui, `window.naruto.state().then(s=>!s.profiles.some(p=>p.id===${JSON.stringify(id)}))`);
      await untilUI(ui, 'document.getElementById("dialog-backdrop").hidden');
    }
    await ui('document.getElementById("close-settings").click()'); await pause(80);
    check('empty region shows no accounts, disables start, and offers direct profile creation',
      await ui('document.getElementById("lobby-account-name").textContent==="暂无账号档案" && document.getElementById("open-game").disabled && !document.getElementById("lobby-create-profile").hidden'));
    await ui('document.getElementById("lobby-create-profile").click()'); await pause(50);
    await ui('document.getElementById("edit-name").value="空状态新建账号";document.getElementById("edit-server-note").value="";document.getElementById("edit-form").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))');
    await untilUI(ui, 'window.naruto.state().then(s=>s.profiles.some(p=>p.name==="空状态新建账号"))');
    check('creating from the empty-state entry selects the new profile and enables start',
      (await ui('window.naruto.state()')).selectedProfileId !== null && await ui('document.getElementById("lobby-account-name").textContent==="空状态新建账号" && !document.getElementById("open-game").disabled'));
    console.log('INTEGRATION_COMPLETE', results.length);
    fs.writeFileSync(path.join(directory, 'integration.json'), JSON.stringify({ ok: true, results, skipped, diagnostics, plugins: pluginInfo }, null, 2));
  } catch (error) {
    console.error('INTEGRATION_ERROR', (error as Error).message);
    releaseRecoveryProbe?.(); releaseRecoveryProbe = undefined;
    fs.writeFileSync(path.join(directory, 'integration.json'), JSON.stringify({ ok: false, results, skipped, diagnostics, error: (error as Error).message }, null, 2));
    finish(1); return;
  } finally {
    clearTimeout(watchdog);
    // This helper command can only delete the dedicated synthetic test service.
    execFileSync(path.join(root, 'dist/native/keychain'), { input: JSON.stringify({ action: 'delete-test', service: 'cn.youye.naruto-os.test.integration' }), stdio: ['pipe', 'ignore', 'ignore'] });
  }
  finish(0);
}
