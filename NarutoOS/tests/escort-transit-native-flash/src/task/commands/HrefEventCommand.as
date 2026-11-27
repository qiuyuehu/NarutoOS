package task.commands
{
    public final class HrefEventCommand
    {
        public static var calls:Array = [];
        private var href:String;
        public function HrefEventCommand(href:String) { this.href = href; }
        public function call():void { calls.push(href); }
    }
}
