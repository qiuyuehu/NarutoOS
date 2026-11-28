const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const { buildSync } = require('esbuild');

const project = path.resolve(__dirname, '..');
const entry = path.join(project, 'src/prototype/host/game-resources.ts');
const bundle = buildSync({entryPoints: [entry], bundle: true, platform: 'node',
  format: 'cjs', external: ['electron'], write: false}).outputFiles[0].text;

function fixture(t) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'naruto-host-resources-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const module = new Module(entry);
  module.require = id => id === 'electron' ? {app: {isPackaged: true, getPath: () => profile}} : require(id);
  module._compile(bundle, entry);
  return {profile, load: module.exports.loadGameResources};
}

for (const [name, localization, assists, speed, variant] of [
  ['localization', true, false, false, 'localization-only'],
  ['assists', false, true, false, 'assist'],
  ['speed', false, false, true, undefined],
  ['all', true, true, true, 'localized-assist'],
]) {
  test('host registers ' + name + ' resources through one bridge per page', async t => {
    const {load} = fixture(t);
    const {bridge, status, localizationActive, speedOverrides} = load(project, {localization, assists, speed}, () => {});
    const activity = status.extraResources.find(item => item.moduleId === 'naruto-activity-assist-v1');
    assert.equal(localizationActive, localization);
    assert.equal(activity?.variant, variant);
    assert.deepEqual(status.rejected, []);
    assert.deepEqual([...speedOverrides.keys()].sort(), speed ? ['br','cn'] : []);
    for (const [id, region] of ['cn', 'br'].entries()) {
      const debug = new EventEmitter();
      const commands = [];
      let attachments = 0;
      debug.attach = () => attachments++;
      debug.sendCommand = async (method, params) => commands.push({method, params});
      const page = Object.assign(new EventEmitter(), {id, debugger: debug, getURL: () => 'about:blank',
        session: {webRequest: {onHeadersReceived() {}}}});
      await bridge.attach(page, speedOverrides.get(region));
      await bridge.attach(page, speedOverrides.get(region));
      assert.equal(attachments, 1);
      const fetch = commands.filter(call => call.method === 'Fetch.enable');
      assert.equal(fetch.length, 1);
      const urls = fetch[0].params.patterns.map(pattern => pattern.urlPattern);
      const brHud = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.39Build301/flash/hud/HudPlugin.swf*';
      const liveBrHud = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.41Build300/flash/hud/HudPlugin.swf*';
      const brMainUI = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.19Build301/flash/hud/mainUI.swf*';
      assert.equal(urls.includes(brHud), assists, 'the BR daily assistant follows the assist switch');
      assert.equal(urls.includes(liveBrHud), assists, 'the HUD requested by the 9.42 client follows the assist switch');
      assert.equal(urls.includes(brMainUI), localization, 'the translated BR HUD artwork follows the localization switch');
      for (const item of status.extraResources) {
        assert.equal(item.state, 'accepted');
        assert.ok(urls.includes(item.target + '*'));
      }
      assert.equal(commands.some(call => call.method === 'Page.enable'), speed);
      assert.equal(bridge.trackedOverrideStatus(page), 'pending');
    }
  });
}

test('speed-only host reports a bad CN patch and still tracks the BR patch', t => {
  const {profile, load} = fixture(t);
  const dir = 'assets/assists/global2x';
  fs.cpSync(path.join(project, dir), path.join(profile, dir), {recursive: true});
  fs.appendFileSync(path.join(profile, dir, 'naruto-core-patched.swf'), 'damaged');
  const {bridge, status, speedOverrides} = load(profile, {localization: false, assists: false, speed: true}, () => {});
  assert.ok(bridge);
  assert.deepEqual([...speedOverrides.keys()], ['br']);
  const bad = status.extraResources.find(item => item.region === 'cn');
  assert.equal(bad.moduleId, 'game-speed-v1');
  assert.match(bad.target, /res\.huoying\.qq\.com\/.*\/naruto\.core\.swf$/);
  assert.equal(bad.state, 'unavailable');
  assert.match(bad.reason, /摘要|SHA-256/);
});

test('localization can serve accepted extras when the assist receipt directory is unusable', t => {
  const {profile, load} = fixture(t);
  fs.writeFileSync(path.join(profile, 'assists'), 'occupied');
  const {bridge, localizationActive, status, speedOverrides} = load(project,
    {localization: true, assists: false, speed: true}, () => {});
  assert.ok(bridge && localizationActive);
  assert.equal(status.bridge, false);
  assert.equal(status.extraResources.filter(item => item.state === 'accepted').length, 3);
  assert.ok(status.rejected.some(item => item.moduleId === 'naruto-assists-v1'));
  assert.deepEqual([...speedOverrides.keys()].sort(), ['br', 'cn']);
});
