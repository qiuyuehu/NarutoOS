// Executes the actual AS3 class via syntax-only translation. Display/protocol doubles
// exercise control flow; actual Flash UI and server acceptance remain separate.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),{buildSync}=require('esbuild');
const root=path.resolve(__dirname,'..'),work=path.join(root,'.test-artifacts/activity-assist-tests');fs.mkdirSync(work,{recursive:true});
const prefix='com/tencent/morefun/naruto/plugin/operatingActivity/activitys/';
class Display{
 constructor(){Object.assign(this,{visible:true,parent:null,stage:{},listeners:{},frames:{},totalFrames:80,x:0,y:0,graphics:{lineStyle(){},beginFill(){},drawRoundRect(){},endFill(){}}});}
 addChild(c){c.parent=this;return c;}removeChild(c){c.parent=null;}
 addEventListener(e,f){this.listeners[e]=f;}removeEventListener(e,f){if(this.listeners[e]===f)delete this.listeners[e];}
 dispatchEvent(e){e.currentTarget=this;this.listeners[e.type]?.(e);}
 addFrameScript(i,f){this.frames[i]=f;}stop(){this.stopped=true;}gotoAndStop(){this.stopped=true;}gotoAndPlay(){this.stopped=false;}
}
class MouseEvent{static CLICK='click';static MOUSE_DOWN='mousedown';constructor(type){this.type=type;}stopImmediatePropagation(){}}
function fixture(file){
 let s=fs.readFileSync(file,'utf8');s=s.slice(s.indexOf('public class TrainView'),s.lastIndexOf('}'));
 s=s.replace('public class TrainView','class TrainView').replace(/\b(private|public|protected) var /g,'$1 ').replace(/public function TrainView/g,'constructor').replace(/public function get model/g,'get model').replace(/\b(private|public|protected) function /g,'$1 ').replace(/Vector\.<int>/g,'number[]').replace(/:\*/g,':any').replace(/\bsuper\(\);/g,'').replace(/for each\(var hand:HandItem in this.arrHandItem\)/g,'for(const hand of this.arrHandItem)').replace(/function\(\):void/g,'():void =>');
 // AS3 closures bind the instance and resolve bare instance members lexically.
 for(const name of ['model','mBgUI'])s=s.replace(new RegExp('(?<![\\w.])'+name+'\\b','g'),'this.'+name);
 s=s.replace('private this.mBgUI','private mBgUI').replace('get this.model()','get model()').replace(/(?<![\w.])nextNinjutsu\(\);/g,'this.nextNinjutsu();').replace(/(?<![\w.])popFailWin\(\);/g,'this.popFailWin();');
 const js=ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2020},reportDiagnostics:true});assert.equal(js.diagnostics.length,0,js.diagnostics.map(d=>d.messageText+' at '+s.slice(Math.max(0,d.start-35),d.start+50)).join('\n'));
 const requests=[],model={STATUS_STARTED:1,STATUS_FAIL:3,gameStatus:1,finishCount:0,printCount:0,startTime:Date.now(),totalSeconds:60,ninjutsuIndex0:0,ninjutsuIndex1:1,ninjutsuIndex2:2,printList:[{award:[{id:2},{id:5},{id:1}]},{award:[{id:12},{id:3},{id:4},{id:5}]},{award:[{id:6},{id:7},{id:8},{id:9},{id:10},{id:11}]}]};
 const scope={DisplayObject:Display,MovieClip:Display,Sprite:Display,TextField:Display,TextFormat:class{},ColorMatrixFilter:class{},HandItem:Display,MouseEvent,Event:{ENTER_FRAME:'frame'},NinjutsuTrainModel:{instance:model},NinjutsuTrainModel2:{instance:model},NinjutsuOrder:class{constructor(){this.orders=[];}},ProtoNinjaTrainChooseReq:class{},ProtoNinjaTrainRsp:class{},NinjutsuTrainView:Display,NinjutsuTrainView2:Display,NinjutsuTrainSuccessPanel:class{},NinjutsuTrainFailPanel:class{},ButtonNormalBlue:class extends Display{set label(v){this._label=v}get label(){return this._label}},ProtocalUtil:{instance:{sendMessageAndRsp(...args){requests.push(args);}}},ProtocolCmdDef:{CMD_ACTIVITY_NINJA_TRAIN_CHOOSE:'old',CMD_ACTIVITY_NINJA_TRAIN_NEW_CHOOSE:'new'},int:Math.trunc,Date:class extends Date{get time(){return this.getTime();}}};
 const Train=vm.runInNewContext(js.outputText+'\nTrainView',scope);
 // AS3 method closures remain bound when used as event listeners.
 for(const name of Object.getOwnPropertyNames(Train.prototype)){const d=Object.getOwnPropertyDescriptor(Train.prototype,name);if(name!=='constructor'&&typeof d.value==='function'){const cache=new WeakMap();Object.defineProperty(Train.prototype,name,{get(){if(!cache.has(this))cache.set(this,d.value.bind(this));return cache.get(this);}});}}
 const ui=new Display();ui.parent=new Display();ui.parent.parent=new Display();
 for(const key of ['listSpace','finishOneAnim','explodeAnim','wrongMark','ninjutsuName','burnRop'])ui[key]=new Display();
 ui.listSpace.x=87;ui.listSpace.y=429.45;ui.ninjutsuName.y=161.05;
 ui.finishOneAnim.ninjutsuAnim=new Display();ui.finishOneAnim.ninjutsuAnim.hand=new Display();ui.finishOneAnim.ninjutsuAnim.nameImg=new Display();ui.burnRop.fire=new Display();
 for(let i=0;i<6;i++){ui['icon'+i]=new Display();for(const key of ['hand','haloAnim','halo'])ui['icon'+i][key]=new Display();}
 const view=new Train(ui);return {view,ui,model,requests,click:()=>view.onAssistClick(new MouseEvent(MouseEvent.CLICK)),advance:()=>{const a=ui.finishOneAnim.ninjutsuAnim;a.frames[a.totalFrames-1]();}};
}
for(const version of ['ninjutsuTrain','ninjutsuTrain2']){
 const source=path.join(root,'flash-patches/ninjutsu-train-9.40Build300',prefix,version,'TrainView.as'),exported=path.join(root,'.test-artifacts/activity-assist-9.40Build300/patched-export/scripts',prefix,version,'TrainView.as');
 for(const file of process.env.ACTIVITY_ASSIST_EXPORTED==='1'?[source,exported]:[source]){
  const tag=version+'/'+(file===source?'source':'compiled-export');
  test(tag+': button stays inside the measured visible header area',()=>{const {view}=fixture(file);assert(view.assistButton.y>=115&&view.assistButton.y+28<=161.05,'button must sit above the ninjutsu title, inside the frame');});
  test(tag+': one group per click, continue manual progress, animation lock, three groups settle once',()=>{
   const f=fixture(file);assert.equal(f.view.canAssist(),false);f.click();assert.equal(f.model.finishCount,0);f.view.nextNinjutsu();assert.equal(f.view.canAssist(),true);
   f.view.arrHandItem[1].dispatchEvent(new MouseEvent(MouseEvent.MOUSE_DOWN));assert.equal(f.model.printCount,1);
   f.click();assert.equal(f.model.finishCount,1);assert.equal(f.model.printCount,3);assert.equal(f.requests.length,0);assert.equal(f.ui.finishOneAnim.visible,true);assert.equal(f.view.assistButton.mouseEnabled,false);
   f.click();f.click();assert.equal(f.model.finishCount,1);f.advance();assert.equal(f.view.canAssist(),true);assert.equal(f.model.printCount,0);
   f.click();assert.equal(f.model.finishCount,2);f.advance();f.click();assert.equal(f.model.finishCount,3);assert.equal(f.requests.length,0);
   f.click();f.advance();f.click();assert.equal(f.requests.length,1);assert.equal(f.requests[0][0],version==='ninjutsuTrain'?'old':'new');assert.equal(f.requests[0][1].result,1);assert.equal(f.view.canAssist(),false);
  });
  test(tag+': hidden, detached, expired, failed and invalid orders refuse input',()=>{
   for(const alter of [f=>f.ui.parent.visible=false,f=>f.ui.stage=null,f=>f.model.startTime=Date.now()-61000,f=>f.model.gameStatus=3,f=>f.ui.explodeAnim.visible=true,f=>f.model.ninjutsuOrder.orders[1]=13]){
    const f=fixture(file);f.view.nextNinjutsu();alter(f);assert.equal(f.view.canAssist(),false);f.click();assert.equal(f.model.finishCount,0);assert.equal(f.requests.length,0);
   }
  });
  test(tag+': failure locks input and reopening reads a new order',()=>{
   const f=fixture(file);f.view.nextNinjutsu();f.view.fail();f.click();assert.equal(f.model.finishCount,0);assert.equal(f.view.assistButton.mouseEnabled,false);
   f.view.reset();f.model.gameStatus=1;f.model.printCount=0;f.model.finishCount=0;f.model.printList[0]={award:[{id:11},{id:10},{id:9}]};f.view.nextNinjutsu();
   assert.deepEqual(Array.from(f.model.ninjutsuOrder.orders),[11,10,9]);f.click();assert.equal(f.model.finishCount,1);assert.equal(f.requests.length,0);
   f.view.destroy();f.view.onResponse({boxs:{awardStatus:1}});assert.equal(f.requests.length,0);
  });
  test(tag+': closing during animation removes listeners and invalidates callbacks',()=>{
   const f=fixture(file);f.view.nextNinjutsu();f.click();const a=f.ui.finishOneAnim.ninjutsuAnim,callback=a.frames[a.totalFrames-1],button=f.view.assistButton,hands=[...f.view.arrHandItem];f.view.destroy();
   assert.equal(button.listeners.click,undefined);assert.equal(a.stopped,true);assert.equal(a.frames[a.totalFrames-1],null);assert(hands.every(h=>!h.listeners.mousedown));assert.equal(f.view.canAssist(),false);f.click();callback();assert.equal(f.requests.length,0);
  });
 }
}
for(const [name,entry] of [['loader','activity-assist'],['localization','localization-experiment']])buildSync({entryPoints:[path.join(root,'src/main/'+entry+'.ts')],outfile:path.join(work,name+'.cjs'),bundle:true,platform:'node',target:'node12',external:['electron']});
function load(name,app){const Module=require('node:module'),file=path.join(work,name+'.cjs'),m=new Module(file,module);m.filename=file;m.paths=module.paths;m.require=function(id){return id==='electron'?{app}:Module.prototype.require.call(this,id);};m._compile(fs.readFileSync(file,'utf8'),file);return m.exports;}
test('loader: default off, legacy/new flags, isolation, localization on/off and exact resource matching',async()=>{
 const before=[process.env.NARUTO_ACTIVITY_ASSIST,process.env.NARUTO_DAMO_ASSIST],project=fs.mkdtempSync(path.join(work,'dev-project-')),data=path.join(project,'.test-artifacts/profile'),{createActivityAssist}=load('loader',{isPackaged:false,getPath:()=>data});
 const devAssets=path.join(project,'.test-artifacts/activity-assist-9.40Build300');fs.mkdirSync(devAssets,{recursive:true});fs.cpSync(path.join(root,'assets/activity-assist-9.40Build300'),devAssets,{recursive:true});
 try{
  delete process.env.NARUTO_ACTIVITY_ASSIST;delete process.env.NARUTO_DAMO_ASSIST;assert.equal(createActivityAssist(project),undefined);
  process.env.NARUTO_DAMO_ASSIST='1';assert(createActivityAssist(project));delete process.env.NARUTO_DAMO_ASSIST;process.env.NARUTO_ACTIVITY_ASSIST='1';const assist=createActivityAssist(project);assert(assist);
  assert.throws(()=>load('loader',{isPackaged:false,getPath:()=>require('node:os').tmpdir()}).createActivityAssist(project),/隔离/);
  const originalSource=path.join(root,'.test-artifacts/activity-assist-9.40Build300/OperatingActivityPlugin.original.swf');
  const originalBody=fs.existsSync(originalSource)?fs.readFileSync(originalSource):undefined;
  const calls=[];let message;const debug={attach(){},on(n,f){if(n==='message')message=f;},async sendCommand(c,p){calls.push([c,p]);if(c==='Fetch.getResponseBody'){assert(originalBody,'需要本地原版活动资源才能校验响应阶段');return {body:originalBody.toString('base64'),base64Encoded:true};}}},wc={id:1,getURL:()=> 'about:blank',debugger:debug,on(){},once(){}};
  await assist.attach(wc);assert.equal(calls.filter(([c])=>c==='Fetch.enable').length,1);assert.equal(calls.find(([c])=>c==='Fetch.enable')[1].patterns.length,1);
  for(const [url,expected] of [[assist.resource.url,'Fetch.fulfillRequest'],[assist.resource.url.replace('9.40Build300','0.0Unsupported'),'Fetch.continueRequest'],[assist.resource.url.replace('cdnnaruto-pt.oasgames.com','example.com'),'Fetch.continueRequest']]){
   calls.length=0;message({},'Fetch.requestPaused',{requestId:'probe',request:{method:'GET',url},responseStatusCode:200});await new Promise(setImmediate);assert.equal(calls.at(-1)[0],expected);
  }
  calls.length=0;const {createGameLocalization}=load('localization',{isPackaged:true,getPath:()=>data});assert.equal(createGameLocalization(root,false,()=>{},[assist.resource]),undefined);
  const localized=createGameLocalization(root,true,()=>{},[assist.resource]);assert(localized);await assist.attach({...wc,id:2},localized);assert.equal(calls.filter(([c])=>c==='Fetch.enable').length,1);
  const patterns=calls.find(([c])=>c==='Fetch.enable')[1].patterns;assert(patterns.some(p=>p.urlPattern===assist.resource.url+'*'));assert(patterns.length>1);
 }finally{for(const [k,v] of [['NARUTO_ACTIVITY_ASSIST',before[0]],['NARUTO_DAMO_ASSIST',before[1]]]){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
test('packaged loader validates resource; corrupt or missing resources safely fall back',()=>{
 const {createActivityAssist}=load('loader',{isPackaged:true,getPath:()=>path.join(work,'packaged-profile')});const base=createActivityAssist(root);assert(base);const chinese=createActivityAssist(root,true);assert(chinese);assert(!base.resource.bytes.equals(chinese.resource.bytes));
 const project=fs.mkdtempSync(path.join(work,'corrupt-')),dir=path.join(project,'assets/activity-assist-9.40Build300');fs.mkdirSync(dir,{recursive:true});fs.cpSync(path.join(root,'assets/activity-assist-9.40Build300'),dir,{recursive:true});fs.appendFileSync(path.join(dir,'OperatingActivityPlugin.activity-assist.swf'),'corrupt');
 assert.equal(createActivityAssist(project),undefined);assert.equal(createActivityAssist(path.join(work,'missing')),undefined);
});

test('activity target matches the observed live BR resource version',()=>{
 const {createActivityAssist}=load('loader',{isPackaged:true,getPath:()=>path.join(work,'live-target-profile')});
 assert.equal(createActivityAssist(root).resource.url,'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.40Build300/flash/operatingActivity/OperatingActivityPlugin.swf');
});
