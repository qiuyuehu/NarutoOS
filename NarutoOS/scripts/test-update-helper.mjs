// Isolated replacement checks for the independent updater helper. Synthetic
// applications and a throw-away install target are created under .test-artifacts;
// no real application, account data or release source is touched.
import fs from 'node:fs';
import path from 'node:path';
import { updateSourcePaths } from './update-sources.mjs';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
const project = path.resolve(import.meta.dirname, '..');
const artifacts = path.join(project, '.test-artifacts/update-helper');
fs.rmSync(artifacts, { recursive: true, force: true });
fs.mkdirSync(artifacts, { recursive: true });
const moduleCache = path.join(project, 'dist/swift-module-cache');
fs.mkdirSync(moduleCache, { recursive: true });
const channels = {
  appleSilicon: { name: 'AppleSilicon', arch: 'arm64', marker: false, suffix: '-macOS-AppleSilicon.zip' },
  intelTest: { name: 'Intel-Test', arch: 'x86_64', marker: true, suffix: '-macOS-Intel-Test.zip' }
};
const updaterBinaries = {};
for (const [key, channel] of Object.entries(channels)) {
  const output = path.join(artifacts, 'updater-' + channel.arch);
  execFileSync('/usr/bin/xcrun', ['swiftc', '-target', channel.arch + '-apple-macos15.0', '-O', '-module-cache-path', moduleCache,
    'src/prototype/native/Transport.swift', 'src/prototype/native/I18n.swift', ...updateSourcePaths, 'src/prototype/native/Updater.swift',
    '-o', output], { stdio: 'inherit', cwd: project });
  updaterBinaries[key] = output;
}
function canExecuteArch(arch) {
  try { execFileSync('/usr/bin/arch', ['-' + arch, '/usr/bin/true'], { stdio: 'ignore' }); return true; }
  catch { return false; }
}
const intelExecutionAvailable = canExecuteArch('x86_64');
const armExecutionAvailable = canExecuteArch('arm64');
const messages = path.join(project, 'src/shared/messages.json');
const results = [];
function check(name, ok, detail = '') {
  if (!ok) throw new Error(name + (detail ? ': ' + detail : ''));
  results.push(name);
  console.log('PASS ' + name);
}
function compileC(source, output, arch) {
  const file = output + '.c';
  fs.writeFileSync(file, source);
  execFileSync('/usr/bin/xcrun', ['clang', '-target', arch + '-apple-macos15.0', '-O2', file, '-o', output], { stdio: 'inherit' });
  return output;
}
function plist(values) {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">', '<plist version="1.0"><dict>'];
  for (const [key, value] of Object.entries(values)) {
    lines.push('<key>' + key + '</key>' + (value === true ? '<true/>' : '<string>' + value + '</string>'));
  }
  lines.push('</dict></plist>');
  return lines.join('\n');
}
const binDirectory = path.join(artifacts, 'bin');
fs.mkdirSync(binDirectory, { recursive: true });
const noopArm = compileC('int main(void){return 0;}\n', path.join(binDirectory, 'noop-arm'), 'arm64');
const noopX86 = compileC('int main(void){return 0;}\n', path.join(binDirectory, 'noop-x86'), 'x86_64');
const nativeUpdaterKey = process.arch === 'x64' ? 'intelTest' : 'appleSilicon';
const confirmSource = (file, updateID, target) => '#include <stdio.h>\nint main(void){FILE*f=fopen("' + file + '","w");if(f){fputs("{\\"updateID\\":\\"' + updateID + '\\",\\"version\\":\\"9.9.9\\",\\"targetApp\\":\\"' + target + '\\"}",f);fclose(f);}return 0;}\n';
function makeApplication(appPath, version, outerExecutable, options = {}) {
  const extraAbsoluteLink = options.extraAbsoluteLink === true;
  const channelKey = options.channelKey || nativeUpdaterKey;
  const channel = channels[channelKey];
  fs.rmSync(appPath, { recursive: true, force: true });
  const contents = path.join(appPath, 'Contents');
  fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
  const appInfo = {
    CFBundleDisplayName: 'Naruto OS', CFBundleName: 'Naruto OS', CFBundleExecutable: 'Naruto OS',
    CFBundleIdentifier: 'cn.youye.naruto-os', CFBundleShortVersionString: version, CFBundleVersion: version,
    CFBundlePackageType: 'APPL', LSMinimumSystemVersion: '15.0'
  };
  if (channel.marker) appInfo.NarutoOSIntelTest = true;
  fs.writeFileSync(path.join(contents, 'Info.plist'), plist(appInfo));
  fs.copyFileSync(outerExecutable, path.join(contents, 'MacOS/Naruto OS'));
  const gameApp = path.join(contents, 'Helpers/Naruto OS 游戏.app');
  fs.mkdirSync(path.join(gameApp, 'Contents/MacOS'), { recursive: true });
  fs.writeFileSync(path.join(gameApp, 'Contents/Info.plist'), plist({
    CFBundleDisplayName: 'Naruto OS 游戏', CFBundleName: 'Naruto OS 游戏', CFBundleExecutable: 'Naruto OS 游戏',
    CFBundleIdentifier: 'cn.youye.naruto-os.game', CFBundleShortVersionString: version, CFBundleVersion: version,
    CFBundlePackageType: 'APPL'
  }));
  fs.copyFileSync(noopX86, path.join(gameApp, 'Contents/MacOS/Naruto OS 游戏'));
  const resources = path.join(contents, 'Resources/app');
  const files = [
    'build-info.json', 'package.json', 'dist/shared/messages.json', 'dist/prototype/host.js',
    'dist/prototype/host-preload.js', 'dist/prototype/toolbar.html', 'dist/prototype/launcher/index.html',
    'dist/prototype/native/core', 'dist/prototype/native/updater'
  ];
  for (const file of files) fs.mkdirSync(path.dirname(path.join(resources, file)), { recursive: true });
  fs.writeFileSync(path.join(resources, 'build-info.json'), JSON.stringify({ version, buildID: crypto.randomUUID() }));
  fs.writeFileSync(path.join(resources, 'package.json'), JSON.stringify({ name: 'naruto-os', version }));
  for (const file of files.slice(2)) fs.writeFileSync(path.join(resources, file), '');
  fs.copyFileSync(channel.arch === 'arm64' ? noopArm : noopX86, path.join(resources, 'dist/prototype/native/core'));
  fs.copyFileSync(updaterBinaries[channelKey], path.join(resources, 'dist/prototype/native/updater'));
  if (extraAbsoluteLink) fs.symlinkSync(path.join(appPath, 'Contents/MacOS/Naruto OS'), path.join(contents, 'Resources/absolute-link'));
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath], { stdio: 'inherit' });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
}
function writeRecord(root, values) {
  const updateRoot = path.join(root, 'update');
  const taskDir = path.join(updateRoot, values.id);
  fs.mkdirSync(taskDir, { recursive: true });
  const record = {
    schema: 1, updateID: values.id, fromVersion: values.fromVersion, toVersion: values.toVersion,
    targetApp: path.join(root, 'Applications/Naruto OS.app'),
    stagingDir: path.join(root, 'Applications/.NarutoOS-update-' + values.id),
    stagingApp: path.join(root, 'Applications/.NarutoOS-update-' + values.id + '/Naruto OS.app'),
    backupApp: path.join(root, 'Applications/.NarutoOS-backup-' + values.id),
    taskDir, updateRoot, downloadFile: path.join(taskDir, 'package.zip'),
    updaterPath: path.join(taskDir, 'naruto-updater'), messagesPath: path.join(taskDir, 'messages.json'),
    language: 'zh-CN', releaseID: 1, assetID: 2, assetName: 'NarutoOS-' + values.toVersion + channels[values.channelKey || nativeUpdaterKey].suffix, tag: 'v' + values.toVersion,
    centerPID: values.centerPID || 0, hostPID: 0, corePID: 0,
    centerExecutable: values.centerExecutable || '', hostExecutable: '', coreExecutable: '',
    stage: 'prepared', detail: '', createdAt: new Date().toISOString()
  };
  fs.copyFileSync(updaterBinaries[values.channelKey || nativeUpdaterKey], record.updaterPath);
  fs.chmodSync(record.updaterPath, 0o700);
  fs.copyFileSync(messages, record.messagesPath);
  fs.writeFileSync(record.downloadFile, 'synthetic package');
  const recordPath = path.join(updateRoot, 'task.json');
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));
  return { record, recordPath };
}
function prepareScenario(name, { oldVersion = '1.0.0', newVersion = '9.9.9', confirm = true, postMoveInvalidSymlink = false, channelKey = nativeUpdaterKey, stagingChannelKey = channelKey, recordOverrides = {} } = {}) {
  const root = path.join(artifacts, name);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'Applications'), { recursive: true });
  const oldApp = path.join(root, 'Applications/Naruto OS.app');
  const channel = channels[channelKey];
  const oldExecutable = channel.arch === 'arm64' ? noopArm : noopX86;
  makeApplication(oldApp, oldVersion, oldExecutable, { channelKey });
  const id = crypto.randomUUID();
  const updateRoot = path.join(root, 'update');
  const confirmFile = path.join(updateRoot, 'confirm.json');
  const newApp = path.join(root, 'Applications/.NarutoOS-update-' + id + '/Naruto OS.app');
  const targetApp = path.join(root, 'Applications/Naruto OS.app');
  const stagingChannel = channels[stagingChannelKey];
  const newExecutable = confirm ? compileC(confirmSource(confirmFile, id, targetApp), path.join(binDirectory, 'confirm-' + id), stagingChannel.arch) : oldExecutable;
  // A link that resolves inside the staging root but escapes once the bundle
  // moves: the post-move re-verification must restore the previous version.
  makeApplication(newApp, newVersion, newExecutable, { extraAbsoluteLink: postMoveInvalidSymlink, channelKey: stagingChannelKey });
  const { record, recordPath } = writeRecord(root, { id, fromVersion: recordOverrides.fromVersion || oldVersion, toVersion: newVersion, channelKey, ...recordOverrides });
  return { root, oldApp, newApp, record, recordPath };
}
function runUpdater(recordPath, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    const intel = record.assetName.includes('-Intel-Test.zip');
    const command = intel && process.arch !== 'x64' ? '/usr/bin/arch' : record.updaterPath;
    const args = command === '/usr/bin/arch' ? ['-x86_64', record.updaterPath, recordPath] : [recordPath];
    const child = spawn(command, args, {
      env: { ...process.env, NARUTO_UPDATE_TEST: '1', NARUTO_UPDATE_NO_UI: '1', NARUTO_C_MESSAGES: record.messagesPath, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    child.stdout.on('data', () => {});
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('updater timeout ' + stderr)); }, 60000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stderr }); });
  });
}
function versionOf(appPath) {
  return execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', path.join(appPath, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
}
function readResult(root) {
  const file = path.join(root, 'update/result.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
try {
  // 1. Successful replacement with launch confirmation and cleanup.
  {
    const scenario = prepareScenario('success');
    const { code, stderr } = await runUpdater(scenario.recordPath);
    check('success: helper exits cleanly', code === 0, stderr);
    check('success: new version installed', versionOf(scenario.oldApp) === '9.9.9');
    const result = readResult(scenario.root);
    check('success: result recorded', result && result.status === 'success');
    check('success: backup removed', !fs.existsSync(scenario.record.backupApp));
    check('success: staging removed', !fs.existsSync(scenario.record.stagingDir));
    check('success: task directory removed', !fs.existsSync(scenario.record.taskDir));
    check('success: confirmation removed', !fs.existsSync(path.join(scenario.root, 'update/confirm.json')));
  }
  // 2a. The new application launches but never confirms: keep the old backup
  // and report a manual-recovery failure instead of silently downgrading.
  {
    const scenario = prepareScenario('launch-unconfirmed', { confirm: false });
    const { code, stderr } = await runUpdater(scenario.recordPath);
    check('unconfirmed launch: helper reports failure', code === 1, stderr);
    check('unconfirmed launch: new version kept running', versionOf(scenario.oldApp) === '9.9.9');
    const result = readResult(scenario.root);
    check('unconfirmed launch: result recorded', result && result.status === 'failure' && result.stage === 'launched');
    check('unconfirmed launch: previous backup kept', fs.existsSync(scenario.record.backupApp));
    check('unconfirmed launch: task record kept', fs.existsSync(scenario.recordPath));
  }
  // 2b. A launch failure after the swap restores the previous version.
  {
    const scenario = prepareScenario('restore', { confirm: true });
    const { code, stderr } = await runUpdater(scenario.recordPath, { NARUTO_UPDATE_TEST_FAIL_LAUNCH: '1' });
    check('restore: helper reports failure', code === 1, stderr);
    check('restore: previous version restored', versionOf(scenario.oldApp) === '1.0.0');
    const result = readResult(scenario.root);
    check('restore: result recorded', result && result.status === 'failure' && result.stage === 'restored');
    check('restore: backup no longer exists', !fs.existsSync(scenario.record.backupApp));
    check('restore: staging cleaned', !fs.existsSync(scenario.record.stagingDir));
    check('restore: task directory cleaned', !fs.existsSync(scenario.record.taskDir));
  }
  // 3. Old process never exits: abort before touching the target.
  {
    const scenario = prepareScenario('process-timeout');
    const sleeper = spawn('/bin/sleep', ['30'], { stdio: 'ignore' });
    const record = JSON.parse(fs.readFileSync(scenario.recordPath, 'utf8'));
    record.centerPID = sleeper.pid;
    record.centerExecutable = '/bin/sleep';
    record.stage = 'prepared';
    fs.writeFileSync(scenario.recordPath, JSON.stringify(record, null, 2));
    const { code, stderr } = await runUpdater(scenario.recordPath);
    sleeper.kill('SIGKILL');
    check('process timeout: helper reports failure', code === 1, stderr);
    check('process timeout: target untouched', versionOf(scenario.oldApp) === '1.0.0');
    const result = readResult(scenario.root);
    check('process timeout: result recorded', result && result.status === 'failure' && result.stage === 'failed');
    check('process timeout: staging cleaned', !fs.existsSync(scenario.record.stagingDir));
  }
  // 4. The installed version changed before the helper ran.
  {
    const scenario = prepareScenario('target-changed', { recordOverrides: { fromVersion: '0.0.1' } });
    const { code, stderr } = await runUpdater(scenario.recordPath);
    check('target changed: helper reports failure', code === 1, stderr);
    check('target changed: target untouched', versionOf(scenario.oldApp) === '1.0.0');
    const result = readResult(scenario.root);
    check('target changed: result recorded', result && result.status === 'failure');
  }
  // 5. Staging content is invalid: abort before touching the target.
  {
    const scenario = prepareScenario('staging-invalid');
    fs.rmSync(scenario.newApp, { recursive: true, force: true });
    const { code, stderr } = await runUpdater(scenario.recordPath);
    check('staging invalid: helper reports failure', code === 1, stderr);
    check('staging invalid: target untouched', versionOf(scenario.oldApp) === '1.0.0');
    check('staging invalid: staging cleaned', !fs.existsSync(scenario.record.stagingDir));
  }
  // Run the replacement helper as each architecture. On Apple Silicon, arch
  // forces the x86_64 helper through Rosetta when it is installed.
  for (const channelKey of ['appleSilicon', 'intelTest']) {
    const channel = channels[channelKey];
    const canRun = channel.arch === 'arm64' ? armExecutionAvailable : intelExecutionAvailable;
    if (!canRun) {
      console.log('SKIP helper execution ' + channel.name + ': architecture runtime unavailable');
      continue;
    }
    if (channelKey === nativeUpdaterKey) continue; // The main scenarios already execute this helper.
    const scenario = prepareScenario('cross-arch-success-' + channelKey, { channelKey });
    const { code, stderr } = await runUpdater(scenario.recordPath);
    check(channel.name + ' helper executes replacement', code === 0, stderr);
    check(channel.name + ' helper leaves matching bundle installed', versionOf(scenario.oldApp) === '9.9.9');
    const result = readResult(scenario.root);
    check(channel.name + ' helper records successful replacement', result && result.status === 'success');
  }
  // A package for the other architecture must be refused before the current
  // installation is moved, even when its signature and bundle structure pass.
  for (const [targetChannel, wrongPackageChannel] of [['appleSilicon', 'intelTest'], ['intelTest', 'appleSilicon']]) {
    const canRun = targetChannel === 'appleSilicon' ? armExecutionAvailable : intelExecutionAvailable;
    if (!canRun) continue;
    const scenario = prepareScenario('wrong-architecture-' + targetChannel, {
      channelKey: targetChannel, stagingChannelKey: wrongPackageChannel
    });
    const { code, stderr } = await runUpdater(scenario.recordPath);
    check(channels[targetChannel].name + ' helper rejects ' + channels[wrongPackageChannel].name + ' package', code === 1, stderr);
    check(channels[targetChannel].name + ' wrong package leaves old app untouched', versionOf(scenario.oldApp) === '1.0.0');
  }
  fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify({ ok: true, results }, null, 2));
  console.log('更新替换流程检查通过：' + results.length + ' 项');
} catch (error) {
  fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify({ ok: false, results, error: String(error) }, null, 2));
  console.error(error);
  process.exitCode = 1;
}
