// Uses official serverlist.css and the actual compatibility/preload code.
const { app, BrowserWindow, ipcMain } = require('electron');
const { GameSessions } = require('../dist/main/game.login-test.cjs');
const fs = require('fs'), path = require('path'), assert = require('assert');
const profile = process.env.NARUTO_LOGIN_TEST_PROFILE;
assert(profile && profile.startsWith(path.resolve('.test-artifacts') + path.sep));
app.setPath('userData', profile);
for (const channel of ['game:candidates','game:form-state','game:submit']) ipcMain.handle(channel, () => ({ ok: true, value: channel === 'game:candidates' ? [] : null }));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 900, webPreferences: { contextIsolation: true } });
  const games = new GameSessions(win, () => {}, () => {}, 'about:blank');
  const tab = games.create({ id: 'message-layout-' + Date.now(), name: '' }), wc = tab.view.webContents;
  const results = [], check = (name, value) => { assert(value, name); results.push(name); console.log('PASS', name); };
  const watchdog = setTimeout(() => app.exit(1), 8000);
  try {
    await new Promise(resolve => wc.once('did-finish-load', resolve));
    const css = fs.readFileSync('tests/fixtures/brazil-login/serverlist.css', 'utf8');
    const html = `<html><head><meta charset="utf-8"><style>${css}</style><script src="/jquery.js"></script></head><body><div class="main"><div class="login"><div class="login_title">Login</div><div class="login_cont"><div class="login_bef"><div class="login_bef_left fl"><input name="oasun"><input type="password" name="oaspd"></div><div class="login_btn fl"><a>Login</a></div><div class="login_bef_right fl">Social fixture</div></div></div></div><h2 id="servers">Servers</h2></div></body></html>`;
    wc.session.protocol.interceptBufferProtocol('https', (request, callback) => {
      const pathname = new URL(request.url).pathname;
      if (pathname === '/pt/serverlist') callback({ mimeType: 'text/html', data: Buffer.from(html) });
      else if (pathname === '/jquery.js') callback({ mimeType: 'text/javascript', data: fs.readFileSync('tests/fixtures/brazil-login/jquery-1.7.2.min.js') });
      else callback({ error: -10 });
    });
    await wc.loadURL('https://naruto.narutowebgame.com/pt/serverlist');
    const measured = await wc.executeJavaScript(`(()=>{const p=document.querySelector('[data-naruto-login-message]');function letter(i){const r=document.createRange();r.setStart(p.firstChild,i);r.setEnd(p.firstChild,i+1);return r.getBoundingClientRect().toJSON()}return {first:letter(0),second:letter(1),rect:p.getBoundingClientRect().toJSON(),next:document.querySelector('#servers').getBoundingClientRect().toJSON()}})()`);
    check('feedback is horizontal under official floating-column CSS', measured.first.y === measured.second.y && measured.second.x > measured.first.x);
    check('feedback gets full login-box width', measured.rect.width === 664);
    check('feedback does not overlap server-list heading', measured.rect.bottom <= measured.next.top);
    await wc.executeJavaScript(fs.readFileSync('tests/fixtures/brazil-login/website.js', 'utf8'));
    await new Promise(resolve => setTimeout(resolve, 350));
    check('ready state hides feedback without keeping extra space', await wc.executeJavaScript('(()=>{const n=document.querySelector("[data-naruto-login-message]");return n.hidden && n.getBoundingClientRect().height===0})()'));
    await wc.executeJavaScript('document.querySelector(".login_cont").innerHTML="<div class=login_aft>Offline success</div>"');
    await new Promise(resolve => setTimeout(resolve, 300));
    check('success removes stale feedback outside login box', await wc.executeJavaScript('!document.querySelector("[data-naruto-login-message]")'));
    fs.writeFileSync('.test-artifacts/message-layout-regression.json', JSON.stringify({ ok: true, results, measured }, null, 2));
    clearTimeout(watchdog); games.destroy(); win.close(); app.quit();
  } catch (error) { console.error(error); clearTimeout(watchdog); app.exit(1); }
});
