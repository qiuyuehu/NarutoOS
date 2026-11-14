const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');

function loadTypeScript(relativePath) {
  const filename = path.join(root, relativePath);
  const result = esbuild.buildSync({
    entryPoints: [filename],
    bundle: true,
    platform: 'node',
    write: false,
    format: 'cjs',
  });
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  compiled._compile(result.outputFiles[0].text, filename);
  return compiled.exports;
}

const config = loadTypeScript('src/main/config.ts');
const policy = loadTypeScript('src/main/policy.ts');
const brazilLogin = loadTypeScript('src/shared/brazil-login.ts');
const { CredentialVault } = loadTypeScript('src/main/credentials.ts');

const tabId = (digit) => digit.repeat(24);

test('Brazil compatibility is restricted to the HTTPS official server-list page', () => {
  for (const url of ['https://naruto.narutowebgame.com/pt/serverlist', 'https://naruto.narutowebgame.com/pt/serverlist/?from=fixture']) assert(brazilLogin.isBrazilLoginPage(url));
  for (const url of ['https://huoying.qq.com/server/website/', 'https://naruto.narutowebgame.com/s776', 'http://naruto.narutowebgame.com/pt/serverlist', 'https://naruto.narutowebgame.com.evil.test/pt/serverlist', 'https://user:pass@naruto.narutowebgame.com/pt/serverlist']) assert.equal(brazilLogin.isBrazilLoginPage(url), false, url);
});

test('login error correlation returns only public metadata on exact endpoints', () => {
  const url = 'https://passport.oasgames.com/?m=login&email=synthetic-user&pwd=synthetic-secret&callback=jQuery_123&_=1234';
  assert.deepEqual(brazilLogin.loginRequestKey(url), { stage: 'auth', callback: 'jQuery_123', cache: '1234' });
  assert.deepEqual(brazilLogin.loginRequestKey(url.replace('m=login', 'm=getLoginUser')), { stage: 'userinfo', callback: 'jQuery_123', cache: '1234' });
  assert.deepEqual(brazilLogin.loginRequestKey('https://odp3.oasgames.com/api/game/get-user-servers?callback=jQuery_123&_=1235'), { stage: 'servers', callback: 'jQuery_123', cache: '1235' });
  for (const value of [url.replace('m=login', 'm=logout'), url.replace('passport.oasgames.com', 'passport.oasgames.com.evil.test'), url.replace('jQuery_123', 'invalid.callback'), url.replace('&_=1234', ''), 'not-a-url']) assert.equal(brazilLogin.loginRequestKey(value), null);
});

test('Retry-After supports seconds and dates with bounded cooldown', () => {
  const now = Date.parse('2026-10-20T00:00:00Z');
  assert.equal(brazilLogin.retryAfterSeconds('2', now), 2);
  assert.equal(brazilLogin.retryAfterSeconds('Tue, 20 Oct 2026 00:00:15 GMT', now), 15);
  assert.equal(brazilLogin.retryAfterSeconds('999999', now), 300);
  assert.equal(brazilLogin.retryAfterSeconds('0', now), 1);
  assert.equal(brazilLogin.retryAfterSeconds(undefined, now), 30);
  assert.equal(brazilLogin.retryAfterSeconds('invalid', now), 30);
});

test('normalizeLayout repairs invalid configuration values and selects a valid active tab', () => {
  const normalized = config.normalizeLayout({
    version: 1,
    tabs: [
      { id: 'not-an-id', name: 'invalid' },
      { id: tabId('a'), name: '  valid tab  ' },
    ],
    activeId: 'missing-tab',
    preferences: { muted: 'yes', flash: '99' },
    bounds: { width: 12, height: 99999, x: NaN, y: 20 },
    maximized: 'true',
  });

  assert.deepEqual(normalized.tabs, [{ id: tabId('a'), name: 'valid tab', region: 'br' }]);
  assert.equal(normalized.activeId, tabId('a'));
  assert.deepEqual(normalized.preferences, { muted: false, flash: '34', theme: 'system', titleBarColor: null, region: 'br', lobbyBackground: null, lobbyMotion: true, localization: false, quality: 'high' });
  assert.deepEqual(normalized.bounds, { width: 800, height: 2160 });
  assert.equal(normalized.maximized, false);

  const invalidVersion = config.normalizeLayout({ version: 2, tabs: [] });
  assert.equal(invalidVersion.version, 1);
  assert.equal(invalidVersion.tabs.length, 0);
  assert.equal(invalidVersion.activeId, null);
});

test('legacy layouts default launcher appearance and normalize invalid background values', () => {
  const legacy = config.normalizeLayout({ version: 1, tabs: [], activeId: null, preferences: { theme: 'dark', region: 'cn' } });
  assert.equal(legacy.preferences.lobbyBackground, null);
  assert.equal(legacy.preferences.lobbyMotion, true);
  const normalized = config.normalizeLayout({ version: 1, tabs: [], activeId: null,
    preferences: { lobbyBackground: '#A1B2C3', lobbyMotion: false } });
  assert.equal(normalized.preferences.lobbyBackground, '#a1b2c3');
  assert.equal(normalized.preferences.lobbyMotion, false);
  const invalid = config.normalizeLayout({ version: 1, tabs: [], activeId: null,
    preferences: { lobbyBackground: 'url(https://invalid.test)', lobbyMotion: 'off' } });
  assert.equal(invalid.preferences.lobbyBackground, null);
  assert.equal(invalid.preferences.lobbyMotion, true);
});

test('a blank tab label stays blank so the UI can restore its generated default label', () => {
  const normalized = config.normalizeLayout({
    version: 1,
    tabs: [{ id: tabId('b'), name: '   ' }],
    activeId: tabId('b'),
  });
  assert.equal(normalized.tabs[0].name, '');
  assert.equal(normalized.activeId, tabId('b'));
});

test('normalizeLayout removes duplicate tab ids while keeping the first label', () => {
  const normalized = config.normalizeLayout({
    version: 1,
    tabs: [
      { id: tabId('c'), name: 'first' },
      { id: tabId('c'), name: 'duplicate' },
      { id: tabId('d'), name: 'other' },
    ],
    activeId: tabId('c'),
  });
  assert.deepEqual(normalized.tabs, [
    { id: tabId('c'), name: 'first', region: 'br' },
    { id: tabId('d'), name: 'other', region: 'br' },
  ]);
});

test('credential origins accept only HTTPS origins on the exact allowlisted sites', () => {
  assert.equal(policy.credentialOrigin('https://naruto.narutowebgame.com/pt/login'), 'https://naruto.narutowebgame.com');
  assert.equal(policy.credentialOrigin('https://s12-naruto.oasgames.com/login'), 'https://s12-naruto.oasgames.com');
  for (const value of [
    'http://naruto.narutowebgame.com/login',
    'https://naruto.narutowebgame.com.evil.test/login',
    'https://naruto.evil.oasgames.com/login',
    'https://evil-naruto-pt.oasgames.com/login',
    'https://naruto-pt.evil.oasgames.com/login',
    'https://s1-naruto.evil.oasgames.com/login',
    'https://user:pass@naruto.narutowebgame.com/login',
  ]) {
    assert.equal(policy.credentialOrigin(value), null, value);
  }
});

test('save prompts can follow Brazil server navigation without broadening autofill origins', () => {
  const source = 'https://naruto.narutowebgame.com';
  assert(policy.savePromptDestination(source, source + '/pt/serverlist'));
  for (const url of ['https://s776-naruto.oasgames.com/game', 'https://naruto-pt-s1.oasgames.com/game']) {
    assert(policy.savePromptDestination(source, url));
    assert.notEqual(policy.credentialOrigin(url), source);
  }
  for (const url of ['https://huoying.qq.com/server/website/', 'https://passport.oasgames.com/', 'https://evil.test/', 'http://s776-naruto.oasgames.com/', 'https://s776-naruto.oasgames.com:444/', 'https://s776-naruto.oasgames.com.evil.test/']) assert.equal(policy.savePromptDestination(source, url), false, url);
  assert.equal(policy.savePromptDestination('https://s1-naruto.oasgames.com', 'https://s2-naruto.oasgames.com'), false);
});

test('manual password sites are the two configured game origins without widening autofill policy', () => {
  assert.deepEqual(policy.manualCredentialSiteOptions(), [
    { id: 'br', label: '巴西服' },
    { id: 'cn', label: '国服' },
  ]);
  assert.equal(policy.manualCredentialSite('br').origin, 'https://naruto.narutowebgame.com');
  assert.equal(policy.manualCredentialSite('cn').origin, 'https://huoying.qq.com');
  assert.equal(policy.credentialOrigin('https://huoying.qq.com/server/website/'), null);
  assert.equal(policy.credentialStorageOrigin('https://huoying.qq.com'), true);
  assert.equal(policy.credentialStorageOrigin('https://unrelated.example'), false);
});

function memoryTransport(initial = [], options = {}) {
  let serialized = JSON.stringify(initial);
  const calls = [];
  const transport = async (action, value) => {
    calls.push({ action, value });
    if (action === 'read') return serialized;
    if (options.rejectWrite) throw new Error('synthetic transport failure');
    serialized = value;
    return '';
  };
  return {
    transport,
    calls,
    records: () => JSON.parse(serialized),
  };
}

function record(id, origin, username, password) {
  return { id, origin, username, password, updatedAt: '2026-01-01T00:00:00.000Z' };
}

test('CredentialVault filters by exact origin and selected returns only the matching record', async () => {
  const first = record('id-one', 'https://naruto.narutowebgame.com', 'Alpha', 'secret-one');
  const second = record('id-two', 'https://naruto.oasgames.com', 'Beta', 'secret-two');
  const memory = memoryTransport([first, second]);
  const vault = new CredentialVault(memory.transport);

  const visible = await vault.list(first.origin);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, first.id);
  assert.equal(Object.hasOwn(visible[0], 'password'), false);
  assert.equal((await vault.selected(first.id, first.origin)).id, first.id);
  assert.equal(await vault.selected(first.id, second.origin), null);
  assert.equal(await vault.selected(second.id, first.origin), null);
});

test('CredentialVault updates an existing record and removes it by id', async () => {
  const existing = record('id-edit', 'https://naruto.narutowebgame.com', 'Alpha', 'old-secret');
  const memory = memoryTransport([existing]);
  const vault = new CredentialVault(memory.transport);

  await vault.save(existing.origin, 'Alpha', 'new-secret', existing.id);
  assert.equal(memory.records().length, 1);
  assert.equal(memory.records()[0].id, existing.id);
  assert.equal(memory.records()[0].password, 'new-secret');

  await vault.remove(existing.id);
  assert.deepEqual(memory.records(), []);
});

test('concurrent CredentialVault saves preserve every record', async () => {
  const memory = memoryTransport();
  const vault = new CredentialVault(memory.transport);
  const origin = 'https://naruto.narutowebgame.com';

  await Promise.all([
    vault.save(origin, 'Alpha', 'secret-a'),
    vault.save(origin, 'Beta', 'secret-b'),
    vault.save(origin, 'Gamma', 'secret-c'),
  ]);

  assert.deepEqual(memory.records().map(item => item.username).sort(), ['Alpha', 'Beta', 'Gamma']);
});

test('manual password saves trim usernames, preserve passwords, and keep the two sites separate', async () => {
  const memory = memoryTransport();
  const vault = new CredentialVault(memory.transport);
  const brPassword = '  说"明\\密码  ';
  assert.deepEqual(await vault.addManual('https://naruto.narutowebgame.com', '  Shared User  ', brPassword), { status: 'saved' });
  assert.deepEqual(await vault.addManual('https://naruto.narutowebgame.com', 'Shared User', brPassword), { status: 'unchanged' });
  assert.deepEqual(await vault.addManual('https://huoying.qq.com', 'Shared User', 'china-password'), { status: 'saved' });
  const records = memory.records();
  assert.equal(records.length, 2);
  assert.equal(records.find(item => item.origin === 'https://naruto.narutowebgame.com').password, brPassword);
  assert.equal(records.find(item => item.origin === 'https://naruto.narutowebgame.com').username, 'Shared User');
  assert.equal(records.find(item => item.origin === 'https://huoying.qq.com').password, 'china-password');
});

test('manual duplicate updates require confirmation and re-confirm when the stored record changes', async () => {
  const memory = memoryTransport();
  const vault = new CredentialVault(memory.transport);
  await vault.addManual('https://naruto.narutowebgame.com', 'Alpha', 'old-secret');
  const firstPrompt = await vault.addManual('https://naruto.narutowebgame.com', ' Alpha ', 'new-secret');
  assert.equal(firstPrompt.status, 'confirm-update');
  if (firstPrompt.status !== 'confirm-update') throw new Error('expected update confirmation');

  await vault.save('https://naruto.narutowebgame.com', 'Alpha', 'concurrent-secret', firstPrompt.id);
  const changedPrompt = await vault.addManual('https://naruto.narutowebgame.com', 'Alpha', 'new-secret', firstPrompt);
  assert.equal(changedPrompt.status, 'confirm-update');
  if (changedPrompt.status !== 'confirm-update') throw new Error('expected re-confirmation');
  assert.equal(memory.records()[0].password, 'concurrent-secret');

  const saved = await vault.addManual('https://naruto.narutowebgame.com', 'Alpha', 'new-secret', changedPrompt);
  assert.deepEqual(saved, { status: 'saved' });
  assert.equal(memory.records().length, 1);
  assert.equal(memory.records()[0].id, firstPrompt.id);
  assert.equal(memory.records()[0].password, 'new-secret');
});

test('manual password write failures leave the saved records unchanged and unsupported sites are rejected', async () => {
  const memory = memoryTransport([], { rejectWrite: true });
  const vault = new CredentialVault(memory.transport);
  await assert.rejects(vault.addManual('https://naruto.narutowebgame.com', 'Synthetic User', 'synthetic-password'), /synthetic transport failure/);
  await assert.rejects(vault.addManual('https://evil.example', 'Synthetic User', 'synthetic-password'), /账号或网站信息无效/);
  assert.deepEqual(memory.records(), []);
});

test('transport write rejection rejects save and does not persist credentials elsewhere', async () => {
  const memory = memoryTransport([], { rejectWrite: true });
  const vault = new CredentialVault(memory.transport);

  await assert.rejects(
    vault.save('https://naruto.narutowebgame.com', 'Synthetic User', 'synthetic-password'),
    /synthetic transport failure/,
  );

  assert.deepEqual(memory.records(), []);
  assert.deepEqual(memory.calls.map(call => call.action), ['read', 'write']);
});

test('window restoration retains fullscreen and rounds native window coordinates', () => {
  const layout = config.normalizeLayout({ version: 1, tabs: [], bounds: { x: 12.7, y: 20.2, width: 1000.8, height: 700.1 }, maximized: true, fullscreen: true });
  assert.deepEqual(layout.bounds, { x: 13, y: 20, width: 1001, height: 700 });
  assert.equal(layout.maximized, true);
  assert.equal(layout.fullscreen, true);
  assert.equal(layout.activeId, null);
});

test('appearance preferences migrate old files and reject malformed colors and themes', () => {
  const old = config.normalizeLayout({ version: 1, tabs: [], preferences: { muted: true, flash: '31' } });
  assert.deepEqual(old.preferences, { muted: true, flash: '31', theme: 'system', titleBarColor: null, region: 'br', lobbyBackground: null, lobbyMotion: true, localization: false, quality: 'high' });
  const invalid = config.normalizeLayout({ version: 1, tabs: [], preferences: { theme: 'purple', titleBarColor: 'url(https://invalid.test)' } });
  assert.equal(invalid.preferences.theme, 'system');
  assert.equal(invalid.preferences.titleBarColor, null);
});

test('appearance preferences survive configuration write and restore', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'naruto-appearance-'));
  try {
    const store = new config.ConfigStore(directory);
    const layout = config.defaultLayout();
    layout.preferences.theme = 'dark'; layout.preferences.titleBarColor = '#B7C4D4';
    store.write(layout);
    assert.deepEqual(store.read().preferences, { muted: false, flash: '34', theme: 'dark', titleBarColor: '#b7c4d4', region: 'br', lobbyBackground: null, lobbyMotion: true, localization: false, quality: 'high' });
    layout.preferences.titleBarColor = null; store.write(layout);
    assert.equal(store.read().preferences.titleBarColor, null);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('custom title colors choose a readable foreground across light and dark backgrounds', () => {
  const { titlePalette } = loadTypeScript('src/shared/appearance.ts');
  for (const color of ['#000000', '#ffffff', '#b7c4d4', '#294059', '#777777', '#aa3333']) {
    const palette = titlePalette(color);
    const linear = [1, 3, 5].map(i => {
      const v = parseInt(color.slice(i, i + 2), 16) / 255;
      return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
    });
    const lum = linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
    const contrast = palette.fg === '#ffffff' ? 1.05 / (lum + .05) : (lum + .05) / .05;
    assert(contrast >= 4.5, color);
  }
  assert.throws(() => titlePalette('red'), /颜色无效/);
});


test('regions migrate old tabs to Brazil and persist each tab independently of the next launch', () => {
  const layout = config.normalizeLayout({ version: 1, activeId: null,
    tabs: [{ id: tabId('a'), name: 'legacy' }, { id: tabId('b'), name: 'china', region: 'cn' }, { id: tabId('c'), name: '', region: '__proto__' }],
    preferences: { region: 'cn' } });
  assert.deepEqual(layout.tabs.map(t => t.region), ['br', 'cn', 'br']);
  assert.equal(layout.preferences.region, 'cn');
  assert.equal(layout.activeId, null, 'home remains selected while game tabs are retained');
  assert.equal(config.newTab('cn').region, 'cn');
  assert.equal(config.newTab().region, 'br');
  const restored = config.normalizeLayout(JSON.parse(JSON.stringify(layout)));
  assert.deepEqual(restored.tabs, layout.tabs);
  assert.equal(restored.preferences.region, 'cn');
  assert.equal(config.normalizeLayout({version:1,tabs:[],preferences:{region:'toString'}}).preferences.region,'br');
});


test('localization defaults off and only an explicit boolean enables it', () => {
  assert.equal(config.defaultLayout().preferences.localization, false);
  for (const value of [undefined, null, 'true', 1, false]) {
    assert.equal(config.normalizeLayout({ version: 1, preferences: { localization: value } }).preferences.localization, false);
  }
  assert.equal(config.normalizeLayout({ version: 1, preferences: { localization: true } }).preferences.localization, true);
});

test('default Flash quality migrates to high and validates supported levels', () => {
  for (const value of ['low', 'medium', 'high', 'invalid', null]) {
    const result = config.normalizeLayout({ version: 1, preferences: { quality: value } });
    assert.equal(result.preferences.quality, ['low', 'medium', 'high'].includes(value) ? value : 'high');
  }
});

test('default Flash quality survives configuration reconstruction', () => {
  const fs = require('node:fs');
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'naruto-quality-'));
  try {
    for (const quality of ['low', 'medium', 'high']) {
      const layout = config.defaultLayout(); layout.preferences.quality = quality;
      new config.ConfigStore(directory).write(layout);
      assert.equal(new config.ConfigStore(directory).read().preferences.quality, quality);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
