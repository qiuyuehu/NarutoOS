package
{
    import narutoos.daily.IDailyTask;

    public final class QueueNextTask implements IDailyTask
    {
        private var onStart:Function;
        private var _running:Boolean;
        public function QueueNextTask(onStart:Function) { this.onStart = onStart; }
        public function get running():Boolean { return _running; }
        public function start():void { _running = true; onStart(); }
        public function cancel():void { _running = false; }
    }
}
