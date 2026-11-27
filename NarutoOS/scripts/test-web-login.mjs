import { build } from 'esbuild';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import electron from 'electron';
import { webLoginSources } from './web-login-sources.mjs';
await build({ entryPoints: ['src/main/web-login.ts', 'src/main/navigation.ts', 'src/main/game.ts', 'src/main/login-sessions.ts', 'src/preload/game.ts', 'src/shared/i18n.ts'], outdir: 'dist/web-login-test', outbase: 'src',
  bundle: true, platform: 'node', target: 'node12', external: ['electron'] });
mkdirSync('.test-artifacts', { recursive: true });
const directory = mkdtempSync(path.resolve('.test-artifacts/web-login-'));
const scopeCheck = path.join(directory, 'cookie-scope-check');
execFileSync('/usr/bin/xcrun', ['swiftc', '-parse-as-library', '-D', 'NARUTO_EMBEDDED', ...webLoginSources,
  'tests/web-login-cookie-scope.swift', 'tests/web-login-credential-picker.swift', '-o', scopeCheck], { stdio: 'inherit' });
execFileSync(scopeCheck, [], { stdio: 'inherit' });
const pickerPage = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><form><input name="username" value="synthetic"><input type="password" name="password"></form>');
});
try {
  pickerPage.listen(0, '127.0.0.1');
  await once(pickerPage, 'listening');
  const { stdout } = await promisify(execFile)(scopeCheck, ['--credential-picker',
    `http://127.0.0.1:${pickerPage.address().port}/pt/serverlist`], { timeout: 20000 });
  console.log(stdout.trim());
} finally {
  pickerPage.close();
}
const env = { ...process.env, NARUTO_WEB_LOGIN_TEST: directory };
delete env.ELECTRON_RUN_AS_NODE;
for (const phase of ['seed', 'restore']) {
  const result = spawnSync(electron, ['tests/web-login-window.cjs', phase, '-ApplePersistenceIgnoreState', 'YES'], { env, stdio: 'inherit', timeout: 60000, killSignal: 'SIGKILL' });
  if (result.status !== 0) { process.exitCode = 1; break; }
}
console.log(`现代登录测试报告：${directory}`);
