import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
const project=path.resolve(import.meta.dirname,'..'),record=JSON.parse(fs.readFileSync('release/latest-native-package.json')),
  expectedVersion=JSON.parse(fs.readFileSync('package.json','utf8')).version;
const app=process.argv.slice(2).find(arg=>arg!=='--')||record.app,root=fs.mkdtempSync(path.join(project,'.test-artifacts/native-core-package-check-'));
const executable=path.join(app,'Contents/MacOS/Naruto OS'),socket=`/tmp/naruto-c-${process.getuid()}-${crypto.createHash('sha256').update(root).digest('hex').slice(0,16)}.sock`;
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const alive=pid=>{try{process.kill(pid,0);return true}catch{return false}};
const results=[];let center,host,core;
const check=(name,ok)=>{assert(ok,name);results.push(name);console.log('PASS '+name)};
async function until(fn){let last;for(let i=0;i<200;i++){try{const value=await fn();if(value)return value}catch(e){last=e}await pause(100)}throw Error('timeout '+(last?.message||''))}
function request(command,payload={}){return new Promise((resolve,reject)=>{const token=read('capabilities.json').center;let data='';const c=net.createConnection(socket),timer=setTimeout(()=>{c.destroy();reject(Error('timeout'))},3000);c.on('error',e=>{clearTimeout(timer);reject(e)});c.on('connect',()=>c.write(JSON.stringify({v:1,role:'center',token,command,payload})+'\n'));c.on('data',b=>{data+=b;if(!data.includes('\n'))return;clearTimeout(timer);c.end();const value=JSON.parse(data.split('\n')[0]);value.ok?resolve(value.value):reject(Error(value.message))})})}
try{
 execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app]);check('complete native application signature is valid',true);
 const get=(file,key)=>execFileSync('/usr/bin/plutil',['-extract',key,'raw','-o','-',file],{encoding:'utf8'}).trim();
 check('outer app is the native center at '+expectedVersion,get(path.join(app,'Contents/Info.plist'),'CFBundleExecutable')==='Naruto OS'&&get(path.join(app,'Contents/Info.plist'),'CFBundleShortVersionString')===expectedVersion);
 const damo=path.join(app,'Contents/Resources/app/assets/damo-assist-9.39Build301/OperatingActivityPlugin.damo-assist.swf');
 check('packaged Damo assist resource matches the validated patch',fs.existsSync(damo)&&crypto.createHash('sha256').update(fs.readFileSync(damo)).digest('hex')==='f67723450e6b3d6d37f62709fde4d0a64754b560e811d2a48076af484616ed01');
 const game=path.join(app,'Contents/Helpers/Naruto OS 游戏.app');check('inner game has its own name and bundle identity',get(path.join(game,'Contents/Info.plist'),'CFBundleIdentifier')==='cn.youye.naruto-os.game'&&get(path.join(game,'Contents/Info.plist'),'CFBundleDisplayName')==='Naruto OS 游戏');
 check('packaged game page preload is present',fs.existsSync(path.join(app,'Contents/Resources/app/dist/preload/game.js')));
 check('center and game icons differ',!fs.readFileSync(path.join(app,'Contents/Resources/app-icon.icns')).equals(fs.readFileSync(path.join(game,'Contents/Resources/game-icon.icns'))));
 const proc=spawn(executable,['--fixture-root',root],{env:{...process.env,NARUTO_C_ROOT:'/invalid/inherited',NARUTO_C_PROJECT:'/invalid/inherited',ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','ignore','pipe']});center=proc.pid;proc.stderr.on('data',b=>process.stderr.write(b));
 const initial=await until(()=>request('snapshot'));core=initial.corePID;
 check('packaged entry ignores stale developer environment',initial.fixture&&initial.runtimeIdentity.includes(app+'/Contents/Resources/app'));
 await until(()=>read('center-view.json').pid===center);check('packaged center renders with WK',read('center-view.json').engine==='WKWebView');
 await request('batch.start',{requestId:crypto.randomUUID(),profileIds:['br-1','cn-1']});
 await until(()=>{const s=read('fixture-status.json');host=s.pid;return s.tasks.filter(t=>t.status==='ready').length===2&&Object.values(s.quality).filter(q=>q==='HIGH').length===2});
 const running=read('fixture-status.json');check('packaged game runs both real synthetic Flash instances',running.packaged&&running.appName==='Naruto OS 游戏'&&running.executable.startsWith(game));
 process.kill(center,'SIGTERM');await until(()=>!alive(center));center=undefined;
 const ticks=read('fixture-status.json').ticks['br-1'];await until(()=>read('fixture-status.json').ticks['br-1']>ticks);check('closing center leaves the independent game running',true);
 fs.writeFileSync(path.join(root,'fixture-open-center'),'');await until(()=>{const c=read('center-view.json');return c.pid!==proc.pid&&alive(c.pid)});center=read('center-view.json').pid;
 const command=execFileSync('ps',['-p',String(center),'-o','comm='],{encoding:'utf8'}).trim();check('game reopens the packaged native center',command===executable);
 await request('credentials.metadata');check('isolated packaged credential store remains readable',true);
 fs.writeFileSync(path.join(root,'fixture-stop'),'');await until(()=>!alive(host));host=undefined;check('packaged game saves and exits normally',true);
 process.kill(center,'SIGTERM');await until(()=>!alive(center));center=undefined;
 await until(()=>!alive(core));core=undefined;check('packaged core exits once the app is idle',true);
 fs.writeFileSync(path.join(root,'results.json'),JSON.stringify({ok:true,results,app},null,2));
}catch(error){fs.writeFileSync(path.join(root,'results.json'),JSON.stringify({ok:false,results,error:String(error)},null,2));console.error(error);process.exitCode=1}
finally{for(const pid of [center,host,core])if(pid&&alive(pid))try{process.kill(pid,'SIGTERM')}catch{};console.log('应用包验收：'+root)}
