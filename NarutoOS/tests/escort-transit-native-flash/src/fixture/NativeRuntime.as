package fixture
{
    import com.tencent.morefun.framework.apf.core.facade.Facade;
    import com.tencent.morefun.naruto.plugin.ui.box.BoxManager;
    import com.tencent.morefun.naruto.plugin.task.views.TaskCommitPanel;
    import task.datas.TaskInfo;
    import task.defs.TaskStateDef;
    import task.models.TaskModel;
    import task.commands.HrefEventCommand;
    import task.commands.OpenTaskCommitPanelCommand;
    import flash.display.Sprite;
    import base.ApplicationData;
    import def.ModelDef;
    import task.defs.TaskConditionStateDef;
    import task.defs.TaskTypeDef;
    import serverProto.fight.FightStartType;
    import user.def.UserStateDef;

    public final class NativeRuntime
    {
        public static var task:TaskModel;
        public static var battle:BattleModel;
        public static var player:PlayerModel;
        public static var openCommitIds:Array;

        public static function reset():void
        {
            var keepOpenPanel:Class = OpenTaskCommitPanelCommand;
            var keepModelDef:Class = ModelDef;
            var keepTaskCondition:Class = TaskConditionStateDef;
            var keepTaskType:Class = TaskTypeDef;
            var keepFightType:Class = FightStartType;
            var keepUserState:Class = UserStateDef;
            task = new TaskModel();
            battle = new BattleModel();
            player = new PlayerModel();
            openCommitIds = [];
            var application:ApplicationData = ApplicationData.singleton;
            BoxManager.showingList = [];
            HrefEventCommand.calls = [];
            Facade.getInstance().model = new FakeModels();
            Facade.getInstance().pluginManager = new FakeModels();
            FakeModels.models["task"] = task;
            FakeModels.models["battleStart"] = battle;
            FakeModels.models["player.PlayerModel"] = player;
        }

        public static function receive(id:int, hard:int, state:int):void
        {
            task.tasks = [new TaskInfo(id, hard, state)];
        }

        public static function complete(id:int):void
        {
            var receipt:Object = task.tasks[0];
            receipt.state = TaskStateDef.COMMITED;
            task.dispatch("taskInfoCommit", receipt);
        }

        public static function remove(id:int):void
        {
            var receipt:Object = task.tasks[0];
            task.tasks = [];
            task.dispatch("taskInfoRemove", receipt);
        }

        public static function showCommit(owner:Sprite, id:int, state:int):Object
        {
            var box:TaskCommitPanel = new TaskCommitPanel(task.tasks[0]);
            owner.addChild(box);
            BoxManager.showingList = [box];
            return box;
        }
    }
}
