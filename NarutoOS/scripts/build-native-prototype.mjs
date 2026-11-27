import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { distDir, gameSpeedDir, gameSpeedArchArgs, installNameArgs, intelTest, swiftTargetArgs } from './build-target.mjs';
import { updateSourceFiles } from './update-sources.mjs';
const dist = (...parts) => path.join(distDir, ...parts);
mkdirSync(dist('prototype/native'), { recursive: true });
// Keep the Swift module cache inside the build output so sandboxed builds do not
// depend on the system temporary directory being writable.
const moduleCache = path.resolve(dist('swift-module-cache'));
mkdirSync(moduleCache, { recursive: true });
const targets = [
  ['core', ['Transport.swift', 'I18n.swift', 'Management.swift', 'BatchHistory.swift', 'Core.swift']],
  ['center', ['Transport.swift', 'I18n.swift', ...updateSourceFiles, 'UpdateProgressPanel.swift', 'UpdateReconciliation.swift', 'UpdateUI.swift', 'Packaged.swift', 'CenterWindowLayout.swift', 'Center.swift']],
  ['updater', ['Transport.swift', 'I18n.swift', ...updateSourceFiles, 'Updater.swift']]
];
for (const [name, files] of targets) {
  execFileSync('/usr/bin/xcrun', ['swiftc', ...swiftTargetArgs, '-O', '-module-cache-path', moduleCache, ...files.map(file => `src/prototype/native/${file}`), '-o', dist(`prototype/native/${name}`)], { stdio: 'inherit' });
}
// 游戏变速挂钩：双架构 dylib，由原生核心在「游戏变速」开启时注入宿主进程树（仅 ppapi 子进程激活）。
// 编译失败只降级功能（核心注入前会确认文件存在），不阻断构建。
mkdirSync(gameSpeedDir, { recursive: true });
try {
  execFileSync('/usr/bin/clang', [...gameSpeedArchArgs, '-shared', '-O2', '-fPIC', ...installNameArgs('libgame-speed.dylib'),
    '-o', path.join(gameSpeedDir, 'libgame-speed.dylib'), 'native/game-speed/hook.c', 'native/game-speed/fishhook/fishhook.c']);
} catch (error) {
  if (intelTest) throw error;
  console.warn(`游戏变速挂钩编译失败，该功能将保持 1 倍：${error instanceof Error ? error.message : String(error)}`);
}
await build({ entryPoints: ['src/prototype/host/main.ts'], outfile: dist('prototype/host.js'), bundle: true, platform: 'node', target: 'node12', external: ['electron'] });
await build({ entryPoints: ['src/prototype/host/preload.ts'], outfile: dist('prototype/host-preload.js'), bundle: true, platform: 'node', target: 'node12', external: ['electron'] });
await build({ entryPoints: ['src/prototype/host/toolbar.ts'], outfile: dist('prototype/toolbar.js'), bundle: true, platform: 'browser', target: 'chrome87' });
for (const file of ['toolbar.html', 'toolbar.css']) copyFileSync(`src/prototype/host/${file}`, dist(`prototype/${file}`));
copyFileSync('src/renderer/style.css', dist('prototype/host-style.css'));
console.log('C架构：WK启动中心、原生核心与游戏宿主已构建（未打包安装）');

mkdirSync(dist('prototype/launcher'),{recursive:true});
await build({entryPoints:['src/prototype/launcher/bridge.ts'],outfile:dist('prototype/launcher/bridge.js'),bundle:true,platform:'browser',target:'safari15'});
for(const file of ['style.css','lobby.css','lobby-art-br.png','zhiyan-br.png','app-icon.png'])copyFileSync(dist('renderer',file),dist('prototype/launcher',file));
copyFileSync('src/prototype/launcher/center.css',dist('prototype/launcher/center.css'));
// WK file pages taint image-backed canvas reads. Inline local artwork in this
// launcher build so the existing focus measurement and masking can run unchanged.
let launcherApp=readFileSync(dist('renderer/app.js'),'utf8');
const artwork=new Map();
for(const name of ['lobby-art-br.png','zhiyan-br.png']){
  const uri='data:image/png;base64,'+readFileSync(dist('renderer',name)).toString('base64');
  artwork.set(name,uri);launcherApp=launcherApp.split(JSON.stringify(name)).join(JSON.stringify(uri));
}
writeFileSync(dist('prototype/launcher/app.js'),launcherApp);

let html=readFileSync('src/renderer/index.html','utf8').replace('</head>','<link rel="stylesheet" href="center.css"></head>').replace('<script src="app.js">','<script src="bridge.js"></script><script src="app.js">');
html=html.replace('<div class="lobby-status-area">','<div id="selection-summary"></div><div id="runtime-summary"></div><div class="lobby-status-area">');
html=html.replace('<label for="quality-select">','<label for="quality-select">');
html=html.replace('<!--center-auto-close-->','<div class="row"><label id="center-auto-label" data-i18n="settings.autoClose">启动游戏后关闭启动中心</label><button id="center-auto-close" class="switch" role="switch" aria-labelledby="center-auto-label" aria-checked="true"><span></span></button></div>');
html=html.replace('src="lobby-art-br.png"','src="'+artwork.get('lobby-art-br.png')+'"');
writeFileSync(dist('prototype/launcher/index.html'),html);
