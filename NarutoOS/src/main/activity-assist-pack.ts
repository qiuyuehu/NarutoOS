import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

export const ACTIVITY_ASSIST_DIRECTORY = 'activity-assist-9.40Build300';
export const ACTIVITY_ASSIST_URL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.40Build300/flash/operatingActivity/OperatingActivityPlugin.swf';
const FILE = 'OperatingActivityPlugin.activity-assist.swf';
const LOCALIZED_FILE = 'OperatingActivityPlugin.activity-assist.zh-CN.swf';
const LOCALIZATION_ONLY_FILE = 'OperatingActivityPlugin.activity-assist.zh-CN-only.swf';

export type ActivityVariant = 'assist' | 'localized-assist' | 'localization-only';

// The plugin carries both assist code and activity translation. The four
// translation/assist combinations therefore need distinct files: using the combined
// one for "translation only" would keep the assist code alive after the master switch
// was turned off.
export function activityVariant(localization: boolean, assists: boolean): ActivityVariant | null {
  if (localization && assists) return 'localized-assist';
  if (assists) return 'assist';
  if (localization) return 'localization-only';
  return null;
}

export function readActivityAssistPack(directory: string, variant: ActivityVariant = 'assist') {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  if (manifest.id !== 'naruto-activity-assist-v1' || manifest.version !== '9.40Build300' ||
      manifest.resourceURL !== ACTIVITY_ASSIST_URL || manifest.file !== FILE ||
      manifest.baseSha256 !== '2b80bb73e8baf884f52ea029f38a59afd8358aeac14b1f4b26d562e73b23ea85') {
    throw new Error('活动辅助资源版本不匹配');
  }
  const chosen = variant === 'localized-assist'
    ? { file: manifest.localizedFile, sha256: manifest.localizedSha256, expected: LOCALIZED_FILE }
    : variant === 'localization-only'
      ? { file: manifest.localizationOnlyFile, sha256: manifest.localizationOnlySha256, expected: LOCALIZATION_ONLY_FILE }
      : { file: FILE, sha256: manifest.patchedSha256, expected: FILE };
  if (chosen.file !== chosen.expected) throw new Error('活动资源清单不匹配');
  const bytes = fs.readFileSync(path.join(directory, chosen.file));
  if (bytes.length < 8 || !/^[FCZ]WS$/.test(bytes.subarray(0, 3).toString()) || bytes[3] === 0 ||
      createHash('sha256').update(bytes).digest('hex') !== chosen.sha256) {
    throw new Error('活动资源与清单不一致');
  }
  return { url: ACTIVITY_ASSIST_URL, bytes, contentType: 'application/x-shockwave-flash', baseSha256: manifest.baseSha256 };
}
