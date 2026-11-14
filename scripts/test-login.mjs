import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import electron from 'electron';

mkdirSync('.test-artifacts', { recursive: true });
await build({ entryPoints: ['src/main/game.ts'], outfile: 'dist/main/game.login-test.cjs', bundle: true, platform: 'node', target: 'node12', external: ['electron'] });
for (const file of ['tests/loading-window.cjs', 'tests/login-window.cjs', 'tests/message-layout-window.cjs']) {
  const env = { ...process.env, NARUTO_LOGIN_TEST_PROFILE: mkdtempSync(path.resolve('.test-artifacts/login-profile-')) };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(electron, [file], { env, stdio: 'inherit' });
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
}
