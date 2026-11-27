package
{
    import flash.display.Sprite;
    import flash.external.ExternalInterface;
    import base.ApplicationData;
    import narutoos.daily.DailyQueue;
    import narutoos.daily.EscortNativePanel;
    import narutoos.daily.EscortTask;
    import narutoos.daily.EscortTransit;
    import narutoos.daily.IDailyTask;

    public final class EscortQueueFixture extends Sprite
    {
        private var owner:Sprite;
        private var application:ApplicationData;
        private var queue:DailyQueue;
        private var started:Array = [];
        private var finished:Array = [];
        private var progress:Array = [];
        private var task:EscortTask;
        private var next:QueueNextTask;
        private var nextDone:Function;
        private var windowProgress:Object;
        private var both:Boolean;

        public function EscortQueueFixture()
        {
            ExternalInterface.addCallback("perform", perform);
            owner = new Sprite();
            addChild(owner);
            application = ApplicationData.singleton;
            reset();
        }

        private function reset():void
        {
            if (queue != null) queue.cancel();
            EscortNativePanel.reset();
            EscortTransit.reset();
            started = [];
            finished = [];
            progress = [];
            task = null;
            next = null;
            nextDone = null;
            windowProgress = {};
            queue = new DailyQueue(createTask, onProgress, onFinished);
        }

        private function createTask(id:String, done:Function, report:Function, hasNext:Boolean):IDailyTask
        {
            started.push(id);
            if (id == "escort" || id == "escortS")
            {
                task = new EscortTask(owner, done, report, id == "escortS" ? 4 : 5, windowProgress, both);
                return task;
            }
            nextDone = done;
            next = new QueueNextTask(function():void {});
            return next;
        }

        private function onProgress(value:String):void { progress.push(value); }
        private function onFinished(value:String):void { finished.push(value); }

        private function setPanel(value:String):void
        {
            var fields:Array = value.split("|");
            EscortNativePanel.panelView = String(fields[0]);
            EscortNativePanel.offerKind = fields.length > 1 ? String(fields[1]) : "wait";
            EscortNativePanel.offerId = fields.length > 2 ? int(fields[2]) : 0;
            EscortNativePanel.refreshLeft = fields.length > 3 ? int(fields[3]) : 0;
            EscortNativePanel.freeAcceptLeft = fields.length > 4 ? int(fields[4]) : 0;
            EscortNativePanel.message = fields.length > 5 ? String(fields[5]) : "";
            EscortNativePanel.allowedFree = fields.length <= 6 || fields[6] != "paid";
        }

        private function setTransit(value:String):void
        {
            var fields:Array = value.split("|");
            EscortTransit.stateKind = String(fields[0]);
            EscortTransit.orderId = fields.length > 1 ? int(fields[1]) : 0;
            EscortTransit.message = fields.length > 2 ? String(fields[2]) : "";
            EscortTransit.hard = fields.length > 3 ? int(fields[3]) : 5;
            EscortTransit.outcome = fields.length > 4 ? String(fields[4]) : "";
            EscortTransit.receivedAt = fields.length > 5 ? int(fields[5]) : EscortTransit.orderId;
        }

        private function perform(action:String, value:String = ""):Object
        {
            if (action == "reset") reset();
            else if (action == "start")
            {
                var ids:Array = value ? value.split(",") : ["escort", "next"];
                both = ids.indexOf("escort") >= 0 && ids.indexOf("escortS") >= 0;
                queue.start(ids);
            }
            else if (action == "panel") setPanel(value);
            else if (action == "transit") setTransit(value);
            else if (action == "cancel") queue.cancel();
            else if (action == "completeNext" && nextDone != null) nextDone(DailyQueue.COMPLETE, "next done");
            return snapshot();
        }

        private function snapshot():Object
        {
            return {running:queue != null && queue.running, started:started.concat(), finished:finished.concat(),
                progress:progress.concat(), panel:EscortNativePanel.snapshot(), transit:EscortTransit.snapshot(),
                taskRunning:task != null && task.running, nextRunning:next != null && next.running};
        }
    }
}
