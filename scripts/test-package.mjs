import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const packaged = JSON.parse(readFileSync('release/latest-package.json', 'utf8'));
mkdirSync('.test-artifacts', { recursive: true });
const directory = mkdtempSync(path.resolve('.test-artifacts/package-check-'));
const env = { ...process.env, NARUTO_TEST_MODE: '1', NARUTO_DATA_DIR: path.join(directory, 'profile'), NARUTO_TEST_ARTIFACTS: directory };
// Simulate an older installation last closed on a game tab, using synthetic data only.
mkdirSync(env.NARUTO_DATA_DIR);
writeFileSync(path.join(env.NARUTO_DATA_DIR, 'account-profiles.json'), JSON.stringify({ version: 1,
  profiles: [
    { id: 'br-1', region: 'br', slot: 1, name: '合成巴西账号A', serverNote: '合成一区' },
    { id: 'br-2', region: 'br', slot: 2, name: '合成巴西账号B', serverNote: '合成二区' },
    { id: 'cn-1', region: 'cn', slot: 1, name: '合成国服账号', serverNote: '合成国服区' }
  ], selectedByRegion: { br: 'br-1', cn: 'cn-1' } }, null, 2), { mode: 0o600 });
mkdirSync(path.join(env.NARUTO_DATA_DIR, 'Partitions', 'naruto-br-7'), { recursive: true });
const restoredId = 'e'.repeat(24);
writeFileSync(path.join(env.NARUTO_DATA_DIR, 'layout.json'), JSON.stringify({ version: 1,
  tabs: [{ id: restoredId, name: 'restored fixture' }, { id: 'd'.repeat(24), name: 'dormant China fixture', region: 'cn' }], activeId: restoredId,
  preferences: { muted: false, flash: '34', theme: 'system', titleBarColor: null },
  bounds: { width: 1280, height: 850 }, maximized: false, fullscreen: false }));
delete env.ELECTRON_RUN_AS_NODE; delete env.NARUTO_DIRECT; delete env.NARUTO_TEST_PROBE;
const fixtureServer = createServer((request, response) => {
  const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(pathname === '/game'
    ? '<!doctype html><html><head><title>Isolated game fixture</title></head><body><main id="fixture-game">合成游戏页面</main></body></html>'
    : '<!doctype html><html><head><title>Isolated login fixture</title></head><body><button class="login_btn" id="continue">Continue</button><script>setTimeout(()=>location.assign("/game"),350)</script></body></html>');
});
await new Promise((resolve, reject) => fixtureServer.listen(0, '127.0.0.1', resolve).once('error', reject));
const address = fixtureServer.address();
if (!address || typeof address === 'string') throw new Error('Could not start isolated login fixture');
env.NARUTO_TEST_LOGIN_FIXTURE_URL = `http://127.0.0.1:${address.port}/pt/serverlist/s776`;
const service = `cn.youye.naruto-os.test.sessions.${createHash('sha256').update(env.NARUTO_DATA_DIR).digest('hex').slice(0, 16)}`;
const keychain = path.join(packaged.app, 'Contents/Resources/app/dist/native/keychain');
const seeded = spawnSync(keychain, [], { encoding: 'utf8', timeout: 10000, input: JSON.stringify({ action: 'write', service,
  value: JSON.stringify({ version: 1, partitions: { 'persist:naruto-br-2': [], 'persist:naruto-br-7': [], 'persist:naruto-cn-8': [] } }) }) });
if (seeded.status !== 0 || !JSON.parse(seeded.stdout || '{}').ok) throw new Error('Synthetic session slots could not be seeded');
const result = await new Promise(resolve => {
  const child = spawn(path.join(packaged.app, 'Contents/MacOS/Naruto OS'), [], { env, stdio: 'inherit' });
  child.once('error', error => resolve({ status: 1, error }));
  child.once('exit', (status, signal) => resolve({ status: status ?? 1, signal }));
});
await new Promise(resolve => fixtureServer.close(resolve));
const cleanup = spawnSync(path.join(packaged.app, 'Contents/Resources/app/dist/native/keychain'), [], { encoding: 'utf8', timeout: 10000,
  input: JSON.stringify({ action: 'delete-test', service }) });
let report;
try { report = JSON.parse(readFileSync(path.join(directory, 'integration.json'), 'utf8')); } catch {}
if (!report?.ok || result.status !== 0) process.exitCode = 1;
try { if (cleanup.status !== 0 || !JSON.parse(cleanup.stdout).ok) process.exitCode = 1; } catch { process.exitCode = 1; }
console.log(JSON.stringify({ ok: !!report?.ok && result.status === 0, directory, app: packaged.app, checks: report?.results?.length }));
