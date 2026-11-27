import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { mkdir, cp, stat, rename, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { clangTargetArgs, distDir, embeddedLoginSwiftTargetArgs, installNameArgs, swiftTargetArgs } from './build-target.mjs';
import { webLoginSources } from './web-login-sources.mjs';
const dist = (...parts) => path.join(distDir, ...parts);
await mkdir(dist('shared'), { recursive: true });
await cp('src/shared/messages.json', dist('shared/messages.json'));
await mkdir(dist('renderer'), { recursive: true });
await mkdir(dist('native'), { recursive: true });
await build({ entryPoints: ['src/main/navigation.ts', 'src/preload/game.ts'], outdir: distDir, outbase: 'src', bundle: true, platform: 'node', target: 'node12', external: ['electron'], sourcemap: true });
await build({ entryPoints: ['src/renderer/app.ts'], outfile: dist('renderer/app.js'), bundle: true, platform: 'browser', target: 'chrome87', sourcemap: true, define: { __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync('package.json', 'utf8')).version) } });
await cp('src/renderer/index.html', dist('renderer/index.html'));
await cp('assets/app-icon.png', dist('renderer/app-icon.png'));
await cp('src/renderer/style.css', dist('renderer/style.css'));
await cp('src/renderer/lobby.css', dist('renderer/lobby.css'));
for (const region of ['br', 'cn']) {
  await cp(`assets/zhiyan-launcher-${region}.png`, dist(`renderer/zhiyan-${region}.png`));
  const extension = region === 'br' ? 'png' : 'webp';
  await cp(`assets/launcher-v9/art-${region}.${extension}`, dist(`renderer/lobby-art-${region}.${extension}`));
}
// The helper runs natively on this Mac, independent of the Intel Electron host.
const source = await stat('native/Keychain.swift');
const binary = await stat(dist('native/keychain')).catch(() => null);
if (!binary || source.mtimeMs > binary.mtimeMs) execFileSync('/usr/bin/xcrun', ['swiftc', ...swiftTargetArgs, 'native/Keychain.swift', '-O', '-o', dist('native/keychain')], { stdio: 'inherit' });
const loginBundle = dist('native/Naruto Login.app/Contents');
await mkdir(`${loginBundle}/MacOS`, { recursive: true });
await mkdir(`${loginBundle}/Resources`, { recursive: true });
await writeFile(`${loginBundle}/Info.plist`, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>cn.youye.naruto-os.login</string>
<key>CFBundleName</key><string>Naruto OS 登录</string>
<key>CFBundleExecutable</key><string>WebLogin</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleIconFile</key><string>login.icns</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>`);
await cp('assets/app-icon.icns', `${loginBundle}/Resources/login.icns`);
const loginInputs = await Promise.all([...webLoginSources, 'scripts/web-login-sources.mjs', 'scripts/build.mjs'].map(file => stat(file)));
const loginBinary = await stat(`${loginBundle}/MacOS/WebLogin`).catch(() => null);
if (!loginBinary || loginInputs.some(input => input.mtimeMs > loginBinary.mtimeMs)) execFileSync('/usr/bin/xcrun', [
  'swiftc', ...swiftTargetArgs, '-parse-as-library', ...webLoginSources, '-O', '-o', `${loginBundle}/MacOS/WebLogin`
], { stdio: 'inherit' });
// Match the Intel Electron host, not the Apple Silicon build machine.
execFileSync('/usr/bin/xcrun', ['swiftc', ...embeddedLoginSwiftTargetArgs, '-emit-library', '-parse-as-library', '-D', 'NARUTO_EMBEDDED',
  '-module-name', 'NarutoEmbeddedLogin', ...webLoginSources, '-O', '-Xlinker', '-install_name', '-Xlinker', '@rpath/libnaruto-login.dylib', '-o', dist('native/libnaruto-login.dylib')], { stdio: 'inherit' });
execFileSync('/usr/bin/xcrun', ['clang++', ...clangTargetArgs, '-std=c++17', '-fobjc-arc', '-DNAPI_VERSION=6', '-shared', '-undefined', 'dynamic_lookup', ...installNameArgs('embedded-login.node'),
  '-framework', 'AppKit', '-I', 'node_modules/node-api-headers/include', 'native/EmbeddedLogin.mm', `-L${dist('native')}`, '-lnaruto-login', '-Wl,-rpath,@loader_path', '-o', dist('native/embedded-login.node')], { stdio: 'inherit' });
const controlsSource = await stat('native/TrafficLights.mm');
const controlsBinary = await stat(dist('native/traffic-lights.node')).catch(() => null);
if (!controlsBinary || controlsSource.mtimeMs > controlsBinary.mtimeMs) {
  execFileSync('/usr/bin/xcrun', ['clang++', ...clangTargetArgs, '-std=c++17', '-fobjc-arc', '-DNAPI_VERSION=6',
    '-shared', '-undefined', 'dynamic_lookup', ...installNameArgs('traffic-lights.node'), '-framework', 'AppKit', '-I', 'node_modules/node-api-headers/include',
    'native/TrafficLights.mm', '-o', dist('native/traffic-lights.next.node')], { stdio: 'inherit' });
  await rename(dist('native/traffic-lights.next.node'), dist('native/traffic-lights.node'));
}
console.log(`开发构建完成（未打包应用）：${distDir}`);
