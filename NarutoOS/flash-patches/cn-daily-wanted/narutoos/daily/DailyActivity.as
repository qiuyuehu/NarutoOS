package narutoos.daily
{
    import flash.utils.getDefinitionByName;

    /** Opens a daily activity through its configured native game route. */
    public final class DailyActivity
    {
        public static function route(activityId:int):Object
        {
            var configType:Class = getDefinitionByName("hud.data.ActivityHubConfig") as Class;
            var config:Object = configType.instance;
            var activity:Object = config != null ? config.getDailyCfg(activityId) : null;
            if (activity == null || activity.href == null || String(activity.href) == "")
            {
                throw new Error("找不到该日常活动的原生入口。");
            }

            var commandType:Class = getDefinitionByName("task.commands.HrefEventCommand") as Class;
            return new commandType(String(activity.href));
        }

        public static function call(command:Object, listener:Function):void
        {
            if (command == null)
            {
                throw new Error("原生活动入口命令为空。");
            }
            if (listener != null)
            {
                command.addEventListener("loadingEnd", listener);
                command.addEventListener("faild", listener);
            }
            try
            {
                command.call();
            }
            catch (error:Error)
            {
                removeListener(command, listener);
                throw error;
            }
        }

        public static function removeListener(command:Object, listener:Function):void
        {
            if (command == null || listener == null)
            {
                return;
            }
            command.removeEventListener("loadingEnd", listener);
            command.removeEventListener("faild", listener);
        }
    }
}
