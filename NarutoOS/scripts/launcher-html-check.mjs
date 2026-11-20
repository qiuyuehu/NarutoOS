// Shared integrity check for the WK launcher page. The launcher HTML embeds the
// lobby artwork as a base64 data URI, so a single very long line is expected;
// editors and tools that truncate long lines can silently cut an attribute and
// make the browser swallow the rest of the DOM. Catch that before packaging.
export const requiredLauncherMarkers = [
  'id="lobby"',
  'id="profile-deck"',
  'id="open-game"',
  'id="settings-panel"',
  'id="about-github"',
  'id="about-check-update"',
  'id="about-version"',
  '<script src="bridge.js">',
  '<script src="app.js">',
];

export function validateLauncherHtml(html) {
  if (typeof html !== 'string' || html.length === 0) throw new Error('launcher HTML is empty');
  if (html.includes('line truncated to 2000 chars')) throw new Error('launcher HTML contains a truncated-content marker');
  for (const marker of requiredLauncherMarkers) {
    if (!html.includes(marker)) throw new Error('launcher HTML is missing ' + marker);
  }
  if (!html.includes('<html') || !html.includes('</html>')) throw new Error('launcher HTML is not a complete document');
  return true;
}
