import { createExitGuard, type ExitState } from './exit-guard';

type UpdateHandoffState = 'confirming' | 'cancelled' | 'saving' | 'save-failed' | 'closed';

interface ShutdownActions {
  confirmExit: () => Promise<boolean> | undefined;
  stopPolling: () => void;
  prepareExit: () => Promise<void>;
  saveSessions: () => Promise<void>;
  acknowledgeExit: () => Promise<unknown>;
  exit: () => void;
  paint: () => void;
  showSaveFailure: () => void;
  sendUpdateHandoff: (state: UpdateHandoffState) => Promise<unknown>;
}

export function createShutdown(actions: ShutdownActions) {
  let state: ExitState = 'running';
  let exitAttempt: Promise<void> | undefined;
  let exitPrepared = false;
  let updateHandoffRequested = false;
  const exitGuard = createExitGuard(actions.exit);

  async function reportUpdateHandoff(phase: UpdateHandoffState) {
    try { await actions.sendUpdateHandoff(phase); } catch { /* The centre aborts on timeout. */ }
  }

  function endUpdateHandoff(phase: 'cancelled' | 'save-failed') {
    if (updateHandoffRequested) {
      void reportUpdateHandoff(phase).then(() => { updateHandoffRequested = false; });
    }
  }

  function requestUpdateHandoff() {
    if (updateHandoffRequested || state === 'closed') return;
    updateHandoffRequested = true;
    void reportUpdateHandoff('confirming');
    void shutdown();
  }

  function shutdown(): Promise<void> {
    if (state === 'closed') return Promise.resolve();
    if (exitAttempt) return exitAttempt;
    exitAttempt = performShutdown().finally(() => { exitAttempt = undefined; });
    return exitAttempt;
  }

  async function performShutdown() {
    const firstAttempt = state === 'running';
    if (firstAttempt) {
      state = 'confirming';
      const confirmation = actions.confirmExit();
      if (confirmation && !await confirmation.catch(() => false)) {
        state = 'running';
        exitGuard.clear();
        actions.paint();
        endUpdateHandoff('cancelled');
        return;
      }
    }

    state = 'saving';
    if (firstAttempt) actions.stopPolling();
    actions.paint();
    if (updateHandoffRequested) void reportUpdateHandoff('saving');
    exitGuard.arm(() => state);
    try {
      if (!exitPrepared) {
        await actions.prepareExit();
        exitPrepared = true;
      }
      await actions.saveSessions();
      try { await actions.acknowledgeExit(); } catch { /* A dead host is reconciled on the next connection. */ }
      if (updateHandoffRequested) await reportUpdateHandoff('closed');
      state = 'closed';
      exitGuard.clear();
      actions.exit();
    } catch {
      state = 'save-failed';
      exitGuard.clear();
      actions.showSaveFailure();
      endUpdateHandoff('save-failed');
    }
  }

  return {
    shutdown,
    requestUpdateHandoff,
    get state() { return state; },
    get stopping() { return state !== 'running'; },
  };
}
