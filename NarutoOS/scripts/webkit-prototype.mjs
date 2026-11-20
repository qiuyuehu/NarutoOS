import { build } from 'esbuild';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import electron from 'electron';

mkdirSync('.test-artifacts', { recursive: true });
const directory = mkdtempSync(path.resolve('.test-artifacts/webkit-prototype-'));
const bundle = path.join(directory, 'Naruto 登录原型.app');
mkdirSync(path.join(bundle, 'Contents/MacOS'), { recursive: true });
writeFileSync(path.join(bundle, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>cn.youye.naruto-os.login-prototype</string>
<key>CFBundleName</key><string>Naruto 登录原型</string>
<key>CFBundleExecutable</key><string>WebLoginPrototype</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>`);
const helper = path.join(bundle, 'Contents/MacOS/WebLoginPrototype');
execFileSync('/usr/bin/xcrun', ['swiftc', '-parse-as-library', 'native/WebLoginPrototype.swift', '-O', '-o', helper], { stdio: 'inherit' });
await build({ entryPoints: ['src/main/game.ts', 'src/main/flash.ts', 'src/preload/game.ts'], outdir: directory, outbase: 'src', bundle: true,
  platform: 'node', target: 'node12', external: ['electron'] });
const env = { ...process.env, NARUTO_WEBKIT_DIRECTORY: directory, NARUTO_WEBKIT_HELPER: helper };
if (process.argv.includes('--test-wrapper')) env.NARUTO_WEBKIT_TEST_WRAPPER = '1';
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [process.argv.includes('--test') || process.argv.includes('--test-wrapper') ? 'tests/webkit-handoff-window.cjs' : 'scripts/webkit-prototype-window.cjs'], { env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code ?? 1; });
