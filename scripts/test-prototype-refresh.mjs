import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import electron from 'electron';
// Run after prototype:build so the toolbar and embedded WK helper match source.
await build({ entryPoints: ['src/main/web-login.ts', 'src/main/navigation.ts', 'src/main/game.ts', 'src/main/login-sessions.ts', 'src/preload/game.ts'], outdir: 'dist/web-login-test', outbase: 'src', bundle: true, platform: 'node', target: 'node12', external: ['electron'] });
const root = mkdtempSync(path.resolve('.test-artifacts/prototype-refresh-'));
const env = { ...process.env, NARUTO_REFRESH_CHECK_ROOT: root };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(electron, ['tests/prototype-refresh-window.cjs'], { env, stdio: 'inherit', timeout: 65000 });
console.log('刷新验收报告：' + root);
process.exitCode = result.status === 0 ? 0 : 1;
