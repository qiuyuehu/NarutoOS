const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src/main/game-speed.ts');
const compiled = esbuild.buildSync({
  entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs',
  write: false, logLevel: 'silent',
});
const loader = new Module(filename);
loader._compile(compiled.outputFiles[0].text, filename);
const { loadSpeedPatches, SPEED_PATCH_DEFINITIONS, SPEED_PATCH_ID, speedPatchPath } = loader.exports;

test('倍速资源成功项带有服别、目标与可直接登记的资源', () => {
  const results = loadSpeedPatches(root);
  assert.equal(results.length, 2);
  for (const definition of SPEED_PATCH_DEFINITIONS) {
    const result = results.find(item => item.region === definition.region);
    assert.equal(result.moduleId, SPEED_PATCH_ID);
    assert.equal(result.target, new URL(definition.url).origin + new URL(definition.url).pathname);
    assert.equal(result.resource.url, definition.url);
    assert.equal(result.resource.baseSha256, definition.baseSha256);
    assert.equal(result.resource.bytes.equals(fs.readFileSync(speedPatchPath(root, definition.region))), true);
    assert.equal('failure' in result, false);
  }
});

test('单服补丁校验失败仍返回目标与原因，另一服继续可用', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'naruto-speed-loader-'));
  try {
    const brSource = speedPatchPath(root, 'br');
    const brTarget = speedPatchPath(project, 'br');
    const cnTarget = speedPatchPath(project, 'cn');
    fs.mkdirSync(path.dirname(brTarget), { recursive: true });
    fs.copyFileSync(brSource, brTarget);
    fs.writeFileSync(cnTarget, Buffer.from('FWS-invalid-patch'));

    const results = loadSpeedPatches(project);
    const cn = results.find(item => item.region === 'cn');
    const br = results.find(item => item.region === 'br');
    assert.equal(cn.moduleId, SPEED_PATCH_ID);
    assert.equal(cn.target, new URL(SPEED_PATCH_DEFINITIONS.find(item => item.region === 'cn').url).origin
      + new URL(SPEED_PATCH_DEFINITIONS.find(item => item.region === 'cn').url).pathname);
    assert.match(cn.failure, /SHA-256/);
    assert.equal('resource' in cn, false);
    assert.equal(br.resource.url, SPEED_PATCH_DEFINITIONS.find(item => item.region === 'br').url);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('缺少的服别资源也留下明确失败记录', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'naruto-speed-loader-missing-'));
  try {
    const results = loadSpeedPatches(project);
    assert.equal(results.length, 2);
    for (const result of results) {
      assert.equal(result.region === 'br' || result.region === 'cn', true);
      assert.match(result.target, /^https:\/\//);
      assert.match(result.failure, /ENOENT/);
      assert.equal('resource' in result, false);
    }
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});
