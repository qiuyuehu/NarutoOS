package base
{
    import fixture.NativeRuntime;
    public final class ApplicationData
    {
        public static const singleton:ApplicationData = new ApplicationData();
        public var isFightLock:Boolean;
        public var selfInfo:Object = {state:{getFlagByName:function(name:String):Boolean { return true; }}};
        public var globelInfo:Object = {sceneId:1, sceneToId:1};
        public function getModel(name:String):Object { return NativeRuntime.battle; }
    }
}
