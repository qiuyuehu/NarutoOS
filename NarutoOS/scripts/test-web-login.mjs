import { build } from 'esbuild';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import electron from 'electron';
await build({ entryPoints: ['src/main/web-login.ts', 'src/main/navigation.ts', 'src/main/game.ts', 'src/main/login-sessions.ts', 'src/preload/game.ts'], outdir: 'dist/web-login-test', outbase: 'src',
  bundle: true, platform: 'node', target: 'node12', external: ['electron'] });
mkdirSync('.test-artifacts', { recursive: true });
const directory = mkdtempSync(path.resolve('.test-artifacts/web-login-'));
const scopeCheck = path.join(directory, 'cookie-scope-check');
execFileSync('/usr/bin/xcrun', ['swiftc', '-parse-as-library', '-D', 'NARUTO_EMBEDDED', 'native/WebLoginPrototype.swift', 'tests/web-login-cookie-scope.swift', '-o', scopeCheck], { stdio: 'inherit' });
execFileSync(scopeCheck, [], { stdio: 'inherit' });
const env = { ...process.env, NARUTO_WEB_LOGIN_TEST: directory };
delete env.ELECTRON_RUN_AS_NODE;
for (const phase of ['seed', 'restore']) {
  const result = spawnSync(electron, ['tests/web-login-window.cjs', phase, '-ApplePersistenceIgnoreState', 'YES'], { env, stdio: 'inherit', timeout: 60000, killSignal: 'SIGKILL' });
  if (result.status !== 0) { process.exitCode = 1; break; }
}
console.log(`现代登录测试报告：${directory}`);
