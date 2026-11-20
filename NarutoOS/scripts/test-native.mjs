import { build } from 'esbuild';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import electron from 'electron';
mkdirSync('.test-artifacts/native-window', { recursive: true });
await build({ entryPoints: ['src/main/traffic-lights.ts'], outfile: 'dist/main/traffic-lights.test.cjs', bundle: true, platform: 'node', target: 'node12', external: ['electron'] });
execFileSync('/usr/bin/xcrun', ['clang++', '-arch', 'x86_64', '-std=c++17', '-fobjc-arc', '-DNAPI_VERSION=6', '-DNARUTO_NATIVE_TEST',
  '-shared', '-undefined', 'dynamic_lookup', '-framework', 'AppKit', '-I', 'node_modules/node-api-headers/include',
  'native/TrafficLights.mm', '-o', '.test-artifacts/native-window/test.next.node'], { stdio: 'inherit' });
const { renameSync } = await import('node:fs');
renameSync('.test-artifacts/native-window/test.next.node', '.test-artifacts/native-window/test.node');
const env = { ...process.env, NARUTO_NATIVE_DATA_DIR: mkdtempSync(path.resolve('.test-artifacts/native-window/profile-')) };
delete env.ELECTRON_RUN_AS_NODE;
writeFileSync('.test-artifacts/native-window/native-results.json', JSON.stringify({ok:false,error:'Native test did not complete'}));
const result = spawnSync(electron, ['tests/native-window.cjs'], { env, stdio: 'inherit', timeout: 60000 });
try {
  const report = JSON.parse(readFileSync('.test-artifacts/native-window/native-results.json', 'utf8'));
  process.exitCode = result.status === 0 && report.ok === true ? 0 : 1;
} catch { process.exitCode = 1; }
