import fs from 'fs';
import path from 'path';
import { BattleMemoryBridge, ResourceOverride } from './battle-memory-experiment';
import { readAssistPack } from './assist-pack';

// One owner for every bundled assist module: it collects the override resources
// a game session needs, rejects conflicting or broken packs, and hands out the
// single debugger bridge that session may use.
export type AssistModuleState = 'ready' | 'unavailable' | 'conflict';
export type AssistModuleStatus = { id: string; nameKey?: string; state: AssistModuleState; reason?: string; regions: string[]; builds: string[] };
export type AssistManagerStatus = { enabled: boolean; bridge: boolean; resources: number; modules: AssistModuleStatus[];
  rejected: { moduleId: string; reason: string }[] };

const PATCH_ID = 'naruto-assists-v1';

export class AssistManager {
  readonly resources: ResourceOverride[];
  readonly bridge?: BattleMemoryBridge;
  readonly statuses: AssistModuleStatus[];
  readonly rejected: { moduleId: string; reason: string }[];

  constructor(private readonly root: string, private readonly packaged: boolean, enabled: boolean,
    receipts: string, changed: () => void, extra: ResourceOverride[] = []) {
    const directory = path.join(root, packaged ? 'assets/assists' : '.test-artifacts/assists');
    const modules: AssistModuleStatus[] = [];
    const rejected: { moduleId: string; reason: string }[] = [];
    const resources: ResourceOverride[] = [];
    const claimed = new Map<string, string>();
    if (!enabled) {
      this.resources = [];
      this.statuses = modules;
      this.rejected = rejected;
      return;
    }
    let pack = undefined;
    try {
      pack = readAssistPack(directory);
    } catch (error) {
      rejected.push({ moduleId: '(manifest)', reason: error instanceof Error ? error.message : String(error) });
    }
    if (pack) {
      for (const module of pack.modules) {
        const conflicts = module.targets.filter(target => claimed.has(target.identity));
        if (conflicts.length) {
          modules.push({ id: module.id, nameKey: module.nameKey, state: 'conflict', regions: [], builds: [],
            reason: `资源已被其他模块占用：${conflicts.map(item => item.identity).join('、')}` });
          continue;
        }
        for (const target of module.targets) {
          claimed.set(target.identity, module.id);
          resources.push({ url: target.url, bytes: target.bytes, contentType: target.contentType, baseSha256: target.baseSha256 });
        }
        modules.push({ id: module.id, nameKey: module.nameKey, state: 'ready',
          regions: [...new Set(module.targets.map(target => target.region))],
          builds: [...new Set(module.targets.map(target => target.build))] });
      }
      rejected.push(...pack.rejected);
    }
    for (const resource of extra) {
      try {
        const identity = new URL(resource.url);
        const key = identity.origin + identity.pathname;
        if (claimed.has(key)) {
          rejected.push({ moduleId: '(activity-assist)', reason: `资源冲突：${key} 已属于 ${claimed.get(key)}` });
          continue;
        }
        claimed.set(key, '(activity-assist)');
        resources.push(resource);
      } catch {
        rejected.push({ moduleId: '(activity-assist)', reason: '资源 URL 无效' });
      }
    }
    this.resources = resources;
    this.statuses = modules;
    this.rejected = rejected;
    for (const item of rejected) console.warn(`辅助模块不可用：${item.moduleId}：${item.reason}`);
    if (resources.length) {
      this.bridge = new BattleMemoryBridge(resources[0].url, resources[0].bytes, receipts, changed,
        { patchId: PATCH_ID, entryBaseSha256: resources[0].baseSha256, resourceOverrides: resources.slice(1) });
    }
  }

  get enabled() { return this.resources.length > 0; }

  status(): AssistManagerStatus {
    return { enabled: this.enabled, bridge: !!this.bridge, resources: this.resources.length,
      modules: this.statuses, rejected: this.rejected };
  }

  attach(contents: Electron.WebContents) {
    return this.bridge ? this.bridge.attach(contents) : Promise.resolve();
  }

}

export function createAssistManager(root: string, packaged: boolean, enabled: boolean, receipts: string,
  changed: () => void, extra: ResourceOverride[] = []): AssistManager | undefined {
  if (!enabled) return undefined;
  try {
    return new AssistManager(root, packaged, enabled, receipts, changed, extra);
  } catch (error) {
    // An optional assist module must never stop the launcher from starting.
    console.warn(`辅助模块初始化失败：${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

export function assistDirectory(root: string, packaged: boolean) {
  return path.join(root, packaged ? 'assets/assists' : '.test-artifacts/assists');
}

export function assistsPresent(root: string, packaged: boolean) {
  try {
    return fs.statSync(assistDirectory(root, packaged)).isDirectory();
  } catch { return false; }
}
