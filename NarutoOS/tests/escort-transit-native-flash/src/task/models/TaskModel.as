package task.models
{
    import flash.events.EventDispatcher;
    import task.defs.TaskTypeDef;
    import com.tencent.morefun.naruto.model.event.ModelEvent;

    public final class TaskModel extends EventDispatcher
    {
        public var responded:Boolean;
        public var isEscorting:Boolean = true;
        public var escortFreeAcceptRemainderNum:int = 1;
        public var tasks:Array = [];
        public function getTaskInfosByType(type:int):Array { return type == TaskTypeDef.ESCORT ? tasks : []; }
        public function dispatch(key:String, oldValue:Object = null):void { dispatchEvent(new ModelEvent("update", key, oldValue, null)); }
    }
}
