package narutoos.daily
{
    import flash.display.DisplayObject;
    import flash.display.DisplayObjectContainer;
    import flash.display.InteractiveObject;
    import flash.display.Sprite;
    import flash.events.Event;
    import flash.events.IEventDispatcher;
    import flash.events.MouseEvent;
    import flash.events.TimerEvent;
    import flash.text.TextField;
    import flash.utils.Timer;
    import flash.utils.getDefinitionByName;
    import flash.utils.getQualifiedClassName;

    public final class NativeAutoMode implements IDailyTask
    {
        private static const AI_MODEL:String = "ai.IAIPlugin";
        private static const PANEL_NAME:String = "AIManageView";
        private static const PANEL_CLASS:String = "com.tencent.morefun.naruto.plugin.ai.view.basePage::AIManageView";
        private static const PANEL_UI:String = "ui.ai::AIManageUI";
        private static const HUD_VIEW:String = "com.tencent.morefun.naruto.plugin.hud.view.userinfo::UserInfoView";
        private static const HUD_UI:String = "com.tencent.morefun.naruto.plugin.hud.ui::UserInfoUI";
        private static const PROMPT_COMMAND:String = "ui.command::ShowTextBoxCommand";
        private static const TEXT_BOX:String = "com.tencent.morefun.naruto.plugin.RSModel.modules.popup.system::TextBox";
        private static const TEXT_BOX_UI:String = "com.tencent.morefun.naruto.plugin.ui.core::TextBoxUI";
        private static const CARD_PROMPT_HTML:String = "<b>您今天为首次进入托管状态，需要<br>消耗<font color='#f0d647'>托管卡x1</font>，有效期持续到<font color='#f0d647'>次日5：00</font>，<br>是否确认进入托管状态？</b>";
        private static const CARD_PROMPT_TEXT:String = "您今天为首次进入托管状态，需要消耗托管卡x1，有效期持续到次日5：00，是否确认进入托管状态？";
        private static const CARD_ITEM_ID:int = 10840007;
        private static const POLL_INTERVAL:int = 120;
        private static const TIMEOUT_MS:int = 12000;

        private var owner:Sprite;
        private var done:Function;
        private var poll:Timer;
        private var deadline:Number;
        private var opened:Boolean;
        private var clicked:Boolean;
        private var startPanel:Object;
        private var dispatchingStart:Boolean;
        private var commandEvents:IEventDispatcher;
        private var boxEvents:IEventDispatcher;
        private var promptCommand:IEventDispatcher;
        private var promptBox:Object;
        private var sawPromptBox:Boolean;
        private var promptReady:Boolean;
        private var confirmed:Boolean;
        private var okFlag:int;
        private var cancelFlag:int;

        public function NativeAutoMode(owner:Sprite, done:Function)
        {
            this.owner = owner;
            this.done = done;
        }

        public function get running():Boolean { return poll != null; }

        public function start():void
        {
            if (running) return;
            if (owner == null || owner.stage == null)
            {
                done(DailyQueue.COMPLETE, "自动模式：游戏界面不可用，已跳过。");
                return;
            }
            opened = false;
            clicked = false;
            confirmed = false;
            sawPromptBox = false;
            promptReady = false;
            deadline = new Date().time + TIMEOUT_MS;
            owner.addEventListener(Event.REMOVED_FROM_STAGE, onRemoved);
            poll = new Timer(POLL_INTERVAL);
            poll.addEventListener(TimerEvent.TIMER, onPoll);
            poll.start();
            onPoll(null);
        }

        public function cancel():void
        {
            if (!running) return;
            poll.stop();
            poll.removeEventListener(TimerEvent.TIMER, onPoll);
            poll = null;
            owner.removeEventListener(Event.REMOVED_FROM_STAGE, onRemoved);
            detachPromptWatch();
            startPanel = null;
            promptBox = null;
        }

        private function onRemoved(event:Event):void { cancel(); }

        private function onPoll(event:TimerEvent):void
        {
            var message:String;
            try { message = advance(); }
            catch (error:Error) { message = "无法操作游戏原生界面，请手动检查。"; }
            if (message && running)
            {
                cancel();
                done(DailyQueue.COMPLETE, "自动模式：" + message);
            }
        }

        private function advance():String
        {
            var app:Object = getDefinitionByName("base.ApplicationData").singleton;
            var model:Object = app.getModel(AI_MODEL);
            var state:* = model != null && ("isTrusteeshipping" in model) ? model.isTrusteeshipping : undefined;
            if (state === true) return clicked ? "已开启。" : "游戏已在托管中。";
            if (confirmed) return timedOut() ? "游戏未确认开启，请查看游戏提示。" : null;

            var boxes:Object = getDefinitionByName("com.tencent.morefun.naruto.plugin.ui.box.BoxManager");
            var shown:Array = boxes.showingList as Array;
            if (shown == null) return "无法确认游戏窗口状态，已跳过。";
            var panel:Object = boxes.getBoxByName(PANEL_NAME);
            var modal:Object = topModal(shown);
            if (modal != null && modal !== panel)
            {
                if (modal === promptBox && promptReady && !timedOut() && state === false &&
                    panel === startPanel && topModal(shown, modal) === startPanel)
                {
                    return confirmCard(modal);
                }
                return opened || clicked ? "等待玩家处理游戏原生提示。" : "请先处理当前游戏窗口。";
            }

            if (clicked)
            {
                return timedOut() ? "游戏未确认开启，请查看游戏提示。" : null;
            }
            if (panel == null)
            {
                if (opened) return timedOut() ? "游戏未打开托管面板，请查看游戏提示。" : null;
                if (app.selfInfo == null) return "无法读取当前角色，已跳过。";
                if (!(app.selfInfo.level >= 58)) return "托管需要达到 58 级。";
                var entry:InteractiveObject = findEntry();
                if (!isUsable(entry)) return "游戏的托管入口当前不可用。";
                opened = true;
                click(entry);
                return null;
            }

            if (getQualifiedClassName(panel) != PANEL_CLASS || getQualifiedClassName(panel.content) != PANEL_UI)
                return "无法识别游戏原生托管面板，已跳过。";
            if (state !== false)
                return timedOut() ? "无法确认当前托管状态，已跳过。" : null;

            var ui:Object = panel.content;
            // The game shows its first tab after fetching the native settings.
            if (panel.isShowing !== true || !hasVisiblePage(ui.pageContainer as DisplayObjectContainer))
                return timedOut() ? "游戏托管设置未加载，请检查原生面板。" : null;
            var button:InteractiveObject = ui.startBtn as InteractiveObject;
            if (!isUsable(button) || ui.startBtn.enabled !== true) return "游戏的开始自动模式按钮当前不可用。";

            clicked = true;
            deadline = new Date().time + TIMEOUT_MS;
            startPanel = panel;
            watchStartPrompt(boxes);
            dispatchingStart = true;
            try { click(button); }
            finally
            {
                dispatchingStart = false;
                if (promptCommand == null) detachPromptWatch();
            }
            return null;
        }

        private function timedOut():Boolean { return new Date().time >= deadline; }

        private function topModal(shown:Array, ignored:Object = null):Object
        {
            for (var i:int = shown.length - 1; i >= 0; i--)
            {
                var box:Object = shown[i];
                if (box != null && box !== ignored && box.stage === owner.stage && box.isShow && box.modal) return box;
            }
            return null;
        }

        private function watchStartPrompt(boxes:Object):void
        {
            try
            {
                var flags:Object = getDefinitionByName("def.BoxFlagDef");
                okFlag = flags.OK;
                cancelFlag = flags.CANCEL;
                var facade:Object = getDefinitionByName("com.tencent.morefun.framework.apf.core.facade.Facade");
                commandEvents = facade.getInstance().commandManager as IEventDispatcher;
                boxEvents = boxes.dispathcer as IEventDispatcher;
                if (commandEvents == null || boxEvents == null || okFlag <= 0 || cancelFlag <= 0 || okFlag == cancelFlag)
                {
                    detachPromptWatch();
                    return;
                }
                commandEvents.addEventListener("commandRequest", onPromptRequest, false, int.MAX_VALUE);
                commandEvents.addEventListener("commandExecute", onPromptExecute, false, int.MAX_VALUE);
            }
            catch (error:Error) { detachPromptWatch(); }
        }

        private function onPromptRequest(event:Event):void
        {
            if (!running || !dispatchingStart || promptCommand != null || sawPromptBox) return;
            var command:Object = Object(event).command;
            if (getQualifiedClassName(command) != PROMPT_COMMAND || command.text !== CARD_PROMPT_HTML ||
                command.flags != (okFlag | cancelFlag) || command.modal !== true || command.flagNames != null ||
                !(command.closedFun is Function)) return;
            promptCommand = command as IEventDispatcher;
            if (promptCommand == null) return;
            promptCommand.addEventListener("loadingEnd", onPromptSettled, false, int.MAX_VALUE);
            promptCommand.addEventListener("faild", onPromptSettled, false, int.MAX_VALUE);
        }

        private function onPromptExecute(event:Event):void
        {
            if (promptCommand == null || Object(event).command !== promptCommand) return;
            // The native executor creates and shows this box before the command finishes.
            boxEvents.addEventListener("boxShow", onPromptBox);
        }

        private function onPromptBox(event:Event):void
        {
            var box:Object = Object(event).box;
            if (!matchesCardBox(box)) return;
            promptBox = sawPromptBox ? null : box;
            sawPromptBox = true;
        }

        private function onPromptSettled(event:Event):void
        {
            promptReady = event.type == "loadingEnd" && promptBox != null;
            if (!promptReady) promptBox = null;
            detachPromptWatch();
        }

        private function detachPromptWatch():void
        {
            if (promptCommand != null)
            {
                promptCommand.removeEventListener("loadingEnd", onPromptSettled);
                promptCommand.removeEventListener("faild", onPromptSettled);
                promptCommand = null;
            }
            if (commandEvents != null)
            {
                commandEvents.removeEventListener("commandRequest", onPromptRequest);
                commandEvents.removeEventListener("commandExecute", onPromptExecute);
                commandEvents = null;
            }
            if (boxEvents != null)
            {
                boxEvents.removeEventListener("boxShow", onPromptBox);
                boxEvents = null;
            }
        }

        private static function matchesCardBox(box:Object):Boolean
        {
            if (getQualifiedClassName(box) != TEXT_BOX || box.name != "TextBox" ||
                getQualifiedClassName(box.content) != TEXT_BOX_UI) return false;
            var text:TextField = box.content.txt as TextField;
            return text != null && text.text.replace(/\s/g, "") === CARD_PROMPT_TEXT;
        }

        private function confirmCard(box:Object):String
        {
            if (box.isShowing !== true) return null;
            var content:DisplayObjectContainer = box.content as DisplayObjectContainer;
            var ok:InteractiveObject = content.getChildByName("okBtn") as InteractiveObject;
            var cancelButton:InteractiveObject = content.getChildByName("cancelBtn") as InteractiveObject;
            if (!matchesCardBox(box) || !isUsable(ok) || !isUsable(cancelButton) ||
                Object(ok).enabled !== true || Object(ok).userData != okFlag ||
                Object(cancelButton).userData != cancelFlag || !hasTrusteeshipCard())
            {
                return "等待玩家处理游戏原生提示。";
            }
            confirmed = true;
            deadline = new Date().time + TIMEOUT_MS;
            click(ok);
            return null;
        }

        private static function hasTrusteeshipCard():Boolean
        {
            try
            {
                var bag:Object = getDefinitionByName("bag.utils.BagUtils").model;
                return bag != null && bag.getTotalItemNumById(CARD_ITEM_ID) >= 1;
            }
            catch (error:Error) { }
            return false;
        }

        private function findEntry():InteractiveObject
        {
            var layers:Object = getDefinitionByName("com.tencent.morefun.naruto.plugin.ui.layer.LayerManager").singleton;
            var hud:DisplayObjectContainer = directChild(layers.findLayerByName("mainUI") as DisplayObjectContainer, HUD_VIEW);
            var ui:Object = directChild(hud, HUD_UI);
            return ui == null || ui.userMoneyBar == null ? null : ui.userMoneyBar.aiBtn as InteractiveObject;
        }

        private static function directChild(root:DisplayObjectContainer, className:String):DisplayObjectContainer
        {
            if (root == null) return null;
            var found:DisplayObjectContainer;
            for (var i:int = 0; i < root.numChildren; i++)
            {
                var child:DisplayObject = root.getChildAt(i);
                if (getQualifiedClassName(child) != className) continue;
                if (found != null) return null;
                found = child as DisplayObjectContainer;
            }
            return found;
        }

        private static function hasVisiblePage(pages:DisplayObjectContainer):Boolean
        {
            if (pages == null) return false;
            for (var i:int = 0; i < pages.numChildren; i++)
            {
                if (pages.getChildAt(i).visible) return true;
            }
            return false;
        }

        private function isUsable(button:InteractiveObject):Boolean
        {
            if (button == null || button.stage !== owner.stage || !button.mouseEnabled) return false;
            var node:DisplayObject = button;
            while (node != null && node !== owner.stage)
            {
                if (!node.visible || (node.parent != null && !node.parent.mouseChildren)) return false;
                node = node.parent;
            }
            return true;
        }

        private static function click(button:InteractiveObject):void
        {
            button.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true));
        }
    }
}
