const { app, BrowserWindow, BrowserView, ipcMain, session } = require('electron');
const { GameSessions } = require('../dist/session-test/game.js');
const { LoginSessions } = require('../dist/session-test/login-sessions.js');
const { AccountProfileStore } = require('../dist/session-test/account-profiles.js');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const directory = process.env.NARUTO_SESSION_TEST_DIRECTORY;
const service = process.env.NARUTO_SESSION_TEST_SERVICE;
const phase = process.argv[2];
process.on('unhandledRejection', error => { console.error('Unhandled test rejection:', error); app.exit(1); });
assert(directory.startsWith(path.resolve('.test-artifacts') + path.sep));
assert(service.startsWith('cn.youye.naruto-os.test.sessions.'));
app.setPath('userData', path.join(directory, 'profile'));
const results = [];
const check = (name, value) => { assert(value, name); results.push(name); console.log('PASS', name); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) { for (let i = 0; i < 200; i++) { if (predicate()) return; await pause(10); } throw new Error('Synthetic operation timed out'); }
async function ready(tab) {
  for (let i = 0; i < 300; i++) { if (tab.state === 'ready') { await pause(100); return; } await pause(20); }
  throw new Error('Synthetic page timed out');
}
const transport = (action, value) => new Promise((resolve, reject) => {
  const child = spawn(path.resolve('dist/native/keychain'), [], { stdio: ['pipe', 'pipe', 'ignore'] });
  let output = ''; child.stdout.on('data', chunk => { output += chunk; });
  child.on('error', reject); child.on('close', () => {
    try { const result = JSON.parse(output); assert(result.ok); resolve(result.value || ''); } catch { reject(new Error('Synthetic Keychain transport failed')); }
  });
  child.stdin.end(JSON.stringify({ action, value, service }));
});
let win, games, server;
let denyProfileClearWrite = false;
app.whenReady().then(async () => {
  const watchdog = setTimeout(() => app.exit(1), 35000);
  try {
    const requests = [];
    server = http.createServer((request, response) => {
      requests.push({ url: request.url, cookie: request.headers.cookie || '' });
      response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      response.end('<!doctype html><title>Session fixture</title><p>Isolated login state test</p>');
    });
    // Reuse one loopback origin across genuinely separate Electron processes.
    const portFile = path.join(directory, 'port.json');
    const port = phase === 'seed' ? 0 : JSON.parse(fs.readFileSync(portFile)).port;
    await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
    if (phase === 'seed') fs.writeFileSync(portFile, JSON.stringify({ port: server.address().port }));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const url = `${origin}/${phase}`;
    let reports = 0;
    const login = new LoginSessions((action, value) => {
      if (denyProfileClearWrite && action === 'write') throw new Error('Synthetic interrupted Keychain cleanup');
      return transport(action, value);
    }, () => { reports++; });
    win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
    ipcMain.handle('game:form-state', () => ({ ok: true, value: null }));
    games = new GameSessions(win, () => {}, () => {}, url, true, login);
    check('construction alone creates no game tabs or BrowserViews', !games.tabs.length && !win.getBrowserViews().length);
    const br = games.create({ id: `${phase}-new-br-id`, name: '', region: 'br' }); await ready(br);
    const cn = games.create({ id: `${phase}-new-cn-id`, name: '', region: 'cn' }); await ready(cn);
    const brSession = br.view.webContents.session, cnSession = cn.view.webContents.session;
    check('regions use different cookie stores', brSession !== cnSession);
    const authCookies = ses => ses.cookies.get({ name: 'fixture-auth' });
    if (phase === 'seed') {
      for (const [region, tab] of [['br', br], ['cn', cn]]) {
        const ses = tab.view.webContents.session;
        await ses.cookies.set({ url: origin, name: 'fixture-auth', value: region, httpOnly: true, sameSite: 'lax' });
        await ses.cookies.set({ url: origin, name: 'fixture-persistent', value: region, expirationDate: Date.now() / 1000 + 3600 });
        await ses.cookies.set({ url: 'https://login.example.test/account/', name: 'fixture-secure', value: region,
          domain: '.example.test', path: '/account/', secure: true, httpOnly: true, sameSite: 'strict' });
        await tab.view.webContents.executeJavaScript(`localStorage.setItem('fixture-region', '${region}')`);
      }
      check('both regions receive independent synthetic login cookies', (await authCookies(brSession))[0].value === 'br' && (await authCookies(cnSession))[0].value === 'cn');
      const extra = games.create({ id: 'extra-br', name: '', region: 'br' }); await ready(extra);
      check('simultaneous tabs keep independent accounts', extra.view.webContents.session !== brSession && !(await authCookies(extra.view.webContents.session)).length);
      const extraSession = extra.view.webContents.session;
      games.close(extra.id);
      check('closing a tab releases Session handlers', extraSession.listenerCount('will-download') === 0);
      const reopened = games.create({ id: 'another-new-id', name: '', region: 'br' }); await ready(reopened);
      check('reopening a free account slot reuses its profile without duplicate handlers', reopened.view.webContents.session === extraSession && extraSession.listenerCount('will-download') === 1);
      games.close(reopened.id);
      const disposable = games.create({ id: 'synthetic-delete-seed', name: '', region: 'br', profileId: 'br-7' }, undefined, undefined, 7); await ready(disposable);
      await disposable.profile.session.cookies.set({ url: origin, name: 'fixture-delete-auth', value: 'br-7', httpOnly: true, sameSite: 'lax' });
      await disposable.profile.session.cookies.set({ url: origin, name: 'fixture-delete-persistent', value: 'br-7', expirationDate: Date.now() / 1000 + 3600 });
      await disposable.view.webContents.executeJavaScript("localStorage.setItem('fixture-profile-delete', 'present')");
      check('synthetic profile deletion target has session cookies, persistent cookies and localStorage',
        (await disposable.profile.session.cookies.get({ url: origin })).some(cookie => cookie.name === 'fixture-delete-auth') &&
        (await disposable.view.webContents.executeJavaScript("localStorage.getItem('fixture-profile-delete')")) === 'present');
      const profileStore = new AccountProfileStore(app.getPath('userData'));
      profileStore.create('br', 7, '合成删除档案', '');
    } else if (phase === 'restore') {
      for (const [region, tab] of [['br', br], ['cn', cn]]) {
        const ses = tab.view.webContents.session;
        const cookies = await authCookies(ses);
        check(`${region}: session-only HttpOnly cookie survives process restart with a new tab id`, cookies.length === 1 && cookies[0].value === region && cookies[0].session && cookies[0].hostOnly && cookies[0].httpOnly && cookies[0].sameSite === 'lax');
        check(`${region}: persistent cookie survives with original expiry`, (await ses.cookies.get({ name: 'fixture-persistent' }))[0]?.value === region);
        const secure = (await ses.cookies.get({ name: 'fixture-secure' }))[0];
        check(`${region}: cross-domain cookie preserves domain, path, Secure, HttpOnly and SameSite`, secure?.value === region && secure.domain === '.example.test' && secure.path === '/account/' && secure.secure && secure.httpOnly && secure.sameSite === 'strict');
        check(`${region}: localStorage survives restart`, await tab.view.webContents.executeJavaScript("localStorage.getItem('fixture-region')") === region);
      }
      check('restored cookies reach the first navigation before any refresh', requests.filter(r => r.url === '/restore').length === 2 && requests.some(r => r.cookie.includes('fixture-auth=br')) && requests.some(r => r.cookie.includes('fixture-auth=cn')));
      const disposable = games.create({ id: 'synthetic-delete-reopen', name: '', region: 'br', profileId: 'br-7' }, undefined, undefined, 7); await ready(disposable);
      const disposableSession = disposable.profile.session;
      check('synthetic deletion target restores its own session and persistent cookies after restart',
        (await disposableSession.cookies.get({ name: 'fixture-delete-auth' }))[0]?.value === 'br-7' &&
        (await disposableSession.cookies.get({ name: 'fixture-delete-persistent' }))[0]?.value === 'br-7');
      check('synthetic deletion target restores localStorage before its first page is inspected',
        await disposable.view.webContents.executeJavaScript("localStorage.getItem('fixture-profile-delete')") === 'present');
      let activeLeaseBlocked = false;
      try { await login.clearProfile('br', 7); } catch (error) { activeLeaseBlocked = /打开中的标签或登录任务/.test(error.message); }
      check('session cleanup refuses an account whose lease is still active', activeLeaseBlocked &&
        (await disposableSession.cookies.get({ name: 'fixture-delete-auth' }))[0]?.value === 'br-7');
      games.close(disposable.id); await until(() => login.leaseCount('br', 7) === 0);
      const profileStore = new AccountProfileStore(app.getPath('userData'));
      profileStore.beginDelete(profileStore.get('br-7'));
      denyProfileClearWrite = true;
      let interruptedCleanup = '';
      try { await login.clearProfile('br', 7); } catch (error) { interruptedCleanup = error.message; }
      denyProfileClearWrite = false;
      check('Keychain failure leaves the synthetic profile pending after site data was cleared',
        interruptedCleanup.includes('清理钥匙串登录快照失败') && profileStore.isPendingDelete('br-7') &&
        (await disposableSession.cookies.get({})).length === 0);
      let interruptedPartitionBlocked = false;
      try { login.acquireSlot('br', 7); } catch (error) { interruptedPartitionBlocked = /正在清理/.test(error.message); }
      check('interrupted cleanup blocks reopening the profile in the same process', interruptedPartitionBlocked);
      const snapshot = JSON.parse(await transport('read'));
      check('interrupted cleanup preserves the old target snapshot and the other region for retry',
        Object.prototype.hasOwnProperty.call(snapshot.partitions, 'persist:naruto-br-7') &&
        Object.prototype.hasOwnProperty.call(snapshot.partitions, 'persist:naruto-cn-1'));
      // Simulate the website logging out and expiring its cookies.
      await brSession.cookies.remove(origin, 'fixture-auth');
      await brSession.cookies.set({ url: origin, name: 'fixture-persistent', value: '', expirationDate: Date.now() / 1000 - 60 });
      await br.view.webContents.executeJavaScript("localStorage.removeItem('fixture-region')");
      check('logging out of Brazil leaves China logged in', !(await authCookies(brSession)).length && (await authCookies(cnSession))[0]?.value === 'cn');
    } else if (phase === 'retry') {
      const profileStore = new AccountProfileStore(app.getPath('userData'));
      check('pending deletion survives a real process restart without auto-completing',
        profileStore.isPendingDelete('br-7') && !profileStore.isDeleted('br-7'));
      const snapshotBeforeRetry = JSON.parse(await transport('read'));
      check('restart keeps the Keychain snapshot available until the user retries',
        Object.prototype.hasOwnProperty.call(snapshotBeforeRetry.partitions, 'persist:naruto-br-7'));
      await login.clearProfile('br', 7);
      profileStore.completeDelete('br-7');
      const snapshotAfterRetry = JSON.parse(await transport('read'));
      check('manual retry clears only the pending profile and commits its tombstone',
        !profileStore.isPendingDelete('br-7') && profileStore.isDeleted('br-7') &&
        !Object.prototype.hasOwnProperty.call(snapshotAfterRetry.partitions, 'persist:naruto-br-7') &&
        Object.prototype.hasOwnProperty.call(snapshotAfterRetry.partitions, 'persist:naruto-cn-1'));
    } else {
      check('deleted session cookie stays deleted across restart', !(await authCookies(brSession)).length);
      check('expired persistent cookie is not resurrected', !(await brSession.cookies.get({ name: 'fixture-persistent' })).length);
      check('website localStorage removal stays removed', await br.view.webContents.executeJavaScript("localStorage.getItem('fixture-region')") === null);
      const deletedProfile = games.create({ id: 'synthetic-delete-after-restart', name: '', region: 'br', profileId: 'br-7' }, undefined, undefined, 7); await ready(deletedProfile);
      check('deleted profile localStorage stays cleared after a real process restart',
        await deletedProfile.view.webContents.executeJavaScript("localStorage.getItem('fixture-profile-delete')") === null);
      check('deleted profile session and persistent cookies do not return after restart',
        !(await deletedProfile.profile.session.cookies.get({ name: 'fixture-delete-auth' })).length &&
        !(await deletedProfile.profile.session.cookies.get({ name: 'fixture-delete-persistent' })).length);
      check('other region stays logged in after restart', (await authCookies(cnSession))[0]?.value === 'cn');
      games.close(deletedProfile.id); await until(() => login.leaseCount('br', 7) === 0); await login.clearProfile('br', 7);
    }
    games.destroy(); await login.flush();
    check('saving and restoring reports no errors', reports === 0);
    if (phase === 'cleared') {
      let writes = 0, deniedReports = 0;
      const denied = new LoginSessions(async action => {
        if (action === 'write') writes++;
        throw new Error('Synthetic Keychain denial');
      }, () => { deniedReports++; });
      games = new GameSessions(win, () => {}, () => {}, url, true, denied);
      const fallback = games.create({ id: 'denied-store', name: '', region: 'br' }); await ready(fallback);
      check('Keychain denial reports the problem and still opens the website', deniedReports > 0 && fallback.view.webContents.getURL() === url);
      games.destroy();
      let rejected = false;
      try { await denied.flush(); } catch { rejected = true; }
      check('failed reads never overwrite saved cookies and failed flush is visible', rejected && writes === 0);

      let releaseRead;
      const delayed = new LoginSessions(action => action === 'read'
        ? new Promise(resolve => { releaseRead = resolve; }) : Promise.resolve(''), () => { throw new Error('Unexpected delayed-save failure'); });
      games = new GameSessions(win, () => {}, () => {}, url, true, delayed);
      const fastClose = games.create({ id: 'closed-before-restore', name: '', region: 'br' });
      const contents = fastClose.view.webContents, cookies = contents.session.cookies;
      const count = requests.length;
      await until(() => typeof releaseRead === 'function');
      games.close(fastClose.id);
      releaseRead('[]'); await delayed.flush(); await pause(100);
      check('closing during restoration leaves no view, navigation or Cookie listener', contents.isDestroyed() && !win.getBrowserViews().length && cookies.listenerCount('changed') === 0 && requests.length === count);

      const blockedSession = session.fromPartition('persist:naruto-br-10');
      const realClearStorageData = blockedSession.clearStorageData.bind(blockedSession);
      blockedSession.clearStorageData = () => Promise.reject(new Error('Synthetic Chromium clear failure'));
      const chromiumStore = { version: 1, partitions: { 'persist:naruto-br-10': [], 'persist:naruto-cn-9': [] } };
      const chromiumCleanup = new LoginSessions(async (action, value) => {
        if (action === 'read') return JSON.stringify(chromiumStore);
        if (action === 'write') { Object.assign(chromiumStore, JSON.parse(value)); return ''; }
        return JSON.stringify(Object.keys(chromiumStore.partitions));
      }, () => {});
      let chromiumFailure = '';
      try { await chromiumCleanup.clearProfile('br', 10); } catch (error) { chromiumFailure = error.message; }
      let chromiumPartitionBlocked = false;
      try { chromiumCleanup.acquireSlot('br', 10); } catch (error) { chromiumPartitionBlocked = /正在清理/.test(error.message); }
      check('Chromium cleanup failure keeps the partition blocked and reports its stage',
        chromiumFailure.includes('清理 Chromium 网站数据失败') && Object.prototype.hasOwnProperty.call(chromiumStore.partitions, 'persist:naruto-br-10') && chromiumPartitionBlocked);
      blockedSession.clearStorageData = realClearStorageData;
      await chromiumCleanup.clearProfile('br', 10);
      check('retry after Chromium cleanup failure completes safely and preserves other snapshots',
        !Object.prototype.hasOwnProperty.call(chromiumStore.partitions, 'persist:naruto-br-10') && Object.prototype.hasOwnProperty.call(chromiumStore.partitions, 'persist:naruto-cn-9'));

      const cacheFailureSession = session.fromPartition('persist:naruto-br-12');
      const realClearCache = cacheFailureSession.clearCache.bind(cacheFailureSession);
      cacheFailureSession.clearCache = () => Promise.reject(new Error('Synthetic Chromium cache failure'));
      const cacheStore = { version: 1, partitions: { 'persist:naruto-br-12': [], 'persist:naruto-cn-9': [] } };
      const cacheCleanup = new LoginSessions(async (action, value) => {
        if (action === 'read') return JSON.stringify(cacheStore);
        if (action === 'write') { Object.assign(cacheStore, JSON.parse(value)); return ''; }
        return JSON.stringify(Object.keys(cacheStore.partitions));
      }, () => {});
      let cacheFailure = '';
      try { await cacheCleanup.clearProfile('br', 12); } catch (error) { cacheFailure = error.message; }
      let cachePartitionBlocked = false;
      try { cacheCleanup.acquireSlot('br', 12); } catch (error) { cachePartitionBlocked = /正在清理/.test(error.message); }
      check('Chromium cache failure is reported and keeps the partition blocked',
        cacheFailure.includes('清理 Chromium 网站数据失败') && cachePartitionBlocked &&
        Object.prototype.hasOwnProperty.call(cacheStore.partitions, 'persist:naruto-br-12'));
      cacheFailureSession.clearCache = realClearCache;
      await cacheCleanup.clearProfile('br', 12);
      check('retry after Chromium cache failure removes only the target snapshot',
        !Object.prototype.hasOwnProperty.call(cacheStore.partitions, 'persist:naruto-br-12') &&
        Object.prototype.hasOwnProperty.call(cacheStore.partitions, 'persist:naruto-cn-9'));

      let denySnapshotRead = true;
      const readFailureStore = { version: 1, partitions: { 'persist:naruto-br-13': [], 'persist:naruto-cn-9': [] } };
      const readFailureCleanup = new LoginSessions(async (action, value) => {
        if (action === 'read') {
          if (denySnapshotRead) throw new Error('Synthetic Keychain read failure');
          return JSON.stringify(readFailureStore);
        }
        if (action === 'write') { Object.assign(readFailureStore, JSON.parse(value)); return ''; }
        return JSON.stringify(Object.keys(readFailureStore.partitions));
      }, () => {});
      let readFailure = '';
      try { await readFailureCleanup.clearProfile('br', 13); } catch (error) { readFailure = error.message; }
      let readFailurePartitionBlocked = false;
      try { readFailureCleanup.acquireSlot('br', 13); } catch (error) { readFailurePartitionBlocked = /正在清理/.test(error.message); }
      check('Keychain read failure preserves snapshots and blocks the partition',
        readFailure.includes('清理钥匙串登录快照失败') && readFailurePartitionBlocked &&
        Object.prototype.hasOwnProperty.call(readFailureStore.partitions, 'persist:naruto-br-13') &&
        Object.prototype.hasOwnProperty.call(readFailureStore.partitions, 'persist:naruto-cn-9'));
      denySnapshotRead = false;
      await readFailureCleanup.clearProfile('br', 13);
      check('retry after Keychain read failure removes only the target snapshot',
        !Object.prototype.hasOwnProperty.call(readFailureStore.partitions, 'persist:naruto-br-13') &&
        Object.prototype.hasOwnProperty.call(readFailureStore.partitions, 'persist:naruto-cn-9'));

      let allowSnapshotWrite = false;
      const keychainStore = { version: 1, partitions: { 'persist:naruto-br-11': [], 'persist:naruto-cn-9': [] } };
      const keychainCleanup = new LoginSessions(async (action, value) => {
        if (action === 'read') return JSON.stringify(keychainStore);
        if (action === 'write') {
          if (!allowSnapshotWrite) throw new Error('Synthetic Keychain write failure');
          Object.assign(keychainStore, JSON.parse(value)); return '';
        }
        return JSON.stringify(Object.keys(keychainStore.partitions));
      }, () => {});
      let keychainFailure = '';
      try { await keychainCleanup.clearProfile('br', 11); } catch (error) { keychainFailure = error.message; }
      let keychainPartitionBlocked = false;
      try { keychainCleanup.acquireSlot('br', 11); } catch (error) { keychainPartitionBlocked = /正在清理/.test(error.message); }
      check('Keychain write failure leaves deletion retryable and blocks the partition',
        keychainFailure.includes('清理钥匙串登录快照失败') && Object.prototype.hasOwnProperty.call(keychainStore.partitions, 'persist:naruto-br-11') && keychainPartitionBlocked);
      allowSnapshotWrite = true; await keychainCleanup.clearProfile('br', 11);
      check('retry after Keychain failure removes only the target snapshot',
        !Object.prototype.hasOwnProperty.call(keychainStore.partitions, 'persist:naruto-br-11') && Object.prototype.hasOwnProperty.call(keychainStore.partitions, 'persist:naruto-cn-9'));
    }
    fs.writeFileSync(path.join(directory, `${phase}.json`), JSON.stringify({ ok: true, results }, null, 2));
    clearTimeout(watchdog); win.destroy(); server.close(); app.quit();
  } catch (error) {
    console.error(error); fs.writeFileSync(path.join(directory, `${phase}.json`), JSON.stringify({ ok: false, results, error: String(error) }, null, 2));
    clearTimeout(watchdog); if (server) server.close(); app.exit(1);
  }
});
