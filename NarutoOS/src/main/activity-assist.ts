import { app } from 'electron';
import path from 'path';
import { BattleMemoryBridge } from './battle-memory-experiment';
import type { AssistExtraResourceLoadResult } from './assist-manager';
import { ACTIVITY_ASSIST_DIRECTORY, ACTIVITY_ASSIST_URL, activityVariant, readActivityAssistPack } from './activity-assist-pack';

const ACTIVITY_MODULE_ID = 'naruto-activity-assist-v1';

// 仅返回本地活动资源的加载结果；页面桥接由宿主统一创建，确保每页只挂接一次。
export function loadActivityResources(project: string, localized = false, enabled = true): AssistExtraResourceLoadResult[] {
  // Translation and assist are separate requests: translation-only must still load
  // its own file when the master assist switch is off.
  const variant = activityVariant(localized, enabled);
  if (!variant) return [];
  // Keep existing developer launchers working while the activity family grows.
  if (!app.isPackaged && enabled && process.env.NARUTO_ACTIVITY_ASSIST !== '1' && process.env.NARUTO_DAMO_ASSIST !== '1') return [];

  const packaged = app.isPackaged;
  if (!packaged) {
    const data = path.resolve(app.getPath('userData'));
    if (!data.startsWith(path.join(path.resolve(project), '.test-artifacts') + path.sep)) {
      throw new Error('开发态活动辅助仅允许在隔离数据目录中启用');
    }
  }

  const base = { moduleId: ACTIVITY_MODULE_ID, region: 'br' as const, variant, target: ACTIVITY_ASSIST_URL };
  try {
    const resource = readActivityAssistPack(
      path.join(project, packaged ? 'assets' : '.test-artifacts', ACTIVITY_ASSIST_DIRECTORY), variant,
    );
    return [{ ...base, resource }];
  } catch (error) {
    return [{ ...base, failure: error instanceof Error ? error.message : String(error) }];
  }
}

// Kept for the dedicated Damo experiment entry, whose standalone path predates the
// host's shared resource manager. Production host code consumes loadActivityResources.
export function createActivityAssist(project: string, localized = false, enabled = true) {
  const result = loadActivityResources(project, localized, enabled)[0];
  if (!result) return undefined;
  if (!result.resource) {
    console.warn(`活动辅助资源不可用，沿用原版活动：${result.failure}`);
    return undefined;
  }
  const data = path.resolve(app.getPath('userData'));
  const fallback = new BattleMemoryBridge(result.resource.url, result.resource.bytes,
    path.join(data, 'activity-assist/overrides'), () => {},
    { patchId: result.moduleId, entryBaseSha256: result.resource.baseSha256 });
  return {
    resource: result.resource,
    async attach(contents: Electron.WebContents, shared?: BattleMemoryBridge) {
      await (shared ?? fallback).attach(contents);
    },
  };
}
