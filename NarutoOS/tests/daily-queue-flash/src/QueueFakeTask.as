package
{
    import narutoos.daily.IDailyTask;

    public final class QueueFakeTask implements IDailyTask
    {
        public var id:String;
        public var hasNext:Boolean;
        private var onStart:Function;
        private var onCancel:Function;
        private var _running:Boolean;

        public function QueueFakeTask(id:String, done:Function, report:Function, hasNext:Boolean,
            onStart:Function, onCancel:Function)
        {
            this.id = id;
            this.hasNext = hasNext;
            this.onStart = onStart;
            this.onCancel = onCancel;
        }

        public function get running():Boolean { return _running; }

        public function start():void
        {
            _running = id != "stuck";
            onStart(this);
        }

        public function cancel():void
        {
            _running = false;
            onCancel(id);
        }
    }
}
