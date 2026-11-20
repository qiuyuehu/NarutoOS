package com.tencent.morefun.naruto.plugin.operatingActivity.activitys.turntable_old
{
   import assets.turntable_old.RewardItemAsset;
   import com.tencent.morefun.naruto.plugin.ui.base.ItemRenderer;
   import com.tencent.morefun.naruto.plugin.ui.components.interfaces.IRender;
   import com.tencent.morefun.naruto.plugin.ui.tips.TipsManager;
   import com.tencent.morefun.naruto.util.StrReplacer;
   import flash.display.DisplayObject;
   import flash.events.MouseEvent;
   import flash.text.TextFormat;
   import serverProto.activity.ProtoLuckyWheelTask;
   
   public class TurntableItemRender extends ItemRenderer implements IRender
   {
      
      public function TurntableItemRender(param1:DisplayObject = null)
      {
         super(param1 is RewardItemAsset ? param1 : new RewardItemAsset());
         this.initUI();
      }
      
      private function initUI() : void
      {
         this.view.tf.mouseEnabled = false;
         this.view.get_btn.addEventListener(MouseEvent.CLICK,this.onClick);
      }
      
      private function localizeTask(value:String) : String
      {
         var labels:Object = {"Conectar-se ao jogo": "登录游戏", "Passar ou fazer raids em fases comuns": "通关或扫荡普通副本", "Passar ou fazer raids em fases de elite": "通关或扫荡精英副本", "Passar ou fazer raids no Teste Shinobi": "通关或扫荡忍者考试", "Participar da Sala da Abundância": "参加丰饶之间"};
         return labels[value] != null ? labels[value] : value;
      }

      override public function set data(param1:Object) : void
      {
         var _loc2_:ProtoLuckyWheelTask = null;
         super.data = param1;
         if(param1 is ProtoLuckyWheelTask)
         {
            _loc2_ = param1 as ProtoLuckyWheelTask;
            this.view.tf.text = StrReplacer.replace("%1：%2把钥匙",[this.localizeTask(_loc2_.taskDesc),_loc2_.keyNum]);
            this.view.tf.embedFonts = false;
            var format:TextFormat = this.view.tf.getTextFormat();
            format.font = "_sans";
            this.view.tf.setTextFormat(format);
            this.view.tf.height = 34;
            this.view.tf.y = this.view.tf.numLines > 1 ? 12 : 20;
            this.view.get_btn.enabled = _loc2_.taskStatus == 1;
            _loc2_.taskStatus == 3 && (this.view.get_btn.label = "已达领取上限");
            _loc2_.taskStatus == 2 && (this.view.get_btn.label = "已领取");
            _loc2_.taskStatus == 1 && (this.view.get_btn.label = "领取");
            _loc2_.taskStatus == 0 && (this.view.get_btn.label = "领取");
            TipsManager.singleton.unbinding(this.view.get_btn);
            _loc2_.taskStatus == 0 && TipsManager.singleton.binding(this.view.get_btn,"尚未满足领取条件");
            this.view.get_btn.width = _loc2_.taskStatus == 3 ? 140 : 110;
         }
      }
      
      override public function destroy() : void
      {
         if(this.view)
         {
            this.view.get_btn.removeEventListener(MouseEvent.CLICK,this.onClick);
            TipsManager.singleton.unbinding(this.view.get_btn);
         }
         super.destroy();
      }
      
      private function onClick(param1:MouseEvent) : void
      {
         TurntableView.instance.rewardReq(ProtoLuckyWheelTask(data).taskIdx);
      }
      
      private function get view() : RewardItemAsset
      {
         return m_skin as RewardItemAsset;
      }
      
      override public function get height() : Number
      {
         return 60;
      }
      
      public function dispose() : void
      {
         this.destroy();
      }
   }
}

