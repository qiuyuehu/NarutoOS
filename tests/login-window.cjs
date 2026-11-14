// Offline only: actual GameSessions + sandboxed preload + official jQuery/login
// functions. All HTTP(S) traffic is intercepted; credentials are synthetic.
const { app, BrowserWindow, ipcMain } = require('electron');
const { GameSessions } = require('../dist/main/game.login-test.cjs');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const https = require('https');
const http = require('http');
const net = require('net');
const { execFileSync } = require('child_process');
const profile = process.env.NARUTO_LOGIN_TEST_PROFILE;
assert(profile && profile.startsWith(path.resolve('.test-artifacts') + path.sep));
app.setPath('userData', profile);
const ENTRY = 'https://naruto.narutowebgame.com/pt/serverlist';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [];
const check = (name, value) => { assert(value, name); results.push(name); console.log('PASS', name); };
let win, games, wc, tab;
let plan = {}, counts = { auth: 0, servers: 0, userinfo: 0, pages: 0 }, submissions = 0;
let networkFeedback = [];
const scripts = {
  '/jquery.js': fs.readFileSync('tests/fixtures/brazil-login/jquery-1.7.2.min.js'),
  '/cookie-restore.js': fs.readFileSync('tests/fixtures/brazil-login/cookie-restore.js'),
  '/website.js': fs.readFileSync('tests/fixtures/brazil-login/website.js'),
};
function fixture() {
  return `<!doctype html><html><head><meta charset="utf-8"><script src="/jquery.js"></script>
  <script src="/setup.js"></script>${plan.delayed ? '' : '<script src="/website.js"></script>'}${plan.recover ? `<script src="/cookie-restore.js"></script><script>
  function befor_login_point(){return document.querySelector('.login_cont').innerHTML}
  function setCookie(name,value){document.cookie=name+'='+value+';path=/;Secure;SameSite=None'}
  function getCookie(name){return (document.cookie.match(new RegExp('(?:^|;\\s*)'+name+'=([^;]*)'))||[])[1]||''}
  jQuery(function(){if(getCookie('oas_user'))getLoginuserByCookie(getCookie('oas_user'))});
  ${plan.initialCookie ? "setCookie('oas_user','fixture-existing')" : ''}</script>` : ''}</head><body>
  <div class="login_cont"><div class="login_bef"><input name="oasun" value="synthetic-user">
  <input name="oaspd" type="password" value="synthetic-password" onkeydown="keyLogin()">
  <div class="login_btn"><a href="javascript:void(0)" onclick="login()" tabindex="0">Login</a></div>
  <div class="login_tips"><p></p></div><a class="login_fb" href="#" onclick="window.socialClicks=(window.socialClicks||0)+1">Social</a>
  </div></div>${plan.slow ? '<img src="/optional-social-resource">' : ''}</body></html>`;
}
const evaluate = async expression => {
  const response = await wc.debugger.sendCommand('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  return response.result.value;
};
async function waitFor(expression, milliseconds = 2500) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) { if (await evaluate(expression)) return; await pause(25); }
  throw new Error(`Timed out: ${expression}; state=${await evaluate('document.documentElement.getAttribute("data-naruto-login")')}`);
}
async function open(next = {}, url = ENTRY) {
  await evaluate('try{sessionStorage.clear()}catch{}');
  await wc.session.clearStorageData({ storages: ['cookies'] });
  plan = next; counts = { auth: 0, servers: 0, userinfo: 0, pages: 0 }; networkFeedback = [];
  const dom = new Promise(resolve => wc.once('dom-ready', resolve));
  const loaded = wc.loadURL(url).catch(() => {}); await dom;
  if (!next.slow) await loaded;
  if (!next.delayed && !next.initialCookie && url === ENTRY) await waitFor('document.documentElement.dataset.narutoLogin === "ready"');
}
const click = () => evaluate('document.querySelector(".login_btn a").click()');
async function failedAttempt(next) {
  await open(next); await click();
  await waitFor('document.documentElement.dataset.narutoLogin === "ready" && !!document.querySelector("[data-naruto-login-message]").textContent');
}
async function main() {
  const watchdog = setTimeout(() => { console.error('Login regression timeout'); app.exit(1); }, 35000);
  try {
    win = new BrowserWindow({ show: false, width: 900, height: 650, webPreferences: { contextIsolation: true } });
    games = new GameSessions(win, () => {}, () => {}, 'about:blank');
    tab = games.create({ id: 'login-offline-' + Date.now(), name: '' }); games.select(tab.id); wc = tab.view.webContents;
    await new Promise(resolve => wc.once('did-stop-loading', resolve));
    wc.debugger.attach('1.3');
    const send = wc.send.bind(wc);
    wc.send = (channel, ...args) => { if (channel === 'game:login-network-error') networkFeedback.push(args[0]); return send(channel, ...args); };
    wc.on('preload-error', (_e, _file, err) => { throw err; });
    for (const channel of ['game:candidates', 'game:form-state', 'game:submit']) ipcMain.handle(channel, () => {
      if (channel === 'game:submit') submissions++;
      return { ok: true, value: channel === 'game:candidates' ? [] : null };
    });
    const intercept = (request, callback) => {
      const url = new URL(request.url);
      const current = plan;
      const respond = (data, mimeType = 'text/html', statusCode = 200, headers = {}) => callback({ data: Buffer.from(data), mimeType, statusCode, headers });
      if (url.origin === new URL(ENTRY).origin || url.origin === 'https://huoying.qq.com') {
        if (scripts[url.pathname]) { respond(scripts[url.pathname], 'text/javascript'); return; }
        if (url.pathname === '/setup.js') {
          // Accelerate only the 15-second timeout in this synthetic fixture.
          respond(`var nativeTimeout=window.setTimeout; window.setTimeout=function(fn,ms){return nativeTimeout(fn,ms===15000?220:ms)};${current.delayed ? "setTimeout(()=>{var s=document.createElement('script');s.src='/website.js';document.head.append(s)},600);" : ''}`, 'text/javascript'); return;
        }
        if (url.pathname === '/optional-social-resource') { setTimeout(() => respond('', 'image/gif'), 1800); return; }
        if (url.pathname === '/late-frame') { setTimeout(() => respond('<p>Late frame</p>'), 250); return; }
        if (url.pathname === '/main-error') { callback({ error: -105 }); return; }
        if (url.origin === new URL(ENTRY).origin && url.pathname === '/pt/serverlist') counts.pages++;
        respond(fixture(), 'text/html', 200, current.csp ? { 'Content-Security-Policy': "script-src 'self' https://passport.oasgames.com https://odp3.oasgames.com; object-src 'none'" } : {}); return;
      }
      const auth = url.origin === 'https://passport.oasgames.com';
      const servers = url.origin === 'https://odp3.oasgames.com';
      if (auth || servers) {
        const stage = auth ? url.searchParams.get('m') === 'getLoginUser' ? 'userinfo' : 'auth' : 'servers'; counts[stage]++;
        const restored = counts.userinfo > 0 && current.recover;
        const code = current[stage + 'Statuses']?.[counts[stage]-1] ?? (restored && current.recoveredStatus ? current.recoveredStatus : current[stage + 'Status'] || 200);
        const data = auth ? current.success && !(stage === 'userinfo' && current.expired) ? { status: 'ok', val: { id: 'synthetic', loginKey: 'fixture-only' } } : { status: 'error', err_code: 3 }
          : { played: [], recommand: [] };
        const delay = current[stage + 'Timeout'] ? 650 : (current.delay || 80);
        setTimeout(() => respond(code === 200 ? `${url.searchParams.get('callback')}(${JSON.stringify(data)})` : 'Fixture refusal', 'text/javascript', code, { 'Retry-After': '1' }), delay);
        return;
      }
      callback({ error: -10 }); // Never fall through to the network.
    };
    // Custom protocol responses bypass Electron 11 webRequest notifications.
    // Use a loopback TLS fixture through an isolated proxy so real HTTP status
    // events traverse the production main -> preload -> page path.
    const keyFile = path.join(profile, 'fixture.key'), certFile = path.join(profile, 'fixture.crt');
    execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '1', '-subj', '/CN=Naruto Offline Test'], { stdio: 'ignore' });
    const cert = fs.readFileSync(certFile, 'utf8');
    const hosts = ['naruto.narutowebgame.com', 'passport.oasgames.com', 'odp3.oasgames.com', 'huoying.qq.com'];
    const server = https.createServer({ key: fs.readFileSync(keyFile), cert }, (req, res) => {
      intercept({ url: `https://${req.headers.host}${req.url}` }, response => {
        if (response.error) { res.destroy(); return; }
        if (res.destroyed) return;
        res.writeHead(response.statusCode, { 'Content-Type': response.mimeType, ...response.headers }); res.end(response.data);
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const proxy = http.createServer((_req, res) => { res.writeHead(403); res.end(); });
    proxy.on('connect', (req, socket, head) => {
      if (!hosts.some(host => req.url === host + ':443')) { socket.destroy(); return; }
      const upstream = net.connect(server.address().port, '127.0.0.1', () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        socket.pipe(upstream); upstream.pipe(socket);
      });
      socket.on('error', () => upstream.destroy()); upstream.on('error', () => socket.destroy());
      socket.on('close', () => upstream.destroy()); upstream.on('close', () => socket.destroy());
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    wc.session.setCertificateVerifyProc((request, callback) => callback(hosts.includes(request.hostname) && request.certificate.data.replace(/\s/g, '') === cert.replace(/\s/g, '') ? 0 : -2));
    await wc.session.setProxy({ mode: 'fixed_servers', proxyRules: `127.0.0.1:${proxy.address().port}` });
    win.showInactive();
    await open({ success: true, recover: true, initialCookie: true, userinfoStatus: 403 });
    await waitFor('document.documentElement.dataset.narutoLogin==="server-error"', 650);
    check('early cookie restoration reports its HTTP 403 stage before timeout', networkFeedback.some(r => r.stage === 'userinfo' && r.status === 403) && await evaluate('document.querySelector("[data-naruto-login-message]").textContent.includes("登录状态读取失败（403）")'));
    await pause(2800);
    check('early userinfo failure never retries cookie lookup or reloads the page', counts.auth === 0 && counts.userinfo === 1 && counts.servers === 0 && counts.pages === 1);
    check('cookie lookup failure requests manual refresh', await evaluate('document.querySelector("[data-naruto-login-message]").textContent.includes("手动刷新")'));
    const refreshed = new Promise(resolve => wc.once('did-stop-loading', resolve));
    games.refresh(tab.id); await refreshed;
    await waitFor('!!document.querySelector("[data-naruto-login-message]") && document.querySelector("[data-naruto-login-message]").textContent.includes("登录状态读取失败")', 650);
    wc.focus();
    await evaluate('var field=document.querySelector("input[name=oaspd]");field.value="";field.focus()');
    wc.sendInputEvent({ type: 'char', keyCode: 'x' });
    check('manual refresh leaves password field editable after cookie lookup failure', await evaluate('document.querySelector("input[name=oaspd]").value==="x"'));
    const authBefore = counts.auth;
    const retryPoint = await evaluate('(()=>{const r=document.querySelector(".login_btn a").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()');
    wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...retryPoint });
    wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...retryPoint });
    await pause(150);
    check('manual password login can submit after refresh and cookie lookup failure', counts.auth === authBefore + 1);
    await waitFor('!!document.querySelector(".login_aft")');
    check('explicit password login can finish after failed cookie restoration', counts.auth === 1 && counts.servers === 1);
    await open({ success: true, recover: true, initialCookie: true });
    await waitFor('!!document.querySelector(".login_aft")');
    check('normal website cookie restoration remains available', counts.auth === 0 && counts.userinfo === 1 && counts.servers === 1 && counts.pages === 1);
    await open({ slow: true, delay: 100 });
    check('main page becomes ready while optional resources are pending', tab.state === 'ready' && wc.isLoading());
    check('sandboxed preload runs compatibility before full load', await evaluate('!!window.__narutoBrazilLogin && typeof require==="undefined" && typeof window.naruto==="undefined"'));
    await evaluate('for(var n=0;n<10;n++)document.querySelector(".login_btn a").click()');
    await pause(150);
    check('ten rapid clicks issue one login request', counts.auth === 1);
    await waitFor('document.documentElement.dataset.narutoLogin==="ready"');
    for (let i = 0; i < 3; i++) { await click(); await waitFor('document.documentElement.dataset.narutoLogin==="ready"'); }
    check('completed retries do not accumulate website handlers', counts.auth === 4 && await evaluate('!jQuery._data(document.querySelector(".login_btn"),"events")'));
    check('incorrect password has feedback despite broken website error handler', await evaluate('document.querySelector("[data-naruto-login-message]").textContent.includes("密码不正确")'));
    await evaluate('document.querySelector(".login_fb").click()');
    check('social-login actions remain available', await evaluate('window.socialClicks===1'));
    await open();
    await evaluate('var frame=document.createElement("iframe");frame.src="/late-frame";document.body.append(frame)');
    await pause(80); check('late iframe never restarts main-page spinner', tab.state === 'ready');
    await waitFor('document.querySelector("iframe").contentDocument.readyState === "complete"');
    check('completed iframe keeps main page ready', tab.state === 'ready');

    await open({ delayed: true }); await click();
    check('click before login scripts are ready is blocked', counts.auth === 0 && await evaluate('document.querySelector(".login_btn").getAttribute("aria-disabled")==="true"'));
    await waitFor('document.documentElement.dataset.narutoLogin==="ready"'); await click();
    await waitFor('document.documentElement.dataset.narutoLogin==="ready"');
    check('late-loaded login script becomes usable', counts.auth === 1);

    await open();
    wc.focus();
    const beforeEnter = submissions;
    await evaluate('document.querySelector("input[name=oaspd]").focus()');
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' }); wc.sendInputEvent({ type: 'char', keyCode: 'Return' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await pause(150);
    check('trusted Enter submits once and still captures save candidate', counts.auth === 1 && submissions === beforeEnter + 1);
    await open();
    const point = await evaluate('(()=>{const r=document.querySelector(".login_btn a").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()');
    const beforeClick = submissions;
    wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    await pause(150);
    check('trusted mouse click submits once and preserves save detection', counts.auth === 1 && submissions === beforeClick + 1);

    await failedAttempt({ authStatus: 403 });
    check('real HTTP status reaches compatibility through scoped IPC', networkFeedback.length === 1 && networkFeedback[0].status === 403);
    check('HTTP 403 produces visible feedback without waiting for timeout', await evaluate('document.querySelector("[data-naruto-login-message]").textContent.includes("403")'));
    await open({ authStatus: 429 }); await click(); await waitFor('document.documentElement.dataset.narutoLogin==="cooldown"');
    await click(); check('HTTP 429 disables repeated submission during cooldown', counts.auth === 1 && await evaluate('document.querySelector("[data-naruto-login-message]").textContent.includes("频繁")'));
    await waitFor('document.documentElement.dataset.narutoLogin==="ready"', 1800);
    check('Retry-After cooldown restores login', await evaluate('document.querySelector(".login_btn").getAttribute("aria-disabled")==="false"'));
    await failedAttempt({ authTimeout: true });
    check('login timeout releases button with feedback', await evaluate('document.querySelector("[data-naruto-login-message]").textContent.includes("超时")'));

    await open({ success: true, serversStatus: 403 }); await click(); await waitFor('document.documentElement.dataset.narutoLogin==="server-error"');
    check('server-list failure is distinguished from password failure', counts.auth === 1 && counts.servers === 1 && await evaluate('document.querySelector("[data-naruto-login-message]").textContent.includes("登录已通过")'));
    check('server-list failure leaves manual login button enabled', await evaluate('document.querySelector(".login_btn").getAttribute("aria-disabled")==="false"'));
    await evaluate('for(var n=0;n<10;n++)document.querySelector(".login_btn a").click()');
    await waitFor('document.documentElement.dataset.narutoLogin==="server-error"');
    check('explicit retry after server failure submits once despite rapid clicks', counts.auth === 2 && counts.servers === 2);
    await open({ success: true, serversTimeout: true }); await click(); await waitFor('document.documentElement.dataset.narutoLogin==="server-error"');
    check('server-list timeout does not resubmit password', counts.auth === 1 && await evaluate('document.querySelector("[data-naruto-login-message]").textContent.includes("超时")'));
    await open({ success: true }); await click(); await waitFor('!!document.querySelector(".login_aft")');
    check('successful login keeps original website UI transition', counts.auth === 1 && counts.servers === 1);

    for (const failure of [{ serversStatus: 403 }, { serversStatus: 429 }, { serversTimeout: true }]) {
      await open({ success: true, recover: true, ...failure }); await click();
      await waitFor('document.documentElement.dataset.narutoLogin==="server-error"');
      await pause(2800);
      check(`authenticated server failure ${JSON.stringify(failure)} never retries or reloads`, counts.pages === 1 && counts.auth === 1 && counts.userinfo === 0 && counts.servers === 1);
      check('server failure leaves manual refresh feedback without recovery storage', await evaluate('document.querySelector("[data-naruto-login-message]").textContent.includes("手动刷新") && sessionStorage.getItem("naruto:login-reload:v1")===null'));
    }
    // Manual refresh still uses the website's normal cookie flow after failure.
    plan = { success: true, recover: true };
    games.refresh(tab.id);
    await waitFor('!!document.querySelector(".login_aft")');
    check('manual refresh restores through website cookie without another password request', counts.pages === 2 && counts.auth === 1 && counts.userinfo === 1 && counts.servers === 2);
    await open({ authStatus: 403 }); await click(); await waitFor('document.documentElement.dataset.narutoLogin==="ready"'); await pause(1550);
    check('rejected authentication never triggers automatic refresh', counts.pages === 1 && counts.auth === 1 && counts.servers === 0);
    await open({ success: true, recover: true, serversStatus: 403 }); await click(); await waitFor('document.documentElement.dataset.narutoLogin==="server-error"');
    await wc.loadURL('https://huoying.qq.com/server/website/'); await pause(1550);
    check('leaving the failed Brazil page does not trigger automatic refresh', wc.getURL() === 'https://huoying.qq.com/server/website/' && counts.pages === 1 && counts.auth === 1);

    await open({ csp: true });
    check('compatibility installs under strict script CSP', await evaluate('document.documentElement.dataset.narutoLogin==="ready"'));
    // Inline handlers are forbidden here; the compatibility handler owns submit.
    await click(); await waitFor('document.documentElement.dataset.narutoLogin==="ready"');
    check('strict CSP does not break password login', counts.auth === 1);
    await open({}, 'https://huoying.qq.com/server/website/');
    check('QQ login page does not receive Brazil compatibility', await evaluate('!window.__narutoBrazilLogin && !document.documentElement.hasAttribute("data-naruto-login")'));
    const failure = new Promise(resolve => wc.once('did-fail-load', resolve));
    void wc.loadURL('https://naruto.narutowebgame.com/main-error').catch(() => {}); await failure; await pause(100);
    check('main-frame load failure remains failed after stop-loading', tab.state === 'failed');
    fs.writeFileSync('.test-artifacts/login-regression.json', JSON.stringify({ ok: true, results }, null, 2));
    clearTimeout(watchdog); games.destroy(); win.destroy(); server.close(); proxy.close(); app.quit();
  } catch (error) {
    console.error(error, {counts}); fs.writeFileSync('.test-artifacts/login-regression.json', JSON.stringify({ ok: false, results, error: String(error) }, null, 2));
    clearTimeout(watchdog); if (games) games.destroy(); if (win) win.destroy(); app.exit(1);
  }
}
app.whenReady().then(main);
