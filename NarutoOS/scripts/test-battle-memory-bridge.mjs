import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import electron from 'electron';
await Promise.all([
 build({entryPoints:['src/main/battle-memory-experiment.ts'],outfile:'.test-artifacts/battle-memory-bridge-test/bridge.cjs',bundle:true,platform:'node',target:'node12',external:['electron']}),
 build({entryPoints:['src/main/game.ts'],outfile:'dist/main/game.battle-bridge-test.cjs',bundle:true,platform:'node',target:'node12',external:['electron']})
]);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const result=spawnSync(electron,['tests/battle-memory-bridge-window.cjs'],{env,stdio:'inherit',timeout:55000});
process.exitCode=result.status===0?0:1;
