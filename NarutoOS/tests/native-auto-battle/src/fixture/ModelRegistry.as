package fixture
{
    public final class ModelRegistry
    {
        public function retrieveModel(name:String):Object
        {
            if (name == "team") return { isJoined: false, isMember: false, members: [] };
            return null;
        }
    }
}
