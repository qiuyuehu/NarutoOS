// Private local macOS package using the already verified Electron distribution.
// Only an exclusive new output directory is written. No installer/system changes.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, cp, copyFile, rename, rm, readdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
if (process.platform !== 'darwin') throw new Error('此打包脚本只适用于 macOS');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
for (const file of ['assets/app-icon.icns', 'assets/app-icon.png', 'dist/main/index.js', 'dist/native/keychain', 'dist/native/traffic-lights.node', 'dist/native/Naruto Login.app/Contents/MacOS/WebLogin',
  'runtime/flash-34/PepperFlashPlayer.plugin/Contents/MacOS/PepperFlashPlayer', 'runtime/flash-31/PepperFlashPlayer.plugin/Contents/MacOS/PepperFlashPlayer']) await access(file);
// Spotlight must not present intermediate bundles as installed applications.
await mkdir('release/builds.noindex', { recursive: true });
const directory = await mkdtemp(path.resolve('release/builds.noindex', `NarutoOS-${pkg.version}-local-`));
const app = path.join(directory, 'Naruto OS.app');
const electronApp = path.resolve(electron, '../../..');
if (path.basename(electronApp) !== 'Electron.app') throw new Error('未找到 Electron 应用模板');
execFileSync('/usr/bin/ditto', [electronApp, app]);
const contents = path.join(app, 'Contents');
const plist = path.join(contents, 'Info.plist');
function set(file, key, value) { execFileSync('/usr/bin/plutil', ['-replace', key, '-string', value, file]); }
function get(file, key) { return execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', file], { encoding: 'utf8' }).trim(); }
await rename(path.join(contents, 'MacOS/Electron'), path.join(contents, 'MacOS/Naruto OS'));
for (const [key, value] of Object.entries({ CFBundleDisplayName: 'Naruto OS', CFBundleName: 'Naruto OS', CFBundleExecutable: 'Naruto OS',
  CFBundleIdentifier: 'cn.youye.naruto-os', CFBundleShortVersionString: pkg.version, CFBundleVersion: pkg.version, CFBundleIconFile: 'naruto-os.icns',
  LSApplicationCategoryType: 'public.app-category.games' })) set(plist, key, value);
const frameworks = path.join(contents, 'Frameworks');
const helperApps = [];
for (const name of await readdir(frameworks)) {
  if (!/^Electron Helper(?: \([A-Za-z]+\))?\.app$/.test(name)) continue;
  const old = path.join(frameworks, name), nextName = name.replace(/^Electron Helper/, 'Naruto OS Helper');
  const helperPlist = path.join(old, 'Contents/Info.plist');
  // Electron 11 helper plists omit CFBundleExecutable and use CFBundleName.
  const executable = get(helperPlist, 'CFBundleName');
  const nextExecutable = executable.replace(/^Electron Helper/, 'Naruto OS Helper');
  await rename(path.join(old, 'Contents/MacOS', executable), path.join(old, 'Contents/MacOS', nextExecutable));
  const kind = (name.match(/\(([A-Za-z]+)\)/)?.[1] || 'main').toLowerCase();
  for (const [key, value] of Object.entries({ CFBundleDisplayName: nextExecutable, CFBundleName: nextExecutable, CFBundleExecutable: nextExecutable,
    CFBundleIdentifier: `cn.youye.naruto-os.helper.${kind}` })) set(helperPlist, key, value);
  const next = path.join(frameworks, nextName); await rename(old, next); helperApps.push(next);
}
const resources = path.join(contents, 'Resources');
// Remove only the copied Electron demo so it cannot shadow the application.
await rm(path.join(resources, 'default_app.asar'), { force: true });
await copyFile('assets/app-icon.icns', path.join(resources, 'naruto-os.icns'));
const application = path.join(resources, 'app'); await mkdir(application);
await writeFile(path.join(application, 'package.json'), JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, main: pkg.main, private: true }, null, 2));
for (const file of ['main/index.js', 'preload/game.js', 'preload/shell.js', 'renderer/app.js', 'renderer/index.html', 'renderer/style.css', 'renderer/lobby.css', 'renderer/zhiyan-br.png', 'renderer/zhiyan-cn.png', 'renderer/lobby-art-br.png', 'renderer/lobby-art-cn.webp', 'native/keychain', 'native/traffic-lights.node']) {
  const target = path.join(application, 'dist', file); await mkdir(path.dirname(target), { recursive: true }); await copyFile(path.join('dist', file), target);
}
for (const name of ['embedded-login.node', 'libnaruto-login.dylib']) await copyFile(path.join('dist/native', name), path.join(application, 'dist/native', name));
const loginApp = path.join(application, 'dist/native/embedded-login.node');
execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', path.join(application, 'dist/native/libnaruto-login.dylib')], { stdio: 'inherit' });
await mkdir(path.join(application, 'assets'));
await copyFile('assets/app-icon.png', path.join(application, 'assets/app-icon.png'));
for (const version of ['34', '31']) await cp(path.join('runtime', `flash-${version}`), path.join(application, 'runtime', `flash-${version}`), { recursive: true });
  await writeFile(path.join(application, 'build-info.json'), JSON.stringify({ version: pkg.version, builtAt: new Date().toISOString(), electron: '11.5.0', architecture: 'x64', directByDefault: false, modernBrazilLogin: true }, null, 2));
// The Electron 11 distribution includes unsigned auxiliary frameworks. Sign
// only copied host code; Flash keeps its original vendor signature.
for (const name of await readdir(frameworks)) {
  if (name.endsWith('.framework')) execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', path.join(frameworks, name)], { stdio: 'inherit' });
}
for (const code of [path.join(application, 'dist/native/keychain'), path.join(application, 'dist/native/traffic-lights.node'), loginApp, ...helperApps, app]) {
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', code], { stdio: 'inherit' });
}
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });
await writeFile('release/latest-package.json', JSON.stringify({ app, directory, version: pkg.version }, null, 2));
console.log(JSON.stringify({ app, directory, version: pkg.version }));
