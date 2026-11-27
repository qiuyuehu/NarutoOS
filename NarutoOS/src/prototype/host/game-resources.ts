import { app } from 'electron';
import path from 'path';
import { loadActivityResources } from '../../main/activity-assist';
import { createAssistManager } from '../../main/assist-manager';
import { loadSpeedPatches } from '../../main/game-speed';
import { createGameLocalization } from '../../main/localization-experiment';
import type { ResourceOverride } from '../../main/battle-memory-experiment';
import type { Region } from '../../shared/model';

export function loadGameResources(project: string,
  options: { localization: boolean; assists: boolean; speed: boolean }, changed: () => void) {
  const activity = loadActivityResources(project, options.localization, options.assists);
  const speed = options.speed ? loadSpeedPatches(project) : [];
  const manager = createAssistManager(project, app.isPackaged, options.assists,
    path.join(app.getPath('userData'), 'assists'), changed, [...activity, ...speed]);
  const accepted = manager?.resources ?? [];
  const localization = createGameLocalization(project, options.localization, changed, accepted);
  const speedOverrides = new Map<Region, ResourceOverride>();
  for (const patch of speed) {
    if (patch.resource && accepted.includes(patch.resource)) speedOverrides.set(patch.region, patch.resource);
  }
  return { bridge: localization ?? manager?.bridge, localizationActive: !!localization,
    status: manager?.status() ?? null, speedOverrides };
}
