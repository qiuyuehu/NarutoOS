package narutoos.daily
{
    public final class DailyQueue
    {
        public static const COMPLETE:String = "complete";
        public static const BLOCKED:String = "blocked";
        public static const ABORT:String = "abort";

        private var createTask:Function;
        private var onProgress:Function;
        private var onFinished:Function;
        private var pending:Array;
        private var current:IDailyTask;
        private var results:Array;
        private var generation:uint;
        private var currentId:String;

        public function DailyQueue(createTask:Function, onProgress:Function, onFinished:Function)
        {
            this.createTask = createTask;
            this.onProgress = onProgress;
            this.onFinished = onFinished;
        }

        public function get running():Boolean { return pending != null; }
        public function get activeId():String { return currentId; }

        public function start(ids:Array):void
        {
            if(running || ids == null || ids.length == 0) return;
            pending = ids.concat();
            results = [];
            nextTask();
        }

        private function nextTask():void
        {
            var token:uint = ++generation;
            currentId = pending.shift();
            var done:Function = function(status:String, message:String):void
            {
                if(token != generation) return;
                ++generation;
                current = null;
                if(message) results.push(message);
                if(status == COMPLETE || status == BLOCKED)
                {
                    if(pending.length > 0)
                    {
                        nextTask();
                        return;
                    }
                }
                finish();
            };
            var progress:Function = function(message:String):void
            {
                if(token == generation) onProgress(message);
            };
            try
            {
                current = createTask(currentId, done, progress, pending.length > 0);
                progress("");
                if(token != generation) return;
                current.start();
                if(token == generation && !current.running)
                    done(ABORT, "任务没有启动，本轮已中止。");
            }
            catch(error:Error)
            {
                if(token != generation) return;
                results.push("任务启动异常，本轮已中止。" + error.message);
                finish();
            }
        }

        public function cancel():void
        {
            if(!running) return;
            results.push("已停止本轮任务。");
            finish(true);
        }

        private function finish(cancelled:Boolean = false):void
        {
            ++generation;
            var task:IDailyTask = current;
            var messages:Array = results;
            current = null;
            currentId = null;
            pending = null;
            results = null;
            if(task != null)
            {
                task.cancel();
                if(cancelled && "cancellationSummary" in task && Object(task).cancellationSummary)
                    messages.push(Object(task).cancellationSummary);
            }
            onFinished(messages.join("\n"));
        }
    }
}
