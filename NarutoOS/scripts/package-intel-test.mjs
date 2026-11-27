import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const project = path.resolve(import.meta.dirname, '..');
process.chdir(project);
const { version } = JSON.parse(await fs.readFile('package.json', 'utf8'));
const staging = path.resolve('release/builds.noindex');
await fs.mkdir(staging, { recursive: true });
const directory = await fs.mkdtemp(path.join(staging, `NarutoOS-${version}-intel-`));
const env = { ...process.env, NARUTO_BUILD_TARGET: 'intel-test', NARUTO_INTEL_BUILD_DIR: directory };
const run = (command, args) => execFileSync(command, args, { env, stdio: 'inherit' });
for (const script of ['build.mjs', 'build-native-prototype.mjs', 'package-native.mjs']) {
  run(process.execPath, [`scripts/${script}`]);
}

const name = `NarutoOS-${version}-macOS-Intel-Test.zip`;
const archive = path.join(directory, name);
run('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--keepParent', path.join(directory, 'Naruto OS.app'), archive]);
const extracted = await fs.mkdtemp(path.join(os.tmpdir(), 'naruto-intel-zip-'));
try {
  run('/usr/bin/ditto', ['-x', '-k', archive, extracted]);
  run('/usr/bin/python3', ['scripts/check-intel-app.py', path.join(extracted, 'Naruto OS.app'), version]);
} finally {
  await fs.rm(extracted, { recursive: true, force: true });
}
const delivery = path.resolve('release/intel-test', name);
await fs.mkdir(path.dirname(delivery), { recursive: true });
await fs.rename(archive, delivery);
console.log(delivery);
