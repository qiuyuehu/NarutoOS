const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const root = path.resolve(__dirname, '../..');
const artifacts = path.join(root, '.test-artifacts/team-dungeon-progress-flash');
app.setPath('userData', path.join(artifacts, 'profile'));
app.commandLine.appendSwitch('ppapi-flash-path', path.join(root, 'runtime/flash-31/PepperFlashPlayer.plugin/Contents/MacOS/PepperFlashPlayer'));
app.commandLine.appendSwitch('ppapi-flash-version', '31.0.0.148');
app.commandLine.appendSwitch('disable-background-networking');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 240, height: 180, webPreferences: { plugins: true, backgroundThrottling: false } });
  try {
    const host = 'https://team-dungeon-progress-fixture.test/';
    const html = '<object id="fixture" type="application/x-shockwave-flash" data="/fixture.swf" width="240" height="180"><param name="allowScriptAccess" value="sameDomain"></object>';
    await new Promise((resolve, reject) => win.webContents.session.protocol.interceptBufferProtocol('https', (request, respond) => {
      if (request.url === host) respond({ mimeType: 'text/html', data: Buffer.from(html) });
      else if (request.url === host + 'fixture.swf') respond({ mimeType: 'application/x-shockwave-flash', data: fs.readFileSync(process.env.TEAM_DUNGEON_PROGRESS_SWF) });
      else respond({ error: -6 });
    }, error => error ? reject(error) : resolve()));
    await win.loadURL(host);
    const run = async name => win.webContents.executeJavaScript(`document.getElementById('fixture').run(${JSON.stringify(name)})`);
    let ready = false;
    for (let i = 0; i < 100; i++) { try { await run('none'); ready = true; break; } catch {} await new Promise(resolve => setTimeout(resolve, 50)); }
    assert.ok(ready, 'Flash fixture did not load');
    assert.equal(await run('zero'), 0);
    assert.equal(await run('two'), 2);
    assert.equal(await run('three'), 3);
    assert.equal(await run('small-complete'), -1);
    assert.equal(await run('pt-two'), 2);
    assert.equal(await run('pt-saturated'), -1);
    assert.equal(await run('pt-scope'), -1);
    assert.equal(await run('ambiguous'), -1);
    assert.equal(await run('exact-with-saturated'), 2);
    assert.equal(await run('reward'), -1);
    assert.equal(await run('friend'), -1);
    assert.equal(await run('difficulty'), -1);
    assert.equal(await run('conflict'), -1);
    assert.equal(await run('none'), -1);
    console.log('PASS native daily task counter whitelist, saturation guard, conflicts, and unknown cases');
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
