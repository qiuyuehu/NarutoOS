package ui.command
{
    import flash.events.EventDispatcher;

    public final class ShowTextBoxCommand extends EventDispatcher
    {
        public var text:String;
        public var flags:int;
        public var modal:Boolean = true;
        public var flagNames:Object;
        public var closedFun:Function;

        public function ShowTextBoxCommand(text:String, flags:int, closedFun:Function)
        {
            this.text = text;
            this.flags = flags;
            this.closedFun = closedFun;
        }
    }
}
