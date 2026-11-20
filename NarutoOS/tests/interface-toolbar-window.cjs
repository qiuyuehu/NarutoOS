const {app,BrowserWindow,ipcMain}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert').strict;
const root=process.env.NARUTO_I18N_TEST_ROOT,{msg}=require(path.join(root,'i18n-runtime.cjs'));
app.setPath('userData',path.join(root,'toolbar-user-data'));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<150;i++){if(await fn())return;await pause(20)}throw Error('toolbar timeout')}
const results=[];
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:800,height:560,show:false,titleBarStyle:'hidden',webPreferences:{preload:path.resolve('dist/prototype/host-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 ipcMain.handle('prototype:command',()=>{});
 try{
  await win.loadFile(path.resolve('dist/prototype/toolbar.html'));
  const ui=code=>win.webContents.executeJavaScript(code),username='<img src=x> Very long synthetic account';
  for(const language of ['en','pt-BR','zh-CN','en']){
   const state={preferences:{language,theme:'light',titleBarColor:null},refresh:{enabled:true,label:msg('ui.re_enter_game')},muted:false,notice:msg('ui.password_not_saved_retry_or_skip_for'),noticeKind:'error',stopping:false,exitState:'running',savePrompt:{username,update:true,failed:true},recovery:{candidateId:'new'},failedPage:{state:'failed',region:'br'},tabs:[{id:'A',profileId:'br-1',profile:{region:'br',name:username},status:'ready',active:true,suffix:msg('ui.original_game')},{id:'B',profileId:'cn-1',profile:{region:'cn',name:'Synthetic CN'},status:'login-required'}]};
   win.webContents.send('prototype:state',state);
   await until(()=>ui(`document.documentElement.lang===${JSON.stringify(language)}`));
   const visible=await ui(`({ready:!document.documentElement.classList.contains('interface-pending'),settings:document.getElementById('settings').getAttribute('aria-label'),save:document.getElementById('save-text').textContent,title:document.getElementById('save-text').title,notice:document.getElementById('notice').textContent,noticeTitle:document.getElementById('notice').title,noticeLabel:document.getElementById('notice').getAttribute('aria-label'),complete:document.getElementById('complete').textContent,noImage:!document.querySelector('#tabs img'),fits:document.querySelector('.tabline').scrollWidth<=document.querySelector('.tabline').clientWidth+1})`);
   assert(visible.ready);assert.equal(visible.settings,({'zh-CN':'设置',en:'Settings','pt-BR':'Ajustes'})[language]);assert(visible.save.includes(username));assert.equal(visible.save,visible.title);assert(visible.noImage);assert.equal(visible.notice,visible.noticeTitle);assert.equal(visible.notice,visible.noticeLabel);assert(visible.fits,'toolbar controls overflow in '+language);assert(!/[\uE000\uE001]/.test(JSON.stringify(visible)));
   results.push(language+': retained notices, password, recovery, tabs, safe text, 800px layout');
   await pause(150);
   const image=await win.webContents.capturePage({x:0,y:0,width:800,height:160});fs.writeFileSync(path.join(root,`toolbar-${language}.png`),image.toPNG());
  }
  fs.writeFileSync(path.join(root,'toolbar-results.json'),JSON.stringify({ok:true,results},null,2));app.exit(0);
 }catch(error){fs.writeFileSync(path.join(root,'toolbar-results.json'),JSON.stringify({ok:false,results,error:String(error)},null,2));console.error(error);app.exit(1)}
});
