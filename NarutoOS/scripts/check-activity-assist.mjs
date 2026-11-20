import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, '.test-artifacts/activity-assist-check/pack.cjs');
await mkdir(path.dirname(output), { recursive: true });
await build({ entryPoints: [path.join(root, 'src/main/activity-assist-pack.ts')], outfile: output,
  bundle: true, platform: 'node', format: 'cjs', target: 'node12' });
const { readActivityAssistPack, ACTIVITY_ASSIST_DIRECTORY } = await import(pathToFileURL(output).href);
const directory = path.join(root, 'assets', ACTIVITY_ASSIST_DIRECTORY);
const assist = readActivityAssistPack(directory, 'assist');
const combined = readActivityAssistPack(directory, 'localized-assist');
const translationOnly = readActivityAssistPack(directory, 'localization-only');
if (translationOnly.bytes.equals(combined.bytes)) throw new Error('仅汉化产物不能沿用辅助加汉化文件');
console.log(`活动资源校验通过：辅助 ${assist.bytes.length} 字节，辅助+汉化 ${combined.bytes.length} 字节，仅汉化 ${translationOnly.bytes.length} 字节`);
