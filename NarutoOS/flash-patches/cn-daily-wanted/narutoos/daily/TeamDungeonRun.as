package narutoos.daily
{
    import flash.display.InteractiveObject;
    import flash.display.Sprite;
    import flash.events.Event;
    import flash.events.IEventDispatcher;
    import flash.events.MouseEvent;
    import flash.events.TimerEvent;
    import flash.utils.getDefinitionByName;
    import flash.utils.getQualifiedClassName;
    import flash.utils.Timer;

    /** Solo entry through the original hard card, with progress kept for the game window. */
    public final class TeamDungeonRun implements IDailyTask
    {
        private static const VIEW:String = "com.tencent.morefun.naruto.plugin.dungeon.view.";
        private static const LIST:String = VIEW + "teamNewDungeon::TeamNewDungeonPanel";
        private static const CONFIRM:String = VIEW + "teamNewDungeon::EnterConfirmWindow";
        private static const REWARD:String = VIEW + "reward::TeamNewDungeonRewardPanel";
        private static const START:String = "dungeon.command::TeamNewDungeonFightCommand";
        private static const GOAL:int = 3;
        private var owner:Sprite;
        private var done:Function;
        private var progress:Function;
        private var windowProgress:Object;
        private var phase:String;
        private var poll:Timer = new Timer(200);
        private var deadline:Timer = new Timer(45000, 1);
        private var application:Object;
        private var battle:Object;
        private var team:Object;
        private var types:Object;
        private var boxes:Object;
        private var commands:IEventDispatcher;
        private var boxEvents:IEventDispatcher;
        private var navigation:Object;
        private var before:int;
        private var fixedRound:Boolean;
        private var settled:Boolean;
        private var resultSeen:Boolean;
        private var dungeonId:int;
        private var dispatching:Boolean;
        private var requested:Boolean;
        private var confirmed:Boolean;
        private var lost:Boolean;
        private var lastResult:Object;
        private var startList:Object;
        private var openingListObserved:Object;
        private var listLeft:Boolean;
        private var rewardBox:Object;
        private var rewardDismissRequested:Boolean;
        private var closingBox:Object;
        private var reason:String;

        public function TeamDungeonRun(owner:Sprite, done:Function, progress:Function = null, windowProgress:Object = null)
        {
            this.owner = owner;
            this.done = done;
            this.progress = progress;
            this.windowProgress = windowProgress || {};
        }

        public function get running():Boolean { return phase != null; }

        public function start():void
        {
            if (running) return;
            try
            {
                reason = null;
                startList = openingListObserved = closingBox = rewardBox = lastResult = navigation = null;
                rewardDismissRequested = false;
                fixedRound = true;
                settled = requested = confirmed = resultSeen = lost = false;
                arm("open", DailyRegion.networkWait(45000));
                application = getDefinitionByName("base.ApplicationData").singleton;
                var facade:Object = getDefinitionByName("com.tencent.morefun.framework.apf.core.facade.Facade").getInstance();
                commands = facade.commandManager as IEventDispatcher;
                team = facade.model.retrieveModel(getDefinitionByName("def.ModelDef").TEAM);
                battle = application.getModel("battleStart");
                types = getDefinitionByName("serverProto.fight.FightStartType");
                boxes = getDefinitionByName("com.tencent.morefun.naruto.plugin.ui.box.BoxManager");
                if (owner.stage == null || !solo() || !TeamDungeonProgress.canHandoff(application) ||
                    NativeFightResult.current(owner.stage) != null ||
                    !(battle is IEventDispatcher) || commands == null)
                {
                    finish(DailyQueue.ABORT, "请在角色可操作、单人且未匹配队伍时执行组队副本。");
                    return;
                }
                var top:Object = topBox();
                var previousPanel:Object = windowProgress.teamDungeonClosingPanel;
                if ((top != null && getQualifiedClassName(top) != LIST) ||
                    (previousPanel && previousPanel.stage === owner.stage))
                {
                    finish(DailyQueue.ABORT, "请先关闭当前游戏弹窗，再执行组队副本。");
                    return;
                }
                windowProgress.teamDungeonClosingPanel = null;
                readStartingCount();
                if (before >= GOAL && top == null)
                {
                    finish(DailyQueue.COMPLETE, "组队副本本窗口已完成 3/3。");
                    return;
                }
                boxEvents = boxes.dispathcer as IEventDispatcher;
                boxEvents.addEventListener("boxShow", boxShown);
                boxEvents.addEventListener("boxShowed", boxShown);
                owner.addEventListener(Event.REMOVED_FROM_STAGE, removed);
                commands.addEventListener("commandRequest", commandRequested, false, int.MAX_VALUE);
                battle.addEventListener("update", battleUpdated);
                deadline.addEventListener(TimerEvent.TIMER_COMPLETE, timedOut);
                poll.addEventListener(TimerEvent.TIMER, tick);
                poll.start();
                if (top == null)
                {
                    navigation = TeamDungeonPanel.route();
                    DailyActivity.call(navigation, navigationEnded);
                    if (running && topBox() == null)
                    {
                        reason = unavailableReason();
                        if (reason != null) closeList(null);
                    }
                }
                tick();
            }
            catch (error:Error) { finish(DailyQueue.ABORT, "无法确认组队副本入口。" + error.message); }
        }

        private function solo():Boolean
        {
            return team != null && team.matchDungeonState == "matchDungeonStateEmpty" &&
                (!team.isJoined || (team.isCaptain && team.members != null && team.members.length == 1));
        }

        private function topBox():Object
        {
            var list:Array = boxes.showingList as Array;
            if (list == null) throw new Error("无法读取游戏弹窗。");
            for (var i:int = list.length - 1; i >= 0; i--)
            {
                var box:Object = list[i];
                if (box && box.stage === owner.stage && box.modal && (box.isShowing || box.isShow)) return box;
            }
            return null;
        }

        // These are the two native rejection branches in ViewExecuter.openTeamDungeonPanel.
        private function unavailableReason():String
        {
            try
            {
                var hud:Object = getDefinitionByName("hud.utils.HudUtils");
                var id:int = getDefinitionByName("serverProto.hud.ProtoHudType").PROTO_HUD_TYPE_TEAM_DUNGEON;
                if (!hud.isHudOpened(id))
                {
                    var level:int = hud.hudOpenLevel(id);
                    return level > 0 ? "组队副本" + level + "级开启。" : null;
                }
                var hub:Object = application.getModel(getDefinitionByName("def.ModelDef").ACTIVITY_HUB);
                if (hub && !hub.isDoingByActivityId(101))
                    return "组队副本当前时间段未开放，请查看“限时活动”确认开放时间。";
            }
            catch (error:Error) { }
            return null;
        }

        private function navigationEnded(event:Event):void
        {
            if (!running) return;
            if (event.type == "faild") finish(DailyQueue.ABORT, "游戏未能打开组队副本。");
            else if (DailyRegion.isBR && phase == "open") arm("open", DailyRegion.networkWait(45000));
        }

        private function commandRequested(event:Event):void
        {
            var command:Object = Object(event).command;
            if (!running || command == null) return;
            var name:String = getQualifiedClassName(command);
            if (name == "dungeon.command::OpenTeamDungeonPanelCommand" && (phase == "battle" || phase == "return"))
                listLeft = true;
            if (name == START)
            {
                if (phase != "enter" || !dispatching || requested ||
                    command.dungeonId != dungeonId || command.difficulty != 3)
                {
                    finish(DailyQueue.ABORT, "组队副本开战请求与本次困难卡不符。");
                    return;
                }
                requested = true;
            }
            if (name == "ui.command::ShowErrorMessageCommand" && phase == "enter" && dispatching && command.msg)
                reason = String(command.msg);
        }

        private function boxShown(event:Event):void
        {
            var box:Object = Object(event).box;
            if (event.type == "boxShowed" && box != null && box.stage === owner.stage &&
                getQualifiedClassName(box) == LIST && box !== openingListObserved && (phase == "open" || phase == "return"))
            {
                openingListObserved = box;
                // The native list arriving is a milestone. Renew once for this
                // display instance; duplicate boxShow/boxShowed events and poll
                // ticks must not keep a stalled list alive indefinitely.
                if (DailyRegion.isBR)
                    refreshDeadline(phase == "open" ? DailyRegion.networkWait(45000) : DailyRegion.networkWait(90000));
            }
            else if ((phase == "battle" || phase == "return") && box != null &&
                getQualifiedClassName(box) == REWARD && box.stage === owner.stage && box !== rewardBox)
            {
                observeReward(box);
                // Reward can precede the native battle end. Preserve battle
                // phase so a later failure event still aborts the run.
                if (DailyRegion.isBR)
                    refreshDeadline(phase == "battle" ? DailyRegion.networkWait(600000) : DailyRegion.networkWait(90000));
            }
        }

        private function observeReward(box:Object):void
        {
            rewardBox = box;
            resultSeen = true;
            if (fixedRound || !lost) settleRound();
        }

        private function battleUpdated(event:Event):void
        {
            if (!running) return;
            if (Object(event).key == "start")
            {
                var first:Boolean = phase == "enter" && battle.type == types.FIGHT_START_TYPE_NEW_TEAM_DUNGEON;
                var appended:Boolean = (phase == "battle" || phase == "return") &&
                    battle.type == types.FIGHT_START_TYPE_NEW_TEAM_DUNGEON_APPEND;
                if (!requested || (!first && !appended))
                {
                    finish(DailyQueue.ABORT, "无法确认当前战斗属于本次组队副本。");
                    return;
                }
                resultSeen = lost = false;
                openingListObserved = null;
                arm("battle", DailyRegion.networkWait(600000));
            }
            else if ((Object(event).key == "fight_over" || Object(event).key == "showResult") &&
                phase == "battle" && "isWin" in battle)
            {
                if (DailyRegion.isBR && !resultSeen) refreshDeadline(DailyRegion.networkWait(600000));
                resultSeen = true;
                lost = !battle.isWin;
            }
            else if (Object(event).key == "end" && phase == "battle") arm("return", DailyRegion.networkWait(90000));
            else if (Object(event).key == "fail" && phase == "battle")
                finish(DailyQueue.ABORT, "战斗已中断，未收到组队副本结算。");
        }

        private function tick(event:TimerEvent = null):void
        {
            if (!running) return;
            try
            {
                if (!solo())
                {
                    finish(DailyQueue.ABORT, "队伍或匹配状态已改变，组队副本已中止。");
                    return;
                }
                var top:Object = topBox();
                var name:String = top == null ? "" : getQualifiedClassName(top);
                if (startList && (startList.stage == null || !startList.isShow)) listLeft = true;
                if (phase == "close")
                {
                    if (top == null && (closingBox == null || closingBox.stage == null) &&
                        TeamDungeonProgress.canHandoff(application))
                        finish(reason ? DailyQueue.BLOCKED : DailyQueue.COMPLETE, reason ? reason : "组队副本已完成 3/3。");
                    return;
                }
                if (phase == "open")
                {
                    if (name == LIST && top.isShow && TeamDungeonProgress.canHandoff(application)) prepare(top);
                    return;
                }
                if (phase == "enter")
                {
                    if (reason && (name == LIST || !top) && TeamDungeonProgress.canHandoff(application))
                    {
                        closeList(top);
                        return;
                    }
                    if (name == CONFIRM && !confirmed && !requested && top.isShow)
                    {
                        var button:InteractiveObject = TeamDungeonPanel.confirmButton(top);
                        if (button != null)
                        {
                            confirmed = true;
                            enterClick(button);
                        }
                    }
                    return;
                }
                if (top != null && name != LIST && name != REWARD) return;
                if (name == REWARD)
                {
                    observeReward(top);
                    clickRewardBack(top);
                    return;
                }
                var result:Object = NativeFightResult.current(owner.stage);
                if (result != null)
                {
                    resultSeen = true;
                    lost = result.kind == "fail";
                    var exit:InteractiveObject = NativeFightResult.exitButton(result);
                    if (exit != null && result.ui !== lastResult)
                    {
                        lastResult = result.ui;
                        exit.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true));
                    }
                    return;
                }
                if (!returnedToList(top)) return;
                if (!fixedRound && lost)
                {
                    reason = "组队副本挑战失败。";
                    closeList(top);
                    return;
                }
                var after:int = TeamDungeonProgress.completed();
                if (after > before + 1)
                {
                    finish(DailyQueue.ABORT, "组队副本今日进度发生意外变化。");
                    return;
                }
                settleReturnedRound(after);
                if (!settled) return;
                arm("open", DailyRegion.networkWait(45000));
                prepare(top);
            }
            catch (error:Error) { finish(DailyQueue.ABORT, "无法确认组队副本状态。" + error.message); }
        }

        private function readStartingCount():void
        {
            var latest:int = TeamDungeonProgress.completed();
            if (latest >= 0) fixedRound = false;
            before = Math.min(GOAL, Math.max(int(windowProgress.teamDungeonCount), latest));
            windowProgress.teamDungeonCount = before;
        }

        private function settleRound():void
        {
            if (settled) return;
            settled = true;
            windowProgress.teamDungeonCount = Math.min(GOAL, before + 1);
        }

        private function returnedToList(top:Object):Boolean
        {
            return phase == "return" && top != null && getQualifiedClassName(top) == LIST &&
                (top !== startList || listLeft) && top.isShow &&
                (rewardBox == null || rewardBox.stage == null) && TeamDungeonProgress.canHandoff(application);
        }

        private function settleReturnedRound(after:int):void
        {
            // A final result and a safe return to the list also confirm the round when the daily counter lags.
            if (after == before + 1 || (resultSeen && (fixedRound || !lost))) settleRound();
        }

        private function prepare(list:Object):void
        {
            readStartingCount();
            if (progress != null) progress("组队副本 " + before + "/3");
            if (!running) return;
            if (before >= GOAL) { closeList(list); return; }
            var choice:Object = TeamDungeonPanel.choose(list);
            if (choice.kind == "wait" || choice.kind == "selected") { if (phase != "open") arm("open", DailyRegion.networkWait(45000)); return; }
            if (choice.kind == "blocked") { reason = choice.message; closeList(list); return; }
            if (choice.kind != "ready" || !(choice.button is InteractiveObject) || int(choice.dungeonId) <= 0)
            {
                finish(DailyQueue.ABORT, choice.message ? choice.message : "无法确认困难副本卡。");
                return;
            }
            dungeonId = choice.dungeonId;
            startList = list;
            listLeft = false;
            settled = confirmed = requested = lost = resultSeen = false;
            lastResult = rewardBox = null;
            rewardDismissRequested = false;
            arm("enter", DailyRegion.networkWait(45000));
            enterClick(choice.button);
        }

        /** Let the ready native reward button flip cards and close through its normal lifecycle. */
        private function clickRewardBack(box:Object):void
        {
            if (!running || (phase != "battle" && phase != "return") || box == null ||
                box !== rewardBox || box.stage !== owner.stage || escTopBox() !== box || rewardDismissRequested ||
                !("disableEsc" in box) || Boolean(box.disableEsc))
                return;
            var content:Object = "content" in box ? box.content : null;
            var backButton:InteractiveObject = content && "backBtn" in content ? content.backBtn as InteractiveObject : null;
            if (backButton == null || !backButton.visible || !("enabled" in backButton) ||
                !Boolean(Object(backButton).enabled)) return;
            rewardDismissRequested = true;
            backButton.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true));
        }

        private function escTopBox():Object
        {
            var showing:Array = boxes.showingList as Array;
            if (showing == null) throw new Error("无法读取游戏弹窗顺序。");
            return showing.length > 0 ? showing[showing.length - 1] : null;
        }

        private function enterClick(button:InteractiveObject):void
        {
            dispatching = true;
            try { button.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true)); }
            finally { dispatching = false; }
        }

        private function closeList(list:Object):void
        {
            arm("close", 15000);
            closingBox = list;
            if (list != null) list.close();
        }

        private function arm(next:String, limit:int):void
        {
            phase = next;
            refreshDeadline(limit);
        }

        private function refreshDeadline(limit:int):void
        {
            deadline.reset();
            deadline.delay = limit;
            deadline.start();
        }

        private function timedOut(event:TimerEvent):void
        {
            finish(DailyQueue.ABORT, "等待组队副本" + (phase == "return" ? "结算和今日通关次数更新" :
                phase == "battle" ? "战斗结束" : phase == "enter" ? "单人开战" :
                phase == "close" ? "恢复可操作" : "入口或困难卡") + "超时。");
        }
        private function removed(event:Event):void { finish(DailyQueue.ABORT, "游戏画面已关闭。"); }

        public function cancel():void
        {
            if (phase == "return" && !settled && owner.stage != null && (fixedRound || !lost))
            {
                try
                {
                    var latest:int = TeamDungeonProgress.completed();
                    if (latest == before + 1 || returnedToList(topBox())) settleReturnedRound(latest);
                }
                catch (error:Error) { }
            }
            if (running)
            {
                if (closingBox && closingBox.stage != null) windowProgress.teamDungeonClosingPanel = closingBox;
                else if (rewardBox && rewardBox.stage != null) windowProgress.teamDungeonClosingPanel = rewardBox;
            }
            phase = null;
            poll.stop();
            deadline.stop();
            poll.removeEventListener(TimerEvent.TIMER, tick);
            deadline.removeEventListener(TimerEvent.TIMER_COMPLETE, timedOut);
            owner.removeEventListener(Event.REMOVED_FROM_STAGE, removed);
            if (boxEvents)
            {
                boxEvents.removeEventListener("boxShow", boxShown);
                boxEvents.removeEventListener("boxShowed", boxShown);
            }
            if (commands) commands.removeEventListener("commandRequest", commandRequested);
            if (battle) battle.removeEventListener("update", battleUpdated);
            DailyActivity.removeListener(navigation, navigationEnded);
        }

        private function finish(status:String, message:String):void
        {
            if (!running) return;
            cancel();
            if (done != null) done(status, message);
        }
    }
}
