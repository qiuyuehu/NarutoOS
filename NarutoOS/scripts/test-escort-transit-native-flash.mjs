import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'tests/escort-transit-native-flash');
const artifacts = path.join(root, '.test-artifacts/escort-transit-native-flash');
const tools = path.join(root, '.test-artifacts/pure-timer-speed-probe/toolchain');
fs.mkdirSync(artifacts, { recursive: true });
const java = path.join(tools, 'java/jdk8u504-b01/Contents/Home/bin/java');
const swf = path.join(artifacts, 'EscortTransitFixture.swf');
execFileSync(java, [
  '-jar', path.join(tools, 'flex/lib/mxmlc.jar'), '-load-config=', '-target-player=11.2',
  '-swf-version=13', '-debug=true', '-strict=true', '-theme=',
  '-external-library-path=' + path.join(tools, 'playerglobal/32.0/playerglobal.swc'),
  '-source-path=' + [path.join(fixture, 'src'), path.join(root, 'flash-patches/cn-daily-wanted')].join(path.delimiter),
  '-output=' + swf, path.join(fixture, 'src/EscortTransitFixture.as'),
], { cwd: path.join(tools, 'flex/frameworks'), stdio: 'inherit' });

const env = { ...process.env, ESCORT_TRANSIT_NATIVE_SWF: swf };
delete env.ELECTRON_RUN_AS_NODE;
execFileSync(path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  [path.join(fixture, 'runtime.cjs')], { cwd: root, stdio: 'inherit', env });
