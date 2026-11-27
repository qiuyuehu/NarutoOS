package narutoos.daily
{
    import flash.display.DisplayObject;
    import flash.display.DisplayObjectContainer;
    import flash.display.InteractiveObject;
    import flash.display.Stage;
    import flash.events.MouseEvent;
    import flash.utils.getQualifiedClassName;

    internal final class NativeFightResult
    {
        private static const VIEWS:String = "com.tencent.morefun.naruto.plugin.battle.view";

        public static function current(stage:Stage):Object
        {
            if (!stage) return null;
            var layer:DisplayObjectContainer = stage.getChildByName("fightUI") as DisplayObjectContainer;
            if (!layer || !layer.visible) return null;
            var battle:DisplayObjectContainer = directChild(layer, VIEWS + "::BattleView");
            if (!battle || !battle.visible) return null;
            var hud:Object = directChild(battle, "ui.battle::BattleViewUI");
            var position:DisplayObjectContainer = hud && "resultPos" in hud ? hud.resultPos as DisplayObjectContainer : null;
            if (!position || !position.visible) return null;
            var wrapper:Object = directChild(position, VIEWS + "::FightOverView");
            if (!wrapper || !wrapper.visible || !wrapper.view) return null;
            var type:String = getQualifiedClassName(wrapper.view);
            if (type == VIEWS + ".fightOver::FightWinView") return {kind:"win", ui:wrapper.view.ui};
            if (type == VIEWS + ".fightOver::FightFailView") return {kind:"fail", ui:wrapper.view.ui};
            return null;
        }

        public static function exitButton(result:Object):InteractiveObject
        {
            if (!result || !result.ui) return null;
            var ui:Object = result.ui;
            var expected:String = result.kind == "win" ? "ui.battle::FightWinUI" : "ui.battle::FightLoseUI";
            if (getQualifiedClassName(ui) != expected || !ui.visible ||
                !("defaultOkButton" in ui) || !("okButton" in ui)) return null;
            var primary:InteractiveObject = ui.defaultOkButton as InteractiveObject;
            var alternate:InteractiveObject = ui.okButton as InteractiveObject;
            var first:Boolean = ready(primary);
            if (first == ready(alternate)) return null;
            return first ? primary : alternate;
        }

        private static function ready(button:InteractiveObject):Boolean
        {
            return button && button.stage && button.visible && button.mouseEnabled &&
                "enabled" in button && Object(button).enabled && button.hasEventListener(MouseEvent.CLICK);
        }

        public static function directChild(parent:DisplayObjectContainer, type:String):DisplayObjectContainer
        {
            if (!parent) return null;
            for (var i:int = 0; i < parent.numChildren; i++)
            {
                var child:DisplayObject = parent.getChildAt(i);
                if (getQualifiedClassName(child) == type) return child as DisplayObjectContainer;
            }
            return null;
        }
    }
}
