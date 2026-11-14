// Real Chromium input events against Naruto OS's renderer DOM, stylesheet, and modality helper.
const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),assert=require('assert');
const {pathToFileURL}=require('url');
const directory=path.resolve('.test-artifacts/memory-focus');
fs.mkdirSync(directory,{recursive:true});
app.setPath('userData',fs.mkdtempSync(path.join(directory,'focus-profile-')));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 let win;try{
  const source=fs.readFileSync(path.resolve('src/renderer/index.html'),'utf8');
  const html=source
   .replace('href="style.css"',`href="${pathToFileURL(path.resolve('src/renderer/style.css'))}"`)
   .replace('href="lobby.css"',`href="${pathToFileURL(path.resolve('src/renderer/lobby.css'))}"`)
   .replace(/\s*<script src="app\.js"><\/script>/,'');
  const fixture=path.join(directory,'focus.html');
  fs.writeFileSync(fixture,html);
  win=new BrowserWindow({show:false,width:900,height:700,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  const wc=win.webContents; await wc.loadFile(fixture);
  await wc.executeJavaScript(fs.readFileSync(path.join(directory,'focus-helper.js'),'utf8')+'; NarutoFocus.installFocusModality();');
  wc.debugger.attach('1.3');
  await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
  const evaluate=js=>wc.executeJavaScript(js);
  await evaluate(`(()=>{const nav=document.getElementById('tabs');nav.setAttribute('role','tablist');nav.innerHTML='<div id="game-tab" class="tab" role="tab" aria-selected="true" tabindex="0">游戏</div>';const lobby=document.getElementById('lobby');lobby.hidden=false;lobby.dataset.tone='light';return true})()`);
  const state=()=>evaluate(`(()=>{let e=document.activeElement,s=getComputedStyle(e);return {id:e.id,role:e.getAttribute('role'),focus:e.matches(':focus'),visible:e.matches(':focus-visible'),modality:document.documentElement.dataset.inputModality,outline:s.outlineStyle,shadow:s.boxShadow}})()`);
  const results=[];
  const profilePoint=await evaluate(`(()=>{const r=document.getElementById('lobby-current').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...profilePoint});
  await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...profilePoint});
  await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...profilePoint});
  await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:850,y:650});
  await pause(100);const profilePointer=await state();console.log('POINTER','lobby-current',JSON.stringify(profilePointer));
  assert(profilePointer.id==='lobby-current' && profilePointer.focus && profilePointer.modality==='pointer' && profilePointer.outline==='none' && profilePointer.shadow==='none','lobby-current: pointer focus must not show a focus frame');
  results.push('lobby-current pointer focus has no frame');
  await evaluate('(()=>{const deck=document.getElementById("profile-deck");deck.hidden=false;deck.focus();return true})()');
  await pause(50);const deckPointer=await state();console.log('POINTER','profile-deck',JSON.stringify(deckPointer));
  assert(deckPointer.id==='profile-deck' && deckPointer.focus && deckPointer.modality==='pointer' && deckPointer.outline==='none','profile-deck: pointer focus must not show a focus frame');
  results.push('profile-deck pointer focus has no frame');
  await wc.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
  await wc.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
  await pause(50);const deckKeyboard=await state();console.log('KEYBOARD','profile-deck',JSON.stringify(deckKeyboard));
  assert(deckKeyboard.id==='profile-deck' && deckKeyboard.modality==='keyboard' && deckKeyboard.outline==='solid','profile-deck: keyboard focus must retain a visible focus cue');
  results.push('profile-deck keyboard focus retains a cue');
  const regionPicker=await evaluate(`(()=>({legacy:!!document.querySelector('.region-picker'),lobbySwitch:!!document.getElementById('lobby-region')}))()`);
  console.log('REGION-PICKER',JSON.stringify(regionPicker));
  assert(!regionPicker.legacy && regionPicker.lobbySwitch,'region-picker: remove the legacy header selector and keep the launcher region switch');
  results.push('legacy header region selector is removed; launcher switch remains');
  await evaluate('(()=>{const deck=document.getElementById("profile-deck");deck.hidden=true;deck.blur();return true})()');
  await evaluate('document.getElementById("settings-panel").hidden=false');
  for(const id of ['game-tab','new-tab','refresh','mute','settings','theme-select','title-mode','lobby-bg-mode','settings-mute','flash-select','close-settings']){
   const p=await evaluate(`(()=>{const r=document.getElementById('${id}').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
   await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...p});
   await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});
   await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});
   await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:850,y:650});
   await pause(100);const mouse=await state();console.log('POINTER',id,JSON.stringify(mouse));
   assert(mouse.id===id && mouse.focus && mouse.modality==='pointer' && mouse.outline==='none' && mouse.shadow==='none',`${id}: pointer focus must not show a focus frame`);
   results.push(`${id} pointer focus has no frame`);
  }
  // Typing and text-edit shortcuts after a mouse click must not turn the
  // focused field into a keyboard-navigation focus frame.
  for(const id of ['edit-name','edit-password']){
   await evaluate(`(()=>{document.getElementById('dialog-backdrop').hidden=false;const input=document.getElementById('${id}');input.hidden=false;input.value='';return true})()`);
   const p=await evaluate(`(()=>{const r=document.getElementById('${id}').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
   await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...p});
   await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});
   await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});
   await wc.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',text:'a',unmodifiedText:'a',windowsVirtualKeyCode:65});
   await wc.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65});
   await pause(50);let typed=await state();console.log('TYPE-AFTER-POINTER',id,JSON.stringify(typed));
   assert(typed.id===id && typed.focus && typed.modality==='pointer' && typed.outline==='none' && typed.shadow==='none',`${id}: typing after pointer focus must not show a focus frame`);
   await wc.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65});
   await wc.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65});
   await pause(50);typed=await state();console.log('EDIT-AFTER-POINTER',id,JSON.stringify(typed));
   assert(typed.modality==='pointer' && typed.outline==='none' && typed.shadow==='none',`${id}: text-edit shortcuts must not show a focus frame`);
   results.push(`${id} typing and editing keep pointer focus`);
  }
  // Drive native Tab navigation through the real controls after each genuine keyboard event.
  const tab=async(shift=false)=>{
   const modifiers=shift?8:0;
   await wc.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',modifiers,windowsVirtualKeyCode:9});
   await wc.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',modifiers,windowsVirtualKeyCode:9});
   await pause(50);return state();
  };
  await evaluate('document.getElementById("edit-name").focus()');
  let fieldNavigation=await tab();console.log('TAB-FROM-INPUT',JSON.stringify(fieldNavigation));
  assert(fieldNavigation.id==='edit-password' && fieldNavigation.visible && fieldNavigation.modality==='keyboard' && fieldNavigation.shadow!=='none','Tab from a text field must keep a visible keyboard focus cue');
  fieldNavigation=await tab(true);console.log('SHIFT-TAB-FROM-PASSWORD',JSON.stringify(fieldNavigation));
  assert(fieldNavigation.id==='edit-name' && fieldNavigation.visible && fieldNavigation.modality==='keyboard' && fieldNavigation.shadow!=='none','Shift+Tab from a text field must keep a visible keyboard focus cue');
  await evaluate('document.getElementById("game-tab").focus()');
  const keyboardTargets=['new-tab','refresh','mute','settings','lobby-region','lobby-current','open-game','close-settings','theme-select','title-mode','lobby-bg-mode','lobby-motion','settings-mute','flash-select'];
  for(const id of keyboardTargets){
   const keyboard=await tab();console.log('KEYBOARD',id,JSON.stringify(keyboard));
   assert(keyboard.id===id && keyboard.focus && keyboard.visible && keyboard.modality==='keyboard' && keyboard.shadow!=='none',`${id}: keyboard Tab must keep a visible focus cue`);
   results.push(`${id} keyboard Tab focus is visible`);
  }
  const p=await evaluate(`(()=>{const r=document.getElementById('settings').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...p});
  await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});
  await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});
  await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:850,y:650});
  await pause(250);const returnedToPointer=await state();console.log('POINTER-AFTER-KEYBOARD',JSON.stringify(returnedToPointer));
  assert(returnedToPointer.id==='settings' && returnedToPointer.modality==='pointer' && returnedToPointer.shadow==='none','A mouse click after keyboard navigation must restore pointer focus');
  fs.writeFileSync(path.join(directory,'focus-results.json'),JSON.stringify({ok:true,results},null,2));console.log('FOCUS_COMPLETE',results.length);win.destroy();app.quit();
 }catch(error){console.error(error.stack||error.message);if(win&&!win.isDestroyed())win.destroy();app.exit(1);}
});
