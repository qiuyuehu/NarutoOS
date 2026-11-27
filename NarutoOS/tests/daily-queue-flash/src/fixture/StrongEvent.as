package fixture
{
    import flash.events.Event;

    public final class StrongEvent extends Event
    {
        public var command:Object;
        public var box:Object;
        public var key:String;
    public function StrongEvent(type:String, command:Object = null, box:Object = null, key:String = null)
        {
            super(type);
            this.command = command;
            this.box = box;
            this.key = key;
        }
    }
}
