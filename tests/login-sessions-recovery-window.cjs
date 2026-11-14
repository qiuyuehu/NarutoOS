const { app, BrowserWindow, session } = require('electron');
const { LoginSessions } = require('../dist/session-test/login-sessions.js');
const { GameSessions } = require('../dist/session-test/game.js');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

const directory = process.env.NARUTO_SESSION_TEST_DIRECTORY;
const phase = process.argv[2];
assert(directory.startsWith(path.resolve('.test-artifacts') + path.sep));
const unhandledRejections = [];
process.on('unhandledRejection', error => unhandledRejections.push(error));
app.setPath('userData', path.join(directory, `memory-${phase}-profile`));
app.on('window-all-closed', () => {});
const results = [];
const check = (name, value) => { assert(value, name); results.push(name); console.log('PASS', name); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) { for (let i = 0; i < 300; i++) { if (predicate()) return; await pause(10); } throw new Error('Synthetic operation timed out'); }
async function ready(tab) {
  for (let i = 0; i < 300; i++) { if (tab.state === 'ready') return; await pause(20); }
  throw new Error('Synthetic page timed out');
}
function cookie(name, value, domain = '127.0.0.1', extra = {}) {
  return { name, value, domain, path: '/', secure: false, httpOnly: true, sameSite: 'lax', session: true,
    hostOnly: !domain.startsWith('.'), ...extra };
}
async function clearPartition(partition) {
  const jar = session.fromPartition(partition).cookies;
  const cookies = await jar.get({});
  let changes = 0;
  const changed = () => { changes++; };
  jar.on('changed', changed);
  for (const item of cookies) {
    const scheme = item.secure ? 'https' : 'http';
    const domain = item.domain.replace(/^\./, '');
    await jar.remove(`${scheme}://${domain}${item.path}`, item.name);
  }
  if (cookies.length) await until(() => changes >= cookies.length);
  jar.removeListener('changed', changed);
}

let server, win, games;
app.whenReady().then(async () => {
  const watchdog = setTimeout(() => app.exit(1), 55000);
  try {
    const requests = [];
    server = http.createServer((request, response) => {
      requests.push({ url: request.url, cookie: request.headers.cookie || '' });
      response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      response.end('<!doctype html><title>Recovery fixture</title>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;

    if (phase === 'recovery') {
      const br = 'persist:naruto-br-1', cn = 'persist:naruto-cn-1';
      const original = JSON.stringify({ version: 1, partitions: {
        [br]: [cookie('fixture-auth', 'saved-before-denial'), cookie('fixture-delete', 'saved-old'),
          cookie('fixture-keep', 'untouched'), cookie('fixture-wk-remove', 'saved-old'),
          cookie('collision', 'host-saved', 'example.test', { secure: true }),
          cookie('collision', 'domain-saved', '.example.test', { secure: true, hostOnly: false, sameSite: 'strict' })],
        [cn]: [cookie('fixture-cn', 'preserve-other-region')]
      } });
      let stored = original, reads = 0, writes = 0, denyReads = 1, denyWrites = 0, reports = 0;
      const transport = async (action, value) => {
        if (action === 'read') {
          reads++;
          if (denyReads > 0) { denyReads--; throw new Error('Synthetic transient Keychain denial'); }
          return stored;
        }
        writes++;
        if (denyWrites > 0) { denyWrites--; throw new Error('Synthetic transient Keychain write denial'); }
        stored = value; return '';
      };

      const login = new LoginSessions(transport, () => { reports++; });
      const first = login.acquire('br');
      let firstReadRejected = false;
      try { await first.ready; } catch { firstReadRejected = true; }
      check('first transient storage read failure is reported', firstReadRejected && reads === 1 && reports > 0);
      check('failed initial read never writes an empty Cookie store', writes === 0 && stored === original);

      first.release();
      await login.flush();
      check('release and flush retry a recovered read without overwriting an untouched partition', reads === 2 && writes === 0 && stored === original);

      win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
      games = new GameSessions(win, () => {}, () => {}, `${origin}/first`, true, login);
      const reopened = games.create({ id: 'memory-recovery-reopen', name: '', region: 'br' });
      await ready(reopened);
      const firstRequest = requests.find(request => request.url === '/first');
      check('reopening a free slot restores its Cookie before the first request', firstRequest?.cookie.includes('fixture-auth=saved-before-denial'));
      games.destroy(); await login.flush();

      await clearPartition(br);
      await pause(100);
      denyReads = 1;
      const recovering = new LoginSessions(transport, () => { reports++; });
      const current = recovering.acquire('br');
      let retryReadRejected = false;
      try { await current.ready; } catch { retryReadRejected = true; }
      check('a new session can open after the second transient read failure', retryReadRejected && reads === 3);

      const currentSession = current.session;
      await currentSession.cookies.set({ url: origin, name: 'fixture-auth', value: 'new-login', httpOnly: true, sameSite: 'lax' });
      await currentSession.cookies.set({ url: origin, name: 'fixture-delete', value: 'old-live', httpOnly: true, sameSite: 'lax' });
      await currentSession.cookies.remove(origin, 'fixture-delete');
      await currentSession.cookies.set({ url: 'https://example.test/', name: 'collision', value: 'host-updated', secure: true, httpOnly: true });
      await currentSession.cookies.set({ url: origin, name: 'fixture-wk-remove', value: 'temporary', httpOnly: true, sameSite: 'lax' });

      await current.updateCookies(async ses => {
        await ses.cookies.remove(origin, 'fixture-wk-remove');
        await ses.cookies.set({ url: origin, name: 'fixture-wk-add', value: 'wk-snapshot', httpOnly: true, sameSite: 'lax' });
      });
      let failedSnapshot = false;
      try {
        await current.updateCookies(async ses => {
          await ses.cookies.set({ url: origin, name: 'fixture-sync-failed', value: 'temporary', httpOnly: true });
          await ses.cookies.remove(origin, 'fixture-sync-failed');
          throw new Error('Synthetic Cookie snapshot rollback');
        });
      } catch { failedSnapshot = true; }
      check('failed Cookie snapshot sync is rejected and rolled back', failedSnapshot && !(await currentSession.cookies.get({ name: 'fixture-sync-failed' })).length);

      await recovering.flush();
      check('direct flush after login saves the new Cookie and keeps untouched saved Cookies',
        JSON.parse(stored).partitions[br].some(item => item.name === 'fixture-auth' && item.value === 'new-login') &&
        JSON.parse(stored).partitions[br].some(item => item.name === 'fixture-keep' && item.value === 'untouched'));
      current.release(); await recovering.flush();
      const merged = JSON.parse(stored).partitions[br];
      const find = (name, hostOnly) => merged.find(item => item.name === name && (hostOnly === undefined || item.hostOnly === hostOnly));
      check('new login Cookie replaces the old value', find('fixture-auth', true)?.value === 'new-login');
      check('unmodified Cookie remains from the saved store', find('fixture-keep', true)?.value === 'untouched');
      check('observed logout deletion is not resurrected', !find('fixture-delete', true));
      check('WK snapshot deletion is preserved', !find('fixture-wk-remove', true));
      check('successful WK snapshot addition is preserved', find('fixture-wk-add', true)?.value === 'wk-snapshot');
      check('host-only and Domain Cookies with the same name stay distinct',
        find('collision', true)?.value === 'host-updated' && find('collision', false)?.value === 'domain-saved');
      check('failed snapshot rollback leaves no phantom stored Cookie', !find('fixture-sync-failed', true));
      check('recovered save preserves another region', JSON.parse(stored).partitions[cn][0].value === 'preserve-other-region');

      await clearPartition(cn);
      const writeRetry = new LoginSessions(transport, () => { reports++; });
      const cnProfile = writeRetry.acquire('cn'); await cnProfile.ready;
      await cnProfile.session.cookies.set({ url: origin, name: 'fixture-cn-new', value: 'after-write-retry', httpOnly: true, sameSite: 'lax' });
      const beforeFailedWrite = stored, beforeWrites = writes;
      denyWrites = 2;
      cnProfile.release();
      await until(() => writes === beforeWrites + 1);
      check('failed initial write leaves the stored record unchanged', stored === beforeFailedWrite);
      let continuousWriteFailed = false;
      try { await writeRetry.flush(); } catch { continuousWriteFailed = true; }
      check('flush reports a continuing write failure without looping', continuousWriteFailed && writes === beforeWrites + 2 && stored === beforeFailedWrite);
      denyWrites = 0;
      await writeRetry.flush();
      check('a later flush retries and saves the current Cookie', writes === beforeWrites + 3 &&
        JSON.parse(stored).partitions[cn].some(item => item.name === 'fixture-cn-new' && item.value === 'after-write-retry'));

      await clearPartition(cn);
      let acquireStore = '[]', acquireWrites = 0, denyAcquireWrite = 1;
      const acquireRetry = new LoginSessions(async (action, value) => {
        if (action === 'read') return acquireStore;
        acquireWrites++;
        if (denyAcquireWrite > 0) { denyAcquireWrite--; throw new Error('Synthetic one-time write denial'); }
        acquireStore = value; return '';
      }, () => { reports++; });
      const failedAcquire = acquireRetry.acquire('cn'); await failedAcquire.ready;
      await failedAcquire.session.cookies.set({ url: origin, name: 'acquire-retry-cookie', value: 'saved-on-reopen', httpOnly: true });
      failedAcquire.release(); await until(() => acquireWrites === 1);
      denyAcquireWrite = 0;
      const reopenedAfterWriteFailure = acquireRetry.acquire('cn'); await reopenedAfterWriteFailure.ready;
      check('reacquiring a profile retries a failed write before completing its readiness', acquireWrites === 2 &&
        JSON.parse(acquireStore).partitions[cn].some(item => item.name === 'acquire-retry-cookie' && item.value === 'saved-on-reopen'));
      reopenedAfterWriteFailure.release(); await acquireRetry.flush();

      await clearPartition(cn);
      let releaseStore = stored, releaseWrites = 0, denyReleaseWrite = 1;
      const releaseRetry = new LoginSessions(async (action, value) => {
        if (action === 'read') return releaseStore;
        releaseWrites++;
        if (denyReleaseWrite > 0) { denyReleaseWrite--; throw new Error('Synthetic one-time write denial'); }
        releaseStore = value; return '';
      }, () => { reports++; });
      const failedRelease = releaseRetry.acquire('cn'); await failedRelease.ready;
      await failedRelease.session.cookies.set({ url: origin, name: 'release-retry-cookie', value: 'saved-on-next-close', httpOnly: true });
      failedRelease.release(); await until(() => releaseWrites === 1);
      denyReleaseWrite = 0;
      const secondRelease = releaseRetry.acquire('cn'); await secondRelease.ready;
      secondRelease.release(); await until(() => releaseWrites === 2);
      check('a later release retries and successfully saves after a failed release write',
        JSON.parse(releaseStore).partitions[cn].some(item => item.name === 'release-retry-cookie' && item.value === 'saved-on-next-close'));

      await clearPartition(cn);
      let raceStore = '[]', raceReads = 0, raceWrites = 0, startFirstWrite, releaseFirstWrite;
      const firstWriteStarted = new Promise(resolve => { startFirstWrite = resolve; });
      const firstWriteGate = new Promise(resolve => { releaseFirstWrite = resolve; });
      const racing = new LoginSessions(async (action, value) => {
        if (action === 'read') { raceReads++; return raceStore; }
        raceWrites++;
        if (raceWrites === 1) { startFirstWrite(); await firstWriteGate; }
        raceStore = value; return '';
      }, () => { reports++; });
      const raceProfile = racing.acquire('cn'); await raceProfile.ready;
      await raceProfile.session.cookies.set({ url: origin, name: 'before-flush-write', value: 'one', httpOnly: true });
      await until(() => racing.profiles.get(cn).revision === 1);
      const racingFlush = racing.flush(); await firstWriteStarted;
      await raceProfile.session.cookies.set({ url: origin, name: 'during-flush-write', value: 'two', httpOnly: true });
      await until(() => racing.profiles.get(cn).revision === 2);
      releaseFirstWrite(); await racingFlush;
      const raceCookies = JSON.parse(raceStore).partitions[cn];
      check('flush persists a Cookie changed during its first write before it reports success',
        raceReads === 1 && raceWrites === 2 && raceCookies.some(item => item.name === 'before-flush-write') &&
        raceCookies.some(item => item.name === 'during-flush-write') && racing.profiles.get(cn).persistedRevision === 2);
      raceProfile.release(); await racing.flush();

      await clearPartition(cn);
      let boundedStore = '[]', boundedReads = 0, boundedWrites = 0, boundedProfile, keepChanging = true;
      const bounded = new LoginSessions(async (action, value) => {
        if (action === 'read') { boundedReads++; return boundedStore; }
        boundedWrites++; boundedStore = value;
        if (keepChanging && boundedWrites <= 2) {
          const expectedRevision = boundedProfile.revision + 1;
          await boundedProfile.session.cookies.set({ url: origin, name: `late-write-${boundedWrites}`, value: 'not-in-this-snapshot', httpOnly: true });
          await until(() => boundedProfile.revision === expectedRevision);
        }
        return '';
      }, () => { reports++; });
      const boundedLease = bounded.acquire('cn'); await boundedLease.ready;
      boundedProfile = bounded.profiles.get(cn);
      await boundedLease.session.cookies.set({ url: origin, name: 'bounded-start', value: 'start', httpOnly: true });
      await until(() => boundedProfile.revision === 1);
      let stillDirtyRejected = false;
      try { await bounded.flush(); } catch { stillDirtyRejected = true; }
      check('flush rejects when Cookie changes remain after its bounded follow-up write',
        stillDirtyRejected && boundedReads === 1 && boundedWrites === 2 && boundedProfile.revision !== boundedProfile.persistedRevision);
      keepChanging = false;
      await bounded.flush();
      check('a later stable flush saves the remaining Cookie change', boundedWrites === 3 &&
        JSON.parse(boundedStore).partitions[cn].some(item => item.name === 'late-write-2'));
      boundedLease.release(); await bounded.flush();

      for (const [label, malformed] of [
        ['invalid JSON', '{invalid'],
        ['invalid structure', JSON.stringify({ version: 1, partitions: { 'persist:naruto-br-0': [] } })]
      ]) {
        let invalidReads = 0, invalidWrites = 0;
        const invalid = new LoginSessions(async action => {
          if (action === 'read') { invalidReads++; return malformed; }
          invalidWrites++; return '';
        }, () => {});
        const profile = invalid.acquire('br');
        try { await profile.ready; } catch { /* expected */ }
        profile.release();
        let flushRejected = false;
        try { await invalid.flush(); } catch { flushRejected = true; }
        check(`${label} is rejected without clearing or rewriting the store`, flushRejected && invalidWrites === 0 && invalidReads === 3);
      }

      await clearPartition(cn);
      let emptyStore = '[]', emptyWrites = 0;
      const empty = new LoginSessions(async (action, value) => {
        if (action === 'read') return emptyStore;
        emptyWrites++; emptyStore = value; return '';
      }, () => {});
      const emptyProfile = empty.acquire('cn'); await emptyProfile.ready;
      await emptyProfile.session.cookies.set({ url: origin, name: 'first-empty-login', value: 'saved', httpOnly: true, sameSite: 'lax' });
      emptyProfile.release(); await empty.flush();
      check('a legitimate empty store can be populated', emptyWrites === 1 &&
        JSON.parse(emptyStore).partitions[cn]?.some(item => item.name === 'first-empty-login' && item.value === 'saved'));

      await clearPartition(cn);
      const partialStore = JSON.stringify({ version: 1, partitions: { [cn]: [cookie('restore-one', 'one'), cookie('restore-two', 'two')] } });
      let partialWrites = 0, failRestore = true;
      const partial = new LoginSessions(async (action, value) => {
        if (action === 'read') return partialStore;
        partialWrites++; return value;
      }, () => { reports++; });
      const cnSession = session.fromPartition(cn), originalSet = cnSession.cookies.set.bind(cnSession.cookies);
      cnSession.cookies.set = async details => {
        if (failRestore && details.name === 'restore-two') { failRestore = false; throw new Error('Synthetic partial Cookie restore failure'); }
        return originalSet(details);
      };
      const partialProfile = partial.acquire('cn');
      let restoreRejected = false;
      try { await partialProfile.ready; } catch { restoreRejected = true; }
      check('partial Cookie restore remains a visible failure and does not write', restoreRejected &&
        !!(await cnSession.cookies.get({ name: 'restore-one' })).length && !(await cnSession.cookies.get({ name: 'restore-two' })).length && partialWrites === 0);
      partialProfile.release(); await partial.flush();
      check('partial restore never overwrites its complete saved snapshot', partialWrites === 0);
      failRestore = false;
      const retried = partial.acquire('cn'); await retried.ready;
      check('a later acquire safely retries the entire Cookie restore',
        (await cnSession.cookies.get({ name: 'restore-one' }))[0]?.value === 'one' && (await cnSession.cookies.get({ name: 'restore-two' }))[0]?.value === 'two');
      retried.release(); await partial.flush();
      cnSession.cookies.set = originalSet;

      await clearPartition(br);
      const closePartialStore = JSON.stringify({ version: 1, partitions: { [br]: [cookie('close-restore-one', 'one'), cookie('close-restore-two', 'two')] } });
      let closePartialWrites = 0, beginSecondRestore, failSecondRestore;
      const secondRestoreStarted = new Promise(resolve => { beginSecondRestore = resolve; });
      const secondRestoreGate = new Promise((_, reject) => { failSecondRestore = reject; });
      const closePartial = new LoginSessions(async (action, value) => {
        if (action === 'read') return closePartialStore;
        closePartialWrites++; return value;
      }, () => { reports++; });
      const brSession = session.fromPartition(br), closeOriginalSet = brSession.cookies.set.bind(brSession.cookies);
      let blockSecondRestore = true;
      brSession.cookies.set = async details => {
        if (blockSecondRestore && details.name === 'close-restore-two') {
          beginSecondRestore(); await secondRestoreGate;
        }
        return closeOriginalSet(details);
      };
      games = new GameSessions(win, () => {}, () => {}, `${origin}/unused`, true, closePartial);
      const closedPartialTab = games.create({ id: 'memory-partial-close', name: '', region: 'br' }, `${origin}/must-not-open`);
      const closedContents = closedPartialTab.view.webContents, closeCookieJar = closedContents.session.cookies;
      const beforeCloseNavigationCount = requests.length, beforeCloseUnhandled = unhandledRejections.length;
      await secondRestoreStarted;
      games.close(closedPartialTab.id);
      failSecondRestore(new Error('Synthetic restore failure after tab close'));
      await closePartial.flush(); await pause(50);
      check('closing during partial restore prevents navigation, leaked Cookie listeners, writes and unhandled rejections',
        closedContents.isDestroyed() && closeCookieJar.listenerCount('changed') === 0 && requests.length === beforeCloseNavigationCount &&
        closePartialWrites === 0 && unhandledRejections.length === beforeCloseUnhandled);
      blockSecondRestore = false;
      const retryPartialTab = games.create({ id: 'memory-partial-retry', name: '', region: 'br' }, `${origin}/partial-retry`);
      await ready(retryPartialTab);
      const retryRequest = requests.find(request => request.url === '/partial-retry');
      check('partial restore can be retried after the original game tab closes',
        retryRequest?.cookie.includes('close-restore-one=one') && retryRequest.cookie.includes('close-restore-two=two'));
      games.destroy(); await closePartial.flush();
      brSession.cookies.set = closeOriginalSet;

      let unavailableReads = 0, unavailableWrites = 0;
      const unavailable = new LoginSessions(async action => {
        if (action === 'read') { unavailableReads++; throw new Error('Synthetic persistent read failure'); }
        unavailableWrites++; return '';
      }, () => {});
      const unavailableBr = unavailable.acquire('br'), unavailableCn = unavailable.acquire('cn');
      await Promise.all([unavailableBr.ready.catch(() => {}), unavailableCn.ready.catch(() => {})]);
      check('simultaneous slot acquisitions share one failed storage read', unavailableReads === 1 && unavailableWrites === 0);
      const beforeFlushRead = unavailableReads;
      let unavailableFlushFailed = false;
      try { await unavailable.flush(); } catch { unavailableFlushFailed = true; }
      check('one flush attempts the failed full-store read once for all partitions',
        unavailableFlushFailed && unavailableReads === beforeFlushRead + 1 && unavailableWrites === 0);
      unavailableBr.release(); unavailableCn.release();
      await pause(30);

      let inFlightReads = 0, rejectInFlightRead;
      const inFlightRead = new Promise((_, reject) => { rejectInFlightRead = reject; });
      const inFlightManager = new LoginSessions(async action => {
        if (action === 'read') {
          inFlightReads++;
          if (inFlightReads === 1) return inFlightRead;
          throw new Error('Synthetic persistent read failure');
        }
        throw new Error('A failed read must never write');
      }, () => { reports++; });
      const startedBr = inFlightManager.acquire('br');
      await until(() => inFlightReads === 1);
      const joinedCn = inFlightManager.acquire('cn');
      rejectInFlightRead(new Error('Synthetic delayed Keychain denial'));
      await Promise.all([startedBr.ready.catch(() => {}), joinedCn.ready.catch(() => {})]);
      check('a second slot joining an already-running read shares its failure', inFlightReads === 1);
      startedBr.release(); joinedCn.release(); await pause(30);

      await clearPartition(br); await clearPartition(cn);
      let concurrentStore = '[]', concurrentReads = 0, concurrentWrites = 0, inFlight = 0, maxInFlight = 0;
      const writeGates = [];
      const concurrent = new LoginSessions(async (action, value) => {
        if (action === 'read') { concurrentReads++; return concurrentStore; }
        concurrentWrites++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise(resolve => writeGates.push(resolve));
        concurrentStore = value; inFlight--; return '';
      }, () => {});
      const concurrentBr = concurrent.acquire('br'), concurrentCn = concurrent.acquire('cn');
      await Promise.all([concurrentBr.ready, concurrentCn.ready]);
      check('concurrent slots share one successful store read', concurrentReads === 1);
      await concurrentBr.session.cookies.set({ url: origin, name: 'concurrent-br', value: 'br', httpOnly: true });
      await concurrentCn.session.cookies.set({ url: origin, name: 'concurrent-cn', value: 'cn', httpOnly: true });
      concurrentBr.release(); concurrentCn.release();
      await until(() => writeGates.length === 1);
      writeGates.shift()();
      await until(() => writeGates.length === 1);
      writeGates.shift()();
      await concurrent.flush();
      const concurrentPartitions = JSON.parse(concurrentStore).partitions;
      check('concurrent saves serialize and preserve both partitions', maxInFlight === 1 && concurrentWrites === 2 &&
        concurrentPartitions[br]?.some(item => item.name === 'concurrent-br') && concurrentPartitions[cn]?.some(item => item.name === 'concurrent-cn'));

      fs.writeFileSync(path.join(directory, 'memory-recovery-store.json'), stored);
      fs.writeFileSync(path.join(directory, 'memory-recovery.json'), JSON.stringify({ ok: true, results }, null, 2));
    } else if (phase === 'restore') {
      const br = 'persist:naruto-br-1', cn = 'persist:naruto-cn-1';
      const stored = fs.readFileSync(path.join(directory, 'memory-recovery-store.json'), 'utf8');
      let reports = 0;
      const login = new LoginSessions(async (action, value) => {
        if (action === 'read') return stored;
        fs.writeFileSync(path.join(directory, 'memory-recovery-store.json'), value); return '';
      }, () => { reports++; });
      win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
      games = new GameSessions(win, () => {}, () => {}, `${origin}/restore`, true, login);
      const brTab = games.create({ id: 'memory-restore-br', name: '', region: 'br' }, `${origin}/restore-br`);
      const cnTab = games.create({ id: 'memory-restore-cn', name: '', region: 'cn' }, `${origin}/restore-cn`);
      await Promise.all([ready(brTab), ready(cnTab)]);
      const brRequest = requests.find(request => request.url === '/restore-br');
      const cnRequest = requests.find(request => request.url === '/restore-cn');
      check('a new process sends the recovered login Cookie on its first request', brRequest?.cookie.includes('fixture-auth=new-login'));
      check('the saved logout remains deleted after restart', !brRequest?.cookie.includes('fixture-delete='));
      check('the recovered WK snapshot is present after restart', brRequest?.cookie.includes('fixture-wk-add=wk-snapshot') && !brRequest?.cookie.includes('fixture-wk-remove='));
      check('untouched cookies and the other region survive restart', brRequest?.cookie.includes('fixture-keep=untouched') && cnRequest?.cookie.includes('fixture-cn=preserve-other-region'));
      const collisions = await brTab.view.webContents.session.cookies.get({ name: 'collision' });
      check('host-only and Domain siblings restore independently after restart',
        collisions.some(item => item.hostOnly && item.value === 'host-updated') && collisions.some(item => !item.hostOnly && item.value === 'domain-saved'));
      check('restart restore completes without a storage failure', reports === 0);
      games.destroy(); await login.flush();
      fs.writeFileSync(path.join(directory, 'memory-restore.json'), JSON.stringify({ ok: true, results }, null, 2));
    } else throw new Error(`Unknown phase: ${phase}`);

    clearTimeout(watchdog); if (win && !win.isDestroyed()) win.destroy(); if (server) server.close(); app.quit();
  } catch (error) {
    console.error(error);
    fs.writeFileSync(path.join(directory, `memory-${phase}.json`), JSON.stringify({ ok: false, results, error: String(error) }, null, 2));
    clearTimeout(watchdog); if (games) games.destroy(); if (win && !win.isDestroyed()) win.destroy(); if (server) server.close(); app.exit(1);
  }
});
