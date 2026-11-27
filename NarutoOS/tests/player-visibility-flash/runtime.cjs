const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const root = path.resolve(__dirname, '../..');
app.setPath('userData', path.join(root, '.test-artifacts/player-visibility-flash/profile'));
app.commandLine.appendSwitch('ppapi-flash-path', path.join(root, 'runtime/flash-31/PepperFlashPlayer.plugin/Contents/MacOS/PepperFlashPlayer'));
app.commandLine.appendSwitch('ppapi-flash-version', '31.0.0.148');
app.commandLine.appendSwitch('disable-background-networking');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 240, height: 180, webPreferences: { plugins: true, backgroundThrottling: false } });
  try {
    const host = 'https://player-visibility-fixture.test/';
    const html = '<object id="fixture" type="application/x-shockwave-flash" data="/fixture.swf" width="240" height="180"><param name="allowScriptAccess" value="sameDomain"></object>';
    await new Promise((resolve, reject) => win.webContents.session.protocol.interceptBufferProtocol('https', (request, respond) => {
      if (request.url === host) respond({ mimeType: 'text/html', data: Buffer.from(html) });
      else if (request.url === host + 'fixture.swf') respond({ mimeType: 'application/x-shockwave-flash', data: fs.readFileSync(process.env.PLAYER_VISIBILITY_FIXTURE_SWF) });
      else respond({ error: -6 });
    }, error => error ? reject(error) : resolve()));
    await win.loadURL(host);
    const run = async mode => win.webContents.executeJavaScript(`document.getElementById('fixture').run(${JSON.stringify(mode)})`);
    let state;
    for (let i = 0; i < 100; i++) { try { state = await run('visible'); break; } catch {} await new Promise(resolve => setTimeout(resolve, 50)); }
    assert.ok(state, 'Flash fixture did not load');
    assert.equal(state.reason, ''); assert.equal(state.clicks, 1); assert.equal(state.hidden, true); assert.equal(state.otherPlayersVisible, false); assert.equal(state.teammateVisible, true);
    state = await run('twice');
    assert.equal(state.clicks, 1); assert.equal(state.hidden, true);
    state = await run('already-hidden');
    assert.equal(state.reason, ''); assert.equal(state.clicks, 0); assert.equal(state.hidden, true); assert.equal(state.otherPlayersVisible, false); assert.equal(state.teammateVisible, true);
    state = await run('unreadable');
    assert.match(state.reason, /已跳过/); assert.equal(state.clicks, 0);
    state = await run('hidden-ancestor');
    assert.match(state.reason, /已跳过/); assert.equal(state.clicks, 0);
    console.log('PASS native HUD hierarchy and bubbling click, state confirmed, teammates preserved, unreadable/hidden UI skipped');
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
