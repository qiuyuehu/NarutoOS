void (async()=>{
 if(window.__interfaceLanguageCheck)return;window.__interfaceLanguageCheck=true;
 const $=id=>document.getElementById(id),pause=ms=>new Promise(r=>setTimeout(r,ms)),checks=[];
 const check=(name,value)=>{if(!value)throw Error(name);checks.push(name)};
 async function until(fn){for(let i=0;i<150;i++){if(await fn())return;await pause(40)}throw Error('language UI timeout')}
 try{
  await until(()=>window.naruto&&!$('lobby-current').disabled);
  const initial=await window.naruto.state(),selected=initial.selectedProfileId,profiles=JSON.stringify(initial.profiles),region=initial.preferences.region;
  const names={'zh-CN':'设置',en:'Settings','pt-BR':'Ajustes'},titles={'zh-CN':'新建登录档案',en:'New login profile','pt-BR':'Novo perfil de login'};
  check('first visible page uses native initial language',document.documentElement.lang===initial.preferences.language&&$('settings').getAttribute('aria-label')===names[initial.preferences.language]&&!document.documentElement.classList.contains('interface-pending'));
  await window.naruto.command({type:'settings'});
  await until(()=>!$('settings-panel').hidden);
  for(const localization of [false,true]){
   await window.naruto.command({type:'localization',value:localization});
   for(const language of ['en','pt-BR','zh-CN']){
    await window.naruto.command({type:'language',value:language});
    await until(()=>document.documentElement.lang===language);
    const state=await window.naruto.state();
    check(`${language} localization=${localization}: static labels`, $('settings').getAttribute('aria-label')===names[language]);
    check(`${language} localization=${localization}: data independence`,state.preferences.localization===localization&&state.preferences.region===region&&state.selectedProfileId===selected&&JSON.stringify(state.profiles)===profiles);
   }
  }
  document.querySelector('[data-settings-page="accounts"]').click();$('profile-create').click();
  await until(()=>!$('dialog-backdrop').hidden);
  const input=$('edit-name'),value='<img src=x> 长账号 & synthetic';input.value=value;input.focus();input.setSelectionRange(2,7);$('edit-server-note').value='S123 · note';
  for(const language of ['en','pt-BR','zh-CN']){
   await window.naruto.command({type:'language',value:language});
   await until(()=>document.documentElement.lang===language);
   check(`${language}: live dialog`, $('dialog-title').textContent===titles[language]);
   check(`${language}: edit value and focus`,input.value===value&&document.activeElement===input&&input.selectionStart===2&&input.selectionEnd===7&&$('edit-server-note').value==='S123 · note');
   check(`${language}: safe text`,!$('dialog-title').querySelector('img')&&!document.querySelector('#profile-list img'));
  }
  $('dialog-cancel').click();await until(()=>$('dialog-backdrop').hidden);
  document.querySelector('[data-settings-page="appearance"]').click();
  const original=window.naruto.command;
  window.naruto.command=async command=>{if(command.type==='language')throw Error('synthetic-save-blocked');return original(command)};
  const selector=$('language-select');selector.value='en';selector.dispatchEvent(new Event('change',{bubbles:true}));
  await until(()=>!selector.disabled&&!$('toast').hidden);
  check('failed save retains original language',selector.value==='zh-CN'&&document.documentElement.lang==='zh-CN'&&$('toast').textContent==='synthetic-save-blocked');
  window.naruto.command=original;
  let rejected=false;try{await original({type:'language',value:'invalid'})}catch{rejected=true}
  check('invalid new language rejected',rejected&&(await window.naruto.state()).preferences.language==='zh-CN');
  for(const language of ['zh-CN','en','pt-BR']){
   await original({type:'language',value:language});await until(()=>document.documentElement.lang===language);
   for(const page of ['appearance','game','accounts','about']){
    document.querySelector(`[data-settings-page="${page}"]`).click();await pause(20);
    const content=document.querySelector(`[data-settings-content="${page}"]`);
    const note=$('game-settings-note');
    check(`${language} ${page}: game settings note visibility`,!!note.getClientRects().length===(page==='game'));
    if(page==='game'){
     check(`${language}: single-line game settings note`,note.offsetHeight===parseFloat(getComputedStyle(note).lineHeight));
     check(`${language}: game settings note names the mute switch`,note.textContent.includes($('mute-label').textContent));
    }
    check(`${language} ${page}: no horizontal overflow`,content.scrollWidth<=content.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth+1);
    for(const control of content.querySelectorAll('button,select')){if(!control.getClientRects().length)continue;const r=control.getBoundingClientRect();check(`${language} ${page}: control fits ${control.id}`,r.width>0&&r.left>=0&&r.right<=innerWidth+1)}
   }
  }
  await original({type:'localization',value:initial.preferences.localization});
  await original({type:'language',value:initial.preferences.language});
  document.querySelector('[data-settings-page="appearance"]').click();
  // Re-render the retained toast after restoring the final locale.
  await until(() => $('toast').hidden);
  window.__uiTestOutcome={ok:true,checks,language:initial.preferences.language,width:innerWidth,height:innerHeight};
 }catch(error){window.__uiTestOutcome={ok:false,checks,error:String(error)}}
})();
