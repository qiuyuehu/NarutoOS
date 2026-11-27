package base
{
    import fixture.StrongBattleState;

    public final class ApplicationData
    {
        public static const singleton:ApplicationData = new ApplicationData();
        public var selfInfo:Object;
        public var isFightLock:Boolean;
        public var modelReads:Array = [];
        private var battle:Object;
        public function ApplicationData() { selfInfo = {state:new StrongTestUserState()}; battle = new StrongBattleState(); }
        public function getModel(name:String):Object
        {
            modelReads.push(name);
            if(name == "player.PlayerModel") return {otherPlayersBodyVisible:false};
            return battle;
        }
    }
}
