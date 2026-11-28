package
{
    import narutoos.daily.IDailyTask;

    public final class SweepFixtureTail implements IDailyTask
    {
        private var callback:Function;
        private var active:Boolean;
        public function SweepFixtureTail(callback:Function) { this.callback = callback; }
        public function get running():Boolean { return active; }
        public function start():void { active = true; callback(); active = false; }
        public function cancel():void { active = false; }
    }
}
