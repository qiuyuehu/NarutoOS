package fixture
{
    public final class StrongTestModelStore
    {
        private var team:StrongTeamModel = new StrongTeamModel();
        public function StrongTestModelStore() {}
        public function retrieveModel(name:String):Object { return team; }
    }
}
