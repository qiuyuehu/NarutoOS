package narutoos.daily
{
    import flash.display.InteractiveObject;
    import flash.display.Sprite;
    import flash.events.Event;
    import flash.events.IEventDispatcher;
    import flash.events.MouseEvent;
    import flash.utils.getDefinitionByName;
    import flash.utils.getQualifiedClassName;

    /** Reads one native escort task and resumes it through its own task route. */
    public final class EscortTransit
    {
        private static const TASK_COMMIT_PANEL:String =
            "com.tencent.morefun.naruto.plugin.task.views::TaskCommitPanel";
        private static const POLL_STABLE_MS:int = 1800;
        private static const MOVE_EPSILON:Number = 18;

        private var owner:Sprite;
        private var application:Object;
        private var taskModel:Object;
        private var battle:Object;
        private var playerModel:Object;
        private var facade:Object;
        private var taskStates:Object;
        private var taskTypes:Object;
        private var conditionStates:Object;
        private var escortBattleTypes:Object;
        private var boxManager:Object;
        private var battleEventName:String;
        private var taskEventName:String;
        private var lockedId:int;
        private var lockedHard:int;
        private var lockedReceiveTime:uint;
        private var lastX:Number = NaN;
        private var lastY:Number = NaN;
        private var stableSince:Number;
        private var observedBattle:Boolean;
        private var observedWatch:Boolean;
        private var battleEnded:Boolean;
        private var removedReceipt:Boolean;
        private var commitSeen:Boolean;
        private var settlementOpening:Boolean;
        private var settlementClicked:Boolean;
        private var lastAdvanceX:Number = NaN;
        private var lastAdvanceY:Number = NaN;
        private var active:Boolean;
        private var deliveryNpc:Object;

        public function EscortTransit(owner:Sprite)
        {
            this.owner = owner;
        }

        /**
         * Returns the current native escort state. `none` means no escort task is
         * currently received; after a task was locked, only native terminal
         * model evidence can change that task to `ended`.
         */
        public function read(grade:int = 5, allowActiveS:Boolean = false):Object
        {
            try
            {
                if (!bindNative()) return {kind:"unknown", reason:"原生押镖状态尚未载入。"};
                if (commitSeen) return {kind:"ended", id:lockedId, hard:lockedHard, outcome:"completed"};
                if (removedReceipt) return {kind:"ended", id:lockedId, hard:lockedHard, outcome:"removed"};
                if (!taskModel.responded) return {kind:"unknown", reason:"等待游戏返回押镖任务列表。"};
                var infos:Array = taskModel.getTaskInfosByType(taskTypes.ESCORT) as Array;
                if (infos == null) return {kind:"unknown", reason:"无法读取原生押镖任务列表。"};
                if (activeOrders(infos) > 1) return {kind:"unknown", id:lockedId,
                    reason:"发现多个已接押镖任务，无法安全锁定当前单。"};
                var current:Object = findLockedTask(infos);
                if (current == null && lockedId == 0)
                {
                    current = findActiveTask(infos);
                    if (current != null)
                    {
                        lockedId = int(current.id);
                        lockedHard = current.cfg ? int(current.cfg.hard) : -1;
                        lockedReceiveTime = uint(current.receiveTime);
                        attachBattleListener();
                    }
                }
                if (current != null)
                {
                    var state:int = int(current.state);
                    if (current.cfg == null || int(current.cfg.hard) != lockedHard)
                        return snapshot("other", current, {reason:"原生镖单等级已变化。"});
                    if (lockedReceiveTime != 0 && uint(current.receiveTime) != 0 &&
                        uint(current.receiveTime) != lockedReceiveTime)
                        return snapshot("unknown", current, {reason:"同一任务编号已对应新的接单记录。"});
                    if (lockedReceiveTime == 0 && uint(current.receiveTime) != 0)
                        lockedReceiveTime = uint(current.receiveTime);
                    var matchesGrade:Boolean = lockedHard == grade || (allowActiveS && lockedHard == 4);
                    if (state == taskStates.COMMITED || state == taskStates.FAILED)
                    {
                        commitSeen = state == taskStates.COMMITED;
                        return snapshot("ended", current, {outcome:commitSeen ? "completed" : "failed"});
                    }
                    if (state == taskStates.COMMIT_ABLE)
                        return snapshot(matchesGrade ? "settling" : "other", current, {outcome:"pending", destinationReached:true});
                    if (state == taskStates.RECEIVED)
                    {
                        var movement:Object = movementState();
                        return snapshot(matchesGrade ? "active" : "other", current, {
                            moving:movement.moving,
                            stopped:movement.stopped,
                            inBattle:isFighting(),
                            postBattle:battleEnded,
                            canHandoff:TeamDungeonProgress.canHandoff(application),
                            destinationReached:destinationReached(current),
                            isEscorting:Boolean(taskModel.isEscorting)
                        });
                    }
                    return snapshot("other", current, {reason:"在途任务状态已变化，请确认角色和原生押镖面板。"});
                }

                if (lockedId != 0)
                {
                    return {kind:"unknown", id:lockedId, hard:lockedHard,
                        reason:"原生列表已无当前任务，但没有收到可确认的完成或移除回执。"};
                }
                return {kind:"none", id:0, hard:-1, freeAcceptRemaining:int(taskModel.escortFreeAcceptRemainderNum)};
            }
            catch (error:Error)
            {
                return {kind:"unknown", id:lockedId, hard:lockedHard, reason:"读取押镖原生状态失败：" + error.message};
            }
            return {kind:"unknown", id:lockedId, hard:lockedHard, reason:"原生押镖状态不可用。"};
        }

        /**
         * Continues only the locked task. `newlyAccepted` is reserved for the
         * state machine's first native go-to action; callers normally let the
         * selected task row perform that initial departure.
         */
        public function advance(id:int, newlyAccepted:Boolean = false, grade:int = 5, delivery:Object = null):Boolean
        {
            if (!owner || !owner.stage || !bindNative() || id <= 0 || id != lockedId || grade != lockedHard) return false;
            var task:Object = findLockedTask(taskModel.getTaskInfosByType(taskTypes.ESCORT) as Array);
            if (task == null || int(task.id) != id || task.cfg == null || int(task.cfg.hard) != grade) return false;
            if (lockedReceiveTime != 0 && uint(task.receiveTime) != 0 &&
                uint(task.receiveTime) != lockedReceiveTime) return false;
            if (lockedReceiveTime == 0 && uint(task.receiveTime) != 0)
                lockedReceiveTime = uint(task.receiveTime);

            if (int(task.state) == taskStates.COMMIT_ABLE)
                return submitNativeSettlement(task, delivery);
            if (int(task.state) != taskStates.RECEIVED || isFighting() || isFightLocked() ||
                isWatch() || !TeamDungeonProgress.canHandoff(application))
                return false;

            var movement:Object = movementState();
            if (movement.moving || !movement.stopped || destinationReached(task) || hasBlockingModal()) return false;
            if (!newlyAccepted && !battleEnded) return false;
            if (isSameAdvancePosition(movement.x, movement.y)) return false;

            var href:String = nativeTaskHref(task);
            if (!href) return false;
            var commandType:Class = getDefinitionByName("task.commands.HrefEventCommand") as Class;
            if (commandType == null) return false;
            var command:Object = new commandType(href);
            command.call();
            lastAdvanceX = movement.x;
            lastAdvanceY = movement.y;
            battleEnded = false;
            return true;
        }

        private function bindNative():Boolean
        {
            if (active) return taskModel != null && battle != null;
            if (owner == null || owner.stage == null) return false;
            var appType:Class = getDefinitionByName("base.ApplicationData") as Class;
            var facadeType:Class = getDefinitionByName("com.tencent.morefun.framework.apf.core.facade.Facade") as Class;
            var modelDefs:Class = getDefinitionByName("def.ModelDef") as Class;
            var taskStateType:Class = getDefinitionByName("task.defs.TaskStateDef") as Class;
            var taskType:Class = getDefinitionByName("task.defs.TaskTypeDef") as Class;
            application = appType.singleton;
            var facadeFactory:Object = facadeType;
            facade = facadeFactory.getInstance();
            taskModel = facade.model.retrieveModel(modelDefs.TASK);
            battle = application.getModel(modelDefs.BATTLE);
            playerModel = facade.model.retrieveModel("player.PlayerModel");
            taskStates = {
                RECEIVED:taskStateType.RECEIVED,
                COMMIT_ABLE:taskStateType.COMMIT_ABLE,
                COMMITED:taskStateType.COMMITED,
                FAILED:taskStateType.FAILED
            };
            var conditionStateType:Class = getDefinitionByName("task.defs.TaskConditionStateDef") as Class;
            conditionStates = {FINISHED:conditionStateType.FINISHED};
            var fightType:Class = getDefinitionByName("serverProto.fight.FightStartType") as Class;
            escortBattleTypes = {sceneEscort:fightType.FIGHT_START_TYPE_SCENE_ESCORT,
                realPlayerRob:fightType.FIGHT_START_TYPE_REAL_PLAYER_ROB};
            taskTypes = {ESCORT:taskType.ESCORT};
            boxManager = getDefinitionByName("com.tencent.morefun.naruto.plugin.ui.box.BoxManager");
            if (taskModel == null || battle == null || boxManager == null) return false;
            var modelEventType:Class = getDefinitionByName("com.tencent.morefun.naruto.model.event.ModelEvent") as Class;
            taskEventName = String(modelEventType.UPDATE);
            IEventDispatcher(taskModel).addEventListener(taskEventName, onTaskUpdate);
            try
            {
                var deliveryType:Class = getDefinitionByName("narutoos.daily.EscortDeliveryNpc") as Class;
                deliveryNpc = new deliveryType();
            }
            catch (missingDeliveryAdapter:Error) { deliveryNpc = null; }
            active = true;
            return true;
        }

        private function onTaskUpdate(event:Event):void
        {
            if (lockedId == 0 || taskModel == null) return;
            var nativeEvent:Object = Object(event);
            var key:String = String(nativeEvent.key);
            if (key != "taskInfoCommit" && key != "taskInfoRemove") return;
            var receipt:Object = nativeEvent.oldValue;
            if (receipt == null || int(receipt.id) != lockedId ||
                (receipt.cfg != null && int(receipt.cfg.hard) != lockedHard)) return;
            if (lockedReceiveTime != 0 && uint(receipt.receiveTime) != 0 &&
                uint(receipt.receiveTime) != lockedReceiveTime) return;
            if (lockedReceiveTime == 0 && uint(receipt.receiveTime) != 0)
                lockedReceiveTime = uint(receipt.receiveTime);
            if (key == "taskInfoCommit") commitSeen = true;
            else if (key == "taskInfoRemove") removedReceipt = true;
        }

        private function attachBattleListener():void
        {
            if (battleEventName != null) return;
            var eventType:Class = getDefinitionByName("com.tencent.morefun.naruto.model.event.ModelEvent") as Class;
            battleEventName = String(eventType.UPDATE);
            IEventDispatcher(battle).addEventListener(battleEventName, onBattleUpdate);
            if (isFighting())
            {
                observedBattle = isEscortBattle();
                observedWatch = isWatch();
            }
        }

        private function onBattleUpdate(event:Event):void
        {
            var key:String = String(Object(event).key);
            if (key == "start")
            {
                observedBattle = isEscortBattle();
                observedWatch = isWatch();
                lastAdvanceX = lastAdvanceY = NaN;
                if (observedBattle)
                {
                    battleEnded = false;
                    resetMovementSample();
                }
            }
            else if (key == "end" && observedBattle)
            {
                observedBattle = false;
                battleEnded = isEscortBattle() && !observedWatch;
                resetMovementSample();
            }
            else if (key == "fail")
            {
                observedBattle = false;
                battleEnded = false;
                resetMovementSample();
            }
        }

        private function findLockedTask(infos:Array):Object
        {
            if (infos == null) return null;
            for each (var info:Object in infos)
                if (info != null && int(info.id) == lockedId && lockedId != 0) return info;
            return null;
        }

        private function findActiveTask(infos:Array):Object
        {
            if (infos == null) return null;
            for each (var info:Object in infos)
            {
                if (info != null && (int(info.state) == taskStates.RECEIVED || int(info.state) == taskStates.COMMIT_ABLE))
                    return info;
            }
            return null;
        }

        private function snapshot(kind:String, task:Object, extra:Object = null):Object
        {
            var result:Object = {kind:kind, id:int(task.id), hard:task.cfg ? int(task.cfg.hard) : -1,
                state:int(task.state), receivedAt:uint(task.receiveTime)};
            if (extra != null) for (var key:String in extra) result[key] = extra[key];
            return result;
        }

        private function movementState():Object
        {
            var player:Object = playerModel ? playerModel.selfPlayer : null;
            if (player == null) return {moving:true, stopped:false, x:NaN, y:NaN};
            var x:Number = Number(player.x);
            var y:Number = Number(player.y);
            var end:Object = player.endPoint;
            var moving:Boolean = end != null && distance(x, y, Number(end.x), Number(end.y)) > MOVE_EPSILON;
            var now:Number = new Date().time;
            if (isNaN(lastX) || isNaN(lastY) || distance(x, y, lastX, lastY) > MOVE_EPSILON)
            {
                lastX = x;
                lastY = y;
                stableSince = now;
            }
            return {moving:moving, stopped:!moving && now - stableSince >= POLL_STABLE_MS, x:x, y:y};
        }

        private function distance(x1:Number, y1:Number, x2:Number, y2:Number):Number
        {
            var dx:Number = x1 - x2;
            var dy:Number = y1 - y2;
            return Math.sqrt(dx * dx + dy * dy);
        }

        private function isSameAdvancePosition(x:Number, y:Number):Boolean
        {
            return !isNaN(lastAdvanceX) && !isNaN(lastAdvanceY) &&
                distance(x, y, lastAdvanceX, lastAdvanceY) <= MOVE_EPSILON;
        }

        private function nativeTaskHref(task:Object):String
        {
            if (task.cfg == null || task.cfg.conditions == null || task.cfg.conditions.length == 0) return "";
            var condition:Object = task.cfg.conditions[0];
            return condition && condition.data != null ? String(condition.data) : "";
        }

        private function submitNativeSettlement(task:Object, delivery:Object):Boolean
        {
            if (isFighting() || isFightLocked() || (delivery && delivery.commitSubmitted)) return false;
            var top:Object = topModal();
            var list:Array = boxManager.showingList as Array;
            if (list == null) return false;
            for each (var box:Object in list)
            {
                if (box == null || box !== top || box.stage !== owner.stage || getQualifiedClassName(box) != TASK_COMMIT_PANEL) continue;
                var info:Object = box.getTaskInfo();
                if (info == null || int(info.id) != int(task.id) || int(info.state) != taskStates.COMMIT_ABLE ||
                    (lockedReceiveTime != 0 && uint(info.receiveTime) != 0 &&
                        uint(info.receiveTime) != lockedReceiveTime)) continue;
                var ui:Object = box.content;
                var button:InteractiveObject = ui && "okBtn" in ui ? ui.okBtn as InteractiveObject : null;
                if (!isNativeButtonReady(button)) return false;
                if (!settlementClicked)
                {
                    settlementClicked = true;
                    if (delivery) delivery.commitSubmitted = true;
                    button.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true, false));
                    return true;
                }
                return false;
            }
            if (deliveryNpc != null && deliveryNpc.step(top, task, taskModel, application))
            {
                if (delivery && deliveryNpc.hasSubmitted) delivery.commitSubmitted = true;
                return true;
            }
            if (top != null || !TeamDungeonProgress.canHandoff(application)) return false;
            if (Boolean(task.cfg.commitNpcSceneId) && Boolean(task.cfg.commitNpcId))
            {
                var move:Object = movementState();
                if (move.moving || !move.stopped || settlementOpening) return false;
                var routeType:Class = getDefinitionByName("task.commands.HrefEventCommand") as Class;
                if (routeType != null)
                {
                    settlementOpening = true;
                    new routeType("goto," + task.cfg.commitNpcSceneId + "," + task.cfg.commitNpcId).call();
                    return true;
                }
                return false;
            }
            if (!settlementOpening)
            {
                var openType:Class = getDefinitionByName("task.commands.OpenTaskCommitPanelCommand") as Class;
                if (openType != null)
                {
                    settlementOpening = true;
                    new openType(int(task.id)).call();
                    return true;
                }
            }
            return false;
        }

        private function isNativeButtonReady(button:InteractiveObject):Boolean
        {
            return button != null && button.stage != null && button.visible && button.mouseEnabled &&
                "enabled" in button && Object(button).enabled;
        }

        private function hasBlockingModal():Boolean
        {
            return topModal() != null;
        }

        private function topModal():Object
        {
            var list:Array = boxManager == null ? null : boxManager.showingList as Array;
            if (list == null) return null;
            for (var i:int = list.length - 1; i >= 0; i--)
            {
                var box:Object = list[i];
                if (box && box.stage === owner.stage && box.visible && (box.isShowing || box.isShow) &&
                    (box.modal || getQualifiedClassName(box) == EscortDeliveryNpc.DIALOG)) return box;
            }
            return null;
        }

        private function activeOrders(infos:Array):int
        {
            var count:int = 0;
            for each (var info:Object in infos)
                if (info && (int(info.state) == taskStates.RECEIVED || int(info.state) == taskStates.COMMIT_ABLE)) count++;
            return count;
        }

        private function destinationReached(task:Object):Boolean
        {
            if (task == null || task.conditions == null) return false;
            if (task.conditions.length == 0) return false;
            for each (var condition:Object in task.conditions)
                if (!condition || int(condition.state) != conditionStates.FINISHED) return false;
            return true;
        }

        private function isFighting():Boolean
        {
            return battle != null && Boolean(battle.isFighting);
        }

        private function isEscortBattle():Boolean
        {
            return battle != null && escortBattleTypes != null &&
                (int(battle.type) == int(escortBattleTypes.sceneEscort) ||
                    int(battle.type) == int(escortBattleTypes.realPlayerRob));
        }

        private function isWatch():Boolean
        {
            return battle != null && "isWatch" in battle && Boolean(battle.isWatch);
        }

        private function resetMovementSample():void
        {
            var player:Object = playerModel ? playerModel.selfPlayer : null;
            lastX = player == null ? NaN : Number(player.x);
            lastY = player == null ? NaN : Number(player.y);
            stableSince = new Date().time;
        }

        private function isFightLocked():Boolean
        {
            return application != null && Boolean(application.isFightLock);
        }

        /** Detaches listeners and clears the identity lock before a new run. */
        public function cancel():void
        {
            if (battleEventName != null && battle is IEventDispatcher)
                IEventDispatcher(battle).removeEventListener(battleEventName, onBattleUpdate);
            if (taskEventName != null && taskModel is IEventDispatcher)
                IEventDispatcher(taskModel).removeEventListener(taskEventName, onTaskUpdate);
            owner = null;
            taskModel = null;
            application = battle = playerModel = boxManager = facade = null;
            battleEventName = taskEventName = null;
            lockedId = 0;
            lockedHard = -1;
            lockedReceiveTime = 0;
            lastX = lastY = lastAdvanceX = lastAdvanceY = NaN;
            stableSince = 0;
            observedBattle = battleEnded = removedReceipt = commitSeen = false;
            observedWatch = false;
            settlementOpening = settlementClicked = false;
            conditionStates = null;
            escortBattleTypes = null;
            deliveryNpc = null;
            stableSince = 0;
            active = false;
        }
    }
}
