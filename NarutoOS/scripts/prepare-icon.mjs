// Lay out the original artwork with deterministic macOS padding and vector corners.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, copyFile, access } from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
const source = path.resolve('assets/app-icon-source.png');
if (process.argv[2]) {
  await mkdir('assets', { recursive: true });
  await copyFile(path.resolve(process.argv[2]), source, constants.COPYFILE_EXCL);
}
await access(source);
await mkdir('.test-artifacts', { recursive: true });
const temporary = await mkdtemp(path.resolve('.test-artifacts/icon-'));
const master = path.resolve('assets/app-icon-macos.png');
execFileSync('/usr/bin/xcrun', ['swift', 'scripts/render-icon.swift', source, master], { stdio: 'inherit' });
const iconset = path.join(temporary, 'NarutoOS.iconset');
await mkdir(iconset);
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const pixels = size * scale;
    execFileSync('/usr/bin/sips', ['--resampleHeightWidth', String(pixels), String(pixels), master, '--out',
      path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)], { stdio: 'ignore' });
  }
}
await copyFile(master, 'assets/app-icon.png');
execFileSync('/usr/bin/iconutil', ['--convert', 'icns', '--output', 'assets/app-icon.icns', iconset]);
console.log('macOS 图标已转换：16–1024px，保留圆角与透明边距，原图另存。');
