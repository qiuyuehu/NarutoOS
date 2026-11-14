// Real Swift core + Electron host. All profiles, pages and credentials are synthetic.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import electron from 'electron';
const project=path.resolve(import.meta.dirname,'..');
const root=fs.mkdtempSync(path.join(project,'.test-artifacts/native-core-attempt-'));
const hash=crypto.createHash('sha256').update(root).digest('hex').slice(0,16);
const socket=`/tmp/naruto-c-${process.getuid()}-${hash}.sock`,backend=`/tmp/naruto-attempt-${hash}.sock`;
const pause=ms=>new Promise(r=>setTimeout(r,ms)),read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const alive=pid=>{try{process.kill(pid,0);return true}catch{return false}};
async function until(fn,timeout=15000){const started=Date.now();let last;while(Date.now()-started<timeout){try{const value=await fn();if(value)return value}catch(e){last=e}await pause(25)}throw Error('condition timeout '+(last?.message||''))}
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port}
const rendererPort=await freePort(),mainPort=await freePort();
const wrapper=path.join(root,'electron-fixture');const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
fs.writeFileSync(wrapper,`#!/bin/sh\nexec ${quote(electron)} --remote-debugging-address=127.0.0.1 --remote-debugging-port=${rendererPort} --inspect=127.0.0.1:${mainPort} "$@"\n`,{mode:0o700});
const env={...process.env,NARUTO_C_ROOT:root,NARUTO_C_PROJECT:project,NARUTO_C_ELECTRON:wrapper,NARUTO_C_FIXTURE:'1',NARUTO_C_UI_CHECKS:'0'};delete env.ELECTRON_RUN_AS_NODE;
const gate={armed:false,held:null};const connections=new Set();let proxy,server,hostPID,core,renderer,main;
const results=[];function check(name,ok,detail={}){results.push({name,ok:!!ok,...detail});console.log((ok?'PASS ':'FAIL ')+name)}
function request(command,payload={},role='center') {return new Promise((resolve,reject)=>{let data='';const token=read('capabilities.json')[role],c=net.createConnection(socket),timer=setTimeout(()=>{c.destroy();reject(Error('IPC timeout'))},3500);c.on('error',e=>{clearTimeout(timer);reject(e)});c.on('connect',()=>c.write(JSON.stringify({v:1,role,token,command,payload})+'\n'));c.on('data',b=>{data+=b;if(!data.includes('\n'))return;clearTimeout(timer);c.end();const r=JSON.parse(data.split('\n')[0]);r.ok?resolve(r.value):reject(Error(r.message))})})}
async function debug(port,match){const targets=await until(async()=>{const r=await fetch(`http://127.0.0.1:${port}/json/list`);return r.ok?await r.json():null});const target=targets.find(match);if(!target)throw Error('debug target missing');const ws=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let seq=0;await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});ws.addEventListener('message',event=>{const r=JSON.parse(event.data);const p=pending.get(r.id);if(p){pending.delete(r.id);r.error?p.reject(Error(r.error.message)):p.resolve(r.result)}});return {close:()=>ws.close(),call:(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))}),async eval(expression){const r=await this.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error('debug expression failed: '+JSON.stringify(r.exceptionDetails));return r.result.value}}}
const pages=()=>main.eval(`(async()=>{const result=[];for(const w of process.mainModule.require('electron').webContents.getAllWebContents()){if(w.getType()!=='browserView')continue;const c=await w.session.cookies.get({name:'proto-synthetic'});result.push({id:w.id,region:c[0]?.value||null,loading:w.isLoading()})}return result})()`);
try{
 core=spawn(path.join(project,'dist/prototype/native/core'),[],{env,stdio:['ignore','ignore','pipe']});core.stderr.on('data',b=>fs.appendFileSync(path.join(root,'core.log'),b));
 await until(()=>fs.existsSync(socket));fs.renameSync(socket,backend);
 proxy=net.createServer(front=>{connections.add(front);let input='',started=false;front.on('close',()=>connections.delete(front));front.on('error',()=>{});front.on('data',chunk=>{input+=chunk;if(started||!input.includes('\n'))return;started=true;const message=JSON.parse(input.split('\n')[0]);const hold=gate.armed&&message.role==='host'&&message.command==='snapshot';if(hold)gate.armed=false;const back=net.createConnection(backend);connections.add(back);back.on('error',()=>front.destroy());back.on('close',()=>connections.delete(back));let response='';back.on('connect',()=>back.write(input));if(hold){const held={ready:false,started:Date.now(),release(){if(!front.writableEnded&&!front.destroyed)front.end(response)}};gate.held=held;back.on('data',b=>{response+=b});back.on('end',()=>{held.ready=true})}else {back.on('data',b=>front.write(b));back.on('end',()=>front.end())}front.on('close',()=>back.destroy());})});await new Promise(r=>proxy.listen(socket,r));
 const seed=await request('batch.start',{requestId:crypto.randomUUID(),profileIds:['cn-1']});
 await until(()=>{const f=read('fixture-status.json');hostPID=f.pid;return f.tasks.some(t=>t.operationId===seed.items[0].operationId&&t.status==='ready')});
 renderer=await debug(rendererPort,t=>t.type==='page'&&t.url.endsWith('/toolbar.html'));main=await debug(mainPort,()=>true);
 const seeded=await request('credentials.addManual',{siteId:'br',username:'synthetic-edit-race',password:'synthetic-old'});const initial=(await request('credentials.metadata')).records.find(r=>r.username==='synthetic-edit-race');
 await request('credentials.stageSave',{operationId:seed.items[0].operationId,origin:initial.origin,username:initial.username,password:'synthetic-new'},'host');
 let rejected=false;try{await request('credentials.edit',{id:initial.id,origin:initial.origin,username:initial.username,password:'synthetic-old',expectedVersion:initial.version})}catch{rejected=true}
 check('stale center edit cannot overwrite newer game password',rejected&&(await request('credentials.reveal',{id:initial.id})).password==='synthetic-new');
 let missingRejected=false;try{await request('credentials.edit',{id:initial.id,origin:initial.origin,username:initial.username,password:'synthetic-unversioned'})}catch{missingRejected=true}
 check('unversioned edit is rejected without overwriting the record',missingRejected&&(await request('credentials.reveal',{id:initial.id})).password==='synthetic-new');
 const latest=(await request('credentials.metadata')).records.find(r=>r.id===initial.id);await request('credentials.edit',{id:initial.id,origin:initial.origin,username:initial.username,password:'synthetic-fresh',expectedVersion:latest.version});check('fresh center edit still saves', (await request('credentials.reveal',{id:initial.id})).password==='synthetic-fresh');
 gate.armed=true;const old=await request('batch.start',{requestId:crypto.randomUUID(),profileIds:['br-1']});
 await until(()=>gate.held?.ready);const held=gate.held;
 await renderer.eval(`document.querySelector('[data-tab-id="${old.items[0].operationId}"] .tab-close').click()`);
 await until(async()=>{const b=await request('batch.get',{id:old.id});return b.batch.items[0].status==='cancelled'},1400);
 const fresh=await request('batch.start',{requestId:crypto.randomUUID(),profileIds:['br-1']});
 await until(()=>read('fixture-status.json').tasks.some(t=>t.operationId===fresh.items[0].operationId&&t.status==='queued'),1700);
 const heldMs=Date.now()-held.started;held.release();check('new operation is received before old snapshot reply is released',heldMs<2800,{heldMs});
 await until(async()=>{const b=await request('batch.get',{id:fresh.id});return ['ready','cancelled','closed','failed'].includes(b.batch.items[0].status)},8000);
 const after=(await request('batch.get',{id:fresh.id})).batch.items[0];check('cancelled old startup cannot cancel the new startup',after.status==='ready',{status:after.status});
 check('old cancellation does not replace the new startup notice',!(await renderer.eval('document.getElementById("notice").textContent')).includes('未能启动'));
 server=http.createServer((_req,res)=>{res.writeHead(403,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end('synthetic failure')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const original=(await pages()).find(p=>p.region==='cn');await main.eval(`process.mainModule.require('electron').webContents.fromId(${original.id}).loadURL('http://127.0.0.1:${server.address().port}/failed').catch(()=>{})`);
 await until(async()=>(await request('batch.get',{id:seed.id})).batch.items[0].status==='failed');
 const restarted=await request('batch.start',{requestId:crypto.randomUUID(),profileIds:['cn-1']});await until(async()=>(await pages()).some(p=>p.region==='cn'&&p.id!==original.id));await pause(700);
 const newer=(await request('batch.get',{id:restarted.id})).batch.items[0],currentPages=await pages();check('failed restart reports the new page state',newer.status==='ready',{status:newer.status});
 check('failed old page is retired before the replacement runs',!currentPages.some(p=>p.id===original.id));
 const newPage=currentPages.find(p=>p.region==='cn'&&p.id!==original.id);
 const replay=await request('batch.start',{requestId:crypto.randomUUID(),profileIds:['cn-1']});
 await until(async()=>(await request('batch.get',{id:replay.id})).batch.items[0].status==='ready');
 check('same-account replay shares the current page', (await pages()).filter(p=>p.region==='cn').length===1);
 await renderer.eval(`Array.from(document.querySelectorAll('[data-profile-id="cn-1"] .tab-close')).slice(-1)[0].click()`);await pause(600);
 check('closing restarted page destroys that exact page',!(await pages()).some(p=>p.id===newPage.id));
 await until(async()=>{const a=await request('batch.get',{id:restarted.id}),b=await request('batch.get',{id:replay.id});return a.batch.items[0].status==='closed'&&b.batch.items[0].status==='closed'});
 check('closing a page closes all aliases of that attempt',true);
 check('unrelated account remains running',after.status!=='ready'||(await pages()).some(p=>p.region==='br'));
 renderer.close();main.close();renderer=undefined;main=undefined;
 fs.writeFileSync(path.join(root,'fixture-stop'),'');await until(()=>!alive(hostPID));hostPID=undefined;
}catch(error){check('test setup and cross-process execution',false,{error:String(error)})}
finally{gate.held?.release();renderer?.close();main?.close();if(hostPID&&alive(hostPID)){fs.writeFileSync(path.join(root,'fixture-stop'),'');await until(()=>!alive(hostPID),5000).catch(()=>{try{process.kill(hostPID,'SIGTERM')}catch{}})}if(core&&alive(core.pid)){core.kill('SIGTERM');await new Promise(r=>core.once('exit',r))}for(const c of connections)c.destroy();proxy?.close();server?.close();for(const file of [socket,backend])try{fs.unlinkSync(file)}catch{};fs.writeFileSync(path.join(root,'results.json'),JSON.stringify({ok:results.every(r=>r.ok),results},null,2));console.log('三项边界回归：'+root);if(results.some(r=>!r.ok))process.exitCode=1}
