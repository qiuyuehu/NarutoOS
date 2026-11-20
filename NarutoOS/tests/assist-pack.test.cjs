// Contract tests for the bundled assist manifest: unknown builds, broken patches,
// conflicting targets and credential URLs must be rejected before any game session
// sees them. Runtime Flash behaviour is verified separately on a real session.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {buildSync}=require('esbuild');
const root=path.resolve(__dirname,'..'),work=path.join(root,'.test-artifacts/assist-pack-tests');
fs.rmSync(work,{recursive:true,force:true});fs.mkdirSync(work,{recursive:true});
const bundle=path.join(work,'pack.cjs');
buildSync({entryPoints:[path.join(root,'src/main/assist-pack.ts')],outfile:bundle,bundle:true,platform:'node',format:'cjs',target:'node12'});
const {readAssistPack}=require(bundle);
const swf=Buffer.concat([Buffer.from('FWS'),Buffer.from([10,0,0,0]),Buffer.alloc(64,1)]);
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
function pack(modules,extra={}){
  const dir=fs.mkdtempSync(path.join(work,'pack-'));
  for(const file of new Set(modules.flatMap(item=>item.targets.map(target=>target.file)))){
    fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});
    fs.writeFileSync(path.join(dir,file),swf);
  }
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({id:'naruto-assists-v1',version:1,modules,...extra}));
  return dir;
}
const target=(overrides={})=>({region:'cn',build:'NarutoBeta6.38Build302',
  url:'https://res.huoying.qq.com/NarutoBeta6.38Build302/flash/huntLife/HuntLifePlugin.swf',
  file:'huntlife/HuntLifePlugin.batch-assist.swf',sha256:digest(swf),baseSha256:digest(swf),
  contentType:'application/x-shockwave-flash',...overrides});
const assistModule=(targets)=>({id:'huntlife-batch',nameKey:'ui.assist_chakra_batch',targets});

test('valid pack loads the registered target',()=>{
  const result=readAssistPack(pack([assistModule([target()])]));
  assert.equal(result.rejected.length,0);
  assert.equal(result.modules.length,1);
  assert.equal(result.modules[0].targets[0].identity,'https://res.huoying.qq.com/NarutoBeta6.38Build302/flash/huntLife/HuntLifePlugin.swf');
});

test('wrong patch digest is rejected instead of loading unknown bytes',()=>{
  const result=readAssistPack(pack([assistModule([target({sha256:digest(Buffer.from('other'))})])]));
  assert.equal(result.modules.length,0);
  assert.match(result.rejected[0].reason,/摘要不匹配/);
});

test('credential-bearing URL is rejected',()=>{
  const result=readAssistPack(pack([assistModule([target({url:'https://user:pass@res.huoying.qq.com/a.swf'})])]));
  assert.equal(result.modules.length,0);
  assert.match(result.rejected[0].reason,/URL/);
});

test('path traversal is rejected',()=>{
  const result=readAssistPack(pack([assistModule([target({file:'../escape.swf'})])]));
  assert.equal(result.modules.length,0);
  assert.match(result.rejected[0].reason,/越界/);
});

test('non-SWF payload is rejected',()=>{
  const dir=fs.mkdtempSync(path.join(work,'pack-'));
  const html=Buffer.from('<html></html>');
  fs.mkdirSync(path.join(dir,'huntlife'),{recursive:true});
  fs.writeFileSync(path.join(dir,'huntlife/HuntLifePlugin.batch-assist.swf'),html);
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({id:'naruto-assists-v1',version:1,modules:[assistModule([target({sha256:digest(html)})])]}));
  const result=readAssistPack(dir);
  assert.equal(result.modules.length,0);
  assert.match(result.rejected[0].reason,/SWF/);
});

test('two modules claiming the same resource are both rejected, independent of order',()=>{
  const a=assistModule([target()]),b={id:'second',nameKey:'ui.assist_scripts',targets:[target()]};
  const forward=readAssistPack(pack([a,b]));
  const reverse=readAssistPack(pack([b,a]));
  assert.equal(forward.modules.length,0,'no module may win a shared resource by being declared first');
  assert.equal(reverse.modules.length,0);
  assert.equal(forward.rejected.length,2);
  assert.equal(reverse.rejected.length,2);
  for(const item of forward.rejected)assert.match(item.reason,/资源冲突/);
});

test('a broken module does not block a healthy one that declares the same resource',()=>{
  const broken=assistModule([target(),target({url:'https://res.huoying.qq.com/other.swf',file:'other.swf',sha256:digest(Buffer.from('wrong'))})]);
  const healthy={id:'healthy',nameKey:'ui.assist_scripts',targets:[target()]};
  const result=readAssistPack(pack([broken,healthy]));
  assert.equal(result.modules.length,1,'the healthy module must still load');
  assert.equal(result.modules[0].id,'healthy');
  assert.equal(result.rejected.length,1);
  assert.equal(result.rejected[0].moduleId,'huntlife-batch');
});

test('unknown manifest version is rejected as a whole',()=>{
  const dir=pack([assistModule([target()])]);
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({id:'naruto-assists-v1',version:2,modules:[]}));
  assert.throws(()=>readAssistPack(dir),/版本不匹配/);
});

test('shipped pack matches its manifest',()=>{
  const result=readAssistPack(path.join(root,'assets/assists'));
  assert.equal(result.rejected.length,0);
  assert.ok(result.modules.length>=1);
});
