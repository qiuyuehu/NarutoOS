package narutoos.daily
{
   import flash.accessibility.AccessibilityProperties;
   import flash.display.DisplayObject;
   import flash.display.DisplayObjectContainer;
   import flash.display.Graphics;
   import flash.display.InteractiveObject;
   import flash.display.Sprite;
   import flash.display.Stage;
   import flash.events.Event;
   import flash.events.IEventDispatcher;
   import flash.events.KeyboardEvent;
   import flash.events.MouseEvent;
   import flash.filters.GlowFilter;
   import flash.geom.Matrix;
   import flash.geom.Point;
   import flash.geom.Rectangle;
   import flash.net.SharedObject;
   import flash.text.TextField;
   import flash.text.TextFormat;
   import flash.text.TextFormatAlign;
   import flash.ui.Keyboard;
   import flash.utils.getDefinitionByName;

   public final class DailyAssistant extends Sprite
   {
      private static const ENTRY_NAME:String = "narutoosDailyAssistant";
      private static const WANTED_DIALOG:String = "WantedNpcDialog";
      private static const ENTRY_WIDTH:Number = 56;
      private static const EXPEDITION_DIALOG:String = "ExpeditionaryMainView";
      private static const PANEL_WIDTH:Number = 320;
      private static const PANEL_HEIGHT:Number = 460;
      private static const STOP_WIDTH:Number = 160;
      private static const STOP_HEIGHT:Number = 28;

      private var controls:Sprite;
      private var dialog:DisplayObjectContainer;
      private var mapDialog:DisplayObjectContainer;
      private var quizDialog:DisplayObjectContainer;
      private var runtimeHost:DisplayObjectContainer;
      private var boxEvents:IEventDispatcher;
      private var modalLayer:Sprite;
      private var modalBackdrop:Sprite;
      private var modalOpen:Boolean;
      private var modalStage:Stage;
      private var panel:Sprite;
      private static const LABELS:Object = {autoModeAfterDaily:"完成后进入托管", hidePlayers:"隐藏队友以外的玩家", battleSettings:"下场战斗开启自动＋2倍速", autoMode:"游戏托管"};
      private var choices:Object = {};
      private var selected:Object = {autoModeAfterDaily:true};
      private var choiceStore:SharedObject;
      private var choiceRole:String;
      // Each loaded game owns its progress, including when the HUD rebuilds the entry.
      private static var progressByRole:Object = {};
      private var windowProgress:Object = {strongDone:false, teamDungeonCount:0};
      private var background:Sprite;
      private var execute:Sprite;
      private var executeLabel:TextField;
      private var runtimeControls:Sprite;
      private var runtimeStage:Stage;
      private var stop:Sprite;
      private var status:TextField;
      private var resultText:String = "";
      private var stopLabel:TextField;
      private var queue:DailyQueue;
      private var autoBattle:NativeAutoBattle;
      private var visibilityNote:String = "";
      private var grocerySettings:GrocerySettings;
      private var groceryChoices:Object = {};
      private var groceryOrders:Array;
      private var standaloneBattle:Boolean;
      private var taskDefinitions:Array;

      include "DailyEntryArt.asinc";

      public static function install(owner:Sprite, slotX:Number, slotY:Number):void
      {
         installEntry(owner, slotX, slotY, false);
      }

      public static function installBR(owner:Sprite, slotX:Number, slotY:Number):void
      {
         installEntry(owner, slotX, slotY, true);
      }

      private static function installEntry(owner:Sprite, slotX:Number, slotY:Number, brazil:Boolean):void
      {
         DailyRegion.isBR = brazil;
         var assistant:DailyAssistant = owner.getChildByName(ENTRY_NAME) as DailyAssistant;
         if(assistant == null)
         {
            assistant = new DailyAssistant();
            assistant.name = ENTRY_NAME;
            owner.addChild(assistant);
         }
         assistant.visible = true;
         assistant.x = slotX;
         assistant.y = slotY;
         assistant.refreshHost();
         if(assistant.modalOpen)
         {
            assistant.positionModal();
         }
      }

      public static function hide(owner:Sprite):void
      {
         var assistant:DailyAssistant = owner.getChildByName(ENTRY_NAME) as DailyAssistant;
         if(assistant != null)
         {
            // showMenu calls hideMenu before each layout refresh.
            assistant.visible = false;
            if(assistant.mapDialog == null)
            {
               assistant.controls.visible = false;
            }
         }
      }

      public function DailyAssistant()
      {
         mouseEnabled = false;
         controls = new Sprite();
         controls.name = "dailyControls";
         controls.mouseEnabled = false;
         addChild(controls);

         var entry:Sprite = newControl("日常助手", togglePanel);
         entry.name = "entry";
         decorateEntry(entry);
         controls.addChild(entry);

         modalLayer = new Sprite();
         modalLayer.name = "dailyAssistantModal";
         modalLayer.mouseEnabled = false;
         modalBackdrop = new Sprite();
         modalBackdrop.name = "backdrop";
         modalBackdrop.addEventListener(MouseEvent.CLICK, blockBackground);
         modalLayer.addChild(modalBackdrop);

         panel = new Sprite();
         panel.name = "panel";
         background = nativeSkin("Background_11");
         if(background == null)
         {
            background = new Sprite();
            drawBackground(background.graphics, PANEL_WIDTH, PANEL_HEIGHT, 0x28211C, 0xAF8348);
         }
         background.width = PANEL_WIDTH;
         background.height = PANEL_HEIGHT;
         panel.addChild(background);

         var title:Sprite = nativeSkin("TitleBar_2");
         if(title != null)
         {
            // Use the same Chinese-capable device font as the activity caption.
            var heading:TextField = Object(title).textField as TextField;
            heading.embedFonts = false;
            heading.defaultTextFormat = new TextFormat("_sans", 15, 0xFFF0C6, true);
            Object(title).label = "日常助手";
            title.x = 7;
            title.y = 7;
            title.width = PANEL_WIDTH - 14;
            panel.addChild(title);
         }
         else
         {
            panel.addChild(makeLabel("日常助手", 36, 9, PANEL_WIDTH - 72, 26, 16, TextFormatAlign.CENTER));
         }

         var close:Sprite = newControl("关闭日常助手", togglePanel, nativeSkin("ButtonClose"));
         close.name = "close";
         close.x = PANEL_WIDTH - 33;
         close.y = 8;
         if("enabled" in close)
         {
            close.width = close.height = 26;
         }
         else
         {
            close.addChild(makeLabel("×", 0, 0, 24, 24, 17, TextFormatAlign.CENTER));
         }
         panel.addChild(close);

         var assistant:DailyAssistant = this;
         taskDefinitions = [
            {id:"wanted", label:"通缉任务", battle:true, create:function(done:Function, progress:Function):IDailyTask
            {
               return new WantedRun(assistant, done, progress);
            }},
            {id:"quiz", label:"忍者测验", battle:false, create:function(done:Function, progress:Function):IDailyTask
            {
               return new QuizRun(assistant, done, progress);
            }},
            {id:"expedition", label:"生存演习", battle:true, create:function(done:Function, progress:Function):IDailyTask
            {
               return new ExpeditionRun(assistant, done, progress,
                  DailyRegion.isBR && selected.battleSettings ? prepareNextBattle : null);
            }},
            {id:"strong", label:"强者降临", battle:true, create:function(done:Function, progress:Function):IDailyTask
            {
               return new StrongRun(assistant, done, progress, windowProgress);
            }},
            {id:"teamDungeon", label:"组队副本", battle:true, create:function(done:Function, progress:Function):IDailyTask
            {
               return new TeamDungeonRun(assistant, done, progress, windowProgress);
            }},
            {id:"escort", label:"SS 级押镖", battle:true, create:function(done:Function, progress:Function):IDailyTask
            {
               return new EscortTask(assistant, done, progress, 5, windowProgress, Boolean(selected.escortS));
            }},
            {id:"escortS", label:"S 级押镖（1 次）", battle:true, create:function(done:Function, progress:Function):IDailyTask
            {
               return new EscortTask(assistant, done, progress, 4, windowProgress);
            }},
            {id:"grocery", label:"杂货屋兑换", battle:false, create:function(done:Function, progress:Function):IDailyTask
            {
               return new GroceryTask(assistant, done, progress, groceryOrders, windowProgress);
            }}
         ];
         if(DailyRegion.isBR)
         {
            taskDefinitions.push({id:"infiniteIllusion", label:"无限幻象扫荡", battle:false, create:function(done:Function, progress:Function):IDailyTask
            {
               return new InfiniteIllusionSweep(assistant, done, progress, Boolean(selected.autoModeAfterDaily));
            }});
         }
         var options:Array = optionIds();
         for(var index:int = 0; index < options.length; index++)
         {
            var id:String = options[index];
            choices[id] = makeChoice(id, taskLabel(id), toggleChoice(id), 43 + index * 25 + (index >= taskDefinitions.length ? 21 : 0));
            panel.addChild(choices[id]);
         }

         var settingsButton:Sprite = actionButton("设置", openGrocerySettings, 66);
         settingsButton.name = "grocerySettings";
         settingsButton.x = 202;
         settingsButton.y = choices.grocery.y;
         panel.addChild(settingsButton);
         panel.addChild(makeLabel("执行选项", 18, 43 + taskDefinitions.length * 25, 160, 20, 12));

         execute = newControl("执行", startRun, nativeSkin("ButtonNormalBlue"));
         execute.name = "execute";
         execute.x = (PANEL_WIDTH - 100) / 2;
         execute.y = PANEL_HEIGHT - 42;
         if("label" in execute)
         {
            execute.width = 100;
            execute.height = 32;
         }
         else
         {
            drawBackground(execute.graphics, 100, 32, 0x286A94, 0xCEAC64);
            executeLabel = makeLabel("", 0, 5, 100, 23, 14, TextFormatAlign.CENTER);
            execute.addChild(executeLabel);
         }
         panel.addChild(execute);

         status = makeLabel("", 20, 43 + options.length * 25 + 23, PANEL_WIDTH - 40, 28, 13);
         status.name = "status";
         status.multiline = true;
         status.wordWrap = true;
         status.autoSize = "left";
         panel.addChild(status);
         modalLayer.addChild(panel);
         addChild(modalLayer);
         modalLayer.visible = false;

         runtimeControls = new Sprite();
         runtimeControls.name = "narutoosDailyRuntimeControls";
         runtimeControls.mouseEnabled = false;
         stop = newControl("停止本次日常任务", stopRun, nativeSkin("ButtonNormalBlue"));
         stop.name = "stop";
         if("label" in stop)
         {
            Object(stop).label = "";
            stop.width = STOP_WIDTH;
            stop.height = STOP_HEIGHT;
         }
         else
         {
            drawBackground(stop.graphics, STOP_WIDTH, STOP_HEIGHT, 0x65352D, 0xCEAC64);
         }
         stopLabel = makeLabel("停止", 0, 3, STOP_WIDTH, 22, 13, TextFormatAlign.CENTER);
         stop.addChild(stopLabel);
         runtimeControls.addChild(stop);
         addChild(runtimeControls);
         runtimeControls.visible = false;

         autoBattle = new NativeAutoBattle(this);
         queue = new DailyQueue(createTask, showProgress, runFinished);
         updateControls();
         addEventListener(Event.ADDED_TO_STAGE, addedToStage);
         addEventListener(Event.REMOVED_FROM_STAGE, removedFromStage);
      }

      private function addedToStage(event:Event):void
      {
         var boxManager:Object;
         try
         {
            boxManager = getDefinitionByName("com.tencent.morefun.naruto.plugin.ui.box.BoxManager");
         }
         catch(error:ReferenceError)
         {
            return;
         }
         boxEvents = boxManager.dispathcer as IEventDispatcher;
         boxEvents.addEventListener("boxShowed", boxShowed);
         boxEvents.addEventListener("boxHide", boxHidden);
         attachToSupportedDialog(boxManager.getBoxByName(WANTED_DIALOG));
         attachToSupportedDialog(boxManager.getBoxByName(EXPEDITION_DIALOG));
         attachToSupportedDialog(QuizBox.find(boxManager, stage));
      }

      private function boxShowed(event:Event):void
      {
         var box:Object = Object(event).box;
         if(QuizBox.matches(box) && queue.activeId == "quiz")
         {
            trackQuiz(box as DisplayObjectContainer);
            refreshHost();
            return;
         }
         attachToSupportedDialog(box);
      }

      private function attachToSupportedDialog(candidate:Object):void
      {
         var box:DisplayObjectContainer = candidate as DisplayObjectContainer;
         if(box == null || (box.name != WANTED_DIALOG && box.name != EXPEDITION_DIALOG && !QuizBox.matches(box)) || box.stage !== stage ||
            !candidate.isShow || !candidate.isShowing)
         {
            return;
         }
         if(QuizBox.matches(box))
         {
            trackQuiz(box);
            if(!queue.running && mapDialog == null) attachToHudDialog(box);
            else refreshHost();
            return;
         }
         if(box.name == EXPEDITION_DIALOG)
         {
            attachToExpeditionMap(box);
            return;
         }
         if(mapDialog != null) return;
         attachToHudDialog(box);
      }

      private function attachToHudDialog(box:DisplayObjectContainer):void
      {
         if(dialog != null && dialog !== box) returnToHud();
         dialog = box;
         dialog.addEventListener("box#hide", nativeDialogClosing);
         dialog.addChild(controls);
         positionControls();
         addEventListener(Event.ENTER_FRAME, syncDialogControls);
      }

      private function attachToExpeditionMap(box:DisplayObjectContainer):void
      {
         if(dialog != null) returnToHud();
         if(modalOpen) closeSelectionWindow();
         if(mapDialog != null && mapDialog !== box)
         {
            mapDialog.removeEventListener("box#hide", nativeMapClosing);
            if(runtimeControls.parent === mapDialog) addChild(runtimeControls);
         }
         mapDialog = box;
         mapDialog.addEventListener("box#hide", nativeMapClosing);
         controls.visible = false;
         refreshRuntimeStop();
      }

      private function nativeDialogClosing(event:Event):void
      {
         if(event.target === dialog) returnToHud();
      }

      private function nativeMapClosing(event:Event):void
      {
         if(event.target !== mapDialog) return;
         detachMap();
      }

      private function detachMap():void
      {
         mapDialog.removeEventListener("box#hide", nativeMapClosing);
         mapDialog = null;
         refreshHost();
      }

      private function boxHidden(event:Event):void
      {
         var hidden:Object = Object(event).box;
         if(hidden === quizDialog && quizDialog != null) detachQuiz();
         if(dialog != null && Object(event).box === dialog)
         {
            returnToHud();
         }
         if(mapDialog != null && Object(event).box === mapDialog)
         {
            detachMap();
         }
      }

      private function trackQuiz(box:DisplayObjectContainer):void
      {
         if(quizDialog === box) return;
         if(quizDialog != null) quizDialog.removeEventListener("box#hide", nativeQuizClosing);
         quizDialog = box;
         if(box != null) box.addEventListener("box#hide", nativeQuizClosing);
      }

      private function nativeQuizClosing(event:Event):void
      {
         if(event.target === quizDialog) detachQuiz();
      }

      private function detachQuiz():void
      {
         quizDialog.removeEventListener("box#hide", nativeQuizClosing);
         quizDialog = null;
         refreshHost();
      }

      private function syncDialogControls(event:Event):void
      {
         if(dialog.stage !== stage || controls.parent !== dialog || !dialog.visible ||
            !Object(dialog).isShow)
         {
            returnToHud();
            return;
         }
         positionControls();
      }

      private function returnToHud():void
      {
         if(dialog == null)
         {
            return;
         }
         removeEventListener(Event.ENTER_FRAME, syncDialogControls);
         dialog.removeEventListener("box#hide", nativeDialogClosing);
         dialog = null;
         addChild(controls);
         refreshHost();
      }

      private function positionControls():void
      {
         if(dialog == null)
         {
            controls.x = controls.y = 0;
            controls.visible = visible && mapDialog == null;
            return;
         }

         var anchor:Point = dialog.globalToLocal(localToGlobal(new Point()));
         if(controls.x != anchor.x || controls.y != anchor.y)
         {
            controls.x = anchor.x;
            controls.y = anchor.y;
         }
         for(var ancestor:DisplayObject = this; ancestor != null && ancestor !== stage; ancestor = ancestor.parent)
         {
            if(!ancestor.visible)
            {
               controls.visible = false;
               return;
            }
         }
         controls.visible = !queue.running && !standaloneBattle;
      }

      private function togglePanel():void
      {
         if(modalOpen) closeSelectionWindow();
         else openSelectionWindow();
      }

      private function openSelectionWindow():void
      {
         if(stage == null || mapDialog != null || queue.running || standaloneBattle) return;
         if(modalLayer.parent !== this) modalLayer.parent.removeChild(modalLayer);
         stage.addChild(modalLayer);
         modalOpen = true;
         modalLayer.visible = true;
         modalStage = stage;
         restoreSelections();
         status.text = resultText;
         modalStage.addEventListener(Event.RESIZE, stageResized);
         updateControls();
         positionModal();
      }

      private function openGrocerySettings():void
      {
         if(!modalOpen || grocerySettings != null || queue.running) return;
         grocerySettings = new GrocerySettings(groceryChoices, closeGrocerySettings);
         modalLayer.addChild(grocerySettings);
         panel.visible = false;
         positionModal();
      }

      private function closeGrocerySettings(saved:Object = null):void
      {
         if(saved != null)
         {
            groceryChoices = saved;
            var persisted:Boolean = false;
            if(choiceStore != null)
            {
               try
               {
                  choiceStore.data.groceryChoices = saved;
                  persisted = choiceStore.flush() == "flushed";
               }
               catch(error:Error) {}
            }
            resultText = persisted ? "已保存杂货屋兑换设置。" : "兑换设置在当前窗口生效。";
            status.text = resultText;
         }
         if(grocerySettings != null)
         {
            modalLayer.removeChild(grocerySettings);
            grocerySettings = null;
         }
         panel.visible = true;
         updateControls();
         positionModal();
      }

      private function closeSelectionWindow():void
      {
         if(grocerySettings != null) closeGrocerySettings();
         if(modalStage != null)
         {
            modalStage.removeEventListener(Event.RESIZE, stageResized);
            modalStage = null;
         }
         modalOpen = false;
         modalLayer.visible = false;
         if(modalLayer.parent != this)
         {
            modalLayer.parent.removeChild(modalLayer);
            addChild(modalLayer);
         }
      }

      private function positionModal():void
      {
         if(modalStage == null || modalLayer.parent !== modalStage) return;
         modalBackdrop.graphics.clear();
         modalBackdrop.graphics.beginFill(0x000000, 0.58);
         modalBackdrop.graphics.drawRect(0, 0, modalStage.stageWidth, modalStage.stageHeight);
         modalBackdrop.graphics.endFill();
         modalBackdrop.x = modalBackdrop.y = 0;
         var page:Sprite = grocerySettings || panel;
         var w:Number = grocerySettings ? GrocerySettings.WIDTH : PANEL_WIDTH;
         var h:Number = grocerySettings ? GrocerySettings.HEIGHT : background.height;
         var scale:Number = Math.min(1, modalStage.stageWidth / w, modalStage.stageHeight / h);
         page.scaleX = page.scaleY = scale;
         page.x = Math.round((modalStage.stageWidth - w * scale) / 2);
         page.y = Math.round((modalStage.stageHeight - h * scale) / 2);
      }

      private function stageResized(event:Event):void
      {
         positionModal();
         if(runtimeHost != null) positionStopButton();
      }

      private function blockBackground(event:MouseEvent):void
      {
         event.stopImmediatePropagation();
         event.preventDefault();
      }

      private function refreshHost():void
      {
         if(mapDialog != null || queue.running || standaloneBattle)
         {
            controls.visible = false;
            refreshRuntimeStop();
            return;
         }
         if(dialog != null)
         {
            positionControls();
         }
         else
         {
            if(controls.parent !== this) addChild(controls);
            controls.x = controls.y = 0;
            controls.visible = visible;
         }
         refreshRuntimeStop();
      }

      private function refreshRuntimeStop():void
      {
         var target:DisplayObjectContainer;
         if((queue.running || standaloneBattle) && stage != null)
         {
            target = stage;
            if(queue.activeId == "expedition" && mapDialog != null) target = mapDialog;
            if(queue.activeId == "quiz" && quizDialog != null) target = quizDialog;
         }
         if(target == null)
         {
            if(runtimeStage != null)
            {
               runtimeStage.removeEventListener(Event.RESIZE, stageResized);
               runtimeStage = null;
            }
            runtimeControls.visible = false;
            runtimeHost = null;
            if(runtimeControls.parent !== this) addChild(runtimeControls);
            return;
         }
         if(runtimeStage !== stage)
         {
            if(runtimeStage != null) runtimeStage.removeEventListener(Event.RESIZE, stageResized);
            runtimeStage = stage;
            runtimeStage.addEventListener(Event.RESIZE, stageResized);
         }
         if(runtimeHost !== target || runtimeControls.parent !== target)
         {
            if(runtimeControls.parent != null) runtimeControls.parent.removeChild(runtimeControls);
            target.addChild(runtimeControls);
         }
         runtimeHost = target;
         runtimeControls.visible = true;
         positionStopButton();
      }

      private function positionStopButton():void
      {
         if(runtimeHost == null || stage == null) return;
         var stageBounds:Rectangle = new Rectangle(0, 0, stage.stageWidth, stage.stageHeight);
         var safeBounds:Rectangle;
         try
         {
            var layout:Object = getDefinitionByName("com.tencent.morefun.naruto.plugin.ui.layer.LayoutManager");
            safeBounds = new Rectangle(Number(layout.stageOffsetX), Number(layout.stageOffsetY),
               Number(layout.stageWidth), Number(layout.stageHeight)).intersection(stageBounds);
         }
         catch(error:Error)
         {
            var hostContent:DisplayObjectContainer = runtimeHost === mapDialog || runtimeHost === quizDialog ?
               Object(runtimeHost).content as DisplayObjectContainer : null;
            safeBounds = (hostContent == null ? stageBounds : hostContent.getBounds(stage)).intersection(stageBounds);
         }
         if(safeBounds.width < STOP_WIDTH + 12 || safeBounds.height < STOP_HEIGHT + 12)
         {
            runtimeControls.visible = false;
            return;
         }
         if(safeBounds.width > 1400)
         {
            safeBounds.x += (safeBounds.width - 1400) / 2;
            safeBounds.width = 1400;
         }
         if(safeBounds.height > 900)
         {
            safeBounds.y += (safeBounds.height - 900) / 2;
            safeBounds.height = 900;
         }
         var candidates:Array = [];
         var inset:Number = 10;
         var minX:Number = safeBounds.left + inset;
         var maxX:Number = safeBounds.right - STOP_WIDTH - inset;
         var minY:Number = safeBounds.top + inset;
         var maxY:Number = safeBounds.bottom - STOP_HEIGHT - inset;
         var scan:Number;
         for(scan = minX; scan <= maxX; scan += 18) candidates.push(new Point(scan, maxY));
         for(scan = maxX; scan >= minX; scan -= 18) candidates.push(new Point(scan, minY));
         for(scan = minY; scan <= maxY; scan += 18) candidates.push(new Point(minX, scan));
         for(scan = maxY; scan >= minY; scan -= 18) candidates.push(new Point(maxX, scan));
         var obstacles:Array = ["gk0", "gk1", "gk2", "gk3", "gk4", "leftAreaMC", "rightareaMC",
                                "bottomMC", "action_fightStart", "action_fullscore"];
         var blockedBounds:Array = [];
         if(runtimeHost === mapDialog)
         {
            var mapContent:DisplayObjectContainer = Object(mapDialog).content as DisplayObjectContainer;
            for each(var mapName:String in obstacles)
            {
               var mapObstacle:DisplayObject = mapContent == null ? null : mapContent.getChildByName(mapName);
               if(mapObstacle != null && mapObstacle.visible) blockedBounds.push(mapObstacle.getBounds(stage));
            }
         }
         else if(QuizBox.matches(runtimeHost))
         {
            collectQuizInteractiveBounds(runtimeHost, stage, blockedBounds);
         }
         var blocked:Boolean;
         for each(var stagePoint:Point in candidates)
         {
            var candidateBounds:Rectangle = new Rectangle(stagePoint.x, stagePoint.y, STOP_WIDTH, STOP_HEIGHT);
            blocked = false;
            for each(var blockedBoundsItem:Rectangle in blockedBounds)
            {
               if(candidateBounds.intersects(blockedBoundsItem))
               {
                  blocked = true;
                  break;
               }
            }
            if(!blocked)
            {
               var parentPoint:Point = runtimeHost.globalToLocal(stage.localToGlobal(stagePoint));
               runtimeControls.x = parentPoint.x;
               runtimeControls.y = parentPoint.y;
               runtimeControls.visible = true;
               return;
            }
         }
         runtimeControls.visible = false;
      }

      private static function collectQuizInteractiveBounds(box:DisplayObjectContainer, coordinateSpace:DisplayObject,
                                                            results:Array):void
      {
         var view:Object = Object(box).content;
         addVisibleBounds(view.closeButton as DisplayObject, coordinateSpace, results);
         var question:Object = view.questionArea;
         if(question != null && question.visible)
         {
            addVisibleBounds(question.commitButton as DisplayObject, coordinateSpace, results);
            addVisibleBounds(question.answer0 as DisplayObject, coordinateSpace, results);
            addVisibleBounds(question.answer1 as DisplayObject, coordinateSpace, results);
            addVisibleBounds(question.answer2 as DisplayObject, coordinateSpace, results);
            addVisibleBounds(question.answer3 as DisplayObject, coordinateSpace, results);
         }
         var reward:Object = view.rewardArea;
         if(reward != null && reward.visible)
            addVisibleBounds(reward.rewardButton as DisplayObject, coordinateSpace, results);
      }

      private static function addVisibleBounds(target:DisplayObject, coordinateSpace:DisplayObject, results:Array):void
      {
         var interactive:InteractiveObject = target as InteractiveObject;
         if(interactive != null && interactive.visible && interactive.mouseEnabled &&
            (! ("enabled" in target) || Object(target).enabled))
            results.push(target.getBounds(coordinateSpace));
      }

      private function restoreSelections():void
      {
         var role:String;
         try
         {
            var player:Object = getDefinitionByName("base.ApplicationData").singleton.selfInfo;
            if(player && uint(player.uin) > 0 && int(player.svrId) > 0 && player.role != null)
               role = (DailyRegion.isBR ? "br_" : "") + uint(player.uin) + "_" + int(player.svrId) + "_" + int(player.role);
         }
         catch(unavailable:Error) {}
         if(role == choiceRole) return;
         choiceRole = role;
         choiceStore = null;
         selected = {autoModeAfterDaily:true};
         groceryChoices = {};
         resultText = "";
         if(role == null)
         {
            windowProgress = {strongDone:false, teamDungeonCount:0};
            return;
         }
         if(!progressByRole.hasOwnProperty(role))
            progressByRole[role] = {strongDone:false, teamDungeonCount:0};
         windowProgress = progressByRole[role];
         try
         {
            choiceStore = SharedObject.getLocal("narutoos_daily_choices_" + role, "/");
            groceryChoices = choiceStore.data.groceryChoices || {};
            for each(var id:String in optionIds())
               selected[id] = id == "autoModeAfterDaily" ? choiceStore.data[id] !== false : choiceStore.data[id] === true;
         }
         catch(storageError:Error) { choiceStore = null; }
      }

      private function toggleChoice(id:String):Function
      {
         return function():void
         {
            if(queue.running || standaloneBattle) return;
            selected[id] = !selected[id];
            if(choiceStore != null)
            {
               try
               {
                  choiceStore.data[id] = selected[id];
                  choiceStore.flush();
               }
               catch(storageError:Error) {} // The current window still remembers the choice.
            }
            updateControls();
         };
      }

      private function startRun():void
      {
         if(queue.running || standaloneBattle) return;
         groceryOrders = selected.grocery ? GrocerySettings.orders(groceryChoices) : [];
         var groceryEmpty:Boolean = Boolean(selected.grocery) && groceryOrders.length == 0;
         visibilityNote = selected.hidePlayers ? NativePlayerVisibility.ensureHidden(this) : "";
         if(groceryEmpty)
            visibilityNote += (visibilityNote ? "\n" : "") + "杂货屋兑换清单为空，请在「设置」勾选商品。";
         var ids:Array = [];
         var battleTask:Boolean = false;
         for each(var definition:Object in taskDefinitions)
         {
            if(!selected[definition.id]) continue;
            if(definition.id == "grocery" && groceryEmpty) continue;
            ids.push(definition.id);
            if(definition.battle) battleTask = true;
         }
         if(ids.length == 0 && !selected.hidePlayers && !selected.battleSettings && !groceryEmpty) return;
         standaloneBattle = ids.length == 0 && selected.battleSettings;
         if(standaloneBattle || (DailyRegion.isBR && selected.battleSettings) ||
            (!windowProgress.battleReady && (battleTask || selected.battleSettings)))
         {
            if(standaloneBattle)
            {
               closeSelectionWindow();
               showProgress("等待下场战斗");
            }
            prepareNextBattle();
         }
         if(ids.length == 0)
         {
            if(standaloneBattle || selected.battleSettings) return;
            resultText = visibilityNote || "已隐藏队友以外的玩家。";
            status.text = resultText;
            updateControls();
            positionModal();
            return;
         }
         resultText = "";
         closeSelectionWindow();
         if(selected.autoModeAfterDaily) ids.push("autoMode");
         queue.start(ids);
      }

      private function prepareNextBattle():void
      {
         autoBattle.startNext(battleConfigured);
      }

      private function battleConfigured():void
      {
         windowProgress.battleReady = true;
         if(standaloneBattle)
         {
            standaloneBattle = false;
            runFinished("自动战斗与 2 倍速已开启。");
         }
      }

      private function createTask(id:String, done:Function, progress:Function, hasNext:Boolean):IDailyTask
      {
         if(id == "autoMode")
         {
            autoBattle.cancel();
            return new NativeAutoMode(this, done);
         }
         var definition:Object = taskDefinition(id);
         if(definition != null) return definition.create(done, progress) as IDailyTask;
         throw new ArgumentError("未知日常任务 " + id);
      }

      private function taskDefinition(id:String):Object
      {
         for each(var definition:Object in taskDefinitions)
            if(definition.id == id) return definition;
         return null;
      }

      private function taskLabel(id:String):String
      {
         var definition:Object = taskDefinition(id);
         return definition != null ? definition.label : LABELS[id];
      }

      private function optionIds():Array
      {
         var ids:Array = [];
         for each(var definition:Object in taskDefinitions) ids.push(definition.id);
         return ids.concat(["autoModeAfterDaily", "hidePlayers", "battleSettings"]);
      }

      private function showProgress(message:String):void
      {
         var label:String = message || taskLabel(queue.activeId);
         stopLabel.text = "停止 · " + label;
         stop.accessibilityProperties.name = stopLabel.text;
         refreshHost();
      }

      private function runFinished(message:String):void
      {
         autoBattle.cancel();
         resultText = visibilityNote ? visibilityNote + "\n" + message : message;
         status.text = resultText;
         if(quizDialog != null && quizDialog.stage != null && mapDialog == null && Object(quizDialog).isShow)
            attachToHudDialog(quizDialog);
         refreshHost();
         updateControls();
      }

      private function stopRun():void
      {
         autoBattle.cancel();
         if(standaloneBattle)
         {
            standaloneBattle = false;
            runFinished("已停止等待战斗设置。");
         }
         queue.cancel();
      }

      private function removedFromStage(event:Event):void
      {
         if(boxEvents != null)
         {
            boxEvents.removeEventListener("boxShowed", boxShowed);
            boxEvents.removeEventListener("boxHide", boxHidden);
            boxEvents = null;
         }
         autoBattle.cancel();
         standaloneBattle = false;
         queue.cancel();
         closeSelectionWindow();
         if(dialog != null)
         {
            dialog.removeEventListener("box#hide", nativeDialogClosing);
            removeEventListener(Event.ENTER_FRAME, syncDialogControls);
            dialog = null;
         }
         if(controls.parent !== this) addChild(controls);
         controls.visible = false;
         if(mapDialog != null)
         {
            mapDialog.removeEventListener("box#hide", nativeMapClosing);
            mapDialog = null;
         }
         if(quizDialog != null)
         {
            quizDialog.removeEventListener("box#hide", nativeQuizClosing);
            quizDialog = null;
         }
         if(runtimeStage != null)
         {
            runtimeStage.removeEventListener(Event.RESIZE, stageResized);
            runtimeStage = null;
         }
         if(runtimeControls.parent !== this) addChild(runtimeControls);
         runtimeControls.visible = false;
         runtimeHost = null;
      }

      private function updateControls():void
      {
         var busy:Boolean = queue.running || standaloneBattle;
         var canRun:Boolean = false;
         for each(var id:String in optionIds())
         {
            updateChoice(choices[id], Boolean(selected[id]), busy);
            if(id != "autoModeAfterDaily" && selected[id] && !busy) canRun = true;
         }
         var action:String = busy ? "执行中…" : "执行";
         execute.accessibilityProperties.name = action;
         execute.buttonMode = canRun;
         execute.tabEnabled = canRun;
         if(executeLabel == null)
         {
            Object(execute).label = action;
            Object(execute).enabled = canRun;
         }
         else
         {
            executeLabel.text = action;
            execute.alpha = canRun ? 1 : 0.55;
         }

         status.visible = modalOpen && resultText.length > 0;
         background.height = Math.max(PANEL_HEIGHT, status.y + status.height + 54);
         execute.y = background.height - 42;
         refreshRuntimeStop();
      }

      internal static function updateChoice(control:Sprite, selected:Boolean, busy:Boolean):void
      {
         control.accessibilityProperties.description = selected ? "已勾选" : "未勾选";
         control.buttonMode = !busy;
         control.tabEnabled = !busy;
         control.alpha = busy ? 0.65 : 1;
         var checkbox:Sprite = control.getChildByName("checkbox") as Sprite;
         if(checkbox != null)
         {
            Object(checkbox).selected = selected;
         }
         else
         {
            var marker:Sprite = control.getChildByName("marker") as Sprite;
            marker.graphics.clear();
            drawBackground(marker.graphics, 16, 16, 0x3D2D22, 0xB28A52);
            if(selected)
            {
               marker.graphics.lineStyle(2, 0xFFE0A7);
               marker.graphics.moveTo(3, 8);
               marker.graphics.lineTo(7, 12);
               marker.graphics.lineTo(13, 4);
            }
         }
      }

      internal static function makeChoice(name:String, label:String, activate:Function, y:Number):Sprite
      {
         var control:Sprite = newControl(label, activate);
         control.name = name;
         control.x = 18;
         control.y = y;
         control.graphics.beginFill(0, 0);
         control.graphics.drawRect(0, 0, 180, 26);
         control.graphics.endFill();
         var checkbox:Sprite = nativeSkin("CheckBox_1");
         if(checkbox != null)
         {
            checkbox.name = "checkbox";
            if(DailyRegion.isBR && "textField" in checkbox)
            {
               // The Portuguese skin otherwise measures the label using its embedded Latin glyphs.
               var caption:TextField = Object(checkbox).textField as TextField;
               if(caption != null) caption.embedFonts = false;
            }
            Object(checkbox).label = label;
            checkbox.tabEnabled = false;
            control.addChild(checkbox);
         }
         else
         {
            var marker:Sprite = new Sprite();
            marker.name = "marker";
            marker.y = 5;
            control.addChild(marker);
            var choiceLabel:TextField = makeLabel(label, 24, 2, 156, 24, 14);
            choiceLabel.width = Math.max(choiceLabel.width, Math.ceil(choiceLabel.textWidth) + 4);
            control.addChild(choiceLabel);
         }
         return control;
      }

      internal static function nativeSkin(name:String):Sprite
      {
         var component:Sprite;
         try
         {
            var skin:Class = getDefinitionByName("naruto.component.controls." + name) as Class;
            component = new skin() as Sprite;
         }
         catch(error:Error)
         {
            return null;
         }
         return component;
      }

      internal static function actionButton(label:String, activate:Function, w:Number):Sprite
      {
         var button:Sprite = newControl(label, activate, nativeSkin("ButtonNormalBlue"));
         if("label" in button)
         {
            Object(button).label = label;
            button.width = w;
            button.height = 25;
         }
         else
         {
            drawBackground(button.graphics, w, 25, 0x286A94, 0xCEAC64);
            button.addChild(makeLabel(label, 0, 2, w, 21, 13, TextFormatAlign.CENTER));
         }
         return button;
      }

      internal static function newControl(label:String, activate:Function, control:Sprite = null):Sprite
      {
         if(control == null)
         {
            control = new Sprite();
         }
         control.mouseChildren = false;
         control.buttonMode = true;
         control.useHandCursor = true;
         control.tabEnabled = true;
         control.accessibilityProperties = new AccessibilityProperties();
         control.accessibilityProperties.name = label;
         control.addEventListener(MouseEvent.CLICK, function(event:MouseEvent):void
         {
            event.stopPropagation();
            activate();
         });
         control.addEventListener(KeyboardEvent.KEY_DOWN, function(event:KeyboardEvent):void
         {
            if(event.keyCode == Keyboard.SPACE || event.keyCode == Keyboard.ENTER)
            {
               event.stopPropagation();
               activate();
            }
         });
         return control;
      }

      internal static function makeLabel(text:String, x:Number, y:Number, width:Number, height:Number,
                                        size:Number, align:String = "left"):TextField
      {
         var label:TextField = new TextField();
         label.defaultTextFormat = new TextFormat("_sans", size, 0xF6E1C4, false, false, false, null, null, align);
         label.text = text;
         label.x = x;
         label.y = y;
         label.width = width;
         label.height = height;
         label.mouseEnabled = false;
         label.selectable = false;
         return label;
      }

      internal static function drawBackground(g:Graphics, width:Number, height:Number, fill:uint, border:uint):void
      {
         g.lineStyle(1, border);
         g.beginFill(fill);
         g.drawRoundRect(0, 0, width, height, 6, 6);
         g.endFill();
      }
   }
}
