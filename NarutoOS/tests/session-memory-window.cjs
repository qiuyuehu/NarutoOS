// Offline resource regression and memory observations using actual GameSessions.
// Each run uses a new profile; pages contain no remote resources or real accounts.
const { app, BrowserWindow, ipcMain, session } = require('electron');
const { GameSessions } = require('../dist/main/game.memory-test.cjs');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const directory = process.env.NARUTO_MEMORY_TEST_DIRECTORY;
assert(directory && directory.startsWith(path.resolve('.test-artifacts') + path.sep));
app.setPath('userData', path.join(directory, 'profile'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [], snapshots = [];
let win, games, reports = 0;
const check = (name, value) => { assert(value, name); results.push(name); console.log('PASS', name); };
async function ready(tab) {
  for (let i = 0; i < 200; i++) { if (tab.state === 'ready') return; await pause(25); }
  throw new Error('Synthetic tab did not become ready');
}
function download(target) {
  let prevented = false;
  target.emit('will-download', { preventDefault() { prevented = true; } });
  return prevented;
}
async function sample(phase) {
  const processes = app.getAppMetrics().map(({ pid, type, memory }) => ({ pid, type, memoryKB: memory }));
  snapshots.push({ phase, openTabs: games.tabs.length, processes,
    sumWorkingSetKB: processes.reduce((sum, item) => sum + (item.memoryKB?.workingSetSize || 0), 0),
    mainProcessMemory: await process.getProcessMemoryInfo(), mainJSBytes: process.memoryUsage() });
}
async function waitForRendererExit(pids) {
  for (let i = 0; i < 200; i++) {
    if (!app.getAppMetrics().some(item => pids.has(item.pid))) return;
    await pause(25);
  }
  throw new Error('Closed tab renderer processes remained alive');
}
app.whenReady().then(async () => {
  const watchdog = setTimeout(() => { console.error('Memory regression timeout'); app.exit(1); }, 80000);
  try {
    ipcMain.handle('game:form-state', () => ({ ok: true, value: null }));
    win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { sandbox: true, contextIsolation: true } });
    games = new GameSessions(win, () => {}, () => { reports++; }, 'about:blank');
    const anchor = games.create({ id: 'memory-anchor', name: '' }); await ready(anchor);
    games.select(anchor.id);
    const anchorSession = anchor.view.webContents.session;
    // Warm up page creation/destruction before recording the memory baseline.
    const warmup = games.create({ id: 'memory-warmup', name: '' }); await ready(warmup);
    games.close(warmup.id); await pause(750); await sample('baseline');
    const baselineRendererPids = new Set(snapshots[0].processes.filter(item => item.type === 'Tab').map(item => item.pid));
    for (let round = 0; round < 4; round++) {
      const closed = [];
      for (let index = 0; index < 5; index++) {
        const id = `memory-${round}-${index}`;
        const tab = games.create({ id, name: '' }); await ready(tab);
        const contents = tab.view.webContents, tabSession = contents.session;
        assert.strictEqual(tabSession.listenerCount('will-download'), 1);
        closed.push({ id, contents, tabSession });
      }
      await sample(`round-${round + 1}-open`);
      const openedRendererPids = new Set(snapshots[snapshots.length - 1].processes
        .filter(item => item.type === 'Tab' && !baselineRendererPids.has(item.pid)).map(item => item.pid));
      for (const tab of closed) games.close(tab.id);
      check(`round ${round + 1}: closed WebContents are destroyed`, closed.every(tab => tab.contents.isDestroyed()));
      check(`round ${round + 1}: closed Session download listeners are removed`, closed.every(tab => tab.tabSession.listenerCount('will-download') === 0));
      const before = reports;
      check(`round ${round + 1}: closed sessions no longer handle downloads`, closed.every(tab => !download(tab.tabSession)) && reports === before);
      check(`round ${round + 1}: active session still blocks downloads`, download(anchorSession) && reports === before + 1);
      check(`round ${round + 1}: active tab and account partitions stay isolated`, games.active === anchor && !anchor.view.webContents.isDestroyed() && closed.every(tab => tab.tabSession !== anchorSession));
      // Electron 11 retains partition Sessions; record identity without retaining tabs.
      check(`round ${round + 1}: reobtaining closed partitions does not restore listeners`, closed.every(tab => session.fromPartition(`naruto-${tab.id}`).listenerCount('will-download') === 0));
      closed.length = 0;
      await waitForRendererExit(openedRendererPids);
      check(`round ${round + 1}: closed tab renderer processes exit`, true);
      await pause(750); await sample(`round-${round + 1}-closed`);
    }
    const reopened = games.create({ id: 'memory-0-0', name: '' }); await ready(reopened);
    check('reopening a partition installs exactly one download listener', reopened.view.webContents.session.listenerCount('will-download') === 1);
    games.close(reopened.id);
    const finalSession = anchorSession;
    games.destroy(); games.destroy();
    check('destroy is idempotent and clears the last session listener', games.tabs.length === 0 && finalSession.listenerCount('will-download') === 0);
    await pause(750); await sample('all-closed');
    // Exercise the fallback path when WebContents is destroyed outside close().
    const unexpected = games.create({ id: 'memory-external-destroy', name: '' }); await ready(unexpected);
    const unexpectedContents = unexpected.view.webContents, unexpectedSession = unexpectedContents.session;
    unexpectedContents.destroy();
    check('external WebContents destruction also releases the Session listener', unexpectedContents.isDestroyed() && unexpectedSession.listenerCount('will-download') === 0);
    // The window will remove its destroyed BrowserView on teardown.
    const closedSamples = snapshots.filter(item => /baseline|round-\d+-closed/.test(item.phase));
    const trend = {
      netWorkingSetChangeKB: closedSamples[closedSamples.length - 1].sumWorkingSetKB - closedSamples[0].sumWorkingSetKB,
      increasesEveryClosedRound: closedSamples.slice(1).every((item, index) => item.sumWorkingSetKB > closedSamples[index].sumWorkingSetKB),
      closedRoundWorkingSetKB: closedSamples.map(({ phase, sumWorkingSetKB }) => ({ phase, sumWorkingSetKB }))
    };
    fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify({ ok: true, results, snapshots, trend,
      scenario: { rounds: 4, tabsPerRound: 5, page: 'about:blank', settleMilliseconds: 750 },
      units: { memoryKB: 'KiB as reported by Electron', mainProcessMemory: 'KiB', mainJSBytes: 'bytes' } }, null, 2));
    console.log('Closed-round working sets (MiB):', snapshots.filter(item => /baseline|closed/.test(item.phase)).map(item => `${item.phase}=${(item.sumWorkingSetKB / 1024).toFixed(1)}`).join(', '));
    console.log(`创建并关闭 20 个空白标签后工作集变化：${(trend.netWorkingSetChangeKB / 1024).toFixed(1)} MiB；逐轮上升：${trend.increasesEveryClosedRound}`);
    clearTimeout(watchdog); win.destroy(); app.quit();
  } catch (error) {
    console.error(error);
    fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify({ ok: false, results, snapshots, error: String(error) }, null, 2));
    clearTimeout(watchdog); if (games) games.destroy(); if (win && !win.isDestroyed()) win.destroy(); app.exit(1);
  }
});
