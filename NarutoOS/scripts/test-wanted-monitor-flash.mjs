import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'tests/wanted-monitor-flash');
const speedTest = process.argv.includes('--10x');
const artifacts = path.join(root, '.test-artifacts', speedTest ? 'wanted-monitor-flash-10x' : 'wanted-monitor-flash');
const tools = path.join(root, '.test-artifacts/pure-timer-speed-probe/toolchain');
fs.mkdirSync(artifacts, { recursive: true });
const java = path.join(tools, 'java/jdk8u504-b01/Contents/Home/bin/java');
execFileSync(java, [
  '-jar', path.join(tools, 'flex/lib/mxmlc.jar'), '-load-config=', '-target-player=11.2',
  '-swf-version=13', '-debug=true', '-strict=true', '-theme=',
  '-includes=def.BoxFlagDef,def.ModelDef,task.defs.TaskTypeDef,user.def.UserStateDef,serverProto.fight.FightStartType,def.PluginDef',
  '-external-library-path=' + path.join(tools, 'playerglobal/32.0/playerglobal.swc'),
  '-source-path=' + [path.join(root, 'flash-patches/cn-daily-wanted'), path.join(fixture, 'src')].join(path.delimiter),
  '-output=' + path.join(artifacts, 'WantedFixture.swf'),
  path.join(fixture, 'src/WantedFixture.as'),
], { cwd: path.join(tools, 'flex/frameworks'), stdio: 'inherit' });

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
if (speedTest) {
  Object.assign(env, {
    DYLD_INSERT_LIBRARIES: path.join(root, 'assets/game-speed/libgame-speed.dylib'),
    NARUTO_GSCALE_MODE: 'sites',
    NARUTO_GSCALE_SITES: 'PepperFlashPlayer@1a7143,PepperFlashPlayer@1a70f5',
    NARUTO_GSCALE_RATE: '10',
  });
}
const electron = path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const args = [path.join(fixture, 'runtime.cjs')];
if (speedTest) args.push('--10x');
execFileSync(electron, args, {
  cwd: root, stdio: 'inherit', env,
});
