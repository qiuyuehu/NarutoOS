package com.tencent.morefun.naruto.plugin.operatingActivity.activitys.turntable_old
{
   import assets.turntable_old.NumBmpAsset;
   import assets.turntable_old.TurntableAsset;
   import bag.data.ItemData;
   import bag.def.BagModelKeys;
   import bag.utils.BagUtils;
   import base.NarutoAPI;
   import base.ProtocalUtil;
   import cardPackage.command.OpenCardPackageCommand;
   import cardPackage.def.MallTabDef;
   import com.greensock.TweenLite;
   import com.tencent.morefun.naruto.model.event.ModelEvent;
   import com.tencent.morefun.naruto.plugin.exui.render.GiftItemWithNumRender;
   import com.tencent.morefun.naruto.plugin.operatingActivity.BaseActivityView;
   import com.tencent.morefun.naruto.plugin.ui.EasyLayoutScrollBar_3_Skin;
   import com.tencent.morefun.naruto.plugin.ui.base.BitmapText;
   import com.tencent.morefun.naruto.plugin.ui.components.layouts.EasyLayout;
   import com.tencent.morefun.naruto.plugin.ui.tips.TipsManager;
   import com.tencent.morefun.naruto.plugin.ui.util.DisplayUtils;
   import com.tencent.morefun.naruto.util.GameTip;
   import com.tencent.morefun.naruto.util.StrReplacer;
   import com.tencent.morefun.naruto.util.TimeUtils;
   import flash.display.DisplayObjectContainer;
   import flash.display.MovieClip;
   import flash.events.MouseEvent;
   import flash.external.ExternalInterface;
   import flash.geom.Point;
   import flash.text.TextField;
   import flash.text.TextFormat;
   import naruto.component.controls.ButtonNormalYellow;
   import serverProto.activity.ProtoAwardPackageBox;
   import serverProto.activity.ProtoLuckyWheelAwardRsp;
   import serverProto.activity.ProtoLuckyWheelCountAwardReq;
   import serverProto.activity.ProtoLuckyWheelLotteryReq;
   import serverProto.activity.ProtoLuckyWheelLotteryRsp;
   import serverProto.activity.ProtoLuckyWheelQueryReq;
   import serverProto.activity.ProtoLuckyWheelQueryRsp;
   import serverProto.activity.ProtoLuckyWheelRankQueryRsp;
   import serverProto.activity.ProtoLuckyWheelTask;
   import serverProto.activity.ProtoLuckyWheelTaskAwardReq;
   import serverProto.inc.EmptyMessage;
   import serverProto.inc.ProtoItemInfo;
   
   public class TurntableView extends BaseActivityView
   {
      
      public static var instance:TurntableView;
      
      private static const QUERY:uint = 1050746;
      
      private static const REWARD_1:uint = 1050747;
      
      private static const REWARD_2:uint = 1050748;
      
      private static const START:uint = 1050749;
      
      private static const RANKQUERY:uint = 1050751;
      
      private static var REWARD_COUNT_1:int = 150;
      
      private static var REWARD_COUNT_2:int = 500;
      
      private static var REWARD_COUNT_3:int = 1200;
      
      private static var REWARD_COUNT_4:int = 2200;
      
      private var _ui:MovieClip;
      
      private var _rankList:EasyLayout;
      
      private var _rsp:ProtoLuckyWheelQueryRsp;
      
      private var _curTitle:int;
      
      private var _powerTf:BitmapText;
      
      private var _iconArr:Array;
      
      private var _rewardRsp:ProtoLuckyWheelLotteryRsp;
      
      private var _rewardType:int;
      
      private var _tiemObj:Object = {};
      
      private var _isRun:Boolean;
      
      private var mRankLayout:EasyLayout;
      
      private var _rankRsp:ProtoLuckyWheelRankQueryRsp;
      
      private var _rulePanel:ruleView;
      
      public function TurntableView()
      {
         instance = this;
         super(OpenTurntableCommand);
         this.activityAssistDiagnostic("constructor.ready");
      }
      
      private function activityAssistDiagnostic(stage:String, error:Error = null) : void
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

      override protected function onAssetsLoadFinish() : void
      {
         try
         {
            this.activityAssistDiagnostic("asset-load.begin");
         this.activityAssistDiagnostic("asset.create.begin");
         this._ui = new TurntableAsset();
         this.activityAssistDiagnostic("asset.create.end");
         closeButton = this._ui.close_btn;
         this.activityAssistDiagnostic("initData.begin");
         this.initData();
         this.activityAssistDiagnostic("initData.end");
         this.activityAssistDiagnostic("initView.begin");
         this.initView();
         this.activityAssistDiagnostic("initView.end");
         if(activityParam == null)
         {
            this.activityAssistDiagnostic("showTitle.begin");
            this.showTitle(1);
            this.activityAssistDiagnostic("showTitle.end");
         }
         else
         {
            this.activityAssistDiagnostic("showTitle.begin");
            this.showTitle(int(activityParam));
            this.activityAssistDiagnostic("showTitle.end");
         }
         addChild(this._ui);
         this.activityAssistDiagnostic("ui.added");
         super.onAssetsLoadFinish();
         this.activityAssistDiagnostic("activity.ready");
      
         }
         catch(error:Error)
         {
            this.activityAssistDiagnostic("onAssetsLoadFinish.error",error);
            throw error;
         }
      }
      
      private function initData() : void
      {
         var _loc1_:int = 1;
         while(_loc1_ < 5)
         {
            TurntableView["REWARD_COUNT_" + _loc1_] = int(I18n.lang("as_operatingActivity_TurntableView0" + _loc1_));
            _loc1_++;
         }
      }
      
      override public function close() : void
      {
         if(this._rankList)
         {
            this._rankList.parent && this._rankList.parent.removeChild(this._rankList);
            this._rankList.dispose();
            this._rankList = null;
         }
         if(this.mRankLayout)
         {
            this.mRankLayout.parent && this.mRankLayout.parent.removeChild(this.mRankLayout);
            this.mRankLayout.dispose();
            this.mRankLayout = null;
         }
         if(this._powerTf)
         {
            this._powerTf.parent && this._powerTf.parent.removeChild(this._powerTf);
            this._powerTf.destroy();
            this._powerTf = null;
         }
         this.removeTreasureIcon();
         this._isRun = false;
         if(this._ui)
         {
            BagUtils.model.removeEventListener(ModelEvent.UPDATE,this.onBagModelUpdate);
            TweenLite.killTweensOf(this._tiemObj);
            TweenLite.killDelayedCallsTo(this.getRewardHandler);
            TipsManager.singleton.unbinding(this._ui.getReward_mc.luck_mc);
            TipsManager.singleton.unbinding(this._ui.treasure_mc.luck_mc);
            TipsManager.singleton.unbinding(this._ui.treasure_mc.ratio_mc);
            this._ui.removeEventListener(MouseEvent.CLICK,this.clickHandler);
            removeChild(this._ui);
            this._ui = null;
         }
         super.close();
      }
      
      private function localizeStaticText(container:DisplayObjectContainer) : void
      {
         var labels:Object = {"Obter chaves": "获取钥匙", "Girar a roleta": "转动转盘", "Regras": "活动规则", "Ranking": "排行榜", "Chaves de atividade (até 20 por dia)": "活动钥匙（每天最多20把）", "Comprar": "购买", "Retirar tudo": "全部领取", "Retirar": "领取", "Retirado": "已领取", "Girar 1 vez": "转动1次", "Girar 10 vezes": "转动10次", "Abrir 1 vez": "开启1次", "Abrir 10 vezes": "开启10次", "1) Pode-se obter até 20 chaves gratuitas por dia através de atividade no jogo durante o evento, as demais podem ser compradas na loja. 2) Cada chave permite girar a roleta 1 vez e obter o prêmio, ao se girar a roleta determinado número de vezes há prêmios extras. 3) Após o fim do evento as chaves desaparecem e os prêmios de número de giradas são enviados pela caixa de mensagens.": "1）活动期间，每天通过游戏内任务最多可获得20把免费钥匙，也可在商店购买。\n2）每把钥匙可转动转盘1次并获得奖励，累计转动达到指定次数还可领取额外奖励。\n3）活动结束后钥匙将消失，累计转动次数的奖励会通过邮件发放。"};
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

      private function initView() : void
      {
         var _loc1_:TextField = null;
         var _loc2_:MovieClip = null;
         var _loc4_:TextField = null;
         this.activityAssistDiagnostic("font.begin");
         this._ui.timeTxt.embedFonts = false;
         var timeFormat:TextFormat = this._ui.timeTxt.getTextFormat();
         timeFormat.font = "_sans";
         this._ui.timeTxt.defaultTextFormat = timeFormat;
         this.activityAssistDiagnostic("font.end");
         this.activityAssistDiagnostic("button-labels.begin");
         this._ui.getReward_mc.getRewardAll_btn.label = "全部领取";
         this._ui.treasure_mc.getTreasureAll_btn.label = "全部领取";
         this._ui.getReward_mc.luck_mc.buy_btn.label = "购买";
         this._ui.treasure_mc.luck_mc.buy_btn.label = "购买";
         this.activityAssistDiagnostic("button-labels.end");
         this._ui.tab4.visible = false;
         this._ui.tab1.mouseChildren = this._ui.tab2.mouseChildren = this._ui.tab3.mouseChildren = this._ui.tab4.mouseChildren = false;
         this.activityAssistDiagnostic("tabs.children.end");
         this._ui.tab1.buttonMode = this._ui.tab2.buttonMode = this._ui.tab3.buttonMode = this._ui.tab4.buttonMode = true;
         this.activityAssistDiagnostic("tabs.mode.end");
         this._ui.addEventListener(MouseEvent.CLICK,this.clickHandler);
         this.activityAssistDiagnostic("click-listener.end");
         this._ui.getReward_mc.luck_mc.num_tf.defaultTextFormat = new TextFormat(null,null,null,true);
         this._ui.treasure_mc.luck_mc.num_tf.defaultTextFormat = new TextFormat(null,null,null,true);
         this.activityAssistDiagnostic("number-format.end");
         this.activityAssistDiagnostic("bitmap-text.begin");
         this._powerTf = new BitmapText(new NumBmpAsset(),40,43,-3,true,"1234567890 ");
         this.activityAssistDiagnostic("bitmap-text.end");
         this._powerTf.x = 575;
         this._powerTf.y = 21;
         this._ui.treasure_mc.addChild(this._powerTf);
         this.activityAssistDiagnostic("bitmap-text.added");
         this._ui.getReward_mc.luck_mc.num_tf.mouseEnabled = false;
         TipsManager.singleton.binding(this._ui.getReward_mc.luck_mc,"幸运钥匙可用于转动转盘，可通过活动获得或在商店购买。");
         this._ui.treasure_mc.luck_mc.num_tf.mouseEnabled = false;
         TipsManager.singleton.binding(this._ui.treasure_mc.luck_mc,"幸运钥匙可用于转动转盘，可通过活动获得或在商店购买。");
         this.activityAssistDiagnostic("tooltips.end");
         this._curTitle = 0;
         this.activityAssistDiagnostic("task-layout.begin");
         this._rankList = new EasyLayout(TurntableItemRender,5,1);
         this.activityAssistDiagnostic("task-layout.end");
         this._rankList.scroller.x -= 25;
         DisplayUtils.replaceDisplay(this._ui.getReward_mc.rankListRect,this._rankList);
         this.activityAssistDiagnostic("rank-layout.begin");
         this.mRankLayout = new EasyLayout(TurntableRankItem,9,1,-8,-8,true,new EasyLayoutScrollBar_3_Skin());
         this.activityAssistDiagnostic("rank-layout.end");
         this._ui.rank_mc.addChild(this.mRankLayout);
         this.mRankLayout.x = 202;
         this.mRankLayout.y = 54;
         var _loc3_:int = 1;
         while(_loc3_ <= 8)
         {
            _loc2_ = this._ui.treasure_mc["item" + _loc3_];
            _loc2_.light_mc.visible = false;
            _loc2_.light_mc.mouseEnabled = _loc2_.light_mc.mouseChildren = false;
            _loc3_++;
         }
         _loc3_ = 1;
         while(_loc3_ < 5)
         {
            _loc4_ = this._ui.treasure_mc["reward" + _loc3_].countTxt;
            _loc4_.htmlText = StrReplacer.replace("累计转动%1次奖励",[TurntableView["REWARD_COUNT_" + _loc3_]]);
            _loc3_++;
         }
         this.activityAssistDiagnostic("treasure-loops.end");
         BagUtils.model.addEventListener(ModelEvent.UPDATE,this.onBagModelUpdate);
         this.activityAssistDiagnostic("bag-listener.end");
         this.activityAssistDiagnostic("recursive-translate.begin");
         this.localizeStaticText(this._ui);
         this.activityAssistDiagnostic("recursive-translate.end");
      }
      
      private function showRewardContent() : void
      {
         var _loc1_:Boolean = false;
         var _loc2_:ProtoLuckyWheelTask = null;
         this._ui.getReward_mc.luck_mc.num_tf.text = String(BagUtils.model.getTotalItemNumById(this._rsp.keyItemId));
         this._rankList.dataProvider = this._rsp.taskInfo.task;
         for each(_loc2_ in this._rsp.taskInfo.task)
         {
            if(_loc2_.taskStatus == 1)
            {
               _loc1_ = true;
               break;
            }
         }
         this._ui.getReward_mc.getRewardAll_btn.enabled = _loc1_;
      }
      
      private function showTreasureContent() : void
      {
         var _loc1_:Boolean = false;
         this._ui.treasure_mc.luck_mc.num_tf.text = String(BagUtils.model.getTotalItemNumById(this._rsp.keyItemId));
         this._powerTf.text = String(this._rsp.lotteryInfo.openCount);
         var _loc2_:int = 0;
         while(_loc2_ < 4)
         {
            this.setTreasureBtn(this._rsp.lotteryInfo.countAward[_loc2_],_loc2_ + 1);
            if(this._rsp.lotteryInfo.countAward[_loc2_].awardStatus == 1)
            {
               _loc1_ = true;
            }
            _loc2_++;
         }
         this._ui.treasure_mc.getTreasureAll_btn.enabled = _loc1_;
         this.calcuRatioHeight();
         TipsManager.singleton.binding(this._ui.treasure_mc.ratio_mc,this._rsp.lotteryInfo.openCount + "/" + REWARD_COUNT_4);
         this.removeTreasureIcon();
         _loc2_ = 0;
         while(_loc2_ < 8)
         {
            this.setTreasureIcon(this._ui.treasure_mc["item" + (_loc2_ + 1)],this._rsp.lotteryInfo.lotteryAward[_loc2_]);
            _loc2_++;
         }
      }
      
      private function calcuRatioHeight() : void
      {
         if(this._rsp.lotteryInfo.openCount <= REWARD_COUNT_1)
         {
            this._ui.treasure_mc.ratio_mc.bg_mc.height = 70 * this._rsp.lotteryInfo.openCount / REWARD_COUNT_1;
         }
         else if(this._rsp.lotteryInfo.openCount <= REWARD_COUNT_2)
         {
            this._ui.treasure_mc.ratio_mc.bg_mc.height = 70 + 70 * (this._rsp.lotteryInfo.openCount - REWARD_COUNT_1) / (REWARD_COUNT_2 - REWARD_COUNT_1);
         }
         else if(this._rsp.lotteryInfo.openCount <= REWARD_COUNT_3)
         {
            this._ui.treasure_mc.ratio_mc.bg_mc.height = 140 + 70 * (this._rsp.lotteryInfo.openCount - REWARD_COUNT_2) / (REWARD_COUNT_3 - REWARD_COUNT_2);
         }
         else if(this._rsp.lotteryInfo.openCount <= REWARD_COUNT_4)
         {
            this._ui.treasure_mc.ratio_mc.bg_mc.height = 210 + 70 * (this._rsp.lotteryInfo.openCount - REWARD_COUNT_3) / (REWARD_COUNT_4 - REWARD_COUNT_3);
         }
      }
      
      private function removeTreasureIcon() : void
      {
         var _loc1_:GiftItemWithNumRender = null;
         for each(_loc1_ in this._iconArr)
         {
            _loc1_.parent && _loc1_.parent.removeChild(_loc1_);
            _loc1_.dispose();
            _loc1_ = null;
         }
         this._iconArr = [];
      }
      
      private function setTreasureIcon(param1:MovieClip, param2:ProtoItemInfo) : void
      {
         param1.light_mc.visible = false;
         var _loc3_:GiftItemWithNumRender = new GiftItemWithNumRender();
         var _loc4_:ItemData = BagUtils.createItemData(param2.id,param2.num);
         _loc3_.data = _loc4_;
         _loc3_.x = _loc3_.y = -2;
         param1.mc.gotoAndStop(1);
         param1.mc.mc.addChild(_loc3_);
         this._iconArr.push(_loc3_);
      }
      
      private function setTreasureBtn(param1:ProtoAwardPackageBox, param2:int) : void
      {
         TipsManager.singleton.binding(this._ui.treasure_mc["reward" + param2],this.getAwardStr(param1.award));
         var _loc3_:ButtonNormalYellow = this._ui.treasure_mc["getBtn" + param2];
         _loc3_.enabled = param1.awardStatus == 1;
         _loc3_.label = param1.awardStatus == 2 ? "已领取" : "领取";
         TipsManager.singleton.unbinding(_loc3_);
         param1.awardStatus == 0 && TipsManager.singleton.binding(_loc3_,"尚未满足领取条件");
      }
      
      private function getAwardStr(param1:Array) : String
      {
         var _loc3_:ProtoItemInfo = null;
         var _loc2_:String = "";
         for each(_loc3_ in param1)
         {
            _loc2_ = _loc2_ + "、";
            _loc2_.length && (_loc2_);
            _loc2_ += NarutoAPI.getItemDataStr(_loc3_);
         }
         return _loc2_;
      }
      
      private function showTitle(param1:int = 1, param2:Boolean = false) : void
      {
         var _loc3_:ProtoLuckyWheelQueryReq = null;
         if(!param2 && this._curTitle == param1)
         {
            return;
         }
         this._curTitle = param1;
         this._ui.tab1.gotoAndStop(param1 == 1 ? 2 : 1);
         this._ui.tab2.gotoAndStop(param1 == 2 ? 2 : 1);
         this._ui.tab3.gotoAndStop(param1 == 3 ? 2 : 1);
         this._ui.tab4.gotoAndStop(param1 == 4 ? 2 : 1);
         this._ui.getReward_mc.visible = param1 == 1;
         this._ui.treasure_mc.visible = param1 == 2;
         this._ui.help_mc.visible = param1 == 3;
         this._ui.rank_mc.visible = param1 == 4;
         if(param1 == 1 || param1 == 2)
         {
            _loc3_ = new ProtoLuckyWheelQueryReq();
            _loc3_.type = param1 == 1 ? 0 : 1;
            ProtocalUtil.instance.sendMessageAndRsp(QUERY,_loc3_,ProtoLuckyWheelQueryRsp,this.queryRsp);
         }
         else if(param1 == 4)
         {
            ProtocalUtil.instance.sendMessageAndRsp(RANKQUERY,new EmptyMessage(),ProtoLuckyWheelRankQueryRsp,this.queryRankRsp);
         }
         this.localizeStaticText(this._ui);
      }
      
      private function queryRankRsp(param1:ProtoLuckyWheelRankQueryRsp) : void
      {
         var _loc5_:turntableRankData = null;
         var _loc2_:String = "";
         if(param1.myRank > 0 && param1.myRank < param1.rankList.length)
         {
            _loc2_ = param1.myRank.toString();
         }
         else
         {
            _loc2_ = "未上榜";
         }
         this._ui.rank_mc.myRank.htmlText = "<b>" + StrReplacer.replace("<b>我的排名：%1</b>",_loc2_) + "</b>";
         this._ui.rank_mc.myPoints.htmlText = "<b>" + StrReplacer.replace("<b>我的积分：%1</b>",param1.myPoints) + "</b>";
         var _loc3_:Array = new Array();
         var _loc4_:int = 0;
         while(_loc4_ < param1.rankList.length)
         {
            _loc5_ = new turntableRankData();
            _loc5_.rank = _loc4_;
            _loc5_.rankInfo = param1.rankList[_loc4_];
            _loc3_.push(_loc5_);
            _loc4_++;
         }
         this.mRankLayout.dataProvider = _loc3_;
      }
      
      private function queryRsp(param1:ProtoLuckyWheelQueryRsp) : void
      {
         this._rsp = param1;
         this._ui.timeTxt.htmlText = StrReplacer.replace("结束时间：%1",TimeUtils.getFullTimeStrUnion(this._rsp.endTime));
         if(this._curTitle == 1)
         {
            this.showRewardContent();
         }
         else if(this._curTitle == 2)
         {
            this.showTreasureContent();
         }
      }
      
      public function rewardReq(param1:int) : void
      {
         var _loc2_:ProtoLuckyWheelTaskAwardReq = new ProtoLuckyWheelTaskAwardReq();
         _loc2_.idx = param1;
         ProtocalUtil.instance.sendMessageAndRsp(REWARD_1,_loc2_,ProtoLuckyWheelAwardRsp,this.rewardRsp);
      }
      
      private function rewardRsp(param1:ProtoLuckyWheelAwardRsp) : void
      {
         NarutoAPI.showAward(param1.award,this._ui.treasure_mc.openOne_btn.localToGlobal(new Point(0,0)));
         this.showTitle(1,true);
      }
      
      private function treasureReq(param1:int) : void
      {
         if(param1 != 0)
         {
            param1 = int(this._rsp.lotteryInfo.countAward[param1 - 1].boxId);
         }
         var _loc2_:ProtoLuckyWheelCountAwardReq = new ProtoLuckyWheelCountAwardReq();
         _loc2_.boxId = param1;
         ProtocalUtil.instance.sendMessageAndRsp(REWARD_2,_loc2_,ProtoLuckyWheelAwardRsp,this.treasureRsp);
      }
      
      private function treasureRsp(param1:ProtoLuckyWheelAwardRsp) : void
      {
         NarutoAPI.showAward(param1.award,this._ui.treasure_mc.openOne_btn.localToGlobal(new Point(0,0)));
         this.showTitle(2,true);
      }
      
      private function startGameReq(param1:int) : void
      {
         var _loc2_:int = int(this._ui.treasure_mc.luck_mc.num_tf.text);
         if(_loc2_ < (param1 == 1 ? 1 : 10))
         {
            GameTip.show("钥匙不足！");
            return;
         }
         var _loc3_:ProtoLuckyWheelLotteryReq = new ProtoLuckyWheelLotteryReq();
         _loc3_.type = 0;
         _loc3_.count = this._rewardType = param1;
         ProtocalUtil.instance.sendMessageAndRsp(START,_loc3_,ProtoLuckyWheelLotteryRsp,this.startGameRsp);
      }
      
      private function startGameRsp(param1:ProtoLuckyWheelLotteryRsp) : void
      {
         this._isRun = true;
         this._rewardRsp = param1;
         var _loc2_:int = this._rewardType == 1 ? int(4 * 8 + param1.idxList[0]) : int(3 * 8 + param1.idxList[0]);
         var _loc3_:Number = this._rewardType == 1 ? 1.5 : 2;
         this._tiemObj.x = 0;
         TweenLite.to(this._tiemObj,_loc3_,{
            "x":_loc2_,
            "onUpdate":this.updateHandler,
            "onComplete":this.completeHandler
         });
      }
      
      private function updateHandler() : void
      {
         var _loc1_:int = int(this._tiemObj.x) % 8;
         this.setRewardLight(_loc1_);
      }
      
      private function completeHandler() : void
      {
         if(!this._ui)
         {
            return;
         }
         this._isRun = false;
         var _loc1_:int = this._rewardRsp.idxList[0] + 1;
         var _loc2_:MovieClip = this._ui.treasure_mc["item" + _loc1_];
         _loc2_.mc.gotoAndPlay(2);
         TweenLite.delayedCall(0.5,this.getRewardHandler);
      }
      
      private function endGameReq() : void
      {
         var _loc1_:ProtoLuckyWheelLotteryReq = new ProtoLuckyWheelLotteryReq();
         _loc1_.type = 1;
         _loc1_.count = this._rewardType;
         ProtocalUtil.instance.sendMessageAndRsp(START,_loc1_,ProtoLuckyWheelLotteryRsp,this.endGameRsp);
      }
      
      private function endGameRsp(param1:ProtoLuckyWheelLotteryRsp) : void
      {
         this._rewardRsp = param1;
         var _loc2_:int = this._rewardRsp.idxList[0] + 1;
         var _loc3_:MovieClip = this._ui.treasure_mc["item" + _loc2_];
         _loc3_.mc.gotoAndPlay(2);
         TweenLite.delayedCall(0.5,this.getRewardHandler);
      }
      
      private function getRewardHandler() : void
      {
         var _loc4_:int = 0;
         var _loc1_:Array = this._rsp.lotteryInfo.lotteryAward;
         var _loc2_:int = this._rewardRsp.idxList[0] + 1;
         var _loc3_:MovieClip = this._ui.treasure_mc["item" + _loc2_];
         if(this._rewardType == 0)
         {
            NarutoAPI.showAward([_loc1_[this._rewardRsp.idxList[0]]],_loc3_.localToGlobal(new Point(50,50)));
         }
         else
         {
            _loc4_ = 0;
            while(_loc4_ < this._rewardRsp.idxList.length)
            {
               TweenLite.delayedCall(0.15 * _loc4_,this.getRewardDelayTip,[_loc1_[this._rewardRsp.idxList[_loc4_]],_loc3_]);
               _loc4_++;
            }
         }
         this.showTitle(2,true);
         this._isRun = false;
      }
      
      private function getRewardDelayTip(param1:ProtoItemInfo, param2:MovieClip) : void
      {
         NarutoAPI.showAward([param1],param2.localToGlobal(new Point(50,50)));
      }
      
      private function setRewardLight(param1:int) : void
      {
         var _loc2_:MovieClip = null;
         var _loc3_:int = 1;
         while(_loc3_ <= 8)
         {
            _loc2_ = this._ui.treasure_mc["item" + _loc3_];
            _loc2_.light_mc.visible = _loc3_ == param1 + 1;
            _loc3_++;
         }
      }
      
      private function onBagModelUpdate(param1:ModelEvent) : void
      {
         if(param1.key == BagModelKeys.ITEMS_UPDATE)
         {
            this._ui.getReward_mc.luck_mc.num_tf.text = String(BagUtils.model.getTotalItemNumById(this._rsp.keyItemId));
            this._ui.treasure_mc.luck_mc.num_tf.text = String(BagUtils.model.getTotalItemNumById(this._rsp.keyItemId));
         }
      }
      
      private function clickHandler(param1:MouseEvent) : void
      {
         if(this._isRun)
         {
            GameTip.show("转盘转动期间，请等待本次操作结束。");
            return;
         }
         switch(param1.target.name)
         {
            case "tab1":
               this.showTitle(1);
               break;
            case "tab2":
               this.showTitle(2);
               break;
            case "tab3":
               this.showTitle(3);
               break;
            case "tab4":
               this.showTitle(4);
               break;
            case "getRewardAll_btn":
               this.rewardReq(0);
               break;
            case "getBtn1":
               this.treasureReq(1);
               break;
            case "getBtn2":
               this.treasureReq(2);
               break;
            case "getBtn3":
               this.treasureReq(3);
               break;
            case "getBtn4":
               this.treasureReq(4);
               break;
            case "getTreasureAll_btn":
               this.treasureReq(0);
               break;
            case "openOne_btn":
               this.startGameReq(1);
               break;
            case "openTen_btn":
               this.startGameReq(10);
               break;
            case "buy_btn":
               new OpenCardPackageCommand(MallTabDef.LIMIT_SHOP).call();
               break;
            case "rule":
               if(this._rulePanel == null)
               {
                  this._rulePanel = new ruleView();
               }
               this._rulePanel.show();
         }
      }
   }
}

