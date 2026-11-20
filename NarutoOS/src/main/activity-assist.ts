import { app } from 'electron';
import path from 'path';
import { BattleMemoryBridge } from './battle-memory-experiment';
import { ACTIVITY_ASSIST_DIRECTORY, activityVariant, readActivityAssistPack } from './activity-assist-pack';

export function createActivityAssist(project: string, localized = false, enabled = true) {
  const packaged = app.isPackaged;
  // Translation and assist are separate requests: translation-only must still load
  // its own file when the master assist switch is off.
  if (!enabled && !localized) return undefined;
  // Keep existing developer launchers working while the activity family grows.
  if (!packaged && enabled && process.env.NARUTO_ACTIVITY_ASSIST !== '1' && process.env.NARUTO_DAMO_ASSIST !== '1') return undefined;
  const data = path.resolve(app.getPath('userData'));
  if (!packaged && !data.startsWith(path.join(path.resolve(project), '.test-artifacts') + path.sep)) {
    throw new Error('开发态活动辅助仅允许在隔离数据目录中启用');
  }
  let resource: ReturnType<typeof readActivityAssistPack>;
  try {
    resource = readActivityAssistPack(path.join(project, packaged ? 'assets' : '.test-artifacts', ACTIVITY_ASSIST_DIRECTORY), activityVariant(localized, enabled) ?? 'assist');
  } catch (error) {
    // A missing or stale activity pack must never block startup, including when the
    // translation switch is the only one on in a development checkout.
    console.warn(`活动辅助资源不可用，沿用原版活动：${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
  const fallback = new BattleMemoryBridge(resource.url, resource.bytes, path.join(data, 'activity-assist/overrides'),
    () => {}, { patchId: 'naruto-activity-assist-v1', entryBaseSha256: resource.baseSha256 });
  return {
    resource,
    async attach(contents: Electron.WebContents, shared?: BattleMemoryBridge) {
      await (shared ?? fallback).attach(contents);
    }
  };
}
