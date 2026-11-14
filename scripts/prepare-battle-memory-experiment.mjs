import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(root, '.test-artifacts/battle-memory-experiment-2026-11-03');
const tools = path.join(root, '.test-artifacts/battle-memory-analysis/tools');
const java = path.join(tools, 'jre/jdk-21.0.13+9-jre/Contents/Home/bin/java');
const jar = path.join(tools, 'ffdec/ffdec.jar');
const original = path.join(base, 'original/entry-9.38Build301.swf');
const sourceDirectory = path.join(base, 'bridge-v2-source-9.38');
fs.mkdirSync(sourceDirectory, { recursive: true });
let source = fs.readFileSync(path.join(base, 'decompiled-9.38-one/Application.as'), 'utf8');
source = source.replace('import def.PluginDef;', `import def.PluginDef;
   import def.ModelDef;
   import flash.system.ApplicationDomain;
   import com.tencent.morefun.framework.net.MultiThreadLoader;`);
const old = /ExternalInterface\.addCallback\("flashDetect",flashDetect\);/;
if (!old.test(source)) throw new Error('Flash ExternalInterface anchor not found; do not change another script');
source = source.replace(old, `$&
                  ExternalInterface.addCallback("narutoExperimentStatus",this.narutoExperimentStatus);
                  ExternalInterface.addCallback("narutoExperimentLoadManagerGc",this.narutoExperimentLoadManagerGc);`);
const methods = `
      private function narutoExperimentStatus():Object
      {
         var rows:* = MultiThreadLoader.collectResourceRefer();
         var count:int = 0;
         var zero:int = 0;
         for each(var row:Object in rows)
         {
            count++;
            if(row.referCount == 0) zero++;
         }
         var domain:ApplicationDomain = ApplicationDomain.currentDomain;
         var identity:Boolean = domain.getDefinition("com.tencent.morefun.framework.net.LoadManager") === LoadManager
             && domain.getDefinition("com.tencent.morefun.framework.net.MultiThreadLoader") === MultiThreadLoader;
         var battle:BattleInfo = ApplicationData.singleton.getModel(ModelDef.BATTLE) as BattleInfo;
         var active:Boolean = battle == null || battle.isFighting || battle.startTime >= 0;
         var loading:Boolean = LoadManager.running;
         return {patchId:"naruto-load-manager-gc-v2",loaderURL:this.rootInfo.url,
             classIdentity:identity,battleKnown:battle != null,battleActive:active,loading:loading,
             resourceCount:count,zeroReferenceCount:zero,totalMemory:System.totalMemory,
             freeMemory:System.freeMemory,privateMemory:System.privateMemory,
             ready:identity && count > 0 && battle != null && !active && !loading};
      }
      private function narutoExperimentLoadManagerGc():Object
      {
         var before:Object = this.narutoExperimentStatus();
         if(!before.ready) return {called:false,before:before};
         LoadManager.gc();
         return {called:true,before:before,after:this.narutoExperimentStatus()};
      }
`;
source = source.replace('      private function onGlobelAlert', methods + '\n      private function onGlobelAlert');
fs.writeFileSync(path.join(sourceDirectory, 'Application.as'), source);
const compile = (source, output) => execFileSync(java, ['-Djava.awt.headless=true', '-jar', jar, '-importScript', original, output, source], { stdio: 'inherit' });
compile(sourceDirectory, path.join(base, 'patched/entry-9.38Build301-gc-bridge-v2.swf'));

// Real PPAPI fixture. The original document class remains `entry`; only its
// source is replaced. No account data or game server is used by this fixture.
const fixtureSource = path.join(base, 'bridge-fixture-source');
fs.mkdirSync(fixtureSource, { recursive: true });
fs.writeFileSync(path.join(fixtureSource, 'entry.as'), `package {
 import flash.display.Sprite;
 import flash.external.ExternalInterface;
 import flash.net.URLLoader;
 import flash.net.URLRequest;
 import flash.events.Event;
 public class entry extends Sprite {
  private var child:URLLoader;
  private var childText:String = "pending";
  private var calls:int = 0;
  public function entry() {
   super();
   ExternalInterface.addCallback("narutoExperimentStatus",status);
   ExternalInterface.addCallback("narutoExperimentLoadManagerGc",collect);
   child = new URLLoader();
   child.addEventListener(Event.COMPLETE,function(e:Event):void {childText=String(child.data);});
   child.load(new URLRequest("relative.txt"));
  }
  private function status():Object {
   return {patchId:"naruto-load-manager-gc-v2",loaderURL:loaderInfo.url,classIdentity:true,
    battleKnown:true,battleActive:false,loading:childText == "pending",resourceCount:1,
    zeroReferenceCount:1,totalMemory:1,freeMemory:0,privateMemory:1,ready:childText == "relative-ok",
    childText:childText,calls:calls};
  }
  private function collect():Object { var before:Object=status();calls++;return {called:true,before:before,after:status()}; }
 }
}`);
compile(fixtureSource, path.join(base, 'patched/bridge-fixture.swf'));
console.log('实验 v2 与 PPAPI fixture 已编译；未加载到真实游戏');
