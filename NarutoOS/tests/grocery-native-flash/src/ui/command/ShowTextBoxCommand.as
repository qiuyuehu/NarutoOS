package ui.command
{
    import def.BoxFlagDef;
    import flash.events.EventDispatcher;

    public final class ShowTextBoxCommand extends EventDispatcher
    {
        public var text:String;
        public var flags:int = BoxFlagDef.OK | BoxFlagDef.CANCEL | BoxFlagDef.CHECK;
        public var modal:Boolean = true;
        public var flagNames:Object;
        public var closedFun:Function;
        public var closingFun:Function;

        public function ShowTextBoxCommand(text:String, closedFun:Function)
        {
            this.text = text;
            this.closedFun = closedFun;
        }
    }
}
