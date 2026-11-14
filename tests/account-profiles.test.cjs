const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
fs.mkdirSync(path.resolve('.test-artifacts'), { recursive: true });
const compiledDirectory = fs.mkdtempSync(path.join(path.resolve('.test-artifacts'), 'account-profiles-module-'));
const compiledFile = path.join(compiledDirectory, 'account-profiles.cjs');
esbuild.buildSync({ entryPoints: [path.resolve('src/main/account-profiles.ts')], bundle: true, platform: 'node', format: 'cjs', target: 'node16', outfile: compiledFile });
const { AccountProfileStore, AccountProfiles, parseStoredPartitionNames, profilesFromLegacySources } = require(compiledFile);
test.after(() => fs.rmSync(compiledDirectory, { recursive: true, force: true }));

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(path.resolve('.test-artifacts'), 'account-profiles-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('legacy discovery merges directory-only and keychain-only slots without creating sessions', () => {
  const profiles = profilesFromLegacySources(
    ['naruto-br-2', 'naruto-cn-4', 'other-partition', 'naruto-br-8'],
    ['persist:naruto-br-8', 'persist:naruto-cn-6']
  );
  assert.deepEqual(profiles.map(({ id, name }) => [id, name]), [
    ['br-2', '历史登录槽位2'], ['br-8', '历史登录槽位8'], ['cn-4', '历史登录槽位4'], ['cn-6', '历史登录槽位6']
  ]);
  assert.deepEqual(parseStoredPartitionNames('["persist:naruto-br-8","persist:naruto-cn-6"]'),
    ['persist:naruto-br-8', 'persist:naruto-cn-6']);
  assert.throws(() => parseStoredPartitionNames('["persist:naruto-br-8","cookie-value"]'), /格式异常/);
});

test('metadata writes atomically, stays private, and survives store reconstruction', t => {
  const directory = temporaryDirectory(t);
  const first = new AccountProfileStore(directory);
  assert.deepEqual(first.profiles(), []);
  assert.equal(fs.existsSync(first.file), false, 'reading a missing profile file does not create it');

  const created = first.create('br', 3, '  巴西主号  ', '  木叶一区  ');
  assert.deepEqual(created, { id: 'br-3', region: 'br', slot: 3, name: '巴西主号', serverNote: '木叶一区' });
  assert.equal(first.selected('br'), 'br-3');
  assert.equal(fs.statSync(first.file).mode & 0o777, 0o600);

  first.create('cn', 2, '国服备用', '');
  const reopened = new AccountProfileStore(directory);
  assert.equal(reopened.loadError, null);
  assert.equal(reopened.get('br-3').serverNote, '木叶一区');
  assert.equal(reopened.selected('br'), 'br-3');
  assert.equal(reopened.selected('cn'), 'cn-2');
  reopened.update('br-3', '巴西主号改名', '');
  const afterEdit = new AccountProfileStore(directory);
  assert.equal(afterEdit.get('br-3').name, '巴西主号改名');
  assert.equal(afterEdit.get('br-3').serverNote, '');
  assert.equal(afterEdit.get('br-3').slot, 3);
});

test('metadata write failure leaves the original file and in-memory profile unchanged', t => {
  const directory = temporaryDirectory(t);
  const store = new AccountProfileStore(directory);
  store.create('br', 1, '原档案', '原备注');
  const originalBytes = fs.readFileSync(store.file, 'utf8');
  const renameSync = fs.renameSync;
  fs.renameSync = function(source, destination) {
    if (destination === store.file) throw new Error('synthetic rename failure');
    return renameSync.call(fs, source, destination);
  };
  try { assert.throws(() => store.update('br-1', '不应保存', '不应保存'), /保存失败/); }
  finally { fs.renameSync = renameSync; }
  assert.equal(fs.readFileSync(store.file, 'utf8'), originalBytes);
  assert.equal(store.get('br-1').name, '原档案');
  assert.deepEqual(fs.readdirSync(directory), ['account-profiles.json'], 'failed temporary metadata file is removed');
});

test('corrupt or duplicate metadata is preserved and can be retried after repair', async t => {
  const directory = temporaryDirectory(t);
  const file = path.join(directory, 'account-profiles.json');
  const bytes = '{"version":1,"profiles":[{broken';
  fs.writeFileSync(file, bytes, { mode: 0o600 });
  const store = new AccountProfileStore(directory);
  assert.match(store.loadError, /无法读取/);
  assert.throws(() => store.create('br', 1, '新档案', ''), /无法读取/);
  assert.equal(fs.readFileSync(file, 'utf8'), bytes);

  const duplicate = { version: 1, profiles: [
    { id: 'br-1', region: 'br', slot: 1, name: 'A', serverNote: '' },
    { id: 'br-1', region: 'br', slot: 1, name: 'B', serverNote: '' }
  ], selectedByRegion: { br: 'br-1', cn: null } };
  fs.writeFileSync(file, JSON.stringify(duplicate));
  const repeated = new AccountProfileStore(directory);
  assert.match(repeated.loadError, /无法读取/);
  assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify(duplicate));
  const retryable = new AccountProfiles(repeated, directory, async () => []);
  await assert.rejects(retryable.discover(), /无法读取/);
  fs.writeFileSync(file, JSON.stringify({ version: 1, profiles: [], selectedByRegion: { br: null, cn: null } }));
  await retryable.discover(true);
  assert.equal(retryable.status, 'ready', 'retry reloads repaired metadata without restarting the app');
});

test('new allocation uses the highest known slot and discovery failure blocks creation', async t => {
  const directory = temporaryDirectory(t);
  const partitions = path.join(directory, 'Partitions');
  fs.mkdirSync(path.join(partitions, 'naruto-br-2'), { recursive: true });
  fs.mkdirSync(path.join(partitions, 'naruto-cn-5'), { recursive: true });
  const profiles = new AccountProfiles(new AccountProfileStore(directory), directory,
    async () => ['persist:naruto-br-8', 'persist:naruto-cn-5']);
  await profiles.discover();
  assert.deepEqual(profiles.list().map(profile => profile.id), ['br-2', 'br-8', 'cn-5']);
  const created = profiles.create('br', '巴西新号', '新服');
  assert.equal(created.id, 'br-9', 'a historical gap is not reused');
  assert.equal(fs.existsSync(path.join(partitions, 'naruto-br-9')), false, 'discovery does not create a Chromium Session');
  const renamedLegacy = profiles.update('br-2', '已命名的历史槽位', '木叶一区');
  assert.deepEqual([renamedLegacy.id, renamedLegacy.slot, renamedLegacy.name, renamedLegacy.serverNote], ['br-2', 2, '已命名的历史槽位', '木叶一区']);
  const persisted = new AccountProfileStore(directory);
  assert.equal(persisted.get('br-2').name, '已命名的历史槽位');
  assert.equal(persisted.selected('br'), 'br-9', 'editing a historical slot does not change the selected account');

  const failing = new AccountProfiles(new AccountProfileStore(directory), directory, async () => { throw new Error('钥匙串暂时不可用'); });
  await assert.rejects(failing.discover(), /钥匙串暂时不可用/);
  assert.equal(failing.status, 'failed');
  assert.equal(failing.canCreate, false);
  assert.throws(() => failing.create('br', '不可分配', ''), /钥匙串暂时不可用/);
  assert.ok(failing.get('br-9'), 'known saved profiles remain visible when discovery fails');
});

test('pending deletion survives restart, falls back to another profile, and tombstones old data sources', async t => {
  const directory = temporaryDirectory(t);
  const partitions = path.join(directory, 'Partitions');
  fs.mkdirSync(path.join(partitions, 'naruto-br-1'), { recursive: true });
  fs.mkdirSync(path.join(partitions, 'naruto-br-3'), { recursive: true });
  const firstStore = new AccountProfileStore(directory);
  firstStore.create('br', 1, '合成账号A', '');
  firstStore.create('br', 2, '合成账号B', '');
  firstStore.select(firstStore.get('br-1'));
  const profiles = new AccountProfiles(firstStore, directory, async () => ['persist:naruto-br-4']);
  await profiles.discover();

  profiles.beginDelete('br-1');
  assert.equal(profiles.isPendingDelete('br-1'), true);
  assert.equal(profiles.selected('br'), 'br-2', 'deleting the selected account chooses the first remaining same-region account');

  const restartedStore = new AccountProfileStore(directory);
  const restarted = new AccountProfiles(restartedStore, directory, async () => ['persist:naruto-br-1', 'persist:naruto-br-4']);
  assert.equal(restartedStore.isPendingDelete('br-1'), true, 'interrupted cleanup stays pending and is not auto-completed');
  await restarted.discover();
  assert.ok(restarted.get('br-1'), 'pending metadata retains the profile identity for a manual retry');
  assert.equal(restarted.selected('br'), 'br-2');

  restarted.completeDelete('br-1');
  const afterCleanupStore = new AccountProfileStore(directory);
  const afterCleanup = new AccountProfiles(afterCleanupStore, directory, async () => ['persist:naruto-br-1', 'persist:naruto-br-4']);
  await afterCleanup.discover();
  assert.equal(afterCleanup.get('br-1'), undefined, 'a leftover directory and Keychain key cannot resurrect a deleted profile');
  assert.deepEqual(afterCleanupStore.pendingDeletes(), []);
  assert.deepEqual(afterCleanupStore.deletedIds(), ['br-1']);
  assert.equal(afterCleanup.selected('br'), 'br-2');
  assert.equal(afterCleanup.create('br', '合成账号C', '').id, 'br-5', 'deleted slots stay reserved and new profiles do not inherit their data');
});

test('a failed deletion marker write leaves the profile usable and leaves no temporary file', t => {
  const directory = temporaryDirectory(t);
  const store = new AccountProfileStore(directory);
  store.create('br', 1, '合成账号A', '');
  const originalBytes = fs.readFileSync(store.file, 'utf8');
  const renameSync = fs.renameSync;
  fs.renameSync = function(source, destination) {
    if (destination === store.file) throw new Error('synthetic rename failure');
    return renameSync.call(fs, source, destination);
  };
  try { assert.throws(() => store.beginDelete(store.get('br-1')), /保存失败/); }
  finally { fs.renameSync = renameSync; }
  assert.equal(fs.readFileSync(store.file, 'utf8'), originalBytes);
  assert.equal(store.isPendingDelete('br-1'), false);
  assert.equal(store.get('br-1').name, '合成账号A');
  assert.deepEqual(fs.readdirSync(directory), ['account-profiles.json']);
});

test('deleting a non-selected profile preserves selection and deleting the last profile clears it', t => {
  const directory = temporaryDirectory(t);
  const store = new AccountProfileStore(directory);
  store.create('br', 1, '合成账号A', '');
  store.create('br', 2, '合成账号B', '');
  store.select(store.get('br-1'));
  const profiles = new AccountProfiles(store, directory, async () => []);

  profiles.beginDelete('br-2');
  assert.equal(profiles.selected('br'), 'br-1', 'deleting a non-selected profile keeps the selected account');
  profiles.completeDelete('br-2');
  profiles.beginDelete('br-1');
  assert.equal(profiles.selected('br'), null, 'deleting the final selected profile clears the selection');
  profiles.completeDelete('br-1');

  const restarted = new AccountProfileStore(directory);
  assert.equal(restarted.selected('br'), null);
  assert.deepEqual(restarted.profiles(), []);
});

test('a failed final metadata write keeps deletion pending for retry', t => {
  const directory = temporaryDirectory(t);
  const store = new AccountProfileStore(directory);
  store.create('br', 1, '合成账号A', '');
  store.beginDelete(store.get('br-1'));
  const originalSave = store.save;
  store.save = () => { throw new Error('synthetic final metadata failure'); };

  try { assert.throws(() => store.completeDelete('br-1'), /synthetic final metadata failure/); }
  finally { store.save = originalSave; }

  assert.equal(store.isPendingDelete('br-1'), true);
  assert.equal(store.get('br-1').name, '合成账号A');
  assert.equal(store.isDeleted('br-1'), false);
  assert.deepEqual(new AccountProfileStore(directory).pendingDeletes(), ['br-1']);

  store.completeDelete('br-1');
  assert.equal(store.isPendingDelete('br-1'), false);
  assert.equal(store.isDeleted('br-1'), true);
});
