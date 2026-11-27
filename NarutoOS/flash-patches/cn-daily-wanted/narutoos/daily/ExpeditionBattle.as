package narutoos.daily
{
   import flash.display.DisplayObjectContainer;
   import flash.display.InteractiveObject;
   import flash.display.Sprite;
   import flash.events.Event;
   import flash.events.IEventDispatcher;
   import flash.events.MouseEvent;
   import flash.utils.getDefinitionByName;
   import flash.utils.getQualifiedClassName;

   /** Drives one survival expedition battle through the game's native UI. */
   public final class ExpeditionBattle
   {
      private static const ASSETS_READY:String = "naruto.allComplete";
      private static const PREWAR_PANEL:String = "com.tencent.morefun.naruto.plugin.prewar.view::PrewarPanel";
      private static const PREWAR_UI:String = "com.tencent.morefun.naruto.plugin.prewar::PrewarUI";
      private static const MOVIE_CLIP_BUTTON:String = "com.tencent.morefun.naruto.plugin.ui.components.buttons::MovieClipButton";
      private static const MODEL_DEF_BATTLE:String = "battleStart";
      private static const NEW_EXPEDITION:int = 47;
      private static const PVE_START_COMMAND:String = "battle.command::RequestPveFightStartCommand";
      private static const PREWAR_READY_COMMAND:String = "battle.command::PrewarReadyAckCommand";

      private var origin:Sprite;
      private var commandEvents:IEventDispatcher;
      private var battleEvents:IEventDispatcher;
      private var mapAssetsLoader:Object;
      private var battleUpdateEvent:String;
      private var battleInfo:Object;
      private var startCommand:Object;
      private var readyCommand:Object;
      private var openMapCommand:Object;
      private var stageId:uint;
      private var armed:Boolean;
      private var startCommandExecuted:Boolean;
      private var readyClicked:Boolean;
      private var readyCommandExecuted:Boolean;
      private var prewarBound:Boolean;
      private var started:Boolean;
      private var resultSeen:Boolean;
      private var completed:Boolean;
      private var failure:String;

      public function ExpeditionBattle(origin:Sprite)
      {
         this.origin = origin;
      }

      /** The battle model's START event proves the map may close. */
      public function get canLeaveMap():Boolean
      {
         return started;
      }

      public function openMap():void
      {
         var commandType:Class = getDefinitionByName("expeditionary.command.OpenExpeditionaryCommand") as Class;
         var facade:Object = getDefinitionByName("com.tencent.morefun.framework.apf.core.facade.Facade");
         var app:Object = getDefinitionByName("base.ApplicationData");
         if(app.singleton.getModel(MODEL_DEF_BATTLE).isFighting)
            throw new Error("当前正在战斗，请回到游戏主界面后执行。");
         openMapCommand = new commandType(true,false);
         if(facade.getInstance().commandManager.getCommandAssetsIsReady(commandType))
         {
            openMapCommand.call();
            return;
         }

         // Load the same dependencies as CommandManager. Only submit the native
         // navigation command after loading, so stopping during a cold load cancels it.
         var loaderType:Class = getDefinitionByName("com.tencent.morefun.framework.apf.managers.plugin.NarutoAssetsLoader") as Class;
         var vectorType:Class = getDefinitionByName("__AS3__.vec::Vector.<com.tencent.morefun.framework.base::Command>") as Class;
         var loadManager:Object = getDefinitionByName("com.tencent.morefun.framework.net.LoadManager");
         var loaderDef:Object = getDefinitionByName("com.tencent.morefun.framework.net.def.LoaderDef");
         var commands:Object = new vectorType();
         commands.push(openMapCommand);
         mapAssetsLoader = new loaderType();
         mapAssetsLoader.pushCommands(commands);
         mapAssetsLoader.addEventListener(ASSETS_READY,onMapAssetsReady);
         mapAssetsLoader.start(loadManager.getManager(loaderDef.PLUGIN));
      }

      /** Arm before Run calls map.challenge(stageId), so its native command is observable. */
      public function arm(stageId:uint):void
      {
         cancel();
         if(!origin || !origin.stage)
         {
            throw new Error("生存演习助手已离开游戏页。");
         }
         this.stageId = stageId;
         armed = true;
         try
         {
            var appType:Class = getDefinitionByName("base.ApplicationData") as Class;
            var app:Object = appType.singleton;
            battleInfo = app.getModel(MODEL_DEF_BATTLE);
            if(battleInfo == null)
            {
               throw new Error("当前游戏页没有可读取的战斗状态。");
            }
            battleEvents = battleInfo as IEventDispatcher;
            if(battleEvents == null)
            {
               throw new Error("当前游戏页的战斗状态不支持原生事件。");
            }
            var modelEventType:Class = getDefinitionByName("com.tencent.morefun.naruto.model.event.ModelEvent") as Class;
            battleUpdateEvent = String(modelEventType.UPDATE);
            battleEvents.addEventListener(battleUpdateEvent,onBattleUpdate,false,int.MAX_VALUE);

            var facade:Object = getDefinitionByName("com.tencent.morefun.framework.apf.core.facade.Facade");
            commandEvents = facade.getInstance().commandManager as IEventDispatcher;
            commandEvents.addEventListener("commandRequest",onCommandRequest,false,int.MAX_VALUE);
            commandEvents.addEventListener("commandExecute",onCommandExecute,false,int.MAX_VALUE);
            commandEvents.addEventListener("commandLoadError",onCommandStopped);
            commandEvents.addEventListener("commandCancel",onCommandStopped);

            if(battleInfo.isFighting)
            {
               throw new Error("当前已有战斗，无法确认它属于本次生存演习。");
            }
         }
         catch(error:Error)
         {
            cancel();
            throw error;
         }
      }

      /** Check for the native prewar and result views and perform their exact controls. */
      public function advance():String
      {
         if(!origin || !origin.stage)
         {
            throw new Error("生存演习助手已离开游戏页。");
         }
         if(failure)
         {
            throw new Error(failure);
         }
         if(!armed) return "waiting";
         if(completed)
         {
            return "returning";
         }
         if(resultSeen)
         {
            if(clickNativeWinComplete())
            {
               return "returning";
            }
            return "fighting";
         }

         if(!readyClicked && startCommandExecuted)
         {
            var panel:DisplayObjectContainer = nativeView("prewar",PREWAR_PANEL);
            if(panel && panel.visible)
            {
               prewarBound = int(battleInfo.type) == NEW_EXPEDITION && int(battleInfo.clientId) == 1 &&
                  (Number(battleInfo.startTime) == Number(startCommand.commandStartTime) || started);
               if(!prewarBound) throw new Error("战前阵容页未对应到本次选择的生存演习关卡。");
               clickNativePrewarReady(panel);
            }
         }
         return started ? "fighting" : "waiting";
      }

      public function ownsBox(box:Object):Boolean
      {
         // PrewarPanel and BattleView are native layer views, not BoxManager dialogs.
         return false;
      }

      public function cancel():void
      {
         if(battleEvents != null && battleUpdateEvent != null)
         {
            battleEvents.removeEventListener(battleUpdateEvent,onBattleUpdate);
         }
         if(commandEvents != null)
         {
            commandEvents.removeEventListener("commandRequest",onCommandRequest);
            commandEvents.removeEventListener("commandExecute",onCommandExecute);
            commandEvents.removeEventListener("commandLoadError",onCommandStopped);
            commandEvents.removeEventListener("commandCancel",onCommandStopped);
         }
         if(mapAssetsLoader != null)
         {
            mapAssetsLoader.removeEventListener(ASSETS_READY,onMapAssetsReady);
            mapAssetsLoader.dispose();
            mapAssetsLoader = null;
         }
         commandEvents = null;
         battleEvents = null;
         battleUpdateEvent = null;
         battleInfo = null;
         startCommand = null;
         readyCommand = null;
         openMapCommand = null;
         armed = false;
         startCommandExecuted = false;
         readyClicked = false;
         readyCommandExecuted = false;
         prewarBound = false;
         started = false;
         resultSeen = false;
         completed = false;
         failure = null;
      }

      private function nativeView(layer:String, className:String):DisplayObjectContainer
      {
         // BaseLayer attaches to Stage after it has added its first child.
         var parent:DisplayObjectContainer = origin.stage.getChildByName(layer) as DisplayObjectContainer;
         return parent && parent.visible ? NativeFightResult.directChild(parent,className) : null;
      }

      private function onCommandRequest(event:Event):void
      {
         if(!armed)
         {
            return;
         }
         var command:Object = Object(event).command;
         if(command == null)
         {
            return;
         }
         var className:String = getQualifiedClassName(command);
         if(className == PVE_START_COMMAND && startCommand == null && !started)
         {
            if(int(command.type) != NEW_EXPEDITION || int(command.clientId) != 1 || uint(command.newExpeditionStageId) != stageId)
            {
               failure = "生存演习启动命令与本次选择的关卡不一致。";
               return;
            }
            startCommand = command;
            return;
         }
         if(className == PVE_START_COMMAND && startCommand != null && command !== startCommand)
         {
            failure = "预战期间出现其他战斗启动命令，无法确认本场归属。";
            return;
         }
         if(className == PREWAR_READY_COMMAND && readyClicked && readyCommand == null)
         {
            readyCommand = command;
         }
      }

      private function onCommandExecute(event:Event):void
      {
         var command:Object = Object(event).command;
         if(command === startCommand)
         {
            startCommandExecuted = true;
         }
         else if(command === readyCommand)
         {
            readyCommandExecuted = true;
         }
      }

      private function onCommandStopped(event:Event):void
      {
         var command:Object = Object(event).command;
         if(command === startCommand || command === readyCommand)
         {
            failure = event.type == "commandCancel" ? "本次生存演习启动已取消。" : "生存演习所需的游戏命令加载失败。";
         }
      }

      private function onMapAssetsReady(event:Event):void
      {
         if(event.currentTarget !== mapAssetsLoader) return;
         var failed:Boolean = mapAssetsLoader.fails && mapAssetsLoader.fails.length > 0;
         mapAssetsLoader.removeEventListener(ASSETS_READY,onMapAssetsReady);
         mapAssetsLoader.dispose();
         mapAssetsLoader = null;
         if(failed)
         {
            failure = "生存演习地图资源加载失败。";
            return;
         }
         try { openMapCommand.call(); }
         catch(error:Error) { failure = "无法打开演习地图。"; }
      }

      private function onBattleUpdate(event:Event):void
      {
         if(!armed || battleInfo == null)
         {
            return;
         }
         var key:String = Object(event).key as String;
         var type:int = int(battleInfo.type);
         var client:int = int(battleInfo.clientId);
         if(key == "start")
         {
            if(!startCommand || !startCommandExecuted || type != NEW_EXPEDITION || client != 1)
            {
               failure = "游戏战斗未能通过本场预战及已保存阵容确认归属。";
               return;
            }
            if(Number(battleInfo.startTime) != Number(startCommand.commandStartTime) && !(prewarBound && readyCommandExecuted))
            {
               failure = "游戏战斗未能通过本场预战及已保存阵容确认归属。";
               return;
            }
            started = true;
            return;
         }
         // Native auto-claim or a player's own click can finish this victory first.
         if(key == "end" && resultSeen && type == NEW_EXPEDITION && client == 1) completed = true;
         if((key == "fail" || (key == "end" && !completed)) && startCommand && type == NEW_EXPEDITION && client == 1)
         {
            failure = "本场战斗已中断，生存演习已停止。";
            return;
         }
         if(key == "showResult" && started && type == NEW_EXPEDITION && client == 1)
         {
            if(!Boolean(battleInfo.isWin))
            {
               failure = "生存演习本场战斗失败，已停止。";
               return;
            }
            resultSeen = true;
         }
      }

      private function clickNativePrewarReady(panel:DisplayObjectContainer):void
      {
         var ui:DisplayObjectContainer = NativeFightResult.directChild(panel,PREWAR_UI);
         if(ui == null || !ui.visible || !("pkg" in ui))
         {
            return;
         }
         var pkg:DisplayObjectContainer = Object(ui).pkg as DisplayObjectContainer;
         var readyButton:InteractiveObject;
         for(var i:int = 0; pkg && i < pkg.numChildren; i++)
         {
            var wrapper:Object = pkg.getChildAt(i);
            if(getQualifiedClassName(wrapper) == MOVIE_CLIP_BUTTON && wrapper.view && wrapper.view.name == "ready")
            {
               readyButton = wrapper as InteractiveObject;
               break;
            }
         }
         if(!isEnabledVisible(readyButton)) return;
         var formation:Object = Object(panel).selfFormation;
         if(formation == null || formation.arranges == null || formation.arranges.length == 0)
         {
            throw new Error("已保存的生存演习阵容为空，已停止。");
         }
         readyClicked = true;
         readyButton.dispatchEvent(new MouseEvent(MouseEvent.CLICK,true,false));
      }

      private function clickNativeWinComplete():Boolean
      {
         var result:Object = NativeFightResult.current(origin.stage);
         if(result && result.kind == "fail")
         {
            failure = "生存演习本场战斗失败，已停止。";
            return false;
         }
         var button:InteractiveObject = NativeFightResult.exitButton(result);
         if(!button) return false;
         // The native result button can synchronously publish BattleKeyDef.END.
         completed = true;
         button.dispatchEvent(new MouseEvent(MouseEvent.CLICK,true,false));
         return true;
      }

      private static function isEnabledVisible(button:InteractiveObject):Boolean
      {
         return button != null && button.stage != null && button.visible && button.mouseEnabled &&
            ("enabled" in button && Boolean(Object(button).enabled));
      }

   }
}
