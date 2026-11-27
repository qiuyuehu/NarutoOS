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
  const independent={id:'independent',nameKey:'ui.assist_scripts',
    targets:[target({url:'https://example.com/independent.swf'})]};
  for(const modules of [[a,b,independent],[independent,b,a]]){
    const result=readAssistPack(pack(modules));
    assert.deepEqual(result.modules.map(item=>item.id),['independent']);
    assert.deepEqual(result.rejected.map(item=>item.moduleId).sort(),[a.id,b.id]);
    for(const item of result.rejected){
      assert.ok(item.reason.includes(target().url));
      assert.ok(item.reason.includes(a.id));
      assert.ok(item.reason.includes(b.id));
    }
  }
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

test('daily wanted is offered only on its registered CN HUD with assists enabled', () => {
  const output = path.join(work, 'manager.cjs');
  buildSync({entryPoints: [path.join(root, 'src/main/assist-manager.ts')], outfile: output,
    bundle: true, platform: 'node', format: 'cjs', external: ['electron']});
  const {createAssistManager} = require(output);
  const checkout = fs.mkdtempSync(path.join(work, 'checkout-'));
  fs.symlinkSync(path.join(root, 'assets'), path.join(checkout, 'assets'));
  for (const packaged of [false, true]) {
    assert.equal(createAssistManager(checkout, packaged, false, work, () => {}), undefined);
    const manager = createAssistManager(checkout, packaged, true, work, () => {});
    const module = manager.status().modules.find(item => item.id === 'cn-daily-wanted');
    assert.equal(module.state, 'ready');
    assert.deepEqual(module.regions, ['cn']);
    const hud = manager.resources.find(resource => resource.url ===
      'https://res.huoying.qq.com/NarutoBeta11.17Build302/flash/hud/HudPlugin.swf');
    // Verified against the complete CN response body and its cache record's size and CRC.
    assert.equal(hud?.baseSha256, '104b64041595404be4b6537023c97938deb9dd87d184db668633b3af6b0031bc');
  }
});

test('manager records extra resource acceptance, failure and conflict by source', () => {
  const output = path.join(work, 'manager-extra.cjs');
  buildSync({entryPoints:[path.join(root,'src/main/assist-manager.ts')],outfile:output,
    bundle:true,platform:'node',format:'cjs',external:['electron']});
  const {createAssistManager} = require(output);
  const checkout = fs.mkdtempSync(path.join(work,'checkout-extra-'));
  fs.symlinkSync(path.join(root,'assets'),path.join(checkout,'assets'));
  const resource = url => ({url,bytes:swf,contentType:'application/x-shockwave-flash',baseSha256:digest(swf)});
  const bundledURL = 'https://res.huoying.qq.com/NarutoBeta11.17Build302/flash/hud/HudPlugin.swf';
  const acceptedURL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.40Build300/flash/other/OtherPlugin.swf';
  const speedURL = 'https://cdnnaruto-pt.oasgames.com/PT_NarutoAlpha9.40Build300/flash/core/naruto.core.swf';
  const extra = [
    {moduleId:'activity-assist',region:'br',variant:'localized-assist',target:acceptedURL,resource:resource(acceptedURL)},
    {moduleId:'speed-assist',region:'cn',variant:'NarutoBeta11.17Build302',target:bundledURL,resource:resource(bundledURL)},
    {moduleId:'speed-assist',region:'br',variant:'NarutoAlpha9.40Build300',target:'https://speed.invalid/cn.swf',failure:'补丁摘要不匹配'},
    {moduleId:'speed-assist',region:'cn',variant:'cn-build',target:acceptedURL,resource:resource(acceptedURL)},
    {moduleId:'speed-assist',region:'br',variant:'br-build',target:speedURL,resource:resource(speedURL)},
  ];
  const manager = createAssistManager(checkout,true,true,work,()=>{},extra);
  const status = manager.status();
  assert.equal(status.extraResources[0].state,'accepted');
  assert.equal(status.extraResources[0].moduleId,'activity-assist');
  assert.equal(status.extraResources[0].variant,'localized-assist');
  assert.equal(status.extraResources[1].state,'conflict');
  assert.equal(status.extraResources[1].moduleId,'speed-assist');
  assert.equal(status.extraResources[1].occupiedBy,'cn-daily-wanted');
  assert.match(status.extraResources[1].reason,/HudPlugin\.swf/);
  assert.equal(status.extraResources[2].state,'unavailable');
  assert.equal(status.extraResources[2].region,'br');
  assert.match(status.extraResources[2].reason,/摘要不匹配/);
  assert.equal(status.extraResources[3].state,'conflict');
  assert.equal(status.extraResources[3].occupiedBy,'activity-assist');
  assert.match(status.extraResources[3].reason,/speed-assist.*activity-assist|activity-assist.*speed-assist/);
  assert.equal(status.extraResources[4].state,'accepted','the same source may keep its independent target');
  assert.ok(manager.resources.includes(extra[0].resource),'accepted resources retain identity for speed override filtering');
  assert.ok(!manager.resources.includes(extra[1].resource),'a conflicting resource is never registered');
  assert.ok(manager.resources.includes(extra[4].resource));
});

test('extras remain diagnosable and register when the master assist switch is off', () => {
  const output = path.join(work, 'manager-disabled-extra.cjs');
  buildSync({entryPoints:[path.join(root,'src/main/assist-manager.ts')],outfile:output,
    bundle:true,platform:'node',format:'cjs',external:['electron']});
  const {createAssistManager} = require(output);
  const checkout = fs.mkdtempSync(path.join(work,'checkout-disabled-extra-'));
  const resource = {url:'https://speed.invalid/cn.swf',bytes:swf,contentType:'application/x-shockwave-flash'};
  const manager = createAssistManager(checkout,false,false,work,()=>{},[
    {moduleId:'game-speed',region:'cn',variant:'build-1',target:resource.url,resource},
  ]);
  assert.ok(manager);
  assert.equal(manager.status().enabled,false,'status.enabled reports the master assist switch');
  assert.equal(manager.status().modules.length,0);
  assert.equal(manager.status().extraResources[0].state,'accepted');
  assert.ok(manager.resources.includes(resource));
  assert.equal(createAssistManager(checkout,false,false,work,()=>{}),undefined);
});
