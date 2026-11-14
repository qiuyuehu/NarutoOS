// Keep native binaries compatible with the supported macOS baseline.
process.env.MACOSX_DEPLOYMENT_TARGET = '15.0';
import { build } from 'esbuild';
import { mkdir, cp, stat, rename, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const nativeTarget = `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos15.0`;
await mkdir('dist/renderer', { recursive: true });
await mkdir('dist/native', { recursive: true });
await build({ entryPoints: ['src/main/navigation.ts', 'src/preload/game.ts'], outdir: 'dist', outbase: 'src', bundle: true, platform: 'node', target: 'node12', external: ['electron'], sourcemap: true });
await build({ entryPoints: ['src/renderer/app.ts'], outfile: 'dist/renderer/app.js', bundle: true, platform: 'browser', target: 'chrome87', sourcemap: true });
await cp('src/renderer/index.html', 'dist/renderer/index.html');
await cp('src/renderer/style.css', 'dist/renderer/style.css');
await cp('src/renderer/lobby.css', 'dist/renderer/lobby.css');
for (const region of ['br', 'cn']) {
  await cp(`assets/zhiyan-launcher-${region}.png`, `dist/renderer/zhiyan-${region}.png`);
  const extension = region === 'br' ? 'png' : 'webp';
  await cp(`assets/launcher-v9/art-${region}.${extension}`, `dist/renderer/lobby-art-${region}.${extension}`);
}
// The helper runs natively on this Mac, independent of the Intel Electron host.
const source = await stat('native/Keychain.swift');
const binary = await stat('dist/native/keychain').catch(() => null);
if (!binary || source.mtimeMs > binary.mtimeMs) execFileSync('/usr/bin/xcrun', ['swiftc', '-target', nativeTarget, 'native/Keychain.swift', '-O', '-o', 'dist/native/keychain'], { stdio: 'inherit' });
const loginBundle = 'dist/native/Naruto Login.app/Contents';
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
const loginSource = await stat('native/WebLoginPrototype.swift');
const loginBinary = await stat(`${loginBundle}/MacOS/WebLogin`).catch(() => null);
if (!loginBinary || loginSource.mtimeMs > loginBinary.mtimeMs) execFileSync('/usr/bin/xcrun', [
  'swiftc', '-target', nativeTarget, '-parse-as-library', 'native/WebLoginPrototype.swift', '-O', '-o', `${loginBundle}/MacOS/WebLogin`
], { stdio: 'inherit' });
// Match the Intel Electron host, not the Apple Silicon build machine.
execFileSync('/usr/bin/xcrun', ['swiftc', '-target', 'x86_64-apple-macos15.0', '-emit-library', '-parse-as-library', '-D', 'NARUTO_EMBEDDED',
  '-module-name', 'NarutoEmbeddedLogin', 'native/WebLoginPrototype.swift', '-O', '-Xlinker', '-install_name', '-Xlinker', '@rpath/libnaruto-login.dylib', '-o', 'dist/native/libnaruto-login.dylib'], { stdio: 'inherit' });
execFileSync('/usr/bin/xcrun', ['clang++', '-arch', 'x86_64', '-std=c++17', '-fobjc-arc', '-DNAPI_VERSION=6', '-shared', '-undefined', 'dynamic_lookup',
  '-framework', 'AppKit', '-I', 'node_modules/node-api-headers/include', 'native/EmbeddedLogin.mm', '-Ldist/native', '-lnaruto-login', '-Wl,-rpath,@loader_path', '-o', 'dist/native/embedded-login.node'], { stdio: 'inherit' });
const controlsSource = await stat('native/TrafficLights.mm');
const controlsBinary = await stat('dist/native/traffic-lights.node').catch(() => null);
if (!controlsBinary || controlsSource.mtimeMs > controlsBinary.mtimeMs) {
  execFileSync('/usr/bin/xcrun', ['clang++', '-arch', 'x86_64', '-std=c++17', '-fobjc-arc', '-DNAPI_VERSION=6',
    '-shared', '-undefined', 'dynamic_lookup', '-framework', 'AppKit', '-I', 'node_modules/node-api-headers/include',
    'native/TrafficLights.mm', '-o', 'dist/native/traffic-lights.next.node'], { stdio: 'inherit' });
  await rename('dist/native/traffic-lights.next.node', 'dist/native/traffic-lights.node');
}
console.log('开发构建完成（未打包应用）');
