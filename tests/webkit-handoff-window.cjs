const { app, BrowserWindow, session } = require('electron');
const { startLogin, validateHandoff } = require('../scripts/webkit-handoff.cjs');
const { createServer } = require('http');
const { once } = require('events');
const fs = require('fs');
const path = require('path');
const directory = process.env.NARUTO_WEBKIT_DIRECTORY;
const helper = process.env.NARUTO_WEBKIT_HELPER;
app.setPath('userData', path.join(directory, 'test-profile'));
const { GameSessions } = require(path.join(directory, 'main/game.js'));
const { findFlash } = require(path.join(directory, 'main/flash.js'));
const flash = findFlash(path.resolve(__dirname, '..'), '34');
if (flash.available) {
  app.commandLine.appendSwitch('ppapi-flash-path', flash.path);
  app.commandLine.appendSwitch('ppapi-flash-version', flash.version);
}
const wrapper = process.env.NARUTO_WEBKIT_TEST_WRAPPER === '1';
let checks = [], active, window, games, server, attacker;
function check(name, ok) { checks.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) throw new Error(name); }
function waitForExit(child) { return child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit'); }
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const watchdog = setTimeout(() => app.exit(1), 60000);
  try {
    let seenCookie = '', gameRequests = 0, wrapperRequests = 0, fixture;
    attacker = createServer((_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<script>location.href="${fixture}game?synthetic-attack=1"</script>`);
    });
    attacker.listen(0, '127.0.0.1'); await once(attacker, 'listening');
    server = createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html');
      if (req.url === '/untrusted-popup') {
        res.end('<button class="login_btn">fixture</button><script>setTimeout(()=>window.open("/game","_blank"),300)</script>');
      } else if (req.url === '/pt/serverlist/s777') {
        res.end(`<iframe src="http://127.0.0.1:${attacker.address().port}/attacker"></iframe>`);
      } else if (req.url.startsWith('/login')) {
        res.setHeader('Set-Cookie', ['fixture_session=synthetic-session; Path=/; HttpOnly; SameSite=Lax',
          'fixture_persist=synthetic-persist; Path=/; Max-Age=3600; SameSite=Strict', 'fixture_path=synthetic-path; Path=/game']);
        res.end('<script>location.href="/servers"</script>');
      } else if (req.url.startsWith('/servers')) {
        res.end(`<script>setTimeout(()=>${wrapper ? 'window.open("/pt/serverlist/s776","_blank")' : 'location.href="/game?ticket=synthetic-ticket"'},300)</script>`);
      } else if (req.url === '/pt/serverlist/s776') {
        wrapperRequests++;
        res.end('<script>if(navigator.mimeTypes["application/x-shockwave-flash"]){document.write(\'<iframe src="/game"></iframe>\')}else{document.write("Flash unsupported")}</script>');
      } else if (req.url.startsWith('/game')) {
        gameRequests++; seenCookie = req.headers.cookie || ''; res.end('<title>Fixture game</title><p>game ready</p>');
      } else {
        res.end('<button class="login_btn">Synthetic login</button><script>setTimeout(()=>location.href="/login",400)</script>');
      }
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    fixture = `http://127.0.0.1:${server.address().port}/`;
    active = startLogin(helper, { fixture, visible: false, timeout: 15000 });
    const handoff = await active.result;
    await waitForExit(active.child);
    check('native helper exits after handoff', active.child.signalCode === 'SIGTERM' || active.child.exitCode === 0);
    check('WK login and navigation yield controlled game entry', handoff.url === fixture + (wrapper ? 'game' : 'game?ticket=synthetic-ticket'));
    if (wrapper) check('WK selected-server wrapper creates and hands off its game iframe', wrapperRequests === 1);
    check('WK does not navigate game before transfer', gameRequests === 0);
    check('WK exported actual HTTP response cookies', handoff.cookies.length === 3);
    const id = 'webkit-fixture';
    const target = session.fromPartition('naruto-' + id);
    for (const cookie of handoff.cookies) await target.cookies.set(cookie);
    const restored = await target.cookies.get({});
    const find = name => restored.find(c => c.name === name);
    check('HttpOnly and SameSite Lax survive', find('fixture_session').httpOnly && find('fixture_session').sameSite === 'lax');
    check('session remains session cookie', find('fixture_session').session);
    check('expiry and SameSite Strict survive', !find('fixture_persist').session && find('fixture_persist').expirationDate > Date.now() / 1000 + 3000 && find('fixture_persist').sameSite === 'strict');
    check('hostOnly and path survive', restored.every(c => c.hostOnly) && find('fixture_path').path === '/game');
    window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
    games = new GameSessions(window, () => {}, () => {});
    const tab = games.create({ id, name: 'synthetic', region: 'br' }, handoff.url);
    await Promise.race([once(tab.view.webContents, 'did-finish-load'), new Promise((_, reject) => setTimeout(() => reject(new Error('fixture-game-timeout')), 10000))]);
    check('actual GameSessions first request has all cookies', gameRequests === 1 && ['fixture_session=synthetic-session', 'fixture_persist=synthetic-persist', 'fixture_path=synthetic-path'].every(item => seenCookie.includes(item)));
    if (wrapper) check('Flash is detected by the game wrapper in actual GameSessions', await tab.view.webContents.executeJavaScript('!!navigator.mimeTypes["application/x-shockwave-flash"]'));
    const sample = { type: 'handoff', url: 'https://s318-naruto.oasgames.com/?ticket=synthetic', cookies: [
      { name: 'test', value: 'synthetic', domain: '.oasgames.com', path: '/', secure: true, httpOnly: true, hostOnly: false, session: false, expirationDate: 1900000000, sameSite: 'none' }
    ] };
    const converted = validateHandoff(sample);
    check('domain Secure HttpOnly and SameSite None map correctly', converted.cookies[0].domain === '.oasgames.com' && converted.cookies[0].secure && converted.cookies[0].httpOnly && converted.cookies[0].sameSite === 'no_restriction');
    for (const [name, candidate] of [
      ['reject unrelated target', { ...sample, url: 'https://evil.example/game' }],
      ['reject public HTTP target', { ...sample, url: 'http://s318-naruto.oasgames.com/' }],
      ['reject credential URL', { ...sample, url: 'https://user:pass@s318-naruto.oasgames.com/' }],
      ['reject misleading hostname', { ...sample, url: 'https://s318-naruto.oasgames.com.evil.example/' }],
      ['reject foreign cookies', { ...sample, cookies: [{ ...sample.cookies[0], domain: '.evil.example' }] }],
      ['reject unrelated OAS cookies', { ...sample, cookies: [{ ...sample.cookies[0], domain: '.othergame.oasgames.com' }] }],
      ['reject persistent cookie without expiry', { ...sample, cookies: [{ ...sample.cookies[0], expirationDate: undefined }] }],
      ['reject malformed SameSite', { ...sample, cookies: [{ ...sample.cookies[0], sameSite: 'invalid' }] }]
    ]) { let rejected = false; try { validateHandoff(candidate); } catch { rejected = true; } check(name, rejected); }
    for (const [name, entry] of [['reject game popup from non-wrapper page', 'untrusted-popup'], ['reject cross-origin frame inside wrapper', 'pt/serverlist/s777']]) {
      let blocked = 0; const before = gameRequests;
      active = startLogin(helper, { fixture: fixture + entry, visible: false, timeout: 2500, onBlocked: () => blocked++ });
      const rejected = await active.result.then(() => false, error => error.message === 'timeout');
      await waitForExit(active.child);
      check(name, rejected && blocked > 0 && gameRequests === before);
    }
    active = startLogin(helper, { fixture: fixture + 'idle', visible: false });
    const cancelled = active.result.then(() => false, error => error.message === 'cancelled');
    active.cancel(); check('cancel rejects pending handoff', await cancelled); await waitForExit(active.child);
    active = startLogin(helper, { fixture, visible: false, timeout: 1 });
    check('timeout rejects pending handoff', await active.result.then(() => false, error => error.message === 'timeout'));
    await waitForExit(active.child);
    check('timeout helper is reaped', active.child.signalCode !== null || active.child.exitCode !== null);
    const report = { ok: true, checks }; fs.writeFileSync(path.join(directory, 'fixture-result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } catch (error) {
    const report = { ok: false, code: error.message, checks };
    fs.writeFileSync(path.join(directory, 'fixture-result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); process.exitCode = 1;
  } finally {
    clearTimeout(watchdog); active?.cancel(); games?.destroy(); if (window && !window.isDestroyed()) window.destroy(); server?.close(); attacker?.close(); app.exit(process.exitCode || 0);
  }
});
