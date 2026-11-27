const runFlashResult = require('../fixtures/flash-result-runtime.cjs');

runFlashResult({
  name: 'grocery-native-flash',
  fixture: process.env.GROCERY_NATIVE_SWF,
  resultCallback: 'groceryFixtureResult',
  expectedPasses: 25,
  version: '34.0.0.384',
});
