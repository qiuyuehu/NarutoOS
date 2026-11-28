package
{
    import base.ApplicationData;
    import flash.display.DisplayObjectContainer;
    import flash.display.Sprite;
    import flash.events.Event;
    import flash.text.TextField;
    import flash.events.MouseEvent;
    import narutoos.daily.DailyAssistant;
    import narutoos.daily.GrocerySettings;
    import flash.external.ExternalInterface;
    import narutoos.daily.DailyQueue;
    import narutoos.daily.IDailyTask;

    public final class DailyQueueFixture extends Sprite
    {
        private var queue:DailyQueue;
        private var tasks:Array = [];
        private var started:Array = [];
        private var canceled:Array = [];
        private var progress:Array = [];
        private var finished:Array = [];
        private var lastDone:Function;
        private var lastProgress:Function;
        private var doneCallbacks:Array = [];
        private var progressCallbacks:Array = [];

        public function DailyQueueFixture()
        {
            ExternalInterface.addCallback("perform", perform);
            ExternalInterface.addCallback("selection", selection);
            reset();
        }

        private function selection(action:String, server:int, option:String = "strong"):String
        {
            if(action == "groceryOrders") return JSON.stringify(GrocerySettings.orders(JSON.parse(option)));
            var modal:DisplayObjectContainer = stage.getChildByName("dailyAssistantModal") as DisplayObjectContainer;
            if(action == "open" || action == "openBR")
            {
                ApplicationData.singleton.selfInfo = {uin:761, svrId:server, role:0};
                if(action == "openBR") DailyAssistant.installBR(this, 0, 0);
                else DailyAssistant.install(this, 0, 0);
                var assistant:DisplayObjectContainer = getChildByName("narutoosDailyAssistant") as DisplayObjectContainer;
                var controls:DisplayObjectContainer = assistant.getChildByName("dailyControls") as DisplayObjectContainer;
                controls.getChildByName("entry").dispatchEvent(new MouseEvent(MouseEvent.CLICK, true));
                modal = stage.getChildByName("dailyAssistantModal") as DisplayObjectContainer;
            }
            if(action == "standaloneStop")
            {
                var overlay:DisplayObjectContainer = stage.getChildByName("narutoosDailyRuntimeControls") as DisplayObjectContainer;
                if(!overlay || !overlay.visible) return "missing stop";
                overlay.getChildByName("stop").dispatchEvent(new MouseEvent(MouseEvent.CLICK, true));
                return overlay.visible ? "running" : "stopped";
            }
            var panel:DisplayObjectContainer = modal.getChildByName("panel") as DisplayObjectContainer;
            if(action == "has") return panel.getChildByName(option) == null ? "absent" : "present";
            if(action == "label") return panel.getChildByName(option).accessibilityProperties.name;
            if(action == "layout")
            {
                var execute:Sprite = panel.getChildByName("execute") as Sprite;
                var status:TextField = panel.getChildByName("status") as TextField;
                return JSON.stringify({choiceY:panel.getChildByName("battleSettings").y, statusY:status.y,
                    statusBottom:status.y + status.height, executeY:execute.y, executable:execute.buttonMode,
                    panelHeight:panel.height});
            }
            if(action == "settings")
            {
                panel.getChildByName("grocerySettings").dispatchEvent(new MouseEvent(MouseEvent.CLICK, true));
                return "opened";
            }
            var grocery:DisplayObjectContainer = modal.getChildByName("groceryPage") as DisplayObjectContainer;
            if(grocery != null)
            {
                var input:TextField = grocery.getChildByName("quantity10800057") as TextField;
                if(action == "setQty")
                {
                    input.text = option;
                    input.dispatchEvent(new Event(Event.CHANGE, true));
                }
                if(action == "getQty") return input.text;
                if(action == "editItem" || action == "save" || action == "back")
                    grocery.getChildByName(action == "editItem" ? "item10800057" : action).dispatchEvent(new MouseEvent(MouseEvent.CLICK, true));
                return modal.getChildByName("groceryPage") == null ? "closed" : TextField(grocery.getChildByName("total")).text;
            }
            if(action == "summary") return TextField(panel.getChildByName("status")).text;
            if(action == "execute") ApplicationData.singleton.isFightLock = true;
            if(action == "toggle" || action == "close" || action == "execute")
                panel.getChildByName(action == "toggle" ? option : action).dispatchEvent(new MouseEvent(MouseEvent.CLICK, true));
            if(action == "execute")
                return modal.visible ? Object(panel.getChildByName("status")).text : "queue";
            if(action == "modelReads") return ApplicationData.singleton.modelReads.join(",");
            return panel.getChildByName(option).accessibilityProperties.description;
        }

        private function reset():void
        {
            if (queue != null) queue.cancel();
            tasks = [];
            started = [];
            canceled = [];
            progress = [];
            finished = [];
            lastDone = null;
            lastProgress = null;
            doneCallbacks = [];
            progressCallbacks = [];
            queue = new DailyQueue(createTask, reportProgress, reportFinished);
        }

        private function createTask(id:String, done:Function, report:Function, hasNext:Boolean):IDailyTask
        {
            var task:QueueFakeTask = new QueueFakeTask(id, done, report, hasNext, onTaskStarted, onTaskCanceled);
            tasks.push(task);
            lastDone = done;
            lastProgress = report;
            doneCallbacks.push(done);
            progressCallbacks.push(report);
            return task;
        }

        private function onTaskStarted(task:QueueFakeTask):void
        {
            started.push({id:task.id, hasNext:task.hasNext});
        }

        private function onTaskCanceled(id:String):void
        {
            canceled.push(id);
        }

        private function reportProgress(message:String):void { progress.push(message); }
        private function reportFinished(message:String):void { finished.push(message); }

        private function perform(action:String, value:String = ""):Object
        {
            if (action == "reset") reset();
            else if (action == "start") queue.start(value ? value.split(",") : []);
            else if (action == "complete")
            {
                var fields:Array = value.split("|");
                if (lastDone != null) lastDone(fields[0], fields.length > 1 ? fields[1] : "");
            }
            else if (action == "doubleComplete")
            {
                var callback:Function = lastDone;
                if (callback != null)
                {
                    callback(DailyQueue.COMPLETE, "first");
                    callback(DailyQueue.COMPLETE, "duplicate");
                }
            }
            else if (action == "progress" && lastProgress != null) lastProgress(value);
            else if (action == "lateComplete" && lastDone != null) lastDone(DailyQueue.COMPLETE, "late");
            else if (action == "lateFirstComplete" && doneCallbacks.length > 0) doneCallbacks[0](DailyQueue.COMPLETE, "旧轮完成");
            else if (action == "lateFirstProgress" && progressCallbacks.length > 0) progressCallbacks[0]("旧轮进度");
            else if (action == "cancel") queue.cancel();
            return {running:queue.running, started:started, canceled:canceled,
                progress:progress, finished:finished};
        }
    }
}
