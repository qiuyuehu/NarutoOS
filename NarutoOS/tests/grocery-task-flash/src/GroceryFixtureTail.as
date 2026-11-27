package
{
    import narutoos.daily.IDailyTask;

    public final class GroceryFixtureTail implements IDailyTask
    {
        private var onStart:Function;
        public function GroceryFixtureTail(onStart:Function) { this.onStart = onStart; }
        public function start():void { onStart(); }
        public function cancel():void { }
        public function get running():Boolean { return false; }
    }
}
