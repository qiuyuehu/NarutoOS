const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),{buildSync}=require('esbuild');
const root=path.resolve(__dirname,'..'),work=path.join(root,'.test-artifacts/celebration-tests');fs.mkdirSync(work,{recursive:true});
const folder='com/tencent/morefun/naruto/plugin/operatingActivity/activitys/turntable_old/';
const patch=path.join(root,'flash-patches/celebration-localization-9.40Build300',folder);
buildSync({entryPoints:[path.join(root,'src/main/activity-assist-pack.ts')],outfile:path.join(work,'pack.cjs'),bundle:true,platform:'node',target:'node12'});
const {readActivityAssistPack,ACTIVITY_ASSIST_DIRECTORY}=require(path.join(work,'pack.cjs'));
test('localization selects its own variant and preserves the accepted assist-only bytes',()=>{
 const dir=path.join(root,'assets',ACTIVITY_ASSIST_DIRECTORY),original=readActivityAssistPack(dir),localized=readActivityAssistPack(dir,true);
 assert.equal(original.url,localized.url);assert(!original.bytes.equals(localized.bytes));
 assert.equal(require('node:crypto').createHash('sha256').update(original.bytes).digest('hex'),'94d784db6ceb527f5a72a2aa9a45999be8ae42755951431baac433943da89be6');
 const fixture=fs.mkdtempSync(path.join(work,'invalid-'));fs.cpSync(dir,fixture,{recursive:true});
 const manifest=JSON.parse(fs.readFileSync(path.join(fixture,'manifest.json')));fs.appendFileSync(path.join(fixture,manifest.localizedFile),'invalid');assert.throws(()=>readActivityAssistPack(fixture,true),/清单/);assert(readActivityAssistPack(fixture));
});
function method(source,name){source=source.replace(/\r\n/g,'\n');const re=new RegExp('(?:private|public|protected) function '+name+'\\('),match=re.exec(source);assert(match,name);const start=source.indexOf('{',match.index);let depth=1,i=start+1;while(depth){if(source[i]==='{')depth++;if(source[i]==='}')depth--;i++;}return source.slice(match.index,i).replace(/^(private|public|protected) /,'');}
test('the real task text helper translates known server descriptions and preserves unknown tasks',()=>{
 const source=fs.readFileSync(path.join(patch,'TurntableItemRender.as'),'utf8');
 const js=ts.transpileModule(method(source,'localizeTask'),{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 const translate=vm.runInNewContext(js+'\nlocalizeTask');
 assert.equal(translate('Conectar-se ao jogo'),'登录游戏');assert.equal(translate('Passar ou fazer raids em fases comuns'),'通关或扫荡普通副本');assert.equal(translate('Passar ou fazer raids em fases de elite'),'通关或扫荡精英副本');assert.equal(translate('Passar ou fazer raids no Teste Shinobi'),'通关或扫荡忍者考试');assert.equal(translate('Participar da Sala da Abundância'),'参加丰饶之间');assert.equal(translate('Future task'),'Future task');
});
test('UI translation walks only the supplied subtree, with font fallback and unknown text preserved',()=>{
 const source=fs.readFileSync(path.join(patch,'TurntableView.as'),'utf8');
 const js=ts.transpileModule(method(source,'localizeStaticText').replace(/\bis\b/g,'instanceof'),{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 class Container{constructor(children=[]){this.children=children;this.numChildren=children.length;}getChildAt(i){return this.children[i];}}
 class TextField{constructor(text){this.text=text;this.embedFonts=true;}getTextFormat(){return {font:'original',size:12,color:123};}setTextFormat(value){this.format=value;}}
 const translate=vm.runInNewContext(js+'\nlocalizeStaticText',{DisplayObjectContainer:Container,TextField});const known=new TextField('Obter chaves'),unknown=new TextField('12345'),external=new TextField('Regras');
 const owner={localizeStaticText:translate};translate.call(owner,new Container([new Container([known]),unknown]));
 assert.equal(known.text,'获取钥匙');assert.equal(known.embedFonts,false);assert.equal(known.format.color,123);assert.equal(unknown.text,'12345');assert.equal(external.text,'Regras');
});
if(process.env.CELEBRATION_EXPORTED==='1')test('localized artifact changes only its three renderers; all protocol calls stay identical',()=>{
 const base=path.join(root,'.test-artifacts/activity-assist-9.40Build300/patched-export/scripts'),localized=path.join(root,'.test-artifacts/celebration-localization/localized-export/scripts');
 const list=dir=>{const result=[];function walk(d){for(const f of fs.readdirSync(d,{withFileTypes:true})){const full=path.join(d,f.name);if(f.isDirectory())walk(full);else if(full.endsWith('.as'))result.push(path.relative(dir,full));}}walk(dir);return result.sort();};
 const a=list(base),b=list(localized);assert.deepEqual(a,b);const normalized=file=>fs.readFileSync(file,'utf8').replace(/\s+/g,' ').trim();
 const changed=a.filter(f=>normalized(path.join(base,f))!==normalized(path.join(localized,f)));assert.deepEqual(changed,[folder+'TurntableItemRender.as',folder+'TurntableView.as',folder+'ruleView.as'].sort());
 for(const file of ['TurntableView.as','TurntableItemRender.as']){
  const calls=s=>s.match(/ProtocalUtil\.instance\.sendMessageAndRsp\([^;\n]*\);/g)||[];
  const original=fs.readFileSync(path.join(root,'.test-artifacts/activity-assist-9.40Build300/original-export/scripts',folder,file),'utf8'),translated=fs.readFileSync(path.join(patch,file),'utf8');assert.deepEqual(calls(translated),calls(original));const handler=file==='TurntableView.as'?'close':'onClick';assert.equal(method(translated,handler),method(original,handler));
 }
});
