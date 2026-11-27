import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const project=path.resolve(import.meta.dirname,'..');
const root=fs.mkdtempSync(path.join(project,'.test-artifacts/native-core-launcher-'));
const env={...process.env,NARUTO_C_ROOT:root,NARUTO_C_PROJECT:project,NARUTO_C_ELECTRON:'/usr/bin/true',NARUTO_C_FIXTURE:'1',NARUTO_C_UI_CHECKS:'launcher'};
const socket=`/tmp/naruto-c-${process.getuid()}-${crypto.createHash('sha256').update(root).digest('hex').slice(0,16)}.sock`;
const children=[],results=[];let core,center;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<200;i++){try{const value=await fn();if(value)return value}catch{}await pause(100)}throw Error('timeout')}
function request(command,payload={}){return new Promise((resolve,reject)=>{let data='';const token=JSON.parse(fs.readFileSync(path.join(root,'capabilities.json'))).center;const c=net.createConnection(socket);const timer=setTimeout(()=>{c.destroy();reject(Error('IPC timeout'))},3000);c.on('error',e=>{clearTimeout(timer);reject(e)});c.on('connect',()=>c.write(JSON.stringify({v:1,role:'center',token,command,payload})+'\n'));c.on('data',b=>{data+=b;if(!data.includes('\n'))return;clearTimeout(timer);c.end();const r=JSON.parse(data.split('\n')[0]);r.ok?resolve(r.value):reject(Error(r.message))})})}
function start(role,extra={}){const child=spawn(path.join(project,'dist/prototype/native',role),[],{env:{...env,...(role==='center'?{NARUTO_C_TOKEN:JSON.parse(fs.readFileSync(path.join(root,'capabilities.json'))).center}:{}),...extra},stdio:['ignore','ignore','pipe']});children.push(child);child.stderr.on('data',data=>process.stderr.write(data));return child}
async function stop(child){if(child.exitCode!==null||child.signalCode!==null)return;child.kill('SIGTERM');await new Promise(r=>child.once('exit',r))}
function check(name,value){assert(value,name);results.push(name);console.log('PASS '+name)}
try{
 core=start('core');await until(()=>request('snapshot'));
 const patch=async(command,payload)=>{const state=await request('snapshot');return request(command,{requestId:crypto.randomUUID(),revision:state.revision,...payload})};
 await patch('preferences.patch',{key:'autoClose',value:false});await patch('preferences.patch',{key:'lobbyMotion',value:false});
 await patch('catalog.update',{id:'br-1',name:'首选甲',serverNote:''});const second=await patch('catalog.create',{region:'br',name:'首选乙',serverNote:''});
 const windowFile=path.join(root,'center-window.json');
 const offscreen={x:-100_000,y:-100_000};
 fs.writeFileSync(windowFile,JSON.stringify(offscreen));
 for(const small of [false,true]){
  const mode=small?'small':'normal';
  await patch('preferences.patch',{key:'theme',value:small?'dark':'light'});
  const resultFile=path.join(root,'ui-check.json');if(fs.existsSync(resultFile))fs.unlinkSync(resultFile);
  center=start('center',small?{NARUTO_C_LAUNCHER_SMALL:'1'}:{});
  const ui=await until(()=>fs.existsSync(resultFile)&&JSON.parse(fs.readFileSync(resultFile)));
  check(mode+' WK launcher UI: '+(ui.error||'passed'),ui.ok);
  const view=await until(()=>{
   const value=JSON.parse(fs.readFileSync(path.join(root,'center-view.json')));
   return value.pid===center.pid&&value;
  });
  check(mode+' window keeps one title bar and all three traffic lights centered',
    view.integratedTitlebar&&view.trafficLightCenters.length===3&&view.trafficLightCenters.every(y=>Math.abs(y-21)<1));
  check(mode+' window frame matches the WK viewport',view.width===ui.width&&view.height===ui.height);
  if(!small){
   const position=JSON.parse(fs.readFileSync(windowFile));
   check('normal window restores an offscreen position to the display',
     Number.isFinite(position.x)&&Number.isFinite(position.y)&&position.x>offscreen.x&&position.y>offscreen.y);
  }
  await until(()=>fs.existsSync(path.join(root,'ui-center.png')));
  fs.renameSync(path.join(root,'ui-center.png'),path.join(root,mode+'.png'));
  fs.writeFileSync(path.join(root,mode+'.json'),JSON.stringify(ui,null,2));
  fs.writeFileSync(path.join(root,mode+'-window.json'),JSON.stringify(view,null,2));
  const state=await request('snapshot');check('first selected account persists after '+mode+' launch',state.selectedByRegion.br===ui.primary);
  const batch=state.batches.at(-1);check('batch preserves click order',batch.profileIds[0]===ui.primary&&batch.profileIds.length===2);
  await stop(center);center=undefined;
  if(!small)fs.renameSync(windowFile,path.join(root,'normal-window-position.json'));
 }
 const before=await request('snapshot'),batch=before.batches.at(-1);
 await patch('catalog.select',{id:'br-1'});await request('batch.start',{requestId:batch.id,profileIds:batch.profileIds});
 check('replaying an old batch does not overwrite newer account preference',(await request('snapshot')).selectedByRegion.br==='br-1');
 await patch('catalog.select',{id:second.id});await stop(core);core=start('core');
 await until(()=>request('snapshot'));check('primary account persists across core restart',(await request('snapshot')).selectedByRegion.br===second.id);
 fs.writeFileSync(path.join(root,'results.json'),JSON.stringify({ok:true,results},null,2));
}catch(error){fs.writeFileSync(path.join(root,'results.json'),JSON.stringify({ok:false,results,error:String(error)},null,2));console.error(error);process.exitCode=1}
finally{for(const child of children.reverse())await stop(child);console.log('启动中心检查：'+root)}
