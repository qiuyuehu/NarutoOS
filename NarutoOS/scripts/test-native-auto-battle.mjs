import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, '.test-artifacts/native-auto-battle');
const fixture = path.join(root, 'tests/native-auto-battle');
const tools = path.join(root, '.test-artifacts/pure-timer-speed-probe/toolchain');
fs.mkdirSync(artifacts, { recursive: true });
const java = path.join(tools, 'java/jdk8u504-b01/Contents/Home/bin/java');
execFileSync(java, [
  '-jar', path.join(tools, 'flex/lib/mxmlc.jar'), '-load-config=', '-target-player=11.2',
  '-swf-version=13', '-debug=true', '-strict=true', '-theme=',
  '-external-library-path=' + path.join(tools, 'playerglobal/32.0/playerglobal.swc'),
  '-source-path=' + [path.join(fixture, 'src'), path.join(root, 'flash-patches/cn-daily-wanted')].join(path.delimiter),
  '-output=' + path.join(artifacts, 'NativeAutoBattleFixture.swf'),
  path.join(fixture, 'src', 'NativeAutoBattleFixture.as'),
], { cwd: path.join(tools, 'flex/frameworks'), stdio: 'inherit' });

const electronEnv = { ...process.env,
  NATIVE_AUTO_BATTLE_SWF: path.join(artifacts, 'NativeAutoBattleFixture.swf') };
delete electronEnv.ELECTRON_RUN_AS_NODE;
execFileSync(path.join(root, 'node_modules/.bin/electron'), [path.join(fixture, 'runtime.cjs')], {
  cwd: root, stdio: 'inherit', env: electronEnv,
});
