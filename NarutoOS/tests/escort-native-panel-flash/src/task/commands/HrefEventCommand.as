package task.commands
{
    import base.ApplicationData;
    import flash.events.EventDispatcher;
    public final class HrefEventCommand extends EventDispatcher
    {
        public var href:String;
        public function HrefEventCommand(href:String) { this.href = href; }
        public function call():void
        {
            var model:Object = ApplicationData.singleton.taskModel;
            model.setCountInfo();
            model.setTasks(model.tasks);
        }
    }
}
