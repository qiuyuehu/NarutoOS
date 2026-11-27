const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');

function loadActivityLoader(app) {
  const filename = path.join(root, 'src/main/activity-assist.ts');
  const result = esbuild.buildSync({
    entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs',
    write: false, logLevel: 'silent', external: ['electron'],
  });
  const loader = new Module(filename);
  loader.require = name => name === 'electron' ? { app } : require(name);
  loader._compile(result.outputFiles[0].text, filename);
  return loader.exports.loadActivityResources;
}

test('活动资源加载记录实际选择的变体，纯汉化可单独请求', () => {
  const load = loadActivityLoader({ isPackaged: true });
  const directory = path.join(root, 'assets/activity-assist-9.40Build300');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  const cases = [
    [false, true, 'assist', manifest.file],
    [true, true, 'localized-assist', manifest.localizedFile],
    [true, false, 'localization-only', manifest.localizationOnlyFile],
  ];

  for (const [localized, enabled, variant, filename] of cases) {
    const [result] = load(root, localized, enabled);
    assert.equal(result.moduleId, 'naruto-activity-assist-v1');
    assert.equal(result.region, 'br');
    assert.equal(result.variant, variant);
    assert.equal(result.target, 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.40Build300/flash/operatingActivity/OperatingActivityPlugin.swf');
    assert.deepEqual(result.resource.bytes, fs.readFileSync(path.join(directory, filename)));
    assert.equal('failure' in result, false);
  }
});

test('关闭活动与汉化时没有加载结果', () => {
  const load = loadActivityLoader({ isPackaged: true });
  assert.deepEqual(load(root, false, false), []);
});

test('已请求资源读取失败时保留目标、变体与原因', () => {
  const load = loadActivityLoader({ isPackaged: true });
  const [result] = load(path.join(root, '.test-artifacts/missing-activity-resource'), true, false);
  assert.equal(result.moduleId, 'naruto-activity-assist-v1');
  assert.equal(result.region, 'br');
  assert.equal(result.variant, 'localization-only');
  assert.equal(result.target, 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.40Build300/flash/operatingActivity/OperatingActivityPlugin.swf');
  assert.match(result.failure, /ENOENT/);
  assert.equal('resource' in result, false);
});
