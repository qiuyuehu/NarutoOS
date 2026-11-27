const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '../..');
const plugin = path.join(root, 'runtime/flash-34/PepperFlashPlayer.plugin/Contents/MacOS/PepperFlashPlayer');
app.setPath('userData', path.join(path.dirname(process.env.ESCORT_TRANSIT_NATIVE_SWF), 'profile'));
app.commandLine.appendSwitch('ppapi-flash-path', plugin);
app.commandLine.appendSwitch('ppapi-flash-version', '34.0.0.384');
app.commandLine.appendSwitch('disable-background-networking');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 500, height: 320,
    webPreferences: { plugins: true, backgroundThrottling: false } });
  try {
    const host = 'https://escort-transit-native.test/';
    const html = '<!doctype html><script>window.fixtureResult=null;window.fixtureComplete=s=>window.fixtureResult=s</script>' +
      '<object id="fixture" type="application/x-shockwave-flash" data="/escort.swf" width="500" height="320"><param name="allowScriptAccess" value="always"></object>';
    await new Promise((resolve, reject) => {
      win.webContents.session.protocol.interceptBufferProtocol('https', (request, respond) => {
        if (request.url === host) respond({ mimeType: 'text/html', data: Buffer.from(html) });
        else if (request.url === host + 'escort.swf') respond({ mimeType: 'application/x-shockwave-flash', data: fs.readFileSync(process.env.ESCORT_TRANSIT_NATIVE_SWF) });
        else respond({ error: -6 });
      }, error => error ? reject(error) : resolve());
    });
    await win.loadURL(host);
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    let message = null;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      message = await win.webContents.executeJavaScript('window.fixtureResult');
      if (message) break;
      await wait(50);
    }
    assert.equal(message, 'PASS production EscortTransit: grade locking, movement, battle gate, native continuation, single submit, terminal receipts, and escort bonus popup isolation');
    console.log(message);
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
