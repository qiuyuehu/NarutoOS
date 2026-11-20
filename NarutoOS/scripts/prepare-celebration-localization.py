"""Prepare activity-scoped display translations from the verified 9.40 export."""
from pathlib import Path
import json,re
r=Path(__file__).resolve().parent.parent;prefix='com/tencent/morefun/naruto/plugin/operatingActivity/activitys/turntable_old/'
catalog=json.loads((r/'localization/celebration-turntable.zh-CN.json').read_text())
translations={k.removeprefix('as_operatingActivity_'):v for k,v in catalog['i18n'].items()}
labels=catalog['labels'];tasks=catalog['tasks']
source=r/'.test-artifacts/activity-assist-9.40Build300/original-export/scripts';out=r/'flash-patches/celebration-localization-9.40Build300'
for name in ['TurntableView.as','TurntableItemRender.as','ruleView.as']:
 s=(source/prefix/name).read_text()
 for key,value in translations.items():s=s.replace('I18n.lang("as_operatingActivity_'+key+'")',json.dumps(value,ensure_ascii=False))
 if name=='TurntableView.as':
  s=s.replace('   import flash.display.', '   import flash.display.',1)
  pos=s.index('   import flash.display.');s=s[:pos]+'   import flash.display.DisplayObjectContainer;\n'+s[pos:]
  helper='''      private function localizeStaticText(container:DisplayObjectContainer) : void
      {
         var labels:Object = LABELS;
         var field:TextField = null;
         var format:TextFormat = null;
         for(var index:int = 0; index < container.numChildren; index++)
         {
            if(container.getChildAt(index) is TextField)
            {
               field = container.getChildAt(index) as TextField;
               if(labels[field.text] != null)
               {
                  format = field.getTextFormat();
                  format.font = "_sans";
                  field.embedFonts = false;
                  field.defaultTextFormat = format;
                  field.text = labels[field.text];
                  field.setTextFormat(format);
               }
            }
            else if(container.getChildAt(index) is DisplayObjectContainer)
            {
               this.localizeStaticText(container.getChildAt(index) as DisplayObjectContainer);
            }
         }
      }

'''.replace('LABELS',json.dumps(labels,ensure_ascii=False))
  pos=s.index('      private function initView()');s=s[:pos]+helper+s[pos:]
  s=s.replace('         this._ui.tab4.visible = false;', '         this._ui.timeTxt.embedFonts = false;\n         var timeFormat:TextFormat = this._ui.timeTxt.getTextFormat();\n         timeFormat.font = "_sans";\n         this._ui.timeTxt.defaultTextFormat = timeFormat;\n         this._ui.tab4.visible = false;')
  buttons = '\n'.join('         this._ui.' + field + '.label = ' + json.dumps(labels[text],ensure_ascii=False) + ';' for field,text in [('getReward_mc.getRewardAll_btn','Retirar tudo'),('treasure_mc.getTreasureAll_btn','Retirar tudo'),('getReward_mc.luck_mc.buy_btn','Comprar'),('treasure_mc.luck_mc.buy_btn','Comprar')])
  s=s.replace('         this._ui.tab4.visible = false;', buttons + '\n         this._ui.tab4.visible = false;')
  # Insert at the end of these existing rendering functions only.
  for method in ['initView','showTitle']:
   a=s.index('      private function '+method+'(');brace=s.index('{',a);depth=1;i=brace+1
   while depth:
    if s[i]=='{':depth+=1
    elif s[i]=='}':depth-=1
    i+=1
   s=s[:i-1]+'   this.localizeStaticText(this._ui);\n      '+s[i-1:]
  # The localized TurntableView is the first new class code run when activity
  # 810020 opens. Emit tagged stage markers through the PPAPI console so the
  # native host can retain only these diagnostics, without recording page data.
  s=s.replace('   import flash.events.MouseEvent;', '   import flash.events.MouseEvent;\n   import flash.external.ExternalInterface;')
  diagnostic='''      private function activityAssistDiagnostic(stage:String, error:Error = null) : void
      {
         var message:String = "[ACTIVITY-ASSIST-DIAG] " + stage;
         if(error != null)
         {
            message += " error=" + error.name + "#" + error.errorID;
         }
         try
         {
            ExternalInterface.call("console.log",message);
         }
         catch(ignored:Error)
         {
         }
      }

'''
  pos=s.index('      override protected function onAssetsLoadFinish()')
  s=s[:pos]+diagnostic+s[pos:]
  s=s.replace('         super(OpenTurntableCommand);', '         super(OpenTurntableCommand);\n         this.activityAssistDiagnostic("constructor.ready");',1)
  def wrap_method(source, signature):
   start=source.index(signature);brace=source.index('{',start);depth=1;i=brace+1
   while depth:
    if source[i]=='{':depth+=1
    elif source[i]=='}':depth-=1
    i+=1
   body=source[brace+1:i-1]
   return source[:brace+1]+'\n         try\n         {\n            this.activityAssistDiagnostic("asset-load.begin");'+body+'\n         }\n         catch(error:Error)\n         {\n            this.activityAssistDiagnostic("onAssetsLoadFinish.error",error);\n            throw error;\n         }\n      '+source[i-1:]
  s=wrap_method(s,'      override protected function onAssetsLoadFinish()')
  for old,new in [
   ('         this._ui = new TurntableAsset();','         this.activityAssistDiagnostic("asset.create.begin");\n         this._ui = new TurntableAsset();\n         this.activityAssistDiagnostic("asset.create.end");'),
   ('         this.initData();','         this.activityAssistDiagnostic("initData.begin");\n         this.initData();\n         this.activityAssistDiagnostic("initData.end");'),
   ('         this.initView();','         this.activityAssistDiagnostic("initView.begin");\n         this.initView();\n         this.activityAssistDiagnostic("initView.end");'),
   ('            this.showTitle(1);','            this.activityAssistDiagnostic("showTitle.begin");\n            this.showTitle(1);\n            this.activityAssistDiagnostic("showTitle.end");'),
   ('this.showTitle(int(activityParam));','this.activityAssistDiagnostic("showTitle.begin");\n            this.showTitle(int(activityParam));\n            this.activityAssistDiagnostic("showTitle.end");'),
   ('         addChild(this._ui);','         addChild(this._ui);\n         this.activityAssistDiagnostic("ui.added");'),
   ('         super.onAssetsLoadFinish();','         super.onAssetsLoadFinish();\n         this.activityAssistDiagnostic("activity.ready");'),
   ('         this._ui.timeTxt.embedFonts = false;','         this.activityAssistDiagnostic("font.begin");\n         this._ui.timeTxt.embedFonts = false;'),
   ('         this._ui.getReward_mc.getRewardAll_btn.label = "全部领取";','         this.activityAssistDiagnostic("font.end");\n         this.activityAssistDiagnostic("button-labels.begin");\n         this._ui.getReward_mc.getRewardAll_btn.label = "全部领取";'),
   ('         this._ui.tab4.visible = false;','         this.activityAssistDiagnostic("button-labels.end");\n         this._ui.tab4.visible = false;'),
   ('         this._ui.tab1.mouseChildren = this._ui.tab2.mouseChildren = this._ui.tab3.mouseChildren = this._ui.tab4.mouseChildren = false;','         this._ui.tab1.mouseChildren = this._ui.tab2.mouseChildren = this._ui.tab3.mouseChildren = this._ui.tab4.mouseChildren = false;\n         this.activityAssistDiagnostic("tabs.children.end");'),
   ('         this._ui.tab1.buttonMode = this._ui.tab2.buttonMode = this._ui.tab3.buttonMode = this._ui.tab4.buttonMode = true;','         this._ui.tab1.buttonMode = this._ui.tab2.buttonMode = this._ui.tab3.buttonMode = this._ui.tab4.buttonMode = true;\n         this.activityAssistDiagnostic("tabs.mode.end");'),
   ('         this._ui.addEventListener(MouseEvent.CLICK,this.clickHandler);','         this._ui.addEventListener(MouseEvent.CLICK,this.clickHandler);\n         this.activityAssistDiagnostic("click-listener.end");'),
   ('         this._ui.treasure_mc.luck_mc.num_tf.defaultTextFormat = new TextFormat(null,null,null,true);','         this._ui.treasure_mc.luck_mc.num_tf.defaultTextFormat = new TextFormat(null,null,null,true);\n         this.activityAssistDiagnostic("number-format.end");'),
   ('         this._powerTf = new BitmapText(new NumBmpAsset(),40,43,-3,true,"1234567890 ");','         this.activityAssistDiagnostic("bitmap-text.begin");\n         this._powerTf = new BitmapText(new NumBmpAsset(),40,43,-3,true,"1234567890 ");\n         this.activityAssistDiagnostic("bitmap-text.end");'),
   ('         this._ui.treasure_mc.addChild(this._powerTf);','         this._ui.treasure_mc.addChild(this._powerTf);\n         this.activityAssistDiagnostic("bitmap-text.added");'),
   ('         TipsManager.singleton.binding(this._ui.treasure_mc.luck_mc,"幸运钥匙可用于转动转盘，可通过活动获得或在商店购买。");','         TipsManager.singleton.binding(this._ui.treasure_mc.luck_mc,"幸运钥匙可用于转动转盘，可通过活动获得或在商店购买。");\n         this.activityAssistDiagnostic("tooltips.end");'),
   ('         this._rankList = new EasyLayout(TurntableItemRender,5,1);','         this.activityAssistDiagnostic("task-layout.begin");\n         this._rankList = new EasyLayout(TurntableItemRender,5,1);\n         this.activityAssistDiagnostic("task-layout.end");'),
   ('         this.mRankLayout = new EasyLayout(TurntableRankItem,9,1,-8,-8,true,new EasyLayoutScrollBar_3_Skin());','         this.activityAssistDiagnostic("rank-layout.begin");\n         this.mRankLayout = new EasyLayout(TurntableRankItem,9,1,-8,-8,true,new EasyLayoutScrollBar_3_Skin());\n         this.activityAssistDiagnostic("rank-layout.end");'),
   ('         BagUtils.model.addEventListener(ModelEvent.UPDATE,this.onBagModelUpdate);','         this.activityAssistDiagnostic("treasure-loops.end");\n         BagUtils.model.addEventListener(ModelEvent.UPDATE,this.onBagModelUpdate);\n         this.activityAssistDiagnostic("bag-listener.end");'),
   ('         this.localizeStaticText(this._ui);','         this.activityAssistDiagnostic("recursive-translate.begin");\n         this.localizeStaticText(this._ui);\n         this.activityAssistDiagnostic("recursive-translate.end");')]:
   if old not in s: raise ValueError('诊断标记锚点不存在: '+old)
   s=s.replace(old,new,1)
 if name=='TurntableItemRender.as':
  s=s.replace('[_loc2_.taskDesc,_loc2_.keyNum]','[this.localizeTask(_loc2_.taskDesc),_loc2_.keyNum]')
  # Font fallback for the Chinese task string, without changing row dimensions.
  s=s.replace('   import flash.events.MouseEvent;','   import flash.events.MouseEvent;\n   import flash.text.TextFormat;')
  s=s.replace('            this.view.tf.height = 34;', '            this.view.tf.embedFonts = false;\n            var format:TextFormat = this.view.tf.getTextFormat();\n            format.font = "_sans";\n            this.view.tf.setTextFormat(format);\n            this.view.tf.height = 34;')
  helper='''      private function localizeTask(value:String) : String
      {
         var labels:Object = TASKS;
         return labels[value] != null ? labels[value] : value;
      }

'''.replace('TASKS',json.dumps(tasks,ensure_ascii=False))
  pos=s.index('      override public function set data');s=s[:pos]+helper+s[pos:]
 if name=='ruleView.as':
  s=s.replace('   import flash.events.MouseEvent;', '   import flash.events.MouseEvent;\n   import com.tencent.morefun.naruto.plugin.operatingActivity.activitys.turntable_old.ruleViewUI;\n   import flash.text.TextFormat;')
  s=s.replace('         this._ui.rule.htmlText =', '         this._ui.rule.embedFonts = false;\n         var format:TextFormat = this._ui.rule.getTextFormat();\n         format.font = "_sans";\n         this._ui.rule.defaultTextFormat = format;\n         this._ui.rule.htmlText =',1)
 dest=out/prefix/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(s)
p=r/'flash-patches/activity-assist.json';spec=json.loads(p.read_text());spec['localizationPatches']=[{'id':'celebration-turntable-zh-CN','directory':out.name,'files':[prefix+n for n in ['TurntableView.as','TurntableItemRender.as','ruleView.as']]}];p.write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n')
