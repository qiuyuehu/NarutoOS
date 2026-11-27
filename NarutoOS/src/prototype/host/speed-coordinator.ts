import { msg } from '../../shared/i18n';
import type { ResourceOverrideStatus } from '../../main/battle-memory-experiment';
import type { GameTab } from '../../main/game';
import { speedPolicy } from '../../main/game-speed';

export const SPEED_RETRY_MS = 2000;

type SpeedTab = Pick<GameTab, 'state' | 'view'>;
type SpeedDependencies = {
  enabled: boolean;
  rememberedRate: unknown;
  getTabs: () => readonly SpeedTab[] | undefined;
  trackedStatus: (contents: Electron.WebContents) => ResourceOverrideStatus | undefined;
  isShuttingDown: () => boolean;
  now: () => number;
  pushSpeed: (rate: number) => number;
  saveRate: (rate: number) => Promise<unknown>;
  report: (message: string, kind?: 'error') => void;
  hostEvent: (kind: string, detail: Record<string, unknown>) => void;
  paint: () => void;
};

function normalizeRate(value: unknown) {
  return Math.max(1, Math.min(10, Math.round(Number(value) || 1)));
}

export function createSpeedCoordinator({
  enabled, rememberedRate, getTabs, trackedStatus, isShuttingDown, now, pushSpeed, saveRate, report, hostEvent, paint,
}: SpeedDependencies) {
  const remembered = normalizeRate(rememberedRate);
  let rate = 1;
  let autoRaise = remembered > 1;
  let restoreRate = 0;
  let suspended = false;
  let mismatchReported = false;
  let attemptAt = 0;

  function currentSpeedDecision(tabs = getTabs() ?? []) {
    const activePages = tabs.filter(tab => !tab.view.webContents.isDestroyed()).map(tab => {
      const status = trackedStatus(tab.view.webContents) ?? 'pending';
      return tab.state === 'ready' || status === 'mismatch' ? status : 'pending';
    });
    // The first observation locks this host session, including observations from the UI.
    if (activePages.includes('mismatch')) suspended = true;
    return speedPolicy({ activePages, suspended, rate });
  }

  function menuState() {
    return { rate, allowRaise: currentSpeedDecision().allowRaise };
  }

  function toolbarState() {
    return { available: enabled, rate, allowRaise: enabled && currentSpeedDecision().allowRaise };
  }

  // 插件可能晚于页面出现，也可能重启。周期补发当前允许的档位。
  function applySpeed() {
    if (!enabled || isShuttingDown()) return;
    const tabs = getTabs();
    if (!tabs) return;
    const decision = currentSpeedDecision(tabs);
    if (decision.revertToOne) {
      const leavingRate = rate;
      rate = 1;
      if (suspended) {
        restoreRate = 0;
        autoRaise = false;
        if (!mismatchReported) {
          mismatchReported = true;
          report(msg('ui.speed_resource_mismatch_reverted'), 'error');
        }
      } else {
        restoreRate = leavingRate;
        autoRaise = true;
      }
      attemptAt = 0;
      hostEvent('speed-revert', { suspended });
      paint();
    }
    if ((!getTabs()?.length && !decision.revertToOne) || now() - attemptAt < SPEED_RETRY_MS) return;
    attemptAt = now();
    const target = decision.allowRaise && autoRaise ? (restoreRate || remembered) : rate;
    if (pushSpeed(target) > 0 && target !== rate) {
      rate = target;
      autoRaise = false;
      restoreRate = 0;
      hostEvent(target === remembered ? 'speed-restore' : 'speed-rate', { rate: target });
      paint();
    }
  }

  // 同档选择也取消自动恢复。实际投递成功后才更新生效档位并尝试记忆。
  async function setSpeed(requestedRate: number) {
    if (!enabled) return;
    const chosen = normalizeRate(requestedRate);
    autoRaise = false;
    restoreRate = 0;
    if (rate === chosen) { paint(); return; }
    const decision = currentSpeedDecision();
    if (chosen > 1 && !decision.allowRaise) { report(msg('ui.speed_resource_mismatch_reverted'), 'error'); paint(); return; }
    if (pushSpeed(chosen) === 0) { report(msg('ui.speed_plugin_not_running')); paint(); return; }
    rate = chosen;
    attemptAt = now();
    hostEvent('speed-rate', { rate: chosen });
    try { await saveRate(chosen); } catch { /* 偏好保存失败不影响本次切换。 */ }
    paint();
  }

  return { applySpeed, setSpeed, toolbarState, menuState };
}
