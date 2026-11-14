import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import electron from 'electron';
await build({ entryPoints: ['src/main/localization-experiment.ts'], outfile: '.test-artifacts/localization-test/factory.cjs', bundle: true, platform: 'node', target: 'node12', external: ['electron'] });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(electron, ['tests/localization-window.cjs'], { env, stdio: 'inherit', timeout: 15000 });
process.exitCode = result.status === 0 ? 0 : 1;
