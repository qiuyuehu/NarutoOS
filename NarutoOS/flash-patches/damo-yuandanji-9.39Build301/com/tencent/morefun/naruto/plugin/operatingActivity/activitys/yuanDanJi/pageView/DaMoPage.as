package com.tencent.morefun.naruto.plugin.operatingActivity.activitys.yuanDanJi.pageView
{
   import bag.data.ItemData;
   import bag.utils.BagUtils;
   import base.NarutoAPI;
   import base.ProtocalUtil;
   import com.tencent.morefun.naruto.plugin.exui.item.ItemIcon;
   import com.tencent.morefun.naruto.plugin.operatingActivity.activitys.yuanDanJi.YuanDanJiView;
   import com.tencent.morefun.naruto.plugin.operatingActivity.activitys.yuanDanJi.pageView.daMo.DaMoGame;
   import com.tencent.morefun.naruto.plugin.ui.base.BitmapText;
   import com.tencent.morefun.naruto.plugin.ui.box.BaseBox;
   import com.tencent.morefun.naruto.util.GameTip;
   import com.tencent.morefun.naruto.util.StrReplacer;
   import com.tencent.morefun.naruto.util.TimeUtils;
   import def.BoxFlagDef;
   import def.ProtocolCmdDef;
   import flash.display.DisplayObject;
   import flash.display.MovieClip;
   import flash.display.Sprite;
   import flash.events.MouseEvent;
   import flash.geom.Point;
   import flash.text.TextField;
   import flash.text.TextFormat;
   import flash.utils.clearTimeout;
   import flash.utils.setTimeout;
   import plugin.operatingActivity.yuanDanJi.HelpUI;
   import plugin.operatingActivity.yuanDanJi.Number23;
   import serverProto.activity.ProtoAwardPackageBox;
   import serverProto.activity.ProtoDharmaHitRsp;
   import serverProto.inc.EmptyMessage;
   import serverProto.inc.ProtoItemInfo;
   import ui.command.ShowTextBoxCommand;

   public class DaMoPage extends BaseTabPage
   {

      private var m_baseView:YuanDanJiView;

      private var view:MovieClip;

      private var _bitmapText:BitmapText;

      private var _iconArr:Vector.<ItemIcon> = new Vector.<ItemIcon>();

      private var game:DaMoGame;

      private var _openUIRsp:ProtoDharmaHitRsp;

      private var assistButtons:Array = [];

      public function DaMoPage(param1:MovieClip, param2:YuanDanJiView)
      {
         super();
         this.view = param1;
         this.m_baseView = param2;
         this.hide();
         this.initUI();
      }

      private function initUI() : void
      {
         var _loc2_:ItemIcon = null;
         this.game = new DaMoGame(this.view,this.applyStart,this.applyAward,this.gameOver);
         this._bitmapText = new BitmapText(new Number23(),23,32,0,false,"1234567890",null,true);
         this._bitmapText.mouseChildren = this._bitmapText.mouseEnabled = false;
         this.view.container_artNum.addChild(this._bitmapText);
         this.view.btn_help.addEventListener(MouseEvent.CLICK,this.onClickHelp);
         this.createAssistControls();
         var _loc1_:int = 0;
         while(_loc1_ < 6)
         {
            _loc2_ = new ItemIcon(45,45);
            this._iconArr.push(_loc2_);
            _loc1_++;
         }
      }

      private function createAssistControls() : void
      {
         var modes:Array = ["single","round"];
         var labels:Array = ["完美敲击一次","完成本轮"];
         var buttonWidth:Number = 120;
         var reference:DisplayObject = this.view["btn_help"] as DisplayObject;
         var rowX:Number = reference.x + (reference.width - buttonWidth) / 2;
         var rowY:Number = reference.y + reference.height + 16;
         var button:Sprite = null;
         var label:TextField = null;
         var index:int = 0;
         while(index < modes.length)
         {
            button = new Sprite();
            button.name = modes[index];
            button.x = rowX;
            button.y = rowY + index * 36;
            button.buttonMode = true;
            button.mouseChildren = false;
            label = new TextField();
            label.defaultTextFormat = new TextFormat("_sans",11,0xFFFFFF,true);
            label.text = labels[index];
            label.width = buttonWidth;
            label.height = 25;
            label.x = 0;
            label.y = 5;
            label.selectable = false;
            label.mouseEnabled = false;
            button.addChild(label);
            button.addEventListener(MouseEvent.CLICK,this.onAssistButtonClick);
            this.view.addChild(button);
            this.assistButtons.push({button:button,label:label,mode:modes[index],width:buttonWidth,highlightTimer:uint(0)});
            index++;
         }
         this.updateAssistControls();
      }

      private function updateAssistControls() : void
      {
         var item:Object = null;
         for each(item in this.assistButtons)
         {
            this.drawAssistButton(item,false);
         }
      }

      private function drawAssistButton(param1:Object, param2:Boolean) : void
      {
         param1.button.graphics.clear();
         param1.button.graphics.lineStyle(1,param2 ? 0xFFF0B5 : 0xC77725,1);
         param1.button.graphics.beginFill(param2 ? 0xE9A83B : 0x8F4D14,0.96);
         param1.button.graphics.drawRoundRect(0,0,param1.width,28,6,6);
         param1.button.graphics.endFill();
         param1.label.textColor = param2 ? 0xFFFFFF : 0xFFE5C2;
      }

      private function flashAssistButton(param1:Object) : void
      {
         if(param1.highlightTimer != 0)
         {
            clearTimeout(param1.highlightTimer);
         }
         this.drawAssistButton(param1,true);
         param1.highlightTimer = setTimeout(this.restoreAssistButton,140,param1);
      }

      private function restoreAssistButton(param1:Object) : void
      {
         param1.highlightTimer = 0;
         this.drawAssistButton(param1,false);
      }

      private function onAssistButtonClick(param1:MouseEvent) : void
      {
         var item:Object = null;
         param1.stopImmediatePropagation();
         for each(item in this.assistButtons)
         {
            if(item.button === param1.currentTarget)
            {
               this.flashAssistButton(item);
               break;
            }
         }
         if(this.game == null)
         {
            return;
         }
         if(!this.game.isStart || this.game.isGameOver)
         {
            return;
         }
         if(Sprite(param1.currentTarget).name == "single")
         {
            this.game.assistOnePerfectHit();
         }
         else
         {
            this.game.assistCompleteRound();
         }
      }

      private function onClickHelp(param1:MouseEvent) : void
      {
         var _loc2_:HelpUI = new HelpUI();
         var _loc3_:BaseBox = new BaseBox(_loc2_,true,true);
         _loc3_.closeButton = _loc2_.btn_close;
         _loc3_.show();
      }

      private function applyQuery() : void
      {
         ProtocalUtil.instance.sendMessageAndRsp(ProtocolCmdDef.CMD_ACTIVITY_DHARMA_HIT_QUERY,new EmptyMessage(),ProtoDharmaHitRsp,this.onQueryS2C);
      }

      private function onQueryS2C(param1:ProtoDharmaHitRsp) : void
      {
         if(Boolean(param1) && Boolean(param1.ret) && param1.ret.code == 0)
         {
            this._openUIRsp = param1;
            this.updateView();
         }
      }

      private function applyStart() : void
      {
         if(int(this._bitmapText.text) == 0)
         {
            if(this._openUIRsp == null || this._openUIRsp.remainCostCount == 0)
            {
               GameTip.show(I18n.lang("as_operatingActivity_f08becd4b03c782ae1279190e8a45757001"));
               this.updateAssistControls();
            }
            else
            {
               new ShowTextBoxCommand(StrReplacer.replace(I18n.lang("as_operatingActivity_f08becd4b03c782ae1279190e8a45757"),this._openUIRsp.cost),BoxFlagDef.OK | BoxFlagDef.CANCEL,true,null,function(param1:int):void
               {
                  if(param1 == BoxFlagDef.OK)
                  {
                     startGame();
                  }
                  else
                  {
                     updateAssistControls();
                  }
               }).call();
            }
         }
         else
         {
            this.startGame();
         }
      }

      private function startGame() : void
      {
         ProtocalUtil.instance.sendMessageAndRsp(ProtocolCmdDef.CMD_ACTIVITY_DHARMA_HIT_START,new EmptyMessage(),ProtoDharmaHitRsp,this.onStartS2C);
      }

      private function onStartS2C(param1:ProtoDharmaHitRsp) : void
      {
         if(Boolean(param1) && Boolean(param1.ret) && param1.ret.code == 0)
         {
            this._openUIRsp = param1;
            this.updateView();
            if(this._openUIRsp.firstIn == 0)
            {
               this.game.frist(this.playGame);
            }
            else
            {
               this.playGame();
            }
         }
         else
         {
            this.updateAssistControls();
         }
      }

      private function playGame() : void
      {
         this.game.start();
         this.setMouseEnable(false);
      }

      private function applyAward() : void
      {
         ProtocalUtil.instance.sendMessageAndRsp(ProtocolCmdDef.CMD_ACTIVITY_DHARMA_HIT_AWARD,new EmptyMessage(),ProtoDharmaHitRsp,this.onAwardS2C,null,false);
      }

      private function onAwardS2C(param1:ProtoDharmaHitRsp) : void
      {
         var _loc2_:Point = null;
         if(Boolean(param1) && Boolean(param1.ret) && param1.ret.code == 0)
         {
            this._openUIRsp = param1;
            this.updateView();
            _loc2_ = new Point(300,170);
            _loc2_ = this.view.localToGlobal(_loc2_);
            NarutoAPI.showAward(param1.award,_loc2_);
         }
      }

      private function gameOver() : void
      {
         this.setMouseEnable(true);
         this.updateAssistControls();
      }

      private function updateView() : void
      {
         var _loc2_:int = 0;
         var _loc3_:ProtoAwardPackageBox = null;
         var _loc4_:ProtoItemInfo = null;
         var _loc5_:ItemData = null;
         var _loc6_:ItemIcon = null;
         var _loc1_:Date = new Date(this._openUIRsp.endTime * 1000);
         this.m_baseView.setTime(TimeUtils.getFullTimeStrUnion(this._openUIRsp.endTime));
         this.setCount(this._openUIRsp.remainCount);
         this.removeAllIcon();
         if(this.game.isStart)
         {
            _loc2_ = 0;
            while(_loc2_ < this._openUIRsp.box.length)
            {
               _loc3_ = this._openUIRsp.box[_loc2_] as ProtoAwardPackageBox;
               if(_loc3_.awardStatus == 2)
               {
                  _loc4_ = _loc3_.award[0];
                  _loc5_ = BagUtils.createItemData(_loc4_.id,_loc4_.num);
                  _loc6_ = this._iconArr[_loc2_];
                  _loc6_.loadIconByData(_loc5_,true,true);
                  _loc6_.x = 7;
                  _loc6_.y = 50 + _loc2_ * 45;
                  this.view.addChild(_loc6_);
               }
               _loc2_++;
            }
         }
      }

      private function setCount(param1:int) : void
      {
         this._bitmapText.text = String(param1);
         this._bitmapText.x = -this._bitmapText.width / 2;
         this._bitmapText.y = -this._bitmapText.height / 2 - 3;
      }

      private function removeAllIcon() : void
      {
         var _loc1_:ItemIcon = null;
         for each(_loc1_ in this._iconArr)
         {
            if(Boolean(_loc1_) && Boolean(_loc1_.parent))
            {
               _loc1_.parent.removeChild(_loc1_);
            }
         }
      }

      private function setMouseEnable(param1:Boolean) : void
      {
         if(Boolean(this.view) && Boolean(this.view.parent))
         {
            this.view.parent.mouseEnabled = param1;
            this.view.parent.mouseChildren = true;
         }
         if(this.m_baseView)
         {
            this.m_baseView.isLock = !param1;
         }
      }

      override public function show() : void
      {
         this.view.visible = true;
         this.applyQuery();
      }

      override public function hide() : void
      {
         this.view.visible = false;
         if(this.game)
         {
            this.game.stop();
         }
         this.updateAssistControls();
      }

      override public function destroy() : void
      {
         var item:Object = null;
         if(this.game)
         {
            this.game.stop();
         }
         this.updateAssistControls();
         this.view.btn_help.removeEventListener(MouseEvent.CLICK,this.onClickHelp);
         for each(item in this.assistButtons)
         {
            item.button.removeEventListener(MouseEvent.CLICK,this.onAssistButtonClick);
            if(item.highlightTimer != 0)
            {
               clearTimeout(item.highlightTimer);
               item.highlightTimer = 0;
            }
            if(item.button.parent)
            {
               item.button.parent.removeChild(item.button);
            }
         }
         this.assistButtons = null;
         this._bitmapText.destroy();
         var _loc1_:int = 0;
         while(_loc1_ < this._iconArr.length)
         {
            this._iconArr[_loc1_].destroy();
            this._iconArr[_loc1_] = null;
            _loc1_++;
         }
         this._iconArr = null;
         this.game.dispose();
         this.game = null;
         this._openUIRsp = null;
         this.view = null;
         this.m_baseView = null;
      }
   }
}
