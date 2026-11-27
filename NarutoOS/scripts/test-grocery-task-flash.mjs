import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tools = path.join(root, '.test-artifacts/pure-timer-speed-probe/toolchain');
const fixture = path.join(root, 'tests/grocery-task-flash');
const out = path.join(root, '.test-artifacts/grocery-task-flash');
fs.mkdirSync(out, { recursive: true });
execFileSync(path.join(tools, 'java/jdk8u504-b01/Contents/Home/bin/java'), [
  '-jar', path.join(tools, 'flex/lib/mxmlc.jar'), '-load-config=', '-target-player=11.2',
  '-swf-version=13', '-debug=true', '-strict=true', '-theme=',
  '-external-library-path=' + path.join(tools, 'playerglobal/32.0/playerglobal.swc'),
  '-source-path=' + [path.join(fixture, 'src'), path.join(root, 'flash-patches/cn-daily-wanted')].join(path.delimiter),
  '-output=' + path.join(out, 'GroceryTaskFixture.swf'),
  path.join(fixture, 'src/GroceryTaskFixture.as'),
], { cwd: path.join(tools, 'flex/frameworks'), stdio: 'inherit' });
const env = { ...process.env, GROCERY_TASK_SWF: path.join(out, 'GroceryTaskFixture.swf') };
delete env.ELECTRON_RUN_AS_NODE;
execFileSync(path.join(root, 'node_modules/.bin/electron'), [path.join(fixture, 'runtime.cjs')], {
  cwd: root, stdio: 'inherit', env,
});
