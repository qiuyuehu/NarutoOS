import type { AppState, Command, Preferences } from '../../shared/model';
// The browser receives fixed business commands only; role credentials remain native.
const browser = window as any;
const pending = new Map<string, { resolve: (value:any)=>void; reject:(reason:Error)=>void; timer:ReturnType<typeof setTimeout> }>();
function request(command:string,payload:object={}):Promise<any>{
  return new Promise((resolve,reject)=>{
    const id=crypto.randomUUID();const timer=setTimeout(()=>{pending.delete(id);reject(new Error('暂未响应，请稍后重试'));},5000);
    pending.set(id,{resolve,reject,timer});browser.webkit.messageHandlers.narutoCore.postMessage({id,command,payload});
  });
}
browser.__narutoResponse=(id:string,result:any)=>{const p=pending.get(id);if(!p)return;pending.delete(id);clearTimeout(p.timer);result.ok?p.resolve(result.value):p.reject(new Error(result.message||'操作未完成'));};
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
  return {preferences,tabs:[],activeId:null,settingsOpen,prompt:null,recovery:null,refresh:{enabled:false,label:'刷新'},flash:{version:snapshot?.hostPID?(runtime.flash||preferences.flash):preferences.flash,available:true},localizationActive:!!runtime.localizationActive,notice,
    profiles,selectedProfileId:[...checked].find(id=>profiles.some((p:any)=>p.id===id&&p.region===selectedRegion))||snapshot.selectedByRegion[selectedRegion]||null,profileDiscovery:snapshot?'ready':'loading',profileError:'',canCreateProfile:snapshot.canCreateProfile,profilePickerOpen,profilePickerIntent:pickerIntent};
}
function emit(){if(!snapshot)return;document.documentElement.dataset.centerSettings=String(settingsOpen);for(const fn of listeners)fn(state());paintSelection();}
browser.__narutoSnapshot=(value:any)=>{
  snapshot=value;
  if(value.centerIntent?.id && value.centerIntent.id!==lastCenterIntent){lastCenterIntent=value.centerIntent.id;if(value.centerIntent.page==='settings')settingsOpen=true;}
  if(lastBatchId){const batch=value.batches.find((b:any)=>b.id===lastBatchId);if(batch){const rejected=batch.items.filter((i:any)=>i.status==='rejected');notice=rejected.length?'未接管：'+rejected.map((i:any)=>`${i.profileId}（${i.reason==='unknown-profile'?'档案不存在或正在清理':i.reason||'请求未接受'}）`).join('、'):batch.items.every((i:any)=>i.accepted)?`已启动 ${batch.items.length} 个账号`:'正在启动所选账号…';}}
  if(lastRegion===undefined)selectedRegion=value.preferences.region||'br';lastRegion=selectedRegion;
  for(const id of checked)if(!value.profiles.some((p:any)=>p.id===id&&!p.deleting))checked.delete(id);
  if(!selectionTouched){checked.clear();const id=value.selectedByRegion[selectedRegion];if(id)checked.add(id);}
  emit();
};
async function sync(){browser.__narutoSnapshot(await request('snapshot'));return state();}
const mutationIds=new Map<string,{requestId:string;revision:number}>();
async function mutate(command:string,payload:object={}){const key=JSON.stringify([command,payload]);let identity=mutationIds.get(key);if(!identity){identity={requestId:crypto.randomUUID(),revision:snapshot.revision};mutationIds.set(key,identity)}try{const result=await request(command,{...identity,...payload});mutationIds.delete(key);await sync();return result;}catch(error){await sync().catch(()=>{});if(/版本|已更新/.test(String(error)))mutationIds.delete(key);throw error;}}
async function launch(ids:string[]){
  const selected=[...new Set(ids)];
  if(requestBatch && (requestBatch.ids.length!==selected.length||requestBatch.ids.some(id=>!selected.includes(id)))){
    const previous=await request('batch.get',{id:requestBatch.id});
    if(previous.found && previous.batch.items.some((item:any)=>item.status==='pending')){
      await sync();throw new Error('上一批账号仍在启动，请稍后重试');
    }
    // The old request is either resolved or confirmed absent before a new selection is submitted.
    requestBatch=undefined;
  }
  requestBatch??={id:crypto.randomUUID(),ids:selected};
  const batch=requestBatch;lastBatchId=batch.id;
  const response=await request('batch.start',{requestId:batch.id,profileIds:batch.ids});
  if(requestBatch===batch)requestBatch=undefined;
  notice='正在启动所选账号…';await sync();return response;
}
async function command(input:Command):Promise<void|boolean>{
  switch(input.type){
    case 'settings':settingsOpen=!settingsOpen;emit();return;
    case 'home':settingsOpen=false;profilePickerOpen=false;emit();return;
    case 'region':selectedRegion=input.value;if(!selectionTouched){checked.clear();const id=snapshot.selectedByRegion[selectedRegion];if(id)checked.add(id);}emit();await mutate('preferences.patch',{key:'region',value:input.value});return;
    case 'profile-start':
      if(!snapshot || snapshot.reconciling || !checked.size || submitting)return false;
      submitting=true;paintSelection();
      try {await launch([...checked]);} finally {submitting=false;paintSelection();}
      return;
    case 'profile-open':await launch([input.id]);return true;
    case 'profile-select':await mutate('catalog.select',{id:input.id});checked.clear();checked.add(input.id);selectionTouched=false;profilePickerOpen=false;emit();return;
    case 'profile-create':await mutate('catalog.create',{region:selectedRegion,name:input.name,serverNote:input.serverNote});return;
    case 'profile-update':await mutate('catalog.update',input);return;
    case 'profile-delete':await mutate('catalog.delete',{id:input.id});return;
    case 'profiles-picker':case 'new':pickerIntent=input.type==='new'?'open':'select';profilePickerOpen=true;emit();return;
    case 'profiles-close-picker':profilePickerOpen=false;emit();return;
    case 'profiles-retry':await sync();return;
    case 'overlay':return;
    case 'quality':case 'localization':case 'theme':await mutate('preferences.patch',{key:input.type,value:input.value});return;
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
  credentialSites:async()=>[{id:'br',label:'巴西服'},{id:'cn',label:'国服'}],
  addCredential:(siteId:string,username:string,password:string,expected:object)=>request('credentials.addManual',{siteId,username,password,expected}),
  reveal:async(id:string)=>(await request('credentials.reveal',{id})).password,
  edit:async(id:string,username:string,password:string,expectedVersion?:string)=>{const r=(await request('credentials.metadata')).records.find((r:any)=>r.id===id);if(!r)throw new Error('记录已不存在');await request('credentials.edit',{id,origin:r.origin,username,password,expectedVersion});},
  remove:(id:string)=>request('credentials.remove',{id})};
function paintSelection(){
  const start=document.getElementById('open-game') as HTMLButtonElement|null;
  if(start){start.disabled=!snapshot||submitting||checked.size===0||!!snapshot?.reconciling;const span=start.querySelector('span');if(span)span.textContent='出发';start.setAttribute('aria-label',`出发，启动 ${checked.size} 个账号`);}
  for(const option of document.querySelectorAll<HTMLElement>('#profile-deck .lobby-option'))option.setAttribute('aria-selected',String(checked.has(option.dataset.id!)));
  const summary=document.getElementById('selection-summary');if(summary){
    summary.replaceChildren();
    for(const region of ['br','cn']){const names=(snapshot?.profiles||[]).filter((p:any)=>p.region===region&&checked.has(p.id)).map((p:any)=>p.name);if(names.length){const row=document.createElement('div');row.textContent=`${region==='br'?'巴西服':'国服'}：${names.join('、')}`;summary.append(row);}}
    if(checked.size){const clear=document.createElement('button');clear.className='quiet small';clear.textContent='清空所选';clear.onclick=()=>{selectionTouched=true;checked.clear();emit()};summary.append(clear)}
  }
  const auto=document.getElementById('center-auto-close');if(auto)auto.setAttribute('aria-checked',String(snapshot?.preferences.autoClose!==false));
  const runtime=document.getElementById('runtime-summary');if(runtime){const count=snapshot?.runningAccountCount||0;runtime.textContent=count?'宿主运行中 · '+count+' 个账号':'';}
  const detail=document.getElementById('localization-detail');if(detail)detail.textContent='重启游戏后生效';
  const launchStatus=document.getElementById('profile-launch-status');if(launchStatus&&!launchStatus.textContent.trim())launchStatus.textContent=notice;
}
window.addEventListener('DOMContentLoaded',()=>{
  const clearTitles=(node:Element)=>{node.removeAttribute('title');for(const child of node.querySelectorAll('[title]'))child.removeAttribute('title')};
  clearTitles(document.documentElement);
  new MutationObserver(records=>{for(const record of records){if(record.type==='attributes')(record.target as Element).removeAttribute('title');else for(const node of record.addedNodes)if(node instanceof Element)clearTitles(node)}}).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['title']});
  const deck=document.getElementById('profile-deck')!;
  function toggle(target:EventTarget|null){const row=(target as HTMLElement)?.closest<HTMLElement>('.lobby-option');if(!row||row.getAttribute('aria-disabled')==='true')return false;const id=row.dataset.id!;selectionTouched=true;checked.has(id)?checked.delete(id):checked.add(id);emit();return true;}
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
