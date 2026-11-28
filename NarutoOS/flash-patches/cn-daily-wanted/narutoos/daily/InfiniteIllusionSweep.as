package narutoos.daily
{
    import flash.display.Sprite;
    import flash.events.Event;
    import flash.events.TimerEvent;
    import flash.utils.Timer;

    /** Sweeps up to two remaining attempts per unlocked stage, in native order. */
    public final class InfiniteIllusionSweep implements IDailyTask
    {
        private static var unresolvedAttempts:Object = {};
        private static const POLL_MS:int = 150;
        private static const TIMEOUT_MS:int = 60000;

        private var owner:Sprite;
        private var done:Function;
        private var progress:Function;
        private var adapter:Object;
        private var timeoutMs:int;
        private var networkTimeoutMs:int;
        private var hasHandoffTail:Boolean;
        private var deadline:Number;
        private var networkDeadline:Timer;
        private var brWait:Boolean;
        private var poll:Timer;
        private var phase:String;
        private var started:Boolean;
        private var submitted:Boolean;
        private var confirmed:Boolean;
        private var sawConfirmation:Boolean;
        private var sawResult:Boolean;
        private var rewardCloseSent:Boolean;
        private var closeClicked:Boolean;
        private var selectionRequested:Boolean;
        private var currentStage:Object;
        private var beforeCount:int;
        private var beforeList:Object;
        private var attemptRoleKey:String;
        private var stageOrder:Array;
        private var stageAttempts:Object = {};
        private var totalAttempts:int;
        private var waitMessageShown:Boolean;
        private var stopSummary:String;
        private var lastAnyStageOpportunity:*;
        private var lastAutoRaidEnabled:*;

        /** adapter is an offline test seam; production always reads and clicks native UI. */
        public function InfiniteIllusionSweep(owner:Sprite, done:Function, progress:Function = null,
                                              hasHandoffTail:Boolean = true, adapter:Object = null,
                                              timeoutMs:int = TIMEOUT_MS)
        {
            this.owner = owner;
            this.done = done;
            this.progress = progress;
            this.adapter = adapter;
            this.timeoutMs = timeoutMs > 0 ? timeoutMs : TIMEOUT_MS;
            this.hasHandoffTail = hasHandoffTail;
            // The injected adapter is an offline test seam; keep its timeout exact.
            this.brWait = adapter == null && DailyRegion.isBR;
            this.networkTimeoutMs = this.brWait ? DailyRegion.networkWait(this.timeoutMs) : this.timeoutMs;
        }

        public function get running():Boolean { return poll != null; }
        public function get cancellationSummary():String { return stopSummary; }

        public function start():void
        {
            if (started || running) return;
            started = true;
            if (owner == null || owner.stage == null)
            {
                finish(DailyQueue.ABORT, "游戏界面不可用，已停止无限幻象扫荡。");
                return;
            }
            try
            {
                if (adapter == null) adapter = new NativeInfiniteIllusion(owner);
                if (adapter.begin() !== true)
                {
                    finish(DailyQueue.ABORT, "无法安全打开原生无限幻象界面。");
                    return;
                }
                armDeadline();
                phase = "stages";
                owner.addEventListener(Event.REMOVED_FROM_STAGE, removed);
                poll = new Timer(POLL_MS);
                poll.addEventListener(TimerEvent.TIMER, tick);
                poll.start();
                tick(null);
            }
            catch (error:Error)
            {
                finish(DailyQueue.ABORT, "无法读取原生无限幻象状态，已停止。");
            }
        }

        public function cancel():void
        {
            if (!running) return;
            var hasCurrentAttempt:Boolean = currentStage != null && (phase == "result" || phase == "refresh");
            var nativeSubmitted:Boolean = hasCurrentAttempt && adapter != null && adapter.raidWasSubmitted === true;
            var uncertain:Boolean = hasCurrentAttempt && (submitted || nativeSubmitted);
            if (uncertain && attemptRoleKey != null && attemptRoleKey != "")
                unresolvedAttempts[attemptRoleKey] = {dungeonId:int(currentStage.id), beforeCount:beforeCount, listToken:beforeList};
            var pendingDialog:Boolean = !uncertain && phase == "result" && adapter != null;
            var dialogClosed:Boolean = !pendingDialog || adapter.cancelConfirmation() === true;
            if (pendingDialog && !dialogClosed && attemptRoleKey != null && attemptRoleKey != "")
            {
                unresolvedAttempts[attemptRoleKey] = {dungeonId:int(currentStage.id), beforeCount:beforeCount, listToken:beforeList};
                stopSummary = "无限幻象确认框未能安全关闭，已阻止再次提交；请先关闭该原生确认框。";
            }
            stopTimer();
            if (adapter != null) adapter.dispose();
            owner.removeEventListener(Event.REMOVED_FROM_STAGE, removed);
            phase = null;
            if (uncertain) stopSummary = "无限幻象扫荡已提交但次数尚未核实；已停止本轮，请勿立即重试。";
        }

        private function removed(event:Event):void
        {
            finish(DailyQueue.ABORT, submitted && !sawResult ?
                "游戏画面已关闭，扫荡结果尚未核实。" : "游戏画面已关闭，已停止无限幻象扫荡。");
        }

        private function tick(event:TimerEvent):void
        {
            if (!running || (event != null && event.currentTarget !== poll)) return;
            if (timedOut())
            {
                finish(DailyQueue.ABORT, submitted && !sawResult ?
                    "等待无限幻象奖励或次数变化超时，已保留当前画面。" :
                    "等待原生无限幻象状态超时，已保留当前画面。");
                return;
            }

            var state:Object;
            try { state = adapter.snapshot(); }
            catch (error:Error)
            {
                finish(DailyQueue.ABORT, submitted && !sawResult ?
                    "无法核实扫荡结果，已保留当前画面。" : "无法核实原生无限幻象状态，已停止。");
                return;
            }
            if (state == null) return;
            if (state.trusteeshipping === true)
            {
                finish(DailyQueue.ABORT, "游戏托管正在运行，已停止无限幻象扫荡。");
                return;
            }
            if (state.trusteeshipping !== false)
            {
                reportWaiting("幻象 等托管状态");
                return;
            }
            if (state.anyStageOpportunity === true || state.anyStageOpportunity === false)
                lastAnyStageOpportunity = state.anyStageOpportunity;
            if (state.autoRaidEnabled === true || state.autoRaidEnabled === false)
                lastAutoRaidEnabled = state.autoRaidEnabled;
            if ((state.panel == "loading" || state.panel == "absent") && phase != "close" && phase != "handoff")
            {
                reportWaiting("幻象 等界面");
                return;
            }
            if (state.panel == "unknown" || state.topModal == "other")
            {
                finish(DailyQueue.ABORT, "检测到无法识别的游戏界面或弹窗，已保留当前画面并停止队列。");
                return;
            }

            if (phase == "stages")
            {
                if (state.panel != "ready")
                {
                    finish(DailyQueue.ABORT, "无法识别原生无限幻象界面，已停止。");
                    return;
                }
                if (state.listValid !== true)
                {
                    reportWaiting("幻象 等次数");
                    return;
                }
                if (stageOrder == null) stageOrder = buildStageOrder(state.dungeons);
                if (stageOrder == null)
                {
                    reportWaiting("幻象 等次数");
                    return;
                }
                if (!(state.roleKey is String) || state.roleKey == "")
                {
                    finish(DailyQueue.ABORT, "无法确认当前角色，已停止以避免重复扫荡。");
                    return;
                }
                var roleKey:String = String(state.roleKey);
                var unresolvedAttempt:Object = unresolvedAttempts[roleKey];
                if (unresolvedAttempt != null)
                {
                    var pendingStage:Object = stageById(state.dungeons, int(unresolvedAttempt.dungeonId));
                    if (state.listToken !== unresolvedAttempt.listToken && pendingStage != null &&
                        pendingStage.passCount == int(unresolvedAttempt.beforeCount) + 1)
                    {
                        delete unresolvedAttempts[roleKey];
                    }
                    else
                    {
                        finish(DailyQueue.ABORT, "上次无限幻象结果仍待核对；已阻止重复提交，请先处理原生奖励并确认次数刷新。");
                        return;
                    }
                }
                var next:Object = nextStage(state.dungeons);
                if (next != null && next.invalid === true)
                {
                    finish(DailyQueue.ABORT, "无限幻象关卡列表刷新后与本轮计划不符，已停止以避免重复扫荡。");
                    return;
                }
                if (next == null)
                {
                    phase = "close";
                    report("幻象 正在收尾");
                }
                else
                {
                    currentStage = next;
                    selectionRequested = false;
                    phase = "select";
                }
            }

            if (phase == "select")
            {
                var selected:Object = selectedStage(state);
                if (selected != null && selected.id == currentStage.id && selected.index == currentStage.index)
                {
                    phase = "submit";
                }
                else
                {
                    if (selectionRequested) return;
                    if (state.topModal != "none" || adapter.selectStage(int(currentStage.index)) !== true)
                    {
                        finish(DailyQueue.ABORT, "无法选择指定的原生无限幻象关卡，已停止。");
                        return;
                    }
                    selectionRequested = true;
                    reportAttempt("选关");
                    return;
                }
            }

            if (phase == "submit")
            {
                var current:Object = selectedStage(state);
                if (current == null || current.id != currentStage.id || current.index != currentStage.index ||
                    current.unlocked !== true || current.isRadius !== true ||
                    current.passCount !== currentStage.passCount || current.passUpperCount !== currentStage.passUpperCount)
                {
                    finish(DailyQueue.ABORT, "关卡或次数在提交前发生变化，已停止且未扫荡。");
                    return;
                }
                if (state.topModal != "none" || state.raidReady !== true)
                {
                    finish(DailyQueue.ABORT, "原生扫荡按钮不可用或出现未识别弹窗，已停止。");
                    return;
                }
                beforeCount = int(current.passCount);
                beforeList = state.listToken;
                attemptRoleKey = String(state.roleKey);
                confirmed = false;
                sawConfirmation = false;
                sawResult = false;
                rewardCloseSent = false;
                adapter.resetResult();
                phase = "result";
                armDeadline();
                reportAttempt("扫荡");
                if (adapter.clickRaid() !== true)
                {
                    finish(DailyQueue.ABORT, "原生扫荡按钮状态变化，结果未能确认；已停止队列。");
                    return;
                }
                if (adapter.raidWasSubmitted === true)
                {
                    unresolvedAttempts[attemptRoleKey] = {dungeonId:int(currentStage.id), beforeCount:beforeCount, listToken:beforeList};
                    submitted = true;
                }
                return;
            }

            if (phase == "result")
            {
                if (state.raidWasSubmitted === true && !submitted)
                {
                    unresolvedAttempts[attemptRoleKey] = {dungeonId:int(currentStage.id), beforeCount:beforeCount, listToken:beforeList};
                    submitted = true;
                    confirmed = true;
                }
                if (state.topModal == "confirm")
                {
                    sawConfirmation = true;
                    if (!confirmed)
                    {
                        unresolvedAttempts[attemptRoleKey] = {dungeonId:int(currentStage.id), beforeCount:beforeCount, listToken:beforeList};
                        if (adapter.confirm() !== true)
                        {
                            delete unresolvedAttempts[attemptRoleKey];
                            finish(DailyQueue.ABORT, "原生扫荡确认不可用，已保留当前画面。");
                        }
                        else
                        {
                            confirmed = true;
                            submitted = true;
                            if (brWait) armDeadline();
                        }
                    }
                    return;
                }
                if (state.rewardSeen === true || state.topModal == "reward")
                {
                    sawResult = true;
                    phase = "refresh";
                    if (brWait) armDeadline();
                    reportAttempt(state.topModal == "reward" ? "结算" : "等次数");
                }
                else if (state.listToken !== beforeList &&
                    stageById(state.dungeons, int(currentStage.id)) != null &&
                    stageById(state.dungeons, int(currentStage.id)).passCount > beforeCount)
                {
                    sawResult = true;
                    phase = "refresh";
                    if (brWait) armDeadline();
                    reportAttempt("核对");
                }
                else if (state.topModal != "none")
                {
                    finish(DailyQueue.ABORT, "扫荡后出现无法识别的弹窗，结果未核实；已停止队列。");
                    return;
                }
                else if (sawConfirmation && !confirmed)
                {
                    delete unresolvedAttempts[String(state.roleKey)];
                    submitted = false;
                    finish(DailyQueue.ABORT, "扫荡确认已关闭但未收到奖励；可能已取消，已停止队列。");
                    return;
                }
                else return;
            }

            if (phase == "refresh")
            {
                if (state.topModal == "reward")
                {
                    if (!rewardCloseSent && adapter.closeReward() === true)
                    {
                        rewardCloseSent = true;
                        reportAttempt("等次数");
                    }
                    return;
                }
                if (state.topModal != "none" || state.listValid !== true ||
                    state.listToken == null || state.listToken === beforeList) return;
                var updated:Object = stageById(state.dungeons, int(currentStage.id));
                if (updated == null || updated.passCount != beforeCount + 1)
                {
                    finish(DailyQueue.ABORT, "奖励已返回，但刷新后的关卡次数不是预期的 +1；已停止且不会重扫。");
                    return;
                }
                var key:String = String(currentStage.id);
                stageAttempts[key] = int(stageAttempts[key] || 0) + 1;
                totalAttempts++;
                delete unresolvedAttempts[String(state.roleKey)];
                submitted = false;
                if (totalAttempts > 6)
                {
                    finish(DailyQueue.ABORT, "无限幻象扫荡次数超过本轮上限，已停止。");
                    return;
                }
                currentStage = null;
                selectionRequested = false;
                phase = "stages";
                armDeadline();
                report("幻象 已扫" + totalAttempts + "次");
                return;
            }

            if (phase == "close")
            {
                if (state.topModal != "none") return;
                if (state.panel == "absent")
                {
                    if (!hasHandoffTail || state.canHandoff === true) finishHandoff(state);
                    return;
                }
                if (state.panel != "ready") return;
                closeClicked = true;
                phase = "handoff";
                if (adapter.closePanel() !== true)
                    finish(DailyQueue.ABORT, "无法安全关闭原生无限幻象界面。");
                return;
            }

            if (phase == "handoff" && state.panel == "absent" && state.topModal == "none")
            {
                if (!hasHandoffTail || state.canHandoff === true) finishHandoff(state);
            }
        }

        private function buildStageOrder(dungeons:Array):Array
        {
            if (dungeons == null) return null;
            var result:Array = [];
            var totalQuota:int = 0;
            for each (var stage:Object in dungeons)
            {
                if (stage == null || !validCounter(stage.id) || !validCounter(stage.index) ||
                    !(stage.unlocked is Boolean) || !(stage.isRadius is Boolean) ||
                    !validCounter(stage.passCount) || !validCounter(stage.passUpperCount) ||
                    int(stage.passUpperCount) < int(stage.passCount)) return null;
                if (stage.unlocked && stage.isRadius && stage.passCount < stage.passUpperCount && totalQuota < 6)
                {
                    var quota:int = Math.min(int(stage.passUpperCount) - int(stage.passCount), 2, 6 - totalQuota);
                    if (quota > 0)
                    {
                        result.push({id:int(stage.id), index:int(stage.index), quota:quota});
                        totalQuota += quota;
                        stageAttempts[String(stage.id)] = 0;
                    }
                }
            }
            return result;
        }

        private function nextStage(dungeons:Array):Object
        {
            if (stageOrder == null || dungeons == null) return null;
            for each (var planned:Object in stageOrder)
            {
                if (int(stageAttempts[String(planned.id)] || 0) >= int(planned.quota)) continue;
                var current:Object = stageById(dungeons, int(planned.id));
                if (current == null) return {invalid:true};
                if (current.index != planned.index || current.unlocked !== true || current.isRadius !== true ||
                    current.passCount >= current.passUpperCount) return {invalid:true};
                return current;
            }
            return null;
        }

        private function selectedStage(state:Object):Object
        {
            var dungeons:Array = state.dungeons as Array;
            if (dungeons == null || !validCounter(state.selectedIndex) || state.selectedIndex >= dungeons.length) return null;
            var stage:Object = dungeons[int(state.selectedIndex)];
            return stage != null ? stage : null;
        }

        private function stageById(dungeons:Array, id:int):Object
        {
            if (dungeons == null) return null;
            for each (var stage:Object in dungeons)
                if (stage != null && stage.id === id) return stage;
            return null;
        }

        private function reportAttempt(action:String):void
        {
            var attempt:int = int(stageAttempts[String(currentStage.id)]) + 1;
            report((int(currentStage.index) + 1) + "关" + attempt + "次 " + action);
        }

        private function report(message:String):void
        {
            if (progress != null) progress(message);
        }

        private function reportWaiting(message:String):void
        {
            if (waitMessageShown) return;
            waitMessageShown = true;
            report(message);
        }

        private function finishHandoff(state:Object):void
        {
            var autoEnabled:* = state.autoRaidEnabled;
            var opportunity:* = state.anyStageOpportunity;
            if (autoEnabled !== true && autoEnabled !== false) autoEnabled = lastAutoRaidEnabled;
            if (opportunity !== true && opportunity !== false) opportunity = lastAnyStageOpportunity;
            if (!hasHandoffTail || autoEnabled === false || opportunity === false)
            {
                finish(DailyQueue.COMPLETE, totalAttempts > 0 ? "无限幻象已扫荡 " + totalAttempts + " 次。" : "今日没有可扫荡的无限幻象关卡。" );
                return;
            }
            finish(DailyQueue.ABORT, "无限幻象已扫荡 " + totalAttempts + " 次，但托管偏好或剩余次数不明确；为避免重复扫荡，未进入托管。");
        }

        private function stopTimer():void
        {
            if (poll == null) return;
            poll.stop();
            poll.removeEventListener(TimerEvent.TIMER, tick);
            poll = null;
            if (networkDeadline != null) networkDeadline.stop();
            networkDeadline = null;
        }

        private function armDeadline():void
        {
            if (brWait)
            {
                if (networkDeadline == null) networkDeadline = new Timer(networkTimeoutMs, 1);
                else networkDeadline.reset();
                networkDeadline.delay = networkTimeoutMs;
                networkDeadline.start();
            }
            else deadline = new Date().time + timeoutMs;
        }

        private function timedOut():Boolean
        {
            return brWait ? networkDeadline == null || !networkDeadline.running : new Date().time >= deadline;
        }

        private function finish(status:String, message:String):void
        {
            if (!running && done == null) return;
            stopTimer();
            if (adapter != null) adapter.dispose();
            if (owner != null) owner.removeEventListener(Event.REMOVED_FROM_STAGE, removed);
            phase = null;
            var callback:Function = done;
            done = null;
            if (callback != null) callback(status, message);
        }

        private static function validCounter(value:*):Boolean
        {
            return value is Number && value >= 0 && value <= int.MAX_VALUE && value === Math.floor(value);
        }
    }
}
