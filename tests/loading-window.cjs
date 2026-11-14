// Minimal original spinner repro, without debugger or site compatibility code.
const { app, BrowserWindow } = require('electron');
const { GameSessions } = require('../dist/main/game.login-test.cjs');
const fs = require('fs'), path = require('path'), assert = require('assert');
const profile = process.env.NARUTO_LOGIN_TEST_PROFILE;
assert(profile && profile.startsWith(path.resolve('.test-artifacts') + path.sep));
app.setPath('userData', profile);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
  const games = new GameSessions(win, () => {}, () => {}, 'about:blank');
  const tab = games.create({ id: 'loading-regression-' + Date.now(), name: '' }); games.select(tab.id);
  const wc = tab.view.webContents;
  const watchdog = setTimeout(() => app.exit(1), 8000);
  try {
    await new Promise(resolve => wc.once('did-finish-load', resolve));
    const events = [];
    for (const name of ['did-start-loading', 'did-finish-load', 'did-stop-loading']) wc.on(name, () => events.push({ name, state: tab.state, loading: wc.isLoading() }));
    wc.session.protocol.interceptBufferProtocol('https', (request, callback) => callback({ mimeType: 'text/html', data: Buffer.from(request.url.includes('/child') ? '<body>child loaded</body>' : `<body><script>addEventListener('load',()=>setTimeout(()=>{var frame=document.createElement('iframe');frame.src='https://offline.fixture.test/child';document.body.append(frame)},100))</script>`) }));
    await wc.loadURL('https://offline.fixture.test/root');
    await new Promise(resolve => setTimeout(resolve, 600));
    const stopped = events.filter(event => event.name === 'did-stop-loading');
    assert(stopped.length >= 2 && !wc.isLoading() && tab.state === 'ready');
    assert(events.some(event => event.name === 'did-start-loading' && event.state === 'ready'));
    fs.writeFileSync('.test-artifacts/loading-regression.json', JSON.stringify({ ok: true, events, state: tab.state, loading: wc.isLoading() }, null, 2));
    console.log('PASS original late-iframe spinner repro now finishes ready');
    clearTimeout(watchdog); games.destroy(); win.close(); app.quit();
  } catch (error) { console.error(error); clearTimeout(watchdog); app.exit(1); }
});
