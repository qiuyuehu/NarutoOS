import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import electron from 'electron';

await build({ entryPoints: ['src/main/game.ts', 'src/main/login-sessions.ts', 'src/main/account-profiles.ts'], outdir: 'dist/session-test', bundle: true,
  platform: 'node', target: 'node12', external: ['electron'] });
mkdirSync('.test-artifacts', { recursive: true });
const directory = mkdtempSync(path.resolve('.test-artifacts/login-sessions-'));
const service = `cn.youye.naruto-os.test.sessions.${path.basename(directory)}`;
const env = { ...process.env, NARUTO_SESSION_TEST_DIRECTORY: directory, NARUTO_SESSION_TEST_SERVICE: service };
delete env.ELECTRON_RUN_AS_NODE;
let ok = true;
try {
  for (const phase of ['seed', 'restore', 'retry', 'cleared']) {
    const result = spawnSync(electron, ['tests/login-sessions-window.cjs', phase], { env, stdio: 'inherit', timeout: 40000, killSignal: 'SIGKILL' });
    if (result.error) console.error(result.error.message);
    if (result.status !== 0) { ok = false; break; }
    if (!JSON.parse(readFileSync(path.join(directory, `${phase}.json`), 'utf8')).ok) { ok = false; break; }
  }
  if (ok) {
    for (const phase of ['recovery', 'restore']) {
      const result = spawnSync(electron, ['tests/login-sessions-recovery-window.cjs', phase], { env, stdio: 'inherit', timeout: 40000, killSignal: 'SIGKILL' });
      if (result.error) console.error(result.error.message);
      if (result.status !== 0) { ok = false; break; }
      if (!JSON.parse(readFileSync(path.join(directory, `memory-${phase}.json`), 'utf8')).ok) { ok = false; break; }
    }
  }
} finally {
  const cleanup = spawnSync(path.resolve('dist/native/keychain'), [], { input: JSON.stringify({ action: 'delete-test', service }), encoding: 'utf8', timeout: 10000 });
  if (cleanup.status !== 0 || !JSON.parse(cleanup.stdout || '{}').ok) { console.error('Synthetic Keychain cleanup failed'); ok = false; }
}
console.log(`跨进程登录状态测试报告：${directory}`);
process.exitCode = ok ? 0 : 1;
