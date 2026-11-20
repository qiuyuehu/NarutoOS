import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { requiredLauncherMarkers, validateLauncherHtml } from './launcher-html-check.mjs';

const project = fileURLToPath(new URL('..', import.meta.url));
const built = fs.readFileSync(project + 'dist/prototype/launcher/index.html', 'utf8');
let passes = 0;
const check = (name, fn) => { fn(); passes += 1; console.log('PASS ' + name); };

check('built launcher HTML passes validation', () => validateLauncherHtml(built));
check('truncated-content marker is rejected', () => {
  const broken = built.replace('id="profile-deck"', 'id="profile-deck" ... (line truncated to 2000 chars)');
  assert.throws(() => validateLauncherHtml(broken), /truncated-content marker/);
});
check('missing profile-deck is rejected', () => {
  const broken = built.replace('id="profile-deck"', 'id="profile-deck-removed"');
  assert.throws(() => validateLauncherHtml(broken), /profile-deck/);
});
check('missing check-update button is rejected', () => {
  const broken = built.replace('id="about-check-update"', 'id="about-check-update-removed"');
  assert.throws(() => validateLauncherHtml(broken), /about-check-update/);
});
check('empty document is rejected', () => {
  assert.throws(() => validateLauncherHtml(''), /empty/);
});
check('all required markers are declared', () => {
  assert(requiredLauncherMarkers.includes('id="profile-deck"') && requiredLauncherMarkers.includes('id="about-check-update"'));
});
console.log('启动页完整性检查通过：' + passes + ' 项');
