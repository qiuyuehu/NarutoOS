const test = require('node:test');
const assert = require('node:assert/strict');
const { Navigation } = require('../dist/main/navigation.js');

function fixture() {
  const games = {
    activeId: null,
    hidden: false,
    tabs: [],
    select(id) { if (id && !this.tabs.some(tab => tab.id === id)) return; this.activeId = id; }
  };
  return { games, navigation: new Navigation(games) };
}

test('snapshot derives the selected game from GameSessions and tracks a foreground login task', () => {
  const { games, navigation } = fixture();
  navigation.selectLogin('login-b');
  assert.deepEqual(navigation.snapshot('login-b').target, { kind: 'login', id: 'login-b' });
  games.tabs.push({ id: 'game-a' });
  navigation.selectGame('game-a');
  assert.deepEqual(navigation.snapshot('login-b').target, { kind: 'game', id: 'game-a' });
  navigation.selectHome();
  assert.deepEqual(navigation.snapshot('login-b').target, { kind: 'home' });
});

test('overlay hides the game view and invalidates stale asynchronous restoration', () => {
  const { games, navigation } = fixture();
  games.tabs.push({ id: 'original' });
  navigation.selectLogin('login-b');
  const beforeOverlay = navigation.selectionVersion;
  navigation.syncOverlay(false, true);
  assert.equal(games.hidden, true);
  assert.equal(navigation.snapshot('login-b').target.kind, 'login');
  assert.equal(navigation.snapshot('login-b').obscured, true);
  assert.ok(navigation.selectionVersion > beforeOverlay);
  assert.equal(navigation.restoreOriginal('original', beforeOverlay, true), false);
  navigation.syncOverlay(false, false);
  assert.equal(games.hidden, false);
});

test('background recovery completion preserves the current game and front-page recovery selects its candidate', () => {
  const { games, navigation } = fixture();
  games.tabs.push({ id: 'original' }, { id: 'candidate' }, { id: 'other' });
  navigation.selectGame('other');
  const backgroundVersion = navigation.selectionVersion;
  assert.equal(navigation.completeRecovery('original', 'candidate'), false);
  assert.equal(games.activeId, 'other');
  assert.equal(navigation.selectionVersion, backgroundVersion);
  navigation.selectGame('original');
  assert.equal(navigation.completeRecovery('original', 'candidate'), true);
  assert.equal(games.activeId, 'candidate');
  assert.ok(navigation.selectionVersion > backgroundVersion);
});

test('an asynchronous login hands off only while its login target remains visible', () => {
  const { games, navigation } = fixture();
  games.tabs.push({ id: 'candidate' }, { id: 'other' });
  navigation.selectLogin('login-b');
  assert.equal(navigation.handoffGame('login-b', 'candidate'), true);
  assert.equal(games.activeId, 'candidate');
  navigation.selectLogin('login-c');
  navigation.selectHome();
  assert.equal(navigation.handoffGame('login-c', 'candidate'), false);
  assert.equal(games.activeId, null);
  navigation.selectLogin('login-d');
  navigation.syncOverlay(false, true);
  assert.equal(navigation.handoffGame('login-d', 'candidate'), false);
  assert.equal(games.activeId, null);
});

test('original restoration is allowed only for the same foreground generation and a live tab', () => {
  const { games, navigation } = fixture();
  games.tabs.push({ id: 'original' }, { id: 'other' });
  navigation.selectGame('other');
  const version = navigation.selectionVersion;
  assert.equal(navigation.restoreOriginal('original', version, true), true);
  assert.equal(games.activeId, 'original');
  navigation.selectHome();
  assert.equal(navigation.restoreOriginal('original', version, true), false);
  games.tabs = games.tabs.filter(tab => tab.id !== 'original');
  assert.equal(navigation.restoreOriginal('original', navigation.selectionVersion, true), false);
});
