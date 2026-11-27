const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const esbuild = require('esbuild');
const { msg } = require('./helpers/i18n.cjs');

const root = path.resolve(__dirname, '..');

function loadTypeScript(relativePath) {
  const filename = path.join(root, relativePath);
  const result = esbuild.buildSync({
    entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs',
    write: false, logLevel: 'silent', external: ['electron'],
  });
  const loader = new Module(filename);
  loader.require = name => name === 'electron' ? {} : require(name);
  loader._compile(result.outputFiles[0].text, filename);
  return loader.exports;
}

const { speedPolicy } = loadTypeScript('src/main/game-speed.ts');
const { BattleMemoryBridge } = loadTypeScript('src/main/battle-memory-experiment.ts');
const { createSpeedCoordinator, SPEED_RETRY_MS } = loadTypeScript('src/prototype/host/speed-coordinator.ts');

test('全部游戏页都要独立验证，未就绪时回退至 1 倍', () => {
  const activePages = ['verified', 'pending'];
  assert.deepEqual(speedPolicy({ activePages, suspended: false, rate: 1 }),
    { allowRaise: false, revertToOne: false });
  assert.deepEqual(speedPolicy({ activePages, suspended: false, rate: 2 }),
    { allowRaise: false, revertToOne: true });
  assert.deepEqual(speedPolicy({ activePages: ['verified', 'verified'], suspended: false, rate: 1 }),
    { allowRaise: true, revertToOne: false });
});

test('本会话失配后禁止升档及维持 2 倍', () => {
  assert.deepEqual(speedPolicy({ activePages: ['verified'], suspended: true, rate: 1 }),
    { allowRaise: false, revertToOne: false });
  assert.deepEqual(speedPolicy({ activePages: ['verified'], suspended: true, rate: 2 }),
    { allowRaise: false, revertToOne: true });
});

test('关闭最后一个游戏页后应回到 1 倍', () => {
  assert.deepEqual(speedPolicy({ activePages: [], suspended: false, rate: 2 }),
    { allowRaise: false, revertToOne: true });
});

test('3–10 倍遇未验证页同样回退到 1 倍', () => {
  // 多档扩展后的回退边界：任何大于 1 倍的档位都受未验证页约束，不限于 2 倍。
  assert.deepEqual(speedPolicy({ activePages: ['verified', 'pending'], suspended: false, rate: 5 }),
    { allowRaise: false, revertToOne: true });
  assert.deepEqual(speedPolicy({ activePages: ['verified', 'pending'], suspended: false, rate: 10 }),
    { allowRaise: false, revertToOne: true });
  assert.deepEqual(speedPolicy({ activePages: [], suspended: false, rate: 5 }),
    { allowRaise: false, revertToOne: true });
  assert.deepEqual(speedPolicy({ activePages: ['verified'], suspended: false, rate: 5 }),
    { allowRaise: true, revertToOne: false });
});

function speedFixture({ enabled = true, rememberedRate = 5 } = {}) {
  const verified = { status: 'verified', destroyed: false, isDestroyed() { return this.destroyed; } };
  const tab = { state: 'ready', view: { webContents: verified } };
  const fixture = {
    tab, verified, tabs: [tab], now: SPEED_RETRY_MS, shutting: false, plugins: 1,
    pushes: [], saves: [], notices: [], saveFailed: false,
  };
  const speed = createSpeedCoordinator({
    enabled, rememberedRate,
    getTabs: () => fixture.tabs,
    trackedStatus: contents => contents.status,
    isShuttingDown: () => fixture.shutting,
    now: () => fixture.now,
    pushSpeed(rate) { fixture.pushes.push(rate); return fixture.plugins; },
    async saveRate(rate) {
      fixture.saves.push(rate);
      if (fixture.saveFailed) throw Error('synthetic Core save failure');
    },
    report: text => fixture.notices.push(text),
    hostEvent() {},
    paint() {},
  });
  return Object.assign(fixture, { speed });
}

test('会话从 1 倍起步，刷新及新页面验证结束后恢复实际档位', async () => {
  const f = speedFixture();
  assert.equal(f.speed.toolbarState().rate, 1);
  await f.speed.setSpeed(7);
  f.tab.state = 'loading';
  f.speed.applySpeed();
  assert.equal(f.speed.toolbarState().rate, 1);
  assert.equal(f.pushes.at(-1), 1);

  f.tab.state = 'ready';
  const second = { ...f.verified, status: 'pending' };
  f.tabs.push({ state: 'ready', view: { webContents: second } });
  f.now += SPEED_RETRY_MS;
  f.speed.applySpeed();
  assert.equal(f.speed.toolbarState().rate, 1);
  second.status = 'verified';
  f.now += SPEED_RETRY_MS;
  f.speed.applySpeed();
  assert.equal(f.speed.toolbarState().rate, 7);
  assert.equal(f.pushes.at(-1), 7);
  assert.deepEqual(f.saves, [7]);
});

test('加载中手动选当前 1 倍，取消自动恢复且不写 Core', async () => {
  const f = speedFixture();
  f.speed.applySpeed();
  f.tab.state = 'loading';
  f.speed.applySpeed();
  await f.speed.setSpeed(1);
  f.tab.state = 'ready';
  f.now += SPEED_RETRY_MS;
  f.speed.applySpeed();
  assert.deepEqual(f.pushes, [5, 1, 1]);
  assert.equal(f.speed.toolbarState().rate, 1);
  assert.deepEqual(f.saves, []);
});

test('关闭最后一个页面后回到 1 倍，退出确认期间暂停补发', () => {
  const f = speedFixture();
  f.speed.applySpeed();
  f.shutting = true;
  f.tabs.length = 0;
  f.now += SPEED_RETRY_MS;
  f.speed.applySpeed();
  assert.equal(f.speed.toolbarState().rate, 5);
  assert.deepEqual(f.pushes, [5]);
  f.shutting = false;
  f.speed.applySpeed();
  assert.deepEqual(f.speed.toolbarState(), { available: true, rate: 1, allowRaise: false });
  assert.deepEqual(f.pushes, [5, 1]);
  assert.deepEqual(f.saves, []);
});

test('工具栏或菜单首先观测到失配即锁定本会话，忽略已销毁页面', () => {
  for (const readState of ['toolbarState', 'menuState']) {
    const f = speedFixture();
    f.tabs.push({ state: 'loading', view: { webContents: { ...f.verified, destroyed: true, status: 'mismatch' } } });
    f.speed.applySpeed();
    assert.equal(f.speed.toolbarState().rate, 5);

    f.tab.state = 'loading';
    f.verified.status = 'mismatch';
    assert.equal(f.speed[readState]().allowRaise, false);
    f.tab.state = 'ready';
    f.verified.status = 'verified';
    f.speed.applySpeed();
    assert.deepEqual(f.speed.menuState(), { rate: 1, allowRaise: false });
    assert.deepEqual(f.notices, [msg('ui.speed_resource_mismatch_reverted')]);
    f.now += SPEED_RETRY_MS;
    f.speed.applySpeed();
    assert.deepEqual(f.pushes, [5, 1, 1]);
    assert.deepEqual(f.saves, []);
  }
});

test('未验证页触发回退后，继续向晚出现的插件补发 1 倍', () => {
  const f = speedFixture();
  f.speed.applySpeed();
  f.verified.status = 'pending';
  f.plugins = 0;
  f.speed.applySpeed();
  assert.equal(f.speed.toolbarState().rate, 1);
  f.plugins = 1;
  f.now += SPEED_RETRY_MS - 1;
  f.speed.applySpeed();
  assert.deepEqual(f.pushes, [5, 1]);
  f.now += 1;
  f.speed.applySpeed();
  assert.deepEqual(f.pushes, [5, 1, 1]);
});

test('手动投递失败不保存，Core 保存失败保留已投递的档位', async () => {
  const f = speedFixture();
  f.plugins = 0;
  await f.speed.setSpeed(8);
  assert.equal(f.speed.toolbarState().rate, 1);
  assert.deepEqual(f.notices, [msg('ui.speed_plugin_not_running')]);
  assert.deepEqual(f.saves, []);

  f.plugins = 1;
  f.saveFailed = true;
  await f.speed.setSpeed(8);
  assert.equal(f.speed.toolbarState().rate, 8);
  assert.deepEqual(f.pushes, [8, 8]);
  assert.deepEqual(f.saves, [8]);
  const reopened = speedFixture();
  assert.equal(reopened.speed.toolbarState().rate, 1);
  reopened.speed.applySpeed();
  assert.equal(reopened.speed.toolbarState().rate, 5);
});

test('功能关闭时忽略记忆档位与手动切档', async () => {
  const f = speedFixture({ enabled: false });
  f.speed.applySpeed();
  await f.speed.setSpeed(5);
  assert.deepEqual(f.speed.toolbarState(), { available: false, rate: 1, allowRaise: false });
  assert.deepEqual(f.pushes, []);
  assert.deepEqual(f.saves, []);
});

test('旧页面延迟到达的响应与回执都不能验证新页面', async t => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'naruto-speed-bridge-'));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const url = 'https://fixture.invalid/naruto.core.swf';
  const bytes = Buffer.from('patched');
  const baseSha256 = createHash('sha256').update('original').digest('hex');
  const bridge = new BattleMemoryBridge(url, bytes, output, undefined, { entryBaseSha256: baseSha256 });
  const contents = Object.assign(new EventEmitter(), { id: 1, getURL: () => 'about:blank' });
  const debug = contents.debugger = new EventEmitter();
  debug.attach = () => {};
  let releaseOldReceipt;
  debug.sendCommand = async (method, params) => {
    if (method === 'Fetch.getResponseBody') return { body: 'original' };
    if (method === 'Fetch.fulfillRequest' && params.requestId === 'old-receipt') {
      await new Promise(resolve => { releaseOldReceipt = resolve; });
    }
  };
  await bridge.attach(contents, { url, bytes, baseSha256, contentType: 'application/x-shockwave-flash' });
  const request = { url, method: 'GET' };
  const send = (method, params) => debug.emit('message', {}, method, params);
  const requestStarted = id => send('Network.requestWillBeSent', { requestId: id, request });
  const responsePaused = id => send('Fetch.requestPaused',
    { requestId: id, networkId: id, request, responseStatusCode: 200 });
  const navigate = () => {
    contents.emit('did-start-navigation', {}, url, false, true);
    send('Page.frameNavigated', { frame: { id: 'main' } });
  };
  const flush = () => new Promise(setImmediate);

  navigate();
  requestStarted('old-response');
  requestStarted('old-receipt');
  responsePaused('old-receipt');
  await flush();
  navigate();
  responsePaused('old-response');
  releaseOldReceipt();
  await flush();
  assert.equal(bridge.trackedOverrideStatus(contents), 'pending');

  requestStarted('new-response');
  responsePaused('new-response');
  await flush();
  assert.equal(bridge.trackedOverrideStatus(contents), 'verified');
});
