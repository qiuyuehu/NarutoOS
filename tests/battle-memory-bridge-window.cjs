const {app,BrowserWindow,ipcMain}=require('electron');
const {BattleMemoryBridge}=require('../.test-artifacts/battle-memory-bridge-test/bridge.cjs');
const {GameSessions}=require('../dist/main/game.battle-bridge-test.cjs');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const out=fs.mkdtempSync(path.join(root,'.test-artifacts/battle-memory-bridge-check-'));
app.setPath('userData',path.join(out,'profile'));
app.commandLine.appendSwitch('ppapi-flash-path',path.join(root,'runtime/flash-34/PepperFlashPlayer.plugin'));
app.commandLine.appendSwitch('ppapi-flash-version','34.0.0.384');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn) { for(let i=0;i<120;i++){try{const value=await fn();if(value)return value}catch{}await pause(100)}throw new Error('PPAPI fixture timeout') }
const results=[];
const check=(name,value)=>{assert(value,name);results.push(name);console.log('PASS',name)};
let win,games,server,wc;
const requests=[],consoleMessages=[];
app.whenReady().then(async()=>{
 const watchdog=setTimeout(()=>{console.error('bridge test watchdog');app.exit(1)},45000);
 try{
  ipcMain.handle('game:form-state',()=>({ok:true,value:null}));
  const fixture=fs.readFileSync(path.join(root,'.test-artifacts/battle-memory-experiment-2026-11-03/patched/bridge-fixture.swf'));
  server=http.createServer((req,res)=>{
   const pathname=new URL(req.url,'http://127.0.0.1').pathname;requests.push(pathname);
   if(pathname.endsWith('/relative.txt')){res.end('relative-ok');return}
   if(pathname==='/assets/entry.swf'){res.setHeader('content-type','application/x-shockwave-flash');res.end(fixture);return}
   if(pathname==='/unrelated'){res.end('normal-network');return}
   res.setHeader('content-type','text/html');
   res.end(pathname==='/frame'
    ? '<object id="probe" type="application/x-shockwave-flash" data="/assets/entry.swf" width="400" height="200"><param name="allowScriptAccess" value="always"></object>'
    : '<iframe id="child" src="/frame" width="600" height="400"></iframe>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const bridge=new BattleMemoryBridge(origin+'/assets/entry.swf',fixture,path.join(out,'receipts'));
  win=new BrowserWindow({show:false,width:800,height:600,webPreferences:{contextIsolation:true,sandbox:true}});
  const rawOf=contents=>contents.executeJavaScript('document.getElementById("child").contentDocument.getElementById("probe").narutoExperimentStatus()');
  const control=new GameSessions(win,()=>{},()=>{},origin);
  const controlTab=control.create({id:'bridge-control',name:'fixture'});control.select(controlTab.id);
  const controlStatus=await until(async()=>{const value=await rawOf(controlTab.view.webContents);return value.childText==='relative-ok'&&value});
  const relativePath=requests.find(p=>p.endsWith('/relative.txt'));
  const originalLoads=requests.filter(p=>p==='/assets/entry.swf').length;
  check('unmodified PPAPI control loads and resolves a relative resource',originalLoads===1&&!!relativePath);
  control.destroy();
  games=new GameSessions(win,()=>{},()=>{},origin,false,undefined,()=>{},wc=>bridge.attach(wc));
  const tab=games.create({id:'bridge-test',name:'fixture'});games.select(tab.id);
  wc=tab.view.webContents;
  wc.on('console-message',(_event,_level,message)=>consoleMessages.push(message));
  const raw=()=>rawOf(wc);
  const status=await until(async()=>{const value=await raw();return value.childText==='relative-ok'&&value});
  check('actual PPAPI entry retains original loaderInfo.url',status.loaderURL===controlStatus.loaderURL&&status.loaderURL===origin+'/assets/entry.swf');
  check('relative resource resolves identically to unmodified control',requests.filter(p=>p===relativePath).length===2);
  check('matching SWF bypasses original server response',requests.filter(p=>p==='/assets/entry.swf').length===originalLoads);
  check('no automatic cleanup on load or inspect',status.calls===0&&(await bridge.inspect(wc)).ready&&(await raw()).calls===0);
  check('single explicit call reaches nested-frame ExternalInterface', (await bridge.inspect(wc,true)).called&&(await raw()).calls===1);
  const unrelated=await wc.debugger.sendCommand('Runtime.evaluate',{expression:'fetch("/unrelated").then(r=>r.text())',awaitPromise:true,returnByValue:true});
  check('unrelated requests use original Chromium network',unrelated.result.value==='normal-network');
  await wc.reload();
  await until(async()=>{const value=await raw();return value.childText==='relative-ok'&&value.calls===0});
  check('override remains active on subsequent navigation/cache reuse',bridge.available(wc)&&requests.filter(p=>p==='/assets/entry.swf').length===originalLoads);
  wc.debugger.detach();
  check('debugger detach disables experimental controls',!bridge.available(wc));
  await assert.rejects(()=>bridge.inspect(wc,true));
  games.destroy();win.destroy();
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({ok:true,results,requests},null,2));
  await new Promise(resolve=>server.close(resolve));clearTimeout(watchdog);app.quit();
 }catch(error){
  const diagnostic=wc&&!wc.isDestroyed()?await wc.executeJavaScript('({url:location.href,html:document.body.innerHTML,child:document.getElementById("child")?.contentDocument?.body?.innerHTML,callback:typeof document.getElementById("child")?.contentDocument?.getElementById("probe")?.narutoExperimentStatus})').catch(()=>null):null;
  console.error(error);console.log(JSON.stringify({requests,consoleMessages,diagnostic}));
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({ok:false,results,error:String(error),requests,consoleMessages,diagnostic},null,2));if(games)games.destroy();if(win&&!win.isDestroyed())win.destroy();if(server)server.close();app.exit(1)
 }
});
