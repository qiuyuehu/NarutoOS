package
{
    import flash.display.Sprite;
    import flash.external.ExternalInterface;
    import fixture.StrongEvent;
    import fixture.StrongEnvironment;
    import com.tencent.morefun.naruto.plugin.befallDungeon.view.window.BefallDungeonChallengeWindow;
    import com.tencent.morefun.naruto.plugin.ui.box.BoxManager;
    import com.tencent.morefun.naruto.plugin.ui.layer.LayerManager;
    import hud.data.ActivityHubConfig;
    import narutoos.daily.DailyQueue;
    import narutoos.daily.IDailyTask;
    import narutoos.daily.StrongRun;
    import fixture.QueueHandoffTask;
    import flash.utils.getQualifiedClassName;
    import flash.utils.getTimer;
    import task.commands.HrefEventCommand;
    import base.ApplicationData;
    import com.tencent.morefun.naruto.model.event.ModelEvent;
    import def.ModelDef;
    import user.def.UserStateDef;
    import com.tencent.morefun.naruto.plugin.ui.tips.TipsManager;

    public final class StrongFixture extends Sprite
    {
        public static var current:StrongFixture;
        private var owner:Sprite;
        private var run:StrongRun;
        private var windowProgress:Object;
        private var phase:String = "";
        private var startClicks:int;
        private var resultExitClicks:int;
        private var awardClicks:int;
        private var scoreClicks:int;
        private var finished:Array = [];
        private var progress:Array = [];
        private var resultKind:String = "";
        private var queue:DailyQueue;
        private var queueStarted:Array = [];
        private var handoff:Object;
        private var eventOrder:Array = [];
        private var observedDifficulty:String;

        public function StrongFixture()
        {
            current = this;
            ExternalInterface.addCallback("perform", perform);
            owner = new Sprite();
            addChild(owner);
            addChild(LayerManager.singleton.findLayerByName("GameTip"));
            ActivityHubConfig.instance.enabled = true;
            StrongEnvironment.reset();
            StrongEnvironment.target = this;
            HrefEventCommand.navigationTarget = this;
            var keepDefinitions:Array = [ApplicationData.singleton, ModelEvent.UPDATE, ModelDef.TEAM,
                UserStateDef.ACTION_CAN_WALK_TO_DEST, TipsManager.singleton];
        }

        private function perform(action:String, value:String = ""):Object
        {
            if (action == "begin" || action == "resume")
            {
                if (run != null) run.cancel();
                if (action == "begin") windowProgress = {};
                StrongEnvironment.reset();
                finished = [];
                progress = [];
                startClicks = 0;
                resultExitClicks = 0;
                awardClicks = 0;
                scoreClicks = 0;
                resultKind = "";
                observedDifficulty = null;
                eventOrder = [];
                phase = value;
                StrongEnvironment.delayStartAck = value == "delayedStart";
                StrongEnvironment.emptyQuery = value == "empty";
                ActivityHubConfig.instance.enabled = value != "blocked" && value != "unknown";
                ActivityHubConfig.instance.disabledTip = value == "unknown" ? "" : "该难度65级后开启";
                run = new StrongRun(owner, onFinished, onProgress, windowProgress);
                run.start();
            }
            else if (action == "retry")
            {
                if (run != null) run.cancel();
                run = new StrongRun(owner, onFinished, onProgress, windowProgress);
                run.start();
            }
            else if (action == "queue")
            {
                if (run != null) run.cancel();
                StrongEnvironment.reset();
                finished = [];
                progress = [];
                startClicks = resultExitClicks = awardClicks = scoreClicks = 0;
                queueStarted = [];
                handoff = null;
                observedDifficulty = null;
                eventOrder = [];
                run = null;
                ActivityHubConfig.instance.enabled = true;
                queue = new DailyQueue(createQueueTask, onProgress, onQueueFinished);
                queue.start(["strong", "after"]);
            }
            else if (action == "cancel" && run != null) run.cancel();
            else if (action == "result") { resultKind = value; StrongEnvironment.showResult(value); }
            else if (action == "ackStart") StrongEnvironment.acknowledgeBattleStart();
            else if (action == "award") StrongEnvironment.closeResultAndShowAwards();
            else if (action == "snapshot") {}
            return snapshot();
        }

        public function openedChallenge():void { startClicks++; }

        public function onStartButton():void
        {
            startClicks++;
            if (phase == "expired") StrongEnvironment.showClosedTip();
            else StrongEnvironment.startBattle();
        }

        public function onBattleResultExit():void
        {
            resultExitClicks++;
            record("result.exit");
            StrongEnvironment.closeResultAndShowAwards();
        }

        public function onAwardButton():void
        {
            awardClicks++;
            record("award.click");
            StrongEnvironment.closeAwardAndShowScore();
        }

        public function onScoreButton():void
        {
            scoreClicks++;
            record("score.click");
            StrongEnvironment.beginScoreHide();
        }

        public function openNativeChallenge():void
        {
            var box:BefallDungeonChallengeWindow = new BefallDungeonChallengeWindow(ActivityHubConfig.instance.enabled);
            observedDifficulty = box.content.selectedDifficulty;
            addChild(box);
            StrongEnvironment.box = box;
            BoxManager.current = box;
            StrongEnvironment.boxEvents.dispatchEvent(new StrongEvent("boxShow", null, box));
            StrongEnvironment.boxEvents.dispatchEvent(new StrongEvent("boxShowed", null, box));
            record("challenge.show");
            StrongEnvironment.queryChallenge();
        }

        public function record(value:String):void { eventOrder.push(value); }

        private function onFinished(status:String, message:String):void { finished.push({status:status, message:message}); }
        private function onProgress(message:String):void { progress.push(message); }
        private function onQueueFinished(message:String):void { finished.push({status:"queue", message:message}); }

        private function createQueueTask(id:String, done:Function, report:Function, next:Boolean):IDailyTask
        {
            queueStarted.push(id);
            if (id == "strong")
            {
                run = new StrongRun(owner, done, report);
                return run;
            }
            return new QueueHandoffTask(owner, done, recordHandoff, scoreHideFinished);
        }

        private function recordHandoff(value:Object):void { handoff = value; }
        public function scoreHideFinished():Boolean { return eventOrder.indexOf("score.boxHided") >= 0; }

        private function snapshot():Object
        {
            var debug:Object = {};
            var panel:Object = StrongEnvironment.box;
            if (stage != null)
            {
                var layer:Object = stage.getChildByName("fightUI");
                if (layer != null && layer.numChildren > 0)
                {
                    var battle:Object = layer.getChildAt(0);
                    var hud:Object = battle.numChildren > 0 ? battle.getChildAt(0) : null;
                    var resultPos:Object = hud != null && "resultPos" in hud ? hud.resultPos : null;
                    var wrapper:Object = resultPos != null && resultPos.numChildren > 0 ? resultPos.getChildAt(0) : null;
                    var ui:Object = wrapper != null && wrapper.view != null ? wrapper.view.ui : null;
                    if (ui != null) debug = {ui:getQualifiedClassName(ui), visible:ui.visible,
                        primary:buttonState(ui.defaultOkButton), alternate:buttonState(ui.okButton)};
                }
            }
            return {running:run != null && run.running, startClicks:startClicks,
                resultExitClicks:resultExitClicks, awardClicks:awardClicks, scoreClicks:scoreClicks,
                resultKind:resultKind,
                difficulty:observedDifficulty,
                phase:phase, finished:finished, progress:progress, queueStarted:queueStarted,
                handoff:handoff, eventOrder:eventOrder, fightUi:debug,
                panel:panel == null ? null : {name:getQualifiedClassName(panel), isShow:panel.isShow,
                    isShowing:panel.isShowing, onStage:panel.stage != null},
                fighting:StrongEnvironment.battle.isFighting, clock:getTimer()};
        }

        private function buttonState(button:Object):Object
        {
            return button == null ? null : {type:getQualifiedClassName(button), visible:button.visible,
                enabled:button.enabled, mouseEnabled:button.mouseEnabled, onStage:button.stage != null,
                clickListener:button.hasEventListener("click")};
        }
    }
}
