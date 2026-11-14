const { app, BrowserWindow, session, ipcMain, Menu } = require('electron');
const { startLogin } = require('./webkit-handoff.cjs');
const path = require('path');
const directory = process.env.NARUTO_WEBKIT_DIRECTORY;
if (!directory || !path.resolve(directory).startsWith(path.resolve(__dirname, '../.test-artifacts') + path.sep)) process.exit(1);
app.setName('Naruto 登录兼容性原型');
app.setPath('userData', path.join(directory, 'electron-profile'));
const { GameSessions } = require(path.join(directory, 'main/game.js'));
const { findFlash } = require(path.join(directory, 'main/flash.js'));
const flash = findFlash(path.resolve(__dirname, '..'), '34');
if (flash.available) {
  app.commandLine.appendSwitch('ppapi-flash-path', flash.path);
  app.commandLine.appendSwitch('ppapi-flash-version', flash.version);
}
let login, games, window, quitting = false;
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { quitting = true; login?.cancel(); games?.destroy(); });
app.whenReady().then(async () => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '原型', submenu: [{ role: 'quit' }] },
    { label: '编辑', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '游戏', submenu: [{ label: '刷新', accelerator: 'CmdOrCtrl+R', click: () => games?.refresh() }] }
  ]));
  // The ordinary preload has no access to the real account vault in this prototype.
  for (const channel of ['game:form-state', 'game:candidates', 'game:submitted']) ipcMain.handle(channel, () => ({ ok: true, value: channel === 'game:candidates' ? [] : null }));
  login = startLogin(process.env.NARUTO_WEBKIT_HELPER, { onReady: () => console.log('现代登录页面已就绪。登录并选择区服后，会打开 Flash 游戏窗口。') });
  try {
    const handoff = await login.result;
    if (quitting) return;
    const id = 'webkit-prototype';
    const target = session.fromPartition('naruto-' + id);
    // Every Cookie must be imported successfully before GameSessions can navigate.
    for (const cookie of handoff.cookies) await target.cookies.set(cookie);
    if (quitting) return;
    window = new BrowserWindow({ width: 1280, height: 800, title: 'Naruto Flash · 登录兼容性原型',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    games = new GameSessions(window, () => { if (!quitting) games?.layout(); }, () => {});
    games.top = 0;
    const tab = games.create({ id, name: '巴西服', region: 'br' }, handoff.url);
    games.select(tab.id);
    console.log('会话交接完成，已打开 Flash 游戏窗口。');
  } catch {
    if (!quitting) console.log('登录原型已结束，或会话未能交接。');
    app.quit();
  }
});
