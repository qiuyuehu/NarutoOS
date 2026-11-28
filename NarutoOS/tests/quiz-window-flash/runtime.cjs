const runFlashResult = require('../fixtures/flash-result-runtime.cjs');

runFlashResult({
  name: 'quiz-window-flash',
  fixture: process.env.QUIZ_WINDOW_SWF,
  resultCallback: 'quizWindowResult',
  expectedPasses: 6,
  version: '34.0.0.384',
});
