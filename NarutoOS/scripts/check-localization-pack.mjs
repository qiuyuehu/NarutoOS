// Validates the shipped localization pack before it is packaged, using the same
// contract reader the game host runs. A stale manifest entry fails here instead
// of silently disabling every replacement at runtime.
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, '.test-artifacts/localization-pack-check/pack.cjs');
await mkdir(path.dirname(output), { recursive: true });
await build({ entryPoints: [path.join(root, 'src/main/localization-pack.ts')], outfile: output, bundle: true, platform: 'node', format: 'cjs', target: 'node12' });
const { readLocalizationPack } = await import(pathToFileURL(output).href);
try {
  const pack = readLocalizationPack(path.join(root, 'assets/localization'));
  console.log(`汉化资源清单校验通过：${pack.resources.length + 1} 项，mainUI ${pack.entryBytes.length} 字节`);
} catch (error) {
  console.error(`汉化资源清单校验失败：${error.message}`);
  process.exitCode = 1;
}
