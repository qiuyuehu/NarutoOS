package narutoos.daily
{
    import flash.display.Sprite;

    /** Test task with the production DailyAssistant queue contract. */
    public final class QuizRun implements IDailyTask
    {
        public static var starts:int;
        private static var completion:Function;
        private var active:Boolean;

        public function QuizRun(owner:Sprite, finished:Function, progress:Function = null)
        {
            completion = finished;
        }

        public function get running():Boolean { return active; }
        public function start():void { starts++; active = true; }
        public function cancel():void { active = false; }

        public static function complete():void
        {
            var done:Function = completion;
            completion = null;
            if (done != null) done(DailyQueue.COMPLETE, "本地测验夹具完成");
        }

        public static function reset():void
        {
            starts = 0;
            completion = null;
        }
    }
}
