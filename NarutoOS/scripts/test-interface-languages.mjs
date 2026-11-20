import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
const require=createRequire(import.meta.url),electron=require('electron');
const project=path.resolve(import.meta.dirname,'..');process.chdir(project);
const root=fs.mkdtempSync(path.join(project,'.test-artifacts/native-core-i18n-'));
const env={...process.env,NARUTO_C_ROOT:root,NARUTO_C_PROJECT:project,NARUTO_C_ELECTRON:electron,NARUTO_C_FIXTURE:'1',NARUTO_C_UI_CHECKS:'i18n',NARUTO_C_LAUNCHER_SMALL:'1',NARUTO_C_PREFERRED_LANGUAGES:'["zh-CN"]'};
delete env.ELECTRON_RUN_AS_NODE;
const socket=`/tmp/naruto-c-${process.getuid()}-${crypto.createHash('sha256').update(root).digest('hex').slice(0,16)}.sock`;
const children=[],results=[];let core;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,seconds=30){for(let i=0;i<seconds*10;i++){const value=await fn();if(value)return value;await pause(100)}throw Error('timeout')}
function request(command,payload={},role='center') {return new Promise((resolve,reject)=>{
 const token=JSON.parse(fs.readFileSync(path.join(root,'capabilities.json')))[role],c=net.createConnection(socket);let data='';
 const timer=setTimeout(()=>{c.destroy();reject(Error('IPC timeout'))},3000);
 c.on('error',error=>{clearTimeout(timer);reject(error)});c.on('connect',()=>c.write(JSON.stringify({v:1,role,token,command,payload})+'\n'));
 c.on('data',bytes=>{data+=bytes;if(!data.includes('\n'))return;clearTimeout(timer);c.end();const response=JSON.parse(data.split('\n')[0]);response.ok?resolve(response.value):reject(Object.assign(Error(response.message),{code:response.code}))});
})}
function start(role,quiet=false){const child=spawn(path.join(project,'dist/prototype/native',role),[],{env:{...env,...(role==='center'?{NARUTO_C_TOKEN:JSON.parse(fs.readFileSync(path.join(root,'capabilities.json'))).center}:{})},stdio:['ignore','ignore','pipe']});children.push(child);child.stderr.on('data',data=>{if(!quiet)process.stderr.write(data)});return child}
async function stop(child){if(!child||child.exitCode!==null||child.signalCode!==null)return;child.kill('SIGTERM');await new Promise(r=>child.once('exit',r))}
function check(name,value){assert(value,name);results.push(name);console.log('PASS '+name)}
async function readyCore(){return until(async()=>{try{return await request('snapshot')}catch{return false}})}
async function failedCore(){
 const child=start('core',true);
 await until(()=>child.exitCode!==null||child.signalCode!==null,5);
 assert(child.exitCode!==0||child.signalCode,'failed initialization must exit unsuccessfully');
 await assert.rejects(request('snapshot'));
}
const management=path.join(root,'management.json');
const preferred=values=>{env.NARUTO_C_PREFERRED_LANGUAGES=Array.isArray(values)?JSON.stringify(values):values};
async function patch(key,value){const state=await request('snapshot');return request('preferences.patch',{requestId:crypto.randomUUID(),revision:state.revision,key,value})}
try{
 buildSync({entryPoints:['src/shared/i18n.ts'],bundle:true,platform:'node',format:'cjs',target:'node12',outfile:path.join(root,'i18n-runtime.cjs')});
 execFileSync(electron,['tests/interface-toolbar-window.cjs'],{env:{...env,NARUTO_I18N_TEST_ROOT:root},stdio:'inherit',timeout:30000});
 check('toolbar prompts and 800px layouts in three languages',JSON.parse(fs.readFileSync(path.join(root,'toolbar-results.json'))).ok);
 execFileSync('/usr/bin/xcrun',['swiftc','src/prototype/native/Transport.swift','src/prototype/native/I18n.swift','src/prototype/native/Management.swift','tests/i18n-startup.swift','-o',path.join(root,'startup-check')]);
 const startup=extra=>JSON.parse(execFileSync(path.join(root,'startup-check'),[],{env:{...env,...extra},encoding:'utf8'}));
 preferred(['en-GB']);
 check('new configuration reads system language without writing',startup().language==='en'&&!fs.existsSync(management));
 preferred(['pt-PT']);
 check('missing data directory uses the same read-only selection',startup({NARUTO_C_ROOT:path.join(root,'not-created')}).language==='pt-BR'&&!fs.existsSync(path.join(root,'not-created')));
 preferred(['zh-CN']);core=start('core');await readyCore();await stop(core);
 const baseline=JSON.parse(fs.readFileSync(management));
 const legacy={...baseline,sentinel:{keep:'synthetic data'},preferences:{...baseline.preferences,region:'cn',localization:true,quality:'low',customPreference:'keep'}};
 delete legacy.preferences.language;
 const cases=[
  ['new Chinese',['zh-Hans-CN'],'zh-CN'],
  ['new English',['en-US'],'en'],
  ['new Portuguese',['pt-BR'],'pt-BR'],
  ['new unsupported then English',['fr-FR','en-GB','pt-BR'],'en'],
  ['new unsupported then Portuguese',['de-DE','pt-PT','en-US'],'pt-BR'],
  ['new traditional Chinese',['zh-Hant-TW','en-US'],'zh-CN'],
  ['new case and separators',['FR_fr',' PT_pt ','EN_us'],'pt-BR'],
  ['new English underscore',['EN_gb'],'en'],
  ['new unsupported',['fr-FR','de-DE'],'zh-CN'],
  ['new empty list',[],'zh-CN'],
  ['new language read failure','not-json','zh-CN'],
  ['legacy missing field',['fr-FR','en-GB'],'en',legacy],
  ...['zh-CN','en','pt-BR'].map(language=>['saved '+language,['en-US','pt-PT'],language,{...legacy,preferences:{...legacy.preferences,language}}]),
  ...['',null,12,{},['en'],'invalid'].map(language=>['invalid saved '+JSON.stringify(language),['en-US'],'zh-CN',{...legacy,preferences:{...legacy.preferences,language}}])
 ];
 for(const [name,languages,expected,saved] of cases){
  if(saved)fs.writeFileSync(management,JSON.stringify(saved));else fs.unlinkSync(management);
  const before=fs.existsSync(management)?fs.readFileSync(management,'utf8'):null;
  preferred(languages);check(name+': early selection stays read-only',startup().language===expected&&(before===null?!fs.existsSync(management):fs.readFileSync(management,'utf8')===before));
  core=start('core');const state=await readyCore();
  check(name+': core persists selection',state.preferences.language===expected&&JSON.parse(fs.readFileSync(management)).preferences.language===expected);
  if(saved){
   const persisted=JSON.parse(fs.readFileSync(management));
   check(name+': unrelated data preserved',JSON.stringify(persisted.profiles)===JSON.stringify(saved.profiles)&&JSON.stringify(persisted.sentinel)===JSON.stringify(saved.sentinel)&&Object.keys(saved.preferences).every(key=>key==='language'||JSON.stringify(persisted.preferences[key])===JSON.stringify(saved.preferences[key])));
  }
  await stop(core);preferred(['de-DE','pt-PT','en-US']);core=start('core');
  check(name+': saved selection ignores later system changes',(await readyCore()).preferences.language===expected&&startup().language===expected);
  await stop(core);
 }
 for(const damaged of ['{broken',JSON.stringify({...legacy,preferences:'invalid'})]){
  fs.writeFileSync(management,damaged);preferred(['en-US']);
  check('damaged configuration has Chinese read-only fallback',startup().language==='zh-CN'&&fs.readFileSync(management,'utf8')===damaged);
  await failedCore();check('damaged configuration remains intact after failed core startup',fs.readFileSync(management,'utf8')===damaged);
 }
 fs.writeFileSync(management,JSON.stringify(legacy));fs.chmodSync(management,0o000);
 try{check('unreadable configuration has Chinese read-only fallback',startup().language==='zh-CN');await failedCore()}
 finally{fs.chmodSync(management,0o600)}
 check('unreadable configuration is not replaced',fs.readFileSync(management,'utf8')===JSON.stringify(legacy));
 for(const saved of [legacy,null]){
  if(saved)fs.writeFileSync(management,JSON.stringify(saved));else fs.unlinkSync(management);
  const before=saved?fs.readFileSync(management,'utf8'):null;preferred(['en-US']);fs.chmodSync(root,0o500);
  try{await failedCore()}finally{fs.chmodSync(root,0o700)}
  check((saved?'legacy':'new')+': automatic save failure preserves original configuration',before===null?!fs.existsSync(management):fs.readFileSync(management,'utf8')===before);
  preferred(['pt-PT']);core=start('core');
  check((saved?'legacy':'new')+': failed initialization retries system selection',(await readyCore()).preferences.language==='pt-BR');await stop(core);
 }
 preferred(['en-US']);core=start('core');await readyCore();
 await patch('autoClose',false);await patch('lobbyMotion',false);
 for(const language of ['zh-CN','en','pt-BR']){
  await patch('language',language);const early=startup();
  check(`${language}: native early language and validation`,early.disconnectedCode==='error.coreDisconnected'&&early.language===language&&early.rejectsInvalid&&early.default==='zh-CN');
  check(`${language}: native early error translated`,early.title===({'zh-CN':'Naruto OS 未能启动',en:'Naruto OS could not start','pt-BR':'Não foi possível iniciar o Naruto OS'})[language]);
 }
 const missingResources=startup({NARUTO_C_PROJECT:path.join(root,'missing-resources')});check('missing resources retain a Chinese startup error',missingResources.title.includes('启动失败'));
 const before=await request('snapshot');fs.renameSync(path.join(root,'management.json'),path.join(root,'saved-config.json'));fs.mkdirSync(path.join(root,'management.json'));
 await assert.rejects(patch('language','en'));
 const after=await request('snapshot');check('real save failure rolls back language and revision',after.preferences.language===before.preferences.language&&after.revision===before.revision);
 fs.rmdirSync(path.join(root,'management.json'));fs.renameSync(path.join(root,'saved-config.json'),path.join(root,'management.json'));
 await assert.rejects(patch('language','pt'));check('invalid submitted language is rejected',true);
 // Long synthetic data remains literal in every language.
 const state=await request('snapshot');await request('catalog.update',{requestId:crypto.randomUUID(),revision:state.revision,id:'br-1',name:'<img src=x> Synthetic long account 长账号名字',serverNote:'S123 / S456'});
 for(const language of ['zh-CN','en','pt-BR']){
  await stop(core);
  const saved=JSON.parse(fs.readFileSync(management));delete saved.preferences.language;fs.writeFileSync(management,JSON.stringify(saved));
  preferred([language==='pt-BR'?'pt-PT':language==='en'?'en-GB':'zh-Hant-TW']);core=start('core');await readyCore();
  for(const file of ['ui-check.json','ui-center.png'])if(fs.existsSync(path.join(root,file)))fs.unlinkSync(path.join(root,file));
  const center=start('center');const result=await until(()=>fs.existsSync(path.join(root,'ui-check.json'))&&JSON.parse(fs.readFileSync(path.join(root,'ui-check.json'))),60);
  check(`${language}: WK UI (${result.checks?.length||0} assertions) ${result.error||''}`,result.ok);
  await until(()=>fs.existsSync(path.join(root,'ui-center.png')));
  fs.renameSync(path.join(root,'ui-center.png'),path.join(root,`${language}.png`));
  fs.writeFileSync(path.join(root,`${language}.json`),JSON.stringify(result,null,2));
  const view=JSON.parse(fs.readFileSync(path.join(root,'center-view.json')));
  check(`${language}: native menu synchronized`,view.language===language&&view.menuTitles.includes(({'zh-CN':'设置…',en:'Settings…','pt-BR':'Ajustes…'})[language]));
  await stop(center);
 }
 await stop(core);
 const stored=JSON.parse(fs.readFileSync(path.join(root,'management.json')));stored.preferences.language='invalid-old-value';fs.writeFileSync(path.join(root,'management.json'),JSON.stringify(stored));
 core=start('core');await until(async()=>{try{return await request('snapshot')}catch{return false}});
 check('invalid stored language normalizes without changing accounts',(await request('snapshot')).preferences.language==='zh-CN'&&(await request('snapshot')).profiles[0].name===stored.profiles[0].name);
 await patch('language','pt-BR');await stop(core);core=start('core');await until(async()=>{try{return (await request('snapshot')).preferences.language==='pt-BR'}catch{return false}});check('saved language survives core restart',true);
 await patch('localization',false);
 await request('batch.start',{requestId:crypto.randomUUID(),profileIds:['br-1']});
 await until(()=>fs.existsSync(path.join(root,'fixture-status.json')));
 const initial=await request('snapshot');
 for(const localization of [false,true]){
 await patch('localization',localization);
 for(const language of ['zh-CN','en','pt-BR','zh-CN']){
  await patch('language',language);
  const view=await until(()=>{const value=JSON.parse(fs.readFileSync(path.join(root,'fixture-status.json')));return value.interface?.language===language&&value});
  check(`${language}: live host toolbar and menu`,view.window.settingsMenu&&view.interface.settings===({'zh-CN':'设置',en:'Settings','pt-BR':'Ajustes'})[language]);
  check(`${language}: game session survives (localization=${localization})`,view.pid===initial.hostPID&&view.tasks[0].profileId==='br-1'&&view.tasks[0].status==='ready'&&(await request('snapshot')).preferences.localization===localization);
 }
 }
 fs.writeFileSync(path.join(root,'results.json'),JSON.stringify({ok:true,results},null,2));
}catch(error){fs.writeFileSync(path.join(root,'results.json'),JSON.stringify({ok:false,results,error:String(error)},null,2));console.error(error);process.exitCode=1}
finally{
 try{const state=await request('snapshot');if(state.hostPID)process.kill(state.hostPID,'SIGTERM')}catch{}
 for(const child of children.reverse())await stop(child);
 console.log('语言验收结果：'+root);
}
