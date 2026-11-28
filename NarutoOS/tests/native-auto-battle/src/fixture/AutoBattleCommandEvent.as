package fixture
{
    import flash.events.Event;

    public final class AutoBattleCommandEvent extends Event
    {
        public var command:Object;

        public function AutoBattleCommandEvent(type:String, command:Object)
        {
            super(type);
            this.command = command;
        }
    }
}
