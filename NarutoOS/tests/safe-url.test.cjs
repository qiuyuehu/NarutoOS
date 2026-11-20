// Ticket-bearing game entries are supported by the WebKit handoff, so any crash or
// diagnostic log must keep only the origin and path.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), { buildSync } = require('esbuild');
const root = path.resolve(__dirname, '..');
const bundle = path.join(root, '.test-artifacts/safe-url-tests/safe-url.cjs');
fs.mkdirSync(path.dirname(bundle), { recursive: true });
buildSync({ entryPoints: [path.join(root, 'src/prototype/host/safe-url.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', target: 'node12' });
const { redactURL } = require(bundle);

test('drops the ticket query from a game entry URL', () => {
  assert.equal(redactURL('https://naruto.example/game?ticket=synthetic-ticket'), 'https://naruto.example/game');
});

test('drops credentials embedded in the URL', () => {
  assert.equal(redactURL('https://user:pass@naruto.example/game?ticket=abc'), 'https://naruto.example/game');
});

test('drops fragments', () => {
  assert.equal(redactURL('https://naruto.example/game#session=abc'), 'https://naruto.example/game');
});

test('keeps an ordinary URL unchanged', () => {
  assert.equal(redactURL('https://naruto.example/game'), 'https://naruto.example/game');
});

test('an unreadable value is logged as empty instead of raw', () => {
  assert.equal(redactURL(undefined), '');
  assert.equal(redactURL('about:blank'), '');
});
