import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const speedTest = process.argv.includes('--10x');
const artifacts = path.join(root, '.test-artifacts', speedTest ? 'daily-queue-flash-10x' : 'daily-queue-flash');
const fixture = path.join(root, 'tests/daily-queue-flash');
const teamFixture = path.join(fixture, 'team-src');
const tools = path.join(root, '.test-artifacts/pure-timer-speed-probe/toolchain');
fs.mkdirSync(artifacts, { recursive: true });
const java = path.join(tools, 'java/jdk8u504-b01/Contents/Home/bin/java');
const sharedFixture = path.join(fixture, 'src');
const compile = (entry, output, sourceRoot = sharedFixture) => execFileSync(java, [
  '-jar', path.join(tools, 'flex/lib/mxmlc.jar'), '-load-config=', '-target-player=11.2',
  '-swf-version=13', '-debug=true', '-strict=true', '-theme=',
  '-external-library-path=' + path.join(tools, 'playerglobal/32.0/playerglobal.swc'),
  '-source-path=' + [...new Set([sourceRoot, sharedFixture, path.join(root, 'flash-patches/cn-daily-wanted')])].join(path.delimiter),
  '-output=' + path.join(artifacts, output),
  path.join(sourceRoot, entry),
], { cwd: path.join(tools, 'flex/frameworks'), stdio: 'inherit' });
compile('DailyQueueFixture.as', 'DailyQueueFixture.swf');
compile('StrongFixture.as', 'StrongFixture.swf');
compile('TeamDungeonFixture.as', 'TeamDungeonFixture.swf', teamFixture);
const electronEnv = { ...process.env, DAILY_QUEUE_FIXTURE_SWF: path.join(artifacts, 'DailyQueueFixture.swf'),
  DAILY_STRONG_FIXTURE_SWF: path.join(artifacts, 'StrongFixture.swf'),
  DAILY_TEAM_DUNGEON_FIXTURE_SWF: path.join(artifacts, 'TeamDungeonFixture.swf') };
delete electronEnv.ELECTRON_RUN_AS_NODE;
const args = [path.join(fixture, 'runtime.cjs')];
if (speedTest) {
  Object.assign(electronEnv, {
    DYLD_INSERT_LIBRARIES: path.join(root, 'assets/game-speed/libgame-speed.dylib'),
    NARUTO_GSCALE_MODE: 'sites',
    NARUTO_GSCALE_SITES: 'PepperFlashPlayer@1a7143,PepperFlashPlayer@1a70f5',
    NARUTO_GSCALE_RATE: '10',
  });
  args.push('--10x');
}
execFileSync(path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args, {
  cwd: root,
  stdio: 'inherit',
  env: electronEnv,
});
