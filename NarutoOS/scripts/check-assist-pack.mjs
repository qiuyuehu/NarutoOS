import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, '.test-artifacts/assist-pack-check/pack.cjs');
await mkdir(path.dirname(output), { recursive: true });
await build({ entryPoints: [path.join(root, 'src/main/assist-pack.ts')], outfile: output,
  bundle: true, platform: 'node', format: 'cjs', target: 'node12' });
const { readAssistPack } = await import(pathToFileURL(output).href);
const pack = readAssistPack(path.join(root, 'assets', 'assists'));
if (!pack.modules.length) throw new Error('内置辅助资源为空');
if (pack.rejected.length) throw new Error(`内置辅助资源不可用：${pack.rejected.map(item => `${item.moduleId}: ${item.reason}`).join('；')}`);
const summary = pack.modules.map(module => `${module.id}（${module.targets.map(target => `${target.region}/${target.build}`).join('、')}）`).join('，');
console.log(`辅助资源校验通过：${summary}`);
