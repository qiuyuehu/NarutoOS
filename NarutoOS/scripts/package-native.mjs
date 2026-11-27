// Native center is the outer app; the independent game app stays inside Helpers.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import electron from 'electron';
import crypto from 'node:crypto';
import { intelTest, distDir, gameSpeedDir } from './build-target.mjs';
const project=path.resolve(import.meta.dirname,'..');process.chdir(project);
const pkg=JSON.parse(await fs.readFile('package.json','utf8'));
// Refuse to ship a localization pack that the host would silently drop at runtime.
execFileSync(process.execPath,['scripts/check-localization-pack.mjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/check-activity-assist.mjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/check-assist-pack.mjs'],{stdio:'inherit'});
await fs.mkdir('release/builds.noindex',{recursive:true});
const directory=intelTest ? process.env.NARUTO_INTEL_BUILD_DIR : await fs.mkdtemp(path.resolve('release/builds.noindex',`NarutoOS-${pkg.version}-native-`));
const app=path.join(directory,'Naruto OS.app'),contents=path.join(app,'Contents'),resources=path.join(contents,'Resources'),application=path.join(resources,'app');
await fs.mkdir(path.join(contents,'MacOS'),{recursive:true});await fs.mkdir(application,{recursive:true});
const run=(command,args)=>execFileSync(command,args,{stdio:'inherit'});
const set=(file,key,value)=>run('/usr/bin/plutil',['-replace',key,'-string',value,file]);
const get=(file,key)=>execFileSync('/usr/bin/plutil',['-extract',key,'raw','-o','-',file],{encoding:'utf8'}).trim();
const sign=file=>run('/usr/bin/codesign',['--force','--sign','-','--timestamp=none',file]);
const copy=async(from,to)=>{await fs.mkdir(path.dirname(to),{recursive:true});await fs.copyFile(from,to)};
const outerInfo={CFBundleDisplayName:'Naruto OS',CFBundleName:'Naruto OS',CFBundleExecutable:'Naruto OS',CFBundleIdentifier:'cn.youye.naruto-os',CFBundleShortVersionString:pkg.version,CFBundleVersion:pkg.version,CFBundleIconFile:'app-icon.icns',CFBundlePackageType:'APPL',LSMinimumSystemVersion:intelTest ? '12.0' : '15.0',NSPrincipalClass:'NSApplication',LSApplicationCategoryType:'public.app-category.games',NSHumanReadableCopyright:'MIT License'};
const plist=path.join(contents,'Info.plist');await fs.writeFile(plist,'<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict></dict></plist>');for(const [key,value]of Object.entries(outerInfo))set(plist,key,value);
if (intelTest) run('/usr/bin/plutil',['-replace','NarutoOSIntelTest','-bool','YES',plist]);
await copy('../LICENSE',path.join(resources,'LICENSE'));
await copy('../THIRD_PARTY_NOTICES.md',path.join(resources,'THIRD_PARTY_NOTICES.md'));
for(const file of ['LICENSE','LICENSES.chromium.html'])await copy(path.resolve(electron,'../../../..',file),path.join(resources,'licenses/electron',file));
await copy(path.join(distDir,'prototype/native/center'),path.join(contents,'MacOS/Naruto OS'));await copy('assets/app-icon.icns',path.join(resources,'app-icon.icns'));
for(const file of ['shared/messages.json','prototype/host.js','prototype/host-preload.js','prototype/toolbar.js','prototype/toolbar.html','prototype/toolbar.css','prototype/host-style.css','prototype/native/core','prototype/native/updater','preload/game.js','native/keychain','native/traffic-lights.node','native/embedded-login.node','native/libnaruto-login.dylib'])await copy(path.join(distDir,file),path.join(application,'dist',file));
await fs.cp(path.join(distDir,'prototype/launcher'),path.join(application,'dist/prototype/launcher'),{recursive:true});
await fs.cp('assets/localization',path.join(application,'assets/localization'),{recursive:true});
await fs.cp('assets/activity-assist-9.40Build300',path.join(application,'assets/activity-assist-9.40Build300'),{recursive:true});
await fs.cp('assets/assists',path.join(application,'assets/assists'),{recursive:true});
for(const version of ['34','31'])await fs.cp(`runtime/flash-${version}`,path.join(application,`runtime/flash-${version}`),{recursive:true});
await copy('tests/fixtures/native-core/quality.swf',path.join(application,'assets/checks/quality.swf'));
// 游戏变速：挂钩动态库与两区移动补丁随包分发；缺失时核心跳过注入、功能按 1 倍降级。
await fs.cp(gameSpeedDir,path.join(application,'assets/game-speed'),{recursive:true});
await fs.cp('assets/assists',path.join(application,'assets/assists'),{recursive:true});
await copy('assets/app-icon.png',path.join(application,'assets/app-icon.png'));
const gamePNG=path.join(directory,'game-icon.png');run('/usr/bin/xcrun',['swift','native/PrepareGameIcon.swift',path.resolve('assets/app-icon.png'),gamePNG]);
await copy(gamePNG,path.join(application,'assets/game-icon.png'));
const iconset=path.join(directory,'Game.iconset');await fs.mkdir(iconset);
for(const size of [16,32,128,256,512])for(const factor of [1,2])run('/usr/bin/sips',['-z',String(size*factor),String(size*factor),gamePNG,'--out',path.join(iconset,`icon_${size}x${size}${factor===2?'@2x':''}.png`)]);
const gameICNS=path.join(directory,'game-icon.icns');run('/usr/bin/iconutil',['-c','icns',iconset,'-o',gameICNS]);
const gameApp=path.join(contents,'Helpers/Naruto OS 游戏.app');await fs.mkdir(path.dirname(gameApp),{recursive:true});run('/usr/bin/ditto',[path.resolve(electron,'../../..'),gameApp]);
const gc=path.join(gameApp,'Contents'),gp=path.join(gc,'Info.plist');await fs.rename(path.join(gc,'MacOS/Electron'),path.join(gc,'MacOS/Naruto OS 游戏'));
for(const [key,value]of Object.entries({CFBundleDisplayName:'Naruto OS 游戏',CFBundleName:'Naruto OS 游戏',CFBundleExecutable:'Naruto OS 游戏',CFBundleIdentifier:'cn.youye.naruto-os.game',CFBundleShortVersionString:pkg.version,CFBundleVersion:pkg.version,CFBundleIconFile:'game-icon.icns'}))set(gp,key,value);
const helperApps=[],frameworks=path.join(gc,'Frameworks');
for(const name of await fs.readdir(frameworks)){
 if(!/^Electron Helper(?: \([A-Za-z]+\))?\.app$/.test(name))continue;
 const old=path.join(frameworks,name),hp=path.join(old,'Contents/Info.plist'),original=get(hp,'CFBundleName'),executable=original.replace(/^Electron Helper/,'Naruto OS 游戏 Helper');
 await fs.rename(path.join(old,'Contents/MacOS',original),path.join(old,'Contents/MacOS',executable));
 const kind=(name.match(/\(([A-Za-z]+)\)/)?.[1]||'main').toLowerCase();
 for(const [key,value]of Object.entries({CFBundleName:executable,CFBundleDisplayName:executable,CFBundleExecutable:executable,CFBundleIdentifier:`cn.youye.naruto-os.game.helper.${kind}`}))set(hp,key,value);
 const next=path.join(frameworks,name.replace(/^Electron Helper/,'Naruto OS 游戏 Helper'));await fs.rename(old,next);helperApps.push(next);
}
await fs.rm(path.join(gc,'Resources/default_app.asar'),{force:true});await copy(gameICNS,path.join(gc,'Resources/game-icon.icns'));
const gameSource=path.join(gc,'Resources/app');await fs.mkdir(gameSource);await fs.writeFile(path.join(gameSource,'package.json'),JSON.stringify({name:'naruto-os-game',productName:'Naruto OS 游戏',version:pkg.version,main:'index.js'}));
await fs.writeFile(path.join(gameSource,'index.js'),"require(require('path').resolve(__dirname,'../../../../../Resources/app/dist/prototype/host.js'));\n");
await fs.writeFile(path.join(application,'package.json'),JSON.stringify({name:pkg.name,productName:pkg.productName,version:pkg.version,private:true}));
await fs.writeFile(path.join(application,'build-info.json'),JSON.stringify({version:pkg.version,buildID:crypto.randomUUID(),architecture:'native-center-electron-game',builtAt:new Date().toISOString()},null,2));
for(const file of ['dist/prototype/native/core','dist/prototype/native/updater','dist/native/keychain','dist/native/traffic-lights.node','dist/native/embedded-login.node','dist/native/libnaruto-login.dylib'])sign(path.join(application,file));
if (intelTest) {
  sign(path.join(application, 'assets/game-speed/libgame-speed.dylib'));
  // Electron 11 ships these loose executables as framework resources.
  // Sign their staged copies before sealing the containing frameworks.
  const libraries = path.join(frameworks, 'Electron Framework.framework/Versions/A/Libraries');
  for (const name of await fs.readdir(libraries)) {
    if (name.endsWith('.dylib')) sign(path.join(libraries, name));
  }
  sign(path.join(frameworks, 'Squirrel.framework/Versions/A/Resources/ShipIt'));
}
for(const name of await fs.readdir(frameworks))if(name.endsWith('.framework'))run('/usr/bin/codesign',['--force','--deep','--sign','-','--timestamp=none',path.join(frameworks,name)]);
for(const helper of helperApps)sign(helper);sign(gameApp);sign(app);
run('/usr/bin/codesign',['--verify','--deep','--strict','--verbose=2',app]);
if (!intelTest) await fs.writeFile('release/latest-native-package.json',JSON.stringify({app,directory,version:pkg.version},null,2));
console.log(JSON.stringify({app,directory,version:pkg.version}));
