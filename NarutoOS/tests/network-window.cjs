const { app, BrowserWindow, session } = require('electron');
const { GameSessions } = require('../dist/main/game.network-test.cjs');
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert');
const profile = process.env.NARUTO_NETWORK_TEST_PROFILE;
assert(profile && profile.startsWith(path.resolve('.test-artifacts') + path.sep));
app.setPath('userData', profile);
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
app.whenReady().then(async () => {
  let targetHits = 0, proxyHits = 0;
  const results = [], check = (name, value) => { assert(value, name); results.push(name); console.log('PASS', name); };
  const target = http.createServer((req, res) => { targetHits++; res.writeHead(req.url === '/forbidden' ? 403 : 200, { 'Content-Type': 'text/html', Connection: 'close' }); res.end('<body>Offline direct fixture</body>'); });
  const proxy = http.createServer((_req, res) => { proxyHits++; res.writeHead(502, { Connection: 'close' }); res.end('Synthetic proxy refusal'); });
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
  let games;
  const watchdog = setTimeout(() => { console.error('Network fixture timeout'); app.exit(1); }, 25000);
  try {
    await listen(target); await listen(proxy);
    const url = `http://127.0.0.1:${target.address().port}/entry`;
    const config = { proxyRules: `127.0.0.1:${proxy.address().port}`, proxyBypassRules: '<-loopback>' };
    const tabSession = session.fromPartition('naruto-direct-network-regression');
    const control = session.fromPartition('network-control-session');
    await Promise.all([tabSession.setProxy(config), control.setProxy(config)]);
    const defaultBefore = await session.defaultSession.resolveProxy(url);
    check('fixture initially resolves through the synthetic refusing proxy', (await tabSession.resolveProxy(url)).startsWith('PROXY '));
    games = new GameSessions(win, () => {}, () => {}, url, true);
    const tab = games.create({ id: 'direct-network-regression', name: '' }); games.select(tab.id);
    await new Promise((resolve, reject) => { tab.view.webContents.once('did-finish-load', resolve); tab.view.webContents.once('did-fail-load', (_e, code) => reject(new Error('Direct fixture failed: ' + code))); });
    check('first page request reaches local target directly', targetHits >= 1 && proxyHits === 0);
    check('tab resolves HTTP through DIRECT', await tabSession.resolveProxy(url) === 'DIRECT');
    check('tab resolves HTTPS through DIRECT', await tabSession.resolveProxy('https://naruto.narutowebgame.com/pt/serverlist') === 'DIRECT');
    check('other private sessions retain their proxy configuration', (await control.resolveProxy(url)).startsWith('PROXY '));
    check('default session retains original proxy configuration', await session.defaultSession.resolveProxy(url) === defaultBefore);
    const second = games.create({ id: 'direct-network-second', name: '' });
    await new Promise(resolve => second.view.webContents.once('did-finish-load', resolve));
    check('new tabs inherit the temporary direct mode', await second.view.webContents.session.resolveProxy(url) === 'DIRECT' && proxyHits === 0);
    const normalGames = new GameSessions(win, () => {}, () => {}, 'about:blank', false);
    const normal = normalGames.create({ id: 'system-proxy-regression', name: '' }); normalGames.select(normal.id);
    await normal.view.webContents.session.setProxy(config);
    check('normal game Session honors its configured proxy instead of forcing DIRECT', (await normal.view.webContents.session.resolveProxy(url)).startsWith('PROXY '));
    await new Promise(resolve => setTimeout(resolve, 100));
    normalGames.destroy();
    const errorGames = new GameSessions(win, () => {}, () => {}, `${url.replace('/entry', '/forbidden')}`, true);
    const forbidden = errorGames.create({ id: 'main-frame-http-error-regression', name: '' }); errorGames.select(forbidden.id);
    await new Promise((resolve, reject) => { forbidden.view.webContents.once('did-finish-load', resolve); forbidden.view.webContents.once('did-fail-load', (_e, code) => reject(new Error('HTTP error fixture failed: ' + code))); });
    check('main-frame HTTP 403 stays failed instead of becoming ready', forbidden.state === 'failed');
    await new Promise(resolve => setTimeout(resolve, 100)); errorGames.destroy();
    const prepared = [];
    const regional = new GameSessions(win, () => {}, () => {}, undefined, false, undefined, () => {}, async contents => { prepared.push(contents.id); });
    try {
      for (const [region, expected] of [['br', 'https://naruto.narutowebgame.com/pt/serverlist'], ['cn', 'https://huoying.qq.com/server/website/']]) {
        const id = `region-${region}-regression`;
        const seen = [];
        session.fromPartition(`naruto-${id}`).protocol.interceptBufferProtocol('https', (request, callback) => {
          seen.push(request.url);
          callback({ mimeType: 'text/html', data: Buffer.from('<title>Isolated regional fixture</title>') });
        });
        const tab = regional.create({ id, name: '', region });
        await new Promise((resolve, reject) => { tab.view.webContents.once('did-finish-load', resolve); tab.view.webContents.once('did-fail-load', (_e, code) => reject(new Error('Regional fixture failed: ' + code))); });
        check(`${region} opens its exact official entry through offline interception`, seen[0] === expected && tab.view.webContents.getURL() === expected && tab.entry === expected);
        check(`${region} records its region independently of other sessions`, tab.region === region);
        check(`${region} resource bridge follows the tab region`, prepared.includes(tab.view.webContents.id) === (region === 'br'));
        regional.select(tab.id);
        const reloaded = new Promise((resolve, reject) => { tab.view.webContents.once('did-finish-load', resolve); tab.view.webContents.once('did-fail-load', (_e, code) => reject(new Error('Regional refresh failed: ' + code))); });
        regional.refresh(tab.id); await reloaded;
        check(`${region} refresh retains its entry and region`, tab.view.webContents.getURL() === expected && tab.region === region);
        regional.muted = true; regional.syncAudio();
        check(`${region} shared mute applies`, tab.view.webContents.isAudioMuted());
        regional.muted = false; regional.syncAudio();
      }
    } finally {
      // Leave did-finish-load's native callback before destroying its WebContents (Electron 11).
      await new Promise(resolve => setTimeout(resolve, 100));
      regional.destroy();
    }
    fs.writeFileSync('.test-artifacts/network-regression.json', JSON.stringify({ ok: true, results }, null, 2));
    clearTimeout(watchdog); games.destroy(); win.close(); target.close(); proxy.close(); app.quit();
  } catch (error) { console.error(error); clearTimeout(watchdog); app.exit(1); }
});
