package narutoos.daily
{
    import flash.display.DisplayObject;
    import flash.display.DisplayObjectContainer;
    import flash.display.InteractiveObject;
    import flash.events.Event;
    import flash.events.IEventDispatcher;
    import flash.events.MouseEvent;
    import flash.events.TimerEvent;
    import flash.text.TextField;
    import flash.utils.Timer;
    import flash.utils.getDefinitionByName;
    import flash.utils.getQualifiedClassName;

    public final class WantedRun implements IDailyTask
    {
        private static const NPC_BOX:String = "WantedNpcDialog";
        private static const TASK_NPC:String = "com.tencent.morefun.naruto.plugin.npc.views::TaskNpcDialog";
        private static const MENU_ROW:String = "com.tencent.morefun.naruto.plugin.npc.views::TaskNpcDialogMenuRenderer";
        private static const WANTED_NPC_LIST_ID:int = 26900623;
        private static const START_COMMAND:String = "ai.commands::StartAICommand";
        private static const TEXT_COMMAND:String = "ui.command::ShowTextBoxCommand";
        private static const TEXT_BOX:String = "com.tencent.morefun.naruto.plugin.RSModel.modules.popup.system::TextBox";
        private static const SOLO_PROMPT:String = "你现在为单人状态，继续进行通缉任务将无法获得双倍经验奖励，是否继续本操作？";
        private static const BR_SOLO_PROMPT:String = "Você está solo agora, caso realize Missões de Captura não receberá prêmios em dobro. Deseja prosseguir?";
        private static const NAVIGATION_TIMEOUT:int = 30000;
        private static const START_TIMEOUT:int = 8000;
        private static const PROMPT_SETTLE_MS:int = 1200;
        private static const MONITOR_INTERVAL:int = 1000;
        private static const MONITOR_TIMEOUT:int = 900000;
        private static const TERMINAL_SETTLE_MS:int = 2500;
        private static const AI_ABORT_BOX:String = "WantedAIAbortTextBox";
        private static const AI_TEAM_ABORT_TEXT:String = "由于你的小队人数变成了1，自动通缉任务结束，召集小伙伴再来挑战吧！";
        private static const AI_BATTLE_FAIL_TEXT:String = "很遗憾，由于你战斗失败，自动通缉任务结束，请调整好阵容后再来挑战吧！";
        private static const BR_AI_TEAM_ABORT_TEXT:String = "Como só resta 1 pessoa em sua equipe a missão de captura foi encerrada, chame mais pessoas para prosseguir.";
        private static const BR_AI_BATTLE_FAIL_TEXT:String = "A Missão de Captura automática terminou devido a uma derrota, reformule sua formação e tente novamente.";
        private static const TASK_RECEIVE_ABLE:int = 0;

        private var origin:DisplayObject;
        private var onFinished:Function;
        private var boxEvents:IEventDispatcher;
        private var commandEvents:IEventDispatcher;
        private var timer:Timer;
        private var monitorTimer:Timer;
        private var uiRetryTimer:Timer;
        private var pendingUIBox:Object;
        private var pendingMenu:Boolean;
        private var pendingPromptUI:Boolean;
        private var wantedType:String;
        private var promptFlags:uint;
        private var navigation:Object;
        private var choseMenu:Boolean;
        private var clickingNpc:Boolean;
        private var clickedNpc:Boolean;
        private var startCommand:Object;
        private var startExecuting:Boolean;
        private var startCommandFinished:Boolean;
        private var promptCommand:Object;
        private var promptExecuting:Boolean;
        private var promptBox:Object;
        private var acceptedPrompt:Boolean;
        private var progress:Function;
        private var taskModel:Object;
        private var battleInfo:Object;
        private var boxManager:Object;
        private var monitoring:Boolean;
        private var terminalSince:int = -1;
        private var lastRemaining:int = -1;
        private var lastTaskState:int = -1;
        private var lastEvidenceAt:int;
        private var lastFightState:Boolean;
        private var lastFightStateKnown:Boolean;
        private var lastSceneId:Object;
        private var lastSceneToId:Object;
        private var lastBRPhase:String;
        private var lastBRMilestone:String;
        private var wantedEntryArrived:Boolean;
        private var blockedReason:String;
        private var closingNpcDialog:Object;
        private var ownsAI:Boolean;

        public function WantedRun(origin:DisplayObject, onFinished:Function, progress:Function = null)
        {
            this.origin = origin;
            this.onFinished = onFinished;
            this.progress = progress;
        }

        public function get running():Boolean
        {
            return timer != null || monitorTimer != null;
        }

        public function start():void
        {
            if (running || !origin.stage)
            {
                return;
            }

            timer = new Timer(DailyRegion.networkWait(NAVIGATION_TIMEOUT), 1);
            try
            {
                boxManager = getDefinitionByName("com.tencent.morefun.naruto.plugin.ui.box.BoxManager");
                var facade:Object = getDefinitionByName("com.tencent.morefun.framework.apf.core.facade.Facade");
                var aiType:Class = getDefinitionByName("ai.def.AITypeDef") as Class;
                var flags:Class = getDefinitionByName("def.BoxFlagDef") as Class;
                var modelDef:Class = getDefinitionByName("def.ModelDef") as Class;
                wantedType = aiType.WANTED;
                promptFlags = flags.YES | flags.NO;
                taskModel = facade.getInstance().model.retrieveModel(modelDef.TASK);
                battleInfo = facade.getInstance().model.retrieveModel(modelDef.BATTLE);
                boxEvents = boxManager.dispathcer as IEventDispatcher;
                commandEvents = facade.getInstance().commandManager as IEventDispatcher;
                timer.addEventListener(TimerEvent.TIMER_COMPLETE, onTimeout);
                origin.addEventListener(Event.REMOVED_FROM_STAGE, onRemoved);
                boxEvents.addEventListener("boxShow", onBoxShow);
                boxEvents.addEventListener("boxShowed", onBoxShowed);
                boxEvents.addEventListener("boxHided", onBoxHided);
                commandEvents.addEventListener("commandRequest", onCommandRequest, false, int.MAX_VALUE);
                commandEvents.addEventListener("commandExecute", onCommandExecute, false, int.MAX_VALUE);
                commandEvents.addEventListener("commandLoadError", onCommandStopped);
                commandEvents.addEventListener("commandCancel", onCommandStopped);
                timer.start();

                var existing:Object = boxManager.getBoxByName(NPC_BOX);
                var menu:Object = boxManager.getBoxByName("taskNpcDialog");
                var teamModel:Object = facade.getInstance().model.retrieveModel(modelDef.TEAM);
                if (teamModel == null || (teamModel.isJoined && teamModel.members == null))
                {
                    finish(DailyQueue.ABORT, "无法确认当前队伍状态，已停止通缉流程。");
                    return;
                }
                var joinedGroup:Boolean = teamModel != null && teamModel.isJoined &&
                    teamModel.members != null && teamModel.members.length > 1;
                if (teamModel != null && (teamModel.isMember || joinedGroup))
                {
                    var teamBlocked:String = teamModel.isMember ?
                        "当前处于队伍中，无法接取通缉任务。" : "当前仍在队伍中，不能带队执行通缉。请先退出队伍。";
                    if (existing != null)
                    {
                        if (!closeDialog(existing))
                        {
                            finish(DailyQueue.ABORT, "组队状态下无法关闭通缉窗口。");
                            return;
                        }
                        beginMonitoring(teamBlocked);
                    }
                    else if (isOperational()) finish(DailyQueue.BLOCKED, teamBlocked);
                    else beginMonitoring(teamBlocked);
                    return;
                }
                if (existing != null)
                {
                    clickNpcButton(existing);
                }
                else if (isWantedMenu(menu))
                {
                    chooseWantedMenu(menu);
                }
                else
                {
                    var href:Class = getDefinitionByName("task.commands.HrefEventCommand") as Class;
                    navigation = new href(href.DATA_WANTED_NPC);
                    listenToCommand(navigation, onNavigationFinished);
                    reportBRPhase("通缉 寻路中");
                    navigation.call();
                }
            }
            catch (error:Error)
            {
                if (running)
                {
                    finish(DailyQueue.ABORT, "无法打开通缉面板。");
                }
            }
        }

        public function cancel():void
        {
            if (running)
            {
                stopOwnedAI();
                reset();
            }
        }

        private function onRemoved(event:Event):void
        {
            cancel();
        }

        private function onTimeout(event:TimerEvent):void
        {
            if (monitoring)
            {
                finish(DailyQueue.ABORT, blockedReason != null ?
                    "等待角色恢复可操作超时，通缉状态未能交接。" : "等待通缉整轮结束超时。");
                return;
            }
            if (startCommandFinished && promptCommand == null && promptBox == null)
            {
                beginMonitoring(null, true);
                return;
            }
            finish(DailyQueue.ABORT, clickedNpc ? "通缉任务启动超时。" : "等待通缉面板打开超时。");
        }

        private function onBoxShow(event:Event):void
        {
            if (!running) return;
            var box:Object = Object(event).box;
            if (monitoring)
            {
                readAIAbortReason(box);
                return;
            }
            if (!promptExecuting || promptBox != null) return;
            if (getQualifiedClassName(box) == TEXT_BOX)
            {
                var text:TextField = Object(box.content).txt as TextField;
                if (text != null && isSoloPrompt(text.text))
                {
                    promptBox = box;
                }
            }
        }

        private function onBoxShowed(event:Event):void
        {
            if (!running || monitoring) return;
            var box:Object = Object(event).box;
            if (box.name == NPC_BOX && !clickedNpc)
            {
                wantedEntryArrived = true;
                refreshBRWaitWindow("wanted-panel-arrived", "通缉 等面板");
                clickNpcButton(box);
            }
            else if (!clickedNpc && !choseMenu && isWantedMenu(box))
            {
                wantedEntryArrived = true;
                refreshBRWaitWindow("wanted-menu-arrived", "通缉 等面板");
                chooseWantedMenu(box);
            }
            else if (box === promptBox)
            {
                acceptSoloPrompt();
            }
        }

        private function onBoxHided(event:Event):void
        {
            if (Object(event).box === promptBox)
            {
                if (acceptedPrompt) beginMonitoring(null, true);
                else finish(DailyQueue.ABORT, "本次通缉启动已取消。");
            }
        }

        private static function isWantedMenu(box:Object):Boolean
        {
            return box != null && getQualifiedClassName(box) == TASK_NPC &&
                box.taskNpcCfg != null && box.taskNpcCfg.listId == WANTED_NPC_LIST_ID;
        }

        private static function isSoloPrompt(text:String):Boolean
        {
            return text == SOLO_PROMPT || text == BR_SOLO_PROMPT;
        }

        private function readWantedState():Object
        {
            if (taskModel == null) return null;
            var taskType:Class = getDefinitionByName("task.defs.TaskTypeDef") as Class;
            var items:Array = taskModel.getTaskInfosByType(taskType.WANTED) as Array;
            if (items == null) return null;
            var highestState:int = TASK_RECEIVE_ABLE;
            for each (var item:Object in items)
            {
                if (item != null && int(item.state) > highestState) highestState = int(item.state);
            }
            var remaining:int = int(taskModel.wantedRemainderNum);
            return {
                remaining: remaining,
                highestState: highestState,
                terminal: remaining == 0 && (items.length == 0 || highestState == TASK_RECEIVE_ABLE)
            };
        }

        private function isDailyComplete():Boolean
        {
            var state:Object = readWantedState();
            return state != null && int(state.remaining) == 0 &&
                int(state.highestState) == TASK_RECEIVE_ABLE;
        }

        private function beginMonitoring(initialBlock:String = null, ownsStartedAI:Boolean = false):void
        {
            if (!running) return;
            if (timer != null)
            {
                timer.stop();
                timer.removeEventListener(TimerEvent.TIMER_COMPLETE, onTimeout);
                timer = null;
            }
            if (monitorTimer != null)
            {
                monitorTimer.stop();
                monitorTimer.removeEventListener(TimerEvent.TIMER, onMonitorTimer);
                monitorTimer = null;
            }
            monitoring = true;
            ownsAI = ownsStartedAI || ownsAI;
            blockedReason = initialBlock;
            terminalSince = -1;
            lastEvidenceAt = 0;
            lastTaskState = -1;
            lastFightStateKnown = false;
            lastSceneId = null;
            lastSceneToId = null;
            lastBRPhase = null;
            lastBRMilestone = null;
            wantedEntryArrived = false;
            promptBox = null;
            monitorTimer = new Timer(MONITOR_INTERVAL);
            monitorTimer.addEventListener(TimerEvent.TIMER, onMonitorTimer);
            monitorTimer.start();
            onMonitorTimer(null);
        }

        private function onMonitorTimer(event:TimerEvent):void
        {
            if (!running || !monitoring) return;
            // The launcher scales getTimer and Date; the polling Timer follows the player scheduler.
            // Keep the original CN total timeout on the Timer's own game-clock count.
            var monitoredMs:int = monitorTimer.currentCount * MONITOR_INTERVAL;
            var monitorLimit:int = DailyRegion.networkWait(MONITOR_TIMEOUT);
            if (!DailyRegion.isBR && monitoredMs >= MONITOR_TIMEOUT)
            {
                finish(DailyQueue.ABORT, blockedReason != null ?
                    "等待角色恢复可操作超时，通缉状态未能交接。" : "等待通缉整轮结束超时。");
                return;
            }
            try
            {
                var state:Object = readWantedState();
                if (state == null || battleInfo == null)
                {
                    terminalSince = -1;
                    finishForNoProgress(monitoredMs, monitorLimit);
                    return;
                }
                var remaining:int = int(state.remaining);
                var highestState:int = int(state.highestState);
                if (lastRemaining >= 0 && remaining < lastRemaining)
                {
                    lastEvidenceAt = monitoredMs;
                }
                if (lastTaskState >= 0 && highestState != lastTaskState)
                {
                    lastEvidenceAt = monitoredMs;
                }
                if (remaining != lastRemaining)
                {
                    lastRemaining = remaining;
                    if (progress != null) progress("通缉 剩" + lastRemaining + "次");
                }
                lastTaskState = highestState;
                var fighting:Boolean = Boolean(battleInfo.isFighting);
                var application:Object = getDefinitionByName("base.ApplicationData").singleton;
                var global:Object = application != null ? application.globelInfo : null;
                if (lastFightStateKnown && fighting != lastFightState)
                {
                    lastEvidenceAt = monitoredMs;
                }
                if (global != null && lastSceneId != null && lastSceneToId != null &&
                    global.sceneId != lastSceneId && global.sceneToId != null &&
                    global.sceneId == global.sceneToId)
                {
                    lastEvidenceAt = monitoredMs;
                }
                lastFightState = fighting;
                lastFightStateKnown = true;
                if (global != null)
                {
                    lastSceneId = global.sceneId;
                    lastSceneToId = global.sceneToId;
                }
                if (finishForNoProgress(monitoredMs, monitorLimit)) return;
                if (fighting)
                {
                    var fightTypes:Class = getDefinitionByName("serverProto.fight.FightStartType") as Class;
                    if (int(battleInfo.type) != int(fightTypes.FIGHT_START_TYPE_NPC))
                    {
                        finish(DailyQueue.ABORT, "通缉期间进入了其他类型的战斗，已中止本轮。");
                    }
                    terminalSince = -1;
                    return;
                }
                if (!isOperational())
                {
                    terminalSince = -1;
                    return;
                }
                if (blockedReason != null)
                {
                    ownsAI = false;
                    finish(DailyQueue.BLOCKED, blockedReason);
                    return;
                }
                if (Boolean(state.terminal))
                {
                    if (terminalSince < 0) terminalSince = monitoredMs;
                    else if (monitoredMs - terminalSince >= TERMINAL_SETTLE_MS)
                    {
                        ownsAI = false;
                        finish(DailyQueue.COMPLETE, "通缉任务已完成。");
                    }
                }
                else
                {
                    terminalSince = -1;
                }
            }
            catch (error:Error)
            {
                finish(DailyQueue.ABORT, "无法确认通缉任务是否结束。");
            }
        }

        private function finishForNoProgress(monitoredMs:int, monitorLimit:int):Boolean
        {
            if (!DailyRegion.isBR || monitoredMs - lastEvidenceAt < monitorLimit) return false;
            finish(DailyQueue.ABORT, "通缉连续 15 分钟没有新进展，已停止等待。");
            return true;
        }

        private function onUIRetryTimer(event:TimerEvent):void
        {
            if (!running || !DailyRegion.isBR || pendingUIBox == null) return;
            if (pendingPromptUI) acceptSoloPrompt();
            else if (pendingMenu) chooseWantedMenu(pendingUIBox);
            else clickNpcButton(pendingUIBox);
        }

        private function waitForUI(box:Object, menu:Boolean):void
        {
            if (!DailyRegion.isBR) return;
            pendingUIBox = box;
            pendingMenu = menu;
            pendingPromptUI = false;
            if (uiRetryTimer != null) return;
            uiRetryTimer = new Timer(MONITOR_INTERVAL);
            uiRetryTimer.addEventListener(TimerEvent.TIMER, onUIRetryTimer);
            uiRetryTimer.start();
        }

        private function waitForPromptUI():void
        {
            if (!DailyRegion.isBR || promptBox == null) return;
            pendingUIBox = promptBox;
            pendingMenu = false;
            pendingPromptUI = true;
            if (uiRetryTimer != null) return;
            uiRetryTimer = new Timer(MONITOR_INTERVAL);
            uiRetryTimer.addEventListener(TimerEvent.TIMER, onUIRetryTimer);
            uiRetryTimer.start();
        }

        private function stopWaitingForUI():void
        {
            if (uiRetryTimer == null) return;
            uiRetryTimer.stop();
            uiRetryTimer.removeEventListener(TimerEvent.TIMER, onUIRetryTimer);
            uiRetryTimer = null;
            pendingUIBox = null;
            pendingPromptUI = false;
        }

        private function isOperational():Boolean
        {
            if (battleInfo == null || Boolean(battleInfo.isFighting)) return false;
            if (closingNpcDialog != null && closingNpcDialog.stage === origin.stage) return false;
            var appType:Object = getDefinitionByName("base.ApplicationData");
            var application:Object = appType.singleton;
            if (application == null || application.isFightLock) return false;
            var global:Object = application.globelInfo;
            if (global == null || !("sceneId" in global) || !("sceneToId" in global) ||
                global.sceneId == null || global.sceneToId == null || global.sceneId != global.sceneToId) return false;
            var self:Object = application.selfInfo;
            var stateType:Class = getDefinitionByName("user.def.UserStateDef") as Class;
            if (self == null || self.state == null ||
                !Boolean(self.state.getFlagByName(String(stateType.ACTION_CAN_WALK_TO_DEST)))) return false;
            if (boxManager == null || !(boxManager.showingList is Array)) return false;
            var boxes:Array = boxManager.showingList as Array;
            for each (var box:Object in boxes)
            {
                if (box != null && box.modal && box.stage === origin.stage && (box.isShow || box.isShowing)) return false;
            }
            return true;
        }

        private function closeDialog(box:Object):Boolean
        {
            if (box == null) return false;
            try
            {
                if ("close" in box && Object(box).close is Function)
                {
                    Object(box).close();
                    closingNpcDialog = box;
                    return true;
                }
                var content:Object = box.content;
                var closeButton:InteractiveObject = content != null ? content.closeButton as InteractiveObject : null;
                if (!clickable(closeButton)) return false;
                click(closeButton);
                closingNpcDialog = box;
                return true;
            }
            catch (error:Error)
            {
                return false;
            }
            return false;
        }

        private function readAIAbortReason(box:Object):void
        {
            if (box == null || box.name != "TextBox" || box.subName != AI_ABORT_BOX) return;
            var text:TextField = box.content != null ? Object(box.content).txt as TextField : null;
            if (text == null) return;
            if (text.text == AI_TEAM_ABORT_TEXT || text.text == BR_AI_TEAM_ABORT_TEXT)
                blockedReason = AI_TEAM_ABORT_TEXT;
            else if (text.text == AI_BATTLE_FAIL_TEXT || text.text == BR_AI_BATTLE_FAIL_TEXT)
                blockedReason = AI_BATTLE_FAIL_TEXT;
            else
                blockedReason = "游戏已中止通缉任务。";
            ownsAI = false;
        }

        private function chooseWantedMenu(box:Object):void
        {
            if (!box.isShow || !box.isShowing || box.stage !== origin.stage)
            {
                waitForUI(box, true);
                return;
            }
            // When Kai also has a quest to offer, the game displays his menu first.
            var menus:DisplayObjectContainer = box.content.menus as DisplayObjectContainer;
            var match:InteractiveObject;
            for (var i:int = 0; menus && menus.visible && i < menus.numChildren; i++)
            {
                var list:DisplayObjectContainer = menus.getChildAt(i) as DisplayObjectContainer;
                if (!list || !list.visible) continue;
                for (var j:int = 0; j < list.numChildren; j++)
                {
                    var row:InteractiveObject = list.getChildAt(j) as InteractiveObject;
                    if (!clickable(row) || getQualifiedClassName(row) != MENU_ROW) continue;
                    var item:Object = Object(row).getData();
                    // The current NPC list id and native action parameter identify this row;
                    // the displayed text is localized by the game and is not stable across regions.
                    if (!item || item.type != "npcMenu" || item.param != "openui,51") continue;
                    if (match)
                    {
                        finish(DailyQueue.ABORT, "通缉任务菜单无法确定。");
                        return;
                    }
                    match = row;
                }
            }
            if (!match)
            {
                waitForUI(box, true);
                if (DailyRegion.isBR) return;
                finish(DailyQueue.ABORT, "当前 NPC 菜单没有可用的通缉任务。");
                return;
            }
            stopWaitingForUI();
            choseMenu = true;
            refreshBRWaitWindow("wanted-menu-selected", "通缉 等面板");
            click(match);
        }

        private function clickNpcButton(box:Object):void
        {
            if (!box.isShow || !box.isShowing || box.stage !== origin.stage)
            {
                waitForUI(box, false);
                return;
            }
            if (isDailyComplete())
            {
                blockedReason = "今天的通缉任务已经做完。";
                if (!closeDialog(box))
                {
                    finish(DailyQueue.ABORT, "通缉已做满，但无法关闭当前窗口。");
                    return;
                }
                beginMonitoring(blockedReason);
                return;
            }
            var button:InteractiveObject = Object(box.content).autoFinishBtn as InteractiveObject;
            if (!clickable(button))
            {
                waitForUI(box, false);
                if (DailyRegion.isBR) return;
                finish(DailyQueue.ABORT, "通缉面板的自动完成按钮暂不可用。");
                return;
            }

            stopWaitingForUI();
            clickedNpc = true;
            reportBRPhase("通缉 等确认");
            timer.reset();
            timer.delay = DailyRegion.networkWait(START_TIMEOUT);
            timer.start();
            clickingNpc = true;
            try
            {
                click(button);
            }
            catch (error:Error)
            {
                if (running)
                {
                    finish(DailyQueue.ABORT, "无法启动通缉任务。");
                }
                return;
            }
            finally
            {
                clickingNpc = false;
            }

            // A native validation tip can end the click without issuing a command.
            if (running && startCommand == null)
            {
                finish(DailyQueue.ABORT, "当前无法启动通缉任务。");
            }
        }

        private function onCommandRequest(event:Event):void
        {
            var command:Object = Object(event).command;
            if (!running || command == null) return;
            var name:String = getQualifiedClassName(command);
            if (name == START_COMMAND && command !== startCommand && (monitoring || startCommand != null))
            {
                ownsAI = false;
                finish(DailyQueue.ABORT, "通缉流程被其他游戏自动任务替换，已中止本轮。");
                return;
            }
            if (monitoring) return;
            if (clickingNpc && startCommand == null && name == START_COMMAND && command.type == wantedType)
            {
                // The game owns queued commands. Allow a retry only after this one settles.
                restartStartTimer(DailyRegion.networkWait(START_TIMEOUT));
                startCommand = command;
                listenToCommand(startCommand, onStartFinished);
            }
            else if ((DailyRegion.isBR ? startExecuting : (startExecuting || startCommandFinished)) &&
                promptCommand == null && name == TEXT_COMMAND &&
                isSoloPrompt(command.text) && command.flags == promptFlags && command.modal)
            {
                reportBRPhase("通缉 等确认");
                restartStartTimer(DailyRegion.networkWait(START_TIMEOUT));
                promptCommand = command;
                ownsAI = false;
                listenToCommand(promptCommand, onPromptFinished);
            }
        }

        private function onCommandExecute(event:Event):void
        {
            if (!running || monitoring || timer == null) return;
            var command:Object = Object(event).command;
            if (command === startCommand)
            {
                timer.start();
                startExecuting = true;
                ownsAI = true;
            }
            else if (command === promptCommand)
            {
                timer.start();
                promptExecuting = true;
            }
        }

        private function onCommandStopped(event:Event):void
        {
            if (!running || monitoring) return;
            var command:Object = Object(event).command;
            if (command === navigation || command === startCommand || command === promptCommand)
            {
                finish(DailyQueue.ABORT,
                    event.type == "commandCancel" ? "本次通缉启动已取消。" : "启动通缉所需的游戏资源加载失败。");
            }
        }

        private function onNavigationFinished(event:Event):void
        {
            forgetCommand(navigation, onNavigationFinished);
            navigation = null;
            var application:Object = getDefinitionByName("base.ApplicationData");
            var models:Object = getDefinitionByName("def.ModelDef");
            if (event.type == "faild")
            {
                finish(DailyQueue.ABORT, "无法确认通缉任务入口状态。");
            }
            else
            {
                if (!wantedEntryArrived && !clickedNpc && !choseMenu)
                    refreshBRWaitWindow("navigation-receipt", "通缉 等面板");
                var team:Object = application.singleton.getModel(models.TEAM);
                if (team == null || (team.isJoined && team.members == null))
                {
                    finish(DailyQueue.ABORT, "无法确认当前队伍状态，已停止通缉流程。");
                    return;
                }
                var joinedGroup:Boolean = team.isJoined && team.members != null && team.members.length > 1;
                if (team.isMember || joinedGroup)
                {
                    blockedReason = team.isMember ?
                        "当前处于队伍中，无法接取通缉任务。" : "当前仍在队伍中，不能带队执行通缉。请先退出队伍。";
                    beginMonitoring(blockedReason);
                }
            }
        }

        private function onStartFinished(event:Event):void
        {
            startExecuting = false;
            if (event.type == "faild")
            {
                finish(DailyQueue.ABORT, "游戏暂时无法启动通缉任务。");
            }
            else
            {
                if (!running || monitoring) return;
                startCommandFinished = true;
                if (promptCommand != null || promptBox != null) ownsAI = false;
                else ownsAI = true;
                restartStartTimer(promptCommand == null && promptBox == null ? PROMPT_SETTLE_MS :
                    DailyRegion.networkWait(START_TIMEOUT));
            }
        }

        private function restartStartTimer(delay:int):void
        {
            if (timer == null) return;
            timer.reset();
            timer.delay = delay;
            timer.start();
        }

        private function onPromptFinished(event:Event):void
        {
            if (!running || monitoring || acceptedPrompt) return;
            promptExecuting = false;
            if (event.type == "faild" || promptBox == null)
            {
                finish(DailyQueue.ABORT, "无法打开本次通缉的单人确认。");
                return;
            }
            acceptSoloPrompt();
        }

        private function acceptSoloPrompt():void
        {
            if (acceptedPrompt || promptBox == null) return;
            if (!promptBox.isShow || !promptBox.isShowing || promptBox.stage !== origin.stage)
            {
                waitForPromptUI();
                return;
            }

            var content:DisplayObjectContainer = promptBox.content as DisplayObjectContainer;
            if (content == null)
            {
                waitForPromptUI();
                if (DailyRegion.isBR) return;
                finish(DailyQueue.ABORT, "本次通缉的单人确认暂不可用。");
                return;
            }
            var yesButton:InteractiveObject = content.getChildByName("yesBtn") as InteractiveObject;
            if (!clickable(yesButton) || content.getChildByName("noBtn") == null)
            {
                waitForPromptUI();
                if (DailyRegion.isBR) return;
                finish(DailyQueue.ABORT, "本次通缉的单人确认暂不可用。");
                return;
            }

            stopWaitingForUI();
            acceptedPrompt = true;
            try
            {
                click(yesButton);
            }
            catch (error:Error)
            {
                if (running)
                {
                    finish(DailyQueue.ABORT, "无法确认本次单人通缉。");
                }
            }
        }

        private static function clickable(button:InteractiveObject):Boolean
        {
            return button != null && button.visible && button.mouseEnabled &&
                (!("enabled" in button) || Object(button).enabled);
        }

        private static function click(button:InteractiveObject):void
        {
            button.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true));
        }

        private static function listenToCommand(command:Object, listener:Function):void
        {
            command.addEventListener("loadingEnd", listener);
            command.addEventListener("faild", listener);
        }

        private static function forgetCommand(command:Object, listener:Function):void
        {
            if (command != null)
            {
                command.removeEventListener("loadingEnd", listener);
                command.removeEventListener("faild", listener);
            }
        }

        private function finish(status:String, message:String):void
        {
            if (!running) return;
            if (status == DailyQueue.ABORT) stopOwnedAI();
            reset();
            if (onFinished != null) onFinished(status, message);
        }

        private function stopOwnedAI():void
        {
            if (!ownsAI) return;
            ownsAI = false;
            try
            {
                var facadeType:Object = getDefinitionByName("com.tencent.morefun.framework.apf.core.facade.Facade");
                var facade:Object = facadeType.getInstance();
                var pluginDef:Object = getDefinitionByName("def.PluginDef");
                var plugin:Object = facade.pluginManager.getPluginInfo(pluginDef.AI);
                var domain:Object = plugin != null ? plugin.domain : null;
                var className:String = "com.tencent.morefun.naruto.plugin.ai.commands.StopAICommand";
                if (domain == null || !domain.hasDefinition(className)) return;
                var stopType:Class = domain.getDefinition(className) as Class;
                var stopCommand:Object = new stopType(wantedType);
                stopCommand.call();
            }
            catch (error:Error)
            {
                // Cancellation still detaches all local callbacks if native stop is unavailable.
            }
        }

        private function reset():void
        {
            stopWaitingForUI();
            if (timer != null)
            {
                timer.stop();
                timer.removeEventListener(TimerEvent.TIMER_COMPLETE, onTimeout);
                timer = null;
            }
            if (monitorTimer != null)
            {
                monitorTimer.stop();
                monitorTimer.removeEventListener(TimerEvent.TIMER, onMonitorTimer);
                monitorTimer = null;
            }
            origin.removeEventListener(Event.REMOVED_FROM_STAGE, onRemoved);
            if (boxEvents != null)
            {
                boxEvents.removeEventListener("boxShow", onBoxShow);
                boxEvents.removeEventListener("boxShowed", onBoxShowed);
                boxEvents.removeEventListener("boxHided", onBoxHided);
                boxEvents = null;
            }
            if (commandEvents != null)
            {
                commandEvents.removeEventListener("commandRequest", onCommandRequest);
                commandEvents.removeEventListener("commandExecute", onCommandExecute);
                commandEvents.removeEventListener("commandLoadError", onCommandStopped);
                commandEvents.removeEventListener("commandCancel", onCommandStopped);
                commandEvents = null;
            }
            forgetCommand(navigation, onNavigationFinished);
            navigation = null;
            forgetCommand(startCommand, onStartFinished);
            forgetCommand(promptCommand, onPromptFinished);
            startCommand = null;
            promptCommand = null;
            promptBox = null;
            clickingNpc = false;
            clickedNpc = false;
            choseMenu = false;
            startExecuting = false;
            promptExecuting = false;
            acceptedPrompt = false;
            monitoring = false;
            ownsAI = false;
            blockedReason = null;
            terminalSince = -1;
            lastRemaining = -1;
            lastTaskState = -1;
            lastEvidenceAt = 0;
            lastFightStateKnown = false;
            lastSceneId = null;
            lastSceneToId = null;
            lastBRPhase = null;
            lastBRMilestone = null;
            wantedEntryArrived = false;
            closingNpcDialog = null;
        }

        private function reportBRPhase(phase:String):void
        {
            if (!DailyRegion.isBR || progress == null || phase == lastBRPhase) return;
            lastBRPhase = phase;
            progress(phase);
        }

        private function refreshBRWaitWindow(milestone:String, phase:String):void
        {
            if (!DailyRegion.isBR || milestone == lastBRMilestone) return;
            lastBRMilestone = milestone;
            restartStartTimer(DailyRegion.networkWait(NAVIGATION_TIMEOUT));
            reportBRPhase(phase);
        }
    }
}
