package
{
    import base.ApplicationData;
    import com.tencent.morefun.naruto.plugin.battle.data.BattleData;
    import com.tencent.morefun.naruto.plugin.battle.data.BattleTypeGroup;
    import com.tencent.morefun.naruto.plugin.battle.view.BattleView;
    import flash.display.Sprite;
    import flash.display.DisplayObject;
    import flash.events.MouseEvent;
    import flash.events.UncaughtErrorEvent;
    import flash.external.ExternalInterface;
    import flash.system.ApplicationDomain;
    import flash.events.TimerEvent;
    import flash.utils.Timer;
    import fixture.AutoBattleProbe;
    import com.tencent.morefun.framework.apf.core.facade.Facade;
    import com.tencent.morefun.naruto.plugin.ui.box.BoxManager;
    import def.BoxFlagDef;
    import def.ModelDef;
    import ai.def.AITypeDef;
    import task.commands.HrefEventCommand;
    import narutoos.daily.DailyAssistant;
    import narutoos.daily.NativeAutoMode;
    import narutoos.daily.QuizRun;
    import narutoos.daily.DailyRegionFixture;
    import fixture.AutoBattleCommandEvent;
    import narutoos.daily.NativeAutoBattle;
    import com.tencent.morefun.naruto.plugin.battle.command.RequestAutoFightCommand;
    import com.tencent.morefun.naruto.plugin.battle.command.NotifyAutoFightCommand;
    import serverProto.fight.FightStartType;

    public final class NativeAutoBattleFixture extends Sprite
    {
        private var owner:Sprite;
        private var helper:NativeAutoBattle;
        private var layer:Sprite;
        private var battleView:BattleView;
        private var completions:int;
        private var scenarioSteps:Array;
        private var stepIndex:int;
        private var scenarioIndex:int;
        private var passes:Array = [];
        private var failures:Array = [];
        private var scenarioNames:Array;
        private var waitTimer:Timer;
        private var dailyAssistant:Sprite;

        public function NativeAutoBattleFixture()
        {
            ExternalInterface.addCallback("run", runSuite);
            loaderInfo.uncaughtErrorEvents.addEventListener(UncaughtErrorEvent.UNCAUGHT_ERROR, onUncaughtError);
            owner = new Sprite();
            addChild(owner);
            var keep:Array = [ApplicationData.singleton, BattleData, BattleTypeGroup,
                FightStartType.FIGHT_START_TYPE_BEFALL_DUNGEON, new BattleView(), DailyAssistant,
                BoxManager, Facade, ModelDef, BoxFlagDef, AITypeDef, HrefEventCommand];
            reset();
        }

        private function runSuite():String
        {
            scenarioIndex = 0;
            scenarioNames = ["cold domain", "existing battle", "first eligible battle only", "already enabled",
                "forced native auto only adds speed", "await native startup and acknowledgments",
                "speed restricted while auto remains available", "temporarily unavailable controls",
                "cancel", "owner removed", "re-arm after completion", "new battle view resets unconfirmed clicks",
                "Daily Assistant wanted prepares first eligible battle", "Daily Assistant quiz does not prepare battle",
                "quiz hands off to auto mode and cancels battle preparation",
                "BR auto challenge waits for its delayed native acknowledgment",
                "Daily Assistant battle settings re-arm on a later execution in the same window",
                "BR in-flight native auto request waits for matching success receipt"];
            passes = [];
            failures = [];
            runScenario();
            return "started";
        }

        private function onUncaughtError(event:UncaughtErrorEvent):void
        {
            event.preventDefault();
            failures.push("uncaught: " + String(event.error));
            ExternalInterface.call("nativeAutoBattleResult",
                JSON.stringify({passes:passes, failures:failures}));
        }

        private function runScenario():void
        {
            if (scenarioIndex >= scenarioNames.length)
            {
                ExternalInterface.call("nativeAutoBattleResult",
                    JSON.stringify({passes:passes, failures:failures}));
                return;
            }
            reset();
            scenarioSteps = buildSteps(scenarioIndex);
            stepIndex = 0;
            nextStep();
        }

        private function nextStep():void
        {
            if (stepIndex >= scenarioSteps.length)
            {
                passes.push(scenarioNames[scenarioIndex]);
                scenarioIndex++;
                runScenario();
                return;
            }
            var step:Object = scenarioSteps[stepIndex++];
            if (step.delay > 0)
            {
                waitTimer = new Timer(int(step.delay), 1);
                waitTimer.addEventListener(TimerEvent.TIMER_COMPLETE, onStepTimer);
                waitTimer.start();
                return;
            }
            try
            {
                step.action();
            }
            catch (error:*)
            {
                failures.push(scenarioNames[scenarioIndex] + ": " + String(error));
            }
            nextStep();
        }

        private function onStepTimer(event:TimerEvent):void
        {
            if (waitTimer != null)
            {
                waitTimer.stop();
                waitTimer.removeEventListener(TimerEvent.TIMER_COMPLETE, onStepTimer);
                waitTimer = null;
            }
            nextStep();
        }

        private function buildSteps(index:int):Array
        {
            switch (index)
            {
                case 0:
                    return [step(dataMissing), step(start), step(enterFight), wait(280), expect(0, 0, 0),
                        step(dataReady), wait(520), expect(1, 1, 1)];
                case 1:
                    return [step(enterFight), step(start), wait(280), expect(0, 0, 0), step(setIdle),
                        wait(170), step(enterFight), wait(520), expect(1, 1, 1)];
                case 2:
                    return [step(start), step(enterFight), wait(520), expect(1, 1, 1), step(setIdle),
                        step(function():void { autoStatus(false); speedStatus(false); }),
                        wait(170), step(enterFight), wait(400), expect(1, 1, 1)];
                case 3:
                    return [step(start), step(enterFight), step(function():void { autoStatus(true); speedStatus(true); }),
                        wait(400), expect(0, 0, 1)];
                case 4:
                    return [step(start), step(enterFight), step(function():void { BattleData.singleton.isAutoChallenge = true; }),
                        wait(400), expect(0, 1, 1)];
                case 5:
                    return [step(start), step(enterFight), step(function():void {
                            BattleTypeGroup.autoEnabled = true;
                            BattleData.singleton.isSpeedUp = true;
                        }), wait(400), expect(0, 0, 0),
                        step(function():void { autoStatus(true); }), wait(280), expect(0, 0, 0),
                        step(function():void { speedStatus(true); }), wait(400), expect(0, 0, 1)];
                case 6:
                    return [step(start), step(enterFight), step(function():void { BattleTypeGroup.allowSpeed = false; }),
                        wait(280), expect(1, 0, 0), step(setIdle), wait(170), step(function():void {
                            BattleTypeGroup.allowSpeed = true;
                            setActive(true, FightStartType.FIGHT_START_TYPE_NEW_TEAM_DUNGEON);
                        }), wait(520), expect(1, 1, 1)];
                case 7:
                    return [step(start), step(enterFight), step(function():void { layer.visible = false; }),
                        wait(280), expect(0, 0, 0), step(function():void {
                            layer.visible = true;
                            AutoBattleProbe.autoButton.disable = true;
                        }), wait(280), expect(0, 1, 0), step(function():void {
                            AutoBattleProbe.autoButton.disable = false;
                            battleView.uiShowing = false;
                        }), wait(280), expect(0, 1, 0), step(function():void {
                            battleView.uiShowing = true;
                            BattleData.singleton.fightState = 4;
                        }), wait(280), expect(0, 1, 0), step(function():void {
                            BattleData.singleton.fightState = BattleData.FIGHT_STATE_FIGHTING;
                        }), wait(520), expect(1, 1, 1)];
                case 8:
                    return [step(start), step(cancelHelper), step(enterFight), wait(400), expect(0, 0, 0)];
                case 9:
                    return [step(start), step(function():void { removeChild(owner); addChild(owner); }),
                        step(enterFight), wait(400), expect(0, 0, 0)];
                case 10:
                    return [step(start), step(enterFight), wait(520), expect(1, 1, 1), step(start),
                        step(function():void { autoStatus(false); speedStatus(false); }),
                        wait(280), expect(1, 1, 1), step(setIdle), wait(170),
                        step(enterFight), wait(520), expect(2, 2, 2)];
                case 12:
                    return [step(function():void { startDaily("wanted", false); }), wait(250),
                        step(enterFight), wait(520), step(function():void { expectDaily(1, 1, false); })];
                case 13:
                    return [step(function():void { startDaily("quiz", false); }), wait(250),
                        step(enterFight), wait(520), step(function():void { expectDaily(0, 0, false); })];
                case 14:
                    return [step(function():void { startDaily("quiz", true); }), wait(250),
                        step(function():void { QuizRun.complete(); }), wait(200),
                        step(function():void { expectDaily(0, 0, true); }), step(enterFight), wait(520),
                        step(function():void { expectDaily(0, 0, true); })];
                case 15:
                    return [step(function():void { DailyRegionFixture.setBR(true); }), step(start), step(enterFight), step(function():void {
                            BattleData.singleton.isAutoChallenge = true;
                            speedStatus(true);
                        }), wait(300), expect(0, 0, 0), step(function():void {
                            autoStatus(true);
                        }), wait(300), expect(0, 0, 1)];
                case 16:
                    return [step(function():void { startDaily("quiz", true, true, true); }), wait(250),
                        step(enterFight), wait(300), step(function():void {
                            autoStatus(true);
                            speedStatus(true);
                        }), wait(300), step(function():void { expectDaily(1, 1, false); }),
                        step(setIdle), step(function():void {
                            autoStatus(false);
                            speedStatus(false);
                            QuizRun.complete();
                        }), wait(220), step(function():void {
                            expectDailyIdle();
                            if (NativeAutoMode.starts == 0) reopenDailyAndExecute();
                        }), wait(250),
                        step(enterFight), wait(300), step(function():void {
                            expectDaily(2, 2, false);
                        })];
                case 17:
                    return [step(function():void { DailyRegionFixture.setBR(true); }), step(start), step(enterFight),
                        step(function():void { speedStatus(true); }),
                        step(function():void { dispatchAutoCommand(new RequestAutoFightCommand()); }),
                        wait(300), expect(0, 0, 0), step(function():void {
                            dispatchAutoCommand(new NotifyAutoFightCommand(true));
                            autoStatus(true);
                            speedStatus(true);
                        }), wait(300), expect(0, 0, 1)];
                default:
                    return [step(start), step(enterFight), step(function():void {
                            AutoBattleProbe.deferAutoAck = true;
                            AutoBattleProbe.deferSpeedAck = true;
                        }), wait(650), expect(1, 1, 0), step(function():void {
                            setIdle();
                            AutoBattleProbe.deferAutoAck = false;
                            AutoBattleProbe.deferSpeedAck = false;
                            enterFight();
                        }), wait(520), expect(2, 2, 1)];
            }
        }

        private function step(action:Function):Object { return {action:action, delay:0}; }
        private function wait(milliseconds:int):Object { return {action:null, delay:milliseconds}; }
        private function expect(autoClicks:int, speedClicks:int, done:int):Object
        {
            return step(function():void
            {
                var expected:String = [autoClicks, speedClicks, done].join(", ");
                var actual:String = [AutoBattleProbe.autoClicks, AutoBattleProbe.speedClicks, completions].join(", ");
                if (actual != expected) throw new Error("auto clicks, speed clicks, completions: expected " + expected + ", got " + actual);
            });
        }

        private function start():void
        {
            if (helper == null) helper = new NativeAutoBattle(owner);
            helper.startNext(function():void
            {
                if (helper.running) throw new Error("helper was still listening at completion");
                completions++;
            });
        }

        private function autoStatus(enabled:Boolean):void
        {
            BattleTypeGroup.autoEnabled = enabled;
            AutoBattleProbe.autoButton.selected = enabled;
        }

        private function speedStatus(enabled:Boolean):void
        {
            BattleData.singleton.isSpeedUp = enabled;
            BattleTypeGroup.speedEnabled = enabled;
            AutoBattleProbe.speedButton.selected = enabled;
        }

        private function cancelHelper():void { if (helper != null) helper.cancel(); }
        private function dataMissing():void
        {
            BattleData.singleton = null;
            ApplicationData.singleton.pluginDomain = new ApplicationDomain(null);
        }
        private function dataReady():void
        {
            ApplicationData.singleton.pluginDomain = ApplicationDomain.currentDomain;
            BattleData.singleton = new BattleData();
            BattleData.singleton.fightType = FightStartType.FIGHT_START_TYPE_BEFALL_DUNGEON;
            BattleData.singleton.fightState = BattleData.FIGHT_STATE_FIGHTING;
        }
        private function setIdle():void { setActive(false, 0); }
        private function enterFight():void { setActive(true, FightStartType.FIGHT_START_TYPE_BEFALL_DUNGEON); }

        private function startDaily(taskId:String, battleSettings:Boolean, disableAutoModeAfterDaily:Boolean = false,
                                    brazil:Boolean = false):void
        {
            ApplicationData.singleton.pluginDomain = ApplicationDomain.currentDomain;
            ApplicationData.singleton.selfInfo = { uin: scenarioIndex + 10, svrId: 1, role: 0, level: 80 };
            BattleData.singleton = new BattleData();
            BattleTypeGroup.autoEnabled = false;
            BattleTypeGroup.speedEnabled = false;
            QuizRun.reset();
            if (brazil) DailyAssistant.installBR(owner, 0, 0);
            else DailyAssistant.install(owner, 0, 0);
            dailyAssistant = owner.getChildByName("narutoosDailyAssistant") as Sprite;
            var controls:Sprite = dailyAssistant.getChildByName("dailyControls") as Sprite;
            controls.getChildByName("entry").dispatchEvent(new MouseEvent(MouseEvent.CLICK, true));
            var modal:Sprite = owner.stage.getChildByName("dailyAssistantModal") as Sprite;
            var panel:Sprite = modal.getChildByName("panel") as Sprite;
            var taskChoice:Sprite = panel.getChildByName(taskId) as Sprite;
            if (taskChoice.accessibilityProperties.description != "已勾选")
                taskChoice.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true));
            var settingsChoice:Sprite = panel.getChildByName("battleSettings") as Sprite;
            if (battleSettings && settingsChoice.accessibilityProperties.description != "已勾选")
                panel.getChildByName("battleSettings").dispatchEvent(new MouseEvent(MouseEvent.CLICK, true));
            else if (!battleSettings && settingsChoice.accessibilityProperties.description == "已勾选")
                panel.getChildByName("battleSettings").dispatchEvent(new MouseEvent(MouseEvent.CLICK, true));
            var autoModeChoice:Sprite = panel.getChildByName("autoModeAfterDaily") as Sprite;
            if (disableAutoModeAfterDaily && autoModeChoice != null &&
                autoModeChoice.accessibilityProperties.description == "已勾选")
                autoModeChoice.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true));
            panel.getChildByName("execute").dispatchEvent(new MouseEvent(MouseEvent.CLICK, true));
        }

        private function reopenDailyAndExecute():void
        {
            var controls:Sprite = dailyAssistant.getChildByName("dailyControls") as Sprite;
            controls.getChildByName("entry").dispatchEvent(new MouseEvent(MouseEvent.CLICK, true));
            var modal:Sprite = owner.stage.getChildByName("dailyAssistantModal") as Sprite;
            var panel:Sprite = modal.getChildByName("panel") as Sprite;
            panel.getChildByName("execute").dispatchEvent(new MouseEvent(MouseEvent.CLICK, true));
        }

        private function expectDailyIdle():void
        {
            var controls:Sprite = dailyAssistant.getChildByName("dailyControls") as Sprite;
            var stop:Sprite = dailyAssistant.getChildByName("narutoosDailyRuntimeControls") as Sprite;
            if (NativeAutoMode.starts != 0 || controls == null || !controls.visible ||
                (stop != null && stop.visible))
                throw new Error("quiz did not finish without auto-mode handoff: starts=" + NativeAutoMode.starts
                    + ", entry=" + (controls != null ? controls.visible : "missing")
                    + ", stop=" + (stop != null ? stop.visible : "missing"));
        }

        private function dispatchAutoCommand(command:Object):void
        {
            Facade.getInstance().commandManager.dispatchEvent(
                new AutoBattleCommandEvent("commandExecute", command));
        }

        private function expectDaily(autoClicks:int, speedClicks:int, reachedAutoMode:Boolean):void
        {
            var actual:String = [AutoBattleProbe.autoClicks, AutoBattleProbe.speedClicks].join(", ");
            var expected:String = [autoClicks, speedClicks].join(", ");
            if (actual != expected) throw new Error("Daily Assistant battle clicks: expected " + expected + ", got " + actual);
            if (reachedAutoMode)
            {
                var controls:Sprite = owner.stage.getChildByName("narutoosDailyRuntimeControls") as Sprite;
                if (NativeAutoMode.starts != 1 || controls == null || !controls.visible)
                    throw new Error("quiz did not hand off to active native auto-mode: starts=" + NativeAutoMode.starts
                        + ", controls=" + (controls != null ? controls.visible : "missing")
                        + ", queue=" + (dailyAssistant != null ? Object(dailyAssistant).toString() : "missing"));
            }
        }

        private function setActive(value:Boolean, fightType:int):void
        {
            ApplicationData.singleton.battle.isFighting = value;
            if (BattleData.singleton != null)
            {
                BattleData.singleton.fightState = value ? BattleData.FIGHT_STATE_FIGHTING : 0;
                BattleData.singleton.fightType = fightType;
            }
            if (value && layer == null)
            {
                layer = new Sprite();
                layer.name = "fightUI";
                battleView = new BattleView();
                layer.addChild(battleView);
                AutoBattleProbe.autoButton.selected = BattleTypeGroup.autoEnabled;
                AutoBattleProbe.speedButton.selected = BattleTypeGroup.speedEnabled;
                owner.stage.addChild(layer);
            }
            else if (!value && layer != null && layer.parent != null)
            {
                layer.parent.removeChild(layer);
                layer = null;
                battleView = null;
                if (BattleData.singleton != null) BattleData.singleton.isSpeedUp = false;
            }
        }

        private function reset():void
        {
            cancelHelper();
            if (dailyAssistant != null && dailyAssistant.parent != null) dailyAssistant.parent.removeChild(dailyAssistant);
            dailyAssistant = null;
            var oldModal:DisplayObject = owner.stage != null ? owner.stage.getChildByName("dailyAssistantModal") : null;
            if (oldModal != null && oldModal.parent != null) oldModal.parent.removeChild(oldModal);
            BoxManager.reset();
            if (layer != null && layer.parent != null) layer.parent.removeChild(layer);
            layer = null;
            battleView = null;
            ApplicationData.singleton.pluginDomain = ApplicationDomain.currentDomain;
            ApplicationData.singleton.battle.isFighting = false;
            BattleData.singleton = new BattleData();
            BattleTypeGroup.autoEnabled = false;
            BattleTypeGroup.speedEnabled = false;
            BattleTypeGroup.allowAuto = true;
            BattleTypeGroup.allowSpeed = true;
            AutoBattleProbe.autoClicks = 0;
            AutoBattleProbe.speedClicks = 0;
            AutoBattleProbe.autoButton = null;
            AutoBattleProbe.speedButton = null;
            AutoBattleProbe.deferAutoAck = false;
            AutoBattleProbe.deferSpeedAck = false;
            NativeAutoMode.starts = 0;
            DailyRegionFixture.setBR(false);
            QuizRun.reset();
            completions = 0;
        }
    }
}
