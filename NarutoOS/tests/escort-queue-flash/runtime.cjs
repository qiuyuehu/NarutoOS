const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '../..');
const plugin = path.join(root, 'runtime/flash-34/PepperFlashPlayer.plugin/Contents/MacOS/PepperFlashPlayer');
app.setPath('userData', path.join(path.dirname(process.env.ESCORT_QUEUE_FIXTURE_SWF), 'profile'));
app.commandLine.appendSwitch('ppapi-flash-path', plugin);
app.commandLine.appendSwitch('ppapi-flash-version', '34.0.0.384');
app.commandLine.appendSwitch('disable-background-networking');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 500, height: 320,
    webPreferences: { plugins: true, backgroundThrottling: false } });
  try {
    const host = 'https://escort-queue-fixture.test/';
    const html = '<!doctype html><object id="fixture" type="application/x-shockwave-flash" data="/escort.swf" width="500" height="320"><param name="allowScriptAccess" value="sameDomain"></object>';
    await new Promise((resolve, reject) => {
      win.webContents.session.protocol.interceptBufferProtocol('https', (request, respond) => {
        if (request.url === host) respond({ mimeType: 'text/html', data: Buffer.from(html) });
        else if (request.url === host + 'escort.swf') respond({ mimeType: 'application/x-shockwave-flash', data: fs.readFileSync(process.env.ESCORT_QUEUE_FIXTURE_SWF) });
        else respond({ error: -6 });
      }, error => error ? reject(error) : resolve());
    });
    await win.loadURL(host);
    const call = async (action, value = '') => win.webContents.executeJavaScript(
      `document.getElementById('fixture').perform(${JSON.stringify(action)},${JSON.stringify(value)})`);
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const last = list => list[list.length - 1];
    const until = async (predicate, label, timeout = 6000) => {
      let state;
      const deadline = Date.now() + timeout;
      do {
        state = await call('snapshot');
        if (predicate(state)) return state;
        await wait(60);
      } while (Date.now() < deadline);
      throw Error(label + ': ' + JSON.stringify(state));
    };
    let state;
    for (let i = 0; i < 150; i++) {
      try { state = await call('snapshot'); break; } catch {}
      await wait(50);
    }
    assert.ok(state, 'Flash escort queue fixture did not load');

    await call('reset');
    await call('panel', 'support|blocked|0|0|0|免费接取次数已用完');
    await call('transit', 'active|41|');
    state = await call('start', 'escort,next');
    assert.deepEqual(state.started, ['escort']);
    await call('transit', 'ended|41|最后一单已送达');
    await call('panel', 'list|blocked|0|0|0|免费接取次数已用完');
    await until(current => current.progress.includes('SS 押镖 · 核对余量'), 'delivery receipt was not observed');
    await call('transit', 'none|0|');
    state = await until(current => current.started.length === 2, 'in-transit order did not finish before free count gate');
    await call('completeNext');
    state = await call('snapshot');
    assert.match(state.finished[0], /最后一单已送达/);
    assert.match(state.finished[0], /免费接取次数已用完/);
    console.log('PASS in-transit SS order is completed even when free accept count is zero');

    await call('reset');
    await call('panel', 'list|refresh|0|1|1|');
    await call('transit', 'none|0|');
    state = await call('start', 'escort,next');
    state = await until(current => current.panel.refreshClicks === 1, 'free refresh was not clicked');
    assert.deepEqual(state.started, ['escort']);
    await call('panel', 'list|accept|77|1|1|');
    await wait(550);
    assert.equal((await call('snapshot')).panel.acceptClicks, 0, 'stale quota must not authorize acceptance');
    await call('panel', 'list|accept|77|0|1|');
    state = await until(current => current.panel.acceptClicks === 1, 'accepted card was not clicked after refresh receipt');
    await call('transit', 'active|77|');
    await until(current => current.panel.advanceClicks > 0, 'accepted order did not enter transit');
    await call('transit', 'none|0|');
    await wait(520);
    state = await call('snapshot');
    assert.deepEqual(state.started, ['escort'], 'missing delivery receipt must not hand off the queue');
    assert.equal(state.finished.length, 0);
    await call('transit', 'active|77|');
    await call('transit', 'ended|77|本单送达');
    await call('panel', 'list|complete|0|0|0|今日押镖已完成');
    await until(current => current.progress.includes('SS 押镖 · 核对余量'), 'final delivery receipt was not observed');
    await call('transit', 'none|0|');
    state = await until(current => current.started.length === 2, 'delivered final order did not hand off');
    await call('completeNext');
    state = await call('snapshot');
    assert.deepEqual(state.started, ['escort', 'next']);
    assert.match(state.finished[0], /本单送达/);
    assert.match(state.finished[0], /今日押镖已完成/);
    console.log('PASS one free refresh waits for reduced receipt, no missing transit receipt counts as delivery, and final order hands off');

    await call('reset');
    await call('panel', 'list|refresh|0|1|1|');
    await call('transit', 'none|0|');
    await call('start', 'escort,next');
    await until(current => current.panel.refreshClicks === 1, 'last free refresh was not clicked');
    await call('panel', 'list|blocked|0|0|0|免费刷新次数已用完，刷新后仍无 SS 级任务');
    state = await until(current => current.started.length === 2, 'exhausted refresh should skip to the next queue task');
    await call('completeNext');
    state = await call('snapshot');
    assert.match(state.finished[0], /免费刷新次数已用完/);
    assert.deepEqual(state.started, ['escort', 'next']);
    console.log('PASS exhausted free refresh records the native reason and skips');

    await call('reset');
    await call('panel', 'list|accept|99|0|1|');
    await call('transit', 'none|0|');
    await call('start', 'escort,next');
    await until(current => current.panel.acceptClicks === 1, 'accept operation did not start before stop');
    await call('cancel');
    await call('transit', 'ended|99|迟到送达回执');
    await call('panel', 'clear|blocked|0|0|0|');
    await wait(700);
    state = await call('snapshot');
    assert.deepEqual(state.started, ['escort']);
    assert.deepEqual(state.finished, ['已停止本轮任务。']);
    assert.equal(state.nextRunning, false);
    console.log('PASS stop prevents late transit receipt from progressing the queue');

    await call('reset');
    await call('panel', 'support|wait|0|0|0|');
    await call('transit', 'active|11|');
    await call('start', 'escort,next');
    await wait(500);
    await call('transit', 'active|12|');
    state = await until(current => current.finished.length > 0, 'changed transit order was not aborted');
    assert.deepEqual(state.started, ['escort']);
    assert.match(state.finished[0], /镖单发生变化/);
    console.log('PASS changed in-transit order aborts without starting the next task');

    await call('reset');
    await call('panel', 'list|wait');
    await call('transit', 'settling|123|');
    await call('start', 'escort');
    await wait(950);
    state = await call('snapshot');
    assert.deepEqual(state.panel.clicks, ['advance:123'], 'click the owned delivery button once while waiting for receipt');
    assert.equal(state.running, true);
    await call('cancel');
    console.log('PASS a delivered SS order in the original list submits once');

    await call('reset');
    await call('panel', 'list|accept|55|0|1|');
    await call('start', 'escort');
    await until(current => current.panel.acceptClicks === 1, 'free card not accepted');
    await call('panel', 'clear|wait');
    await call('transit', 'active|55|');
    state = await until(current => current.transit.advances.length >= 2, 'did not observe departure');
    assert.deepEqual(state.transit.advances.slice(0, 2).map(value => value.newlyAccepted), [true, false]);
    await call('cancel');
    console.log('PASS native departure consumes the first-route permission');

    await call('reset');
    await call('panel', 'list|refresh|0|1|2');
    await call('start', 'escortS,next');
    await until(current => current.panel.refreshClicks === 1, 'S free refresh not clicked');
    await call('panel', 'list|accept|61|0|2');
    await until(current => current.panel.acceptClicks === 1, 'S card was not accepted after free refresh');
    await call('transit', 'active|61||4');
    await until(current => current.panel.advanceClicks === 1, 'S card did not depart');
    await call('cancel');
    await call('start', 'escortS,next');
    await wait(450);
    state = await call('snapshot');
    assert.equal(state.panel.acceptClicks, 1);
    assert.equal(state.panel.advanceClicks, 1, 'restart does not click the same in-transit route again');
    await call('transit', 'ended|61||4|completed');
    await until(current => current.progress.includes('S 押镖 · 本单已结束'), 'S terminal receipt was not observed');
    await call('transit', 'none');
    await until(current => current.nextRunning, 'S receipt should hand off without using another remaining free card');
    await call('completeNext');
    state = await call('snapshot');
    assert.match(last(state.finished), /S 镖单已送达/);
    assert.equal(state.panel.acceptClicks, 1);
    await call('panel', 'clear|accept|62|0|1');
    await call('start', 'escortS,next');
    state = await until(current => current.started.filter(item => item === 'next').length === 2, 'same window must skip another S');
    assert.equal(state.panel.opens, 0);
    assert.equal(state.panel.acceptClicks, 1);
    console.log('PASS free S refresh, one S acceptance, safe continuation after stop, and same-window skip');

    await call('reset');
    await call('panel', 'list|accept|71|0|1||paid');
    await call('start', 'escortS,next');
    state = await until(current => current.finished.length > 0, 'paid card was not rejected');
    assert.equal(state.panel.acceptClicks, 0);
    assert.deepEqual(state.started, ['escortS']);

    await call('reset');
    await call('panel', 'list|accept|72|0|1');
    await call('start', 'escortS,next');
    await until(current => current.panel.acceptClicks === 1, 'pending-accept scenario did not click');
    await call('cancel');
    await call('start', 'escortS,next');
    state = await until(current => current.finished.length === 2, 'pending S acceptance did not stop the new run');
    assert.match(last(state.finished), /仍待确认/);
    assert.equal(state.panel.acceptClicks, 1);
    await call('transit', 'active|72||4');
    await call('start', 'escortS,next');
    await until(current => current.panel.advanceClicks === 1, 'original S accepts after the stop');
    await call('cancel');
    await call('transit', 'none');
    await call('start', 'escortS,next');
    await until(current => current.nextRunning, 'previously accepted S with no current order should skip');
    await call('completeNext');
    state = await call('snapshot');
    assert.equal(state.panel.acceptClicks, 1);
    assert.match(last(state.finished), /已接过一单 S 镖/);
    assert.doesNotMatch(last(state.finished), /送达/);
    console.log('PASS priced S is rejected and stopping around native acceptance never duplicates the order or claims delivery');

    await call('reset');
    await call('panel', 'list|accept|84|0|1');
    await call('transit', 'settling|83||4');
    await call('start', 'escort,escortS,next');
    state = await until(current => current.panel.advanceClicks === 1, 'both tasks selected should submit the held S first');
    assert.deepEqual(state.started, ['escort']);
    assert.equal(state.panel.acceptClicks, 0);
    await call('transit', 'ended|83||4|removed');
    await until(current => current.progress.includes('SS 押镖 · 核对余量'), 'held S removal did not consume the session entry');
    await call('transit', 'none');
    await until(current => current.panel.acceptClicks === 1, 'SS task did not start after handling held S');
    await call('transit', 'active|84||5');
    await until(current => current.panel.advanceClicks === 2, 'SS task did not resume after held S');
    await call('transit', 'ended|84||5|completed');
    await call('panel', 'list|complete|0|0|0|今日押镖已完成');
    await until(current => current.progress.filter(item => item === 'SS 押镖 · 核对余量').length === 2, 'SS receipt did not arrive');
    await call('transit', 'none');
    await until(current => current.nextRunning, 'S queue entry did not skip after the held S ended');
    await call('completeNext');
    state = await call('snapshot');
    assert.deepEqual(state.started, ['escort', 'escortS', 'next']);
    assert.equal(state.panel.acceptClicks, 1);
    assert.match(last(state.finished), /移除.*SS 镖单已送达/);
    console.log('PASS both selected recover the held S before SS and count native removal without accepting another S');

    await call('reset');
    await call('panel', 'list|accept|93|0|1');
    await call('transit', 'active|92||4');
    await call('start', 'escortS,next');
    await until(current => current.panel.advanceClicks === 1, 'S-only did not continue the existing order');
    await call('transit', 'ended|92||4|failed');
    await until(current => current.progress.includes('S 押镖 · 本单已结束'), 'S failure was not observed');
    await call('transit', 'none');
    await until(current => current.nextRunning, 'confirmed S failure did not hand off after safe close');
    await call('completeNext');
    state = await call('snapshot');
    assert.match(last(state.finished), /S 镖单失败/);
    assert.equal(state.panel.acceptClicks, 0, 'an explicit loss consumes the one S attempt');

    for (const [task, otherGrade, message] of [['escort', 4, /其他镖单/], ['escortS', 5, /在途 SS 镖单/]]) {
      await call('reset');
      await call('panel', 'list|accept|95|0|1');
      await call('transit', `active|94||${otherGrade}`);
      await call('start', `${task},next`);
      state = await until(current => current.finished.length > 0, 'mixed-grade hold should be left untouched');
      assert.match(last(state.finished), message);
      assert.equal(state.panel.acceptClicks, 0);
      assert.equal(state.panel.advanceClicks, 0);
      assert.deepEqual(state.started, [task]);
    }
    console.log('PASS each single-grade run leaves the other grade in transit untouched');
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
