package narutoos.daily
{
    import flash.display.InteractiveObject;
    import flash.display.Sprite;
    import flash.events.Event;
    import flash.events.MouseEvent;
    import flash.events.TimerEvent;
    import flash.utils.Timer;
    import flash.utils.getDefinitionByName;

    /** Owns one acceptance or refresh at a time, through the original escort UI. */
    public final class EscortTask implements IDailyTask
    {
        private static const S:int = 4;
        private static const SS:int = 5;
        private var owner:Sprite;
        private var done:Function;
        private var progress:Function;
        private var grade:int;
        private var windowProgress:Object;
        private var handleActiveS:Boolean;
        private var application:Object;
        private var panel:EscortNativePanel;
        private var transit:EscortTransit;
        private var rewardPopup:EscortRewardPopup;
        private var poll:Timer = new Timer(400);
        private var deadline:Timer = new Timer(45000, 1);
        private var phase:String;
        private var order:int;
        private var orderGrade:int;
        private var resumeRoute:Boolean;
        private var refreshBefore:int;
        private var receiptWait:Timer = new Timer(45000, 1);
        private var departed:Boolean;
        private var submittedFromList:Boolean;
        private var fromAccept:Boolean;
        private var outcomes:Array;
        private var finalStatus:String;
        private var finalMessage:String;

        public function EscortTask(owner:Sprite, done:Function, progress:Function = null,
                                   grade:int = 5, windowProgress:Object = null, handleActiveS:Boolean = false)
        {
            this.owner = owner;
            this.done = done;
            this.progress = progress;
            this.grade = grade;
            this.windowProgress = windowProgress || {};
            this.handleActiveS = handleActiveS;
        }

        public function get running():Boolean { return phase != null; }

        public function start():void
        {
            if (running) return;
            arm("inspect");
            try
            {
                if (!owner.stage) throw new Error("游戏画面尚未就绪。");
                application = getDefinitionByName("base.ApplicationData").singleton;
                panel = new EscortNativePanel(owner, grade);
                transit = new EscortTransit(owner);
                rewardPopup = new EscortRewardPopup(owner);
                receiptWait.delay = DailyRegion.networkWait(45000);
                order = 0;
                departed = fromAccept = false;
                outcomes = [];
                owner.addEventListener(Event.REMOVED_FROM_STAGE, removed);
                deadline.addEventListener(TimerEvent.TIMER_COMPLETE, timedOut);
                receiptWait.addEventListener(TimerEvent.TIMER_COMPLETE, receiptTimedOut);
                poll.addEventListener(TimerEvent.TIMER, tick);
                poll.start();
                tick();
            }
            catch (error:Error) { finish(DailyQueue.ABORT, "无法启动 " + label(grade) + "。" + error.message); }
        }

        private function tick(event:TimerEvent = null):void
        {
            if (!running) return;
            try
            {
                if (phase == "after" && rewardPopup != null)
                {
                    if (rewardPopup.step()) return;
                    rewardPopup.disarm();
                }
                var state:Object = transit.read(grade, handleActiveS && !windowProgress.escortSDone);
                if (state.kind == "other")
                {
                    finish(DailyQueue.ABORT, grade == S && state.hard == SS ?
                        "当前有在途 SS 镖单，已保留，S 级押镖本轮中止。" : "当前持有其他镖单，已保留现场。");
                    return;
                }
                // A task NPC can hold the native walk lock while its own menu remains usable.
                // Scene transitions, active fights and a visible result still block all clicks.
                var canAct:Boolean = sceneReady() && NativeFightResult.current(owner.stage) == null;
                if (canAct) panel.stepEntry(phase == "open" && state.kind == "none");
                if (!running) return;
                var view:String = panel.view();
                if (phase == "transit")
                {
                    if (canAct || state.kind == "ended") follow(state, view);
                    return;
                }
                if (state.kind == "unknown") return;
                if (state.kind == "active" || state.kind == "settling")
                {
                    if (int(state.id) <= 0 || (order != 0 && order != int(state.id)) || phase == "close")
                    {
                        finish(DailyQueue.ABORT, "当前镖单与本次操作不符。");
                        return;
                    }
                    fromAccept = phase == "accept";
                    departed = submittedFromList = false;
                    order = int(state.id);
                    orderGrade = int(state.hard);
                    if (orderGrade == S && !trackS(state)) return;
                    // A final delivery can outlive the last free acceptance.
                    arm("transit", 32 * 60 * 1000);
                    report(label(orderGrade) + " · 在途");
                    if (running && canAct) follow(state, view);
                    return;
                }
                if (!canAct || state.kind != "none" || phase == "accept") return;
                if (view == "clear" && !TeamDungeonProgress.canHandoff(application)) return;

                if (phase == "close")
                {
                    if (view == "clear") finish(finalStatus, finalMessage);
                    return;
                }
                if ((grade == S || handleActiveS) && !windowProgress.escortSDone && windowProgress.escortS != null)
                {
                    if (!windowProgress.escortS.received)
                    {
                        finish(DailyQueue.ABORT, "本窗口已发起 S 镖接单，仍待确认原生接单状态。");
                        return;
                    }
                    completeS();
                }
                if (grade == S && windowProgress.escortSDone)
                {
                    if (view == "clear" || view == "list")
                        conclude(DailyQueue.COMPLETE, outcomes.length == 0 ? "本窗口已接过一单 S 镖。" : "", view);
                    return;
                }
                if (phase == "inspect" || phase == "after")
                {
                    if (view == "clear")
                    {
                        var reason:String = panel.unavailableReason();
                        if (reason) { conclude(DailyQueue.BLOCKED, reason, view); return; }
                        arm("open");
                        panel.open();
                        return;
                    }
                    if (view != "list") return;
                    arm("open");
                }
                if (view != "list") return;
                var offer:Object = panel.offer();
                if (offer.kind == "wait") return;
                if (phase == "refresh" && (offer.refreshLeft == null ||
                    int(offer.refreshLeft) >= refreshBefore)) return;
                if (offer.kind == "complete" || offer.kind == "blocked")
                {
                    conclude(offer.kind == "complete" ? DailyQueue.COMPLETE : DailyQueue.BLOCKED,
                             String(offer.message), view);
                    return;
                }
                var button:InteractiveObject = offer.button as InteractiveObject;
                if (button == null || !(offer.freeAcceptLeft > 0)) throw new Error("无法确认免费押镖操作。");
                if (offer.kind == "refresh" && offer.refreshLeft > 0)
                {
                    refreshBefore = int(offer.refreshLeft);
                    arm("refresh");
                    report(label(grade) + " · 免费刷新");
                }
                else if (offer.kind == "accept" && offer.id > 0 && offer.canAcceptFree === true)
                {
                    order = int(offer.id);
                    arm("accept");
                    report(label(grade) + " · 接单");
                }
                else throw new Error("无法识别押镖任务卡。");
                if (running)
                {
                    panel.clickOffer(offer);
                    if (grade == S && offer.kind == "accept") windowProgress.escortS = {id:order, received:false};
                }
            }
            catch (error:Error) { finish(DailyQueue.ABORT, "无法确认" + label(grade) + "状态。" + error.message); }
        }

        private function trackS(state:Object):Boolean
        {
            var saved:Object = windowProgress.escortS;
            if (windowProgress.escortSDone || (saved && !matchesSOrder(saved, state)))
            {
                finish(DailyQueue.ABORT, "当前 S 镖单与本窗口记录不符，已保留现场。");
                return false;
            }
            if (!saved) saved = windowProgress.escortS = {id:order};
            saved.received = true;
            if (state.receivedAt) saved.receivedAt = state.receivedAt;
            departed = Boolean(saved.departed);
            submittedFromList = Boolean(saved.submitted);
            resumeRoute = true;
            return true;
        }

        private function matchesSOrder(saved:Object, state:Object):Boolean
        {
            return int(state.hard) == S && int(saved.id) == int(state.id) &&
                (!saved.receivedAt || !state.receivedAt || saved.receivedAt == state.receivedAt);
        }

        private function completeS():void
        {
            windowProgress.escortSDone = true;
            windowProgress.escortS = null;
        }

        private function follow(state:Object, view:String):void
        {
            // A momentarily empty task list is not a delivery receipt.
            if (state.kind == "unknown" || state.kind == "none")
            {
                if (!receiptWait.running) receiptWait.start();
                return;
            }
            if (int(state.id) != order)
            {
                finish(DailyQueue.ABORT, "在途镖单发生变化，已停止押镖。");
                return;
            }
            if (state.kind == "ended")
            {
                var prefix:String = orderGrade == S ? "S" : "SS";
                var messages:Object = {completed:prefix + " 镖单已送达。", failed:prefix + " 镖单失败。",
                    removed:"游戏已移除本次镖单。", expired:prefix + " 镖单已过期。"};
                var outcome:String = state.message ? String(state.message) : messages[state.outcome];
                outcomes.push(outcome ? outcome : "本单已结束。");
                if (orderGrade == S) completeS();
                if (state.outcome == "completed") rewardPopup.arm();
                else rewardPopup.disarm();
                receiptWait.reset();
                order = 0;
                transit.cancel();
                transit = new EscortTransit(owner);
                arm("after");
                report(label(grade) + (grade == S ? " · 本单已结束" : " · 核对余量"));
                return;
            }
            var settlingInList:Boolean = state.kind == "settling" && view == "list";
            if (settlingInList || (state.kind == "active" && (view == "list" || view == "support")))
            {
                if (!receiptWait.running) receiptWait.start();
                if (settlingInList ? submittedFromList : departed) return;
                var button:InteractiveObject = panel.dispatchButton(order, orderGrade);
                if (button != null)
                {
                    if (settlingInList) submittedFromList = true;
                    else
                    {
                        departed = true;
                        resumeRoute = false;
                    }
                    rememberSControls();
                    click(button);
                }
                return;
            }
            receiptWait.reset();
            // The transit adapter checks the owned order, battle, movement and top
            // popup again before following a route or collecting the delivery.
            var sRecord:Object = orderGrade == S ? windowProgress.escortS : null;
            if (transit.advance(order, (fromAccept && !departed) || (orderGrade == S && resumeRoute),
                orderGrade, sRecord) && state.kind == "active")
            {
                departed = true;
                resumeRoute = false;
                rememberSControls();
            }
        }

        private function rememberSControls():void
        {
            if (orderGrade != S) return;
            windowProgress.escortS.departed = departed;
            windowProgress.escortS.submitted = submittedFromList;
        }

        private function label(hard:int):String { return (hard == S ? "S" : "SS") + " 押镖"; }

        private function sceneReady():Boolean
        {
            var world:Object = application.globelInfo;
            var battle:Object = application.getModel("battleStart");
            return world != null && world.sceneId > 0 && world.sceneId == world.sceneToId &&
                !application.isFightLock && battle != null && !battle.isFighting;
        }

        private function conclude(status:String, message:String, view:String):void
        {
            finalStatus = status;
            finalMessage = (message ? outcomes.concat([message]) : outcomes).join(" ");
            arm("close", 15000);
            if (view == "list") panel.close();
        }

        private function click(button:InteractiveObject):void
        {
            button.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true));
        }

        private function report(message:String):void
        {
            if (progress != null) progress(message);
        }

        private function arm(next:String, limit:int = 45000):void
        {
            phase = next;
            deadline.reset();
            deadline.delay = DailyRegion.networkWait(limit);
            deadline.start();
        }

        private function timedOut(event:TimerEvent):void
        {
            var waiting:Object = {inspect:"在途状态", open:"押镖面板", refresh:"免费刷新回执",
                accept:"接单回执", transit:"本单结算", after:"角色恢复可操作", close:"退出押镖面板"};
            finish(DailyQueue.ABORT, "等待 " + label(phase == "transit" ? orderGrade : grade) + waiting[phase] + "超时，已保留当前画面。");
        }

        private function receiptTimedOut(event:TimerEvent):void
        {
            finish(DailyQueue.ABORT, "等待本单状态或原生押送控件超时，已保留当前画面。");
        }

        private function removed(event:Event):void { finish(DailyQueue.ABORT, "游戏画面已关闭。"); }

        public function cancel():void
        {
            var saved:Object = windowProgress.escortS;
            if (running && transit && saved && (grade == S || handleActiveS))
            {
                // An acknowledgement can arrive between the last poll and the stop click.
                var state:Object = transit.read(S);
                if (matchesSOrder(saved, state))
                {
                    if (state.kind == "ended") completeS();
                    else if (state.kind == "active" || state.kind == "settling")
                    {
                        saved.received = true;
                        if (state.receivedAt) saved.receivedAt = state.receivedAt;
                    }
                }
            }
            phase = null;
            poll.stop();
            deadline.stop();
            receiptWait.reset();
            receiptWait.removeEventListener(TimerEvent.TIMER_COMPLETE, receiptTimedOut);
            poll.removeEventListener(TimerEvent.TIMER, tick);
            deadline.removeEventListener(TimerEvent.TIMER_COMPLETE, timedOut);
            owner.removeEventListener(Event.REMOVED_FROM_STAGE, removed);
            if (panel) panel.cancel();
            if (transit) transit.cancel();
            rewardPopup = null;
        }

        private function finish(status:String, message:String):void
        {
            if (!running) return;
            cancel();
            if (done != null) done(status, message);
        }
    }
}
