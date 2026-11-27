package hud.data
{
    public final class ActivityHubConfig
    {
        public static var instance:ActivityHubConfig = new ActivityHubConfig();
        public function getCfgByActivityId(id:int):Array { return [{href:"gotoGuild,26900601"}]; }
    }
}
