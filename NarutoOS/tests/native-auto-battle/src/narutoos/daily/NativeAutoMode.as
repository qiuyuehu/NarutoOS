package narutoos.daily
{
    import flash.display.Sprite;

    /** Holds the real DailyAssistant queue at its auto-mode handoff point. */
    public final class NativeAutoMode implements IDailyTask
    {
        public static var starts:int;
        private var active:Boolean;

        public function NativeAutoMode(owner:Sprite, done:Function) {}
        public function get running():Boolean { return active; }
        public function start():void { starts++; active = true; }
        public function cancel():void { active = false; }
    }
}
