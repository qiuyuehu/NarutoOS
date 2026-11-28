const runFlashResult = require('../fixtures/flash-result-runtime.cjs');

runFlashResult({
  name: 'expedition-reset-label-flash',
  fixture: process.env.EXPEDITION_RESET_LABEL_SWF,
  resultCallback: 'expeditionResetLabelResult',
  expectedPasses: 5,
  version: '34.0.0.384',
});
