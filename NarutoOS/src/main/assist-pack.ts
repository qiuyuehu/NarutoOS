import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

// Read and validate the bundled assist manifest. Each module is validated on
// its own so one broken or unknown target never disables the others.
export type AssistRegion = 'br' | 'cn';

export type AssistTarget = {
  region: AssistRegion;
  build: string;
  url: string;
  file: string;
  sha256: string;
  baseSha256: string;
  contentType: string;
};

export type AssistTargetResource = AssistTarget & { bytes: Buffer; identity: string };

export type AssistModule = { id: string; nameKey: string; targets: AssistTargetResource[] };

export type AssistRejection = { moduleId: string; reason: string };

export type AssistPack = { modules: AssistModule[]; rejected: AssistRejection[] };

const MANIFEST_ID = 'naruto-assists-v1';
const MANIFEST_VERSION = 1;
const MAX_BYTES = 64 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const BUILD = /^[A-Za-z0-9._-]{1,64}$/;

function inside(directory: string, relative: unknown): string {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error('资源路径无效');
  const resolved = path.resolve(directory, relative);
  if (!resolved.startsWith(path.resolve(directory) + path.sep)) throw new Error('资源路径越界');
  return resolved;
}

function resourceURL(value: unknown): string {
  const url = new URL(String(value));
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error('资源 URL 无效');
  return url.origin + url.pathname;
}

function targetIdentity(url: string): string {
  const parsed = new URL(url);
  return parsed.origin + parsed.pathname;
}

export function readAssistPack(directory: string): AssistPack {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  if (!manifest || manifest.id !== MANIFEST_ID || manifest.version !== MANIFEST_VERSION || !Array.isArray(manifest.modules)) {
    throw new Error('辅助清单版本不匹配');
  }
  type PendingTarget = { region: AssistRegion; build: string; url: string; file: string; sha256: string; baseSha256: string; contentType: string };
  const rejected: AssistRejection[] = [];
  const seenModules = new Set<string>();
  // Validate each module completely first. A module that fails never takes part in
  // conflict detection and never reserves a resource for the ones that follow.
  const validated: Array<{ id: string; nameKey: string; targets: (PendingTarget & { bytes: Buffer; identity: string })[] }> = [];
  for (const definition of manifest.modules) {
    const moduleId = typeof definition?.id === 'string' ? definition.id : '';
    try {
      if (!moduleId || seenModules.has(moduleId)) throw new Error('模块标识缺失或重复');
      if (typeof definition.nameKey !== 'string' || !/^ui\.[A-Za-z0-9_.]+$/.test(definition.nameKey)) throw new Error('模块名称键无效');
      if (!Array.isArray(definition.targets) || definition.targets.length === 0) throw new Error('模块没有已登记目标');
      const targets: (PendingTarget & { bytes: Buffer; identity: string })[] = [];
      for (const item of definition.targets) {
        const region: AssistRegion = item?.region === 'cn' ? 'cn' : item?.region === 'br' ? 'br' : (() => { throw new Error('目标地区无效'); })();
        if (typeof item.build !== 'string' || !BUILD.test(item.build)) throw new Error('构建标识无效');
        const url = resourceURL(item.url);
        if (typeof item.sha256 !== 'string' || !HASH.test(item.sha256)) throw new Error('补丁摘要无效');
        if (typeof item.baseSha256 !== 'string' || !HASH.test(item.baseSha256)) throw new Error('原版摘要无效');
        if (typeof item.contentType !== 'string' || !/^application\/[a-z0-9.+*-]+$/.test(item.contentType)) throw new Error('内容类型无效');
        const file = inside(directory, item.file);
        const stat = fs.statSync(file);
        if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('资源文件无效');
        const bytes = fs.readFileSync(file);
        if (createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error('补丁摘要不匹配');
        if (!/^[FCZ]WS$/.test(bytes.subarray(0, 3).toString('latin1'))) throw new Error('补丁不是 SWF 资源');
        targets.push({ region, build: item.build, url, file: item.file, sha256: item.sha256, baseSha256: item.baseSha256,
          contentType: item.contentType, bytes, identity: targetIdentity(url) });
      }
      seenModules.add(moduleId);
      validated.push({ id: moduleId, nameKey: definition.nameKey, targets });
    } catch (error) {
      rejected.push({ moduleId: moduleId || '(unknown)', reason: error instanceof Error ? error.message : String(error) });
    }
  }
  // Only modules that could actually load compete for a resource. Sharing one means
  // the whole group is rejected; keeping the first loader would make the active
  // patch depend on manifest order.
  const owners = new Map<string, Set<string>>();
  for (const entry of validated) for (const target of entry.targets) {
    const set = owners.get(target.identity) ?? new Set<string>();
    set.add(entry.id);
    owners.set(target.identity, set);
  }
  const conflicted = new Map<string, string>();
  for (const [identity, ids] of owners) {
    if (ids.size < 2) continue;
    const names = [...ids].join('、');
    for (const id of ids) conflicted.set(id, `资源冲突：${identity} 同时被 ${names} 声明`);
  }
  const modules: AssistModule[] = [];
  for (const entry of validated) {
    const reason = conflicted.get(entry.id);
    if (reason) { rejected.push({ moduleId: entry.id, reason }); continue; }
    modules.push({ id: entry.id, nameKey: entry.nameKey, targets: entry.targets });
  }
  return { modules, rejected };
}
