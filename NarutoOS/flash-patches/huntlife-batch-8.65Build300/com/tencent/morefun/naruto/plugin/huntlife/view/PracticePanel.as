package com.tencent.morefun.naruto.plugin.huntlife.view
{
   import activity.bringinMoney.BringinMoneyOpenViewCmd;
   import base.ApplicationData;
   import com.tencent.morefun.framework.apf.core.facade.Facade;
   import com.tencent.morefun.naruto.base.interfaces.ISocketServer;
   import com.tencent.morefun.naruto.plugin.huntlife.enum.ChakraQuality;
   import com.tencent.morefun.naruto.plugin.huntlife.enum.ChakraType;
   import com.tencent.morefun.naruto.plugin.huntlife.enum.HuntLifeProtocolCmd;
   import com.tencent.morefun.naruto.plugin.huntlife.enum.NpcState;
   import com.tencent.morefun.naruto.plugin.huntlife.enum.PackageType;
   import com.tencent.morefun.naruto.plugin.huntlife.events.HuntLifeModelEvent;
   import com.tencent.morefun.naruto.plugin.huntlife.model.HuntLifeModel;
   import com.tencent.morefun.naruto.plugin.huntlife.utils.HuntLifeUtil;
   import com.tencent.morefun.naruto.plugin.huntlife.view.components.NpcPractice;
   import com.tencent.morefun.naruto.plugin.huntlife.view.components.PracticeBlankItem;
   import com.tencent.morefun.naruto.plugin.ui.tips.TipsManager;
   import com.tencent.morefun.naruto.util.GameTip;
   import com.tencent.morefun.naruto.util.StrReplacer;
   import def.BoxFlagDef;
   import def.PluginDef;
   import flash.display.DisplayObject;
   import flash.display.DisplayObjectContainer;
   import flash.display.InteractiveObject;
   import flash.display.Sprite;
   import flash.events.Event;
   import flash.events.MouseEvent;
   import flash.geom.Point;
   import flash.text.TextField;
   import flash.utils.Dictionary;
   import flash.utils.clearInterval;
   import flash.utils.setInterval;
   import huntlife.PracticePanelAsset;
   import huntlife.command.OpenHuntLifeMainPanelCommand;
   import server.SocketProtocol;
   import serverProto.huntlife.ProtoCallNpcReq;
   import serverProto.huntlife.ProtoCallNpcRsp;
   import serverProto.huntlife.ProtoChakraBlankInfo;
   import serverProto.huntlife.ProtoHuntLifePracticeInfo;
   import serverProto.huntlife.ProtoNpcInfo;
   import serverProto.huntlife.ProtoPickUpChakraReq;
   import serverProto.huntlife.ProtoPickUpChakraRsp;
   import serverProto.huntlife.ProtoPracticeReq;
   import serverProto.huntlife.ProtoPracticeRsp;
   import serverProto.huntlife.ProtoSellChakraReq;
   import flash.events.TimerEvent;
   import flash.display.GradientType;
   import flash.display.Graphics;
   import flash.filters.GlowFilter;
   import flash.geom.Matrix;
   import naruto.component.controls.ButtonNormalBlue;
   import flash.external.ExternalInterface;
   import flash.text.TextFormat;
   import flash.utils.Timer;
   import flash.utils.getTimer;
   import serverProto.huntlife.ProtoSellChakraRsp;
   import ui.command.ShowTextBoxCommand;
   import user.def.UserInfoKeyDef;
   import user.event.UserInfoEvent;
   import vip.command.OpenVIPWindowCommand;
   
   public class PracticePanel extends Sprite implements IContent
   {
      
      public static const NUM_PRACTICE_CHAKRA_ONE_LINE:int = 10;
      
      public static const AUTO_PRACTICE_INTERVAL:int = 100;
      
      private var ui:PracticePanelAsset;
      
      private var model:HuntLifeModel;
      
      private var gameServer:ISocketServer;
      
      private var blankItemHash:Dictionary;
      
      private var exchangePanel:ExchangePanel;
      
      private var isShow:Boolean;
      
      private var npcHash:Dictionary;
      
      private var container:BigContainer;
      
      private var practiceSending:Boolean;
      
      private var selling:Boolean;
      
      private var practiceInfoList:Array = [];
      
      private var autoPracticeIntervalID:uint;
      
      private var costXML:XML;
      
         // ==== 批量修炼辅助（随应用提供的受信任脚本） ====
      // Marks requests this batch started. Selling and merging share one protocol,
      // so replies are matched by ownership and expected phase, never by "not auto".
      private static const BATCH_CLIENT:String = "narutoBatch";
      private var batchPanel:Sprite;
      private var batchProgress:TextField;
      private var batchStateText:TextField;
      private var batchStartButton:Sprite;
            // 金(橙)=5 红=6：品质达到所选档位立即停止，无限循环不受轮数约束。
      private static const BATCH_STOP_GOLD:int = 5;
      private static const BATCH_STOP_RED:int = 6;
      private var batchStopGrade:int = BATCH_STOP_GOLD;
      private var batchGradeButtons:Array = [];
      private var batchRoundsDone:int = 0;
      private var batchCallsTotal:int = 0;
      private var batchCallsThisRound:int = 0;
      private var batchRunning:Boolean = false;
      private var batchPhase:String = "idle";
      private var batchWaitSince:Number = 0;
      private var batchNoNpcSince:Number = 0;
      private var batchTimer:Timer;
      

      public function PracticePanel(param1:HuntLifeModel, param2:ISocketServer, param3:BigContainer)
      {
         var _loc9_:int = 0;
         var _loc10_:PracticeBlankItem = null;
         var _loc11_:NpcPractice = null;
         super();
         this.ui = new PracticePanelAsset();
         this.addChild(this.ui);
         var _loc4_:Array = [ChakraQuality.toQualityCondition(ChakraQuality.QUALITY_1),ChakraQuality.toQualityCondition(ChakraQuality.QUALITY_2),ChakraQuality.toQualityCondition(ChakraQuality.QUALITY_3)];
         this.ui.comboBox.rowCount = _loc4_.length;
         this.ui.comboBox.data = _loc4_;
         this.ui.comboBox.selectedIndex = 0;
         this.ui.comboBox.visible = false;
         this.container = param3;
         this.model = param1;
         this.model.addEventListener(HuntLifeModelEvent.CHANGE_ALL,this.refreshData);
         this.model.addEventListener(HuntLifeModelEvent.CHANGE_NPC,this.refreshNpcData);
         this.model.addEventListener(HuntLifeModelEvent.CHANGE_CHAKRA,this.refreshChakraData);
         this.model.addEventListener(HuntLifeModelEvent.CHANGE_VIP_4_FREE_COUNT,this.refreshVip4FreeCount);
         this.gameServer = param2;
         this.gameServer.addProtocolListener(HuntLifeProtocolCmd.PRACTICE,this.onPracticeRsp);
         this.gameServer.addProtocolListener(HuntLifeProtocolCmd.CALL_NPC,this.onCallNPCRsp);
         this.gameServer.addProtocolListener(HuntLifeProtocolCmd.SELL_CHAKRA,this.onSellOrMergeRsp);
         this.gameServer.addProtocolListener(HuntLifeProtocolCmd.PICKUP,this.onPickupRsp);
         this.ui.practice_btn_auto.addEventListener(MouseEvent.CLICK,this.onPractice);
         this.ui.callNPC_btn.addEventListener(MouseEvent.CLICK,this.onCallNPC);
         this.ui.quick_sell_btn.addEventListener(MouseEvent.CLICK,this.onSell);
         this.ui.quick_pickup_btn.addEventListener(MouseEvent.CLICK,this.onPickup);
         this.ui.quick_merge_btn.addEventListener(MouseEvent.CLICK,this.onQuickMerge);
         this.ui.open_exchange_btn.addEventListener(MouseEvent.CLICK,this.onOpenExchange);
         this.ui.zhaocail_btn.addEventListener(MouseEvent.CLICK,this.onZhaoCai);
         TipsManager.singleton.binding(this.ui.score_txt,I18n.lang("as_huntLife_278aa849dea72df82631648c160a8658"));
         TipsManager.singleton.binding(this.ui.score_label_txt,I18n.lang("as_huntLife_4fe744536e9893f90a08291b4481541f"));
         TipsManager.singleton.binding(this.ui.quick_sell_btn,I18n.lang("as_huntLife_d9390e88b9c0af22442a10ac2623b956"));
         TipsManager.singleton.binding(this.ui.quick_pickup_btn,I18n.lang("as_huntLife_4acfc893b5c44df9709d362fe9b3e138"));
         TipsManager.singleton.binding(this.ui.quick_merge_btn,I18n.lang("as_huntLife_edf86144195d9748c28ffa91c36cd07a"));
         TipsManager.singleton.binding(this.ui.practice_btn_auto,I18n.lang("as_huntLife_fb6f475d76492d38413371f537431b3d"));
         this.costXML = Facade.getInstance().getPluginManager().getPluginResource(PluginDef.HUNT_LIFE)["plugin.huntlife.cost"] as XML;
         TipsManager.singleton.binding(this.ui.practice_btn_1.hitMc,StrReplacer.replace(I18n.lang("as_huntLife_fd88f2191e1bfd74fb9e0450789b438e"),[this.costXML.item[0].@cost]));
         TipsManager.singleton.binding(this.ui.practice_btn_2.hitMc,StrReplacer.replace(I18n.lang("as_huntLife_5f784a734975dff94e5b032c91023dcd"),[this.costXML.item[1].@cost]));
         TipsManager.singleton.binding(this.ui.practice_btn_3.hitMc,StrReplacer.replace(I18n.lang("as_huntLife_05eb4f5a1648b5333560266440da1a59"),[this.costXML.item[2].@cost]));
         TipsManager.singleton.binding(this.ui.practice_btn_4.hitMc,StrReplacer.replace(I18n.lang("as_huntLife_e89c201690d9acb45fbf82e92602ba19"),[this.costXML.item[3].@cost]));
         TipsManager.singleton.binding(this.ui.practice_btn_5.hitMc,StrReplacer.replace(I18n.lang("as_huntLife_666dbff962daaadc951bcb37e751e2ac"),[this.costXML.item[4].@cost]));
         this.blankItemHash = new Dictionary();
         var _loc5_:int = 20;
         var _loc6_:int = 0;
         while(_loc6_ < _loc5_)
         {
            _loc9_ = _loc6_ + 1;
            _loc10_ = new PracticeBlankItem(this.model,this.gameServer);
            _loc10_.x = (_loc10_.width + 38) * (_loc6_ % NUM_PRACTICE_CHAKRA_ONE_LINE) + 108;
            _loc10_.y = (_loc10_.height + 32 + 18) * int(_loc6_ / NUM_PRACTICE_CHAKRA_ONE_LINE) + 320;
            _loc10_.name = "item_" + _loc9_;
            this.addChild(_loc10_);
            this.blankItemHash[_loc9_] = _loc10_;
            _loc6_++;
         }
         this.npcHash = new Dictionary();
         var _loc7_:int = 5;
         var _loc8_:int = 1;
         while(_loc8_ <= _loc7_)
         {
            _loc11_ = new NpcPractice(this.ui["practice_btn_" + _loc8_]);
            _loc11_.addEventListener(MouseEvent.CLICK,this.onPractice);
            _loc11_.setEnable(false);
            this.npcHash[_loc8_] = _loc11_;
            _loc8_++;
         }
         TipsManager.singleton.binding(this.ui.money_icon,I18n.lang("as_huntLife_4933939a71fb9edb9748f83bc451d29a"));
         TipsManager.singleton.binding(this.ui.money_txt,I18n.lang("as_huntLife_f43e07fc42fc186165542db9ee82b18f"));
         TipsManager.singleton.binding(this.ui.dianquan_icon,I18n.lang("as_huntLife_3962373a30bf3786ca8c4a57427a952c"));
         TipsManager.singleton.binding(this.ui.dianquan_txt,I18n.lang("as_huntLife_e70a624e2084f18549339071ab30b341"));
         TipsManager.singleton.binding(this.ui.yuanbao_icon,I18n.lang("as_huntLife_d888bce1b85fc8746ef85cfe16d4b7e2"));
         TipsManager.singleton.binding(this.ui.yuanbao_txt,I18n.lang("as_huntLife_69fb3527f23db3820e77a7d0e7cf1e8c"));
         this.ui.money_txt.htmlText = "<b>" + ApplicationData.singleton.selfInfo.money + "</b>";
         this.ui.dianquan_txt.htmlText = "<b>" + ApplicationData.singleton.selfInfo.dianquan + "</b>";
         this.ui.yuanbao_txt.htmlText = "<b>" + ApplicationData.singleton.selfInfo.yuanbao + "</b>";
         ApplicationData.singleton.selfInfo.addEventListener(UserInfoEvent.BASE_CHANGED,this.onMoneyChange);
         this.createBatchControl();
         this.addEventListener(Event.ADDED_TO_STAGE,this.onBatchAdded);
         this.addEventListener(Event.REMOVED_FROM_STAGE,this.onBatchRemoved);
      }
      
      protected function onZhaoCai(param1:MouseEvent) : void
      {
         new BringinMoneyOpenViewCmd().call();
      }
      
      override public function get width() : Number
      {
         return 1125;
      }
      
      override public function get height() : Number
      {
         return 545;
      }
      
      override public function set height(param1:Number) : void
      {
         super.height = param1;
      }
      
      override public function set width(param1:Number) : void
      {
         super.width = param1;
      }
      
      private function onMoneyChange(param1:UserInfoEvent) : void
      {
         if(param1.changedValueKey == UserInfoKeyDef.MONEY)
         {
            this.ui.money_txt.htmlText = "<b>" + ApplicationData.singleton.selfInfo.money + "</b>";
         }
         else if(param1.changedValueKey == UserInfoKeyDef.DIANJUAN)
         {
            this.ui.dianquan_txt.htmlText = "<b>" + ApplicationData.singleton.selfInfo.dianquan + "</b>";
         }
         else if(param1.changedValueKey == UserInfoKeyDef.YUANBAO)
         {
            this.ui.yuanbao_txt.htmlText = "<b>" + ApplicationData.singleton.selfInfo.yuanbao + "</b>";
         }
      }
      
      public function showAt(param1:DisplayObjectContainer) : void
      {
         if(!this.parent)
         {
            this.refreshData();
         }
         param1.addChild(this);
         this.isShow = true;
      }
      
      public function removeFromParent() : void
      {
         var _loc1_:PracticeBlankItem = null;
         var _loc2_:NpcPractice = null;
         this.isShow = false;
         if(this.parent)
         {
            this.parent.removeChild(this);
         }
         this.playPracticeComplete();
         for each(_loc1_ in this.blankItemHash)
         {
            _loc1_.reset();
         }
         for each(_loc2_ in this.npcHash)
         {
            _loc2_.setEnable(false);
         }
      }
      
      private function getCurrentQualityCondition() : int
      {
         return this.ui.comboBox.selectedIndex + 1;
      }
      
      private function refreshChakraData(param1:HuntLifeModelEvent) : void
      {
         var _loc2_:ProtoChakraBlankInfo = null;
         if(param1.packageType == PackageType.PRACTICE_PACKAGE)
         {
            _loc2_ = this.model.chakraInPracticePackageHash[param1.index];
            this.refreshBlank(_loc2_);
         }
      }
      
      private function refreshVip4FreeCount(param1:HuntLifeModelEvent = null) : void
      {
         TipsManager.singleton.binding(this.ui.callNPC_btn,StrReplacer.replace(I18n.lang("as_huntLife_cf804c7b9bb77da2991f8eb4fc860433"),[this.model.callNpcCost]));
      }
      
      private function refreshNpcData(param1:Event = null) : void
      {
         var _loc2_:ProtoNpcInfo = null;
         var _loc3_:Boolean = false;
         var _loc4_:NpcPractice = null;
         for each(_loc2_ in this.model.npcHash)
         {
            _loc3_ = _loc2_.state == NpcState.ENABLE;
            _loc4_ = this.npcHash[_loc2_.npcId];
            _loc4_.setEnable(_loc3_);
         }
      }
      
      private function refreshScore() : void
      {
         this.ui.score_txt.htmlText = "<b>" + this.model.score + "</b>";
         this.ui.score_txt.width = this.ui.score_txt.textWidth + 4;
         this.ui.open_exchange_btn.x = this.ui.score_txt.x + this.ui.score_txt.width + 10;
      }
      
      private function refreshData(param1:Event = null) : void
      {
         var _loc2_:* = undefined;
         var _loc3_:ProtoChakraBlankInfo = null;
         this.refreshScore();
         for(_loc2_ in this.model.chakraInPracticePackageHash)
         {
            _loc3_ = this.model.chakraInPracticePackageHash[_loc2_];
            this.refreshBlank(_loc3_);
         }
         this.refreshNpcData();
         this.refreshVip4FreeCount();
         this.refreshCallNpcTimeText();
      }
      
      private function refreshCallNpcTimeText() : void
      {
         this.ui.call_npc_time_txt.htmlText = StrReplacer.replace(I18n.lang("as_huntLife_a0ba2d6190770cdc4d779d3fa4beba1d"),[this.model.freeCount,this.model.callNpcTotalTimes]);
         if(this.model.freeCount > 0)
         {
            this.ui.callNPC_btn.enabled = true;
         }
         else
         {
            this.ui.callNPC_btn.enabled = false;
         }
      }
      
      private function refreshBlank(param1:ProtoChakraBlankInfo) : void
      {
         var _loc2_:PracticeBlankItem = this.blankItemHash[param1.index];
         if(_loc2_)
         {
            try
            {
               _loc2_.sellButton.removeEventListener(MouseEvent.CLICK,this.onSell);
               _loc2_.pickupButton.removeEventListener(MouseEvent.CLICK,this.onPickup);
            }
            catch(e:Error)
            {
            }
            _loc2_.setData(param1,this.isShow);
            if(_loc2_.hasItemInfo)
            {
               _loc2_.sellButton.addEventListener(MouseEvent.CLICK,this.onSell);
               _loc2_.pickupButton.addEventListener(MouseEvent.CLICK,this.onPickup);
            }
         }
      }
      
      private function checkPracticeing() : Boolean
      {
         if(this.practiceInfoList.length)
         {
            GameTip.show(I18n.lang("as_huntLife_552d0eebe56d5e3d2ff257030ec58b7e"));
            return true;
         }
         if(this.practiceSending)
         {
            return true;
         }
         return false;
      }
      
      private function onPractice(param1:MouseEvent) : void
      {
         var _loc6_:int = 0;
         if(this.checkPracticeing())
         {
            return;
         }
         this.practiceSending = true;
         var _loc2_:DisplayObject = param1.currentTarget is NpcPractice ? (param1.currentTarget as NpcPractice).ui : param1.currentTarget as DisplayObject;
         var _loc3_:ProtoPracticeReq = new ProtoPracticeReq();
         var _loc4_:ProtoPracticeRsp = new ProtoPracticeRsp();
         var _loc5_:String = _loc2_.name.split("_").pop();
         if(_loc5_ != "auto")
         {
            _loc6_ = int(_loc5_);
            _loc3_.npcId = _loc6_;
         }
         this.gameServer.sendMessage(HuntLifeProtocolCmd.PRACTICE,_loc3_,_loc4_,_loc5_);
      }
      
      private function onCallNPC(param1:MouseEvent) : void
      {
         if(this.checkPracticeing() || !this.ui.callNPC_btn.enabled)
         {
            return;
         }
         new ShowTextBoxCommand(StrReplacer.replace(I18n.lang("as_huntLife_94fffb48858e4cc46c4bae8468deb4a7"),[this.model.callNpcCost]),BoxFlagDef.OK | BoxFlagDef.CANCEL,true,null,this.onConfirmCallNpc).call();
      }
      
      private function onConfirmCallNpc(param1:int) : void
      {
         var _loc2_:ProtoCallNpcReq = null;
         var _loc3_:ProtoCallNpcRsp = null;
         if(param1 == BoxFlagDef.OK)
         {
            _loc2_ = new ProtoCallNpcReq();
            _loc3_ = new ProtoCallNpcRsp();
            this.gameServer.sendMessage(HuntLifeProtocolCmd.CALL_NPC,_loc2_,_loc3_);
         }
      }
      
      private function onSell(param1:MouseEvent) : void
      {
         var cmd:String;
         var target:DisplayObject = null;
         var req:ProtoSellChakraReq = null;
         var rsp:ProtoSellChakraRsp = null;
         var index:int = 0;
         var find:Boolean = false;
         var event:MouseEvent = param1;
         if(this.checkPracticeing())
         {
            return;
         }
         target = event.currentTarget as DisplayObject;
         req = new ProtoSellChakraReq();
         rsp = new ProtoSellChakraRsp();
         cmd = target.name.split("_").shift();
         if(cmd == "quick")
         {
            if(this.model.checkEmpty(PackageType.PRACTICE_PACKAGE))
            {
               GameTip.show(I18n.lang("as_huntLife_e0dc8ec8f479193ee6931da41202acdc"));
               return;
            }
            req.grade = this.getCurrentQualityCondition();
         }
         else
         {
            index = int(target.parent.parent.name.split("_").pop());
            req.index = index;
            find = PracticeBlankItem(target.parent.parent).data.itemInfo.grade > 3;
         }
         if(find)
         {
            new ShowTextBoxCommand(I18n.lang("as_huntLife_c5d18f7863180f8fefc5c70dd5315063"),BoxFlagDef.OK | BoxFlagDef.CANCEL,true,null,function(param1:int):void
            {
               if(param1 == BoxFlagDef.OK)
               {
                  gameServer.sendMessage(HuntLifeProtocolCmd.SELL_CHAKRA,req,rsp,target);
               }
            },null).call();
         }
         else
         {
            this.gameServer.sendMessage(HuntLifeProtocolCmd.SELL_CHAKRA,req,rsp,target);
         }
         if(target is TextField)
         {
            (target as TextField).mouseEnabled = false;
         }
      }
      
      private function onPickup(param1:MouseEvent) : void
      {
         var _loc6_:int = 0;
         if(this.checkPracticeing())
         {
            return;
         }
         var _loc2_:DisplayObject = param1.currentTarget as DisplayObject;
         var _loc3_:ProtoPickUpChakraReq = new ProtoPickUpChakraReq();
         var _loc4_:ProtoPickUpChakraRsp = new ProtoPickUpChakraRsp();
         var _loc5_:String = _loc2_.name.split("_").shift();
         if(_loc5_ == "quick")
         {
            if(this.model.checkEmpty(PackageType.PRACTICE_PACKAGE))
            {
               GameTip.show(I18n.lang("as_huntLife_e0dc8ec8f479193ee6931da41202acdc"));
               return;
            }
            _loc3_.grade = this.getCurrentQualityCondition();
         }
         else
         {
            _loc6_ = int(_loc2_.parent.parent.name.split("_").pop());
            _loc3_.index = _loc6_;
         }
         this.gameServer.sendMessage(HuntLifeProtocolCmd.PICKUP,_loc3_,_loc4_,_loc2_);
      }
      
      private function onQuickMerge(param1:MouseEvent) : void
      {
         var _loc7_:String = null;
         if(this.checkPracticeing())
         {
            return;
         }
         var _loc2_:DisplayObject = param1.currentTarget as DisplayObject;
         var _loc3_:Array = HuntLifeUtil.execTotalMergeExp(this.model.chakraInPracticePackageHash,this.getCurrentQualityCondition());
         var _loc4_:Boolean = Boolean(_loc3_[0]);
         var _loc5_:ProtoChakraBlankInfo = _loc3_[1];
         var _loc6_:int = int(_loc3_[2]);
         if(Boolean(_loc5_) && Boolean(_loc6_))
         {
            _loc7_ = ChakraQuality.toColorName(ChakraType.toType(_loc5_.itemInfo.type) + " Nv. " + _loc5_.itemInfo.level,_loc5_.itemInfo.grade);
            new ShowTextBoxCommand(StrReplacer.replace(I18n.lang("as_huntLife_a76d7736d6a1aab814c59daced1e75c4"),[_loc7_,_loc6_]),BoxFlagDef.OK | BoxFlagDef.CANCEL,true,_loc2_,this.onConfirm).call();
         }
         else if(_loc4_)
         {
            this.onConfirm(BoxFlagDef.OK,_loc2_);
         }
         else
         {
            GameTip.show(I18n.lang("as_huntLife_9c2150018e9ce19559ae8e4fff5e38a6"));
         }
      }
      
      private function onConfirm(param1:int, param2:DisplayObject) : void
      {
         var _loc3_:ProtoSellChakraReq = null;
         var _loc4_:ProtoSellChakraRsp = null;
         if(param1 == BoxFlagDef.OK)
         {
            _loc3_ = new ProtoSellChakraReq();
            _loc4_ = new ProtoSellChakraRsp();
            _loc3_.grade = this.getCurrentQualityCondition();
            _loc3_.mergeFlag = 1;
            this.gameServer.sendMessage(HuntLifeProtocolCmd.SELL_CHAKRA,_loc3_,_loc4_,param2);
         }
      }
      
      private function onOpenExchange(param1:MouseEvent) : void
      {
         if(this.checkPracticeing())
         {
            return;
         }
         this.exchangePanel = this.exchangePanel || new ExchangePanel(this.model,this.gameServer);
         this.exchangePanel.open();
      }
      
      private function playPractice() : void
      {
         var _loc1_:ProtoHuntLifePracticeInfo = null;
         if(this.practiceInfoList.length)
         {
            _loc1_ = this.practiceInfoList.shift() as ProtoHuntLifePracticeInfo;
            if(_loc1_.hasBlankInfo)
            {
               this.model.addChakra(_loc1_.blankInfo);
               this.model.attachNpcInfo(_loc1_.npcInfo);
            }
         }
         if(!this.practiceInfoList.length)
         {
            clearInterval(this.autoPracticeIntervalID);
         }
      }
      
      private function playPracticeComplete() : void
      {
         var _loc3_:ProtoHuntLifePracticeInfo = null;
         var _loc4_:Boolean = false;
         clearInterval(this.autoPracticeIntervalID);
         var _loc1_:int = int(this.practiceInfoList.length);
         var _loc2_:int = 0;
         while(_loc2_ < _loc1_)
         {
            _loc3_ = this.practiceInfoList[_loc2_] as ProtoHuntLifePracticeInfo;
            _loc4_ = _loc2_ == _loc1_ - 1;
            this.model.addChakra(_loc3_.blankInfo,_loc4_);
            this.model.attachNpcInfo(_loc3_.npcInfo,_loc4_);
            _loc2_++;
         }
         this.practiceInfoList.length = 0;
      }
      
      private function onPracticeRsp(param1:SocketProtocol) : void
      {
         var rsp:ProtoPracticeRsp = null;
         var npcID:int = 0;
         var flagNames:Object = null;
         var protocol:SocketProtocol = param1;
         if(protocol.clientData === BATCH_CLIENT)
         {
            this.practiceSending = false;
            if(protocol.error != 0)
            {
               if(this.batchRunning)
               {
                  this.traceBatch("practice error " + (protocol.errorStr ? String(protocol.errorStr) : String(protocol.error)));
                  this.batchStop("召唤失败");
               }
               return;
            }
            rsp = protocol.serverMessage as ProtoPracticeRsp;
            this.practiceInfoList = this.practiceInfoList.concat(rsp.practiceInfo);
            this.playPracticeComplete();
            this.refreshData();
            if(rsp.hasHuntLifeInfo)
            {
               this.model.freeCount = rsp.huntLifeInfo.freeCount;
               this.model.callNpcTotalTimes = rsp.huntLifeInfo.callNpcMaxCount;
               this.model.vip4FreeCount = rsp.huntLifeInfo.vip4FreeCount;
               this.model.score = rsp.huntLifeInfo.score;
               this.model.callNpcCost = rsp.huntLifeInfo.callNpcCost;
               this.refreshScore();
               this.refreshCallNpcTimeText();
            }
            if(this.batchRunning && this.batchPhase == "summonWait") this.onBatchPractice(protocol);
            return;
         }
         this.practiceSending = false;
         if(protocol.error == 0)
         {
            rsp = protocol.serverMessage as ProtoPracticeRsp;
            this.practiceInfoList = this.practiceInfoList.concat(rsp.practiceInfo);
            npcID = int(ProtoPracticeReq(protocol.clientMessage).npcId);
            if(npcID > 0)
            {
               GameTip.show(StrReplacer.replace(I18n.lang("as_huntLife_ed2db9c2c62e6b9fa4aaa6984fe425fc"),this.costXML.item[npcID - 1].@cost));
            }
            if(this.practiceInfoList.length == 1)
            {
               this.playPractice();
            }
            else if(this.practiceInfoList.length > 1)
            {
               this.playPractice();
               this.autoPracticeIntervalID = setInterval(this.playPractice,AUTO_PRACTICE_INTERVAL);
            }
            if(rsp.hasHuntLifeInfo)
            {
               this.model.freeCount = rsp.huntLifeInfo.freeCount;
               this.model.callNpcTotalTimes = rsp.huntLifeInfo.callNpcMaxCount;
               this.model.vip4FreeCount = rsp.huntLifeInfo.vip4FreeCount;
               this.model.score = rsp.huntLifeInfo.score;
               this.model.callNpcCost = rsp.huntLifeInfo.callNpcCost;
               this.refreshScore();
               this.refreshCallNpcTimeText();
            }
         }
         else if(protocol.errorStr == I18n.lang("as_huntLife_1044714d89a0b59640d82ec659ab2a75"))
         {
            flagNames = {};
            flagNames[BoxFlagDef.OK] = I18n.lang("as_huntLife_f5e3537699565f8489b1335490d56618");
            new ShowTextBoxCommand(I18n.lang("as_huntLife_7525cba0412a5c1c44328f959282f52c"),BoxFlagDef.OK | BoxFlagDef.CLOSE,true,null,function(param1:int):void
            {
               if(param1 == BoxFlagDef.OK)
               {
                  new OpenVIPWindowCommand().call();
               }
            },null,flagNames).call();
         }
         else
         {
            GameTip.show(protocol.errorStr);
         }
      }
      
      private function onCallNPCRsp(param1:SocketProtocol) : void
      {
         var _loc2_:ProtoCallNpcRsp = null;
         if(param1.error == 0)
         {
            _loc2_ = param1.serverMessage as ProtoCallNpcRsp;
            if(_loc2_.hasHuntLifeInfo)
            {
               this.model.freeCount = _loc2_.huntLifeInfo.freeCount;
               this.model.callNpcTotalTimes = _loc2_.huntLifeInfo.callNpcMaxCount;
               this.model.attachNpcInfo(_loc2_.huntLifeInfo.npcInfo);
               this.model.updateVip4FreeCount(_loc2_.huntLifeInfo.vip4FreeCount);
               this.refreshCallNpcTimeText();
            }
         }
         else
         {
            GameTip.show(param1.errorStr);
         }
      }
      
      private function onSellOrMergeRsp(param1:SocketProtocol) : void
      {
         var _loc2_:InteractiveObject = null;
         var _loc3_:ProtoSellChakraRsp = null;
         var _loc4_:String = null;
         this.selling = false;
         if(param1.clientData === BATCH_CLIENT)
         {
            if(param1.error != 0)
            {
               if(this.batchRunning)
               {
                  this.traceBatch("merge error " + (param1.errorStr ? String(param1.errorStr) : String(param1.error)));
                  this.batchStop("合成失败");
               }
               return;
            }
            _loc3_ = param1.serverMessage as ProtoSellChakraRsp;
            if(_loc3_.hasHuntLifeInfo) this.model.attackHuntLifeInfo(_loc3_.huntLifeInfo);
            if(this.batchRunning && this.batchPhase == "mergeWait") this.onBatchMerge(param1);
            return;
         }
         if(param1.error == 0)
         {
            _loc2_ = param1.clientData as InteractiveObject;
            if(_loc2_ is TextField)
            {
               (_loc2_ as TextField).mouseEnabled = true;
            }
            if(_loc2_.name != "quick_merge_btn")
            {
               _loc4_ = _loc2_.name.split("_").shift();
               if(_loc4_ != "quick")
               {
                  _loc2_.removeEventListener(MouseEvent.CLICK,this.onSell);
               }
            }
            _loc3_ = param1.serverMessage as ProtoSellChakraRsp;
            if(_loc3_.hasHuntLifeInfo)
            {
               this.model.attackHuntLifeInfo(_loc3_.huntLifeInfo);
            }
            else
            {
               new OpenHuntLifeMainPanelCommand().call();
            }
         }
         else
         {
            GameTip.show(param1.errorStr);
         }
      }
      
      private function onPickupRsp(param1:SocketProtocol) : void
      {
         var _loc2_:InteractiveObject = null;
         var _loc3_:String = null;
         var _loc4_:ProtoPickUpChakraRsp = null;
         var _loc5_:uint = 0;
         var _loc6_:PracticeBlankItem = null;
         var _loc7_:Point = null;
         var _loc8_:ProtoPickUpChakraRsp = null;
         if(param1.clientData === BATCH_CLIENT)
         {
            if(param1.error != 0)
            {
               var reason:String = param1.errorStr ? String(param1.errorStr) : String(param1.error);
               if(reason.indexOf("背包") >= 0) reason = "背包已满";
               this.traceBatch("pickup error " + reason);
               if(this.batchRunning) this.batchStop(reason == "背包已满" ? "背包已满" : "收纳失败");
               return;
            }
            _loc8_ = param1.serverMessage as ProtoPickUpChakraRsp;
            if(_loc8_.hasHuntLifeInfo) this.model.attackHuntLifeInfo(_loc8_.huntLifeInfo);
            if(this.batchRunning && this.batchPhase == "pickupWait") this.onBatchPickup(param1);
            return;
         }
         if(param1.error == 0)
         {
            _loc2_ = param1.clientData as InteractiveObject;
            _loc3_ = _loc2_.name.split("_").shift();
            if(_loc3_ != "quick")
            {
               _loc2_.removeEventListener(MouseEvent.CLICK,this.onPickup);
            }
            _loc4_ = param1.serverMessage as ProtoPickUpChakraRsp;
            for each(_loc5_ in _loc4_.index)
            {
               _loc6_ = this.blankItemHash[_loc5_];
               _loc7_ = new Point(_loc6_.icon.x,_loc6_.icon.y);
               _loc7_ = _loc6_.localToGlobal(_loc7_);
               this.container.playPickup(_loc6_.getThumb(),_loc7_);
            }
            if(_loc4_.hasHuntLifeInfo)
            {
               this.model.attackHuntLifeInfo(_loc4_.huntLifeInfo);
            }
            else
            {
               new OpenHuntLifeMainPanelCommand().call();
            }
         }
         else
         {
            GameTip.show(param1.errorStr);
         }
      }
      private function createBatchControl() : void
      {
         try
         {
            this.batchPanel = new Sprite();
            this.drawBatchPanel();
            this.batchPanel.x = 900;
            this.batchPanel.y = -78;
            var gold:Sprite = this.makeBatchButton("修炼至金色",10,5,86,32);
            gold.name = "batch_grade_5";
            gold.addEventListener(MouseEvent.CLICK,this.onBatchGradeSelect,false,1);
            this.batchGradeButtons.push(gold);
            this.batchPanel.addChild(gold);
            var red:Sprite = this.makeBatchButton("修炼至红色",102,5,86,32);
            red.name = "batch_grade_6";
            red.addEventListener(MouseEvent.CLICK,this.onBatchGradeSelect,false,1);
            this.batchGradeButtons.push(red);
            this.batchPanel.addChild(red);
            this.batchStartButton = this.makeBatchButton("开始",194,5,106,32);
            this.batchStartButton.name = "batch_toggle";
            this.batchStartButton.addEventListener(MouseEvent.CLICK,this.onBatchToggle,false,1);
            this.batchPanel.addChild(this.batchStartButton);
            this.batchProgress = this.makeBatchLabel("轮 0   召唤 0",10,40,150,11,0xEADFC6,false);
            this.batchPanel.addChild(this.batchProgress);
            this.batchStateText = this.makeBatchLabel("遇金停",168,40,132,11,0xF2C878,false);
            this.batchStateText.wordWrap = true;
            this.batchStateText.multiline = true;
            this.batchPanel.addChild(this.batchStateText);
            this.addChild(this.batchPanel);
            this.refreshBatchUI();
         }
         catch(error:Error)
         {
            // 协助面板自身失败绝不能拖垮整个修炼页
            this.traceBatch("batch control init failed: " + error);
         }
      }
      
      private function drawBatchPanel() : void
      {
         var g:Graphics = this.batchPanel.graphics;
         g.beginFill(0x1A140C,0.46);
         g.drawRoundRect(0,0,310,58,9,9);
         g.endFill();
      }
      
      // Reuse the game's own button component so the look, hover state, click
      // sound and centred label all match the surrounding panel exactly.
      private function makeBatchButton(param1:String, param2:Number, param3:Number, param4:Number, param5:Number) : Sprite
      {
         var button:Sprite = null;
         try
         {
            var native:ButtonNormalBlue = new ButtonNormalBlue();
            native.label = param1;
            native.width = param4;
            native.height = param5;
            native.x = param2;
            native.y = param3;
            native.name = "batch_chip";
            button = native;
         }
         catch(error:Error)
         {
            button = this.makeFallbackButton(param1,param2,param3,param4,param5);
         }
         button.buttonMode = true;
         button.useHandCursor = true;
         return button;
      }
      
      private function setBatchButtonLabel(param1:Sprite, param2:String) : void
      {
         try
         {
            if(param1 is ButtonNormalBlue)
            {
               (param1 as ButtonNormalBlue).label = param2;
               return;
            }
         }
         catch(error:Error)
         {
         }
         var field:TextField = param1.getChildAt(1) as TextField;
         if(field != null) field.text = param2;
      }
      
      // Only used if the native control is unavailable in this build.
      private function makeFallbackButton(param1:String, param2:Number, param3:Number, param4:Number, param5:Number) : Sprite
      {
         var chip:Sprite = new Sprite();
         chip.x = param2;
         chip.y = param3;
         var bg:Sprite = new Sprite();
         var matrix:Matrix = new Matrix();
         matrix.createGradientBox(param4,param5,Math.PI / 2,0,0);
         bg.graphics.lineStyle(1,0xE3C06A,1);
         bg.graphics.beginGradientFill(GradientType.LINEAR,[0x8FD4F7,0x2A88C8,0x14496E],[1,1,1],[0,132,255],matrix);
         bg.graphics.drawRect(0,0,param4,param5);
         bg.graphics.endFill();
         chip.addChild(bg);
         var label:TextField = new TextField();
         label.width = param4;
         label.height = param5;
         label.selectable = false;
         label.mouseEnabled = false;
         label.defaultTextFormat = new TextFormat("_sans",12,0xFFFFFF,true,false,false,null,null,"center");
         label.text = param1;
         label.y = Math.round((param5 - 16) / 2);
         chip.addChild(label);
         chip.buttonMode = true;
         chip.useHandCursor = true;
         return chip;
      }
      
      private function makeBatchLabel(param1:String, param2:Number, param3:Number, param4:Number, param5:int, param6:int, param7:Boolean) : TextField
      {
         var field:TextField = new TextField();
         field.x = param2;
         field.y = param3;
         field.width = param4;
         field.height = param5 + 6;
         field.selectable = false;
         field.mouseEnabled = false;
         field.defaultTextFormat = new TextFormat("_sans",param5,param6,param7);
         field.text = param1;
         return field;
      }
      
      private function traceBatch(param1:String) : void
      {
         try
         {
            ExternalInterface.call("console.log","[ASSIST-TRACE] " + param1);
         }
         catch(e:Error)
         {
         }
      }
      
      private function refreshBatchUI() : void
      {
         if(this.batchPanel == null) return;
         var i:int = 0;
         var chip:Sprite = null;
         while(i < this.batchGradeButtons.length)
         {
            chip = this.batchGradeButtons[i] as Sprite;
            var grade:int = int(String(chip.name).split("_").pop());
            chip.filters = grade == this.batchStopGrade ? [new GlowFilter(0xFFD24A,0.95,6,6,2.2,2)] : [];
            chip.mouseEnabled = !this.batchRunning;
            i++;
         }
         this.setBatchButtonLabel(this.batchStartButton,this.batchRunning ? "停止" : "开始");
         this.batchProgress.text = "轮 " + this.batchRoundsDone + "   召唤 " + this.batchCallsTotal;
      }

      private function onBatchGradeSelect(param1:MouseEvent) : void
      {
         if(this.batchRunning) return;
         this.batchStopGrade = int(String((param1.currentTarget as DisplayObject).name).split("_").pop());
         this.setBatchState(this.batchStopGrade >= BATCH_STOP_RED ? "遇红停" : "遇金停");
         this.refreshBatchUI();
      }


      // 所选品质(金=5/红=6)出现即停：无限循环直至触发。
      private function countStopGradeItems() : int
      {
         var count:int = 0;
         var blank:ProtoChakraBlankInfo = null;
         if(this.model == null || this.model.chakraInPracticePackageHash == null) return 0;
         for each(blank in this.model.chakraInPracticePackageHash)
         {
            if(blank.hasItemInfo && blank.itemInfo != null && blank.itemInfo.grade >= this.batchStopGrade) count++;
         }
         return count;
      }
      
      private function setBatchState(param1:String) : void
      {
         if(this.batchStateText != null) this.batchStateText.text = param1;
      }
      

      private function onBatchToggle(param1:MouseEvent) : void
      {
         if(this.batchRunning) this.batchStop("已停止");
         else this.batchStart();
      }
      
      private function onBatchAdded(param1:Event) : void
      {
         this.addEventListener(Event.ENTER_FRAME,this.raiseBatchPanel);
         this.raiseBatchPanel();
      }
      
      // The shell re-adds the header tabs after the panel opens, which covers this bar.
      private function raiseBatchPanel(param1:Event = null) : void
      {
         var host:DisplayObjectContainer = this.parent;
         if(this.batchPanel == null || host == null) return;
         var globalPoint:Point = this.localToGlobal(new Point(900,-78));
         var localPoint:Point = host.globalToLocal(globalPoint);
         host.addChild(this.batchPanel);
         this.batchPanel.x = localPoint.x;
         this.batchPanel.y = localPoint.y;
         this.batchPanel.mouseEnabled = true;
         this.batchPanel.mouseChildren = true;
      }
      
      private function onBatchRemoved(param1:Event) : void
      {
         this.removeEventListener(Event.ENTER_FRAME,this.raiseBatchPanel);
         if(this.batchRunning) this.batchStop("已关闭");
         if(this.batchPanel != null && this.batchPanel.parent != null) this.batchPanel.parent.removeChild(this.batchPanel);
      }
      
      private function batchStart() : void
      {
         if(this.model == null) return;
         if(this.countStopGradeItems() > 0)
         {
            this.setBatchState("先处理目标");
            return;
         }
         if(this.practiceInfoList.length || this.practiceSending || this.selling)
         {
            this.setBatchState("请稍候");
            return;
         }
         this.batchRunning = true;
         this.batchRoundsDone = 0;
         this.batchCallsTotal = 0;
         this.batchCallsThisRound = 0;
         this.batchPhase = "summon";
         this.batchWaitSince = 0;
         this.batchNoNpcSince = 0;
         this.setBatchState("运行中");
         this.setManualControlsEnabled(false);
         this.refreshBatchUI();
         this.traceBatch("start grade=" + this.batchStopGrade + " items=" + this.countPracticeItems());
         if(this.batchTimer == null)
         {
            this.batchTimer = new Timer(120);
            this.batchTimer.addEventListener(TimerEvent.TIMER,this.onBatchTimer);
         }
         this.batchTimer.start();
         this.batchTick();
      }
      
      private function batchStop(param1:String) : void
      {
         this.batchRunning = false;
         this.batchPhase = "idle";
         this.batchWaitSince = 0;
         this.batchNoNpcSince = 0;
         if(this.batchTimer != null) this.batchTimer.stop();
         this.setManualControlsEnabled(true);
         if(this.isShow) this.refreshData();
         this.traceBatch("stop " + param1 + " rounds=" + this.batchRoundsDone + " calls=" + this.batchCallsTotal + " items=" + this.countPracticeItems());
         this.setBatchState(param1);
         this.refreshBatchUI();
      }
      
      private function onBatchTimer(param1:TimerEvent) : void
      {
         this.batchTick();
      }
      
      private function batchTick() : void
      {
         var req:ProtoPracticeReq = null;
         if(!this.batchRunning) return;
         if(this.countStopGradeItems() > 0)
         {
            this.batchStop(this.batchStopGrade >= BATCH_STOP_RED ? "出红停止" : "出金停止");
            return;
         }
         if(this.batchPhase == "summonWait" || this.batchPhase == "mergeWait" || this.batchPhase == "pickupWait")
         {
            if(this.batchWaitSince > 0 && getTimer() - this.batchWaitSince > 8000) this.batchStop("超时");
            return;
         }
         if(this.batchPhase != "summon") return;
         if(this.countPracticeItems() >= 20)
         {
            this.batchStartMerge();
            return;
         }
         // Brazil auto-practice is one free request with no npcId, the same packet as Prática Automática.
         req = new ProtoPracticeReq();
         this.practiceSending = true;
         this.batchPhase = "summonWait";
         this.batchWaitSince = getTimer();
         this.gameServer.sendMessage(HuntLifeProtocolCmd.PRACTICE,req,new ProtoPracticeRsp(),BATCH_CLIENT);
      }
      
      private function batchStartMerge() : void
      {
         var req:ProtoSellChakraReq = new ProtoSellChakraReq();
         req.type = 1;
         req.grade = this.getCurrentQualityCondition();
         req.mergeFlag = 1;
         this.selling = true;
         this.batchPhase = "mergeWait";
         this.batchWaitSince = getTimer();
         this.gameServer.sendMessage(HuntLifeProtocolCmd.SELL_CHAKRA,req,new ProtoSellChakraRsp(),BATCH_CLIENT);
      }
      
      private function batchStartPickup() : void
      {
         var req:ProtoPickUpChakraReq = new ProtoPickUpChakraReq();
         req.grade = this.getCurrentQualityCondition();
         this.batchPhase = "pickupWait";
         this.batchWaitSince = getTimer();
         this.gameServer.sendMessage(HuntLifeProtocolCmd.PICKUP,req,new ProtoPickUpChakraRsp(),BATCH_CLIENT);
      }
      
      private function onBatchPractice(param1:SocketProtocol) : void
      {
         if(!this.batchRunning) return;
         if(param1.error != 0)
         {
            this.traceBatch("practice error " + (param1.errorStr ? String(param1.errorStr) : String(param1.error)));
            this.batchStop("召唤失败");
            return;
         }
         this.batchCallsTotal++;
         this.batchCallsThisRound++;
         this.batchPhase = "summon";
         this.batchWaitSince = 0;
         this.refreshBatchUI();
         if(this.countStopGradeItems() > 0)
         {
            this.batchStop(this.batchStopGrade >= BATCH_STOP_RED ? "出红停止" : "出金停止");
            return;
         }
         if(this.countPracticeItems() <= 1)
         {
            this.batchStop("无法合成");
            return;
         }
         this.batchStartMerge();
      }
      
      private function onBatchMerge(param1:SocketProtocol) : void
      {
         if(!this.batchRunning) return;
         if(param1.error != 0)
         {
            this.traceBatch("merge error " + (param1.errorStr ? String(param1.errorStr) : String(param1.error)));
            this.batchStop("合成失败");
            return;
         }
         this.batchRoundsDone++;
         this.batchCallsThisRound = 0;
         this.refreshBatchUI();
         this.traceBatch("round " + this.batchRoundsDone + " items=" + this.countPracticeItems() + " full=" + this.countFullLevelItems());
         if(this.countStopGradeItems() > 0)
         {
            this.batchStop(this.batchStopGrade >= BATCH_STOP_RED ? "出红停止" : "出金停止");
            return;
         }
         this.batchPhase = "summon";
         this.batchWaitSince = 0;
         if(this.countPracticeItems() >= 20)
         {
            // Every slot is occupied after a successful merge: only full-level
            // products can cause this, and they cannot be merged further, so the
            // original pickup flow is the only way to free a slot.
            if(this.countFullLevelItems() > 0) this.batchStartPickup();
            else this.batchStop("格子已满");
            return;
         }
         this.batchTick();
      }
      
      private function onBatchPickup(param1:SocketProtocol) : void
      {
         if(!this.batchRunning) return;
         if(param1.error != 0)
         {
            this.traceBatch("pickup error " + (param1.errorStr ? String(param1.errorStr) : String(param1.error)));
            this.batchStop("收纳失败");
            return;
         }
         this.batchPhase = "summon";
         this.batchWaitSince = 0;
         this.traceBatch("pickup items=" + this.countPracticeItems());
         this.batchTick();
      }
      
      // The batch owns every request while it runs; hand controls must not interleave.
      private function setManualControlsEnabled(param1:Boolean) : void
      {
         if(this.ui == null) return;
         var names:Array = ["quick_sell_btn","quick_pickup_btn","quick_merge_btn","practice_btn_auto","callNPC_btn","practice_btn_1","practice_btn_2","practice_btn_3","practice_btn_4","practice_btn_5"];
         var i:int = 0;
         var target:* = null;
         while(i < names.length)
         {
            target = this.ui[names[i]];
            if(target != null)
            {
               target.mouseEnabled = param1;
               target.alpha = param1 ? 1 : 0.45;
            }
            i++;
         }
      }
      
      private function countPracticeItems() : int
      {
         var count:int = 0;
         var blank:ProtoChakraBlankInfo = null;
         if(this.model == null || this.model.chakraInPracticePackageHash == null) return 0;
         for each(blank in this.model.chakraInPracticePackageHash)
         {
            if(blank.hasItemInfo) count++;
         }
         return count;
      }
      
      private function countFullLevelItems() : int
      {
         var count:int = 0;
         var blank:ProtoChakraBlankInfo = null;
         if(this.model == null || this.model.chakraInPracticePackageHash == null) return 0;
         for each(blank in this.model.chakraInPracticePackageHash)
         {
            if(blank.hasItemInfo && blank.itemInfo != null && HuntLifeUtil.isFullLevel(blank.itemInfo.level)) count++;
         }
         return count;
      }
      
      private function firstReadyNpc() : int
      {
         var npc:ProtoNpcInfo = null;
         if(this.model == null || this.model.npcHash == null) return 0;
         for each(npc in this.model.npcHash)
         {
            if(npc.state == NpcState.ENABLE) return npc.npcId;
         }
         return 0;
      }
   }
}

