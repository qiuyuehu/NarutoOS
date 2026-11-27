package fixture
{
    import flash.events.EventDispatcher;

    public final class StrongBattleState extends EventDispatcher
    {
        public var isFighting:Boolean;
        public var type:int;
        public var isWin:Boolean;
        public function StrongBattleState() {}
    }
}
