import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toolchain = path.join(root, '.test-artifacts/pure-timer-speed-probe/toolchain');
const out = path.join(root, '.test-artifacts/player-visibility-flash');
const fixture = path.join(root, 'tests/player-visibility-flash');
fs.mkdirSync(out, { recursive: true });
execFileSync(path.join(toolchain, 'java/jdk8u504-b01/Contents/Home/bin/java'), [
  '-jar', path.join(toolchain, 'flex/lib/mxmlc.jar'), '-load-config=', '-target-player=11.2',
  '-swf-version=13', '-debug=true', '-strict=true', '-theme=',
  '-external-library-path=' + path.join(toolchain, 'playerglobal/32.0/playerglobal.swc'),
  '-source-path=' + [path.join(fixture, 'src'), path.join(root, 'flash-patches/cn-daily-wanted')].join(path.delimiter),
  '-output=' + path.join(out, 'VisibilityFixture.swf'), path.join(fixture, 'src/VisibilityFixture.as'),
], { cwd: path.join(toolchain, 'flex/frameworks'), stdio: 'inherit' });
const env = { ...process.env, PLAYER_VISIBILITY_FIXTURE_SWF: path.join(out, 'VisibilityFixture.swf') };
delete env.ELECTRON_RUN_AS_NODE;
execFileSync(path.join(root, 'node_modules/.bin/electron'), [path.join(fixture, 'runtime.cjs')], { cwd: root, stdio: 'inherit', env });
