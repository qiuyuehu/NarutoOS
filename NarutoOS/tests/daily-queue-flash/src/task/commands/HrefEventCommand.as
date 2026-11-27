package task.commands
{
    import flash.events.Event;
    import flash.events.EventDispatcher;

    public final class HrefEventCommand extends EventDispatcher
    {
        public static var navigationTarget:Object;
        public var data:String;
        public function HrefEventCommand(data:String) { this.data = data; }
        public function call():void
        {
            navigationTarget.record("href.call");
            navigationTarget.openNativeChallenge();
            navigationTarget.record("href.loadingEnd");
            dispatchEvent(new Event("loadingEnd"));
        }
    }
}
