package narutoos.daily
{
    import flash.display.DisplayObjectContainer;
    import flash.display.InteractiveObject;
    import flash.display.Sprite;
    import flash.events.Event;
    import flash.events.IEventDispatcher;
    import flash.events.MouseEvent;
    import flash.events.TimerEvent;
    import flash.text.TextField;
    import flash.utils.getDefinitionByName;
    import flash.utils.getQualifiedClassName;
    import flash.utils.Timer;

    /** Completes one Strong Coming battle by using the game's own controls. */
    public final class StrongRun implements IDailyTask
    {
        private static const ACTIVITY_ID:int = 55096;
        private static const CHALLENGE_WINDOW:String =
            "com.tencent.morefun.naruto.plugin.befallDungeon.view.window::BefallDungeonChallengeWindow";
        private static const AWARD_PANEL:String =
            "com.tencent.morefun.naruto.plugin.befallDungeon.view.window::BefallDungeonAwardPanel";
        private static const SCORE_PANEL:String =
            "com.tencent.morefun.naruto.plugin.befallDungeon.view.window::BefallDungeonScorePanel";
        private static const PVE_START_COMMAND:String = "battle.command::RequestPveFightStartCommand";
        private static const BEFALL_QUERY_COMMAND:String =
            "com.tencent.morefun.naruto.plugin.befallDungeon.command::BefallDungeonQueryCommand";
        private static const AWARD_OPEN_COMMAND:String = "befallDungeon.command::OpenBefallDungeonAwardCommand";
        private static const SCORE_OPEN_COMMAND:String = "befallDungeon.command::OpenBefallDungeonScoreCommand";
        private static const BATTLE_MODEL:String = "battleStart";
        private static const UNREADABLE_MODAL:String = "__unreadable_modal_list__";
        private static const POLL_INTERVAL:int = 120;
        private static const NAVIGATION_TIMEOUT:int = 45000;
        private static const START_TIMEOUT:int = 30000;
        private static const FIGHT_TIMEOUT:int = 600000;
        private static const RETURN_TIMEOUT:int = 60000;

        private var owner:Sprite;
        private var onFinished:Function;
        private var onProgress:Function;
        private var windowProgress:Object;
        private var timer:Timer;
        private var boxEvents:IEventDispatcher;
        private var commandEvents:IEventDispatcher;
        private var battleEvents:IEventDispatcher;
        private var battleUpdateEvent:String;
        private var application:Object;
        private var battleInfo:Object;
        private var navigation:Object;
        private var challengeBox:Object;
        private var awardBox:Object;
        private var scoreBox:Object;
        private var startCommand:Object;
        private var queryCommand:Object;
        private var queryFinishedEvent:String;
        private var awardCommand:Object;
        private var scoreCommand:Object;
        private var phase:String;
        private const deadline:Timer = new Timer(NAVIGATION_TIMEOUT, 1);
        private var clickedStart:Boolean;
        private var startExecuted:Boolean;
        private var battleStarted:Boolean;
        private var resultSeen:Boolean;
        private var fightResultDeadlineRefreshed:Boolean;
        private var clickedAward:Boolean;
        private var clickedScore:Boolean;
        private var pendingAward:Boolean;
        private var pendingScore:Boolean;
        private var blockedReason:String;

        public function StrongRun(owner:Sprite, finished:Function, progress:Function, windowProgress:Object = null)
        {
            this.owner = owner;
            this.onFinished = finished;
            this.onProgress = progress;
            this.windowProgress = windowProgress || {};
        }

        public function get running():Boolean
        {
            return phase != null;
        }

        public function start():void
        {
            if (running || owner == null || !owner.stage)
            {
                return;
            }

            phase = "entry";
            timer = new Timer(POLL_INTERVAL);
            armDeadline(DailyRegion.networkWait(NAVIGATION_TIMEOUT));
            timer.addEventListener(TimerEvent.TIMER, onTimer);
            try
            {
                var boxManager:Object = getDefinitionByName("com.tencent.morefun.naruto.plugin.ui.box.BoxManager");
                var facade:Object = getDefinitionByName("com.tencent.morefun.framework.apf.core.facade.Facade");
                var appType:Class = getDefinitionByName("base.ApplicationData") as Class;
                var modelEventType:Class = getDefinitionByName("com.tencent.morefun.naruto.model.event.ModelEvent") as Class;
                boxEvents = boxManager.dispathcer as IEventDispatcher;
                commandEvents = facade.getInstance().commandManager as IEventDispatcher;
                application = appType.singleton;
                battleInfo = application.getModel(BATTLE_MODEL);
                battleEvents = battleInfo as IEventDispatcher;
                if (boxEvents == null || commandEvents == null || battleEvents == null || battleInfo == null)
                {
                    throw new Error("当前游戏页缺少日常任务所需的原生状态。");
                }
                if (battleInfo.isFighting)
                {
                    finish(DailyQueue.ABORT, "当前已有战斗，请回到可操作的游戏画面后再执行。");
                    return;
                }
                if (application.isFightLock)
                {
                    finish(DailyQueue.ABORT, "当前角色战斗状态尚未解除，强者降临本轮已中止。");
                    return;
                }
                if (!canWalkToDestination())
                {
                    finish(DailyQueue.ABORT, "当前角色尚未恢复可操作，强者降临本轮已中止。");
                    return;
                }
                if (windowProgress.strongDone)
                {
                    if (NativeFightResult.current(owner.stage) != null || topModalBox() != null ||
                        hasOpenStrongPanel() || onOwnerStage(windowProgress.strongClosingPanel))
                    {
                        finish(DailyQueue.ABORT, "请结束强者降临结算并关闭当前游戏弹窗后再执行。");
                        return;
                    }
                    windowProgress.strongClosingPanel = null;
                    finish(DailyQueue.COMPLETE, "强者降临本窗口已完成 1/1。");
                    return;
                }
                report("强者降临 0/1");
                var modelDefs:Class = getDefinitionByName("def.ModelDef") as Class;
                var team:Object = facade.getInstance().model.retrieveModel(modelDefs.TEAM);
                if (team == null)
                {
                    throw new Error("当前游戏页无法读取队伍状态。");
                }
                if (team.isJoined)
                {
                    finish(DailyQueue.ABORT, "当前角色已加入队伍，请离队后再执行强者降临。");
                    return;
                }
                battleUpdateEvent = String(modelEventType.UPDATE);
                battleEvents.addEventListener(battleUpdateEvent, onBattleUpdate, false, int.MAX_VALUE);
                boxEvents.addEventListener("boxShow", onBoxShow, false, int.MIN_VALUE);
                boxEvents.addEventListener("boxShowed", onBoxShowed);
                boxEvents.addEventListener("boxHided", onBoxHided);
                commandEvents.addEventListener("commandRequest", onCommandRequest, false, int.MAX_VALUE);
                commandEvents.addEventListener("commandExecute", onCommandExecute, false, int.MAX_VALUE);
                commandEvents.addEventListener("commandLoadError", onCommandStopped);
                commandEvents.addEventListener("commandCancel", onCommandStopped);
                owner.addEventListener(Event.REMOVED_FROM_STAGE, onOwnerRemoved);
                timer.start();

                var manager:Object = getDefinitionByName("com.tencent.morefun.naruto.plugin.ui.box.BoxManager");
                var existing:Object = findVisibleChallenge(manager);
                if (isVisibleOnOwnerStage(existing))
                {
                    challengeBox = existing;
                    phase = "challenge";
                    armDeadline(DailyRegion.networkWait(NAVIGATION_TIMEOUT));
                }
                else
                {
                    navigation = DailyActivity.route(ACTIVITY_ID);
                    DailyActivity.call(navigation, onNavigationFinished);
                }
            }
            catch (error:Error)
            {
                if (running)
                {
                    finish(DailyQueue.ABORT, "无法打开强者降临原生入口。" + error.message);
                }
            }
        }

        public function cancel():void
        {
            if (running)
            {
                if (battleStarted && owner.stage != null && NativeFightResult.current(owner.stage) != null)
                    windowProgress.strongDone = true;
                reset();
            }
        }

        private function onOwnerRemoved(event:Event):void
        {
            finish(DailyQueue.ABORT, "游戏画面已关闭，本轮日常任务已中止。");
        }

        private function onNavigationFinished(event:Event):void
        {
            DailyActivity.removeListener(navigation, onNavigationFinished);
            navigation = null;
            if (!running)
            {
                return;
            }
            if (event.type == "faild")
            {
                finish(DailyQueue.ABORT, "游戏未能打开强者降临原生入口。");
                return;
            }
            if (phase == "entry")
            {
                phase = "challenge";
                armDeadline(DailyRegion.networkWait(NAVIGATION_TIMEOUT));
            }
            var manager:Object = getDefinitionByName("com.tencent.morefun.naruto.plugin.ui.box.BoxManager");
            acceptChallengeBox(findVisibleChallenge(manager));
        }

        private function onBoxShow(event:Event):void
        {
            if (!running)
            {
                return;
            }
            var box:Object = Object(event).box;
            if (isStrongBox(box))
            {
                acceptStrongBox(box);
            }
        }

        private function onBoxShowed(event:Event):void
        {
            if (!running)
            {
                return;
            }
            acceptStrongBox(Object(event).box);
        }

        private function onBoxHided(event:Event):void
        {
            var box:Object = Object(event).box;
            if (box === challengeBox)
            {
                challengeBox = null;
            }
            else if (box === awardBox)
            {
                awardBox = null;
            }
            else if (box === scoreBox)
            {
                scoreBox = null;
            }
        }

        private function acceptStrongBox(box:Object):void
        {
            if (!isStrongBox(box) || !isVisibleOnOwnerStage(box))
            {
                return;
            }
            var className:String = getQualifiedClassName(box);
            if (className == CHALLENGE_WINDOW)
            {
                acceptChallengeBox(box);
            }
            else if (battleStarted && className == AWARD_PANEL)
            {
                awardBox = box;
                pendingAward = false;
                awardCommand = null;
                countBattle();
            }
            else if (battleStarted && className == SCORE_PANEL)
            {
                scoreBox = box;
                pendingScore = false;
                scoreCommand = null;
                countBattle();
            }
        }

        private function acceptChallengeBox(box:Object):void
        {
            if (!running || !isVisibleOnOwnerStage(box))
            {
                return;
            }
            challengeBox = box;
            if (phase == "entry")
            {
                phase = "challenge";
                armDeadline(DailyRegion.networkWait(NAVIGATION_TIMEOUT));
            }
        }

        private function isStrongBox(box:Object):Boolean
        {
            if (box == null)
            {
                return false;
            }
            var className:String = getQualifiedClassName(box);
            return className == CHALLENGE_WINDOW || className == AWARD_PANEL || className == SCORE_PANEL;
        }

        private function onCommandRequest(event:Event):void
        {
            if (!running)
            {
                return;
            }
            var command:Object = Object(event).command;
            if (command == null)
            {
                return;
            }
            var className:String = getQualifiedClassName(command);
            if (className == BEFALL_QUERY_COMMAND && queryCommand == null &&
                (phase == "entry" || phase == "challenge"))
            {
                queryCommand = command;
                var commandEvent:Class = getDefinitionByName("com.tencent.morefun.framework.base.CommandEvent") as Class;
                queryFinishedEvent = String(commandEvent.FINISH);
                queryCommand.addEventListener(queryFinishedEvent, onBefallQueryFinished);
                return;
            }
            if (className == BEFALL_QUERY_COMMAND && queryCommand != null && command !== queryCommand)
            {
                finish(DailyQueue.ABORT, "强者降临重复查询，无法确认本次入口状态。");
                return;
            }
            if ((className == AWARD_OPEN_COMMAND || className == SCORE_OPEN_COMMAND) && battleStarted)
            {
                if (className == AWARD_OPEN_COMMAND)
                {
                    awardCommand = command;
                    pendingAward = true;
                }
                else
                {
                    scoreCommand = command;
                    pendingScore = true;
                }
                return;
            }
            if (!clickedStart || className != PVE_START_COMMAND)
            {
                return;
            }
            var fightType:Class = getDefinitionByName("serverProto.fight.FightStartType") as Class;
            if (int(command.type) != int(fightType.FIGHT_START_TYPE_BEFALL_DUNGEON))
            {
                finish(DailyQueue.ABORT, "开始挑战后出现了其他战斗请求，无法确认本场归属。");
                return;
            }
            if (startCommand != null && command !== startCommand)
            {
                finish(DailyQueue.ABORT, "强者降临出现重复战斗请求，已中止以避免多打一场。");
                return;
            }
            startCommand = command;
            phase = "starting";
            armDeadline(DailyRegion.networkWait(START_TIMEOUT));
        }

        private function onBefallQueryFinished(event:Event):void
        {
            if (!running || queryCommand == null)
            {
                return;
            }
            queryCommand.removeEventListener(queryFinishedEvent, onBefallQueryFinished);
            var query:Object = queryCommand;
            queryCommand = null;
            queryFinishedEvent = null;
            if (int(query.ecode) != 0 || query.dungeons == null)
            {
                finish(DailyQueue.ABORT, "强者降临状态查询失败，无法确认能否交接。");
                return;
            }
            // Query completion is a real response boundary. Give the following
            // panel/navigation step its own deadline in slow BR sessions.
            if (DailyRegion.isBR) armDeadline(DailyRegion.networkWait(NAVIGATION_TIMEOUT));
            if (query.dungeons.length == 0)
            {
                phase = "unavailable";
                armDeadline(DailyRegion.networkWait(NAVIGATION_TIMEOUT));
            }
        }

        private function onCommandExecute(event:Event):void
        {
            if (!running)
            {
                return;
            }
            var command:Object = Object(event).command;
            if (command === startCommand)
            {
                startExecuted = true;
                armDeadline(DailyRegion.networkWait(START_TIMEOUT));
            }
        }

        private function onCommandStopped(event:Event):void
        {
            var command:Object = Object(event).command;
            if (!running)
            {
                return;
            }
            if (command === queryCommand)
            {
                removeQueryListener();
                finish(DailyQueue.ABORT, "强者降临状态查询被取消或加载失败。");
                return;
            }
            if (command === awardCommand || command === scoreCommand)
            {
                if (command === awardCommand)
                {
                    pendingAward = false;
                }
                if (command === scoreCommand)
                {
                    pendingScore = false;
                }
                finish(DailyQueue.ABORT, "强者降临奖励页面未能打开，无法确认角色可交接。");
                return;
            }
            if (command !== startCommand)
            {
                return;
            }
            finish(DailyQueue.ABORT,
                event.type == "commandCancel" ? "强者降临挑战已被游戏取消。" : "强者降临战斗资源加载失败。");
        }

        private function onBattleUpdate(event:Event):void
        {
            if (!running || battleInfo == null)
            {
                return;
            }
            var key:String = Object(event).key as String;
            var fightType:Class = getDefinitionByName("serverProto.fight.FightStartType") as Class;
            if (key == "start")
            {
                if (startCommand == null || !startExecuted ||
                    int(battleInfo.type) != int(fightType.FIGHT_START_TYPE_BEFALL_DUNGEON))
                {
                    finish(DailyQueue.ABORT, "游戏战斗无法确认属于本次强者降临挑战。");
                    return;
                }
                battleStarted = true;
                resultSeen = false;
                fightResultDeadlineRefreshed = false;
                phase = "fighting";
                armDeadline(DailyRegion.networkWait(FIGHT_TIMEOUT));
            }
            else if (key == "showResult" && battleStarted)
            {
                if (int(battleInfo.type) != int(fightType.FIGHT_START_TYPE_BEFALL_DUNGEON))
                    finish(DailyQueue.ABORT, "战斗结果与强者降临不匹配。");
                else
                {
                    windowProgress.strongDone = true;
                    if (DailyRegion.isBR && !fightResultDeadlineRefreshed)
                    {
                        fightResultDeadlineRefreshed = true;
                        armDeadline(DailyRegion.networkWait(FIGHT_TIMEOUT));
                    }
                }
            }
        }

        private function armDeadline(limit:int):void
        {
            deadline.reset();
            deadline.delay = limit;
            deadline.start();
        }

        private function onTimer(event:TimerEvent):void
        {
            if (!running)
            {
                return;
            }
            if (owner == null || !owner.stage)
            {
                finish(DailyQueue.ABORT, "游戏画面已关闭，本轮日常任务已中止。");
                return;
            }
            if (deadline.currentCount != 0)
            {
                finish(DailyQueue.ABORT, timeoutMessage());
                return;
            }
            try
            {
                advance();
            }
            catch (error:Error)
            {
                if (running)
                {
                    finish(DailyQueue.ABORT, "强者降临状态无法确认。" + error.message);
                }
            }
        }

        private function advance():void
        {
            if (phase == "challenge")
            {
                startNativeChallenge();
            }
            else if (phase == "starting")
            {
                if (battleInfo.isFighting)
                {
                    verifyBattleStart();
                }
            }
            else if (phase == "fighting")
            {
                watchFightResult();
            }
            else if (phase == "returning")
            {
                closeRewardPanels();
                if (running) confirmReturnedToGame();
            }
            else if (phase == "unavailable")
            {
                if (!battleInfo.isFighting && !application.isFightLock &&
                    canWalkToDestination() && !hasUnknownTopModal() && !hasOpenStrongPanel())
                {
                    finish(DailyQueue.BLOCKED, blockedReason == null ? "降临副本已关闭。" : blockedReason);
                }
            }
        }

        private function startNativeChallenge():void
        {
            if (!isVisibleOnOwnerStage(challengeBox))
            {
                var manager:Object = getDefinitionByName("com.tencent.morefun.naruto.plugin.ui.box.BoxManager");
                acceptChallengeBox(findVisibleChallenge(manager));
                if (!isVisibleOnOwnerStage(challengeBox))
                {
                    return;
                }
            }
            var content:DisplayObjectContainer = challengeBox.content as DisplayObjectContainer;
            if (content == null || getQualifiedClassName(content) != "ui.plugin.befallDungeon::BefallDungeonWindowUI2")
            {
                return;
            }
            var button:InteractiveObject = content["startBtn"] as InteractiveObject;
            if (!isEnabledVisible(button))
            {
                if (closeForLockedDifficulty(challengeBox, content, button)) return;
                finish(DailyQueue.ABORT, "强者降临原生开始按钮不可用，无法确认游戏给出的原因。");
                return;
            }
            var facade:Object = getDefinitionByName("com.tencent.morefun.framework.apf.core.facade.Facade");
            var modelDefs:Class = getDefinitionByName("def.ModelDef") as Class;
            var team:Object = facade.getInstance().model.retrieveModel(modelDefs.TEAM);
            if (team == null || team.isJoined)
            {
                finish(DailyQueue.ABORT, "开始挑战前队伍状态发生变化，已中止以避免整队参战。");
                return;
            }
            var topModal:Object = topModalBox();
            if (hasUnknownTopModal() || (topModal != null && topModal !== challengeBox))
            {
                return;
            }
            clickedStart = true;
            phase = "starting";
            armDeadline(DailyRegion.networkWait(START_TIMEOUT));
            // A previously opened challenge can expire before its start button is clicked.
            // Only accept the game's own closure tip produced synchronously by this click.
            var layerType:Class = getDefinitionByName("com.tencent.morefun.naruto.plugin.ui.layer.LayerManager") as Class;
            var tipsLayer:DisplayObjectContainer = layerType.singleton.findLayerByName("GameTip") as DisplayObjectContainer;
            var closedTip:Boolean = false;
            var observeTip:Function = function(event:Event):void
            {
                var tip:Sprite = event.target as Sprite;
                if (!tip || getQualifiedClassName(tip) != "com.tencent.morefun.naruto.util::GameTipAnim" || !tip.numChildren) return;
                var body:Sprite = tip.getChildAt(0) as Sprite;
                var label:TextField = body && body.numChildren ? body.getChildAt(0) as TextField : null;
                if (label && (label.text == "降临副本已关闭" ||
                    (DailyRegion.isBR && label.text == "A Fase de Chegada encerrou-se"))) closedTip = true;
            };
            if (tipsLayer) tipsLayer.addEventListener(Event.ADDED, observeTip);
            try
            {
                button.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true, false));
            }
            finally
            {
                if (tipsLayer) tipsLayer.removeEventListener(Event.ADDED, observeTip);
            }
            if (closedTip && running && !startCommand && !battleInfo.isFighting)
                closeBlockedChallenge(challengeBox, content, "降临副本已关闭。");
        }

        private function verifyBattleStart():void
        {
            var fightType:Class = getDefinitionByName("serverProto.fight.FightStartType") as Class;
            if (startCommand == null || !startExecuted ||
                int(battleInfo.type) != int(fightType.FIGHT_START_TYPE_BEFALL_DUNGEON))
            {
                finish(DailyQueue.ABORT, "当前战斗无法确认属于本次强者降临挑战。");
                return;
            }
            if (!battleStarted)
            {
                battleStarted = true;
                phase = "fighting";
                armDeadline(DailyRegion.networkWait(FIGHT_TIMEOUT));
            }
        }

        private function watchFightResult():void
        {
            // Strong Coming can open its own reward page without showing the generic fight result.
            if (!battleInfo.isFighting && awardBox == null && scoreBox == null)
                acceptStrongBox(topModalBox());
            if (isVisibleOnOwnerStage(awardBox) || isVisibleOnOwnerStage(scoreBox))
            {
                countBattle();
                waitForReturn();
                return;
            }

            var result:Object = NativeFightResult.current(owner.stage);
            if (result == null)
            {
                if (resultSeen && !battleInfo.isFighting) waitForReturn();
                return;
            }
            countBattle();
            var exitButton:InteractiveObject = NativeFightResult.exitButton(result);
            if (exitButton != null)
            {
                waitForReturn();
                exitButton.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true, false));
            }
        }

        private function countBattle():void
        {
            if (resultSeen) return;
            resultSeen = true;
            windowProgress.strongDone = true;
            report("强者降临 1/1");
        }

        private function waitForReturn():void
        {
            phase = "returning";
            armDeadline(DailyRegion.networkWait(RETURN_TIMEOUT));
        }

        private function closeRewardPanels():void
        {
            if (hasUnknownTopModal()) return;
            if (isVisibleOnOwnerStage(awardBox) && !clickedAward)
            {
                if (topModalBox() === awardBox)
                {
                    var awardContent:DisplayObjectContainer = awardBox.content as DisplayObjectContainer;
                    var awardBody:DisplayObjectContainer = awardContent != null ?
                        awardContent["content_mc"] as DisplayObjectContainer : null;
                    var awardButton:InteractiveObject = awardBody != null ?
                        awardBody["ok_btn"] as InteractiveObject : null;
                    if (isEnabledVisible(awardButton))
                    {
                        clickedAward = true;
                        awardButton.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true, false));
                        return;
                    }
                }
            }
            if (isVisibleOnOwnerStage(scoreBox) && !clickedScore)
            {
                if (topModalBox() !== scoreBox) return;
                var scoreContent:DisplayObjectContainer = scoreBox.content as DisplayObjectContainer;
                var scoreBody:DisplayObjectContainer = scoreContent != null ?
                    scoreContent["content_mc"] as DisplayObjectContainer : null;
                var scoreButton:InteractiveObject = scoreBody != null ?
                    scoreBody["ok_btn"] as InteractiveObject : null;
                if (isEnabledVisible(scoreButton))
                {
                    clickedScore = true;
                    scoreButton.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true, false));
                }
            }
        }

        private function confirmReturnedToGame():void
        {
            if (!resultSeen || battleInfo.isFighting || NativeFightResult.current(owner.stage) != null ||
                application.isFightLock ||
                pendingAward || pendingScore || hasUnknownTopModal() || hasOpenStrongPanel())
            {
                return;
            }
            if (!canWalkToDestination())
            {
                return;
            }
            finish(DailyQueue.COMPLETE, "强者降临本次挑战已完成，角色已恢复可操作。");
        }

        private function canWalkToDestination():Boolean
        {
            var appType:Class = getDefinitionByName("base.ApplicationData") as Class;
            var stateType:Class = getDefinitionByName("user.def.UserStateDef") as Class;
            var self:Object = appType.singleton.selfInfo;
            return self != null && self.state != null &&
                Boolean(self.state.getFlagByName(String(stateType.ACTION_CAN_WALK_TO_DEST)));
        }

        private function timeoutMessage():String
        {
            if (phase == "entry" || phase == "challenge")
            {
                return "等待强者降临原生入口或挑战面板超时，已中止本轮。";
            }
            if (phase == "starting")
            {
                return "等待强者降临战斗开始超时，无法确认本场已启动。";
            }
            if (phase == "fighting")
            {
                return "等待强者降临胜负结算超时，已中止本轮。";
            }
            if (phase == "unavailable")
            {
                return "等待游戏确认角色可操作状态超时，无法安全交接。";
            }
            return "等待强者降临结算关闭及角色恢复可操作超时，已中止本轮。";
        }

        private function report(message:String):void
        {
            if (onProgress != null)
            {
                onProgress(message);
            }
        }

        private function finish(status:String, message:String):void
        {
            if (!running)
            {
                return;
            }
            var callback:Function = onFinished;
            reset();
            if (callback != null)
            {
                callback(status, message);
            }
        }

        private function reset():void
        {
            if (windowProgress.strongDone)
            {
                if (onOwnerStage(scoreBox)) windowProgress.strongClosingPanel = scoreBox;
                else if (onOwnerStage(awardBox)) windowProgress.strongClosingPanel = awardBox;
            }
            deadline.stop();
            if (timer != null)
            {
                timer.stop();
                timer.removeEventListener(TimerEvent.TIMER, onTimer);
                timer = null;
            }
            if (owner != null)
            {
                owner.removeEventListener(Event.REMOVED_FROM_STAGE, onOwnerRemoved);
            }
            DailyActivity.removeListener(navigation, onNavigationFinished);
            removeQueryListener();
            if (boxEvents != null)
            {
                boxEvents.removeEventListener("boxShow", onBoxShow);
                boxEvents.removeEventListener("boxShowed", onBoxShowed);
                boxEvents.removeEventListener("boxHided", onBoxHided);
            }
            if (commandEvents != null)
            {
                commandEvents.removeEventListener("commandRequest", onCommandRequest);
                commandEvents.removeEventListener("commandExecute", onCommandExecute);
                commandEvents.removeEventListener("commandLoadError", onCommandStopped);
                commandEvents.removeEventListener("commandCancel", onCommandStopped);
            }
            if (battleEvents != null && battleUpdateEvent != null)
            {
                battleEvents.removeEventListener(battleUpdateEvent, onBattleUpdate);
            }
            phase = null;
            boxEvents = null;
            commandEvents = null;
            battleEvents = null;
            battleUpdateEvent = null;
            battleInfo = null;
            application = null;
            navigation = null;
            challengeBox = null;
            awardBox = null;
            scoreBox = null;
            startCommand = null;
            awardCommand = null;
            scoreCommand = null;
            pendingAward = false;
            pendingScore = false;
        }

        private function removeQueryListener():void
        {
            if (queryCommand != null && queryFinishedEvent != null)
            {
                queryCommand.removeEventListener(queryFinishedEvent, onBefallQueryFinished);
            }
            queryCommand = null;
            queryFinishedEvent = null;
        }

        private function findVisibleChallenge(manager:Object):Object
        {
            if (manager == null || !(manager.showingList is Array)) return null;
            for each (var box:Object in manager.showingList)
            {
                if (getQualifiedClassName(box) == CHALLENGE_WINDOW && isVisibleOnOwnerStage(box))
                {
                    return box;
                }
            }
            return null;
        }

        private function hasUnknownTopModal():Boolean
        {
            var top:Object = topModalBox();
            return top === UNREADABLE_MODAL || (top != null && !isStrongBox(top));
        }

        private function topModalBox():Object
        {
            var manager:Object = getDefinitionByName("com.tencent.morefun.naruto.plugin.ui.box.BoxManager");
            if (manager == null || !(manager.showingList is Array)) return UNREADABLE_MODAL;
            var showing:Array = manager.showingList as Array;
            for (var i:int = showing.length - 1; i >= 0; i--)
            {
                var box:Object = showing[i];
                if (box != null && box.modal && box.isShow && box.stage === owner.stage) return box;
            }
            return null;
        }

        private function hasOpenStrongPanel():Boolean
        {
            // BoxManager removes a closing panel from showingList before its exit tween ends.
            // Keep waiting on the observed instance until it leaves the stage or reports boxHided.
            if (onOwnerStage(challengeBox) || onOwnerStage(awardBox) || onOwnerStage(scoreBox)) return true;
            var manager:Object = getDefinitionByName("com.tencent.morefun.naruto.plugin.ui.box.BoxManager");
            if (manager == null || !(manager.showingList is Array)) return true;
            for each (var box:Object in manager.showingList)
            {
                if (isStrongBox(box) && box.modal && box.stage === owner.stage && (box.isShow || box.isShowing))
                {
                    return true;
                }
            }
            return false;
        }

        private function closeForLockedDifficulty(box:Object, content:DisplayObjectContainer,
                                                  startButton:InteractiveObject):Boolean
        {
            var tipsType:Class = getDefinitionByName(
                "com.tencent.morefun.naruto.plugin.ui.tips.TipsManager") as Class;
            var tip:Object = tipsType.singleton.getTipsData(startButton);
            var reason:String = tip == null ? "" : String(tip);
            if (reason.search(/^该难度[0-9]+级后开启$/) != 0)
            {
                return false;
            }
            return closeBlockedChallenge(box, content, reason);
        }

        private function closeBlockedChallenge(box:Object, content:DisplayObjectContainer, reason:String):Boolean
        {
            var closeButton:InteractiveObject = content["closeBtn"] as InteractiveObject;
            if (!isEnabledVisible(closeButton) || hasUnknownTopModal() ||
                (topModalBox() != null && topModalBox() !== box))
            {
                return false;
            }
            blockedReason = reason;
            challengeBox = box;
            phase = "unavailable";
            armDeadline(DailyRegion.networkWait(NAVIGATION_TIMEOUT));
            closeButton.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true, false));
            return true;
        }

        private static function isEnabledVisible(button:InteractiveObject):Boolean
        {
            return button != null && button.stage != null && button.visible && button.mouseEnabled &&
                (!("enabled" in button) || Boolean(Object(button).enabled));
        }

        private function isVisibleOnOwnerStage(box:Object):Boolean
        {
            return onOwnerStage(box) && box.isShow && box.isShowing;
        }

        private function onOwnerStage(box:Object):Boolean
        {
            return box != null && owner.stage != null && box.stage === owner.stage;
        }

    }
}
