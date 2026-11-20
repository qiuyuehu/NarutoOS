const { app, BrowserWindow, ipcMain, session } = require('electron');
const { createServer } = require('http');
const { once } = require('events');
const fs = require('fs'), path = require('path');
const { WebLogin, reconcileCookies } = require('../dist/web-login-test/main/web-login.js');
const { GameSessions } = require('../dist/web-login-test/main/game.js');
const { LoginSessions } = require('../dist/web-login-test/main/login-sessions.js');
const { Navigation } = require('../dist/web-login-test/main/navigation.js');
const directory = process.env.NARUTO_WEB_LOGIN_TEST;
const phase = process.argv[2];
app.setPath('userData', path.join(directory, 'profile'));
const flash = path.resolve('runtime/flash-34/PepperFlashPlayer.plugin');
app.commandLine.appendSwitch('ppapi-flash-path', flash);
app.commandLine.appendSwitch('ppapi-flash-version', '34.0.0.342');
app.on('window-all-closed', () => {});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let i = 0; i < 200; i++) { if (await check()) return; await pause(50); } throw new Error('fixture-timeout'); }
let checks = [], server, win, games, profiles, login, navigation;
function check(name, value) { checks.push({ name, ok: !!value }); console.log(`${value ? 'PASS' : 'FAIL'} ${name}`); if (!value) throw new Error(name); }
app.whenReady().then(async () => {
  const watchdog = setTimeout(() => app.exit(1), 50000);
  try {
    for (const channel of ['game:form-state', 'game:candidates', 'game:submitted']) ipcMain.handle(channel, () => ({ ok: true, value: channel === 'game:candidates' ? [] : null }));
    let mode = phase === 'seed' ? 'login' : 'resume', roots = [], gameRequests = [], idle = 0, authRequests = 0, blocked = phase === 'seed';
    let readyGate, holdNextReady = false, failNextReady = false, gameEntryStatus = 0;
    server = createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html');
      if (req.url === '/') {
        roots.push(req.headers.cookie || '');
        if (blocked) { res.statusCode = 403; res.end('<title>Attention Required! | Cloudflare</title>Blocked fixture'); return; }
        res.end(`<button class="login_btn">fixture</button><script>setTimeout(()=>location.href="${mode === 'resume' ? '/pt/serverlist/s776' : mode.startsWith('cancel') ? '/save-before-close' : '/login'}",150)</script>`);
      } else if (req.url === '/login' || req.url === '/save-before-close') {
        authRequests++;
        if (mode !== 'cancel-preserve') res.setHeader('Set-Cookie', [`fixture_auth=${mode === 'cancel' ? 'cancel-saved' : 'fresh'}; Path=/; HttpOnly; SameSite=Lax`,
          'fixture_remove=; Path=/; Max-Age=0', 'fixture_path=path-value; Path=/game', 'fixture_persistent=persistent-value; Path=/; Max-Age=3600; SameSite=Strict']);
        res.end(`<script>location.href="${mode.startsWith('cancel') ? '/idle' : '/pt/serverlist/s776'}"</script>`);
      } else if (req.url === '/idle') {
        idle++; res.end('<button class="login_btn">idle</button>');
      } else if (req.url === '/disconnect') {
        res.writeHead(302, { Location: '/' }); res.end();
      } else if (req.url === '/pt/serverlist/s776') {
        if (gameEntryStatus) { res.statusCode = gameEntryStatus; res.end('<title>Fixture game-entry error</title>'); return; }
        res.end('<img src="/missing-subresource.png"><script>if(navigator.mimeTypes["application/x-shockwave-flash"])document.write(\'<iframe src="/game"></iframe>\');else document.write("Flash unsupported")</script>');
      } else if (req.url === '/recovery-error') {
        res.statusCode = 403; res.end('<title>Forbidden</title>');
      } else if (req.url === '/recovery-unavailable') {
        res.statusCode = 502; res.end('<title>Unavailable</title>');
      } else if (req.url === '/game') {
        gameRequests.push(req.headers.cookie || '');
        res.end('<title>Synthetic Flash game</title>Game ready');
      } else { res.statusCode = 404; res.end('fixture missing'); }
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const fixture = `http://127.0.0.1:${server.address().port}/`;
    const helper = process.env.NARUTO_WEB_LOGIN_HELPER || path.resolve('dist/native/embedded-login.node');
    const vault = path.join(directory, 'synthetic-vault.json');
    let saves = 0;
    profiles = new LoginSessions(async (action, value) => {
      if (action === 'read') return fs.existsSync(vault) ? fs.readFileSync(vault, 'utf8') : '[]';
      fs.writeFileSync(vault, value, { mode: 0o600 }); saves++; return '';
    }, () => { throw new Error('synthetic-vault-failed'); });
    let nextCookieSyncGate;
    const retain = profiles.retain.bind(profiles);
    profiles.retain = partition => {
      const profile = retain(partition), gate = nextCookieSyncGate;
      if (gate) {
        nextCookieSyncGate = undefined;
        const update = profile.updateCookies.bind(profile);
        profile.updateCookies = async change => { gate.started(); await gate.promise; return update(change); };
      }
      return profile;
    };
    const delayNextCookieSync = () => {
      let start, release;
      const started = new Promise(resolve => { start = resolve; });
      const promise = new Promise(resolve => { release = resolve; });
      nextCookieSyncGate = { started: () => start(), promise };
      return { started, release: () => release() };
    };
    if (phase === 'seed') {
      const p = profiles.acquire('br'); await p.ready;
      for (const name of ['fixture_auth', 'fixture_remove']) await p.session.cookies.set({ url: fixture, name, value: 'old', httpOnly: true, sameSite: 'lax' });
      await p.session.cookies.set({ url: fixture.replace('http:', 'https:'), name: 'fixture_secure', value: 'secure-synthetic', secure: true, httpOnly: true, sameSite: 'no_restriction' });
      await p.session.cookies.set({ url: 'https://unrelated.test/', name: 'untouched', value: 'keep' });
      p.release(); await profiles.flush();
    }
    win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
    games = new GameSessions(win, () => {}, () => {}, undefined, false, profiles);
    navigation = new Navigation(games);
    const waitForReady = games.waitForReady.bind(games);
    games.waitForReady = id => {
      if (holdNextReady) { holdNextReady = false; return new Promise((resolve, reject) => { readyGate = { id, resolve, reject }; }); }
      if (failNextReady) { failNextReady = false; return Promise.reject(new Error('game-tab-failed')); }
      return waitForReady(id);
    };
    let reports = [];
    login = new WebLogin(win, games, profiles, navigation, helper, message => reports.push(message), { fixture, visible: false, timeout: 12000 }, () => login?.hide(games.activeId !== null));
    check('home does not create game tabs or spawn login', games.tabs.length === 0 && !login.pending);
    const native = require(helper), windowCount = native.windows();
    const firstLogin = { id: 'a'.repeat(24), name: '', region: 'br' };
    navigation.selectLogin(firstLogin.id);
    const task = login.open(firstLogin);
    check('repeated start reuses the same pending attempt', task === login.open(firstLogin));
    let competingStartRejected = false;
    try { login.open({ id: 'b'.repeat(24), name: '', region: 'br' }); }
    catch (error) { competingStartRejected = /另一个账号/.test(error.message); }
    check('a different login cannot silently reuse the pending task', competingStartRejected && login.pending?.saved.id === firstLogin.id);
    await until(() => !!login.pending?.handle);
    check('WK attaches to existing window without adding NSWindow', native.attached() && native.windows() === windowCount);
    login.hide(true); login.hide(false);
    check('hiding and showing retains same embedded view', native.attached() && native.windows() === windowCount);
    if (blocked) {
      await until(() => reports.length === 1);
      check('HTTP failure retains login tab and embedded page for manual retry', !!login.pending && native.attached() && games.tabs.length === 0 && reports[0].includes('403'));
      blocked = false; reports.length = 0; login.refresh();
    }
    await task; check('handoff removes WK view', !native.attached()); await until(() => gameRequests.length === 1);
    check('modern login creates exactly one launcher game tab', games.tabs.length === 1 && reports.length === 0);
    const first = games.tabs[0];
    check('Flash uses reserved persistent slot', first.view.webContents.session === session.fromPartition('persist:naruto-br-1'));
    check('first WK request receives restored cookies', roots[0].includes(`fixture_auth=${phase === 'seed' ? 'old' : 'fresh'}`));
    check('first Flash request receives login cookie and path cookie', gameRequests[0].includes('fixture_auth=fresh') && gameRequests[0].includes('fixture_path=path-value'));
    const cookies = await first.view.webContents.session.cookies.get({});
    check('session cookie HttpOnly and SameSite preserved', cookies.some(c => c.name === 'fixture_auth' && c.session && c.httpOnly && c.sameSite === 'lax'));
    check('ordinary Cookie stays non-Secure and non-HttpOnly', cookies.some(c => c.name === 'fixture_path' && !c.secure && !c.httpOnly && c.path === '/game'));
    check('persistent cookie expiry preserved', cookies.some(c => c.name === 'fixture_persistent' && !c.session && c.expirationDate > Date.now() / 1000 + 3000 && c.sameSite === 'strict'));
    check('unrelated cookie survives snapshot', cookies.some(c => c.name === 'untouched' && c.value === 'keep'));
      check('first running account remains independent', (await first.view.webContents.session.cookies.get({ name: 'fixture_auth' }))[0]?.value === 'fresh');
    if (phase === 'seed') {
      check('snapshot applies website cookie deletion', !cookies.some(c => c.name === 'fixture_remove'));
      check('Secure HttpOnly None survive Chromium to WK to Chromium', cookies.some(c => c.name === 'fixture_secure' && c.secure && c.httpOnly && c.sameSite === 'no_restriction'));
      const oldPartition = first.profile.partition, beforeRecovery = gameRequests.length;
      holdNextReady = true; mode = 'resume';
      const recovery = login.recover(first);
      await until(() => !!login.pending?.handle);
      check('recovery WK phase is explicit and can be refreshed in place', login.operation?.stage === 'login');
      const recoveryHandle = login.pending.handle;
      login.refresh();
      check('refreshing the WK phase keeps the same recovery task and native view', login.pending.handle === recoveryHandle && login.recover(first) === recovery);
      await until(() => games.tabs.length === 2 && !!readyGate);
      const replacement = games.tabs.find(tab => tab.id !== first.id);
      check('recovery keeps the old game tab until replacement readiness resolves', !!replacement && games.tabs.includes(first));
      check('recovery uses a new tab id but retains the same account Session', replacement.id !== first.id && replacement.view.webContents.session === first.view.webContents.session && replacement.profile.partition === oldPartition);
      check('candidate loading stage is explicit and repeated refresh does not start another attempt', login.operation?.stage === 'loading' && login.recover(first) === recovery && games.tabs.length === 2);
      check('WK-to-game handoff displays the candidate once with a unique id', !login.tabInfo && new Set(games.tabs.map(tab => tab.id)).size === games.tabs.length && replacement.recoveryStage === 'loading');
      const actualReady = waitForReady(replacement.id);
      await actualReady;
      readyGate.resolve(); readyGate = undefined;
      await recovery;
      check('DOM readiness enters a persistent confirmation stage without closing the old tab', games.tabs.length === 2 && games.tabs.includes(first) && replacement.state === 'ready' && replacement.recoveryStage === 'confirming' && login.operation?.stage === 'confirming' && gameRequests.length > beforeRecovery);
      check('confirmation rejects stale and duplicate actions', login.completeRecovery('not-the-candidate') === false && login.completeRecovery(replacement.id) === true && login.completeRecovery(replacement.id) === false);
      check('one confirmation closes only the original and keeps the candidate active', games.tabs.length === 1 && games.tabs[0] === replacement && games.activeId === replacement.id && replacement.recoveryStage === undefined && !login.operation);
      await replacement.view.webContents.loadURL(fixture + 'recovery-error').catch(() => {});
      await pause(150);
      check('replacement still detects a main-frame HTTP error after the old tab closes', replacement.state === 'failed');
      await replacement.view.webContents.loadURL(fixture + 'pt/serverlist/s776');
      await until(() => replacement.state === 'ready');
      blocked = true;
      await replacement.view.webContents.loadURL(fixture + 'disconnect').catch(() => {});
      check('disconnect redirect to a forbidden root is shown as a failed page', replacement.state === 'failed');
      blocked = false;
      await replacement.view.webContents.loadURL(fixture + 'pt/serverlist/s776');
      await until(() => replacement.state === 'ready');
      await replacement.view.webContents.loadURL(fixture + 'recovery-unavailable').catch(() => {});
      check('replacement detects a 502 error page as failed', replacement.state === 'failed');
      await replacement.view.webContents.loadURL(fixture + 'pt/serverlist/s776');
      await until(() => replacement.state === 'ready');
      const retained = profiles.retain(oldPartition); retained.release();
      check('replacement keeps its LoginSessions lease after the old tab closes', replacement.profile.partition === oldPartition);
      reports.length = 0; mode = 'resume';
      const failedHttpRecovery = login.recover(replacement);
      gameEntryStatus = 403;
      await failedHttpRecovery; gameEntryStatus = 0;
      check('candidate main-document HTTP failure removes the candidate and retains the original', games.tabs.length === 1 && games.tabs[0] === replacement && !login.operation && games.activeId === replacement.id && reports.some(message => message.includes('原游戏标签仍保留')));
      gameEntryStatus = 502;
      const failedGatewayRecovery = login.recover(replacement);
      await failedGatewayRecovery; gameEntryStatus = 0;
      check('candidate 502 response also keeps the original game page', games.tabs.length === 1 && games.tabs[0] === replacement && !login.operation);
      reports.length = 0;
      const cancelConfirmation = login.recover(replacement);
      await cancelConfirmation;
      const cancelledCandidate = games.tabs.find(tab => tab.id !== replacement.id);
      const cancelledContents = cancelledCandidate.view.webContents;
      check('ready candidate exposes the confirmation stage before a user decision', !!cancelledCandidate && login.operation?.stage === 'confirming' && games.tabs.includes(replacement));
      await login.cancelRecovery(cancelledCandidate.id);
      await until(() => cancelledContents.isDestroyed());
      check('cancelling from confirmation removes only the candidate and restores the original', games.tabs.length === 1 && games.tabs[0] === replacement && games.activeId === replacement.id && !login.operation);
      reports.length = 0; failNextReady = true; mode = 'resume';
      const failedRecovery = login.recover(replacement);
      await failedRecovery;
      check('replacement readiness failure keeps the old game tab and returns focus to it', games.tabs.length === 1 && games.tabs[0] === replacement && games.activeId === replacement.id && replacement.state === 'ready');
      check('failed recovery reports that the original game remains available', reports.some(message => message.includes('原游戏标签仍保留')));
      await replacement.view.webContents.loadURL(fixture + 'recovery-error').catch(() => {});
      check('original tab keeps its error listener after a replacement fails', replacement.state === 'failed');
      await replacement.view.webContents.loadURL(fixture + 'pt/serverlist/s776');
      await until(() => replacement.state === 'ready');
      const cookieDelay = delayNextCookieSync(); mode = 'resume';
      const delayedCookieRecovery = login.recover(replacement);
      await cookieDelay.started;
      navigation.selectHome(); login.hide(true);
      cookieDelay.release();
      await delayedCookieRecovery;
      const delayedCandidate = games.tabs.find(tab => tab.id !== replacement.id);
      check('home during Cookie sync keeps the same recovery and leaves both pages available', games.tabs.length === 2 && games.tabs.includes(replacement) && !!delayedCandidate && games.activeId === null && login.operation?.stage === 'confirming');
      navigation.selectGame(delayedCandidate.id); login.hide(false);
      await login.cancelRecovery(delayedCandidate.id);
      check('returning to the recovery tab still allows an explicit cancel', games.tabs.length === 1 && games.tabs[0] === replacement && games.activeId === replacement.id && !login.pending);
      mode = 'cancel-preserve'; const idleBeforeRecoveryCancel = idle;
      const cancelledRecovery = login.recover(replacement);
      await until(() => idle > idleBeforeRecoveryCancel);
      await login.cancel(); await cancelledRecovery;
      check('cancelling recovery returns to and preserves the current game tab', games.tabs.length === 1 && games.tabs[0] === replacement && games.activeId === replacement.id);
      holdNextReady = true; mode = 'resume';
      const delayedReadyRecovery = login.recover(replacement);
      await until(() => games.tabs.length === 2 && !!readyGate);
      const replacementReadyGate = readyGate;
      const replacementId = replacementReadyGate.id;
      navigation.selectHome(); login.hide(true);
      replacementReadyGate.reject(new Error('game-tab-closed'));
      await delayedReadyRecovery;
      check('background readiness failure removes only its candidate and leaves home selected', games.tabs.length === 1 && games.tabs[0] === replacement && games.activeId === null && !games.tabs.some(tab => tab.id === replacementId) && !login.pending);
      navigation.selectGame(replacement.id);
      mode = 'cancel'; const rootCount = roots.length, idleBeforeSecondLogin = idle;
      const second = login.open({ id: 'c'.repeat(24), name: '', region: 'br' });
      await until(() => idle > idleBeforeSecondLogin);
      check('second account starts in a separate cookie slot', roots[rootCount] === '');
      const secondAttempt = login.pending, secondHandle = secondAttempt.handle, idleWhileSecond = idle;
      navigation.selectGame(replacement.id); login.hide(true);
      check('switching to account A preserves B login task', login.pending === secondAttempt && !secondAttempt.cancelled);
      check('switching to account A selects the existing game tab', games.activeId === replacement.id);
      check('switching to account A keeps the same native login view attached', login.pending.handle === secondHandle && native.attached());
      check('switching to account A hides the background login view', !native.visible());
      navigation.selectHome(); login.hide(true);
      check('returning home still leaves the background login alive', login.pending === secondAttempt && !secondAttempt.cancelled && games.activeId === null && idle === idleWhileSecond);
      navigation.selectLogin(secondAttempt.saved.id); login.hide(false);
      check('returning to B restores the same native login page', login.pending === secondAttempt && secondAttempt.handle === secondHandle && native.attached() && native.visible() && idle === idleWhileSecond);
      const nativeCancel = login.pending.handle.cancel;
      let nativeCancelCount = 0;
      login.pending.handle.cancel = () => { nativeCancelCount++; nativeCancel(); };
      const closing = login.close();
      const repeatedClosing = login.close();
      check('cancel remains hidden after synchronous state broadcast', native.attached() && !native.visible());
      await Promise.all([closing, repeatedClosing, second]);
      check('repeated close cancels the native login handle only once', nativeCancelCount === 1);
      check('closing login before selecting server creates no game tab', games.tabs.length === 1);
      const slot = profiles.acquire('br'); await slot.ready;
      check('cancel releases only the pending slot', slot.partition === 'persist:naruto-br-2');
      check('cancelled window saves completed login', (await slot.session.cookies.get({ name: 'fixture_auth' }))[0]?.value === 'cancel-saved');
      slot.release();
      const backgroundWebLogin = new WebLogin(win, games, profiles, navigation, helper, message => reports.push(message), { fixture, visible: false, timeout: 12000 });
      backgroundWebLogin.hide(true); navigation.selectGame(replacement.id); mode = 'login';
      const backgroundLogin = backgroundWebLogin.open({ id: 'd'.repeat(24), name: 'background B', region: 'br' }, 3);
      await backgroundLogin;
      const backgroundGame = games.tabs.find(tab => tab.profile?.partition === 'persist:naruto-br-3');
      if (!backgroundGame) throw new Error('Background login did not hand off to its game tab');
      await games.waitForReady(backgroundGame.id);
      check('background B login hands off to a separate game tab without stealing A focus',
        games.tabs.length === 2 && games.activeId === replacement.id && backgroundGame.profile?.partition === 'persist:naruto-br-3');
      navigation.selectGame(backgroundGame.id); navigation.selectGame(replacement.id);
      check('switching between A and handed-off B preserves both game tabs and account slots',
        games.tabs.includes(backgroundGame) && games.tabs.includes(replacement) && games.activeId === replacement.id &&
        backgroundGame.profile?.partition !== replacement.profile?.partition);
      const backgroundContents = backgroundGame.view.webContents;
      games.close(backgroundGame.id, { deferDestroy: true });
      await until(() => backgroundContents.isDestroyed());
      check('closing background B destroys only B and leaves A selected',
        backgroundContents.isDestroyed() && games.tabs.length === 1 && games.tabs[0] === replacement && games.activeId === replacement.id);
      await backgroundWebLogin.close();
      const backgroundFailureReports = [];
      const failingLogin = new WebLogin(win, games, profiles, navigation, path.join(directory, 'missing-login-helper.node'),
        message => backgroundFailureReports.push(message), { fixture, visible: false });
      navigation.selectGame(replacement.id);
      await failingLogin.open({ id: 'e'.repeat(24), name: 'background failure', region: 'br' }, 4);
      check('background login failure reports completion without changing A focus or tabs',
        games.activeId === replacement.id && games.tabs.length === 1 && games.tabs[0] === replacement &&
        backgroundFailureReports.some(message => message.includes('登录未完成')));
      await failingLogin.close();
      const closingOriginal = games.create({ id: 'f'.repeat(24), name: 'closing original', region: 'br' }, fixture + 'idle');
      await games.waitForReady(closingOriginal.id);
      const closingLogin = new WebLogin(win, games, profiles, navigation, helper, message => reports.push(message), { fixture, visible: false, timeout: 12000 });
      mode = 'cancel-preserve'; const idleBeforeClosingOriginal = idle;
      const closingOriginalRecovery = closingLogin.recover(closingOriginal);
      await until(() => idle > idleBeforeClosingOriginal);
      const cancelAfterOriginalClose = closingLogin.cancel('restore-original');
      games.close(closingOriginal.id);
      await Promise.all([closingOriginalRecovery, cancelAfterOriginalClose]);
      check('closing the original during cancellation never reselects its stale id', !games.tabs.some(tab => tab.id === closingOriginal.id) && games.activeId !== closingOriginal.id);
      await closingLogin.close();
      const exitLogin = new WebLogin(win, games, profiles, navigation, helper, message => reports.push(message), { fixture, visible: false, timeout: 12000 });
      mode = 'cancel-preserve'; const idleBeforeExit = idle;
      const exitRecovery = exitLogin.recover(replacement);
      await until(() => idle > idleBeforeExit);
      const selectedDuringExit = [];
      const selectGame = games.select.bind(games);
      const showWindow = win.show.bind(win), focusWindow = win.focus.bind(win);
      let shownDuringExit = 0, focusedDuringExit = 0;
      games.select = id => { selectedDuringExit.push(id); return selectGame(id); };
      win.show = () => { shownDuringExit++; return showWindow(); };
      win.focus = () => { focusedDuringExit++; return focusWindow(); };
      games.destroy();
      await Promise.all([exitLogin.close(), exitLogin.close(), exitRecovery]);
      check('exit cleans pending recovery without selecting, showing, or focusing a closed game page', games.tabs.length === 0 && games.activeId === null && selectedDuringExit.length === 0 && shownDuringExit === 0 && focusedDuringExit === 0 && !native.attached());
      games.select = selectGame; win.show = showWindow; win.focus = focusWindow;
    } else {
      check('restored WK session enters game without a login request', authRequests === 0);
      const second = login.open({ id: 'd'.repeat(24), name: '', region: 'br' });
      await second; await until(() => gameRequests.length === 2);
      check('closed-window session restores across processes', roots[1].includes('fixture_auth=cancel-saved') && gameRequests[1].includes('fixture_auth=cancel-saved'));
      check('two restored accounts use separate game tabs', games.tabs.length === 2 && games.tabs[0].view.webContents.session !== games.tabs[1].view.webContents.session);
      const ses = first.view.webContents.session;
      let injected = false;
      const fault = { cookies: { get: (...args) => ses.cookies.get(...args), remove: (...args) => ses.cookies.remove(...args), set: async value => {
        if (value.value === 'inject-failure' && !injected) { injected = true; throw new Error('synthetic-write-failure'); }
        return ses.cookies.set(value);
      } } };
      let failed = false;
      try { await reconcileCookies(fault, await ses.cookies.get({}), [
        { url: fixture, name: 'fixture_auth', value: 'changed' }, { url: fixture, name: 'fixture_persistent', value: 'inject-failure' }
      ], fixture); } catch { failed = true; }
      check('failed Cookie write restores original state', failed && (await ses.cookies.get({ name: 'fixture_auth' }))[0]?.value === 'fresh');
      const identitySession = session.fromPartition('cookie-identity-regression');
      const identityURL = 'https://snapshot.test/';
      await identitySession.cookies.set({ url: identityURL, name: 'synthetic_identity', value: 'host' });
      await identitySession.cookies.set({ url: identityURL, domain: '.snapshot.test', name: 'synthetic_identity', value: 'domain' });
      let identityFailure = false;
      try { await reconcileCookies(identitySession, await identitySession.cookies.get({}), [
        { url: identityURL, name: 'synthetic_identity', value: 'host-updated' },
        { url: identityURL, domain: '.snapshot.test', name: 'synthetic_identity', value: 'domain-updated' }
      ]); } catch { identityFailure = true; }
      const identityCookies = await identitySession.cookies.get({ name: 'synthetic_identity' });
      check('host and domain Cookies with identical name and path coexist during handoff', !identityFailure && identityCookies.length === 2 &&
        identityCookies.some(c => c.hostOnly && c.value === 'host-updated') && identityCookies.some(c => !c.hostOnly && c.value === 'domain-updated'));
      const identical = { url: identityURL, name: 'synthetic_identity', value: 'same-copy' };
      await reconcileCookies(identitySession, await identitySession.cookies.get({}), [identical, { ...identical }]);
      check('identical duplicate snapshot records collapse without changing Cookie meaning', (await identitySession.cookies.get({ name: 'synthetic_identity' })).length === 1);
      let conflicting = false;
      try { await reconcileCookies(identitySession, await identitySession.cookies.get({}), [identical, { ...identical, value: 'different-copy' }]); }
      catch (error) { conflicting = error.message === 'duplicate-cookie-conflict-value'; }
      check('conflicting duplicates reject before Cookie mutation', conflicting && (await identitySession.cookies.get({ name: 'synthetic_identity' }))[0]?.value === 'same-copy');
      for (const keepDomain of [true, false]) {
        await identitySession.cookies.set({ url: identityURL, name: 'synthetic_identity', value: 'host' });
        await identitySession.cookies.set({ url: identityURL, domain: '.snapshot.test', name: 'synthetic_identity', value: 'domain' });
        await reconcileCookies(identitySession, await identitySession.cookies.get({}), [
          { url: identityURL, ...(keepDomain ? { domain: '.snapshot.test' } : {}), name: 'synthetic_identity', value: 'retained' }
        ]);
        const retained = await identitySession.cookies.get({ name: 'synthetic_identity' });
        check(`removing ${keepDomain ? 'host' : 'domain'} Cookie preserves the requested sibling`, retained.length === 1 && retained[0].hostOnly === !keepDomain && retained[0].value === 'retained');
      }
      await identitySession.cookies.set({ url: identityURL, name: 'synthetic_identity', value: 'host-original' });
      await identitySession.cookies.set({ url: identityURL, domain: '.snapshot.test', name: 'synthetic_identity', value: 'domain-original' });
      let identityInjected = false;
      const identityFault = { cookies: { get: (...args) => identitySession.cookies.get(...args), remove: (...args) => identitySession.cookies.remove(...args), set: async value => {
        if (value.value === 'inject-identity-failure' && !identityInjected) { identityInjected = true; throw new Error('synthetic'); }
        return identitySession.cookies.set(value);
      } } };
      try { await reconcileCookies(identityFault, await identitySession.cookies.get({}), [
        { url: identityURL, domain: '.snapshot.test', name: 'synthetic_identity', value: 'inject-identity-failure' }
      ]); } catch { /* intentional write failure after sibling deletion */ }
      const rolledBack = await identitySession.cookies.get({ name: 'synthetic_identity' });
      check('failed sibling update restores both host and domain Cookies', identityInjected && rolledBack.length === 2 &&
        rolledBack.some(c => c.hostOnly && c.value === 'host-original') && rolledBack.some(c => !c.hostOnly && c.value === 'domain-original'));
      let finishReady, releases = 0;
      const delayed = { acquire: () => ({ ready: new Promise(resolve => { finishReady = resolve; }), release: () => releases++ }) };
      const late = new WebLogin(win, games, delayed, navigation, helper, () => {}, { fixture, visible: false });
      navigation.selectLogin('f'.repeat(24));
      const delayedOpen = late.open({ id: 'f'.repeat(24), name: '', region: 'br' });
      const lateClose = late.close(); finishReady(); await Promise.all([delayedOpen, lateClose]);
      check('quit while waiting for restore releases slot without spawning', releases === 1 && !late.pending && games.tabs.length === 2);
    }
    await login.close(); games.destroy(); await profiles.flush();
    const saved = JSON.parse(fs.readFileSync(vault, 'utf8'));
    check('session login Cookie is saved by existing session store', saved.partitions['persist:naruto-br-1'].some(c => c.name === 'fixture_auth' && c.value === 'fresh'));
    if (phase === 'seed') check('session persistence writes the initial login state', saves > 0);
    else check('unchanged restored session does not rewrite valid stored data', saves === 0);
    check('no leftover native helper', !login.pending);
    fs.writeFileSync(path.join(directory, `${phase}.json`), JSON.stringify({ ok: true, checks }, null, 2));
  } catch (error) {
    console.error('WEB_LOGIN_TEST_FAILED', error.message);
    fs.writeFileSync(path.join(directory, `${phase}.json`), JSON.stringify({ ok: false, code: error.message, checks }, null, 2)); process.exitCode = 1;
  } finally {
    clearTimeout(watchdog); await login?.close(); games?.destroy(); if (win && !win.isDestroyed()) win.destroy(); server?.close(); app.exit(process.exitCode || 0);
  }
});
