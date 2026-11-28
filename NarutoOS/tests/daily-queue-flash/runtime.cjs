const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '../..');
const plugin = path.join(root, 'runtime/flash-34/PepperFlashPlayer.plugin/Contents/MacOS/PepperFlashPlayer');
app.setPath('userData', path.join(path.dirname(process.env.DAILY_QUEUE_FIXTURE_SWF), 'profile'));
app.commandLine.appendSwitch('ppapi-flash-path', plugin);
app.commandLine.appendSwitch('ppapi-flash-version', '34.0.0.384');
app.commandLine.appendSwitch('disable-background-networking');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 500, height: 320,
    webPreferences: { plugins: true, backgroundThrottling: false },
  });
  try {
    const host = 'https://daily-queue-fixture.test/';
    const html = '<!doctype html><object id="fixture" type="application/x-shockwave-flash" data="/queue.swf" width="500" height="320"><param name="allowScriptAccess" value="sameDomain"></object>' +
      '<object id="strong" type="application/x-shockwave-flash" data="/strong.swf" width="500" height="320"><param name="allowScriptAccess" value="sameDomain"></object>' +
      '<object id="teamDungeon" type="application/x-shockwave-flash" data="/team-dungeon.swf" width="500" height="320"><param name="allowScriptAccess" value="sameDomain"></object>';
    await new Promise((resolve, reject) => {
      win.webContents.session.protocol.interceptBufferProtocol('https', (request, respond) => {
        if (request.url === host) respond({ mimeType: 'text/html', data: Buffer.from(html) });
        else if (request.url === host + 'queue.swf') respond({ mimeType: 'application/x-shockwave-flash', data: fs.readFileSync(process.env.DAILY_QUEUE_FIXTURE_SWF) });
        else if (request.url === host + 'strong.swf') respond({ mimeType: 'application/x-shockwave-flash', data: fs.readFileSync(process.env.DAILY_STRONG_FIXTURE_SWF) });
        else if (request.url === host + 'team-dungeon.swf') respond({ mimeType: 'application/x-shockwave-flash', data: fs.readFileSync(process.env.DAILY_TEAM_DUNGEON_FIXTURE_SWF) });
        else respond({ error: -6 });
      }, error => error ? reject(error) : resolve());
    });
    await win.loadURL(host);
    const call = async (action, value = '') => win.webContents.executeJavaScript(
      `document.getElementById('fixture').perform(${JSON.stringify(action)},${JSON.stringify(value)})`);
    const strongCall = async (action, value = '') => win.webContents.executeJavaScript(
      `document.getElementById('strong').perform(${JSON.stringify(action)},${JSON.stringify(value)})`);
    const teamDungeonCall = async (action, value = '') => win.webContents.executeJavaScript(
      `document.getElementById('teamDungeon').perform(${JSON.stringify(action)},${JSON.stringify(value)})`);
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    let state;
    for (let i = 0; i < 150; i++) {
      try { state = await call('snapshot'); break; } catch {}
      await wait(50);
    }
    assert.ok(state, 'Flash queue fixture did not load');

    const choose = (action, server, option = 'strong') => win.webContents.executeJavaScript(
      `document.getElementById('fixture').selection(${JSON.stringify(action)},${server},${JSON.stringify(option)})`);
    const reloadFixture = async () => {
      await win.loadURL(host);
      for (let i = 0; i < 100; i++) {
        try { if (await call('snapshot')) return; } catch {}
        await wait(50);
      }
      throw Error('Flash fixture did not reload');
    };
    const checked = '已勾选', unchecked = '未勾选';
    if (await choose('open', 1) === checked) await choose('toggle', 1);
    assert.equal(await choose('toggle', 1), checked);
    await reloadFixture();
    assert.equal(await choose('open', 2), unchecked);
    for (const [id, label] of Object.entries({
      wanted: '通缉任务', quiz: '忍者测验', expedition: '生存演习', strong: '强者降临',
      teamDungeon: '组队副本', escort: 'SS 级押镖', escortS: 'S 级押镖（1 次）', grocery: '杂货屋兑换',
      autoModeAfterDaily: '完成后进入托管', hidePlayers: '隐藏队友以外的玩家', battleSettings: '下场战斗开启自动＋2倍速',
    })) assert.equal(await choose('label', 2, id), label, `daily choice label for ${id}`);
    await choose('close', 2);
    assert.equal(await choose('open', 1), checked);
    assert.equal(await choose('toggle', 1), unchecked);
    await reloadFixture();
    assert.equal(await choose('open', 1), unchecked);
    await choose('close', 1);
    console.log('PASS checked and unchecked choices survive a game reload and stay scoped to the role');

    const regionalRole = 761;
    const savedItemIds = [10190675, 10190903, 10190904, 10191227, 10191229, 10191226, 10190602, 10800057];
    const savedGrocery = Object.fromEntries(savedItemIds.map((id, i) => [id, { enabled: true, quantity: i + 1 }]));
    const checkGroceryIds = async expectedIds => {
      const orders = JSON.parse(await choose('groceryOrders', regionalRole, JSON.stringify(savedGrocery)));
      assert.deepEqual(orders.map(order => [order.id, order.quantity]), expectedIds.map((id, i) => [id, i + 1]));
    };
    await choose('open', regionalRole);
    await checkGroceryIds(savedItemIds);
    assert.equal(await choose('has', regionalRole, 'infiniteIllusion'), 'absent');
    const cnChoice = await choose('snapshot', regionalRole, 'strong');
    await reloadFixture();
    assert.equal(await choose('openBR', regionalRole, 'infiniteIllusion'), unchecked);
    await checkGroceryIds([10190675, 10190903, 10190904, 10198158, 10198160, 10812001, 10190602, 10800057]);
    console.log('PASS existing grocery choices produce the eight region-specific item IDs and preserve quantities');
    assert.equal(await choose('label', regionalRole, 'infiniteIllusion'), '无限幻象扫荡');
    if (await choose('snapshot', regionalRole, 'strong') === cnChoice) await choose('toggle', regionalRole, 'strong');
    assert.equal(await choose('toggle', regionalRole, 'infiniteIllusion'), checked);
    await reloadFixture();
    assert.equal(await choose('open', regionalRole, 'strong'), cnChoice);
    await reloadFixture();
    assert.equal(await choose('openBR', regionalRole, 'infiniteIllusion'), checked);
    assert.notEqual(await choose('snapshot', regionalRole, 'strong'), cnChoice);
    assert.equal(await choose('toggle', regionalRole, 'infiniteIllusion'), unchecked);
    await reloadFixture();
    console.log('PASS BR-only sweep starts unchecked, persists, and shares no role choices with CN');

    const handoffServer = Math.floor(Date.now() / 1000) + 100;
    assert.equal(await choose('open', handoffServer, 'autoModeAfterDaily'), checked,
      'profiles without the new option retain the former auto-mode handoff behavior');
    const cnLayout = JSON.parse(await choose('layout', handoffServer));
    assert.equal(cnLayout.executable, false, 'the default handoff preference alone cannot start an empty run');
    assert.ok(cnLayout.statusY > cnLayout.choiceY && cnLayout.executeY >= cnLayout.statusBottom,
      'CN execution controls and result stay separated');
    assert.equal(await choose('toggle', handoffServer, 'autoModeAfterDaily'), unchecked);
    await choose('close', handoffServer);
    await reloadFixture();
    assert.equal(await choose('open', handoffServer, 'autoModeAfterDaily'), unchecked,
      'the CN preference persists after reload');
    await choose('close', handoffServer);
    assert.equal(await choose('openBR', handoffServer, 'autoModeAfterDaily'), checked,
      'the BR profile has an independent legacy-compatible default');
    const brLayout = JSON.parse(await choose('layout', handoffServer));
    assert.ok(brLayout.statusY > brLayout.choiceY && brLayout.executeY >= brLayout.statusBottom,
      'BR execution controls and result stay separated');
    assert.equal(await choose('toggle', handoffServer, 'autoModeAfterDaily'), unchecked);
    await choose('close', handoffServer);
    await reloadFixture();
    assert.equal(await choose('open', handoffServer, 'autoModeAfterDaily'), unchecked);
    await choose('close', handoffServer);
    assert.equal(await choose('openBR', handoffServer, 'autoModeAfterDaily'), unchecked);
    await choose('close', handoffServer);
    console.log('PASS post-daily Auto Mode preference defaults on for old profiles, persists, and stays isolated by region');


    assert.equal(await choose('open', 2, 'hidePlayers'), unchecked);
    assert.equal(await choose('toggle', 2, 'escortS'), checked);
    assert.equal(await choose('toggle', 2, 'hidePlayers'), checked);
    await reloadFixture();
    assert.equal(await choose('open', 2, 'escortS'), checked);
    assert.equal(await choose('toggle', 2, 'escortS'), unchecked);
    assert.equal(await choose('snapshot', 2, 'hidePlayers'), checked);
    assert.equal(await choose('execute', 2), '已隐藏队友以外的玩家。');
    assert.equal(await choose('modelReads', 2), 'player.PlayerModel', 'standalone hide does not start a daily task or activate Auto Mode');
    assert.equal(await choose('toggle', 2, 'hidePlayers'), unchecked);
    await choose('toggle', 2, 'strong');
    assert.equal(await choose('execute', 2), 'queue');
    await choose('open', 2, 'strong');
    assert.equal((await choose('modelReads', 2)).split(',').filter(n => n === 'player.PlayerModel').length, 1);
    assert.equal(await choose('toggle', 2, 'strong'), unchecked);
    await choose('close', 2);
    console.log('PASS independent visibility option and S escort persist; hiding alone leaves Auto Mode idle');

    const shopServer = Math.floor(Date.now() / 1000);
    await choose('open', shopServer, 'grocery');
    await choose('toggle', shopServer, 'grocery');
    assert.match(await choose('execute', shopServer), /清单为空/);
    await choose('settings', shopServer);
    assert.equal(await choose('getQty', shopServer), '1');
    assert.equal(await choose('editItem', shopServer), '本轮合计 200 月之印');
    assert.equal(await choose('setQty', shopServer, '5'), '本轮合计 1000 月之印');
    assert.equal(await choose('save', shopServer), 'closed');
    await reloadFixture();
    assert.equal(await choose('open', shopServer, 'grocery'), checked);
    await choose('settings', shopServer);
    assert.equal(await choose('getQty', shopServer), '5');
    await choose('setQty', shopServer, '1.5');
    assert.match(await choose('save', shopServer), /正整数/);
    await choose('back', shopServer);
    await choose('settings', shopServer);
    assert.equal(await choose('getQty', shopServer), '5', 'returning without saving discards the draft');
    await choose('back', shopServer);
    await choose('toggle', shopServer, 'grocery');
    assert.equal(await choose('modelReads', shopServer), '', 'editing and saving never start a game action');
    await choose('close', shopServer);
    await choose('open', shopServer - 1, 'battleSettings');
    await choose('settings', shopServer - 1);
    assert.equal(await choose('getQty', shopServer - 1), '1', 'grocery quantities stay with the role');
    await choose('back', shopServer - 1);
    await choose('toggle', shopServer - 1, 'battleSettings');
    assert.equal(await choose('execute', shopServer - 1), 'queue');
    assert.equal(await choose('standaloneStop', shopServer - 1), 'stopped');
    await choose('open', shopServer - 1);
    assert.match(await choose('summary', shopServer - 1), /已停止等待战斗设置/);
    await choose('close', shopServer - 1);
    console.log('PASS grocery settings persist by role, validate positive quantities, total moon coins and never buy on save');
    console.log('PASS standalone battle setup exposes Stop before battle and can be cancelled without launching Auto Mode');

    state = await call('start', 'quiz,expedition,strong');
    assert.deepEqual(state.started, [{ id: 'quiz', hasNext: true }]);
    await call('progress', '第 8/10 题');
    state = await call('complete', 'complete|测验完成');
    assert.deepEqual(state.started, [{ id: 'quiz', hasNext: true }, { id: 'expedition', hasNext: true }]);
    state = await call('complete', 'blocked|演习跳过：未开放');
    assert.deepEqual(state.started[state.started.length - 1], { id: 'strong', hasNext: false });
    state = await call('complete', 'complete|强者完成');
    assert.equal(state.running, false);
    assert.deepEqual(state.finished, ['测验完成\n演习跳过：未开放\n强者完成']);
    console.log('PASS COMPLETE/BLOCKED handoff and summary');

    await call('reset');
    state = await call('start', 'infiniteIllusion');
    assert.deepEqual(state.started, [{ id: 'infiniteIllusion', hasNext: false }],
      'without the optional tail task, infinite illusion remains the final daily task');
    state = await call('complete', 'complete|无限幻象完成');
    assert.equal(state.running, false);
    await call('reset');
    state = await call('start', 'infiniteIllusion,autoMode');
    assert.deepEqual(state.started, [{ id: 'infiniteIllusion', hasNext: true }],
      'the legacy Auto Mode tail keeps hasNext true for infinite illusion');
    state = await call('complete', 'complete|无限幻象完成');
    assert.deepEqual(state.started[state.started.length - 1], { id: 'autoMode', hasNext: false });
    await call('complete', 'complete|托管完成');
    console.log('PASS infinite illusion hasNext follows the optional Auto Mode queue tail');

    await call('reset');
    state = await call('start', 'wanted,strong');
    state = await call('complete', 'abort|通缉状态无法确认');
    assert.deepEqual(state.started, [{ id: 'wanted', hasNext: true }]);
    assert.equal(state.running, false);
    assert.deepEqual(state.finished, ['通缉状态无法确认']);
    console.log('PASS ABORT stops later task startup');

    await call('reset');
    state = await call('start', 'quiz,strong');
    state = await call('cancel');
    await call('lateComplete');
    state = await call('progress', '迟到进度');
    assert.deepEqual(state.started, [{ id: 'quiz', hasNext: true }]);
    assert.deepEqual(state.canceled, ['quiz']);
    assert.deepEqual(state.finished, ['已停止本轮任务。']);
    assert.deepEqual(state.progress, ['']);
    console.log('PASS cancel invalidates late task callbacks');

    await call('reset');
    await call('start', 'quiz,strong');
    await call('cancel');
    await call('start', 'wanted');
    await call('lateFirstComplete');
    state = await call('lateFirstProgress');
    assert.equal(state.running, true, 'a cancelled first-round completion cannot advance the second round');
    assert.deepEqual(state.started, [{ id: 'quiz', hasNext: true }, { id: 'wanted', hasNext: false }]);
    assert.deepEqual(state.progress, ['', ''], 'first-round progress cannot overwrite second-round progress');
    assert.deepEqual(state.finished, ['已停止本轮任务。']);
    state = await call('complete', 'complete|第二轮完成');
    assert.equal(state.running, false);
    assert.deepEqual(state.finished, ['已停止本轮任务。', '第二轮完成']);
    console.log('PASS callbacks from a cancelled round cannot change a later round');

    await call('reset');
    state = await call('start', 'quiz,strong');
    state = await call('doubleComplete');
    assert.deepEqual(state.started, [{ id: 'quiz', hasNext: true }, { id: 'strong', hasNext: false }]);
    state = await call('complete', 'complete|强者完成');
    assert.deepEqual(state.finished, ['first\n强者完成']);
    console.log('PASS repeated completion advances once');

    await call('reset');
    state = await call('start', 'stuck,strong');
    assert.deepEqual(state.started, [{ id: 'stuck', hasNext: true }]);
    assert.equal(state.running, false);
    assert.match(state.finished[0], /任务没有启动/);
    console.log('PASS non-running task aborts cleanly');

    const waitStrong = async predicate => {
      let current;
      const deadline = Date.now() + 6000;
      do {
        current = await strongCall('snapshot');
        if (predicate(current)) return current;
        await wait(60);
      } while (Date.now() < deadline);
      throw Error('Strong fixture did not reach expected state: ' + JSON.stringify(current));
    };
    await strongCall('begin', 'next');
    state = await waitStrong(current => current.startClicks === 1);
    assert.equal(state.running, true);
    assert.equal(state.difficulty, 'hard');
    assert.deepEqual(state.finished, []);
    await strongCall('result', 'win');
    state = await waitStrong(current => current.finished.length > 0);
    assert.equal(state.finished[0].status, 'complete');
    assert.equal(state.startClicks, 1);
    assert.equal(state.resultExitClicks, 1);
    assert.equal(state.awardClicks, 1);
    assert.equal(state.scoreClicks, 1);
    assert(state.progress.indexOf('强者降临 1/1') >= 0);
    console.log('PASS Strong Coming native entry, one start, win exit, award and score handoff');

    await strongCall('begin', 'next');
    state = await waitStrong(current => current.startClicks === 1);
    await strongCall('result', 'lose');
    state = await waitStrong(current => current.finished.length > 0);
    assert.equal(state.finished[0].status, 'complete');
    assert.equal(state.resultKind, 'lose');
    assert.equal(state.startClicks, 1);
    assert.equal(state.resultExitClicks, 1);
    assert.equal(state.awardClicks, 1);
    assert.equal(state.scoreClicks, 1);
    console.log('PASS Strong Coming loss UI exits through its sole enabled button');

    await strongCall('begin', 'blocked');
    state = await waitStrong(current => current.finished.length > 0);
    assert.equal(state.startClicks, 0);
    assert.equal(state.finished[0].status, 'blocked');
    assert.match(state.finished[0].message, /65级后开启/);
    assert.equal(state.panel, null);
    console.log('PASS locked difficulty closes its panel and skips with native reason');

    await strongCall('begin', 'unknown');
    state = await waitStrong(current => current.finished.length > 0);
    assert.equal(state.startClicks, 0);
    assert.equal(state.finished[0].status, 'abort');
    console.log('PASS disabled start with no native reason aborts safely');

    await strongCall('begin', 'empty');
    state = await waitStrong(current => current.finished.length > 0);
    assert.equal(state.startClicks, 0);
    assert.equal(state.finished[0].status, 'blocked');
    assert(state.eventOrder.indexOf('query.finish') < state.eventOrder.indexOf('href.loadingEnd'));
    console.log('PASS empty native activity query before href completion skips without starting');

    for (const scenario of ['expired', 'expiredBR']) {
      await strongCall('begin', scenario);
      state = await waitStrong(current => current.finished.length > 0);
      assert.equal(state.startClicks, 1);
      assert.equal(state.fighting, false);
      assert.equal(state.finished[0].status, 'blocked');
      assert.match(state.finished[0].message, /降临副本已关闭/);
      assert.equal(state.panel, null);
    }
    console.log('PASS native CN and BR expired-activity tips close the panel and skip');

    await strongCall('begin', 'last');
    await waitStrong(current => current.startClicks === 1);
    await strongCall('award');
    state = await waitStrong(current => current.finished.length > 0);
    assert.equal(state.finished[0].status, 'complete');
    assert.deepEqual(state.progress.filter(value => value === '强者降临 1/1'), ['强者降临 1/1']);
    assert.equal(state.resultExitClicks, 0);
    assert.equal(state.awardClicks, 1);
    assert.equal(state.scoreClicks, 1);
    assert.equal(state.panel, null);
    assert.equal(state.startClicks, 1);
    console.log('PASS direct Strong Coming reward counts once and closes both panels on the last task');

    state = await strongCall('resume', 'last');
    assert.equal(state.finished[0]?.status, 'complete', 'the completed Strong Coming challenge is skipped in the same game window');
    assert.equal(state.startClicks, 0);

    await strongCall('begin', 'last');
    await waitStrong(current => current.startClicks === 1);
    await strongCall('award');
    state = await strongCall('retry');
    assert.equal(state.finished[0]?.status, 'abort', 'an open settlement panel prevents the next task from taking over');
    state = await strongCall('resume', 'last');
    assert.equal(state.finished[0]?.status, 'complete', 'a native settlement registered before the run was stopped');
    assert.equal(state.startClicks, 0);

    await strongCall('begin', 'next');
    await waitStrong(current => current.startClicks === 1);
    await strongCall('cancel');
    await strongCall('result', 'win');
    await wait(250);
    state = await strongCall('snapshot');
    assert.equal(state.running, false);
    assert.deepEqual(state.finished, []);
    assert.equal(state.resultExitClicks, 0);
    assert.equal(state.awardClicks, 0);
    assert(Object.keys(state.fightUi).length > 0, 'late result remains on the game screen for the player');
    console.log('PASS cancel during battle ignores the later result and leaves it open');

    await strongCall('queue');
    await waitStrong(current => current.startClicks === 1);
    await strongCall('result', 'win');
    state = await waitStrong(current => current.scoreClicks === 1);
    assert.deepEqual(state.queueStarted, ['strong']);
    await wait(120);
    state = await strongCall('snapshot');
    assert.deepEqual(state.queueStarted, ['strong'], 'next task must wait while the score window hide animation is running');
    state = await waitStrong(current => current.queueStarted.length === 2);
    assert.equal(state.handoff.safe, true);
    assert.equal(state.handoff.scoreHideFinished, true);
    assert.equal(state.handoff.resultLayerOpen, false);
    assert.equal(state.handoff.rewardPanelOpen, false);
    assert(state.eventOrder.indexOf('score.boxHided') < state.eventOrder.indexOf('after.started'));
    assert.deepEqual(state.finished.map(item => item.status), ['queue']);
    console.log('PASS real StrongRun queue waits for score boxHided and hands off in an operable state');

    const waitTeamDungeon = async predicate => {
      let current;
      const deadline = Date.now() + 6000;
      do {
        current = await teamDungeonCall('snapshot');
        if (predicate(current)) return current;
        await wait(50);
      } while (Date.now() < deadline);
      throw Error('Team dungeon fixture did not reach expected state: ' + JSON.stringify(current));
    };

    await teamDungeonCall('begin', '-1|ready');
    state = await waitTeamDungeon(current => current.fightCommands.length === 1);
    assert.equal(state.routeCalls, 1, 'unknown progress still opens the native activity');
    assert.equal(state.chooseCalls, 1);
    assert.deepEqual(state.fightCommands[0], {
      dungeonId: 93001,
      difficulty: 3,
      type: 'dungeon.command::TeamNewDungeonFightCommand',
    });
    await teamDungeonCall('result', 'win');
    await wait(180);
    state = await teamDungeonCall('snapshot');
    assert.equal(state.fightCommands.length, 1, 'a result receipt alone does not start another round');
    await teamDungeonCall('end');
    await wait(240);
    state = await teamDungeonCall('snapshot');
    assert.equal(state.fightCommands.length, 1, 'end receipt without a reopened list does not start another round');
    assert.equal(state.running, true);
    await teamDungeonCall('reopen');
    state = await waitTeamDungeon(current => current.fightCommands.length === 2);
    assert.equal(state.completed, -1, 'the fixture keeps daily completion count unknown throughout');
    await teamDungeonCall('reward');
    await wait(240);
    state = await teamDungeonCall('snapshot');
    assert.match(state.panel, /TeamNewDungeonRewardPanel/);
    assert.equal(state.rewardBackClickCalls, 0, 'the reward back button is not used before the native panel is ready');
    await teamDungeonCall('rewardReadyBlocked');
    await wait(240);
    state = await teamDungeonCall('snapshot');
    assert.match(state.panel, /TeamDungeonBlocker/, 'an unrelated non-modal box above the reward remains untouched');
    assert.equal(state.rewardBackClickCalls, 0, 'the assistant does not click through another topmost box');
    assert.equal(state.fightCommands.length, 2, 'the next round still waits for the dungeon list');
    await teamDungeonCall('unblockReward');
    state = await waitTeamDungeon(current => current.rewardBackClickCalls === 1);
    assert.match(state.panel, /TeamNewDungeonRewardPanel/, 'the native card-flip close animation is allowed to finish');
    assert.equal(state.fightCommands.length, 2, 'the next fight does not start before native reward cleanup');
    state = await waitTeamDungeon(current => current.rewardCloseCalls === 1);
    assert.equal(state.panel, '', 'the ready native back button closes after the card animation');
    await teamDungeonCall('end');
    await wait(240);
    state = await teamDungeonCall('snapshot');
    assert.equal(state.panel, '');
    assert.equal(state.fightCommands.length, 2, 'second round also waits for the native list to return');
    await teamDungeonCall('reopen');
    state = await waitTeamDungeon(current => current.fightCommands.length === 3);
    await teamDungeonCall('result', 'win');
    await teamDungeonCall('end');
    await wait(240);
    state = await teamDungeonCall('snapshot');
    assert.equal(state.fightCommands.length, 3);
    await teamDungeonCall('reopen');
    state = await waitTeamDungeon(current => current.finished.length > 0);
    await teamDungeonCall('reopen');
    await wait(260);
    state = await teamDungeonCall('snapshot');
    assert.equal(state.finished[0].status, 'complete');
    assert.equal(state.fightCommands.length, 3, 'the third confirmed round closes the task without a fourth request');
    assert.equal(state.chooseCalls, 3);
    assert.equal(state.running, false);
    console.log('PASS reward readiness, exact top-box safety, and native back-button cleanup preserve the list handoff');
    console.log('PASS unknown team-dungeon progress runs exactly three rounds and waits for each result, end, and reopened list');

    state = await teamDungeonCall('resume', '-1|ready');
    assert.equal(state.finished[0]?.status, 'complete', 'three settled rounds are remembered in the same game window');
    assert.equal(state.routeCalls, 0);

    await teamDungeonCall('begin', '-1|ready');
    await waitTeamDungeon(current => current.fightCommands.length === 1);
    await teamDungeonCall('reward');
    await teamDungeonCall('cancel');
    await teamDungeonCall('resume', '-1|ready');
    state = await waitTeamDungeon(current => current.fightCommands.length === 1);
    assert.deepEqual(state.reports, ['组队副本 1/3'], 'an already settled round survives cancellation without native progress');
    await teamDungeonCall('cancel');
    await teamDungeonCall('resume', '1|ready');
    state = await waitTeamDungeon(current => current.fightCommands.length === 1);
    assert.deepEqual(state.reports, ['组队副本 1/3'], 'native progress includes the already remembered round');
    await teamDungeonCall('cancel');
    await teamDungeonCall('resume', '0|ready');
    state = await waitTeamDungeon(current => current.fightCommands.length === 1);
    assert.deepEqual(state.reports, ['组队副本 1/3'], 'a lagging native counter preserves the remembered round');
    await teamDungeonCall('begin', '-1|ready');
    await waitTeamDungeon(current => current.fightCommands.length === 1);
    await teamDungeonCall('reward');
    await teamDungeonCall('fail');
    state = await waitTeamDungeon(current => current.finished.length > 0);
    assert.equal(state.finished[0].status, 'abort', 'a reward panel before the native end event does not hide a later battle failure');
    assert.match(state.finished[0].message, /战斗已中断/);
    console.log('PASS an early reward panel keeps the battle phase active until native end or fail');

    await teamDungeonCall('resume', '0|ready');
    state = await waitTeamDungeon(current => current.fightCommands.length === 1);
    await teamDungeonCall('result', 'win');
    await teamDungeonCall('end');
    await teamDungeonCall('reopen');
    await waitTeamDungeon(current => current.fightCommands.length === 2);
    await teamDungeonCall('result', 'win');
    await teamDungeonCall('end');
    await teamDungeonCall('reopen');
    state = await waitTeamDungeon(current => current.finished.length > 0);
    assert.equal(state.finished[0].status, 'complete');
    assert.equal(state.fightCommands.length, 2, 'resume spends only the two unsettled rounds');
    console.log('PASS same-window team dungeon skips completed sessions and resumes settled rounds without double counting');

    await teamDungeonCall('begin', '2|ready');
    state = await waitTeamDungeon(current => current.fightCommands.length === 1);
    await teamDungeonCall('result', 'win');
    await teamDungeonCall('end');
    await wait(240);
    state = await teamDungeonCall('snapshot');
    assert.equal(state.completed, 3);
    assert.equal(state.fightCommands.length, 1, '2/3 requires only one fight request');
    await teamDungeonCall('reopen');
    state = await waitTeamDungeon(current => current.finished.length > 0);
    assert.equal(state.finished[0].status, 'complete');
    assert.equal(state.routeCalls, 1);
    assert.equal(state.fightCommands.length, 1, 'the confirmed 3/3 count prevents an extra request');
    console.log('PASS known 2/3 progress starts one fight and stops at 3/3');

    await teamDungeonCall('begin', '2|vanish');
    state = await waitTeamDungeon(current => current.fightCommands.length === 1);
    assert.equal(state.completed, -1, 'the progress counter disappears after the original 2/3 snapshot');
    await teamDungeonCall('result', 'win');
    await teamDungeonCall('end');
    await teamDungeonCall('reopen');
    state = await waitTeamDungeon(current => current.finished.length > 0);
    assert.equal(state.finished[0].status, 'complete');
    assert.equal(state.fightCommands.length, 1, 'a missing counter after a known 2/3 start does not trigger a fixed three-round run');
    console.log('PASS known 2/3 snapshot is preserved when the counter disappears after route navigation');

    await teamDungeonCall('begin', '3|ready');
    state = await waitTeamDungeon(current => current.finished.length > 0);
    assert.equal(state.finished[0].status, 'complete');
    assert.equal(state.routeCalls, 0, 'known 3/3 progress does not open the native activity');
    assert.equal(state.chooseCalls, 0);
    assert.deepEqual(state.fightCommands, []);
    console.log('PASS known 3/3 progress completes without opening the activity');

    await teamDungeonCall('begin', '2|blocked');
    state = await waitTeamDungeon(current => current.finished.length > 0);
    assert.equal(state.finished[0].status, 'blocked');
    assert.equal(state.fightCommands.length, 0, 'a blocked card never issues a native fight request');
    console.log('PASS blocked team-dungeon card returns its native reason without starting');

    await teamDungeonCall('begin', '-1|unknown');
    state = await waitTeamDungeon(current => current.finished.length > 0);
    assert.equal(state.finished[0].status, 'abort');
    assert.equal(state.fightCommands.length, 0, 'an unknown entry state never issues a native fight request');
    console.log('PASS unknown team-dungeon entry reason aborts without starting a fight');

    await teamDungeonCall('begin', '-1|ready');
    state = await waitTeamDungeon(current => current.fightCommands.length === 1);
    await teamDungeonCall('end');
    await teamDungeonCall('reopen');
    await wait(300);
    state = await teamDungeonCall('snapshot');
    assert.equal(state.fightCommands.length, 1, 'an end event without showResult cannot authorize the next round');
    assert.equal(state.running, true);
    await teamDungeonCall('cancel');
    await teamDungeonCall('result', 'win');
    await teamDungeonCall('end');
    await teamDungeonCall('reopen');
    await wait(300);
    state = await teamDungeonCall('snapshot');
    assert.equal(state.fightCommands.length, 1, 'cancel prevents late receipts from starting another round');
    assert.equal(state.running, false);
    assert.deepEqual(state.finished, []);
    console.log('PASS missing showResult holds the run; cancel ignores later battle receipts');

    if (process.argv.includes('--10x')) {
      const clockStart = Date.now();
      const gameStart = (await strongCall('snapshot')).clock;
      await wait(1200);
      const gameDelta = (await strongCall('snapshot')).clock - gameStart;
      const wallDelta = Date.now() - clockStart;
      assert(gameDelta > wallDelta * 8, `10x injection missing: game=${gameDelta}ms wall=${wallDelta}ms`);
      console.log(`PASS Strong fixture confirms accelerated Flash clock at ${Math.round(gameDelta / wallDelta)}x`);

      await strongCall('begin', 'delayedStart');
      state = await waitStrong(current => current.startClicks === 1);
      assert.equal(state.running, true);
      assert.equal(state.fighting, false);
      await wait(6200);
      state = await strongCall('snapshot');
      assert.equal(state.running, true, '10x must not shrink the native start acknowledgement wait');
      assert.deepEqual(state.finished, []);
      assert.equal(state.fighting, false);
      console.log('PASS 10x Strong Coming preserves the 30-second native start acknowledgement wait');
      await strongCall('ackStart');
      state = await waitStrong(current => current.fighting);
      assert.equal(state.running, true);
      await strongCall('result', 'win');
      state = await waitStrong(current => current.finished.length > 0);
      assert.equal(state.finished[0].status, 'complete');
      assert.equal(state.fighting, false);
      console.log('PASS delayed native battle-start receipt resumes Strong Coming through completion');
    }
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
