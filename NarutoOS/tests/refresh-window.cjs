// Offline Chromium regression: actual GameSessions, per-tab cookies and real beforeunload.
const {app,BrowserWindow,ipcMain}=require('electron');
const {GameSessions}=require('../dist/main/game.refresh-test.cjs');
const fs=require('fs'),path=require('path'),assert=require('assert');
const directory=path.resolve('.test-artifacts/refresh-fix');fs.mkdirSync(directory,{recursive:true});
app.setPath('userData',fs.mkdtempSync(path.join(directory,'profile-')));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await pause(25)}throw Error('Refresh transition timeout')}
const results=[];function check(name,value){assert(value,name);results.push(name);console.log('PASS',name)}
app.whenReady().then(async()=>{let win,games;try{
 ipcMain.handle('game:form-state',()=>({ok:true,value:null}));
 win=new BrowserWindow({show:false,width:800,height:600,webPreferences:{sandbox:true,contextIsolation:true}});
 games=new GameSessions(win,()=>{},()=>{},'about:blank');
 const first=games.create({id:'refresh-primary',name:''});await until(()=>first.state==='ready');
 const second=games.create({id:'refresh-other',name:''});await until(()=>second.state==='ready');games.select(first.id);
 const counts=new Map();
 for(const tab of games.tabs){counts.set(tab.id,0);tab.view.webContents.session.protocol.interceptBufferProtocol('https',(request,callback)=>{
  counts.set(tab.id,counts.get(tab.id)+1);callback({mimeType:'text/html',data:Buffer.from('<!doctype html><title>Offline game</title><button id="activate">Game</button><script>window.onbeforeunload=function(){return false}</script>')});
 });await tab.view.webContents.loadURL('https://naruto.narutowebgame.com/pt/fixture-game');}
 const wc=first.view.webContents;wc.debugger.attach('1.3');
 const activate=async()=>{await wc.debugger.sendCommand('Runtime.evaluate',{expression:'document.querySelector("button").click()',userGesture:true});};
 let prevented=0;wc.on('will-prevent-unload',()=>prevented++);
 await activate();check('fixture has sticky user activation for real unload protection',await wc.executeJavaScript('navigator.userActivation.hasBeenActive'));
 await wc.executeJavaScript('document.cookie="refresh_fixture=retained;path=/;SameSite=Lax"');
 const before=counts.get(first.id),otherGeneration=second.generation;
 games.refresh(first.id);await pause(500);
 check('explicit launcher refresh passes website unload protection and requests a new document',prevented===1&&counts.get(first.id)>before);
 await until(()=>first.state==='ready');
 check('refresh retains same WebContents and session cookie',first.view.webContents===wc&&await wc.executeJavaScript('document.cookie.includes("refresh_fixture=retained")'));
 check('refresh leaves the other tab untouched',second.generation===otherGeneration&&counts.get(second.id)===1);
 await activate();const next=counts.get(first.id);wc.reload();await pause(350);
 check('normal website reload still respects unload protection after explicit refresh',prevented===2&&counts.get(first.id)===next);
 games.refresh(first.id);await until(()=>counts.get(first.id)>next);await until(()=>first.state==='ready');
 check('another explicit refresh gets a fresh single-use intent',counts.get(first.id)===next+1&&prevented===3);
 fs.writeFileSync(path.join(directory,'refresh-results.json'),JSON.stringify({ok:true,results},null,2));
 games.destroy();win.destroy();app.quit();
 }catch(error){console.error(error.message);fs.writeFileSync(path.join(directory,'refresh-results.json'),JSON.stringify({ok:false,results,error:error.message},null,2));if(games)games.destroy();if(win&&!win.isDestroyed())win.destroy();app.exit(1)}
});
