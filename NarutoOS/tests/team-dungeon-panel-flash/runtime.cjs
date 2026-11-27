const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '../..');
const plugin = path.join(root, 'runtime/flash-34/PepperFlashPlayer.plugin/Contents/MacOS/PepperFlashPlayer');
app.setPath('userData', path.join(path.dirname(process.env.TEAM_DUNGEON_PANEL_FIXTURE_SWF), 'profile'));
app.commandLine.appendSwitch('ppapi-flash-path', plugin);
app.commandLine.appendSwitch('ppapi-flash-version', '34.0.0.384');
app.commandLine.appendSwitch('disable-background-networking');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 500,
    height: 320,
    webPreferences: { plugins: true, backgroundThrottling: false },
  });
  try {
    const host = 'https://team-dungeon-panel-fixture.test/';
    const html = '<!doctype html><script>window.fixtureReady=()=>window.fixtureLoaded=true;</script>' +
      '<object id="fixture" type="application/x-shockwave-flash" data="/fixture.swf" width="500" height="320">' +
      '<param name="allowScriptAccess" value="sameDomain"></object>';
    await new Promise((resolve, reject) => {
      win.webContents.session.protocol.interceptBufferProtocol('https', (request, respond) => {
        if (request.url === host) respond({ mimeType: 'text/html', data: Buffer.from(html) });
        else if (request.url === host + 'fixture.swf') respond({
          mimeType: 'application/x-shockwave-flash',
          data: fs.readFileSync(process.env.TEAM_DUNGEON_PANEL_FIXTURE_SWF),
        });
        else respond({ error: -6 });
      }, error => error ? reject(error) : resolve());
    });
    await win.loadURL(host);
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      if (await win.webContents.executeJavaScript('window.fixtureLoaded === true')) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(await win.webContents.executeJavaScript('window.fixtureLoaded === true'), true,
      'Flash team-dungeon fixture did not load');
    const perform = scenario => win.webContents.executeJavaScript(
      `document.getElementById('fixture').perform(${JSON.stringify(scenario)})`);

    let result = await perform('ready');
    assert.equal(result.kind, 'ready');
    assert.equal(result.dungeonId, 303);
    assert.equal(result.frame, 3);
    assert.equal(result.nextClicks, 2);
    assert.equal(result.readyButtonMatches, true);
    console.log('PASS real TeamDungeonPanel.choose selects hard on the same card with distinct difficulty IDs');

    result = await perform('recommendHard');
    assert.equal(result.kind, 'ready');
    assert.equal(result.frame, 3);
    assert.equal(result.dungeonId, 303);
    console.log('PASS sparse recommendation data is treated as hard only at index 2 and frame 3');

    result = await perform('recommendEasy');
    assert.equal(result.kind, 'wait');
    assert.equal(result.tabIndex, 1);
    assert.equal(result.nextClicks, 0);
    console.log('PASS one-entry easy recommendation selects the native All tab and waits');

    result = await perform('chooseAgain');
    assert.equal(result.kind, 'ready');
    assert.equal(result.dungeonId, 303);
    assert.equal(result.frame, 3);
    console.log('PASS refreshed All tab exposes its hard card');

    result = await perform('hardLocked');
    assert.equal(result.kind, 'wait');
    result = await perform('chooseAgain');
    assert.equal(result.kind, 'blocked');
    assert.equal(result.message, '达65战斗力后开启');
    assert.equal(result.nextClicks, 0);
    console.log('PASS native locked difficulty returns its native unlock reason');

    assert.equal(result.confirmButtonMatches, true);
    assert.equal(result.confirmLabel, '确认进入');
    assert.equal(result.cancelLabel, '取消');
    console.log('PASS real TeamDungeonPanel.confirmButton returns the native confirm control');

    result = await perform('empty');
    assert.equal(result.kind, 'wait');
    assert.equal(result.tabIndex, 0);
    console.log('PASS initially empty recommendation list waits without skipping to All');
  } finally {
    await win.close();
    app.quit();
  }
}).catch(error => {
  console.error(error);
  app.exit(1);
});
