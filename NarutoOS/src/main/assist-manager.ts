import fs from 'fs';
import path from 'path';
import { BattleMemoryBridge, ResourceOverride } from './battle-memory-experiment';
import { readAssistPack } from './assist-pack';

// One owner for every bundled assist module: it collects the override resources
// a game session needs, rejects conflicting or broken packs, and hands out the
// single debugger bridge that session may use.
export type AssistModuleState = 'ready' | 'unavailable' | 'conflict';
export type AssistModuleStatus = { id: string; nameKey?: string; state: AssistModuleState; reason?: string; regions: string[]; builds: string[] };
export type AssistExtraResourceLoadResult = { moduleId: string; region: 'br' | 'cn'; variant?: string; target: string }
  & ({ resource: ResourceOverride; failure?: never } | { resource?: never; failure: string });
export type AssistExtraResourceState = 'accepted' | 'unavailable' | 'conflict';
export type AssistExtraResourceStatus = { moduleId: string; region: 'br' | 'cn'; variant?: string; target: string;
  state: AssistExtraResourceState; reason?: string; occupiedBy?: string };
export type AssistManagerStatus = { enabled: boolean; bridge: boolean; resources: number; modules: AssistModuleStatus[];
  rejected: { moduleId: string; reason: string }[]; extraResources: AssistExtraResourceStatus[] };

const PATCH_ID = 'naruto-assists-v1';

export class AssistManager {
  readonly enabled: boolean;
  readonly resources: ResourceOverride[];
  readonly bridge?: BattleMemoryBridge;
  readonly statuses: AssistModuleStatus[];
  readonly rejected: { moduleId: string; reason: string }[];
  readonly extraResources: AssistExtraResourceStatus[];

  constructor(root: string, packaged: boolean, enabled: boolean,
    receipts: string, changed: () => void, extra: AssistExtraResourceLoadResult[] = []) {
    this.enabled = enabled;
    const modules: AssistModuleStatus[] = [];
    const rejected: { moduleId: string; reason: string }[] = [];
    const extraResources: AssistExtraResourceStatus[] = [];
    const resources: ResourceOverride[] = [];
    const claimed = new Map<string, string>();
    let pack = undefined;
    if (enabled) {
      try {
        pack = readAssistPack(assistDirectory(root, packaged));
      } catch (error) {
        rejected.push({ moduleId: '(manifest)', reason: error instanceof Error ? error.message : String(error) });
      }
    }
    if (pack) {
      for (const module of pack.modules) {
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
    for (const item of extra) {
      const detail = { moduleId: item.moduleId, region: item.region, ...(item.variant ? { variant: item.variant } : {}), target: item.target };
      if ('failure' in item) {
        const reason = item.failure;
        extraResources.push({ ...detail, state: 'unavailable', reason });
        rejected.push({ moduleId: item.moduleId, reason: `${item.target}：${reason}` });
        continue;
      }
      try {
        const identity = new URL(item.resource.url);
        const key = identity.origin + identity.pathname;
        if (claimed.has(key)) {
          const occupiedBy = claimed.get(key)!;
          const reason = `资源冲突：${key}；${item.moduleId} 与 ${occupiedBy}`;
          extraResources.push({ ...detail, state: 'conflict', reason, occupiedBy });
          rejected.push({ moduleId: item.moduleId, reason });
          continue;
        }
        claimed.set(key, item.moduleId);
        resources.push(item.resource);
        extraResources.push({ ...detail, state: 'accepted' });
      } catch (error) {
        const reason = `资源 URL 无效：${error instanceof Error ? error.message : String(error)}`;
        extraResources.push({ ...detail, state: 'unavailable', reason });
        rejected.push({ moduleId: item.moduleId, reason: `${item.target}：${reason}` });
      }
    }
    this.resources = resources;
    this.statuses = modules;
    this.rejected = rejected;
    this.extraResources = extraResources;
    if (resources.length) {
      try {
        this.bridge = new BattleMemoryBridge(resources[0].url, resources[0].bytes, receipts, changed,
          { patchId: PATCH_ID, entryBaseSha256: resources[0].baseSha256, resourceOverrides: resources.slice(1) });
      } catch (error) {
        // The localization bridge can still serve the accepted resources.
        rejected.push({ moduleId: PATCH_ID, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    for (const item of rejected) console.warn(`辅助模块不可用：${item.moduleId}：${item.reason}`);
  }

  status(): AssistManagerStatus {
    return { enabled: this.enabled, bridge: !!this.bridge, resources: this.resources.length,
      modules: this.statuses, rejected: this.rejected, extraResources: this.extraResources };
  }

  attach(contents: Electron.WebContents) {
    return this.bridge ? this.bridge.attach(contents) : Promise.resolve();
  }

}

export function createAssistManager(root: string, packaged: boolean, enabled: boolean, receipts: string,
  changed: () => void, extra: AssistExtraResourceLoadResult[] = []): AssistManager | undefined {
  if (!enabled && !extra.length) return undefined;
  try {
    return new AssistManager(root, packaged, enabled, receipts, changed, extra);
  } catch (error) {
    // An optional assist module must never stop the launcher from starting.
    console.warn(`辅助模块初始化失败：${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

export function assistDirectory(root: string, packaged: boolean) {
  const development = path.join(root, '.test-artifacts/assists');
  if (!packaged && fs.existsSync(path.join(development, 'manifest.json'))) return development;
  return path.join(root, 'assets/assists');
}
