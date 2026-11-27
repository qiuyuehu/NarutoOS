import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, '.test-artifacts', 'escort-queue-flash');
const fixture = path.join(root, 'tests/escort-queue-flash');
const teamFixture = path.join(root, 'tests/daily-queue-flash/team-src');
const tools = path.join(root, '.test-artifacts/pure-timer-speed-probe/toolchain');
fs.mkdirSync(artifacts, { recursive: true });
const java = path.join(tools, 'java/jdk8u504-b01/Contents/Home/bin/java');
execFileSync(java, [
  '-jar', path.join(tools, 'flex/lib/mxmlc.jar'), '-load-config=', '-target-player=11.2',
  '-swf-version=13', '-debug=true', '-strict=true', '-theme=',
  '-external-library-path=' + path.join(tools, 'playerglobal/32.0/playerglobal.swc'),
  '-source-path=' + [path.join(fixture, 'src'), teamFixture, path.join(root, 'tests/daily-queue-flash/src'),
    path.join(root, 'flash-patches/cn-daily-wanted')].join(path.delimiter),
  '-output=' + path.join(artifacts, 'EscortQueueFixture.swf'),
  path.join(fixture, 'src/EscortQueueFixture.as'),
], { cwd: path.join(tools, 'flex/frameworks'), stdio: 'inherit' });

const electronEnv = { ...process.env, ESCORT_QUEUE_FIXTURE_SWF: path.join(artifacts, 'EscortQueueFixture.swf') };
delete electronEnv.ELECTRON_RUN_AS_NODE;
execFileSync(path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  [path.join(fixture, 'runtime.cjs')], { cwd: root, stdio: 'inherit', env: electronEnv });
