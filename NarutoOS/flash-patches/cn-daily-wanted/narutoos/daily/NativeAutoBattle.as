package narutoos.daily
{
    import flash.display.DisplayObject;
    import flash.display.DisplayObjectContainer;
    import flash.display.Sprite;
    import flash.events.Event;
    import flash.events.MouseEvent;
    import flash.system.ApplicationDomain;
    import flash.utils.getDefinitionByName;
    import flash.utils.getQualifiedClassName;
    import flash.utils.Timer;
    import flash.events.TimerEvent;

    /** Applies the next eligible battle's native auto-fight and speed controls. */
    public final class NativeAutoBattle
    {
        private static const BATTLE_DATA:String = "com.tencent.morefun.naruto.plugin.battle.data.BattleData";
        private static const BATTLE_TYPE_GROUP:String = "com.tencent.morefun.naruto.plugin.battle.data.BattleTypeGroup";
        private static const BATTLE_VIEW:String = "com.tencent.morefun.naruto.plugin.battle.view::BattleView";
        private static const BATTLE_VIEW_UI:String = "ui.battle::BattleViewUI";
        private static const BASE_BUTTON:String = "com.tencent.morefun.naruto.plugin.ui.base::BaseButton";
        private static const BATTLE_MODEL:String = "battleStart";
        private static const POLL_INTERVAL:int = 120;

        private var owner:Sprite;
        private var armed:Boolean;
        private var roundView:DisplayObjectContainer;
        private var autoClicked:Boolean;
        private var speedClicked:Boolean;
        private var onDone:Function;
        private var pollTimer:Timer;

        public function NativeAutoBattle(owner:Sprite)
        {
            this.owner = owner;
        }

        public function get running():Boolean
        {
            return pollTimer != null;
        }

        /** Waits for idle first so an already active battle is left alone. */
        public function startNext(done:Function = null):void
        {
            if (running || owner == null || owner.stage == null)
            {
                return;
            }

            onDone = done;
            owner.addEventListener(Event.REMOVED_FROM_STAGE, onOwnerRemoved);
            pollTimer = new Timer(POLL_INTERVAL);
            pollTimer.addEventListener(TimerEvent.TIMER, onPoll);
            pollTimer.start();
            safeTick();
        }

        public function cancel():void
        {
            if (!running)
            {
                return;
            }
            pollTimer.stop();
            pollTimer.removeEventListener(TimerEvent.TIMER, onPoll);
            pollTimer = null;
            owner.removeEventListener(Event.REMOVED_FROM_STAGE, onOwnerRemoved);
            armed = false;
            onDone = null;
            setRound(null);
        }

        private function onOwnerRemoved(event:Event):void
        {
            cancel();
        }

        private function onPoll(event:TimerEvent):void
        {
            safeTick();
        }

        private function safeTick():void
        {
            try
            {
                tick();
            }
            catch (error:*)
            {
                // Native plugin domains can appear between polls; unknown state is a no-op.
            }
        }

        private function tick():void
        {
            if (!running || owner.stage == null)
            {
                return;
            }

            var state:Object = readState();
            if (state == null)
            {
                return;
            }
            if (!state.active)
            {
                armed = true;
                setRound(null);
                return;
            }
            if (!armed || !state.ready)
            {
                return;
            }

            var data:Object = state.data;
            if (data.isWatch || data.isReplay || data.isSharedReplaying ||
                NativeFightResult.current(owner.stage) != null)
            {
                return;
            }

            var battleView:DisplayObjectContainer = findBattleView(owner.stage);
            if (battleView == null || !Object(battleView).getUIIsShowing())
            {
                return;
            }
            if (roundView !== battleView)
            {
                setRound(battleView);
            }

            var groupType:Object = state.domain.getDefinition(BATTLE_TYPE_GROUP);
            var fightType:int = int(data.fightType);
            var skillPanel:DisplayObjectContainer = findSkillPanel(battleView);
            var autoButton:Object = findButton(skillPanel, "autoFight");
            var speedButton:Object = findButton(skillPanel, "speedUpBtn");
            var autoUsable:Boolean = isUsableButton(autoButton) && groupType.isEnableAutoType(fightType);
            var speedUsable:Boolean = isUsableButton(speedButton) && groupType.isEnableSpeedType(fightType);
            var nativeAuto:Boolean = autoUsable && groupType.getAutoStatus(fightType);
            var nativeSpeed:Boolean = speedUsable && groupType.getSpeedStatus(fightType);
            var autoReady:Boolean = data.isAutoChallenge || (nativeAuto && autoButton.selected);
            var speedReady:Boolean = nativeSpeed && speedButton.selected;
            if (autoReady && speedReady)
            {
                var done:Function = onDone;
                cancel();
                if (done != null) done();
                return;
            }

            // Native startup and player clicks can update the button and model at
            // different times. Wait for agreement before sending a toggle.
            if (autoUsable && !autoClicked && !data.isAutoChallenge && !nativeAuto && !autoButton.selected)
            {
                autoClicked = true;
                autoButton.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true, false));
                return;
            }
            // isSpeedUp is set on request. Only the acknowledged model and button
            // confirm the new setting, but a native request already in flight is enough to wait.
            if (speedUsable && !speedClicked && !data.isSpeedUp && !nativeSpeed && !speedButton.selected)
            {
                speedClicked = true;
                speedButton.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true, false));
            }
        }

        private function setRound(view:DisplayObjectContainer):void
        {
            roundView = view;
            autoClicked = false;
            speedClicked = false;
        }

        private function readState():Object
        {
            try
            {
                var applicationType:Class = getDefinitionByName("base.ApplicationData") as Class;
                var application:Object = applicationType.singleton;
                var battleModel:Object = application.getModel(BATTLE_MODEL);
                if (battleModel == null || !("isFighting" in battleModel))
                {
                    return null;
                }

                // ApplicationData's battle model exists before BattlePlugin is loaded.
                // Its explicit idle state is enough to arm, but never enough to click.
                var pluginInfo:Object = application.getPluginInfo("battle.IBattlePlugin");
                var domain:ApplicationDomain = pluginInfo != null ? pluginInfo.domain as ApplicationDomain : null;
                var data:Object;
                var dataType:Class;
                if (domain != null && domain.hasDefinition(BATTLE_DATA))
                {
                    dataType = domain.getDefinition(BATTLE_DATA) as Class;
                    data = dataType.singleton;
                }
                if (data != null && !("fightState" in data))
                {
                    return null;
                }
                var activeBattle:Boolean = Boolean(battleModel.isFighting) ||
                    (data != null && int(data.fightState) != 0);
                var ready:Boolean = data != null && int(data.fightState) == int(dataType.FIGHT_STATE_FIGHTING);
                return {data:data, domain:domain, active:activeBattle, ready:ready};
            }
            catch (error:Error)
            {
                return null;
            }
            return null;
        }

        private function findBattleView(stage:Object):DisplayObjectContainer
        {
            var layer:DisplayObjectContainer = stage.getChildByName("fightUI") as DisplayObjectContainer;
            return NativeFightResult.directChild(layer, BATTLE_VIEW);
        }

        private function findSkillPanel(battleView:DisplayObjectContainer):DisplayObjectContainer
        {
            var viewUI:DisplayObjectContainer = NativeFightResult.directChild(battleView, BATTLE_VIEW_UI);
            if (viewUI == null || !viewUI.visible || !("skillPanelView" in viewUI))
            {
                return null;
            }
            return Object(viewUI).skillPanelView as DisplayObjectContainer;
        }

        private function findButton(skillPanel:DisplayObjectContainer, skinName:String):Object
        {
            if (skillPanel == null || !(skinName in skillPanel))
            {
                return null;
            }
            var skin:DisplayObject = Object(skillPanel)[skinName] as DisplayObject;
            if (skin == null)
            {
                return null;
            }

            var match:Object;
            for (var i:int = 0; i < skillPanel.numChildren; i++)
            {
                var child:Object = skillPanel.getChildAt(i);
                if (getQualifiedClassName(child) == BASE_BUTTON && child.skin === skin)
                {
                    if (match != null)
                    {
                        return null;
                    }
                    match = child;
                }
            }
            return match;
        }

        private function isUsableButton(button:Object):Boolean
        {
            if (button == null || !isVisibleThroughAncestors(button as DisplayObject))
            {
                return false;
            }
            return button.stage === owner.stage && button.visible && button.mouseEnabled &&
                button.hasEventListener(MouseEvent.CLICK) && ("selected" in button) &&
                ("disable" in button) && !Boolean(button.disable) &&
                button.skin != null && button.skin.visible;
        }

        private function isVisibleThroughAncestors(target:DisplayObject):Boolean
        {
            if (target == null || owner == null || owner.stage == null)
            {
                return false;
            }
            var current:DisplayObject = target;
            while (current != null)
            {
                if (!current.visible)
                {
                    return false;
                }
                if (current === owner.stage)
                {
                    return true;
                }
                var parent:DisplayObjectContainer = current.parent;
                if (parent != null && !parent.mouseChildren)
                {
                    return false;
                }
                current = parent;
            }
            return false;
        }

    }
}
