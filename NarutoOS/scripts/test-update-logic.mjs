// Targeted update-contract checks. Compiles the shared Swift module together
// with its test harness; no network access and no production release source.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const project = path.resolve(import.meta.dirname, '..');
const artifacts = path.join(project, '.test-artifacts/update-logic');
fs.rmSync(artifacts, { recursive: true, force: true });
fs.mkdirSync(artifacts, { recursive: true });
const target = (process.arch === 'arm64' ? 'arm64' : 'x86_64') + '-apple-macos15.0';
const moduleCache = path.join(project, 'dist/swift-module-cache');
fs.mkdirSync(moduleCache, { recursive: true });
const swiftc = (output, files) => execFileSync('/usr/bin/xcrun', ['swiftc', '-target', target, '-O', '-module-cache-path', moduleCache, ...files, '-o', output], { stdio: 'inherit', cwd: project });
const binary = path.join(artifacts, 'update-tests');
swiftc(binary, [
  'src/prototype/native/Transport.swift',
  'src/prototype/native/I18n.swift',
  'src/prototype/native/Update.swift',
  'tests/update-tests.swift'
]);
// A real x86_64 Mach-O fixture for the architecture reader.
const source = path.join(artifacts, 'x86.c');
fs.writeFileSync(source, 'int main(void){return 0;}\n');
const x86 = path.join(artifacts, 'x86-fixture');
execFileSync('/usr/bin/xcrun', ['clang', '-target', 'x86_64-apple-macos15.0', source, '-o', x86], { stdio: 'inherit' });
const output = execFileSync(binary, ['--self-test'], {
  encoding: 'utf8',
  env: { ...process.env, NARUTO_C_MESSAGES: path.join(project, 'src/shared/messages.json'), NARUTO_TEST_X86_BINARY: x86 }
});
process.stdout.write(output);
const passes = (output.match(/^PASS /gm) || []).length;
const failures = (output.match(/^FAIL /gm) || []).length;
if (failures > 0) throw new Error(failures + ' update contract checks failed');
if (passes < 50) throw new Error('expected at least 50 checks, got ' + passes);
// ZIP link pre-scan: safe relative links pass, absolute or escaping links fail.
const zipDir = path.join(artifacts, 'zips');
fs.mkdirSync(zipDir, { recursive: true });
function runZipCheck(name, zipPath) {
  let output = '';
  try {
    output = execFileSync(binary, ['--zip-check', zipPath], { encoding: 'utf8', env: { ...process.env, NARUTO_C_MESSAGES: path.join(project, 'src/shared/messages.json') } });
  } catch (error) {
    output = String(error.stdout || '');
  }
  const line = output.trim().split('\n').filter(row => row.startsWith('{')).pop() || '{}';
  return { name, result: JSON.parse(line) };
}
const safeDir = path.join(zipDir, 'safe');
fs.mkdirSync(safeDir, { recursive: true });
fs.writeFileSync(path.join(safeDir, 'file.txt'), 'synthetic');
fs.symlinkSync('file.txt', path.join(safeDir, 'link'));
const safeZip = path.join(zipDir, 'safe.zip');
execFileSync('/usr/bin/zip', ['-q', '-y', safeZip, 'file.txt', 'link'], { cwd: safeDir });
const checks = [runZipCheck('safe-relative-link', safeZip)];
for (const [name, target] of [['absolute-link', '/etc/passwd'], ['escaping-link', '../../etc/passwd']]) {
  const directory = path.join(zipDir, name);
  fs.mkdirSync(directory, { recursive: true });
  fs.symlinkSync(target, path.join(directory, 'evil'));
  const zipPath = path.join(zipDir, name + '.zip');
  execFileSync('/usr/bin/zip', ['-q', '-y', zipPath, 'evil'], { cwd: directory });
  checks.push(runZipCheck(name, zipPath));
}
const safeCheck = checks[0];
if (!safeCheck.result.ok) throw new Error('safe relative symlink was rejected: ' + JSON.stringify(safeCheck.result));
for (const item of checks.slice(1)) {
  if (item.result.ok || item.result.error !== 'update.extract_failed') {
    throw new Error(item.name + ' was not rejected: ' + JSON.stringify(item.result));
  }
}
// The actual release archive must pass the same pre-scan (UTF-8 bundle names).
// Archives live in release/ so the project root stays clean; validate the newest one.
const releaseDir = path.join(project, 'release');
const versionOf = name => /^NarutoOS-(\d+)\.(\d+)\.(\d+)-macOS-AppleSilicon\.zip$/.exec(name)?.slice(1).map(Number);
const releaseZip = fs.existsSync(releaseDir)
  ? fs.readdirSync(releaseDir).filter(versionOf).sort((a, b) => {
      const va = versionOf(a), vb = versionOf(b);
      for (let i = 0; i < 3; i++) if (va[i] !== vb[i]) return vb[i] - va[i];
      return 0;
    })[0]
  : undefined;
if (releaseZip) {
  const real = runZipCheck('real-release-archive', path.join(releaseDir, releaseZip));
  if (!real.result.ok) throw new Error('real release archive rejected: ' + JSON.stringify(real.result));
  checks.push(real);
}
for (const item of checks) console.log('PASS zip link check: ' + item.name);
fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify({ ok: true, passes: passes + checks.length, failures, zipChecks: checks }, null, 2));
console.log('更新逻辑检查通过：' + (passes + checks.length) + ' 项');