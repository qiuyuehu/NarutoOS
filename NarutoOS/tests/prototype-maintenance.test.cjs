const {attachTaskQueue,loadTaskQueue}=require('./helpers/host-task-queue.cjs');
const TaskQueue=loadTaskQueue();
const i18n=require('./helpers/i18n.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function source(file,names){const tree=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true),found={};function visit(n){if(ts.isFunctionDeclaration(n)&&names.includes(n.name?.text))found[n.name.text]=n.getText(tree).replace(/^export /,'');if(names.includes('handler')&&ts.isCallExpression(n)&&n.expression.getText(tree)==='ipcMain.handle'&&n.arguments[0]?.getText(tree)==="'prototype:command'")found.handler='var handler='+n.arguments[1].getText(tree);ts.forEachChild(n,visit)}visit(tree);return Object.values(found).map(s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText).join('\n')}
const host=source('src/prototype/host/main.ts',['handler']),launch=source('src/prototype/launcher/bridge.ts',['launch']);
const shutdownFile=require('node:path').resolve('src/prototype/host/shutdown.ts');
const shutdownBundle=require('esbuild').buildSync({entryPoints:[shutdownFile],bundle:true,platform:'node',format:'cjs',write:false});
const shutdownModule=new (require('node:module'))(shutdownFile);
shutdownModule._compile(shutdownBundle.outputFiles[0].text,shutdownFile);
const {createShutdown}=shutdownModule.exports;
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
function launchFixture(query){const calls=[];let n=0;const ctx={requestBatch:undefined,lastBatchId:undefined,notice:'',crypto:{randomUUID:()=>String(++n)},sync:async()=>{},request:async(command,payload)=>{calls.push({command,id:payload.id||payload.requestId,ids:payload.profileIds?.join(',')});if(command==='batch.get')return query;if(calls.length===1)throw Error('synthetic lost ACK');return {items:[]}}};Object.assign(ctx,i18n);vm.createContext(ctx);vm.runInContext(launch,ctx);return {ctx,calls}}
test('same selection retries its original batch identity',async()=>{const f=launchFixture();await assert.rejects(f.ctx.launch(['br-1']));await f.ctx.launch(['br-1']);assert.equal(f.calls[0].id,f.calls[1].id)});
test('changed selection queries the old receipt before sending a fresh identity',async()=>{for(const query of [{found:false},{found:true,batch:{items:[{status:'ready',accepted:true}]}}]){const f=launchFixture(query);await assert.rejects(f.ctx.launch(['br-1']));await f.ctx.launch(['cn-1']);assert.equal(f.calls[1].command,'batch.get');assert.equal(f.calls[1].id,f.calls[0].id);assert.equal(f.calls[2].ids,'cn-1');assert.notEqual(f.calls[0].id,f.calls[2].id)}});
test('unresolved previous takeover blocks a changed selection without replaying old accounts',async()=>{const f=launchFixture({found:true,batch:{items:[{status:'pending',accepted:false}]}});await assert.rejects(f.ctx.launch(['br-1']));await assert.rejects(f.ctx.launch(['cn-1']));assert.equal(f.calls.length,2);assert.equal(f.ctx.requestBatch.id,f.calls[0].id)});
function hostFixture(confirmExit=()=>undefined){
 const wc={},calls=[];let fail=true;
 const ctx={loginPages:new Map(),win:{webContents:wc,isDestroyed:()=>false},fixture:true,savingPassword:undefined,pendingSave:undefined,
  get shutting(){return ctx.hostShutdown.stopping},
  tasks:new Map([['q',{status:'queued'}]]),queue:[{}],recoveryQueue:['x'],
  core:async command=>calls.push(command),paint(){},report(){}};
 Object.assign(ctx,i18n);vm.createContext(ctx);const queue=attachTaskQueue(ctx,TaskQueue);
 ctx.hostShutdown=createShutdown({
  confirmExit,
  stopPolling:()=>calls.push('stop-poll'),
  async prepareExit(){
   queue.cancelAll();ctx.pendingSave=undefined;
   calls.push('close','destroy');await queue.idle;
  },
  async saveSessions(){calls.push('flush');if(fail)throw Error('synthetic write failure')},
  acknowledgeExit:()=>ctx.core('host.closed'),
  exit:()=>calls.push('exit'),
  paint:ctx.paint,
  showSaveFailure:ctx.report,
  sendUpdateHandoff:async state=>calls.push(state),
 });
 vm.runInContext(host,ctx);
 return {ctx,calls,shutdown:ctx.hostShutdown,event:{sender:wc},recover:()=>{fail=false}};
}
test('failed exit stays quiescent, rejects game commands and retries only saving',async()=>{
 const f=hostFixture();await f.shutdown.shutdown();
 assert.equal(f.shutdown.state,'save-failed');assert.equal(f.shutdown.stopping,true);
 assert.equal(f.ctx.queue.length,0);assert.equal(f.ctx.tasks.get('q').status,'cancelled');
 assert.equal(f.calls.includes('host.closed'),false);assert.equal(f.calls.includes('exit'),false);
 await f.ctx.handler(f.event,{type:'mute'});f.recover();
 await f.ctx.handler(f.event,{type:'retry-exit'});
 assert.equal(f.shutdown.state,'closed');
 assert.deepEqual(f.calls,['stop-poll','close','destroy','flush','flush','host.closed','exit']);
});
test('repeated exit while confirmation is open shares one attempt and cancel restores service',async()=>{
 const gate=defer();let dialogs=0;
 const f=hostFixture(()=>{dialogs++;return gate.promise});
 const a=f.shutdown.shutdown(),b=f.shutdown.shutdown();
 assert.equal(a,b);assert.equal(dialogs,1);gate.resolve(false);await a;
 assert.equal(f.shutdown.state,'running');assert.equal(f.shutdown.stopping,false);
 assert.equal(f.calls.includes('close'),false);assert.equal(f.calls.includes('stop-poll'),false);
});
function pending(){return {username:'synthetic',password:'synthetic-only',expires:Date.now()+60000}}
test('failed password save retains its request and succeeds on retry',async()=>{const f=hostFixture();const item=pending();f.ctx.pendingSave=item;let fail=true;f.ctx.core=async()=>{if(fail)throw Error('synthetic disconnect')};await f.ctx.handler(f.event,{type:'save'});assert.equal(f.ctx.pendingSave===item,true);assert.equal(item.saveFailed,true);fail=false;await f.ctx.handler(f.event,{type:'save'});assert.equal(f.ctx.pendingSave,undefined)});
test('old password completion cannot clear or resurrect another request',async()=>{for(const succeeds of [true,false]){const f=hostFixture(),gate=defer(),old=pending(),next=pending();f.ctx.pendingSave=old;f.ctx.core=()=>gate.promise;const save=f.ctx.handler(f.event,{type:'save'});f.ctx.pendingSave=next;succeeds?gate.resolve():gate.reject(Error('synthetic disconnect'));await save;assert.equal(f.ctx.pendingSave===next,true)}const f=hostFixture(),gate=defer();f.ctx.pendingSave=pending();f.ctx.core=()=>gate.promise;const save=f.ctx.handler(f.event,{type:'save'});f.ctx.pendingSave=undefined;gate.reject(Error('synthetic disconnect'));await save;assert.equal(f.ctx.pendingSave,undefined)});
test('expired password prompts are discarded without sending secrets',async()=>{const f=hostFixture();f.ctx.pendingSave={...pending(),expires:Date.now()-1};let writes=0;f.ctx.core=async()=>writes++;await f.ctx.handler(f.event,{type:'save'});assert.equal(f.ctx.pendingSave,undefined);assert.equal(writes,0)});

test('password editor keeps its opened version through the center bridge',async()=>{
 const calls=[],buttons=[];let dialog;
 const item={id:'synthetic-record',origin:'https://huoying.qq.com',username:'synthetic',version:'opened-version'};
 const element=()=>({append(){},replaceChildren(){},setAttribute(){},classList:{add(){}},addEventListener(event,fn){buttons.push({label:this.textContent,fn})}});
 const containers=new Map();
 const ctx={setText:(node,value)=>{node.textContent=i18n.resolveText(value)},URL,
  $:id=>{if(!containers.has(id))containers.set(id,element());return containers.get(id)},
  document:{createElement:element,querySelectorAll:()=>[]},isSettingsOpen:()=>true,
  toast(){},openDialog:async value=>{dialog=value},
  api:{credentials:async()=>[item],reveal:async()=> 'synthetic-old',edit:async(...args)=>calls.push(args)}};
 Object.assign(ctx,i18n);vm.createContext(ctx);
 vm.runInContext(source('src/renderer/credentials-view.ts',['createCredentialsView'])+
  '\nvar view=createCredentialsView({api,isSettingsOpen,openDialog,replaceDialogAction(){},toast});',ctx);
 await ctx.view.load();
 buttons.find(b=>b.label==='修改').fn();await new Promise(resolve=>setImmediate(resolve));
 await dialog.action('synthetic','synthetic-old');assert.equal(calls[0][3],'opened-version');
 const tree=ts.createSourceFile('bridge.ts',fs.readFileSync('src/prototype/launcher/bridge.ts','utf8'),ts.ScriptTarget.Latest,true);let edit;
 function find(n){if(ts.isPropertyAssignment(n)&&n.name.getText(tree)==='edit')edit=n.initializer;ts.forEachChild(n,find)}find(tree);
 const requests=[],bridge={request:async(command,payload)=>{requests.push({command,payload});return command==='credentials.metadata'?{records:[{id:item.id,origin:item.origin,version:'new-game-version'}]}:{}}};
 Object.assign(bridge,i18n);vm.createContext(bridge);vm.runInContext(ts.transpileModule('var edit='+edit.getText(tree),{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,bridge);
 await bridge.edit(...calls[0]);assert.equal(requests[1].payload.expectedVersion,'opened-version');
});
