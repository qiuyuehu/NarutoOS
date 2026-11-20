import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { BattleMemoryBridge } from './battle-memory-experiment';
import { LOCALIZATION_RESOURCE_URL, bridgeResources, cfgxResources, readLocalizationPack } from './localization-pack';

export function createGameLocalization(root: string, enabled: boolean, changed: () => void,
  additionalOverrides: { url: string; bytes: Buffer; contentType: string }[] = []) {
  return enabled ? loadLocalization(root, changed, true, additionalOverrides) : undefined;
}

export function createLocalizationExperiment(root: string, changed: () => void) {
  if (process.env.NARUTO_LOCALIZATION_EXPERIMENT !== '1') return undefined;
  return loadLocalization(root, changed, false);
}

function recordUnavailable(receipts: string, reason: string) {
  try {
    fs.mkdirSync(receipts, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(receipts, `${Date.now()}-unavailable.json`),
      JSON.stringify({ time: new Date().toISOString(), kind: 'unavailable', patchId: 'naruto-hud-zh-CN-v1', reason }, null, 2),
      { mode: 0o600 });
  } catch {}
}

function loadLocalization(root: string, changed: () => void, production: boolean,
  additionalOverrides: { url: string; bytes: Buffer; contentType: string }[] = []) {
  if (!production && process.env.NARUTO_BATTLE_MEMORY_EXPERIMENT === '1') throw new Error('请单独启动汉化小样');
  const bundled = app.isPackaged && process.env.NARUTO_LOCALIZATION_BUNDLED_EXPERIMENT === '1';
  const userData = path.resolve(app.getPath('userData'));
  const expectedPackagedUserData = path.join(app.getPath('appData'), 'Naruto OS Localization Experiment');
  if (!production && (app.isPackaged ? !bundled || userData !== expectedPackagedUserData
    : !userData.startsWith(path.join(root, '.test-artifacts') + path.sep))) {
    throw new Error('汉化小样只能使用项目隔离测试资料');
  }
  const directory = production ? path.join(root, 'assets/localization') : bundled ? path.join(root, 'localization-experiment') : path.join(root, '.test-artifacts/localization-2026-11-03');
  const receiptBase = production ? path.join(userData, 'localization') : bundled ? path.join(userData, 'localization-experiment') : directory;
  let bytes = Buffer.alloc(0);
  let resourceOverrides: { url: string; bytes: Buffer; contentType: string }[] = [];
  let cfgxOverrides: { url: string; bytes: Buffer; contentType: string }[] = [];
  let original = !production && process.env.NARUTO_LOCALIZATION_ORIGINAL === '1';
  if (!original) {
    try {
      const pack = readLocalizationPack(directory);
      bytes = pack.entryBytes;
      resourceOverrides = bridgeResources(pack.resources);
      cfgxOverrides = cfgxResources(pack.resources);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (production) {
        console.warn(`汉化资源不可用，使用原文：${reason}`);
        recordUnavailable(path.join(receiptBase, 'receipts-unavailable'), reason);
        return undefined;
      }
      if (bundled) throw new Error(`汉化实验包资源缺失或校验失败：${reason}`);
      original = true;
      console.warn(`汉化实验包不可用，使用原文；继续保留隔离测试账号：${reason}`);
    }
  }
  const receipts = path.join(receiptBase, original ? 'receipts-original' : 'receipts-localized');
  fs.mkdirSync(receipts, { recursive: true, mode: 0o700 });
  return new BattleMemoryBridge(LOCALIZATION_RESOURCE_URL, bytes, receipts, changed,
    { patchId: 'naruto-hud-zh-CN-v1', observeOnly: original, observeTiming: !production,
      observeNinjaRequests: !production && process.env.NARUTO_LOCALIZATION_TRACE_NINJA_REQUESTS === '1',
      resourceOverrides: [...resourceOverrides, ...additionalOverrides], cfgxOverrides });
}
