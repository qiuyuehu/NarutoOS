package hud.data
{
    public final class ActivityHubConfig
    {
        public static const instance:ActivityHubConfig = new ActivityHubConfig();
        public var enabled:Boolean = true;
        public var disabledTip:String = "该难度65级后开启";
        public function ActivityHubConfig() {}
        public function getDailyCfg(id:int):Object { return id == 55096 ? {href:"openui,52"} : null; }
    }
}
