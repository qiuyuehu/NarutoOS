package narutoos.daily
{
    import flash.utils.getDefinitionByName;

    /** Reads only server-backed team-dungeon progress and safe native handoff state. */
    public final class TeamDungeonProgress
    {
        private static const BATTLE_MODEL:String = "battleStart";

        /**
         * Returns the confirmed daily team-dungeon completion count, or -1 if unknown.
         *
         * The activity-hub record for activity 101 exposes reward remaining/total counts,
         * not successful clears. Those counts cannot be converted into completions because
         * ordinary clears and friendship clears use different quotas.
         */
        public static function completed():int
        {
            try
            {
                var taskUtils:Class = getDefinitionByName("task.utils.TaskUtils") as Class;
                var taskType:Class = getDefinitionByName("task.defs.TaskTypeDef") as Class;
                var conditionType:Class = getDefinitionByName("task.defs.TaskConditionTypeDef") as Class;
                var conditionState:Class = getDefinitionByName("task.defs.TaskConditionStateDef") as Class;
                if (taskUtils == null || taskType == null || conditionType == null ||
                    conditionState == null || taskUtils.model == null)
                {
                    return -1;
                }
                var needShowCount:Function = conditionType["needShowCount"] as Function;
                if (needShowCount == null)
                {
                    return -1;
                }

                var tasks:Array = taskUtils.model.getTaskInfosByType(taskType.DAILY) as Array;
                if (tasks == null)
                {
                    return -1;
                }

                var lowerBound:int = 0;
                var confirmedCount:int = -1;
                for each (var task:Object in tasks)
                {
                    if (task == null || task.cfg == null || !(task.conditions is Array) ||
                        !(task.cfg.conditions is Array) || task.conditions.length != 1 ||
                        task.cfg.conditions.length != 1)
                    {
                        continue;
                    }

                    var condition:Object = task.conditions[0];
                    var conditionCfg:Object = task.cfg.conditions[0];
                    if (condition == null || conditionCfg == null ||
                        !needShowCount(int(conditionCfg.type)))
                    {
                        continue;
                    }

                    if (!isGeneralClearCondition(String(conditionCfg.text)))
                    {
                        continue;
                    }

                    if (!(condition.data is Array) || condition.data.length == 0)
                    {
                        return -1;
                    }
                    if (!(condition.data[0] is Number) || !(conditionCfg.num is Number)) return -1;
                    var count:Number = Number(condition.data[0]);
                    var target:Number = Number(conditionCfg.num);
                    if (isNaN(count) || isNaN(target) || count < 0 || target <= 0 ||
                        count != Math.floor(count) || target != Math.floor(target) || count > target ||
                        (condition.state != conditionState.UNFINISH &&
                         condition.state != conditionState.FINISHED) ||
                        ((condition.state == conditionState.UNFINISH) != (count < target)))
                    {
                        return -1;
                    }

                    // A completed 1/1 or 2/2 task only proves that its small objective
                    // saturated; it cannot safely tell us whether another clear is needed.
                    if (count == target && target < 3)
                    {
                        lowerBound = Math.max(lowerBound, count);
                        continue;
                    }

                    if (confirmedCount >= 0 && confirmedCount != int(count))
                    {
                        return -1;
                    }
                    confirmedCount = int(count);
                }
                return confirmedCount >= lowerBound ? confirmedCount : -1;
            }
            catch (error:Error)
            {
                return -1;
            }
            return -1;
        }

        private static function isGeneralClearCondition(text:String):Boolean
        {
            if (text == null)
            {
                return false;
            }
            var normalized:String = text.replace(/<[^>]*>/g, "").replace(/\s/g, "");
            normalized = normalized.replace(/[。！!？?]+$/g, "");
            // Keep the whole configured condition to the general clear action. This rejects
            // friend, roster, and difficulty sub-goals that are not a total clear counter.
            return /^(?:(?:通关|完成|成功挑战)组队副本|组队副本(?:通关|完成|成功挑战))(?:%?\d+次)?$/.test(normalized);
        }

        /** Fails closed unless the native player is in a walkable, unlocked, idle scene. */
        public static function canHandoff(application:Object):Boolean
        {
            try
            {
                if (application == null || !("isFightLock" in application) ||
                    Boolean(application.isFightLock) || !("selfInfo" in application) ||
                    !("globelInfo" in application) || application.globelInfo == null ||
                    !("sceneId" in application.globelInfo) || !("sceneToId" in application.globelInfo) ||
                    application.globelInfo.sceneId == null || application.globelInfo.sceneToId == null ||
                    int(application.globelInfo.sceneId) <= 0 ||
                    int(application.globelInfo.sceneId) != int(application.globelInfo.sceneToId))
                {
                    return false;
                }

                if (application.selfInfo == null || application.selfInfo.state == null)
                {
                    return false;
                }
                var stateType:Class = getDefinitionByName("user.def.UserStateDef") as Class;
                if (stateType == null || stateType.ACTION_CAN_WALK_TO_DEST == null ||
                    !Boolean(application.selfInfo.state.getFlagByName(
                        String(stateType.ACTION_CAN_WALK_TO_DEST))))
                {
                    return false;
                }

                if (!("getModel" in application))
                {
                    return false;
                }
                var battle:Object = application.getModel(BATTLE_MODEL);
                return battle != null && "isFighting" in battle && !Boolean(battle.isFighting);
            }
            catch (error:Error)
            {
                return false;
            }
            return false;
        }
    }
}
