import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import electron from 'electron';

await build({ entryPoints: ['src/main/game.ts'], outfile: 'dist/main/game.memory-test.cjs', bundle: true, platform: 'node', target: 'node12', external: ['electron'] });
mkdirSync('.test-artifacts', { recursive: true });
const directory = mkdtempSync(path.resolve('.test-artifacts/session-memory-'));
const env = { ...process.env, NARUTO_MEMORY_TEST_DIRECTORY: directory };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(electron, ['tests/session-memory-window.cjs'], { env, stdio: 'inherit', timeout: 90000 });
console.log(`资源与内存测试报告：${path.join(directory, 'results.json')}`);
if (result.error) console.error(result.error.message);
process.exitCode = result.status === 0 ? 0 : 1;
