package
{
    import flash.display.MovieClip;
    import flash.external.ExternalInterface;
    import fixture.DailyTaskModel;
    import narutoos.daily.TeamDungeonProgress;
    import task.defs.TaskConditionStateDef;
    import task.defs.TaskConditionTypeDef;
    import task.defs.TaskTypeDef;
    import task.utils.TaskUtils;

    public final class TeamDungeonProgressFixture extends MovieClip
    {
        public function TeamDungeonProgressFixture()
        {
            if (ExternalInterface.available)
            {
                ExternalInterface.addCallback("run", run);
            }
        }

        private function run(name:String):int
        {
            // Keep the native definitions linked so getDefinitionByName resolves them.
            if (TaskTypeDef.DAILY != 7 || !TaskConditionTypeDef.needShowCount(3) ||
                TaskConditionStateDef.FINISHED != 1)
            {
                return -2;
            }
            var tasks:Array = [];
            if (name == "zero" || name == "two" || name == "three" || name == "small-complete" ||
                name == "pt-two" || name == "pt-saturated" || name == "pt-scope")
            {
                var count:int = name == "zero" ? 0 : name == "two" ? 2 : name == "three" ? 3 :
                    name == "pt-two" ? 2 : 1;
                var target:int = name == "small-complete" || name == "pt-saturated" ? 1 :
                    name == "pt-scope" ? 2 : 3;
                var text:String = name == "pt-scope" ? "{c}Passar de fases de elite{/c}" :
                    name.indexOf("pt-") == 0 ? "{c}Passar de fases em grupo{/c}" : "通关组队副本" + target + "次";
                tasks.push(task(text, count, target, name.indexOf("pt-") == 0 ? 23 : 3));
            }
            else if (name == "ambiguous") tasks.push(task("组队副本3次", 2, 3));
            else if (name == "exact-with-saturated")
            {
                tasks.push(task("完成组队副本1次", 1, 1));
                tasks.push(task("组队副本通关3次", 2, 3));
            }
            else if (name == "reward")
            {
                tasks.push(task("获得组队副本奖励", 2, 3));
            }
            else if (name == "friend")
            {
                tasks.push(task("与好友通关组队副本", 2, 3));
            }
            else if (name == "difficulty")
            {
                tasks.push(task("通关困难组队副本", 2, 3));
            }
            else if (name == "conflict")
            {
                tasks.push(task("通关组队副本3次", 1, 3));
                tasks.push(task("组队副本完成3次", 2, 3));
            }
            TaskUtils.model = new DailyTaskModel(tasks);
            return TeamDungeonProgress.completed();
        }

        private function task(text:String, count:int, target:int, conditionType:int = 3):Object
        {
            return {
                cfg:{name:"组队副本", conditions:[{text:text, type:conditionType, num:target}]},
                conditions:[{data:[count], state:count == target ? 1 : 0}]
            };
        }
    }
}
