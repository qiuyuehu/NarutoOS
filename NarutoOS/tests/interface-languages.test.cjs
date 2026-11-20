const test=require('node:test'),assert=require('node:assert/strict');
const {msg,translate,resolveText,setLanguage,normalizeLanguage,pluralMessage,messageCode}=require('./helpers/i18n.cjs');
const fs=require('node:fs'),vm=require('node:vm'),{buildSync}=require('esbuild');
test('all supported languages render a retained notice, nested region and untrusted text',()=>{
 const username='<img src=x onerror=alert(1)> 中文',notice=msg('password.savePrompt',{username});
 for(const language of ['zh-CN','en','pt-BR','zh-CN']){
  setLanguage(language);assert.equal(resolveText(notice),translate('password.savePrompt',{username}));
  assert(resolveText(notice).includes(username));
  assert.equal(messageCode(new Error(msg('error.staleHost'))),'error.staleHost');
 }
});
test('legacy and invalid language values normalize to Chinese',()=>{
 for(const value of [undefined,null,{},'pt','EN',''])assert.equal(normalizeLanguage(value),'zh-CN');
 for(const value of ['zh-CN','en','pt-BR'])assert.equal(normalizeLanguage(value),value);
});
test('fallback uses Chinese, then an identifiable missing key',()=>{
 assert.equal(translate('test',{name:'Alice'},'en',{test:{'zh-CN':'你好 {name}'}}),'你好 Alice');
 assert.equal(translate('missing',{},'en',{}),'[missing]');
});
test('English and Portuguese use singular and plural count templates',()=>{
 for(const language of ['en','pt-BR']){
  setLanguage(language);
  for(const count of [0,1,2])assert.equal(resolveText(pluralMessage('launch.started',count)),translate('launch.started.'+(count===1?'one':'other'),{count}));
 }
});
test('layout migration preserves unrelated preferences and account data',()=>{
 const output=buildSync({entryPoints:['src/main/config.ts'],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
 const ctx={exports:{},module:{exports:{}},require,console,__filename:__filename,__dirname:__dirname};vm.createContext(ctx);vm.runInContext(output,ctx);
 const {normalizeLayout,defaultLayout}=ctx.module.exports;
 const layout=defaultLayout();layout.preferences.localization=true;layout.preferences.region='cn';layout.preferences.muted=true;layout.preferences.language='invalid';
 const next=normalizeLayout(layout);assert.equal(next.preferences.language,'zh-CN');assert.equal(next.preferences.localization,true);assert.equal(next.preferences.region,'cn');assert.equal(next.preferences.muted,true);
});
