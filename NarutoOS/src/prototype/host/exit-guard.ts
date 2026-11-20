export type ExitState = 'running' | 'confirming' | 'saving' | 'save-failed' | 'closed';

// A shutdown that hangs while saving may be force-finished, but only after the
// user confirmed quitting. Cancelling the dialog or a failed save must disarm the
// timer, otherwise the force exit would bypass the session-save protection.
export function createExitGuard(forceExit: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    // Keychain authorisation can sit on screen waiting for the user; a short
    // fallback would kill a running game while that prompt is still open.
    arm(state: () => ExitState, delay = 60000) {
      this.clear();
      timer = setTimeout(() => {
        timer = undefined;
        if (state() === 'saving') forceExit();
      }, delay);
    },
    clear() {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
    get armed() {
      return timer !== undefined;
    }
  };
}
