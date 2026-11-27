package base
{
    import fixture.StrongBattleState;
    import fixture.StrongTeamModel;

    /** Team fixture model store; the production task still runs against its actual API calls. */
    public final class ApplicationData
    {
        public static const singleton:ApplicationData = new ApplicationData();
        public var isFightLock:Boolean;
        public var globelInfo:Object = {sceneId:1, sceneToId:1};
        public var selfInfo:Object = {state:new StrongTestUserState()};
        private var battle:StrongBattleState = new StrongBattleState();
        private var team:StrongTeamModel = new StrongTeamModel();

        public function ApplicationData() {}

        public function getModel(name:String):Object
        {
            if (name == "battleStart") return battle;
            if (name == "team") return team;
            return null;
        }
    }
}
