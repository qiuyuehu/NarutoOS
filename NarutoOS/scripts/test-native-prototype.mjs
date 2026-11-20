import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import electron from 'electron';
const exec = promisify(execFile);
const project=path.resolve(import.meta.dirname,'..');
const root=fs.mkdtempSync(path.join(project,'.test-artifacts/native-core-check-'));
const env={...process.env,NARUTO_C_ROOT:root,NARUTO_C_PROJECT:project,NARUTO_C_ELECTRON:electron,NARUTO_C_FIXTURE:'1',NARUTO_C_UI_CHECKS:process.argv.includes('--maintenance-only')?'0':'1'};delete env.ELECTRON_RUN_AS_NODE;
const loginTabs=process.argv.includes('--login-tabs');
let loginServer;const arrivals=[];
if(loginTabs){
 const {createServer}=await import('node:http');
 loginServer=createServer((req,res)=>{
   if(/^\/br-[12]$/.test(req.url)){arrivals.push({slot:req.url.slice(1),restored:(req.headers.cookie||'').includes('fixture_login='+req.url.slice(1))});res.setHeader('Set-Cookie','fixture_login='+req.url.slice(1)+'; HttpOnly; Path=/');}
   res.setHeader('Content-Type','text/html');res.end('<button class="login_btn">fixture</button>');
 });await new Promise(resolve=>loginServer.listen(0,'127.0.0.1',resolve));
 env.NARUTO_C_LOGIN_FIXTURE='http://127.0.0.1:'+loginServer.address().port+'/';env.NARUTO_C_UI_CHECKS='login-tabs';
}
const binary=process.env.NARUTO_C_NATIVE_BIN||path.join(project,'dist/prototype/native');
const socket=`/tmp/naruto-c-${process.getuid()}-${crypto.createHash('sha256').update(root).digest('hex').slice(0,16)}.sock`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const alive=pid=>{try{process.kill(pid,0);return true}catch{return false}};
const results=[];const check=(name,value)=>{assert(value,name);results.push(name);console.log('PASS',name)};
async function until(fn,timeout=25000){const start=Date.now();let last;while(Date.now()-start<timeout){try{const v=await fn();if(v)return v}catch(e){last=e}await sleep(150)}throw new Error('等待条件超时 '+(last?.message||''))}
function request(command,payload={},options={}){
 return new Promise((resolve,reject)=>{let text='';const token=read('capabilities.json')[options.role||'center'];const s=net.createConnection(socket);const timer=setTimeout(()=>{s.destroy();reject(new Error('IPC timeout'))},3500);
 s.on('connect',()=>{s.write(JSON.stringify({v:options.v||1,role:options.role||'center',token:options.bad?'invalid':token,command,payload})+'\n');if(options.drop){s.end();clearTimeout(timer);resolve(null)}});
 s.on('data',d=>{text+=d;if(text.includes('\n')){clearTimeout(timer);s.end();const r=JSON.parse(text.split('\n')[0]);if(!r.ok&&!options.allowError)reject(Error('Request rejected '+command));else resolve(options.allowError?r:r.value)}});s.on('error',e=>{clearTimeout(timer);reject(e)})
 })
}
const children=[];
function start(role,extra={}){const child=spawn(path.join(binary,role),[],{env:{...env,...(role==='center'?{NARUTO_C_TOKEN:read('capabilities.json').center}:{}),...extra},stdio:['ignore','ignore','pipe']});let error='';child.stderr.on('data',b=>error+=b);child.on('exit',code=>{if(code&&error)console.error(role+' exited '+code+' '+error.slice(0,500))});children.push(child);return child}
let hostPID,corePID,second;
async function sample(label){const s=await request('snapshot');const proc=await exec('ps',['-axo','pid=,ppid=,rss=,%cpu=,command=']);const lines=proc.stdout.split('\n').filter(l=>{const pid=Number(l.trim().split(/\s+/)[0]);const ppid=Number(l.trim().split(/\s+/)[1]);return [s.corePID,s.centerPID,s.hostPID].filter(Boolean).includes(pid)||ppid===s.hostPID});
 const values=[];for(const l of lines){const [pid,ppid,rss,cpu]=l.trim().split(/\s+/);let footprintMiB=null;try{const out=await exec('vmmap',['-summary',pid],{maxBuffer:5e6});const m=out.stdout.match(/Physical footprint:\s+([\d.]+)([KMG])/);if(m)footprintMiB=Number(m[1])*({K:1/1024,M:1,G:1024}[m[2]])}catch{}values.push({pid:+pid,ppid:+ppid,rssKiB:+rss,cpuPercent:+cpu,footprintMiB,role:+pid===s.corePID?'core':+pid===s.centerPID?'center':+pid===s.hostPID?'host':l.includes('--type=gpu-process')?'GPU':l.includes('--type=ppapi')?'PPAPI':l.includes('--type=renderer')?'Renderer':'Utility'})}
 try {const aggregate=await exec('/usr/bin/footprint',[...values.map(v=>String(v.pid)),'--noCategories','--json',path.join(root,label+'-footprint.json')],{maxBuffer:5e6});fs.writeFileSync(path.join(root,label+'-footprint.txt'),aggregate.stdout);}catch(error){fs.writeFileSync(path.join(root,label+'-footprint-unavailable.txt'),String(error.message));}
 const file=path.join(root,'measurements.json');const records=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):[];records.push({label,values});fs.writeFileSync(file,JSON.stringify(records,null,2));return values}
const reconcileOnly=process.argv.includes('--reconcile-only');
const maintenanceOnly=process.argv.includes('--maintenance-only');
const uiOnly=process.argv.includes('--ui-only');
const historyOnly=process.argv.includes('--history-only');let legacyHistory=[];let legacyBytes=0;
if(historyOnly){
 legacyHistory=Array.from({length:1800},()=>({id:crypto.randomUUID(),profileIds:['br-1'],autoClose:true,items:[{operationId:crypto.randomUUID(),profileId:'br-1',generation:1,status:'closed',accepted:true,reason:''}]}));
 const legacy={version:1,revision:1,profiles:[{id:'br-1',region:'br',slot:1,generation:1,name:'合成巴西账号'},{id:'cn-1',region:'cn',slot:1,generation:1,name:'合成国服账号'}],preferences:{},batches:legacyHistory,hostPID:0};
 const serialized=JSON.stringify(legacy);legacyBytes=Buffer.byteLength(serialized);fs.writeFileSync(path.join(root,'management.json'),serialized);
}

if(reconcileOnly)fs.writeFileSync(path.join(root,'management.json'),JSON.stringify({version:1,revision:1,profiles:[{id:'br-1',region:'br',slot:1,generation:1,name:'合成巴西账号'},{id:'cn-1',region:'cn',slot:1,generation:1,name:'合成国服账号'}],preferences:{},batches:[{id:crypto.randomUUID(),items:[{operationId:crypto.randomUUID(),profileId:'br-1',generation:1,status:'failed',accepted:true}]}],hostPID:0}));
try{
 const firstCore=start('core');corePID=firstCore.pid;await until(()=>request('snapshot'));
 check('core has native management authority and isolated synthetic profiles',(await request('snapshot')).profiles.length===2);
 check('wrong capability is rejected',(await request('snapshot',{}, {bad:true,allowError:true})).ok===false);
 check('wrong protocol major is rejected',(await request('snapshot',{}, {v:2,allowError:true})).ok===false);
 check('center cannot submit host state',(await request('host.poll',{pid:process.pid,instance:'forged',tasks:[],windowShown:true},{allowError:true})).ok===false);
 if(loginTabs){
  const center=start('center');second=center.pid;
  await until(()=>arrivals.length===1);
  let state=await request('snapshot');hostPID=state.hostPID;
  check('one unobscured launch click creates exactly one batch',state.batches.length===1 && state.batches[0].items.length===1);
  await request('catalog.create',{requestId:crypto.randomUUID(),revision:state.revision,region:'br',name:'合成登录乙',serverNote:''});
  await request('batch.start',{requestId:crypto.randomUUID(),profileIds:['br-2']});await until(()=>arrivals.length===2);
  for(const id of ['br-1','br-2','br-1']){
   fs.writeFileSync(path.join(root,'fixture-focus'),id);
   await until(()=>{const rows=read('fixture-status.json').loginTabs;return rows.length===2&&rows.every(t=>t.status==='login-required' && t.active===t.visible)&&rows.find(t=>t.active)?.profile===id;});
  }
  check('switching two pending native logins preserves both documents',arrivals.length===2&&arrivals.every(x=>!x.restored));
  fs.writeFileSync(path.join(root,'fixture-mute'),'');await until(()=>read('fixture-status.json').notice==='已静音');
  await until(()=>!read('fixture-status.json').notice,8000);check('toolbar notice clears automatically',true);
  fs.writeFileSync(path.join(root,'fixture-stop'),'');await until(()=>!alive(hostPID));
  await request('batch.start',{requestId:crypto.randomUUID(),profileIds:['br-1','br-2']});
  await until(()=>arrivals.length===4);hostPID=(await request('snapshot')).hostPID;
  check('reopened WebKit requests carry their own saved session cookies',new Set(arrivals.slice(2).map(x=>x.slot)).size===2&&arrivals.slice(2).every(x=>x.restored));
  fs.writeFileSync(path.join(root,'fixture-stop'),'');await until(()=>!alive(hostPID));
 }else if(reconcileOnly){
  const item=(await request('snapshot')).batches[0].items[0];check('orphan failed receipts are terminal even when saved hostPID is zero',item.status==='interrupted'&&item.accepted===false);
 }else if(uiOnly){
 const center=start('center');second=center.pid;await until(()=>read('ui-check.json').ok!==undefined,20000);
 check('WK baseline UI draws and operates',read('ui-check.json').ok===true);
 }else if(historyOnly){
 check('legacy batch history exceeds the old 256KiB snapshot limit',legacyBytes>262144);
 const state=await request('snapshot');const snapshotBytes=Buffer.byteLength(JSON.stringify(state));
 check('history migration yields a bounded snapshot and recent window',snapshotBytes<131072&&state.batches.length<=16);
 const old=legacyHistory[0];
 check('archived old batch remains queryable by ID',(await request('batch.get',{id:old.id})).batch.id===old.id);
 await request('batch.start',{requestId:old.id,profileIds:old.profileIds});
 check('historical replay does not launch a host',(await request('snapshot')).hostPID===0);
 const live=crypto.randomUUID();await request('batch.start',{requestId:live,profileIds:['br-1','cn-1']});
 await until(()=>{const f=read('fixture-status.json');hostPID=f.pid;return f.tasks.filter(t=>t.status==='ready').length===2});
 const center=start('center');second=center.pid;
 if(maintenanceOnly)await until(()=>read('center-view.json').pid===second&&Object.values(read('center-view.json').rows).every(v=>v.includes('ready')));else await until(()=>read('ui-check.json').ok===true,20000);
 check('WK center reads and operates with large migrated history',true);
 const active=await request('snapshot');
 check('archiving preserves account counts and active deletion protection',active.runningAccountCount===2&&active.profiles.every(p=>p.deleteBlockedReason));
 const refused=await request('catalog.delete',{requestId:crypto.randomUUID(),revision:active.revision,id:'br-1'},{allowError:true});check('busy account deletion remains refused with archived history',refused.ok===false);
 const ticks=read('fixture-status.json').ticks;await sleep(1000);
 check('host keeps polling while historical receipts stay off the wire',read('fixture-status.json').ticks['br-1']>ticks['br-1']);
 process.kill(corePID,'SIGTERM');await until(async()=>{const s=await request('snapshot');return s.corePID!==corePID&&!s.reconciling&&s.hostPID===hostPID},15000);corePID=(await request('snapshot')).corePID;
 await request('batch.start',{requestId:old.id,profileIds:old.profileIds});
 check('archive replay and lookup remain valid after core restart',(await request('batch.get',{id:old.id})).found===true&&read('fixture-status.json').toolbar.tabCount===2);
 const unknown=await request('batch.get',{id:crypto.randomUUID()});check('unknown batch query is explicit without creating work',unknown.found===false);
 fs.writeFileSync(path.join(root,'history-metrics.json'),JSON.stringify({legacyBytes,snapshotBytes,receipts:fs.readdirSync(path.join(root,'batch-receipts')).length},null,2));
 fs.writeFileSync(path.join(root,'fixture-stop'),'');await until(()=>!alive(hostPID),20000);
 }else{
 const first=start('center',{NARUTO_C_AUTO_PROFILES:'br-1,cn-1'});
 await until(()=>read('center-view.json').pid===first.pid);
 await until(()=>{const f=read('fixture-status.json');hostPID=f.pid;return f.tasks.filter(t=>t.status==='ready').length===2 && Object.values(f.quality).every(v=>v==='HIGH')});
 await until(()=>!alive(first.pid));
 check('native center fully exits after per-item takeover',!alive(first.pid));
 check('core and independent host survive center exit',alive(corePID)&&alive(hostPID));
 const tick1=read('fixture-status.json').ticks;await sleep(1600);const tick2=read('fixture-status.json').ticks;
 check('both game pages continue ticking without center',tick2['br-1']>tick1['br-1']&&tick2['cn-1']>tick1['cn-1']);
 check('real Flash instances survive center exit',Object.values(read('fixture-status.json').quality).every(v=>v==='HIGH'));
 const hostWindow=read('fixture-status.json').window;
 check('game traffic lights are centered in the 42px bar',hostWindow.trafficLights.length===3&&hostWindow.trafficLights.every(b=>Math.abs(b.y+b.height/2-21)<1));
 check('actual game host uses a single titlebar and retains settings menu',hostWindow.bounds.height===hostWindow.contentBounds.height&&hostWindow.settingsMenu);

 if (!process.env.NARUTO_C_SKIP_MEASURE) await sample('two-accounts-center-closed');
 await request('center.ensure');second=await until(async()=>{const s=await request('snapshot');return s.centerPID&&s.centerPID!==first.pid?s.centerPID:0});
 await until(()=>read('center-view.json').pid===second&&Object.values(read('center-view.json').rows).every(v=>v.includes('ready')));
 check('reopened native center renders both existing ready accounts',alive(second));
 if(!maintenanceOnly){
 await until(()=>read('ui-check.json').ok===true,20000);check('WK center reuses artwork/settings and supports two cross-region UI batches',true);
 check('WK center draws the original dots and radial lines',read('ui-check.json').background===true);
 check('launcher has no tooltip or decorative status copy',read('ui-check.json').quiet===true);
 check('native launcher drag region is installed',read('center-view.json').dragAreaInstalled===true);
 check('account selection keeps the launch capsule stationary',read('ui-check.json').dockStable===true);
 check('WK traffic lights are centered in the 42px bar',read('center-view.json').trafficLightCenters.length===3&&read('center-view.json').trafficLightCenters.every(y=>Math.abs(y-21)<1));
 check('WK center integrates the native titlebar into one chrome row',read('center-view.json').integratedTitlebar===true);
 }
 await request('center.ensure',{page:'settings'});
 await until(()=>read('center-view.json').settingsOpen===true);
 check('core settings intent opens the existing WK management page',true);

 if (!process.env.NARUTO_C_SKIP_MEASURE) await sample('two-accounts-center-reopened');
 const fresh=async(command,payload={})=>{const state=await request('snapshot');return request(command,{requestId:crypto.randomUUID(),revision:state.revision,...payload})};
 const overview=await request('snapshot');
 check('core projects running account count and busy deletion state',overview.runningAccountCount===2&&overview.profiles.every(p=>p.deleteBlockedReason));
 check('core supplies complete C preferences and catalog availability',overview.preferences.theme==='system'&&typeof overview.preferences.autoClose==='boolean'&&overview.canCreateProfile===true);
 const created=await fresh('catalog.create',{region:'br',name:'合成管理检查',serverNote:'本机隔离'});
 check('native core creates fixed profile slots',created.id==='br-2');
 check('unused profile is not marked busy by the core',(await request('snapshot')).profiles.find(p=>p.id===created.id).deleteBlockedReason==='');
 await fresh('catalog.update',{id:created.id,name:'合成管理更新',serverNote:'已更新'});
 await fresh('catalog.select',{id:created.id});
 check('native catalog rename and default selection persist',(await request('snapshot')).selectedByRegion.br===created.id);
 const denied=await request('preferences.patch',{revision:(await request('snapshot')).revision,key:'muted',value:1},{allowError:true});
 check('native preferences reject numeric pseudo-booleans',denied.ok===false);
 const saved=await request('credentials.addManual',{siteId:'br',username:'synthetic-core-user',password:'synthetic-password-one'});
 check('native core manages isolated keychain',saved.status==='saved');
 const offer=await request('credentials.addManual',{siteId:'br',username:'synthetic-core-user',password:'synthetic-password-two'});
 check('password duplicate update requires explicit confirmation',offer.status==='confirm-update');
 await request('credentials.remove',{id:offer.id});
 const stale=await request('credentials.addManual',{siteId:'br',username:'synthetic-core-user',password:'synthetic-password-two',expected:{id:offer.id,version:offer.version}});
 check('deleted password cannot be resurrected by old confirmation',stale.status==='stale'&&(await request('credentials.metadata')).records.length===0);
 check('editing deleted password is rejected',(await request('credentials.edit',{id:offer.id,origin:'https://naruto.narutowebgame.com',username:'synthetic-core-user',password:'synthetic-password-three'},{allowError:true})).ok===false);

 for(const username of ['synthetic-unique-a','synthetic-unique-b'])await request('credentials.addManual',{siteId:'br',username,password:username});
 const uniqueRecords=(await request('credentials.metadata')).records;
 const uniqueB=uniqueRecords.find(r=>r.username==='synthetic-unique-b');
 const duplicate=await request('credentials.edit',{id:uniqueB.id,origin:uniqueB.origin,expectedVersion:uniqueB.version,username:'synthetic-unique-a',password:'synthetic-changed'},{allowError:true});
 check('editing credentials rejects duplicate site and username without changing records',duplicate.ok===false&&(await request('credentials.reveal',{id:uniqueB.id})).password==='synthetic-unique-b'&&(await request('credentials.metadata')).records.length===2);
 await request('credentials.edit',{id:uniqueB.id,origin:uniqueB.origin,expectedVersion:uniqueB.version,username:'synthetic-unique-c',password:'synthetic-edited'});
 check('editing credentials to a unique username still succeeds',(await request('credentials.reveal',{id:uniqueB.id})).password==='synthetic-edited');
 for(const record of uniqueRecords)await request('credentials.remove',{id:record.id});
 const activeDelete=await request('catalog.delete',{requestId:crypto.randomUUID(),revision:(await request('snapshot')).revision,id:'br-1'},{allowError:true});
 check('native deletion blocks running and pending account tasks',activeDelete.ok===false);
 await fresh('catalog.delete',{id:created.id});
 const late=await request('batch.start',{requestId:crypto.randomUUID(),profileIds:[created.id]});
 check('deleting profile rejects late launch authorization',late.items[0].status==='rejected');
 await until(async()=>!(await request('snapshot')).profiles.some(p=>p.id===created.id));
 const next=await fresh('catalog.create',{region:'br',name:'合成槽位检查',serverNote:''});
 check('deleted slots are never reused',next.id==='br-3');
 await fresh('catalog.delete',{id:next.id});await until(async()=>!(await request('snapshot')).profiles.some(p=>p.id===next.id));


 const importId=crypto.randomUUID();const importState=await request('snapshot');
 const importPayload={requestId:importId,revision:importState.revision,profiles:[{id:'br-8',region:'br',slot:8,name:'本机合成导入',serverNote:'仅测试'}],selectedByRegion:{br:'br-8'},deletedIds:['br-7'],credentials:[{id:'import-synthetic',origin:'https://passport.narutowebgame.com',username:'synthetic-import-user',password:'synthetic-import-password',updatedAt:'2026-11-06T00:00:00Z'}]};
 const imported=await request('catalog.importLocal',importPayload);
 check('local import preserves fixed profile slots and imports credentials',imported.profiles===1&&imported.credentialsChanged===1&&(await request('snapshot')).profiles.some(p=>p.id==='br-8'&&p.slot===8));
 const importRevision=(await request('snapshot')).revision;await request('catalog.importLocal',importPayload);
 check('local import request replay does not apply twice',(await request('snapshot')).revision===importRevision);
 const newerImport={...importPayload,requestId:crypto.randomUUID(),revision:(await request('snapshot')).revision,credentials:[{...importPayload.credentials[0],password:'synthetic-import-newer',updatedAt:'2026-11-06T00:00:00.900Z'}]};await request('catalog.importLocal',newerImport);
 const credential=(await request('credentials.metadata')).records.find(r=>r.username==='synthetic-import-user');check('local import compares fractional timestamps as dates',(await request('credentials.reveal',{id:credential.id})).password==='synthetic-import-newer');await request('credentials.remove',{id:credential.id});
 await fresh('catalog.delete',{id:'br-8'});await until(async()=>!(await request('snapshot')).profiles.some(p=>p.id==='br-8'));
 const before=await request('snapshot');const requestId=before.batches[0].id;
 await request('batch.start',{requestId,profileIds:before.batches[0].profileIds});
 check('same request ID returns original batch',(await request('snapshot')).batches.length===before.batches.length);
 const droppedId=crypto.randomUUID();await request('batch.start',{requestId:droppedId,profileIds:['br-1']},{drop:true});await sleep(500);await request('batch.start',{requestId:droppedId,profileIds:['br-1']});await sleep(1200);
 check('lost ACK replay retains one operation and does not duplicate Flash tabs',(await request('snapshot')).batches.filter(b=>b.id===droppedId).length===1&&Object.keys(read('fixture-status.json').ticks).length===2);
 await until(()=>read('fixture-status.json').toolbar.tabCount===2);
 check('operation aliases render only one toolbar tab per account',true);
 for(const id of ['cn-1','br-1']){fs.writeFileSync(path.join(root,'fixture-focus'),id);await until(()=>read('fixture-status.json').activeProfile===id);}
 check('actual toolbar clicks switch both game accounts through the host bridge',true);

 const partialId=crypto.randomUUID();await request('batch.start',{requestId:partialId,profileIds:['cn-1','missing-profile']});await until(async()=>{const b=(await request('snapshot')).batches.find(b=>b.id===partialId);return b.items.some(i=>i.status==='rejected')&&b.items.some(i=>i.accepted)});
 check('partial batch refusal remains explicit while accepted games continue',alive(hostPID));

 const credentialOperation=(await request('snapshot')).batches.flatMap(b=>b.items).find(i=>i.profileId==='br-1'&&i.accepted&&i.status==='ready').operationId;
 for(const origin of ['https://passport.narutowebgame.com','https://s776-narutopt.oasgames.com','https://naruto-pt-s776.oasgames.com']){const result=await request('credentials.needsSave',{operationId:credentialOperation,origin,username:'synthetic-policy',password:'synthetic-policy'},{role:'host'});check('core credential policy accepts '+new URL(origin).hostname,result.needed===true);}

 for(const origin of ['https://passport.narutowebgame.com','https://s776-narutopt.oasgames.com']){
  const saved=await request('credentials.stageSave',{operationId:credentialOperation,origin,username:'synthetic-policy-save',password:'synthetic-policy-save'},{role:'host'});
  const record=(await request('credentials.metadata')).records.find(r=>r.origin===origin&&r.username==='synthetic-policy-save');
  await request('credentials.edit',{id:record.id,origin,expectedVersion:record.version,username:'synthetic-policy-edit',password:'synthetic-policy-edit'});
  check('accepted credential origin can be saved and edited end to end: '+new URL(origin).hostname,saved.status==='saved'&&(await request('credentials.reveal',{id:record.id})).password==='synthetic-policy-edit');
  await request('credentials.remove',{id:record.id});
 }
 check('core credential policy rejects unrelated hosts',(await request('credentials.needsSave',{operationId:credentialOperation,origin:'https://evil.example',username:'synthetic-policy',password:'synthetic-policy'},{role:'host',allowError:true})).ok===false);
 const prefs=await request('snapshot');await request('preferences.patch',{revision:prefs.revision,key:'quality',value:'low'});await until(()=>Object.values(read('fixture-status.json').quality).every(v=>v==='LOW'));
 check('core quality preference reaches actual Flash stages',true);
 const duplicateCenter=start('center');await until(()=>!alive(duplicateCenter.pid));
 check('duplicate center exits without unregistering live center',(await request('snapshot')).centerPID===second);
 process.kill(corePID,'SIGTERM');await until(async()=>{const s=await request('snapshot');return s.corePID!==corePID&&!s.reconciling&&s.hostPID===hostPID},15000);const restarted=await request('snapshot');corePID=restarted.corePID;
 check('host restarts native core and reconciles same host instance',alive(hostPID)&&read('fixture-status.json').pid===hostPID);
 await until(async()=>(await request('snapshot')).centerPID===second);
 check('live center re-registers after core restart',true);
 check('reconciled tasks preserve existing accounts',Object.keys(read('fixture-status.json').ticks).length===2);
 await request('batch.start',{requestId,profileIds:before.batches[0].profileIds});
 check('durable request receipts survive core restart',(await request('snapshot')).batches.filter(b=>b.id===requestId).length===1);
 fs.writeFileSync(path.join(root,'fixture-fail-session-write'),'');
 fs.writeFileSync(path.join(root,'fixture-session-cookie'),'');
 await until(()=>read('fixture-status.json').sessionMarkers['br-1']==='synthetic-exit-retry');
 fs.writeFileSync(path.join(root,'fixture-stop'),'');await until(()=>read('fixture-status.json').exitState==='save-failed'&&read('fixture-status.json').toolbar.retryExitVisible);
 check('failed session save keeps a quiescent host without notifying exit',alive(hostPID)&&(await request('snapshot')).hostPID===hostPID);
 const waitingBatch=crypto.randomUUID();await request('batch.start',{requestId:waitingBatch,profileIds:['br-1']});await sleep(900);
 check('save-failed host does not take over newly submitted work',(await request('batch.get',{id:waitingBatch})).batch.items.every(i=>i.status==='pending'&&!i.accepted));
 fs.unlinkSync(path.join(root,'fixture-fail-session-write'));fs.writeFileSync(path.join(root,'fixture-stop'),'');await until(()=>!alive(hostPID),20000);
 check('host retries session saving and exits after storage recovers',true);
 const afterExit=await request('snapshot');check('normal host exit clears instance and marks receipts interrupted',afterExit.hostPID===0&&afterExit.hostInstance==='');
 if(fs.existsSync(path.join(root,'fixture-stop')))fs.unlinkSync(path.join(root,'fixture-stop'));
 const hostReceipt=read('host-receipts.json');hostReceipt.window={bounds:{x:100,y:100,width:1030,height:720},maximized:false,fullscreen:false};fs.writeFileSync(path.join(root,'host-receipts.json'),JSON.stringify(hostReceipt));
 const restartBatch=crypto.randomUUID();await request('batch.start',{requestId:restartBatch,profileIds:['br-1']});
 await until(()=>{const f=read('fixture-status.json');return f.pid!==hostPID&&f.tasks.some(t=>t.status==='ready')});hostPID=read('fixture-status.json').pid;
 check('same core starts a fresh host after normal shutdown',alive(hostPID));
 check('restarted host reads the session cookie saved by exit retry',read('fixture-status.json').sessionMarkers['br-1']==='synthetic-exit-retry');
 check('host restores its saved normal window dimensions',read('fixture-status.json').window.bounds.width===1030&&read('fixture-status.json').window.bounds.height===720);
 fs.writeFileSync(path.join(root,'fixture-stop'),'');await until(()=>!alive(hostPID),20000);
 process.kill(second,'SIGTERM');await sleep(300);
 await until(()=>!alive(corePID),15000);check('idle core exits without a resident service',true);
 }
 fs.writeFileSync(path.join(root,'results.json'),JSON.stringify({ok:true,results,root},null,2));
 console.log('原型验证资料：'+root);
}catch(error){fs.writeFileSync(path.join(root,'results.json'),JSON.stringify({ok:false,results,error:String(error)},null,2));console.error(error);process.exitCode=1;
}finally{loginServer?.close();if(fs.existsSync(path.join(root,'fixture-fail-session-write')))fs.unlinkSync(path.join(root,'fixture-fail-session-write'));for(const child of children)if(alive(child.pid))child.kill('SIGTERM');if(second&&alive(second))process.kill(second,'SIGTERM');if(hostPID&&alive(hostPID)){fs.writeFileSync(path.join(root,'fixture-stop'),'');}if(corePID&&alive(corePID))process.kill(corePID,'SIGTERM');
if(hostPID&&alive(hostPID))try{await until(()=>!alive(hostPID),20000)}catch{process.kill(hostPID,'SIGTERM')}
for(const service of [`cn.youye.naruto-os.test.sessions.native-core.${path.basename(root)}`,`cn.youye.naruto-os.test.native-core.credentials.${path.basename(root)}`]){const cleanup=spawn(path.join(project,'dist/native/keychain'),[],{stdio:['pipe','ignore','ignore']});cleanup.stdin.end(JSON.stringify({action:'delete-test',service}));}
}
