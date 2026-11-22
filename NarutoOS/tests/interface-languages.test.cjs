const test=require('node:test'),assert=require('node:assert/strict');
const {msg,translate,resolveText,setLanguage,normalizeLanguage,pluralMessage}=require('./helpers/i18n.cjs');
const fs=require('node:fs'),vm=require('node:vm'),{buildSync}=require('esbuild');
test('a retained password prompt follows the current language and preserves the account name',()=>{
 const username='<img src=x onerror=alert(1)> 中文';
 const notice=msg('password.savePrompt',{username});
 const chinese='保存 '+username+' 的密码？';
 for(const [language,expected] of [
  ['zh-CN',chinese],
  ['en','Save the password for '+username+'?'],
  ['pt-BR','Salvar a senha de '+username+'?'],
  ['zh-CN',chinese],
 ]){
  setLanguage(language);
  assert.equal(resolveText(notice),expected);
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
 for(const [language,expected] of [
  ['en',['Started 0 accounts','Started 1 account','Started 2 accounts']],
  ['pt-BR',['0 contas iniciadas','1 conta iniciada','2 contas iniciadas']],
 ]){
  setLanguage(language);
  for(const [count,text] of expected.entries()){
   assert.equal(resolveText(pluralMessage('launch.started',count)),text);
  }
 }
});
test('layout migration preserves unrelated preferences',()=>{
 const output=buildSync({entryPoints:['src/main/config.ts'],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
 const ctx={exports:{},module:{exports:{}},require,console,__filename:__filename,__dirname:__dirname};vm.createContext(ctx);vm.runInContext(output,ctx);
 const {normalizeLayout,defaultLayout}=ctx.module.exports;
 const layout=defaultLayout();layout.preferences.localization=true;layout.preferences.region='cn';layout.preferences.muted=true;layout.preferences.language='invalid';
 const next=normalizeLayout(layout);assert.equal(next.preferences.language,'zh-CN');assert.equal(next.preferences.localization,true);assert.equal(next.preferences.region,'cn');assert.equal(next.preferences.muted,true);
});
