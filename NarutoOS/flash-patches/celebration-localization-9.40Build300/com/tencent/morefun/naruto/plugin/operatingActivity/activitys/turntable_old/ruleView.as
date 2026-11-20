package com.tencent.morefun.naruto.plugin.operatingActivity.activitys.turntable_old
{
   import com.tencent.morefun.naruto.plugin.ui.box.BaseBox;
   import com.tencent.morefun.naruto.plugin.ui.box.IBox;
   import flash.events.MouseEvent;
   import com.tencent.morefun.naruto.plugin.operatingActivity.activitys.turntable_old.ruleViewUI;
   import flash.text.TextFormat;
   import naruto.component.controls.ButtonClose;
   
   public class ruleView extends BaseBox
   {
      
      private var _ui:ruleViewUI;
      
      private var _closeBtn:ButtonClose;
      
      public function ruleView()
      {
         super(this._ui = new ruleViewUI(),true,false,true,5,"");
         this.initUI();
      }
      
      private function initUI() : void
      {
         this._closeBtn = this._ui.closeButton;
         this._closeBtn.addEventListener(MouseEvent.CLICK,this.onClickHandle);
         this._ui.rule.embedFonts = false;
         var format:TextFormat = this._ui.rule.getTextFormat();
         format.font = "_sans";
         this._ui.rule.defaultTextFormat = format;
         this._ui.rule.htmlText = "<b>" + "1）活动期间，每天通过游戏内任务最多可获得20把免费钥匙，也可在商店购买。\n2）每把钥匙可转动转盘1次并获得奖励，累计转动达到指定次数还可领取额外奖励。\n3）活动结束后钥匙将消失，累计转动次数的奖励会通过邮件发放。" + "</b>";
      }
      
      private function onClickHandle(param1:MouseEvent) : void
      {
         this.close();
      }
      
      override public function show(param1:String = null) : IBox
      {
         return super.show(param1);
      }
      
      override public function close() : void
      {
         super.close();
      }
      
      override public function destroy() : void
      {
         this._closeBtn.removeEventListener(MouseEvent.CLICK,this.onClickHandle);
         this._closeBtn.dispose();
         this._closeBtn = null;
         super.destroy();
      }
   }
}

