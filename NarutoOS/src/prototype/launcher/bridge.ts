import { setText, setAttr, applyLanguage } from '../../renderer/i18n-dom';
import { msg, messageCode, setLanguage, pluralMessage } from '../../shared/i18n';
import type { AppState, Command, Preferences } from '../../shared/model';
// The browser receives fixed business commands only; role credentials remain native.
const browser = window as any;
const pending = new Map<string, { resolve: (value:any)=>void; reject:(reason:Error)=>void; timer:ReturnType<typeof setTimeout> }>();
function request(command:string,payload:object={}):Promise<any>{
  return new Promise((resolve,reject)=>{
    const id=crypto.randomUUID();const timer=setTimeout(()=>{pending.delete(id);reject(new Error(msg('ui.no_response_yet_please_try_again_later')));},5000);
    pending.set(id,{resolve,reject,timer});browser.webkit.messageHandlers.narutoCore.postMessage({id,command,payload});
  });
}
browser.__narutoResponse=(id:string,result:any)=>{const p=pending.get(id);if(!p)return;pending.delete(id);clearTimeout(p.timer);result.ok?p.resolve(result.value):p.reject(new Error(result.messageRef||result.message||msg('ui.operation_incomplete')));};
let snapshot:any,settingsOpen=false,profilePickerOpen=false,notice='',selectedRegion:'br'|'cn'='br',lastRegion:string|undefined;
let pickerIntent:'open'|'select'='select';
let lastBatchId:string|undefined;
let lastCenterIntent:string|undefined;
let selectionTouched=false;
let submitting=false;
let requestBatch:{id:string;ids:string[]}|undefined;
const checked=new Set<string>();const listeners=new Set<(state:AppState)=>void>();
function state():AppState {
  const preferences={...snapshot.preferences,region:selectedRegion} as Preferences;
  const profiles=snapshot.profiles;
  const runtime=snapshot?.runtime||{};
  return {preferences,tabs:[],activeId:null,settingsOpen,prompt:null,recovery:null,refresh:{enabled:false,label:msg('ui.refresh')},flash:{version:snapshot?.hostPID?(runtime.flash||preferences.flash):preferences.flash,available:true},localizationActive:!!runtime.localizationActive,assistsActive:!!runtime.assistsActive,notice,
    profiles,selectedProfileId:[...checked].find(id=>profiles.some((p:any)=>p.id===id&&p.region===selectedRegion))||snapshot.selectedByRegion[selectedRegion]||null,profileDiscovery:snapshot?'ready':'loading',profileError:'',canCreateProfile:snapshot.canCreateProfile,profilePickerOpen,profilePickerIntent:pickerIntent};
}
function emit(){if(!snapshot)return;document.documentElement.dataset.centerSettings=String(settingsOpen);for(const fn of listeners)fn(state());paintSelection();}
browser.__narutoSnapshot=(value:any)=>{
  snapshot=value;setLanguage(value.preferences?.language);applyLanguage();
  if(value.centerIntent?.id && value.centerIntent.id!==lastCenterIntent){lastCenterIntent=value.centerIntent.id;if(value.centerIntent.page==='settings')settingsOpen=true;}
  if(lastBatchId){const batch=value.batches.find((b:any)=>b.id===lastBatchId);if(batch){const rejected=batch.items.filter((i:any)=>i.status==='rejected');notice=rejected.length?msg('launch.rejected',{details:rejected.map((i:any)=>`${i.profileId}（${i.reason==='unknown-profile'?msg('ui.profile_missing_or_being_cleaned_up'):i.reason||msg('ui.request_not_accepted')}）`).join(' · ')}):batch.items.every((i:any)=>i.accepted)?pluralMessage('launch.started',batch.items.length):msg('ui.starting_selected_accounts');}}
  if(lastRegion===undefined)selectedRegion=value.preferences.region||'br';lastRegion=selectedRegion;
  for(const id of checked)if(!value.profiles.some((p:any)=>p.id===id&&!p.deleting))checked.delete(id);
  if(!selectionTouched){checked.clear();const id=value.selectedByRegion[selectedRegion];if(id)checked.add(id);}
  emit();
};
if(browser.__narutoInitialState)browser.__narutoSnapshot(browser.__narutoInitialState);
async function sync(){browser.__narutoSnapshot(await request('snapshot'));return state();}
const mutationIds=new Map<string,{requestId:string;revision:number}>();
async function mutate(command:string,payload:object={}){const key=JSON.stringify([command,payload]);let identity=mutationIds.get(key);if(!identity){identity={requestId:crypto.randomUUID(),revision:snapshot.revision};mutationIds.set(key,identity)}try{const result=await request(command,{...identity,...payload});mutationIds.delete(key);await sync();return result;}catch(error){await sync().catch(()=>{});if(['error.preferenceConflict','error.profileConflict'].includes(messageCode(error)))mutationIds.delete(key);throw error;}}
async function waitForReconcile(ms=2500){const end=Date.now()+ms;while(snapshot?.reconciling&&Date.now()<end){await new Promise(resolve=>setTimeout(resolve,150));await sync().catch(()=>{});}}
async function launch(ids:string[]){
  const selected=[...new Set(ids)];
  if(requestBatch && (requestBatch.ids.length!==selected.length||requestBatch.ids.some(id=>!selected.includes(id)))){
    const previous=await request('batch.get',{id:requestBatch.id});
    if(previous.found && previous.batch.items.some((item:any)=>item.status==='pending')){
      await sync();throw new Error(msg('ui.the_previous_batch_is_still_starting_try'));
    }
    // The old request is either resolved or confirmed absent before a new selection is submitted.
    requestBatch=undefined;
  }
  requestBatch??={id:crypto.randomUUID(),ids:selected};
  const batch=requestBatch;lastBatchId=batch.id;
  const response=await request('batch.start',{requestId:batch.id,profileIds:batch.ids});
  if(requestBatch===batch)requestBatch=undefined;
  notice=msg('ui.starting_selected_accounts');await sync();return response;
}
async function command(input:Command):Promise<void|boolean>{
  switch(input.type){
    case 'settings':settingsOpen=!settingsOpen;emit();return;
    case 'home':settingsOpen=false;profilePickerOpen=false;emit();return;
    case 'region':selectedRegion=input.value;checked.clear();{const id=snapshot?.selectedByRegion?.[input.value];if(id)checked.add(id);}selectionTouched=false;emit();await mutate('preferences.patch',{key:'region',value:input.value});return;
    case 'profile-start':{
      // Never submit an account that the current region does not display.
      const ids=snapshot?[...checked].filter(id=>snapshot.profiles.some((p:any)=>p.id===id&&p.region===selectedRegion&&!p.deleting)):[];
      if(!snapshot || !ids.length || submitting)return false;
      submitting=true;paintSelection();
      try {
        if(snapshot.reconciling){await waitForReconcile();}
        if(snapshot?.reconciling)return false;
        await launch(ids);
        return true;
      } finally {submitting=false;paintSelection();}
    }
    case 'profile-open':await launch([input.id]);return true;
    case 'profile-select':await mutate('catalog.select',{id:input.id});checked.clear();checked.add(input.id);selectionTouched=true;profilePickerOpen=false;emit();return;
    case 'profile-create':await mutate('catalog.create',{region:selectedRegion,name:input.name,serverNote:input.serverNote});return;
    case 'profile-update':await mutate('catalog.update',input);return;
    case 'profile-delete':await mutate('catalog.delete',{id:input.id});return;
    case 'profiles-picker':case 'new':pickerIntent=input.type==='new'?'open':'select';if(input.type==='new'){checked.clear();selectionTouched=true;}profilePickerOpen=true;emit();return;
    case 'profiles-close-picker':profilePickerOpen=false;emit();return;
    case 'profiles-retry':await sync();return;
    case 'overlay':return;
    case 'open-github':await request('about.open');return;
    case 'check-update':await request('update.check');return;
    case 'language':case 'quality':case 'localization':case 'assists':case 'theme':case 'cn-entry':await mutate('preferences.patch',{key:input.type==='assists'?'assistsEnabled':input.type==='cn-entry'?'cnEntry':input.type,value:input.value});return;
    case 'flash':await mutate('preferences.patch',{key:'flash',value:input.version});return;
    case 'mute':await mutate('preferences.patch',{key:'muted',value:!snapshot.preferences.muted});return;
    case 'title-color':await mutate('preferences.patch',{key:'titleBarColor',value:input.value});return;
    case 'lobby-background':await mutate('preferences.patch',{key:'lobbyBackground',value:input.value});return;
    case 'lobby-motion':await mutate('preferences.patch',{key:'lobbyMotion',value:input.value});return;
    default:return;
  }
}
// Existing renderer app.ts consumes the same small UI interface used by Electron.
browser.naruto={state:async()=>snapshot?state():sync(),command,onState:(fn:any)=>{listeners.add(fn);return()=>listeners.delete(fn)},
  credentials:async()=>(await request('credentials.metadata')).records,
  credentialSites:async()=>[{id:'br',label:msg('region.br')},{id:'cn',label:msg('region.cn')}],
  addCredential:(siteId:string,username:string,password:string,expected:object)=>request('credentials.addManual',{siteId,username,password,expected}),
  reveal:async(id:string)=>(await request('credentials.reveal',{id})).password,
  edit:async(id:string,username:string,password:string,expectedVersion?:string)=>{const r=(await request('credentials.metadata')).records.find((r:any)=>r.id===id);if(!r)throw new Error(msg('ui.record_no_longer_exists'));await request('credentials.edit',{id,origin:r.origin,username,password,expectedVersion});},
  remove:(id:string)=>request('credentials.remove',{id})};
function paintSelection(){
  const start=document.getElementById('open-game') as HTMLButtonElement|null;
  if(start){start.disabled=!snapshot||submitting||checked.size===0||!!snapshot?.reconciling;const span=start.querySelector('span');if(span)setText(span, submitting?msg('ui.starting'):msg('ui.launch'));setAttr(start, 'aria-label', submitting?msg('ui.starting_game'):pluralMessage('launch.action',checked.size));}
  for(const option of document.querySelectorAll<HTMLElement>('#profile-deck .lobby-option'))option.setAttribute('aria-selected',String(checked.has(option.dataset.id!)));
  const summary=document.getElementById('selection-summary');if(summary){
    summary.replaceChildren();
    for(const region of ['br','cn']){const names=(snapshot?.profiles||[]).filter((p:any)=>p.region===region&&checked.has(p.id)).map((p:any)=>p.name);if(names.length){const row=document.createElement('div');setText(row, `${region==='br'?msg('region.br'):msg('region.cn')}：${names.join('、')}`);summary.append(row);}}
    if(checked.size){const clear=document.createElement('button');clear.className='quiet small';setText(clear, msg('ui.clear_selection'));clear.onclick=()=>{selectionTouched=true;checked.clear();emit()};summary.append(clear)}
  }
  const auto=document.getElementById('center-auto-close');if(auto)auto.setAttribute('aria-checked',String(snapshot?.preferences.autoClose!==false));
  const runtime=document.getElementById('runtime-summary');if(runtime){const count=snapshot?.runningAccountCount||0;setText(runtime, count?pluralMessage('runtime.accounts',count):'');}
  const detail=document.getElementById('localization-detail');if(detail)setText(detail, msg('ui.applies_after_restarting_the_game'));
  const launchStatus=document.getElementById('profile-launch-status');if(launchStatus&&!launchStatus.textContent.trim())setText(launchStatus, notice);
}
window.addEventListener('DOMContentLoaded',()=>{
  const deck=document.getElementById('profile-deck')!;
  function toggle(target:EventTarget|null){const row=(target as HTMLElement)?.closest<HTMLElement>('.lobby-option');if(!row||row.getAttribute('aria-disabled')==='true')return false;const id=row.dataset.id!;selectionTouched=true;if(!checked.has(id))for(const other of [...checked])if(!snapshot?.profiles?.some((p:any)=>p.id===other&&p.region===selectedRegion))checked.delete(other);checked.has(id)?checked.delete(id):checked.add(id);emit();return true;}
  deck.addEventListener('click',e=>{if(toggle(e.target)){e.stopImmediatePropagation();e.preventDefault()}},true);
  deck.addEventListener('keydown',e=>{if(e.key===' '||e.key==='Enter'){const id=deck.getAttribute('aria-activedescendant');if(id&&toggle(document.getElementById(id))){e.stopImmediatePropagation();e.preventDefault()}}},true);
  document.getElementById('center-auto-close')!.onclick=async()=>{try{await mutate('preferences.patch',{key:'autoClose',value:!snapshot.preferences.autoClose})}catch(error){notice=String(error);emit()}};
  const observer=new MutationObserver(()=>{
    const dirty=!document.getElementById('dialog-backdrop')!.hidden;
    browser.webkit.messageHandlers.narutoCore.postMessage({command:'ui.state',payload:{dirty,settingsOpen:!document.getElementById('settings-panel')!.hidden}});
  });observer.observe(document.getElementById('dialog-backdrop')!,{attributes:true,attributeFilter:['hidden']});observer.observe(document.getElementById('settings-panel')!,{attributes:true,attributeFilter:['hidden']});
  const fitDock=()=>document.documentElement.style.setProperty('--dock-scale',String(Math.min(1,window.innerWidth/1000,window.innerHeight/700)));
  window.addEventListener('resize',fitDock);fitDock();
  paintSelection();
});
