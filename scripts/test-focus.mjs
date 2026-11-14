import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import electron from 'electron';
await mkdir('.test-artifacts/memory-focus', { recursive: true });
await build({
  entryPoints: ['src/renderer/focus.ts'],
  outfile: '.test-artifacts/memory-focus/focus-helper.js',
  bundle: true,
  format: 'iife',
  globalName: 'NarutoFocus',
  platform: 'browser',
  target: 'chrome87',
});
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(electron, ['tests/focus-window.cjs'], { env, stdio: 'inherit', timeout: 20000 });
process.exitCode = result.status === 0 ? 0 : 1;
