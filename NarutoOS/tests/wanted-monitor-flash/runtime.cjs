const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const project = path.resolve(__dirname, '../..');
const speedTest = process.argv.includes('--10x');
const artifacts = path.join(project, '.test-artifacts', speedTest ? 'wanted-monitor-flash-10x' : 'wanted-monitor-flash');
const fixtureSwf = path.join(artifacts, 'WantedFixture.swf');
const plugin = path.join(project, 'runtime', speedTest ? 'flash-34' : 'flash-31', 'PepperFlashPlayer.plugin/Contents/MacOS/PepperFlashPlayer');
app.setPath('userData', path.join(artifacts, 'profile'));
app.commandLine.appendSwitch('ppapi-flash-path', plugin);
app.commandLine.appendSwitch('ppapi-flash-version', speedTest ? '34.0.0.384' : '31.0.0.148');
app.commandLine.appendSwitch('disable-background-networking');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, useContentSize: true, width: 500, height: 320,
    webPreferences: { plugins: true, backgroundThrottling: false },
  });
  try {
    const host = 'https://daily-wanted-fixture.test/';
    const html = '<!DOCTYPE html><style>html,body{margin:0;background:#123;width:100%;height:100%;overflow:hidden}object{display:block}</style>' +
      '<object id="fixture" type="application/x-shockwave-flash" data="/wanted.swf" width="500" height="320">' +
      '<param name="allowScriptAccess" value="sameDomain"></object>';
    await new Promise((resolve, reject) => {
      win.webContents.session.protocol.interceptBufferProtocol('https', (request, respond) => {
        if (request.url === host) respond({ mimeType: 'text/html', data: Buffer.from(html) });
        else if (request.url === host + 'wanted.swf') respond({ mimeType: 'application/x-shockwave-flash',
          data: fs.readFileSync(fixtureSwf) });
        else respond({ error: -6 });
      }, error => error ? reject(error) : resolve());
    });
    await win.loadURL(host);
    const call = async (action, arg = '') => JSON.parse(decodeURIComponent(await win.webContents.executeJavaScript(
      `document.getElementById('fixture').perform(${JSON.stringify(action)},${JSON.stringify(arg)})`)));
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const until = async (expectation, timeout = 4000) => {
      let last;
      const deadline = Date.now() + timeout;
      do {
        try {
          last = await call('state');
          if (expectation(last)) return last;
        } catch (error) { last = error.message; }
        await wait(50);
      } while (Date.now() < deadline);
      throw Error('Flash fixture did not reach expected state: ' + JSON.stringify(last));
    };
    const checks = [];
    const pass = name => { checks.push(name); console.log('PASS', name); };
    await until(state => state.entry, 12000);
    pass('Flash AVM2 loaded assistant and mounted activity-bar entry');
    const scenarios = speedTest ? require('./speed-scenario.cjs') : require('./scenarios.cjs');
    const results = await scenarios({ call, wait, until, win, pass, assert });
    fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify({ checks, ...results }, null, 2));
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
