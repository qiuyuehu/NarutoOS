package task.commands
{
    import flash.events.EventDispatcher;

    public final class HrefEventCommand extends EventDispatcher
    {
        public static var onNavigate:Function;

        public function HrefEventCommand(route:String) {}

        public function call():void
        {
            onNavigate();
        }
    }
}
