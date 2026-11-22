// The wrapper decoding must be byte-identical to the Python tool used by the pack
// generator, otherwise the runtime original-artifact check would reject valid builds.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), { buildSync } = require('esbuild');
const root = path.resolve(__dirname, '..');
const bundle = path.join(root, '.test-artifacts/game-swf-tests/game-swf.cjs');
fs.mkdirSync(path.dirname(bundle), { recursive: true });
buildSync({ entryPoints: [path.join(root, 'src/main/game-swf.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', target: 'node12' });
const { decodeGameSwf } = require(bundle);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

test('plain SWF bytes are returned untouched', () => {
  const plain = Buffer.concat([Buffer.from('FWS'), Buffer.from([10, 0, 0, 0]), Buffer.alloc(32, 7)]);
  assert.ok(decodeGameSwf(plain).equals(plain));
});

const original = path.join(root, '.test-artifacts/activity-assist-9.40Build300/OperatingActivityPlugin.original.swf');
test('a decoded original matches its manifest digest', {
  skip: !fs.existsSync(original) && 'requires the recorded activity SWF',
}, () => {
  const decoded = decodeGameSwf(fs.readFileSync(original));
  assert.equal(digest(decoded), '2b80bb73e8baf884f52ea029f38a59afd8358aeac14b1f4b26d562e73b23ea85');
});

test('a corrupt wrapper is rejected instead of being substituted', () => {
  const broken = Buffer.concat([Buffer.from('ZWS'), Buffer.from([0, 0xff, 0xff, 0xff, 0xff]), Buffer.alloc(16, 0)]);
  assert.throws(() => decodeGameSwf(broken), /解码失败/);
});
