package fixture
{
    public final class DailyTaskModel
    {
        public var tasks:Array;

        public function DailyTaskModel(tasks:Array)
        {
            this.tasks = tasks;
        }

        public function getTaskInfosByType(type:int):Array
        {
            return type == 7 ? tasks : [];
        }
    }
}
