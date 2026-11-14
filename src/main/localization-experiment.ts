import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { BattleMemoryBridge } from './battle-memory-experiment';

const RESOURCE_URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.19Build301/flash/hud/mainUI.swf';
const LANGUAGE_TABLE_URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.33Build300/config/i18n/TranslatedKeyCFG.cfg';
const CREW_UI_URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.18Build300/flash/crew/CrewUI.swf';
const INFO_UI_URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha8.13Build300/flash/crew/infoUI.swf';
const ROLE_PROFILE_UI_URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha8.43Build300/flash/crew/roleProfileUI.swf';
const TASK_TRACK_UI_URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha6.93Build300/flash/task/ui.task.TrackPanel.swf';
const TASK_DETAIL_UI_URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha6.93Build300/flash/task/ui.task.swf';
const DAILY_TRAINING_UI_URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha6.93Build300/flash/hud/activityDashboard.swf';
const AI_MANAGE_UI_URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.39Build301/flash/ai/AIManageUI.swf';
const EQUIPMENT_UI_URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha8.10Build300/flash/equipment/EquipmentUI.swf';
const RESOURCE_OVERRIDES = [
  { id: 'naruto-translated-key-cfg-zh-CN-v1', url: LANGUAGE_TABLE_URL, file: 'TranslatedKeyCFG.zh-CN.cfg', contentType: 'application/octet-stream' },
  { id: 'naruto-crew-ui-zh-CN-v1', url: CREW_UI_URL, file: 'CrewUI.zh-CN.swf', contentType: 'application/x-shockwave-flash' },
  { id: 'naruto-info-ui-zh-CN-v1', url: INFO_UI_URL, file: 'infoUI.zh-CN.swf', contentType: 'application/x-shockwave-flash' },
  { id: 'naruto-role-profile-ui-zh-CN-v1', url: ROLE_PROFILE_UI_URL, file: 'roleProfileUI.zh-CN.swf', contentType: 'application/x-shockwave-flash' },
  { id: 'naruto-task-track-ui-zh-CN-v1', url: TASK_TRACK_UI_URL, file: 'TrackPanel.zh-CN.swf', contentType: 'application/x-shockwave-flash' },
  { id: 'naruto-task-detail-ui-zh-CN-v1', url: TASK_DETAIL_UI_URL, file: 'ui.task.zh-CN.swf', contentType: 'application/x-shockwave-flash' },
  { id: 'naruto-daily-training-zh-CN-v1', url: DAILY_TRAINING_UI_URL, file: 'activityDashboard.zh-CN.swf', contentType: 'application/x-shockwave-flash' },
  { id: 'naruto-ai-manage-ui-zh-CN-v1', url: AI_MANAGE_UI_URL, file: 'AIManageUI.zh-CN.swf', contentType: 'application/x-shockwave-flash' },
  { id: 'naruto-equipment-ui-zh-CN-v1', url: EQUIPMENT_UI_URL, file: 'EquipmentUI.zh-CN.swf', contentType: 'application/x-shockwave-flash' },
  { id: 'naruto-ninja-madara-final-valley-zh-CN-v1-archive', url: 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.37Build301/config/archives/item1.pkg', file: 'item1.madara-zh-CN.pkg', contentType: 'application/octet-stream' },
  { id: 'naruto-ninja-madara-final-valley-zh-CN-v1-skill-details', url: 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.37Build301/config/skill/SkillKeyDescCFG.cfg', file: 'SkillKeyDescCFG.madara-zh-CN.cfg', contentType: 'application/octet-stream' }
];

export function createGameLocalization(root: string, enabled: boolean, changed: () => void,
  additionalOverrides: { url: string; bytes: Buffer; contentType: string }[] = []) {
  return enabled ? loadLocalization(root, changed, true, additionalOverrides) : undefined;
}

export function createLocalizationExperiment(root: string, changed: () => void) {
  if (process.env.NARUTO_LOCALIZATION_EXPERIMENT !== '1') return undefined;
  return loadLocalization(root, changed, false);
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
  let original = !production && process.env.NARUTO_LOCALIZATION_ORIGINAL === '1';
  if (!original) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'pack/manifest.json'), 'utf8'));
      if (manifest.id !== 'naruto-hud-zh-CN-v1' || manifest.resourceURL !== RESOURCE_URL) throw new Error('汉化包版本不匹配');
      bytes = fs.readFileSync(path.join(directory, 'pack/mainUI.zh-CN.swf'));
      if (!/^[FCZ]WS$/.test(bytes.subarray(0, 3).toString()) || createHash('sha256').update(bytes).digest('hex') !== manifest.patchedSha256) throw new Error('汉化包与清单不一致');
      if (!Array.isArray(manifest.resourceOverrides) || manifest.resourceOverrides.length !== RESOURCE_OVERRIDES.length) {
        throw new Error('汉化资源清单不完整');
      }
      const foundIds = new Set<string>();
      for (const expected of RESOURCE_OVERRIDES) {
        const item = manifest.resourceOverrides.find((candidate: any) => candidate.id === expected.id);
        if (!item || foundIds.has(item.id) || item.resourceURL !== expected.url || item.file !== expected.file ||
            item.contentType !== expected.contentType) throw new Error('汉化资源清单不匹配');
        foundIds.add(item.id);
        const itemBytes = fs.readFileSync(path.join(directory, 'pack', expected.file));
        const hash = createHash('sha256').update(itemBytes).digest('hex');
        const validHeader = expected.id === 'naruto-translated-key-cfg-zh-CN-v1' || expected.id.startsWith('naruto-ninja-madara-final-valley-zh-CN-v1-')
          ? itemBytes[0] === 0x78
          : /^[FCZ]WS$/.test(itemBytes.subarray(0, 3).toString());
        if (hash !== item.patchedSha256 || !validHeader) throw new Error('汉化资源与清单不一致');
        resourceOverrides.push({ url: expected.url, bytes: itemBytes, contentType: expected.contentType });
      }
    } catch {
      if (production) { console.warn('汉化资源不可用，使用原文。'); return undefined; }
      if (bundled) throw new Error('汉化实验包资源缺失或校验失败');
      original = true;
      console.warn('汉化实验包不可用，使用原文；继续保留隔离测试账号。');
    }
  }
  const receipts = path.join(receiptBase, original ? 'receipts-original' : 'receipts-localized');
  fs.mkdirSync(receipts, { recursive: true, mode: 0o700 });
  return new BattleMemoryBridge(RESOURCE_URL, bytes, receipts, changed,
    { patchId: 'naruto-hud-zh-CN-v1', observeOnly: original, observeTiming: !production,
      observeNinjaRequests: !production && process.env.NARUTO_LOCALIZATION_TRACE_NINJA_REQUESTS === '1', resourceOverrides: [...resourceOverrides, ...additionalOverrides] });
}
