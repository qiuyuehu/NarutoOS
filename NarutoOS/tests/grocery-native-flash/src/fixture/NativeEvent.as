package fixture
{
    import flash.events.Event;

    public final class NativeEvent extends Event
    {
        public var command:Object;
        public var box:Object;

        public function NativeEvent(type:String, value:Object)
        {
            super(type);
            if (type == "boxShow") box = value;
            else command = value;
        }
    }
}
