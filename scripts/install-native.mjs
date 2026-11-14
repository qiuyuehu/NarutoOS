// Local install with application rollback. User data remains at its existing location.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const project=path.resolve(import.meta.dirname,'..');process.chdir(project);
const record=JSON.parse(await fs.readFile('release/latest-native-package.json','utf8'));
const target='/Applications/Naruto OS.app',root=path.join(project,'.test-artifacts/native-core-live');
if(await fs.realpath(root)!==root)throw Error('当前C资料位置必须为原始目录');
const management=JSON.parse(await fs.readFile(path.join(root,'management.json'),'utf8'));
if(management.version!==1)throw Error('现有资料格式无法确认，原资料已保留');
async function ensureIdle(){
 const current=JSON.parse(await fs.readFile(path.join(root,'management.json'),'utf8'));
 let hostAlive=false;if(Number.isInteger(current.hostPID)&&current.hostPID>1)try{process.kill(current.hostPID,0);hostAlive=true}catch{}
 const processes=execFileSync('ps',['-axo','comm='],{encoding:'utf8'}).split('\n');
 if(hostAlive||processes.some(p=>p.startsWith(target+'/')||p.startsWith(project+'/dist/prototype/native/')))throw Error('请先正常退出游戏和启动中心，等待约十秒再安装');
}
await ensureIdle();
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',record.app]);
const pointer=path.join(os.homedir(),'Library/Application Support/Naruto OS C/data-location.json');
const pointerStat=await fs.lstat(pointer).catch(e=>{if(e.code!=='ENOENT')throw e});if(pointerStat?.isSymbolicLink())throw Error('启动资料位置配置不能是链接');
const previousPointer=pointerStat?await fs.readFile(pointer):null;
const stage=`/Applications/.Naruto OS-${crypto.randomUUID()}.app`;
execFileSync('/usr/bin/ditto',[record.app,stage]);execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',stage]);
await ensureIdle();
let backup,oldMoved=false,installed=false,pointerChanged=false;
try{
 const existing=await fs.lstat(target).catch(e=>{if(e.code!=='ENOENT')throw e});
 if(existing){if(existing.isSymbolicLink())throw Error('现有应用是链接，请先确认安装位置');let version='previous';try{version=execFileSync('/usr/bin/plutil',['-extract','CFBundleShortVersionString','raw','-o','-',path.join(target,'Contents/Info.plist')],{encoding:'utf8'}).trim().replace(/[^0-9.]/g,'')}catch{}
  const directory=path.resolve('release/installation-backups.noindex',`NarutoOS-${version}-before-${record.version}-${Date.now()}`);await fs.mkdir(directory,{recursive:true});backup=path.join(directory,'Naruto OS.app');await fs.rename(target,backup);oldMoved=true;
 }
 await fs.rename(stage,target);installed=true;
 await fs.mkdir(path.dirname(pointer),{recursive:true,mode:0o700});
 const temp=pointer+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify({root},null,2),{mode:0o600,flag:'wx'});await fs.rename(temp,pointer);pointerChanged=true;
 const lsregister='/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
 try{execFileSync(lsregister,['-u',record.app],{stdio:'ignore'})}catch{}
 execFileSync(lsregister,['-f',target]);
 await fs.writeFile('release/delivery.json',JSON.stringify({version:record.version,installedApp:target,architecture:'native-center-electron-game',previousApp:backup||null,dataMode:'existing-C-location',installedAt:new Date().toISOString()},null,2));
 console.log(JSON.stringify({installedApp:target,version:record.version,previousApp:backup,dataMode:'原地沿用C资料，未移动账号或会话'}));
}catch(error){
 if(installed)await fs.rename(target,stage);
 if(oldMoved)await fs.rename(backup,target);
 if(pointerChanged){if(previousPointer)await fs.writeFile(pointer,previousPointer,{mode:0o600});else await fs.unlink(pointer)}
 throw error;
}
