// Executes the real AS3 batch handlers from the patch source via syntax-only
// translation. Display and protocol collaborators are doubles; Flash scheduling and
// server replies are not simulated. These tests pin the request-ownership rules that
// the review found missing: a manual sell must not count as a merge, a manual summon
// must not advance the batch, and a pickup reply that arrives after stop must still
// finish cleanly instead of dereferencing a missing button.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const SOURCE = path.join(root, 'flash-patches/huntlife-batch-6.38Build302/com/tencent/morefun/naruto/plugin/huntlife/view/PracticePanel.as');

function extractMethod(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'missing ' + name);
  let depth = 0, end = -1;
  for (let p = source.indexOf('{', start); p < source.length; p++) {
    if (source[p] === '{') depth++;
    else if (source[p] === '}') { depth--; if (depth === 0) { end = p; break; } }
  }
  assert.ok(end > start, 'unbalanced ' + name);
  return source.slice(start, end + 1)
    .replace(/^function (\w+)/, 'function $1')
    .replace(/\bprivate /g, ' ')
    .replace(/([\w.]+)\s+is\s+(\w+)/g, '($1 instanceof $2)')
    .replace(/\.@(\w+)/g, '.$1')
    .replace(/for each\((\w+) in ([^)]+)\)/g, 'for ($1 of $2)');
}

class InteractiveObject {}
class ProtoSellChakraRsp { constructor() { this.hasHuntLifeInfo = false; } }
class ProtoPracticeRsp { constructor() { this.practiceInfo = []; this.hasHuntLifeInfo = false; } }
class ProtoPickUpChakraRsp { constructor() { this.hasHuntLifeInfo = false; this.index = []; } }
function ProtoSellChakraReq() {}
function ProtoPracticeReq(message) {
  if (!(this instanceof ProtoPracticeReq)) return message || { npcId: 0 };
  this.npcId = (message && message.npcId) || 0;
}
function ProtoPickUpChakraReq() {}
class Display extends InteractiveObject {}
class Sprite extends Display { constructor() { super(); this.name = 'quick_sell_btn'; this.x = 0; this.y = 0; } }
function ProtoChakraBlankInfo() { this.grade = 0; this.type = 0; }
const HUNT_LIFE_CMD = { PRACTICE: 213255, SELL_CHAKRA: 213256, PICKUP: 213254 };

function load(source, name) {
  const body = extractMethod(source, name);
  const js = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2020 }, reportDiagnostics: true });
  assert.equal(js.diagnostics.length, 0, js.diagnostics.map(d => d.messageText).join('\n'));
  const scope = {
    InteractiveObject, ProtoChakraBlankInfo, ProtoSellChakraRsp, ProtoPracticeRsp, ProtoPickUpChakraRsp,
    ProtoSellChakraReq, ProtoPracticeReq, ProtoPickUpChakraReq, Sprite, Display,
    HuntLifeProtocolCmd: HUNT_LIFE_CMD, GameTip: { show() {} },
    ChakraType: { TYPE_0: 0 }, ChakraQuality: { toColorName: (t) => t },
    HuntLifeUtil: { isFullLevel: (level) => level >= 11 },
    OpenHuntLifeMainPanelCommand: class { call() {} },
    ShowTextBoxCommand: class { constructor() {} call() {} },
    OpenVIPWindowCommand: class { call() {} },
    BoxFlagDef: { OK: 1, CANCEL: 2, CLOSE: 4 },
    int: Math.trunc, uint: (v) => v >>> 0, String, Number, Math, Array, Error,
    BATCH_CLIENT: 'narutoBatch'
  };
  return vm.runInNewContext('(function(){\n' + js.outputText + '\nreturn ' + name + ';\n})()', scope);
}

function context(overrides) {
  const ctx = {
    batchRunning: false, batchPhase: 'idle', batchRoundsDone: 0, batchCallsTotal: 0, batchCallsThisRound: 0,
    practiceSending: false, selling: false, practiceInfoList: [],
    model: { attackHuntLifeInfo() {}, attachNpcInfo() {}, freeCount: 0, vip4FreeCount: 0, score: 0 },
    ui: { sellNone: { selected: false } }, costXML: { item: [{ cost: 5000 }] },
    gameServer: { sendMessage() {} },
    stopReason: null, merges: 0, pickups: 0, advances: 0,
    batchStop(reason) { this.stopReason = reason; },
    onBatchMerge() { this.merges++; },
    onBatchPickup() { this.pickups++; },
    onBatchPractice() { this.advances++; },
    refreshScore() {}, playPractice() {}, playPracticeComplete() {},
    getCurrentQualityCondition() { return 1; }
  };
  return Object.assign(ctx, overrides);
}

const read = () => fs.readFileSync(SOURCE, 'utf8');

test('a manual sell reply does not count as a completed merge', () => {
  const source = read();
  const handler = load(source, 'onSellOrMergeRsp');
  const ctx = context({ batchRunning: true, batchPhase: 'summonWait' });
  handler.call(ctx, { error: 0, clientData: new Sprite(), serverMessage: { hasHuntLifeInfo: false } });
  assert.equal(ctx.merges, 0, 'manual sells share the SELL_CHAKRA protocol and must not advance the batch');
});

test('a merge reply only counts while the batch is waiting for a merge', () => {
  const source = read();
  const handler = load(source, 'onSellOrMergeRsp');
  const ctx = context({ batchRunning: true, batchPhase: 'summonWait' });
  handler.call(ctx, { error: 0, clientData: 'narutoBatch', serverMessage: { hasHuntLifeInfo: false } });
  assert.equal(ctx.merges, 0, 'a merge reply outside mergeWait means the request was not ours');
});

test('a manual summon reply does not advance the batch', () => {
  const source = read();
  const handler = load(source, 'onPracticeRsp');
  const ctx = context({ batchRunning: true, batchPhase: 'summonWait' });
  handler.call(ctx, { error: 0, clientData: '1', clientMessage: { npcId: 1 }, serverMessage: { practiceInfo: [], hasHuntLifeInfo: false } });
  assert.equal(ctx.advances, 0, 'clicking an NPC by hand must keep the batch state untouched');
});

test('a batch pickup reply arriving after stop finishes without a null reference', () => {
  const source = read();
  const handler = load(source, 'onPickupRsp');
  const ctx = context({ batchRunning: false, batchPhase: 'idle' });
  const reply = { error: 0, clientData: 'narutoBatch', serverMessage: { hasHuntLifeInfo: true, huntLifeInfo: {}, index: [1] } };
  assert.doesNotThrow(() => handler.call(ctx, reply));
  assert.equal(ctx.pickups, 0, 'a stopped batch must not advance a round from a late reply');
});

test('a batch summon reply advances only while waiting for a summon', () => {
  const source = read();
  const handler = load(source, 'onPracticeRsp');
  const ctx = context({ batchRunning: true, batchPhase: 'summonWait' });
  handler.call(ctx, { error: 0, clientData: 'narutoBatch', clientMessage: { npcId: 1 }, serverMessage: { practiceInfo: [], hasHuntLifeInfo: false } });
  assert.equal(ctx.advances, 1, 'the awaited batch summon reply must still advance');
});
