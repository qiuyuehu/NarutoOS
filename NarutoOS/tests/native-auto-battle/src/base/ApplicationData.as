package base
{
    import fixture.AutoBattleModel;
    import flash.system.ApplicationDomain;
    public final class ApplicationData
    {
        public static const singleton:ApplicationData = new ApplicationData();
        public var battle:AutoBattleModel = new AutoBattleModel();
        public var pluginDomain:ApplicationDomain = new ApplicationDomain(null);
        public var selfInfo:Object = { uin: 1, svrId: 1, role: 0, level: 80 };
        public function getModel(name:String):Object { return name == "battleStart" ? battle : null; }
        public function getPluginInfo(name:String):Object { return name == "battle.IBattlePlugin" ? {domain:pluginDomain} : null; }
    }
}
