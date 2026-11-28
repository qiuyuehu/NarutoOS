package narutoos.daily
{
    import flash.display.Sprite;
    import flash.events.Event;
    import flash.events.IEventDispatcher;
    import flash.utils.Dictionary;
    import flash.utils.getDefinitionByName;
    import flash.utils.getQualifiedClassName;
    import flash.utils.Timer;
    import flash.events.TimerEvent;

    public final class ExpeditionRun implements IDailyTask
    {
        private static const MAP:String =
            "com.tencent.morefun.naruto.plugin.expeditionary.newExpedition.view::ExpeditionaryMainView";

        private var owner:Sprite;
        private var finished:Function;
        private var progress:Function;
        private var reportedScore:int = -1;
        private var boxes:Object;
        private var events:IEventDispatcher;
        private var view:Object;
        private var map:ExpeditionMap;
        private var battle:ExpeditionBattle;
        private var prepareBattle:Function;
        private var phase:String;
        private var timeout:Timer;
        private var waitingFor:String;
        private var progressStage:String = "";
        private var scoreProgress:String = "";
        private var stageId:uint;
        private var previousScore:int;
        private var previousCount:int;
        private var departedFrom:Object;
        private var leftMap:Boolean;
        private var closed:Boolean;
        private var blockedReason:String;
        private var resultDeadlineRefreshed:Boolean;
        // A canceled run may already have handed an action to the native client.
        // Keep the receipt on that map only, until the game acknowledges it.
        private static const pending:Dictionary = new Dictionary(true);

        public function ExpeditionRun(owner:Sprite, finished:Function, progress:Function = null,
                                      prepareBattle:Function = null)
        {
            this.owner = owner;
            this.finished = finished;
            this.progress = progress;
            this.prepareBattle = prepareBattle;
        }

        public function get running():Boolean { return phase != null; }

        public function start():void
        {
            if (running || !owner.stage) return;
            timeout = new Timer(30000, 1);
            timeout.addEventListener(TimerEvent.TIMER_COMPLETE, onTimeout);
            waitFor("entry", "等待演习地图数据", 30000, true, "进图");
            try
            {
                boxes = getDefinitionByName("com.tencent.morefun.naruto.plugin.ui.box.BoxManager");
                events = boxes.dispathcer as IEventDispatcher;
                // Let the native action adapter identify its own confirmation window first.
                events.addEventListener("boxShow", shown, false, int.MIN_VALUE);
                events.addEventListener("boxHide", hidden);
                events.addEventListener("boxHided", detached);
                owner.addEventListener(Event.ENTER_FRAME, tick);
                owner.addEventListener(Event.REMOVED_FROM_STAGE, removed);
                battle = new ExpeditionBattle(owner);
                for each (var box:Object in boxes.showingList)
                {
                    if (!acceptBox(box)) return;
                }
                if (!view) battle.openMap();
            }
            catch (error:Error) { fail(error); }
        }

        private function waitFor(next:String, description:String, limit:int = 30000, network:Boolean = true,
                                 progressLabel:String = null):void
        {
            phase = next;
            waitingFor = description;
            if (progressLabel != null)
            {
                progressStage = progressLabel;
                if (DailyRegion.isBR) publishProgress();
            }
            timeout.reset();
            // Network phases can be unusually slow in the BR client. Active
            // combat uses its own longer deadline, refreshed only on a
            // verified native result milestone.
            timeout.delay = network ? DailyRegion.networkWait(limit) : limit;
            timeout.start();
        }

        private function onTimeout(event:TimerEvent):void
        {
            if (running && event.currentTarget === timeout)
                finish(DailyQueue.ABORT, waitingFor + "超时，生存演习已停止。");
        }

        private function shown(event:Event):void
        {
            if (!running) return;
            try { acceptBox(Object(event).box); }
            catch (error:Error) { fail(error); }
        }

        private function acceptBox(box:Object):Boolean
        {
            if (box == view || (map && map.ownsPrompt(box)) || (battle && battle.ownsBox(box))) return true;
            if (box.stage === owner.stage && getQualifiedClassName(box) == MAP &&
                ((!view && phase == "entry") || (leftMap && (phase == "fight" || phase == "return"))))
            {
                if (map) map.cancel();
                view = box;
                map = new ExpeditionMap(view);
                leftMap = false;
                if (DailyRegion.isBR && phase == "entry") waitFor("entry", "等待演习地图数据", 30000, true, "数据");
                else if (DailyRegion.isBR && phase == "return") waitFor("return", "等待战后地图、积分和次数更新", 30000, true, "回图");
                return true;
            }
            finish(DailyQueue.ABORT, "遇到其他窗口，生存演习已停止。");
            return false;
        }

        private function hidden(event:Event):void
        {
            if (!running || Object(event).box !== view || phase == "exit") return;
            if (phase == "fight" && view === departedFrom && battle.canLeaveMap)
            {
                leftMap = true;
                return;
            }
            finish(DailyQueue.ABORT, "演习地图已关闭，本次执行已停止。");
        }

        private function detached(event:Event):void
        {
            if (phase == "exit" && Object(event).box === view) closed = true;
        }

        private function removed(event:Event):void { cancel(); }

        private function tick(event:Event):void
        {
            try
            {
                if (phase == "exit")
                {
                    if (closed && !view.stage)
                        finish(blockedReason ? DailyQueue.BLOCKED : DailyQueue.COMPLETE, blockedReason || "生存演习已完成。");
                    return;
                }
                if (phase == "entry" && !view)
                {
                    battle.advance();
                    return;
                }
                if (map && map.advancePrompt()) return;
                if (phase == "fight")
                {
                    var currentBattle:ExpeditionBattle = battle;
                    var state:String = currentBattle.advance();
                    // A native click can synchronously open another window and cancel this run.
                    if (currentBattle !== battle) return;
                    if (state == "returning")
                    {
                        waitFor("return", "等待战后地图、积分和次数更新", 30000, true, "回图");
                    }
                    else if (state == "fighting" && waitingFor != "等待本场战斗结算")
                    {
                        waitFor("fight", "等待本场战斗结算", DailyRegion.networkWait(600000), true, "战斗中");
                    }
                    else if (state == "fighting" && currentBattle.hasResult && !resultDeadlineRefreshed)
                    {
                        // Refresh only once on the verified native result event;
                        // repeated frame polling must not keep a stalled battle alive.
                        resultDeadlineRefreshed = true;
                        if (DailyRegion.isBR) waitFor("fight", "等待本场战斗结算", DailyRegion.networkWait(600000), true, "战斗中");
                    }
                    return;
                }
                if (!map || leftMap || !view.isShow || !view.isShowing || view.stage !== owner.stage) return;
                var data:Object = map.snapshot;
                if (!data) return;
                if (progress != null && reportedScore != data.score)
                {
                    reportedScore = data.score;
                    scoreProgress = reportedScore + "/" + data.maxScore;
                    publishProgress();
                }

                var activeView:Object = view;
                if (phase == "entry" && awaitingPreviousAction(data))
                {
                    finish(DailyQueue.ABORT, "上次操作仍在等待游戏更新。请稍后再执行，或重新打开演习地图。");
                    return;
                }
                if (phase == "entry" && data.resetCount == 1)
                {
                    waitFor("reset", "等待重置后的演习进度", 30000, true, "重置中");
                    if (map.reset()) pending[activeView] = {action: "reset"};
                    else finish(DailyQueue.ABORT, "演习重置按钮不可用。");
                    return;
                }
                if (phase == "reset" && data.resetCount != 0) return;
                if (data.resetCount != 0)
                {
                    finish(DailyQueue.ABORT, "无法确认剩余重置次数，本次演习已停止。");
                    return;
                }
                if (phase == "return" && (view === departedFrom || !battleProgressed(data))) return;
                if (phase == "return") battle.cancel();
                if (phase == "claim" && !(data.score >= data.maxScore && data.rewardTaken)) return;
                if (data.score >= data.maxScore)
                {
                    if (data.rewardTaken)
                    {
                        exitMap();
                    }
                    else
                    {
                        if (phase != "reward") waitFor("reward", "等待满分奖励可领取", 30000, true, "领奖");
                        if (data.rewardCanTake && map.claim())
                        {
                            pending[activeView] = {action: "claim"};
                            if (phase == "reward") waitFor("claim", "等待领奖状态更新", 30000, true, "领奖");
                        }
                    }
                    return;
                }
                if (phase == "reward")
                {
                    finish(DailyQueue.ABORT, "演习积分已改变，本次执行已停止。");
                    return;
                }
                challenge(data);
            }
            catch (error:Error) { fail(error); }
        }

        private function exitMap(reason:String = null):void
        {
            blockedReason = reason;
            waitFor("exit", "等待退出演习地图", 30000, false, "退出");
            if (!map.exit()) finish(DailyQueue.ABORT, "无法关闭演习地图，本轮已停止。");
        }

        private function awaitingPreviousAction(data:Object):Boolean
        {
            var last:Object = pending[view];
            if (!last) return false;
            if (last.action == "reset" && data.resetCount == 1) return true;
            if (last.action == "claim" && !data.rewardTaken) return true;
            if (last.action == "fight")
            {
                for each (var item:Object in data.stages)
                    if (item.stageId == last.stage && item.remainCount >= last.count) return true;
            }
            delete pending[view];
            return false;
        }

        private function battleProgressed(data:Object):Boolean
        {
            if (data.score <= previousScore) return false;
            for each (var item:Object in data.stages)
                if (item.stageId == stageId) return item.remainCount < previousCount;
            return false;
        }

        private function challenge(data:Object):void
        {
            if (!data.lineupUsable)
            {
                finish(DailyQueue.ABORT, "请检查已保存的演习阵容和组队状态，本次执行已停止。");
                return;
            }
            for each (var candidate:Object in data.stages)
            {
                if (!candidate.challengeable) continue;
                if (!candidate.rankKnown)
                {
                    finish(DailyQueue.ABORT, "无法识别可挑战的生存演习关卡星级，请刷新演习数据后重试。");
                    return;
                }
                if (!candidate.scoreValid)
                {
                    finish(DailyQueue.ABORT, "可挑战的生存演习关卡积分无效，已停止以避免无效挑战。");
                    return;
                }
            }
            var choice:Object;
            for each (var item:Object in data.stages)
            {
                if (item.remainCount <= 0 || !item.available) continue;
                if (item.rank == "SS") { choice = item; break; }
                if (choice == null && item.rank == "S") choice = item;
            }
            if (!choice) choice = chooseSupplementalStage(data);
            if (!choice)
            {
                exitMap("生存演习积分尚未满，当前没有可挑战的关卡。");
                return;
            }
            departedFrom = view;
            stageId = choice.stageId;
            previousCount = choice.remainCount;
            previousScore = data.score;
            resultDeadlineRefreshed = false;
            waitFor("fight", "等待本场演习开始", 30000, true, "开战");
            battle.arm(stageId);
            if (prepareBattle != null) prepareBattle();
            var activeView:Object = view;
            if (map.challenge(stageId)) pending[activeView] = {action: "fight", stage: stageId, count: previousCount};
            else finish(DailyQueue.ABORT, "无法使用当前阵容挑战所选关卡。");
        }

        private function publishProgress():void
        {
            if (progress == null) return;
            if (DailyRegion.isBR && progressStage != "")
                progress(progressStage + (scoreProgress == "" ? "" : " 积分 " + scoreProgress));
            else if (scoreProgress != "")
                progress("演习积分 " + scoreProgress);
        }

        private function chooseSupplementalStage(data:Object):Object
        {
            var deficit:int = int(data.maxScore) - int(data.score);
            var bestFit:Object;
            var highest:Object;
            for each (var item:Object in data.stages)
            {
                if (item.remainCount <= 0 || !item.available ||
                    (item.rank != "A" && item.rank != "B" && item.rank != "C")) continue;
                if (highest == null || int(item.score) > int(highest.score) ||
                    (int(item.score) == int(highest.score) && rankOrder(item.rank) < rankOrder(highest.rank)))
                {
                    highest = item;
                }
                if (int(item.score) >= deficit &&
                    (bestFit == null || int(item.score) < int(bestFit.score) ||
                    (int(item.score) == int(bestFit.score) && rankOrder(item.rank) < rankOrder(bestFit.rank))))
                {
                    bestFit = item;
                }
            }
            return bestFit != null ? bestFit : highest;
        }

        private function rankOrder(rank:String):int
        {
            if (rank == "A") return 0;
            if (rank == "B") return 1;
            return 2;
        }

        private function fail(error:Error):void
        {
            if (map && map.actionDeclined) delete pending[view];
            finish(DailyQueue.ABORT, error.errorID ? waitingFor + "时无法读取游戏状态。" : error.message);
        }

        private function finish(status:String, message:String):void
        {
            if (!running) return;
            cancel();
            if (finished != null) finished(status, message);
        }

        public function cancel():void
        {
            phase = null;
            if (timeout != null)
            {
                timeout.stop();
                timeout.removeEventListener(TimerEvent.TIMER_COMPLETE, onTimeout);
                timeout = null;
            }
            owner.removeEventListener(Event.ENTER_FRAME, tick);
            owner.removeEventListener(Event.REMOVED_FROM_STAGE, removed);
            if (events)
            {
                events.removeEventListener("boxShow", shown);
                events.removeEventListener("boxHide", hidden);
                events.removeEventListener("boxHided", detached);
            }
            if (map) map.cancel();
            if (battle) battle.cancel();
            map = null;
            battle = null;
            boxes = null;
            events = null;
            view = null;
            departedFrom = null;
            leftMap = closed = false;
            blockedReason = null;
            reportedScore = -1;
            progressStage = "";
            scoreProgress = "";
            resultDeadlineRefreshed = false;
        }
    }
}
