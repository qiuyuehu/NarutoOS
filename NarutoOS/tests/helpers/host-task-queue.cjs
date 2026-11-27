// Existing source fixtures exercise the production queue with synthetic host services.
function loadTaskQueue() {
  const esbuild = require('esbuild');
  const Module = require('node:module');
  const filename = require('node:path').resolve('src/prototype/host/task-queue.ts');
  const bundle = esbuild.buildSync({
    entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', write: false,
  });
  const loader = new Module(filename);
  loader._compile(bundle.outputFiles[0].text, filename);
  return loader.exports.TaskQueue;
}

function attachTaskQueue(ctx, TaskQueue) {
  const taskQueue = new TaskQueue({
    get games() { return ctx.games; },
    get login() { return ctx.login; },
    get loginPages() { return ctx.loginPages; },
    get navigation() { return ctx.navigation; },
    isShuttingDown: () => ctx.shutting,
    get fixture() { return ctx.fixture; },
    core: (...args) => ctx.core(...args),
    report: (...args) => ctx.report?.(...args),
    clearNotice: (...args) => ctx.clearNotice?.(...args),
    paint: () => ctx.paint?.(),
    persist: () => ctx.persist?.(),
    poll: () => ctx.poll?.(),
    shutdown: () => ctx.shutdown?.(),
    focusExisting: id => ctx.focusExisting?.(id),
    hostEvent: (...args) => ctx.hostEvent?.(...args),
    clearPendingSave: task => ctx.clearPendingSave?.(task),
  });
  // Seed existing fixture states without exposing production setters.
  for (const field of ['tasks', 'queue', 'recoveryQueue', 'executing', 'executingRecovery', 'recoveryAwait', 'executionIdle']) {
    if (field in ctx) taskQueue[field] = ctx[field];
  }
  if (ctx.executeNext) taskQueue.executeNext = () => ctx.executeNext();
  ctx.taskQueue = taskQueue;
  return taskQueue;
}

module.exports = { attachTaskQueue, loadTaskQueue };
