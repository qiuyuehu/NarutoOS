package com.tencent.morefun.naruto.plugin.operatingActivity.activitys.ninjutsuTrain2
{
   import base.ProtocalUtil;
   import def.ProtocolCmdDef;
   import flash.display.DisplayObject;
   import flash.display.MovieClip;
   import flash.display.Sprite;
   import flash.text.TextField;
   import flash.text.TextFormat;
   import flash.events.Event;
   import flash.events.MouseEvent;
   import flash.filters.BitmapFilter;
   import flash.filters.ColorMatrixFilter;
   import serverProto.activity.ProtoAwardPackageBox;
   import serverProto.activity.ProtoNinjaTrainChooseReq;
   import serverProto.activity.ProtoNinjaTrainRsp;
   import naruto.component.controls.ButtonNormalBlue;
   
   public class TrainView
   {
      
      private var mBgUI:*;

      private var assistButton:Sprite;

      private var assistReady:Boolean = false;

      private var assistBusy:Boolean = false;
      
      private var arrHandItem:Array;
      
      private var grayFilter:BitmapFilter;
      
      private var successPanel:NinjutsuTrainSuccessPanel;
      
      private var failPanel:NinjutsuTrainFailPanel;
      
      public function TrainView(param1:*)
      {
         super();
         this.mBgUI = param1;
         this.initUI();
      }
      
      public function initUI() : void
      {
         var _loc2_:HandItem = null;
         this.arrHandItem = [];
         var _loc1_:int = 0;
         while(_loc1_ < 12)
         {
            _loc2_ = new HandItem();
            _loc2_.index = _loc1_;
            _loc2_.x = _loc1_ % 6 * 90;
            _loc2_.y = int(_loc1_ / 6) * 71;
            this.mBgUI.listSpace.addChild(_loc2_);
            this.arrHandItem.push(_loc2_);
            _loc2_.addEventListener(MouseEvent.MOUSE_DOWN,this.onHandClick);
            _loc1_++;
         }
         this.createAssistButton();
         this.reset();
      }
      
      private function createAssistButton() : void
      {
         var button:Sprite = null;
         try
         {
            var native:ButtonNormalBlue = new ButtonNormalBlue();
            native.label = "完成本组结印";
            native.width = 136;
            native.height = 28;
            button = native;
         }
         catch(error:Error)
         {
            button = this.makeFallbackAssistButton();
         }
         button.name = "narutoCompleteCurrentSeals";
         button.x = this.mBgUI.listSpace.x + 384;
         button.y = this.mBgUI.ninjutsuName.y - 36;
         button.mouseChildren = false;
         button.addEventListener(MouseEvent.CLICK,this.onAssistClick);
         this.assistButton = button;
         this.mBgUI.addChild(this.assistButton);
         this.updateAssistButton();
      }
      
      private function makeFallbackAssistButton() : Sprite
      {
         var sprite:Sprite = new Sprite();
         sprite.graphics.lineStyle(1,0xCFA253,1);
         sprite.graphics.beginFill(0x102B43,0.96);
         sprite.graphics.drawRoundRect(0,0,136,28,6,6);
         sprite.graphics.endFill();
         var label:TextField = new TextField();
         var format:TextFormat = new TextFormat("_sans",12,0xFFF1CB,true);
         format.align = "center";
         label.defaultTextFormat = format;
         label.text = "完成本组结印";
         label.width = 128;
         label.height = 24;
         label.x = 4;
         label.y = 4;
         label.selectable = false;
         label.mouseEnabled = false;
         sprite.addChild(label);
         return sprite;
      }

      private function canAssist() : Boolean
      {
         if(!this.mBgUI || !this.assistReady || this.assistBusy || !this.mBgUI.stage)
         {
            return false;
         }
         var node:DisplayObject = this.mBgUI as DisplayObject;
         while(node)
         {
            if(!node.visible)
            {
               return false;
            }
            node = node.parent;
         }
         if(this.model.gameStatus != this.model.STATUS_STARTED || this.model.finishCount >= 3 ||
            this.mBgUI.finishOneAnim.visible || this.mBgUI.explodeAnim.visible ||
            new Date().time - this.model.startTime >= this.model.totalSeconds * 1000 ||
            !this.model.ninjutsuOrder || !this.model.ninjutsuOrder.orders)
         {
            return false;
         }
         var orders:Vector.<int> = this.model.ninjutsuOrder.orders;
         if(orders.length < 3 || orders.length > 6 || this.model.printCount < 0 || this.model.printCount >= orders.length)
         {
            return false;
         }
         for(var i:int = 0; i < orders.length; i++)
         {
            if(orders[i] != int(orders[i]) || orders[i] < 1 || orders[i] > this.arrHandItem.length)
            {
               return false;
            }
         }
         return true;
      }

      private function updateAssistButton() : void
      {
         if(this.assistButton)
         {
            var enabled:Boolean = this.canAssist();
            this.assistButton.mouseEnabled = enabled;
            this.assistButton.buttonMode = enabled;
            this.assistButton.alpha = enabled ? 1 : 0.45;
         }
      }

      private function onAssistClick(param1:MouseEvent) : void
      {
         param1.stopImmediatePropagation();
         if(!this.canAssist())
         {
            return;
         }
         this.assistBusy = true;
         this.updateAssistButton();
         try
         {
            var orders:Vector.<int> = this.model.ninjutsuOrder.orders;
            var remaining:int = orders.length - this.model.printCount;
            for(var i:int = 0; i < remaining; i++)
            {
               var hand:HandItem = this.arrHandItem[int(orders[this.model.printCount]) - 1] as HandItem;
               hand.dispatchEvent(new MouseEvent(MouseEvent.MOUSE_DOWN));
            }
         }
         finally
         {
            this.assistBusy = false;
            this.updateAssistButton();
         }
      }

      public function reset() : void
      {
         this.assistReady = false;
         this.assistBusy = false;
         this.updateAssistButton();
         this.mBgUI.finishOneAnim.ninjutsuAnim.stop();
         this.mBgUI.finishOneAnim.visible = false;
         this.mBgUI.finishOneAnim.stop();
         this.mBgUI.explodeAnim.visible = false;
         this.mBgUI.explodeAnim.stop();
         this.mBgUI.wrongMark.visible = false;
         this.mBgUI.wrongMark.stop();
         this.mBgUI.ninjutsuName.visible = false;
         this.mBgUI.burnRop.gotoAndStop(1);
         this.mBgUI.burnRop.visible = false;
         this.mBgUI.burnRop.fire.visible = false;
         var _loc1_:int = 0;
         while(_loc1_ < 6)
         {
            this.mBgUI["icon" + _loc1_].visible = false;
            this.mBgUI["icon" + _loc1_].hand.gotoAndStop(1);
            this.mBgUI["icon" + _loc1_].haloAnim.gotoAndStop(1);
            this.mBgUI["icon" + _loc1_].haloAnim.visible = false;
            _loc1_++;
         }
      }
      
      protected function onHandClick(param1:MouseEvent) : void
      {
         if(this.model.gameStatus != this.model.STATUS_STARTED || this.model.printCount >= this.model.ninjutsuOrder.orders.length)
         {
            return;
         }
         var _loc2_:HandItem = param1.currentTarget as HandItem;
         var _loc3_:int = this.model.ninjutsuOrder.orders[this.model.printCount];
         if(_loc2_.index + 1 == _loc3_)
         {
            ++this.model.printCount;
            if(this.model.printCount == this.model.ninjutsuOrder.orders.length)
            {
               this.finishCurrentPrint();
            }
         }
         else
         {
            this.mBgUI.wrongMark.x = this.mBgUI["icon" + this.model.printCount].x - 17;
            this.mBgUI.wrongMark.y = this.mBgUI["icon" + this.model.printCount].y - 22;
            this.playAndHide(this.mBgUI.wrongMark);
            this.model.printCount = 0;
         }
         this.updateView();
      }
      
      private function playAndHide(param1:MovieClip) : void
      {
         var view:MovieClip = param1;
         view.visible = true;
         view.addFrameScript(view.totalFrames - 1,function():void
         {
            view.stop();
            view.visible = false;
         });
         view.gotoAndPlay(1);
      }
      
      private function finishCurrentPrint() : void
      {
         this.assistReady = false;
         this.updateAssistButton();
         ++this.model.finishCount;
         this.model.totalSeconds += 6;
         this.playFinishOneAnim();
      }
      
      private function playFinishOneAnim() : void
      {
         var anim:MovieClip = null;
         this.mBgUI.finishOneAnim.visible = true;
         anim = this.mBgUI.finishOneAnim.ninjutsuAnim;
         anim.gotoAndStop(1);
         this.mBgUI.finishOneAnim.addFrameScript(12,function():void
         {
            anim.gotoAndPlay(1);
         });
         anim.addFrameScript(9,function():void
         {
            anim.hand.gotoAndStop(model.ninjutsuOrder.orders[0]);
         });
         anim.addFrameScript(19,function():void
         {
            anim.hand.gotoAndStop(model.ninjutsuOrder.orders[1]);
         });
         anim.addFrameScript(29,function():void
         {
            anim.hand.gotoAndStop(model.ninjutsuOrder.orders[2]);
         });
         anim.addFrameScript(36,function():void
         {
            if(model.ninjutsuOrder.orders.length == 3)
            {
               anim.gotoAndPlay(68);
            }
         });
         if(this.model.ninjutsuOrder.orders.length > 3)
         {
            anim.addFrameScript(39,function():void
            {
               anim.hand.gotoAndStop(model.ninjutsuOrder.orders[3]);
            });
            anim.addFrameScript(46,function():void
            {
               if(model.ninjutsuOrder.orders.length == 4)
               {
                  anim.gotoAndPlay(68);
               }
            });
         }
         if(this.model.ninjutsuOrder.orders.length > 4)
         {
            anim.addFrameScript(49,function():void
            {
               anim.hand.gotoAndStop(model.ninjutsuOrder.orders[4]);
            });
            anim.addFrameScript(56,function():void
            {
               if(model.ninjutsuOrder.orders.length == 5)
               {
                  anim.gotoAndPlay(68);
               }
            });
         }
         if(this.model.ninjutsuOrder.orders.length > 5)
         {
            anim.addFrameScript(59,function():void
            {
               anim.hand.gotoAndStop(model.ninjutsuOrder.orders[5]);
            });
         }
         anim.addFrameScript(68,function():void
         {
            anim.nameImg.gotoAndStop(model["ninjutsuIndex" + (model.finishCount - 1)] + 1);
         });
         anim.addFrameScript(anim.totalFrames - 1,function():void
         {
            if(mBgUI)
            {
               mBgUI.finishOneAnim.visible = false;
               mBgUI.finishOneAnim.stop();
            }
            anim.stop();
            anim.parent && (anim.parent as MovieClip).stop();
            if(mBgUI)
            {
               nextNinjutsu();
            }
         });
         this.mBgUI.finishOneAnim.gotoAndPlay(1);
      }
      
      public function updateView() : void
      {
         var _loc1_:int = 0;
         while(_loc1_ < this.model.ninjutsuOrder.orders.length)
         {
            this.mBgUI["icon" + _loc1_].visible = true;
            this.mBgUI["icon" + _loc1_].hand.gotoAndStop(this.model.ninjutsuOrder.orders[_loc1_]);
            if(_loc1_ < this.model.printCount)
            {
               this.turnNormal(this.mBgUI["icon" + _loc1_].hand);
               this.mBgUI["icon" + _loc1_].halo.visible = true;
               if(_loc1_ == this.model.printCount - 1)
               {
                  this.mBgUI["icon" + _loc1_].haloAnim.visible = true;
                  this.playAndHide(this.mBgUI["icon" + _loc1_].haloAnim);
               }
            }
            else
            {
               this.turnGray(this.mBgUI["icon" + _loc1_].hand);
               this.mBgUI["icon" + _loc1_].halo.visible = false;
            }
            _loc1_++;
         }
         _loc1_ = int(this.model.ninjutsuOrder.orders.length);
         while(_loc1_ < 6)
         {
            this.mBgUI["icon" + _loc1_].visible = false;
            _loc1_++;
         }
      }
      
      public function playBurnRop(param1:int) : void
      {
         this.mBgUI.burnRop.visible = true;
         this.mBgUI.burnRop.fire.visible = true;
         this.mBgUI.burnRop.addEventListener(Event.ENTER_FRAME,this.enterFrameHandler);
      }
      
      public function nextNinjutsu() : void
      {
         if(!this.mBgUI || this.model.gameStatus != this.model.STATUS_STARTED)
         {
            return;
         }
         this.assistReady = false;
         this.updateAssistButton();
         var _loc5_:ProtoNinjaTrainChooseReq = null;
         if(this.model.finishCount == 3)
         {
            this.mBgUI.burnRop.removeEventListener(Event.ENTER_FRAME,this.enterFrameHandler);
            this.model.totalSeconds = 999;
            _loc5_ = new ProtoNinjaTrainChooseReq();
            _loc5_.result = 1;
            ProtocalUtil.instance.sendMessageAndRsp(ProtocolCmdDef.CMD_ACTIVITY_NINJA_TRAIN_NEW_CHOOSE,_loc5_,ProtoNinjaTrainRsp,this.onResponse,null,true,1);
            return;
         }
         this.model.printCount = 0;
         var _loc1_:int = int(this.model["ninjutsuIndex" + this.model.finishCount]);
         this.mBgUI.ninjutsuName.visible = true;
         this.mBgUI.ninjutsuName.gotoAndStop(_loc1_ + 1);
         var _loc2_:NinjutsuOrder = new NinjutsuOrder();
         var _loc3_:ProtoAwardPackageBox = this.model.printList[_loc1_] as ProtoAwardPackageBox;
         var _loc4_:int = 0;
         while(_loc4_ < _loc3_.award.length)
         {
            _loc2_.orders.push(_loc3_.award[_loc4_].id);
            _loc4_++;
         }
         this.model.ninjutsuOrder = _loc2_;
         this.updateView();
         this.assistReady = true;
         this.updateAssistButton();
      }
      
      private function onResponse(param1:ProtoNinjaTrainRsp) : void
      {
         if(!this.mBgUI)
         {
            return;
         }
         this.model.awardStatus = param1.boxs.awardStatus;
         this.popSuccessWin();
      }
      
      private function popSuccessWin() : void
      {
         var _loc1_:NinjutsuTrainView2 = this.mBgUI.parent.parent as NinjutsuTrainView2;
         _loc1_.resetTrain();
         this.successPanel = new NinjutsuTrainSuccessPanel(_loc1_);
         this.successPanel.show();
      }
      
      private function popFailWin() : void
      {
         var _loc1_:NinjutsuTrainView2 = this.mBgUI.parent.parent as NinjutsuTrainView2;
         this.failPanel = new NinjutsuTrainFailPanel(_loc1_);
         this.failPanel.show();
      }
      
      public function turnNormal(param1:DisplayObject) : void
      {
         param1.filters = [];
      }
      
      public function turnGray(param1:DisplayObject) : void
      {
         var _loc2_:Array = null;
         if(!this.grayFilter)
         {
            _loc2_ = [];
            _loc2_.push(0.309,0.609,0.082,0,0);
            _loc2_.push(0.309,0.609,0.082,0,0);
            _loc2_.push(0.309,0.609,0.082,0,0);
            _loc2_.push(0,0,0,1,0);
            this.grayFilter = new ColorMatrixFilter(_loc2_);
         }
         param1.filters = [this.grayFilter];
      }
      
      protected function enterFrameHandler(param1:Event) : void
      {
         var _loc4_:int = 0;
         var _loc2_:Number = new Date().time;
         var _loc3_:Number = (_loc2_ - this.model.startTime) / 1000;
         if(_loc3_ >= this.model.totalSeconds)
         {
            this.mBgUI.burnRop.removeEventListener(Event.ENTER_FRAME,this.enterFrameHandler);
            this.fail();
         }
         else
         {
            _loc4_ = int(_loc3_ / this.model.totalSeconds * 150);
            this.mBgUI.burnRop.gotoAndStop(_loc4_);
         }
      }
      
      private function fail() : void
      {
         var anim:MovieClip = null;
         this.model.gameStatus = this.model.STATUS_FAIL;
         this.assistReady = false;
         this.updateAssistButton();
         anim = this.mBgUI.explodeAnim;
         anim.visible = true;
         anim.addFrameScript(anim.totalFrames - 1,function():void
         {
            if(anim)
            {
               anim.stop();
               anim.visible = false;
            }
            if(mBgUI)
            {
               if(mBgUI.burnRop)
               {
                  mBgUI.burnRop.visible = false;
                  mBgUI.burnRop.fire.visible = false;
               }
               popFailWin();
            }
         });
         this.mBgUI.explodeAnim.gotoAndPlay(1);
      }
      
      public function get model() : NinjutsuTrainModel2
      {
         return NinjutsuTrainModel2.instance;
      }
      
      public function destroy() : void
      {
         this.assistReady = false;
         this.updateAssistButton();
         if(this.assistButton)
         {
            this.assistButton.removeEventListener(MouseEvent.CLICK,this.onAssistClick);
            if(this.assistButton.parent)
            {
               this.assistButton.parent.removeChild(this.assistButton);
            }
            this.assistButton = null;
         }
         for each(var hand:HandItem in this.arrHandItem)
         {
            hand.removeEventListener(MouseEvent.MOUSE_DOWN,this.onHandClick);
         }
         this.arrHandItem = [];
         this.mBgUI.finishOneAnim.stop();
         this.mBgUI.finishOneAnim.addFrameScript(12,null);
         this.mBgUI.finishOneAnim.ninjutsuAnim.stop();
         this.mBgUI.finishOneAnim.ninjutsuAnim.addFrameScript(this.mBgUI.finishOneAnim.ninjutsuAnim.totalFrames - 1,null);
         this.mBgUI.burnRop && this.mBgUI.burnRop.removeEventListener(Event.ENTER_FRAME,this.enterFrameHandler);
         this.mBgUI.burnRop = null;
         this.mBgUI = null;
      }
   }
}

