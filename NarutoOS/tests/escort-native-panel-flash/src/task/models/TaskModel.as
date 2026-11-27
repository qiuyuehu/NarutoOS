package task.models
{
    import flash.events.EventDispatcher;
    import com.tencent.morefun.naruto.model.event.ModelEvent;
    public final class TaskModel extends EventDispatcher
    {
        public function TaskModel() { super(); }
        public var respondedCount:int;
        public var escortRemainderNum:int;
        public var escortFreeAcceptRemainderNum:int;
        public var escortRefreshNum:int;
        public var tasks:Array = [];
        public function setTasks(value:Array):void
        {
            tasks = value;
            respondedCount++;
            dispatchEvent(new ModelEvent("taskInfos"));
        }
        public function setCountInfo():void
        {
            dispatchEvent(new ModelEvent("escortNum"));
        }
        public function setRefreshRemainder(value:int):void
        {
            escortRefreshNum = value;
            dispatchEvent(new ModelEvent("escortNum"));
        }
        public function getTaskInfosByType(type:int):Array { return tasks; }
    }
}
