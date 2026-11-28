const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const root = path.resolve(__dirname, '../..');
const artifacts = path.join(root, '.test-artifacts/infinite-illusion-sweep-flash');
app.setPath('userData', path.join(artifacts, 'profile'));
app.commandLine.appendSwitch('ppapi-flash-path', path.join(root, 'runtime/flash-31/PepperFlashPlayer.plugin/Contents/MacOS/PepperFlashPlayer'));
app.commandLine.appendSwitch('ppapi-flash-version', '31.0.0.148');
app.commandLine.appendSwitch('disable-background-networking');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 260, height: 190,
    webPreferences: { plugins: true, backgroundThrottling: false } });
  try {
    const host = 'https://infinite-sweep-fixture.test/';
    const html = '<object id="fixture" type="application/x-shockwave-flash" data="/fixture.swf" width="260" height="190"><param name="allowScriptAccess" value="sameDomain"></object>';
    await new Promise((resolve, reject) => win.webContents.session.protocol.interceptBufferProtocol('https', (request, respond) => {
      if (request.url === host) respond({ mimeType: 'text/html', data: Buffer.from(html) });
      else if (request.url === host + 'fixture.swf') respond({ mimeType: 'application/x-shockwave-flash', data: fs.readFileSync(process.env.INFINITE_SWEEP_FIXTURE_SWF) });
      else respond({ error: -6 });
    }, error => error ? reject(error) : resolve()));
    await win.loadURL(host);
    const perform = (action, value = '') => win.webContents.executeJavaScript(
      `document.getElementById('fixture').perform(${JSON.stringify(action)}, ${JSON.stringify(value)})`);
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const waitFor = async (condition, timeout = 3500) => {
      const until = Date.now() + timeout;
      let state;
      while (Date.now() < until) {
        try { state = await perform('state'); } catch {}
        if (state && condition(state)) return state;
        await delay(20);
      }
      assert.fail(`Timed out waiting for sweep fixture: ${JSON.stringify(state)}`);
    };
    const begin = async scenario => {
      await perform('reset', scenario);
      await perform('start', scenario === 'no-handoff' ? 'no-handoff' : '');
    };
    const finishOne = async expectedClicks => {
      let state = await waitFor(s => s.clicks === expectedClicks);
      state = await waitFor(s => s.confirms === expectedClicks);
      await delay(250);
      state = await perform('state');
      assert.equal(state.clicks, expectedClicks, 'no second click before the result is acknowledged');
      await perform('reward');
      await delay(200);
      state = await perform('state');
      assert.equal(state.clicks, expectedClicks, 'reward display does not trigger another sweep');
      await waitFor(s => s.rewardCloses === expectedClicks);
      await delay(220);
      state = await perform('state');
      assert.equal(state.running, true, 'a missing or not-yet-rendered list waits for the native refresh');
      assert.equal(state.clicks, expectedClicks, 'closing the reward cannot submit a second sweep');
      await perform('refresh');
    };
    const drain = async total => {
      let count = 0;
      while (count < total) {
        count++;
        await finishOne(count);
      }
      return waitFor(s => !s.running);
    };

    await waitFor(state => state != null);

    const cold = await perform('native-cold');
    assert.equal(cold.aiModel, null, 'cold-start fixture has no loaded AI plugin model');
    assert.equal(cold.trusteeshipping, false, 'missing AI model is not treated as an active trusteeship task');
    assert.equal(cold.openCalls, 1, 'native activity open is requested during AI cold start');
    assert.equal(cold.panel, 'absent', 'native adapter waits asynchronously for the opened panel');

    await begin('');
    let state = await drain(6);
    assert.equal(state.tail, 1);
    assert.equal(state.closes, 1);
    assert.deepEqual(state.clickOrder, [100, 100, 101, 101, 102, 102]);
    assert.deepEqual(state.passCounts, [2, 2, 2]);
    assert.equal(state.protocolRequests, 0);
    assert.equal(state.settingWrites, 0);

    await begin('slow-close');
    await waitFor(s => s.confirms === 1);
    await perform('reward');
    await waitFor(s => s.rewardCloses === 1);
    await delay(400);
    state = await perform('state');
    assert.equal(state.rewardCloses, 1, 'a slow native close gets exactly one click');
    assert.equal(state.clicks, 1);
    await perform('hideReward');
    await perform('refresh');
    await waitFor(s => s.confirms === 2);
    await perform('stop');

    await begin('two-one-zero');
    state = await drain(3);
    assert.deepEqual(state.clickOrder, [100, 100, 101]);
    assert.deepEqual(state.passCounts, [2, 2, 2]);
    assert.equal(state.tail, 1);

    await begin('one-left');
    state = await drain(1);
    assert.deepEqual(state.clickOrder, [100]);
    assert.equal(state.tail, 1);
    await perform('reopen');
    await perform('restart');
    state = await waitFor(s => !s.running);
    assert.deepEqual(state.clickOrder, [100], 're-entry skips already exhausted stages');
    assert.equal(state.tail, 2);

    await begin('auto-enabled');
    state = await drain(6);
    assert.equal(state.clicks, 6);
    assert.equal(state.tail, 1, 'enabled preference hands off after all available opportunities are exhausted');
    assert.equal(state.settingWrites, 0);

    await begin('auto-enabled-empty');
    state = await waitFor(s => !s.running);
    assert.equal(state.clicks, 0);
    assert.equal(state.tail, 1, 'enabled preference with no remaining opportunities can hand off');

    await begin('trusteeship-active');
    state = await waitFor(s => !s.running);
    assert.equal(state.clicks, 0, 'active trusteeship still blocks a concurrent sweep');
    assert.equal(state.tail, 0);
    assert.match(state.messages[0], /托管正在运行/);

    await begin('more-opportunities');
    state = await drain(6);
    assert.equal(state.clicks, 6);
    assert.equal(state.tail, 0, 'enabled preference with opportunities beyond the six-sweep cap blocks trusteeship handoff');
    assert.match(state.messages[0], /剩余次数/);

    await begin('no-handoff');
    state = await drain(6);
    assert.equal(state.clicks, 6);
    assert.equal(state.tail, 0, 'a disabled queue handoff does not start the trusteeship tail');
    assert.equal(state.closes, 1, 'the native sweep panel still closes before finishing');
    assert.equal(state.panel, 'absent');
    assert.match(state.messages[0], /无限幻象已扫荡 6 次/);
    assert.doesNotMatch(state.messages[0], /托管偏好|剩余次数不明确/,
      'without a queued handoff, completion does not depend on native trusteeship preference');
    console.log('PASS no-handoff queue tail finishes normally at the sweep limit after confirmed panel close');

    await begin('cold-ai');
    state = await waitFor(s => !s.running);
    assert.equal(state.clicks, 0);
    assert.equal(state.tail, 1, 'unloaded AI settings can hand off when the fresh native list has no opportunities');

    await begin('reject-click');
    state = await waitFor(s => !s.running);
    assert.equal(state.clicks, 0, 'a rejected native button click does not create an unresolved submission');
    assert.equal(state.tail, 0);
    await perform('restart');
    state = await waitFor(s => s.confirms === 1);
    assert.equal(state.clicks, 1, 'a later run can try after the native click was rejected');
    await perform('stop');

    await begin('cancel-before-submit');
    state = await perform('start-stop-pending');
    assert.equal(state.clicks, 1);
    assert.equal(state.confirms, 0);
    assert.equal(state.confirmationCancels, 1, 'stopping closes the exact pending native confirmation');
    assert.equal(state.modal, 'none');
    await perform('restart');
    state = await waitFor(s => s.confirms === 1);
    assert.equal(state.clicks, 2, 'a cancelled confirmation has no submission lock on the next run');
    await perform('stop');

    await begin('user-accepted-before-stop');
    state = await perform('start-user-ok-stop');
    assert.equal(state.clicks, 1);
    assert.equal(state.raidWasSubmitted, true);
    assert.match(state.messages.join('\n'), /请勿立即重试/);
    await perform('restart');
    state = await waitFor(s => !s.running);
    assert.equal(state.clicks, 1, 'a user-accepted native confirmation is locked before the next poll');
    assert.equal(state.tail, 0);

    await begin('unknown-modal');
    state = await waitFor(s => !s.running);
    assert.equal(state.clicks, 1);
    assert.equal(state.confirms, 0);
    assert.equal(state.tail, 0);

    await begin('cancel');
    await waitFor(s => s.confirms === 1);
    await delay(900);
    state = await perform('state');
    assert.equal(state.running, false);
    assert.equal(state.clicks, 1, 'cancelled or unknown result is never retried');
    assert.equal(state.tail, 0);

    await begin('');
    await waitFor(s => s.confirms === 1);
    await perform('stop');
    state = await perform('state');
    assert.equal(state.clicks, 1);
    assert.equal(state.tail, 0, 'stopping with a pending result never starts the queue tail');
    assert.equal(state.protocolRequests, 0);
    assert.match(state.messages.join('\n'), /请勿立即重试/);

    console.log('PASS Infinite Illusion sweep UI state machine');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await win.destroy();
    app.quit();
  }
});
