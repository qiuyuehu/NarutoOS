const runFlashResult = require('../fixtures/flash-result-runtime.cjs');

runFlashResult({
  name: 'native-auto-battle',
  fixture: process.env.NATIVE_AUTO_BATTLE_SWF,
  resultCallback: 'nativeAutoBattleResult',
  expectedPasses: 18,
  timeoutMs: 30000,
});
