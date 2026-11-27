module.exports = async ({ call, wait, until, pass, assert }) => {
  await call('reset', 'confirm');
  await call('entry');
  await call('quiz');
  await call('select');
  await call('execute');
  await call('openWanted', 'ready');
  const started = await call('closeWanted');
  assert.equal(started.nativeStarts, 1);

  // Cross the original 15-game-minute deadline with two missions still to do.
  await wait(92000);
  const pending = await call('state');
  assert.ok(pending.gameTime - started.gameTime > 900000, '10x must be active in the Flash plugin');
  assert.equal(pending.stopAICalls, 0, pending.status);
  assert.equal(pending.quizNav, 0);
  pass('10x with two wanted missions left survives the old deadline');

  await call('left', '0');
  const terminalAt = Date.now();
  await wait(2100);
  assert.equal((await call('state')).quizNav, 0);
  await until(state => state.quizNav === 1, 5000);
  assert.ok(Date.now() - terminalAt >= 2500);
  pass('10x waits for a stable return before starting the next task');
  const navigationAt = Date.now();
  await wait(6000);
  const walking = await call('state');
  assert.equal(walking.drawn, false, walking.status);
  assert.equal(walking.quizNav, 1);
  const expired = await until(state => state.drawn, 65000);
  assert.match(expired.status, /等待测验界面打开超时/);
  assert.ok(Date.now() - navigationAt >= 44500, 'allow one poll to observe navigation');
  pass('quiz navigation survives the old 4.5-second deadline and still times out at normal speed');
  return {};
};
