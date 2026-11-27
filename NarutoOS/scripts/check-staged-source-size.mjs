import { execFileSync } from 'node:child_process';

const limit = 20_000;
const sourceFile = /\.(?:tsx?|[cm]?js|jsx|css|html|swift|c|cc|cpp|h|hpp|m|mm)$/;
const raw = execFileSync('git', [
  'diff', '--cached', '--raw', '-z', '--relative', '--no-abbrev', '--find-renames',
  '--diff-filter=ACMRT', '--', 'src', 'native',
], { encoding: 'utf8' });
const fields = raw.split('\0');
const changes = [];
const objects = new Set();

for (let index = 0; fields[index];) {
  const [oldMode, newMode, oldBlob, newBlob, status] = fields[index++].slice(1).split(' ');
  let file = fields[index++];
  if (/^[RC]/.test(status)) file = fields[index++];
  if (!newMode.startsWith('100') || !sourceFile.test(file) || file.startsWith('native/game-speed/fishhook/')) continue;

  const previous = oldMode.startsWith('100') && !status.startsWith('C') ? oldBlob : undefined;
  changes.push({ file, previous, staged: newBlob });
  if (previous) objects.add(previous);
  objects.add(newBlob);
}

if (objects.size) {
  const sizes = execFileSync('git', ['cat-file', '--batch-check=%(objectsize)'], {
    input: [...objects].join('\n') + '\n', encoding: 'utf8',
  }).trimEnd().split('\n');
  const bytes = new Map([...objects].map((blob, index) => [blob, Number(sizes[index])]));
  for (const { file, previous, staged } of changes) {
    const size = bytes.get(staged);
    if (size > limit && size > (bytes.get(previous) ?? 0)) {
      console.warn(`源码大小提示 ${file}（${size} 字节，上限 ${limit} 字节），建议按职责拆分。`);
    }
  }
}
