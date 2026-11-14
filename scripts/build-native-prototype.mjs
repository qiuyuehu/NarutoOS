// Keep native binaries compatible with the supported macOS baseline.
process.env.MACOSX_DEPLOYMENT_TARGET = '15.0';
import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
const nativeTarget = `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos15.0`;
mkdirSync('dist/prototype/native', { recursive: true });
for (const [name, file] of [['core', 'Core.swift'], ['center', 'Center.swift']]) {
  execFileSync('/usr/bin/xcrun', ['swiftc', '-target', nativeTarget, '-O', 'src/prototype/native/Transport.swift', ...(name==='core'?['src/prototype/native/Management.swift']:['src/prototype/native/Packaged.swift']), `src/prototype/native/${file}`, '-o', `dist/prototype/native/${name}`], { stdio: 'inherit' });
}
await build({ entryPoints: ['src/prototype/host/main.ts'], outfile: 'dist/prototype/host.js', bundle: true, platform: 'node', target: 'node12', external: ['electron'] });
await build({ entryPoints: ['src/prototype/host/preload.ts'], outfile: 'dist/prototype/host-preload.js', bundle: true, platform: 'node', target: 'node12', external: ['electron'] });
await build({ entryPoints: ['src/prototype/host/toolbar.ts'], outfile: 'dist/prototype/toolbar.js', bundle: true, platform: 'browser', target: 'chrome87' });
for (const file of ['toolbar.html', 'toolbar.css']) copyFileSync(`src/prototype/host/${file}`, `dist/prototype/${file}`);
copyFileSync('src/renderer/style.css', 'dist/prototype/host-style.css');
console.log('C架构：WK启动中心、原生核心与游戏宿主已构建（未打包安装）');

mkdirSync('dist/prototype/launcher',{recursive:true});
await build({entryPoints:['src/prototype/launcher/bridge.ts'],outfile:'dist/prototype/launcher/bridge.js',bundle:true,platform:'browser',target:'safari15'});
for(const file of ['style.css','lobby.css','lobby-art-br.png','zhiyan-br.png'])copyFileSync('dist/renderer/'+file,'dist/prototype/launcher/'+file);
copyFileSync('src/prototype/launcher/center.css','dist/prototype/launcher/center.css');
// WK file pages taint image-backed canvas reads. Inline local artwork in this
// launcher build so the existing focus measurement and masking can run unchanged.
let launcherApp=readFileSync('dist/renderer/app.js','utf8');
const artwork=new Map();
for(const name of ['lobby-art-br.png','zhiyan-br.png']){
  const uri='data:image/png;base64,'+readFileSync('dist/renderer/'+name).toString('base64');
  artwork.set(name,uri);launcherApp=launcherApp.split(JSON.stringify(name)).join(JSON.stringify(uri));
}
writeFileSync('dist/prototype/launcher/app.js',launcherApp);

let html=readFileSync('src/renderer/index.html','utf8').replace('</head>','<link rel="stylesheet" href="center.css"></head>').replace('<script src="app.js">','<script src="bridge.js"></script><script src="app.js">');
html=html.replace('<div class="lobby-status-area">','<div id="selection-summary"></div><div id="runtime-summary"></div><div class="lobby-status-area">');
html=html.replace('<label for="quality-select">','<label for="quality-select">');
html=html.replace('<div class="row"><label id="mute-label">','<div class="row"><label id="center-auto-label">启动游戏后关闭启动中心</label><button id="center-auto-close" class="switch" role="switch" aria-labelledby="center-auto-label" aria-checked="true"><span></span></button></div><div class="row"><label id="mute-label">');
html=html.replace('src="lobby-art-br.png"','src="'+artwork.get('lobby-art-br.png')+'"');
writeFileSync('dist/prototype/launcher/index.html',html);
