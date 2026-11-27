const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '../..');
const plugin = path.join(root, 'runtime/flash-34/PepperFlashPlayer.plugin/Contents/MacOS/PepperFlashPlayer');
app.setPath('userData', path.join(path.dirname(process.env.ESCORT_NATIVE_PANEL_FIXTURE_SWF), 'profile'));
app.commandLine.appendSwitch('ppapi-flash-path', plugin);
app.commandLine.appendSwitch('ppapi-flash-version', '34.0.0.384');
app.commandLine.appendSwitch('disable-background-networking');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 500, height: 320,
    webPreferences: { plugins: true, backgroundThrottling: false },
  });
  try {
    const host = 'https://escort-native-panel-fixture.test/';
    const html = '<!doctype html><script>window.fixtureReady=()=>window.fixtureLoaded=true;</script>' +
      '<object id="fixture" type="application/x-shockwave-flash" data="/fixture.swf" width="500" height="320">' +
      '<param name="allowScriptAccess" value="sameDomain"></object>';
    await new Promise((resolve, reject) => {
      win.webContents.session.protocol.interceptBufferProtocol('https', (request, respond) => {
        if (request.url === host) respond({ mimeType: 'text/html', data: Buffer.from(html) });
        else if (request.url === host + 'fixture.swf') respond({
          mimeType: 'application/x-shockwave-flash', data: fs.readFileSync(process.env.ESCORT_NATIVE_PANEL_FIXTURE_SWF),
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
      'Flash escort fixture did not load');
    const perform = scenario => win.webContents.executeJavaScript(
      `document.getElementById('fixture').perform(${JSON.stringify(scenario)})`);

    let result = await perform('accept');
    if (result.error) throw new Error(JSON.stringify(result));
    assert.equal(result.kind, 'accept');
    assert.equal(result.id, 101);
    assert.equal(result.canAcceptFree, true);
    assert.equal(result.isNativeButton, true);
    console.log('PASS SS acceptance returns the visible native receive button');

    result = await perform('zeroAccept');
    assert.equal(result.kind, 'complete');
    assert.equal(result.hasButton, false);
    assert.equal(result.canAcceptFree, false);
    console.log('PASS zero free SS accepts never exposes the native purchase confirmation path');

    result = await perform('refresh');
    assert.equal(result.kind, 'refresh');
    assert.equal(result.isNativeButton, true);
    assert.equal(result.waitsForBothUpdates, true);
    assert.equal(result.afterRefreshKind, 'blocked');
    console.log('PASS free refresh waits for both native task-list and count updates');

    result = await perform('support');
    assert.equal(result.kind, 'accept');
    assert.equal(result.initialRouteNull, true);
    assert.equal(result.waitsForSupport, true);
    assert.equal(result.supportButtonMatches, true);
    console.log('PASS accepted escort with guild waits for the native support panel before routing');

    result = await perform('resumeSupport');
    assert.equal(result.supportButtonMatches, true);
    console.log('PASS a resumed task can hand off its unique native support window');

    result = await perform('delivered');
    assert.equal(result.doneButtonMatches, true);
    console.log('PASS a delivered SS task exposes only its native completion control');

    result = await perform('dailyDone');
    assert.equal(result.kind, 'complete');
    assert.equal(result.hasButton, false);
    console.log('PASS exhausted daily escort allowance prevents receiving or refreshing');

    result = await perform('fourthSS');
    assert.equal(result.firstKind, 'wait');
    assert.equal(result.scrollValue, 100);
    assert.equal(result.afterScrollKind, 'accept');
    assert.equal(result.afterScrollId, 104);
    console.log('PASS the fourth SS card is found through native grid source and scrolling');

    result = await perform('acceptS');
    assert.equal(result.kind, 'accept');
    assert.equal(result.id, 101);
    assert.equal(result.canAcceptFree, true);
    assert.equal(result.freeAcceptLeft, 3);
    assert.equal(result.normalClicks, 1);
    assert.equal(result.badgeClicks, 0);
    console.log('PASS a zero-price S card uses the ordinary native accept button with zero free SS accepts');

    for (const scenario of ['paidS', 'unknownPriceS']) {
      result = await perform(scenario);
      assert.equal(result.kind, 'blocked');
      assert.equal(result.canAcceptFree, false);
      assert.equal(result.hasButton, false);
    }
    result = await perform('staleS');
    assert.equal(result.staleOfferRejected, true);
    assert.equal(result.normalClicks, 0);
    assert.equal(result.badgeClicks, 0);
    console.log('PASS paid, unknown, and newly priced S offers never dispatch accept');

    result = await perform('refreshS');
    assert.equal(result.kind, 'refresh');
    assert.equal(result.isNativeButton, true);
    assert.equal(result.waitsForBothUpdates, true);
    assert.equal(result.afterRefreshKind, 'blocked');
    console.log('PASS S uses the native free refresh path with zero free SS accepts');

    result = await perform('resumeSFromSS');
    assert.equal(result.listButtonMatches, true);
    assert.equal(result.supportButtonMatches, true);
    assert.equal(result.listWrongGradeRejected, true);
    assert.equal(result.supportWrongGradeRejected, true);
    console.log('PASS SS mode can explicitly resume a held S task through the matching native controls');

    result = await perform('closingTween');
    assert.equal(result.removedFromShowingList, true);
    assert.equal(result.duringTween, 'wait');
    assert.equal(result.afterTween, 'clear');
    console.log('PASS closing the original escort list waits for the window to leave the stage');
  } finally {
    await win.close();
  }
  app.exit(0);
}).catch(error => {
  console.error(error);
  app.exit(1);
});
