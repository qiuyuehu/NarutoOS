void (async()=>{
 if(window.__launcherUiCheckStarted)return;window.__launcherUiCheckStarted=true;
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 async function until(fn){for(let i=0;i<160;i++){if(await fn())return;await pause(50)}throw Error('launcher UI timeout')}
 const $=id=>document.getElementById(id),result={width:innerWidth,height:innerHeight};
 function check(name,value){if(!value)throw Error(name);result[name]=true}
 try{
  await until(()=>window.naruto&&!$('lobby-current').disabled);
  const lobby=$('lobby'),art=$('lobby-character'),canvases=[$('lobby-dots'),$('lobby-lines')];
  const canvasesFit=()=>canvases.every(canvas=>canvas.width===lobby.clientWidth&&canvas.height===lobby.clientHeight);
  const paintedPixels=canvas=>{
   const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
   let count=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i])count++;return count;
  };
  await until(()=>art.naturalWidth&&canvasesFit()&&lobby.style.getPropertyValue('--focus-x'));
  const initialWidth=lobby.clientWidth,inlineWidth=lobby.style.width;
  result.scene={width:initialWidth,height:lobby.clientHeight,pixels:canvases.map(paintedPixels)};
  check('lobby paints character, dots and radial lines',!lobby.dataset.canvasError&&result.scene.pixels.every(count=>count>0));
  try{
   lobby.style.width=(initialWidth-32)+'px';window.dispatchEvent(new Event('resize'));
   await until(()=>lobby.clientWidth<initialWidth&&canvasesFit());
   check('lobby redraws both canvases to the resized bounds',canvases.map(paintedPixels).every(count=>count>0));
  }finally{
   lobby.style.width=inlineWidth;window.dispatchEvent(new Event('resize'));
  }
  await until(()=>lobby.clientWidth===initialWidth&&canvasesFit());
  await pause(400);
  const initial=await window.naruto.state(),selected=initial.profiles.find(p=>p.id===initial.selectedProfileId);
  check('defaultAccount',$('lobby-account-name').textContent===selected.name&&!$('open-game').disabled);
  check('departureCopy',$('open-game').textContent.trim()==='出发');
  const alternative=initial.profiles.find(p=>p.region==='br'&&p.id!==selected.id);
  const picker=$('profile-picker-backdrop'),pickerList=$('profile-picker-list');
  const pickerRow=()=>pickerList.querySelector(`[data-id="${alternative.id}"]`);
  const press=(key,shiftKey=false)=>document.dispatchEvent(new KeyboardEvent('keydown',{key,shiftKey,cancelable:true}));
  await window.naruto.command({type:'profiles-picker'});
  await until(()=>!picker.hidden&&pickerRow());
  const firstPickerButton=pickerList.querySelector('button');
  check('profile picker lists only current region and focuses first action',
    pickerList.querySelectorAll('.profile-option').length===initial.profiles.filter(p=>p.region===initial.preferences.region).length&&document.activeElement===firstPickerButton);
  press('Tab',true);check('profile picker wraps focus backward',document.activeElement===$('profile-picker-cancel'));
  press('Tab');check('profile picker wraps focus forward',document.activeElement===firstPickerButton);
  $('profile-picker-create').click();await until(()=>$('dialog-backdrop').hidden===false);
  press('Escape');await until(()=>$('dialog-backdrop').hidden);
  check('profile picker create uses the shared dialog with Escape priority',!picker.hidden);
  pickerRow().querySelector('button.quiet').click();
  await until(()=>picker.hidden&&$('lobby-account-name').textContent===alternative.name);
  check('profile picker selection updates the default',(await window.naruto.state()).selectedProfileId===alternative.id);
  await window.naruto.command({type:'new'});await until(()=>!picker.hidden&&pickerRow());
  check('open intent offers only the open action',pickerRow().querySelectorAll('button').length===1&&!!pickerRow().querySelector('button.primary'));
  press('Escape');await until(()=>picker.hidden);
  check('Escape closes the profile picker',picker.hidden);
  await window.naruto.command({type:'profile-select',id:alternative.id});
  await until(()=>$('lobby-account-name').textContent===alternative.name);
  check('defaultSettingSync',(await window.naruto.state()).selectedProfileId===alternative.id);
  await window.naruto.command({type:'profile-select',id:selected.id});
  await until(()=>$('lobby-account-name').textContent===selected.name);
  $('lobby-region').click();await until(()=>$('lobby-region-label').textContent==='国服');
  await until(()=>!$('open-game').disabled);
  check('regionDefault',(await window.naruto.state()).selectedProfileId==='cn-1'&&$('open-game').getAttribute('aria-label').includes('1 个账号'));
  $('lobby-region').click();await until(()=>$('lobby-region-label').textContent==='巴西服');

  check('noDivider',getComputedStyle(document.querySelector('.chrome')).borderBottomWidth==='0px');
  const dock=$('lobby-dock'),rect=dock.getBoundingClientRect(),scale=Math.min(1,innerWidth/1000,innerHeight/700);
  result.scale=rect.width/dock.offsetWidth;
  check('proportionalDock',Math.abs(result.scale-scale)<.015&&rect.left>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight);
  $('lobby-current').click();await until(()=>!$('profile-deck').hidden);
  const before=dock.getBoundingClientRect().bottom;
  const option=id=>document.querySelector(`#profile-deck [data-id="${id}"]`);
  option(selected.id).click();
  await pause(600);check('emptySelectionStaysEmpty',$('open-game').disabled);
  const first=initial.profiles.find(p=>p.region==='br'&&p.id!==selected.id);
  option(first.id).click();option(selected.id).click();
  await until(()=>$('lobby-account-name').textContent===first.name);
  check('firstChoicePrimary',(await window.naruto.state()).selectedProfileId===first.id&&$('lobby-avatar').textContent===[...first.name][0]);
  check('multiSelect',Array.from($('profile-deck').querySelectorAll('[aria-selected="true"]')).length===2);
  check('dockStable',Math.abs(dock.getBoundingClientRect().bottom-before)<1);
  const menu=$('profile-deck').getBoundingClientRect();check('menuFits',menu.top>=0&&menu.right<=innerWidth);
  $('lobby-current').click();$('open-game').click();
  await until(()=>!$('open-game').disabled);
  await pause(500);result.primary=first.id;
  $('settings').click();await until(()=>!$('settings-panel').hidden);
  const accountLists=[$('profile-list'),$('credentials')], qualityControl=$('quality-select'),originalQuality=qualityControl.value;
  document.querySelector('[data-settings-page="appearance"]').click();await until(()=>!document.querySelector('[data-settings-content="appearance"]').hidden);

  const originalAppearance=(await window.naruto.state()).preferences;
  const setAppearance=(id,value,event='change')=>{
   const control=$(id);control.value=value;control.dispatchEvent(new Event(event,{bubbles:true}));
  };
  const preference=async key=>(await window.naruto.state()).preferences[key];
  const explicitTheme=originalAppearance.theme==='dark'?'light':'dark';
  setAppearance('theme-select',explicitTheme);
  await until(async()=>await preference('theme')===explicitTheme);
  check('explicit theme updates the Center',document.documentElement.dataset.dark===String(explicitTheme==='dark'));
  setAppearance('theme-select','system');
  await until(async()=>await preference('theme')==='system');
  check('system theme follows WebKit',document.documentElement.dataset.dark===String(matchMedia('(prefers-color-scheme: dark)').matches));

  setAppearance('title-mode','custom');
  await until(()=>$('title-color').hidden===false);
  const titleBar=document.querySelector('.chrome'),savedTitle=await preference('titleBarColor');
  const titleColor=savedTitle==='#234567'?'#345678':'#234567';
  setAppearance('title-color',titleColor,'input');
  check('title color previews before saving',titleBar.style.getPropertyValue('--bar-bg')===titleColor&&await preference('titleBarColor')===savedTitle);
  setAppearance('title-color',titleColor);
  await until(async()=>await preference('titleBarColor')===titleColor);
  check('title color is retained by Center state',$('title-color').value===titleColor&&titleBar.style.getPropertyValue('--bar-bg')===titleColor);

  const motion=$('lobby-motion');
  for(const expected of [!originalAppearance.lobbyMotion,originalAppearance.lobbyMotion]){
   motion.click();await until(async()=>motion.getAttribute('aria-checked')===String(expected)&&await preference('lobbyMotion')===expected);
   $('close-settings').click();await until(()=>$('settings-panel').hidden&&art.naturalWidth&&canvasesFit());
   const effective=expected&&!matchMedia('(prefers-reduced-motion: reduce)').matches?'on':'off';
   check('lobby renders again after settings with motion '+effective,lobby.dataset.motion===effective&&canvases.map(paintedPixels).every(count=>count>0));
   $('settings').click();await until(()=>!$('settings-panel').hidden);
   document.querySelector('[data-settings-page="appearance"]').click();await until(()=>!document.querySelector('[data-settings-content="appearance"]').hidden);
  }
  check('lobby motion switches both ways',true);

  const background=$('lobby-bg-custom'),sentBackgrounds=[];
  const oldBackground='#efdbaf',lastBackground=originalAppearance.lobbyBackground==='#183047'?'#192b42':'#183047';
  const send=window.naruto.command;
  let releaseOldSave,valueAfterOldSnapshot;
  const oldSave=new Promise(resolve=>{releaseOldSave=resolve});
  window.naruto.command=async input=>{
   if(input.type!=='lobby-background')return send(input);
   sentBackgrounds.push(input.value);
   if(input.value!==oldBackground)return send(input);
   await oldSave;
   const reply=await send(input);
   valueAfterOldSnapshot=background.value;
   return reply;
  };
  try{
   setAppearance('lobby-bg-mode','custom');
   setAppearance('lobby-bg-custom',oldBackground);
   await until(()=>sentBackgrounds.includes(oldBackground));
   setAppearance('lobby-bg-custom','#946148','input');
   setAppearance('lobby-bg-custom',lastBackground,'input');
   $('close-settings').click();
   check('closing settings shows the latest lobby preview',$('settings-panel').hidden&&$('lobby').dataset.tone==='dark');
   check('closing settings keeps the pending save visible to the exit guard',$('settings-panel').hasAttribute('data-lobby-background-pending'));
   const preview=$('lobby').style.getPropertyValue('--bg-top');
   $('settings').click();await until(()=>$('settings-panel').hidden===false);
   check('reopened settings keep the pending color while the older save waits',!background.hidden&&background.value===lastBackground&&sentBackgrounds.length===1);
   releaseOldSave();
   await until(async()=>await preference('lobbyBackground')===lastBackground);
   await pause(250);
   check('only the latest color is saved after the older request',sentBackgrounds.join(',')===[oldBackground,lastBackground].join(',')&&valueAfterOldSnapshot===lastBackground&&background.value===lastBackground&&await preference('lobbyBackground')===lastBackground);
   $('close-settings').click();await until(()=>$('settings-panel').hidden);
   check('the saved lobby matches the preview',$('lobby').style.getPropertyValue('--bg-top')===preview);
   $('settings').click();await until(()=>$('settings-panel').hidden===false);

   setAppearance('lobby-bg-custom','#596a83','input');
   setAppearance('lobby-bg-custom','#41465d','input');
   $('close-settings').click();
   check('closing settings sends the latest color immediately',sentBackgrounds.at(-1)==='#41465d');
   await until(async()=>await preference('lobbyBackground')==='#41465d');
   await until(()=>!$('settings-panel').hasAttribute('data-lobby-background-pending'));
   $('settings').click();await until(()=>$('settings-panel').hidden===false);
  }finally{
   releaseOldSave();window.naruto.command=send;
  }

  for(const failFirstSave of [false,true]){
   const color=failFirstSave?'#584d76':'#4d585e';
   let finishFirstSave,firstSaveReady=false,writes=0;
   const firstSave=new Promise(resolve=>{finishFirstSave=resolve});
   window.naruto.command=async input=>{
    if(input.type!=='lobby-background'||input.value!==color||++writes!==1)return send(input);
    const reply=failFirstSave?false:await send(input);
    firstSaveReady=true;
    await firstSave;
    return reply;
   };
   try{
    setAppearance('lobby-bg-custom',color,'input');
    await until(()=>firstSaveReady);
    setAppearance('lobby-bg-custom',color);
    finishFirstSave();
    await until(async()=>await preference('lobbyBackground')===color&&!$('settings-panel').hasAttribute('data-lobby-background-pending'));
    check(failFirstSave?'same color retries after a failed save':'same color confirmation shares the successful save',writes===(failFirstSave?2:1));
   }finally{
    finishFirstSave();window.naruto.command=send;
   }
  }
  await send({type:'lobby-background',value:originalAppearance.lobbyBackground});
  await send({type:'title-color',value:originalAppearance.titleBarColor});
  await send({type:'theme',value:originalAppearance.theme});

  document.querySelector('[data-settings-page="accounts"]').click();await until(()=>!document.querySelector('[data-settings-content="accounts"]').hidden);
  check('settings categories reuse live account lists',accountLists[0]===$('profile-list')&&accountLists[1]===$('credentials'));
  document.querySelector('[data-settings-page="game"]').click();await until(()=>!document.querySelector('[data-settings-content="game"]').hidden);
  check('settings category switch preserves controls and input state',qualityControl===$('quality-select')&&qualityControl.value===originalQuality);
  document.querySelector('[data-settings-page="accounts"]').click();await until(()=>!document.querySelector('[data-settings-content="accounts"]').hidden);
  const profileCount=()=>document.querySelectorAll('#profile-list .profile-row[data-id]').length;
  const originalProfileCount=profileCount();
  const profileLabel='隔离档案检查'+Date.now(),updatedProfileLabel=profileLabel+'已编辑';
  $('profile-create').click();await until(()=>$('dialog-backdrop').hidden===false);
  $('edit-name').value=profileLabel;$('edit-server-note').value='UI验证';$('dialog-save').click();
  await until(()=>profileCount()===originalProfileCount+1&&Array.from(document.querySelectorAll('#profile-list .profile-row')).some(row=>row.textContent.includes(profileLabel)));
  const createdProfile=Array.from(document.querySelectorAll('#profile-list .profile-row')).find(row=>row.textContent.includes(profileLabel));
  createdProfile.querySelector('[data-action="edit"]').click();await until(()=>$('dialog-backdrop').hidden===false);
  $('edit-name').value=updatedProfileLabel;$('dialog-save').click();
  await until(()=>Array.from(document.querySelectorAll('#profile-list .profile-row')).some(row=>row.textContent.includes(updatedProfileLabel)));
  const editedProfile=Array.from(document.querySelectorAll('#profile-list .profile-row')).find(row=>row.textContent.includes(updatedProfileLabel));
  editedProfile.querySelector('[data-action="delete"]').click();await until(()=>$('dialog-backdrop').hidden===false);$('dialog-save').click();
  await until(()=>{const row=Array.from(document.querySelectorAll('#profile-list .profile-row[data-id]')).find(item=>item.textContent.includes(updatedProfileLabel));return !row||['deleting','pending'].includes(row.dataset.cleanup)});
  check('dynamic profile add edit and delete update the live list',profileCount()===originalProfileCount||!!document.querySelector('#profile-list .profile-row[data-cleanup]'));
  await window.naruto.command({type:'profile-select',id:first.id});await until(async()=>(await window.naruto.state()).selectedProfileId===first.id);
  $('credential-create').click();await until(()=>$('dialog-backdrop').hidden===false);
  $('edit-name').value='ui-check-account';$('edit-password').value='ui-check-secret';$('dialog-save').click();
  await until(()=>document.querySelector('#credentials .credential .credential-name')?.textContent==='ui-check-account');
  let credentialRow=document.querySelector('#credentials .credential');
  const revealButton=credentialRow.querySelector('.credential-actions button');revealButton.click();
  await until(()=>credentialRow.querySelector('.credential-password')?.textContent==='ui-check-secret');
  revealButton.click();await until(()=>!credentialRow.querySelector('.credential-password'));
  check('credential password reveal and hide work',true);
  credentialRow.querySelectorAll('.credential-actions button')[1].click();await until(()=>$('dialog-backdrop').hidden===false);
  $('edit-name').value='   ';$('dialog-save').click();
  await until(()=>$('dialog-error').textContent&&!$('dialog-save').disabled);
  check('credential save failure keeps the editor and its original row',!$('dialog-backdrop').hidden&&credentialRow.querySelector('.credential-name').textContent==='ui-check-account');
  $('dialog-cancel').click();await until(()=>$('dialog-backdrop').hidden);
  check('cancelling a failed credential edit clears the secret without saving',$('edit-password').value===''&&credentialRow.querySelector('.credential-name').textContent==='ui-check-account');
  credentialRow.querySelectorAll('.credential-actions button')[1].click();await until(()=>$('dialog-backdrop').hidden===false);
  $('edit-name').value='ui-check-account-edited';$('edit-password').value='ui-check-secret-updated';$('dialog-save').click();
  await until(()=>document.querySelector('#credentials .credential .credential-name')?.textContent==='ui-check-account-edited');
  credentialRow=document.querySelector('#credentials .credential');credentialRow.querySelector('.credential-actions button').click();
  await until(()=>credentialRow.querySelector('.credential-password')?.textContent==='ui-check-secret-updated');
  check('credential edit retains password display behavior',true);
  credentialRow.querySelectorAll('.credential-actions button')[2].click();await until(()=>$('dialog-backdrop').hidden===false);$('dialog-save').click();
  await until(()=>!document.querySelector('#credentials .credential'));
  check('credential list deletion works',true);
  document.querySelector('[data-settings-page="game"]').click();qualityControl.value=originalQuality==='low'?'medium':'low';
  qualityControl.dispatchEvent(new Event('change',{bubbles:true}));
  await until(async()=>(await window.naruto.state()).preferences.quality===qualityControl.value);
  check('existing setting save handler survives category navigation',true);
  qualityControl.value=originalQuality;qualityControl.dispatchEvent(new Event('change',{bubbles:true}));
  await until(async()=>(await window.naruto.state()).preferences.quality===originalQuality);
  const toggle=$('settings-localization'),original=toggle.getAttribute('aria-checked');toggle.click();await until(()=>toggle.getAttribute('aria-checked')!==original);
  check('localization switch has a single-line label',$('localization-label').textContent==='游戏汉化'&&$('localization-label').offsetHeight===$('mute-label').offsetHeight);
  const note=$('game-settings-note'),noteRect=note.getBoundingClientRect(),doneRect=$('close-settings').getBoundingClientRect();
  check('game settings note aligns with the card and Done button',note.textContent==='除『静音』外，本页设置在下次打开游戏页时生效。'&&
    Math.abs(noteRect.left-$('game-heading').closest('.section').getBoundingClientRect().left)<1&&
    Math.abs((noteRect.top+noteRect.bottom-doneRect.top-doneRect.bottom)/2)<1);
  toggle.click();await until(()=>toggle.getAttribute('aria-checked')===original);
  const flash=$('flash-detail');flash.hidden=false;flash.textContent='下次启动生效';check('flashHintVisible',getComputedStyle(flash).display!=='none');
  const theme=$('theme-select'),invalid=document.createElement('option');invalid.value='invalid-theme';theme.append(invalid);theme.value='invalid-theme';theme.dispatchEvent(new Event('change',{bubbles:true}));
  await until(()=>!$('toast').hidden);check('errorFeedbackVisible',getComputedStyle($('toast')).display!=='none'&&$('toast').textContent.length>0);
  await until(()=>$('toast').hidden);invalid.remove();
  $('close-settings').click();await until(()=>$('settings-panel').hidden);
  result.ok=true;
 }catch(error){result.ok=false;result.error=String(error)}
 window.__uiTestOutcome=result;
})();
