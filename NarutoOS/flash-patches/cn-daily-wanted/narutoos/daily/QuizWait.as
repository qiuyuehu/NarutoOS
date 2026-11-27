package narutoos.daily
{
    import flash.utils.Timer;

    /** One-shot deadlines keep their full delay independently of game speed and polling frequency. */
    internal final class QuizWait
    {
        private var deadlines:Object = {};

        public function QuizWait(...limits)
        {
            for each (var ms:int in limits) deadlines[ms] = new Timer(ms, 1);
        }

        public function restart():void
        {
            for each (var timer:Timer in deadlines)
            {
                timer.reset();
                timer.start();
            }
        }

        public function expired(ms:int):Boolean
        {
            return Timer(deadlines[ms]).currentCount != 0;
        }

        public function stop():void
        {
            for each (var timer:Timer in deadlines) timer.stop();
        }
    }
}
