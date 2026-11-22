const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const esbuild = require('esbuild');
const ts = require('typescript');

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

test('未验证页触发回退后，继续向晚出现的插件补发 1 倍', () => {
  const filename = path.join(root, 'src/prototype/host/main.ts');
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  const start = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'start');
  const applySpeed = start.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'applySpeed');
  const signals = [];
  let now = 2000;
  let pids = [];
  const context = vm.createContext({
    Date: { now: () => now }, games: { tabs: [{}] }, shutting: false, speedEnabled: true, speedRate: 2,
    speedAutoRaise: false, speedSuspended: false, speedAttemptAt: now, speedRetryMs: 2000,
    currentSpeedDecision: () => speedPolicy({ activePages: ['pending'], suspended: false, rate: context.speedRate }),
    findPpapiPIDs: () => pids,
    signalAllPpapi: (targets, rate) => {
      signals.push(...targets.map(pid => [pid, rate]));
      return targets.length;
    },
    hostEvent() {}, paint() {},
  });
  vm.runInContext(ts.transpileModule(applySpeed.getText(source), {}).outputText, context);
  context.applySpeed();
  assert.equal(context.speedRate, 1);
  assert.deepEqual(signals, []);
  pids = [42];
  now += 2000;
  context.applySpeed();
  assert.deepEqual(signals, [[42, 1]]);
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
