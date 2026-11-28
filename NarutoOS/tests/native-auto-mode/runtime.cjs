const runFlashResult = require('../fixtures/flash-result-runtime.cjs');

runFlashResult({
  name: 'native-auto-mode',
  fixture: process.env.NATIVE_AUTO_MODE_SWF,
  resultCallback: 'nativeAutoModeResult',
  expectedPasses: 20,
  version: '34.0.0.384',
  timeoutMs: 60000,
});
