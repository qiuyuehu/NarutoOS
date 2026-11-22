// Guards a shutdown that is still saving from hanging forever. The timer may only
// force-finish a shutdown the user already confirmed, so cancelling or a failed
// save must disarm it instead of letting it bypass the session-save protection.
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs'), { buildSync } = require('esbuild');
const root = path.resolve(__dirname, '..');
const bundle = path.join(root, '.test-artifacts/exit-guard-tests/exit-guard.cjs');
fs.mkdirSync(path.dirname(bundle), { recursive: true });
buildSync({ entryPoints: [path.join(root, 'src/prototype/host/exit-guard.ts')], outfile: bundle,
  bundle: true, platform: 'node', format: 'cjs', target: 'node12' });
const { createExitGuard } = require(bundle);

function guard(state) {
  let current = state;
  const exits = [];
  const g = createExitGuard(() => exits.push(current));
  return { g, exits, set: value => { current = value; } };
}

test('saving shutdown that never finishes is force-finished', () => {
  const { g, exits, set } = guard('saving');
  g.arm(() => 'saving', 5);
  return new Promise(resolve => setTimeout(() => {
    assert.deepEqual(exits, ['saving']);
    resolve();
  }, 20));
});

test('cancelled shutdown is never force-finished', () => {
  let current = 'confirming';
  const exits = [];
  const g = createExitGuard(() => exits.push(current));
  g.arm(() => current, 5);
  current = 'running';
  g.clear();
  return new Promise(resolve => setTimeout(() => {
    assert.deepEqual(exits, []);
    resolve();
  }, 20));
});

test('a failed save keeps the window open instead of force-exiting', () => {
  let current = 'saving';
  const exits = [];
  const g = createExitGuard(() => exits.push(current));
  g.arm(() => current, 5);
  current = 'save-failed';
  return new Promise(resolve => setTimeout(() => {
    assert.deepEqual(exits, [], 'save-failed must not trigger the force exit');
    resolve();
  }, 20));
});

test('re-arming replaces the previous timer instead of stacking exits', () => {
  const { g, exits } = guard('saving');
  g.arm(() => 'saving', 5);
  g.arm(() => 'saving', 5);
  return new Promise(resolve => setTimeout(() => {
    assert.equal(exits.length, 1);
    resolve();
  }, 30));
});
