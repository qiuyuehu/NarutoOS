import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(root, 'tests/team-dungeon-panel-flash/src');
const patchRoot = path.join(root, 'flash-patches/cn-daily-wanted');
const artifacts = path.join(root, '.test-artifacts/team-dungeon-panel-flash');
const toolchain = path.join(root, '.test-artifacts/pure-timer-speed-probe/toolchain');
const java = path.join(toolchain, 'java/jdk8u504-b01/Contents/Home/bin/java');
const flex = path.join(toolchain, 'flex/lib/mxmlc.jar');
fs.mkdirSync(artifacts, { recursive: true });

const swf = path.join(artifacts, 'TeamDungeonPanelFixture.swf');
execFileSync(java, [
  '-jar', flex, '-load-config=', '-target-player=11.2', '-swf-version=13', '-debug=true',
  '-strict=true', '-theme=',
  '-external-library-path=' + path.join(toolchain, 'playerglobal/32.0/playerglobal.swc'),
  '-source-path=' + [fixtureRoot, patchRoot].join(path.delimiter),
  '-output=' + swf,
  path.join(fixtureRoot, 'TeamDungeonPanelFixture.as'),
], { cwd: path.join(toolchain, 'flex/frameworks'), stdio: 'inherit' });

const env = { ...process.env, TEAM_DUNGEON_PANEL_FIXTURE_SWF: swf };
delete env.ELECTRON_RUN_AS_NODE;
execFileSync(path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [
  path.join(root, 'tests/team-dungeon-panel-flash/runtime.cjs'),
], { cwd: root, stdio: 'inherit', env });
