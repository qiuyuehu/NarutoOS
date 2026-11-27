package narutoos.daily
{
    import flash.display.InteractiveObject;
    import flash.display.Sprite;
    import flash.events.Event;
    import flash.events.EventDispatcher;
    import flash.events.MouseEvent;

    /** UI stand-in for TeamDungeonRun tests; behavior is controlled by the fixture scenario. */
    public final class TeamDungeonPanel
    {
        public static var target:Object;
        public static var selected:Object;
        public static var routeCalls:int;
        public static var chooseCalls:int;
        public static var confirmCalls:int;

        public static function reset():void
        {
            selected = {kind:"unknown", message:""};
            routeCalls = chooseCalls = confirmCalls = 0;
        }

        public static function route():Object
        {
            routeCalls++;
            return new TeamDungeonTestRoute(target);
        }

        public static function choose(box:Object):Object
        {
            chooseCalls++;
            if (selected != null && selected.kind == "ready")
            {
                return {kind:"ready", button:selected.button, dungeonId:int(selected.dungeonId), message:selected.message};
            }
            return {kind:selected != null ? selected.kind : "unknown", message:selected != null ? selected.message : ""};
        }

        public static function confirmButton(box:Object):InteractiveObject
        {
            confirmCalls++;
            return box != null && "confirmButton" in box ? box.confirmButton as InteractiveObject : null;
        }

        public static function readyButton():Sprite
        {
            var button:TeamDungeonTestButton = new TeamDungeonTestButton();
            button.name = "teamDungeonReady";
            return button;
        }
    }
}

import flash.events.Event;
import flash.events.EventDispatcher;

internal final class TeamDungeonTestRoute extends EventDispatcher
{
    private var target:Object;
    public function TeamDungeonTestRoute(target:Object) { this.target = target; }
    public function call():void
    {
        if (target != null) target.openTeamDungeonPanel();
        dispatchEvent(new Event("loadingEnd"));
    }
}

import flash.display.Sprite;
import flash.events.MouseEvent;

internal final class TeamDungeonTestButton extends Sprite
{
    public function TeamDungeonTestButton() { addEventListener(MouseEvent.CLICK, clicked); }
    private function clicked(event:MouseEvent):void
    {
        // The fixture observes this synthetic click and opens its native confirmation window.
        if (parent != null && "openTeamDungeonConfirm" in parent) parent["openTeamDungeonConfirm"]();
    }
}
