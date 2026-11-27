package base
{
    import task.models.TaskModel;
    import hud.models.ActivityHubModel;
    import def.ModelDef;
    public final class ApplicationData
    {
        public static var singleton:ApplicationData;
        public var taskModel:TaskModel = new TaskModel();
        public var activityHub:ActivityHubModel = new ActivityHubModel();
        public var selfInfo:Object = {guild:{guildId:1}};
        public function ApplicationData() { }
        public function getModel(id:int):Object { return id == ModelDef.TASK ? taskModel : activityHub; }
    }
}
