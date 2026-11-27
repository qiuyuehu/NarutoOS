const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '../..');

module.exports = function runFlashResult({ name, fixture, resultCallback, expectedPasses, version = '31.0.0.148', timeoutMs = 15000 }) {
  const plugin = path.join(root, `runtime/flash-${version.split('.')[0]}/PepperFlashPlayer.plugin/Contents/MacOS/PepperFlashPlayer`);
  app.setPath('userData', path.join(path.dirname(fixture), 'profile'));
  app.commandLine.appendSwitch('ppapi-flash-path', plugin);
  app.commandLine.appendSwitch('ppapi-flash-version', version);
  app.commandLine.appendSwitch('disable-background-networking');

  app.whenReady().then(async () => {
    const win = new BrowserWindow({
      show: false, width: 400, height: 240,
      webPreferences: { plugins: true, backgroundThrottling: false },
    });
    try {
      const host = `https://${name}.test/`;
      const html = `<!doctype html><script>window.${resultCallback}=function(value){window.__fixtureResult=value}</script><object id="fixture" type="application/x-shockwave-flash" data="/fixture.swf" width="400" height="240"><param name="allowScriptAccess" value="sameDomain"></object>`;
      await new Promise((resolve, reject) => {
        win.webContents.session.protocol.interceptBufferProtocol('https', (request, respond) => {
          if (request.url === host) respond({ mimeType: 'text/html', data: Buffer.from(html) });
          else if (request.url === host + 'fixture.swf') respond({ mimeType: 'application/x-shockwave-flash', data: fs.readFileSync(fixture) });
          else respond({ error: -6 });
        }, error => error ? reject(error) : resolve());
      });
      await win.loadURL(host);
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      let started = false;
      for (let i = 0; i < 100 && !started; i++) {
        try {
          const startResult = await win.webContents.executeJavaScript("document.getElementById('fixture').run()");
          started = startResult === 'started';
        } catch {
          await wait(50);
        }
      }
      assert.ok(started, 'Flash fixture did not load');
      let result = null;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline && result == null) {
        const raw = await win.webContents.executeJavaScript('window.__fixtureResult');
        if (raw) result = JSON.parse(raw);
        else await wait(100);
      }
      assert.ok(result, 'Flash test sequence did not finish');
      assert.deepEqual(result.failures, []);
      assert.equal(result.passes.length, expectedPasses);
      for (const pass of result.passes) console.log('PASS ' + pass);
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
};
