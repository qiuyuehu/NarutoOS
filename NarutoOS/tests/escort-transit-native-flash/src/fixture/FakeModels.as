package fixture
{
    public final class FakeModels
    {
        public static var models:Object = {};
        public function retrieveModel(name:String):Object { return models[name]; }
    }
}
