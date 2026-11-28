const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const root = path.resolve(__dirname, '../..');
const artifacts = path.join(root, '.test-artifacts/grocery-task-flash');
app.setPath('userData', path.join(artifacts, 'profile'));
app.commandLine.appendSwitch('ppapi-flash-path', path.join(root, 'runtime/flash-31/PepperFlashPlayer.plugin/Contents/MacOS/PepperFlashPlayer'));
app.commandLine.appendSwitch('ppapi-flash-version', '31.0.0.148');
app.commandLine.appendSwitch('disable-background-networking');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 240, height: 180, webPreferences: { plugins: true, backgroundThrottling: false } });
  try {
    const host = 'https://grocery-task-fixture.test/';
    const html = '<object id="fixture" type="application/x-shockwave-flash" data="/fixture.swf" width="240" height="180"><param name="allowScriptAccess" value="sameDomain"></object>';
    await new Promise((resolve, reject) => win.webContents.session.protocol.interceptBufferProtocol('https', (request, respond) => {
      if (request.url === host) respond({ mimeType: 'text/html', data: Buffer.from(html) });
      else if (request.url === host + 'fixture.swf') respond({ mimeType: 'application/x-shockwave-flash', data: fs.readFileSync(process.env.GROCERY_TASK_SWF) });
      else respond({ error: -6 });
    }, error => error ? reject(error) : resolve()));
    await win.loadURL(host);
    const perform = (action, value = '') => win.webContents.executeJavaScript(
      `document.getElementById('fixture').perform(${JSON.stringify(action)}, ${JSON.stringify(value)})`);
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const waitFor = async (condition, timeout = 2500) => {
      const deadline = Date.now() + timeout;
      let snapshot;
      while (Date.now() < deadline) {
        try { snapshot = await perform('state'); } catch {}
        if (snapshot && condition(snapshot)) return snapshot;
        await delay(30);
      }
      assert.fail(`Timed out waiting for grocery fixture: ${JSON.stringify(snapshot)}`);
    };
    const start = async (scenario = '') => {
      await perform('reset', scenario);
      return perform('start');
    };
    const finished = () => waitFor(state => !state.running);

    await waitFor(state => state != null);

    await start('empty');
    let state = await finished();
    assert.match(state.messages[0], /没有勾选/);
    assert.equal(state.opens, 0);
    assert.equal(state.tail, 1);
    for (const scenario of ['invalid', 'duplicate', 'stale', 'currency', 'clamp', 'total', 'disabled']) {
      await start(scenario);
      state = await finished();
      assert.equal(state.buys.length, 0, scenario);
      assert.equal(state.confirms, 0, scenario);
      assert.equal(state.tail, 0, scenario);
      assert.equal(state.pending, false, scenario);
    }

    await start('not-ready');
    await waitFor(s => s.confirms === 1);
    state = await perform('state');
    assert.equal(state.buys[0].quantity, 5);
    await perform('receipt', 'success');
    await waitFor(s => s.confirms === 2);
    await perform('receipt', 'success');
    state = await finished();
    assert(state.prepareCalls >= 3);
    assert.equal(state.tail, 1);
    assert.match(state.messages[0], /洞穴密钥 · 已兑换 5 个/);

    await start();
    await waitFor(s => s.confirms === 1);
    await perform('start');
    await delay(370);
    state = await perform('state');
    assert.deepEqual(state.buys, [{id: 1, quantity: 5, total: 1000}]);
    assert.equal(state.confirms, 1);
    assert.equal(state.tail, 0);
    await perform('receipt', 'success');
    state = await waitFor(s => s.confirms === 2);
    assert.deepEqual(state.buys, [{id: 1, quantity: 5, total: 1000}, {id: 2, quantity: 2, total: 600}]);
    assert.equal(state.tail, 0);
    await perform('receipt', 'success');
    state = await finished();
    assert.match(state.messages[0], /洞穴密钥 · 已兑换 5 个\n秘卷残页 · 已兑换 2 个/);
    assert.equal(state.closes, 1);
    assert.equal(state.tail, 1);

    await start('pt-name');
    await waitFor(s => s.buys.length === 1);
    await perform('receipt', 'success');
    await waitFor(s => s.buys.length === 2);
    await perform('receipt', 'success');
    state = await finished();
    assert.match(state.messages[0], /洞穴密钥 · 已兑换 5 个\n秘卷残页 · 已兑换 2 个/);
    assert.equal(state.tail, 1);

    await start('stock');
    state = await waitFor(s => s.buys.length === 1);
    assert.deepEqual(state.buys, [{id: 2, quantity: 2, total: 600}]);
    await perform('receipt', 'success');
    state = await finished();
    assert.match(state.messages[0], /洞穴密钥 · 跳过，库存不足/);
    assert.match(state.messages[0], /秘卷残页 · 已兑换 2 个/);

    await start('balance');
    await waitFor(s => s.buys.length === 1);
    await perform('receipt', 'success');
    state = await finished();
    assert.match(state.messages[0], /秘卷残页 · 跳过，月之印余额不足/);
    assert.equal(state.buys.length, 1);
    assert.equal(state.confirms, 0);
    assert.equal(state.tail, 1);

    await start('no-prompt');
    await waitFor(s => s.buys.length === 1);
    await perform('receipt', 'failed');
    state = await finished();
    assert.match(state.messages[0], /本次购买未成交/);
    assert.equal(state.pending, false);
    assert.equal(state.tail, 0);

    for (const scenario of ['bad-confirm', 'unrelated', 'throw']) {
      await start(scenario);
      state = await finished();
      assert.equal(state.buys.length, 1, scenario);
      assert.equal(state.confirms, 0, scenario);
      assert.equal(state.tail, 0, scenario);
      assert.equal(state.closes, 0, scenario);
      assert.equal(state.pending, true, scenario);
      assert.match(state.messages[0], /洞穴密钥 · 待核对/, scenario);
      await perform('retry');
      state = await finished();
      assert.equal(state.retryOpens, 0, scenario);
      assert.equal(state.retryBuys.length, 0, scenario);
      assert.match(state.messages[1], /仍待核对/, scenario);
    }

    await start('no-prompt');
    await waitFor(s => s.buys.length === 1);
    await perform('hide');
    state = await waitFor(s => !s.running, 17000);
    assert.match(state.messages[0], /等待交易回执超时/);
    assert.equal(state.buys.length, 1);
    assert.equal(state.confirms, 0);
    assert.equal(state.tail, 0);
    await perform('receipt', 'success');
    await perform('retry');
    state = await finished();
    assert.equal(state.pending, false);
    assert.equal(state.retryOpens, 0);
    assert.equal(state.retryBuys.length, 0);
    assert.match(state.messages[1], /上笔已结算，洞穴密钥已兑换 5 个/);
    await perform('retry');
    state = await waitFor(s => s.retryBuys.length === 1);
    assert.equal(state.retryOpens, 1);
    await perform('stop');

    await start();
    await waitFor(s => s.buys.length === 1);
    await perform('stop');
    await perform('receipt', 'success');
    await delay(270);
    state = await finished();
    assert.equal(state.buys.length, 1);
    assert.equal(state.confirms, 0);
    assert.equal(state.tail, 0);
    assert.match(state.messages[0], /已停止本轮任务。\n杂货屋兑换\n洞穴密钥 · 待核对[^\n]*\n秘卷残页 · 未执行/);

    await start('no-prompt');
    await waitFor(s => s.buys.length === 1);
    state = await perform('settleAndStop');
    assert.match(state.messages[0], /洞穴密钥 · 已兑换 5 个\n秘卷残页 · 未执行/);
    assert.equal(state.pending, false);
    assert.equal(state.buys.length, 1);
    assert.equal(state.tail, 0);
    console.log('PASS grocery purchase verification, stock and balance skips, confirmation ownership, retry, timeout and cancellation');
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
