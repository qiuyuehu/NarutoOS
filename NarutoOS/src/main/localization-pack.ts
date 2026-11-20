import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

// Single source of truth for the localization pack contract: the game resource
// versions the pack replaces and the validation applied before any replacement.
export const LOCALIZATION_RESOURCE_URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.19Build301/flash/hud/mainUI.swf';

type OverrideSpec = { id: string; url: string; file: string; contentType: string };

const LANGUAGE_TABLE_URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.33Build300/config/i18n/TranslatedKeyCFG.cfg';
const CREW_UI_URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.18Build300/flash/crew/CrewUI.swf';
const INFO_UI_URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha8.13Build300/flash/crew/infoUI.swf';
const ROLE_PROFILE_UI_URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha8.43Build300/flash/crew/roleProfileUI.swf';
const TASK_TRACK_UI_URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha6.93Build300/flash/task/ui.task.TrackPanel.swf';
const TASK_DETAIL_UI_URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha6.93Build300/flash/task/ui.task.swf';
const DAILY_TRAINING_UI_URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha6.93Build300/flash/hud/activityDashboard.swf';
const AI_MANAGE_UI_URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.39Build301/flash/ai/AIManageUI.swf';
const EQUIPMENT_UI_URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha8.10Build300/flash/equipment/EquipmentUI.swf';
const NINJA_ARCHIVE_URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.40Build300/config/archives/item1.pkg';
const NINJA_SKILL_DETAILS_URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.37Build301/config/skill/SkillKeyDescCFG.cfg';
const TALENT_UI_URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.05Build306/flash/majorRole/ui.talent.swf';
const NINJA_AID_SKILLS_URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.35Build301/config/ninjaAid/NinjaAidSkillCFG.cfg';
const BEAST_MONSTERS_URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.31Build300/config/throughTheBeast/SummonMonsterCFG.cfg';
const BEAST_SKILLS_URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.31Build300/config/throughTheBeast/BeastDevelopSkillCFG.cfg';
const MAJOR_ROLE_PLUGIN_URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha8.27Build302/flash/majorRole/MajorRolePlugin.swf';
const BEAST_UI_URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha6.93Build300/flash/throughTheBeast/throughTheBeastUI.swf';

export const LOCALIZATION_OVERRIDES: OverrideSpec[] = [
  { id: 'naruto-translated-key-cfg-zh-CN-v1', url: LANGUAGE_TABLE_URL, file: 'TranslatedKeyCFG.zh-CN.cfg', contentType: 'application/octet-stream' },
  { id: 'naruto-crew-ui-zh-CN-v1', url: CREW_UI_URL, file: 'CrewUI.zh-CN.swf', contentType: 'application/x-shockwave-flash' },
  { id: 'naruto-info-ui-zh-CN-v1', url: INFO_UI_URL, file: 'infoUI.zh-CN.swf', contentType: 'application/x-shockwave-flash' },
  { id: 'naruto-role-profile-ui-zh-CN-v1', url: ROLE_PROFILE_UI_URL, file: 'roleProfileUI.zh-CN.swf', contentType: 'application/x-shockwave-flash' },
  { id: 'naruto-task-track-ui-zh-CN-v1', url: TASK_TRACK_UI_URL, file: 'TrackPanel.zh-CN.swf', contentType: 'application/x-shockwave-flash' },
  { id: 'naruto-task-detail-ui-zh-CN-v1', url: TASK_DETAIL_UI_URL, file: 'ui.task.zh-CN.swf', contentType: 'application/x-shockwave-flash' },
  { id: 'naruto-daily-training-zh-CN-v1', url: DAILY_TRAINING_UI_URL, file: 'activityDashboard.zh-CN.swf', contentType: 'application/x-shockwave-flash' },
  { id: 'naruto-ai-manage-ui-zh-CN-v1', url: AI_MANAGE_UI_URL, file: 'AIManageUI.zh-CN.swf', contentType: 'application/x-shockwave-flash' },
  { id: 'naruto-equipment-ui-zh-CN-v1', url: EQUIPMENT_UI_URL, file: 'EquipmentUI.zh-CN.swf', contentType: 'application/x-shockwave-flash' },
  { id: 'naruto-talent-ui-zh-CN-v1', url: TALENT_UI_URL, file: 'ui.talent.zh-CN.swf', contentType: 'application/x-shockwave-flash' },
  { id: 'naruto-ninja-aid-skills-zh-CN-v1', url: NINJA_AID_SKILLS_URL, file: 'NinjaAidSkillCFG.zh-CN.cfg', contentType: 'application/octet-stream' },
  { id: 'naruto-beast-monsters-zh-CN-v1', url: BEAST_MONSTERS_URL, file: 'SummonMonsterCFG.zh-CN.cfg', contentType: 'application/octet-stream' },
  { id: 'naruto-beast-skills-zh-CN-v1', url: BEAST_SKILLS_URL, file: 'BeastDevelopSkillCFG.zh-CN.cfg', contentType: 'application/octet-stream' },
  { id: 'naruto-major-role-plugin-zh-CN-v1', url: MAJOR_ROLE_PLUGIN_URL, file: 'MajorRolePlugin.zh-CN.swf', contentType: 'application/x-shockwave-flash' },
  { id: 'naruto-beast-ui-zh-CN-v1', url: BEAST_UI_URL, file: 'throughTheBeastUI.zh-CN.swf', contentType: 'application/x-shockwave-flash' },
  { id: 'naruto-ninja-madara-final-valley-zh-CN-v1-archive', url: NINJA_ARCHIVE_URL, file: 'item1.madara-zh-CN.pkg', contentType: 'application/octet-stream' },
  { id: 'naruto-ninja-madara-final-valley-zh-CN-v1-skill-details', url: NINJA_SKILL_DETAILS_URL, file: 'SkillKeyDescCFG.madara-zh-CN.cfg', contentType: 'application/octet-stream' }
];

export type LocalizationResource = { url: string; bytes: Buffer; contentType: string };
export type LocalizationPack = { entryBytes: Buffer; resources: LocalizationResource[] };

export function isCfgxResource(url: string) {
  try { return /\.cfgx$/i.test(new URL(url).pathname); } catch { return false; }
}

/** PPAPI loads .cfgx from cache; use webRequest substitution instead of CDP Fetch. */
export function bridgeResources(resources: LocalizationResource[]) {
  return resources.filter(item => !isCfgxResource(item.url));
}

export function cfgxResources(resources: LocalizationResource[]) {
  return resources.filter(item => isCfgxResource(item.url));
}

// Reads and validates the pack, reporting the first contract breach so a broken
// pack is never silently dropped. Shared by the game host and the build check.
export function readLocalizationPack(directory: string): LocalizationPack {
  const pack = path.join(directory, 'pack');
  const manifest = JSON.parse(fs.readFileSync(path.join(pack, 'manifest.json'), 'utf8'));
  if (manifest.id !== 'naruto-hud-zh-CN-v1' || manifest.resourceURL !== LOCALIZATION_RESOURCE_URL) {
    throw new Error('汉化包版本不匹配');
  }
  const entryBytes = fs.readFileSync(path.join(pack, 'mainUI.zh-CN.swf'));
  if (!/^[FCZ]WS$/.test(entryBytes.subarray(0, 3).toString()) ||
      createHash('sha256').update(entryBytes).digest('hex') !== manifest.patchedSha256) {
    throw new Error('汉化包与清单不一致');
  }
  if (!Array.isArray(manifest.resourceOverrides) || manifest.resourceOverrides.length !== LOCALIZATION_OVERRIDES.length) {
    throw new Error('汉化资源清单不完整');
  }
  const foundIds = new Set<string>();
  const resources: LocalizationResource[] = [];
  for (const expected of LOCALIZATION_OVERRIDES) {
    const item = manifest.resourceOverrides.find((candidate: any) => candidate.id === expected.id);
    if (!item || foundIds.has(item.id) || item.resourceURL !== expected.url || item.file !== expected.file ||
        item.contentType !== expected.contentType) {
      throw new Error(`汉化资源清单不匹配：${expected.id}`);
    }
    foundIds.add(item.id);
    const itemBytes = fs.readFileSync(path.join(pack, expected.file));
    const hash = createHash('sha256').update(itemBytes).digest('hex');
    const validHeader = expected.contentType === 'application/x-shockwave-flash'
      ? /^[FCZ]WS$/.test(itemBytes.subarray(0, 3).toString())
      : itemBytes[0] === 0x78 || itemBytes[0] === 0xda;
    if (hash !== item.patchedSha256 || !validHeader) throw new Error(`汉化资源与清单不一致：${expected.id}`);
    resources.push({ url: expected.url, bytes: itemBytes, contentType: expected.contentType });
  }
  return { entryBytes, resources };
}
