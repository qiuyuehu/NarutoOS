package narutoos.daily
{
    import flash.display.DisplayObjectContainer;
    import flash.display.InteractiveObject;
    import flash.display.Sprite;
    import flash.events.Event;
    import flash.events.IEventDispatcher;
    import flash.events.MouseEvent;
    import flash.utils.getDefinitionByName;
    import flash.utils.getQualifiedClassName;

    /** Reads the native Infinite Idol state and dispatches only its visible UI controls. */
    internal final class NativeInfiniteIllusion
    {
        private static const PANEL_NAME:String = "IdolMainView";
        private static const PANEL_CLASS:String = "com.tencent.morefun.naruto.plugin.idol.view::IdolMainView";
        private static const UI_CLASS:String = "ui.idol::IdolMainUI";
        private static const CONFIRM_CLASS:String = "com.tencent.morefun.naruto.plugin.idol.view::RadiusCheckDialog";
        private static const REWARD_COMMAND:String = "dungeon.command::ShowSimpleDungeonRewardCommand";
        private static const REWARD_CLASS:String = "com.tencent.morefun.naruto.plugin.dungeon.view.reward::SimpleDungeonRewardsWindow";
        private static const AI_MODEL:String = "ai.IAIPlugin";

        private var owner:Sprite;
        private var app:Object;
        private var boxes:Object;
        private var boxEvents:IEventDispatcher;
        private var commandEvents:IEventDispatcher;
        private var panel:Object;
        private var tabbar:DisplayObjectContainer;
        private var openRequested:Boolean;
        private var openFailed:Boolean;
        private var closedByTask:Boolean;
        private var waitForFreshList:Boolean;
        private var openListToken:Object;
        private var dispatchingRaid:Boolean;
        private var raidSubmitted:Boolean;
        private var openCommand:Object;
        private var attemptArmed:Boolean;
        private var confirmationBox:Object;
        private var confirmationOkButton:InteractiveObject;
        private var confirmationCancelButton:InteractiveObject;
        private var rewardRequested:Boolean;
        private var rewardSeen:Boolean;
        private var rewardBox:Object;
        private var infiniteIdolType:int = -1;
        private var confirmationDungeonId:int = -1;
        private var disposed:Boolean;

        public function NativeInfiniteIllusion(owner:Sprite) { this.owner = owner; }

        public function begin():Boolean
        {
            return owner != null && owner.stage != null;
        }

        public function snapshot():Object
        {
            var aiState:Object = trusteeshipState();
            var trusteeshipping:* = aiState.active;
            if (trusteeshipping !== false)
                return {trusteeshipping:trusteeshipping, panel:"loading", topModal:"none"};
            if (!initialize()) return {trusteeshipping:false, panel:"loading", topModal:"none"};

            var shown:Array = boxes.showingList as Array;
            if (shown == null) return null;
            panel = boxes.getBoxByName(PANEL_NAME);
            if (isVisiblePanel(panel)) openRequested = true;
            if (panel == null && !openRequested && !closedByTask && !openFailed && topModal(shown) == null) requestOpen();
            if (openFailed && panel == null)
                return {trusteeshipping:false, panel:"unknown", topModal:"other"};

            var panelState:String = "absent";
            var selectedIndex:int = -1;
            var dungeons:Array = [];
            var listToken:Object;
            var listValid:Boolean;
            var raidReady:Boolean;
            if (panel != null && panel.stage === owner.stage)
            {
                if (getQualifiedClassName(panel) != PANEL_CLASS || getQualifiedClassName(panel.content) != UI_CLASS)
                    return {trusteeshipping:false, panel:"unknown", topModal:"other"};
                if (panel.isShow !== true || panel.isShowing !== true)
                {
                    panelState = "loading";
                }
                else
                {
                    panelState = "ready";
                    attachTabbar();
                    var listState:Object = readDungeonList();
                    if (listState != null)
                    {
                        var freshList:Boolean = !waitForFreshList || openListToken == null || listState.listToken !== openListToken;
                        if (freshList && selectedCountMatches(panel.content, listState))
                        {
                            selectedIndex = int(listState.selectedIndex);
                            dungeons = listState.dungeons;
                            listToken = listState.listToken;
                            listValid = true;
                            waitForFreshList = false;
                        }
                    }
                    var ui:Object = panel.content;
                    var button:InteractiveObject = ui.battleBar != null ? ui.battleBar.btn_radius as InteractiveObject : null;
                    raidReady = usable(button) && ("enabled" in button) && Object(button).enabled === true;
                }
            }
            var modal:Object = topModal(shown);
            var modalState:String = "none";
            if (modal != null)
            {
                if (modal === confirmationBox && attemptArmed && getQualifiedClassName(modal) == CONFIRM_CLASS &&
                    confirmationDungeonId > 0 && confirmationDungeonId == selectedDungeonId())
                    modalState = "confirm";
                else if (modal === rewardBox && rewardVisible()) modalState = "reward";
                else modalState = "other";
            }
            else if (rewardVisible()) modalState = "reward";

            var risk:Object = autoSweepRisk();
            var anyStageOpportunity:Boolean;
            if (listValid)
                for each (var stage:Object in dungeons)
                    if (stage.unlocked && stage.isRadius && stage.passCount < stage.passUpperCount) anyStageOpportunity = true;
            return {
                trusteeshipping:false,
                panel:panelState,
                topModal:modalState,
                selectedIndex:selectedIndex,
                selectedId:selectedDungeonId(),
                dungeons:dungeons,
                listToken:listToken,
                listValid:listValid,
                anyStageOpportunity:listValid ? anyStageOpportunity : undefined,
                raidReady:raidReady,
                autoRaidEnabled:risk.enabled,
                rewardSeen:rewardSeen,
                raidWasSubmitted:raidSubmitted,
                canHandoff:canHandoff(),
                roleKey:roleKey()
            };
        }

        public function selectStage(index:int):Boolean
        {
            if (tabbar == null || index < 0 || index >= tabbar.numChildren) return false;
            var button:InteractiveObject = tabbar.getChildByName("bar" + index) as InteractiveObject;
            if (!usable(button)) return false;
            button.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true, false));
            return true;
        }

        public function resetResult():void
        {
            attemptArmed = true;
            raidSubmitted = false;
            confirmationBox = null;
            detachConfirmationButtons();
            rewardRequested = false;
            rewardSeen = false;
            rewardBox = null;
        }

        public function clickRaid():Boolean
        {
            raidSubmitted = false;
            if (!isVisiblePanel(panel) || !attemptArmed) return false;
            var button:InteractiveObject = panel.content.battleBar != null ? panel.content.battleBar.btn_radius as InteractiveObject : null;
            if (!usable(button) || !("enabled" in button) || Object(button).enabled !== true) return false;
            confirmationBox = null;
            confirmationDungeonId = selectedDungeonId();
            dispatchingRaid = true;
            try { button.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true, false)); }
            finally { dispatchingRaid = false; }
            raidSubmitted = confirmationBox == null;
            return true;
        }

        public function get raidWasSubmitted():Boolean { return raidSubmitted; }

        public function confirm():Boolean
        {
            var modal:Object = topModal(boxes.showingList as Array);
            if (!attemptArmed || modal == null || modal !== confirmationBox ||
                getQualifiedClassName(modal) != CONFIRM_CLASS || modal.content == null ||
                confirmationDungeonId <= 0 || selectedDungeonId() != confirmationDungeonId || !isVisiblePanel(panel)) return false;
            var button:InteractiveObject = modal.content.btnOK as InteractiveObject;
            if (!usable(button) || !("enabled" in button) || Object(button).enabled !== true) return false;
            button.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true, false));
            return true;
        }

        public function cancelConfirmation():Boolean
        {
            if (confirmationBox == null) return true;
            var modal:Object = topModal(boxes.showingList as Array);
            if (modal !== confirmationBox || getQualifiedClassName(modal) != CONFIRM_CLASS ||
                confirmationDungeonId <= 0 || selectedDungeonId() != confirmationDungeonId || !isVisiblePanel(panel)) return false;
            var button:InteractiveObject = modal.content != null ? modal.content.btnCancle as InteractiveObject : null;
            if (!usable(button)) return false;
            button.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true, false));
            return confirmationBox == null || topModal(boxes.showingList as Array) !== confirmationBox;
        }

        public function closeReward():Boolean
        {
            if (!raidSubmitted || !rewardVisible() || !isVisiblePanel(panel) ||
                topModal(boxes.showingList as Array) !== rewardBox || !rewardBox.isShowing) return false;
            var view:DisplayObjectContainer = rewardBox.content as DisplayObjectContainer;
            if (view == null || !view.visible || !("returnBtn" in view)) return false;
            // This is the native "finish raid" control. Its close callback reloads the list.
            var button:InteractiveObject = Object(view).returnBtn as InteractiveObject;
            if (!usable(button) || button.parent !== view ||
                ("enabled" in button && Object(button).enabled !== true)) return false;
            button.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true, false));
            return true;
        }

        private function onConfirmationOk(event:MouseEvent):void
        {
            if (event.currentTarget === confirmationOkButton && confirmationBox != null)
                raidSubmitted = true;
        }

        private function onConfirmationCancel(event:MouseEvent):void
        {
            // Cancel and close both invoke the native close path and never submit a raid.
        }

        private function detachConfirmationButtons():void
        {
            if (confirmationOkButton != null) confirmationOkButton.removeEventListener(MouseEvent.CLICK, onConfirmationOk, false);
            if (confirmationCancelButton != null) confirmationCancelButton.removeEventListener(MouseEvent.CLICK, onConfirmationCancel, false);
            confirmationOkButton = null;
            confirmationCancelButton = null;
        }

        public function closePanel():Boolean
        {
            if (!isVisiblePanel(panel) || panel.content.rightareaMC == null) return false;
            var button:InteractiveObject = panel.content.rightareaMC.btn_close as InteractiveObject;
            if (!usable(button)) return false;
            closedByTask = true;
            button.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true, false));
            return true;
        }

        public function dispose():void
        {
            if (disposed) return;
            disposed = true;
            if (boxEvents != null)
            {
                boxEvents.removeEventListener("boxShow", onBoxShow);
                boxEvents.removeEventListener("boxShowed", onBoxShow);
                boxEvents.removeEventListener("boxHide", onBoxHide);
            }
            if (commandEvents != null) commandEvents.removeEventListener("commandRequest", onCommandRequest);
            if (openCommand != null)
            {
                openCommand.removeEventListener("loadingEnd", openSettled);
                openCommand.removeEventListener("faild", openSettled);
            }
            openCommand = null;
            panel = null;
            tabbar = null;
            boxEvents = null;
            commandEvents = null;
        }

        private function initialize():Boolean
        {
            try
            {
                if (boxes != null && boxEvents != null && commandEvents != null) return true;
                if (boxes == null) boxes = getDefinitionByName("com.tencent.morefun.naruto.plugin.ui.box.BoxManager");
                var facade:Object = getDefinitionByName("com.tencent.morefun.framework.apf.core.facade.Facade").getInstance();
                if (boxes == null || facade == null) return false;
                boxEvents = boxes.dispathcer as IEventDispatcher;
                commandEvents = facade.commandManager as IEventDispatcher;
                if (boxEvents == null || commandEvents == null) return false;
                var typeDef:Class = resolveClass("dungeon.def.DungeonTypeDef", "DUNGEON");
                infiniteIdolType = int(typeDef.INFINITE_IDOL);
                boxEvents.addEventListener("boxShow", onBoxShow);
                boxEvents.addEventListener("boxShowed", onBoxShow);
                boxEvents.addEventListener("boxHide", onBoxHide);
                commandEvents.addEventListener("commandRequest", onCommandRequest, false, int.MAX_VALUE);
                return true;
            }
            catch (error:Error) { return false; }
            return false;
        }

        private function requestOpen():void
        {
            try
            {
                var priorList:Object = readDungeonList();
                openListToken = priorList == null ? null : priorList.listToken;
                waitForFreshList = true;
                var commandType:Class = resolveClass("idol.command.OpenIdolCommand", "INFINITE_IDOL");
                if (commandType == null) { openFailed = true; return; }
                openRequested = true;
                openCommand = new commandType();
                openCommand.addEventListener("loadingEnd", openSettled);
                openCommand.addEventListener("faild", openSettled);
                DailyActivity.call(openCommand, null);
            }
            catch (error:Error) { openFailed = true; }
        }

        private function trusteeshipState():Object
        {
            try
            {
                app = getDefinitionByName("base.ApplicationData").singleton;
                var model:Object = app.getModel(AI_MODEL);
                // A missing AI plugin/model cannot have an active trusteeship task in this context.
                // The saved preference remains unknown and is checked before queue handoff.
                if (model == null) return {active:false, modelPresent:false};
                if (!("isTrusteeshipping" in model) || !(model.isTrusteeshipping is Boolean))
                    return {active:undefined, modelPresent:true};
                return {active:model.isTrusteeshipping, modelPresent:true};
            }
            catch (error:Error) { return {active:undefined, modelPresent:false}; }
            return {active:undefined, modelPresent:false};
        }

        private function readDungeonList():Object
        {
            try
            {
                var tabType:Class = resolveClass("com.tencent.morefun.naruto.plugin.idol.view.TabbarMedia", "INFINITE_IDOL");
                var idolType:Class = resolveClass("com.tencent.morefun.naruto.plugin.idol.model.IdolModel", "INFINITE_IDOL");
                var idol:Object = idolType.instance;
                var list:Object = idol.list;
                var index:int = int(tabType.curr_id);
                if (list == null || list.length == 0 || index < 0 || index >= list.length) return null;
                var dungeons:Array = [];
                var seen:Object = {};
                for (var i:int = 0; i < list.length; i++)
                {
                    var info:Object = list[i];
                    if (info == null || !validCounter(info.id) || !validCounter(info.passCount) ||
                        !validCounter(info.passUpperCount) || int(info.passCount) > int(info.passUpperCount) ||
                        !(info.unlocked is Boolean) || !(info.isRadius is Boolean) || seen[String(info.id)]) return null;
                    seen[String(info.id)] = true;
                    dungeons.push({id:int(info.id), index:i, passCount:int(info.passCount),
                        passUpperCount:int(info.passUpperCount), unlocked:Boolean(info.unlocked), isRadius:Boolean(info.isRadius)});
                }
                return {selectedIndex:index, dungeons:dungeons, listToken:list};
            }
            catch (error:Error) { return null; }
            return null;
        }

        private function selectedCountMatches(ui:Object, listState:Object):Boolean
        {
            try
            {
                var selectedIndex:int = int(listState.selectedIndex);
                var dungeons:Array = listState.dungeons as Array;
                if (dungeons == null || selectedIndex < 0 || selectedIndex >= dungeons.length || ui.battleBar == null)
                    return false;
                var label:Object = ui.battleBar.lblLeft;
                if (label == null || !("text" in label)) return false;
                var matches:Array = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(String(label.text));
                if (matches == null || matches.length < 3) return false;
                var selected:Object = dungeons[selectedIndex];
                return int(matches[1]) == int(selected.passUpperCount) - int(selected.passCount) &&
                    int(matches[2]) == int(selected.passUpperCount);
            }
            catch (error:Error) { return false; }
            return false;
        }

        private function autoSweepRisk():Object
        {
            // AISetting initializes every enable flag to false before its first server decode.
            // The native model exposes no loaded/synchronized marker, so a false value cannot
            // prove the user's saved trusteeship preference. Keep it unknown while attempts remain.
            return {enabled:undefined};
        }

        private function canHandoff():Boolean
        {
            try { return TeamDungeonProgress.canHandoff(app); }
            catch (error:Error) { return false; }
            return false;
        }

        private function selectedDungeonId():int
        {
            var data:Object = readDungeonList();
            if (data == null || data.selectedIndex < 0 || data.selectedIndex >= data.dungeons.length) return -1;
            return int(data.dungeons[int(data.selectedIndex)].id);
        }

        private function roleKey():String
        {
            try
            {
                var player:Object = app != null ? app.selfInfo : null;
                var uin:uint = player != null ? uint(player.uin) : 0;
                if (uin == 0 || player.svrId == null || int(player.svrId) <= 0 || player.role == null) return "";
                return String(uin) + "_" + int(player.svrId) + "_" + int(player.role);
            }
            catch (error:Error) { return ""; }
            return "";
        }

        private function attachTabbar():void
        {
            if (panel == null || !isVisiblePanel(panel) || panel.content.tabbarMC == null) return;
            tabbar = panel.content.tabbarMC as DisplayObjectContainer;
        }

        private function onCommandRequest(event:Event):void
        {
            var command:Object = Object(event).command;
            if (!attemptArmed || rewardRequested || command == null ||
                getQualifiedClassName(command) != REWARD_COMMAND || !("dupType" in command) ||
                int(command.dupType) != infiniteIdolType) return;
            rewardRequested = true;
        }

        private function onBoxShow(event:Event):void
        {
            var box:Object = Object(event).box;
            if (!attemptArmed || box == null || box.stage !== owner.stage) return;
            if (dispatchingRaid && getQualifiedClassName(box) == CONFIRM_CLASS)
            {
                detachConfirmationButtons();
                confirmationBox = box;
                confirmationDungeonId = selectedDungeonId();
                confirmationOkButton = box.content != null ? box.content.btnOK as InteractiveObject : null;
                confirmationCancelButton = box.content != null ? box.content.btnCancle as InteractiveObject : null;
                if (confirmationOkButton != null) confirmationOkButton.addEventListener(MouseEvent.CLICK, onConfirmationOk, false, int.MAX_VALUE);
                if (confirmationCancelButton != null) confirmationCancelButton.addEventListener(MouseEvent.CLICK, onConfirmationCancel, false, int.MAX_VALUE);
                return;
            }
            if (rewardRequested && !rewardSeen && getQualifiedClassName(box) == REWARD_CLASS &&
                getRewardDupType() == infiniteIdolType)
            {
                rewardBox = box;
                rewardSeen = true;
            }
        }

        private function onBoxHide(event:Event):void
        {
            if (Object(event).box === rewardBox) rewardBox = null;
            if (Object(event).box === confirmationBox)
            {
                confirmationBox = null;
                detachConfirmationButtons();
            }
        }

        private function rewardVisible():Boolean
        {
            return attemptArmed && rewardRequested && rewardSeen && rewardBox != null &&
                rewardBox.stage === owner.stage && (rewardBox.isShow === true || rewardBox.isShowing === true) &&
                getQualifiedClassName(rewardBox) == REWARD_CLASS && getRewardDupType() == infiniteIdolType;
        }

        private function getRewardDupType():int
        {
            try
            {
                var rewardType:Class = resolveClass(REWARD_CLASS, "DUNGEON");
                return int(rewardType.dupType);
            }
            catch (error:Error) { return -1; }
            return -1;
        }

        private function openSettled(event:Event):void
        {
            if (event.type == "faild") openFailed = true;
        }

        private function resolveClass(name:String, pluginName:String):Class
        {
            try
            {
                var facadeType:Object = getDefinitionByName("com.tencent.morefun.framework.apf.core.facade.Facade");
                var facade:Object = facadeType.getInstance();
                var pluginDef:Object = getDefinitionByName("def.PluginDef");
                var plugin:Object = facade.pluginManager.getPluginInfo(pluginDef[pluginName]);
                var domain:Object = plugin == null ? null : plugin.domain;
                if (domain != null && domain.hasDefinition(name)) return domain.getDefinition(name) as Class;
            }
            catch (pluginError:Error) { }
            try { return getDefinitionByName(name) as Class; }
            catch (definitionError:Error) { return null; }
            return null;
        }

        private function topModal(shown:Array):Object
        {
            if (shown == null) return null;
            for (var i:int = shown.length - 1; i >= 0; i--)
            {
                var box:Object = shown[i];
                if (box != null && box !== panel && box.stage === owner.stage && box.modal === true &&
                    (box.isShow === true || box.isShowing === true)) return box;
            }
            return null;
        }

        private function isVisiblePanel(candidate:Object):Boolean
        {
            return candidate != null && candidate.stage === owner.stage && candidate.isShow === true &&
                candidate.isShowing === true && getQualifiedClassName(candidate) == PANEL_CLASS &&
                candidate.content != null && getQualifiedClassName(candidate.content) == UI_CLASS;
        }

        private static function usable(item:InteractiveObject):Boolean
        {
            return item != null && item.stage != null && item.visible && item.mouseEnabled;
        }

        private static function validCounter(value:*):Boolean
        {
            return value is Number && value >= 0 && value <= int.MAX_VALUE && value === Math.floor(value);
        }
    }
}
