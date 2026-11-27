package
{
    import flash.display.Sprite;
    import flash.external.ExternalInterface;
    import flash.utils.getQualifiedClassName;
    import com.tencent.morefun.framework.apf.core.facade.Facade;
    import com.tencent.morefun.naruto.plugin.dungeon.view.teamNewDungeon.EnterConfirmWindow;
    import com.tencent.morefun.naruto.plugin.dungeon.view.teamNewDungeon.TeamNewDungeonPanel;
    import com.tencent.morefun.naruto.plugin.dungeon.view.reward.TeamNewDungeonRewardPanel;
    import com.tencent.morefun.naruto.plugin.dungeon.view.reward.TeamDungeonBlocker;
    import com.tencent.morefun.naruto.plugin.ui.box.BoxManager;
    import def.ModelDef;
    import dungeon.command.TeamNewDungeonFightCommand;
    import fixture.StrongEvent;
    import narutoos.daily.TeamDungeonPanel;
    import narutoos.daily.TeamDungeonProgress;
    import narutoos.daily.TeamDungeonRun;
    import serverProto.fight.FightStartType;
    import base.ApplicationData;

    public final class TeamDungeonFixture extends Sprite
    {
        private var owner:Sprite;
        private var run:TeamDungeonRun;
        private var windowProgress:Object;
        private var panel:TeamNewDungeonPanel;
        private var finished:Array = [];
        private var reports:Array = [];
        private var fightCommands:Array = [];
        private var battle:Object;
        private var team:Object;
        private var mode:String;
        private var dungeonId:int = 93001;
        private var blocker:TeamDungeonBlocker;
        private var blockedReward:Object;

        public function TeamDungeonFixture()
        {
            ExternalInterface.addCallback("perform", perform);
            owner = new Sprite();
            addChild(owner);
            TeamDungeonPanel.target = this;
            battle = ApplicationData.singleton.getModel("battleStart");
            team = Facade.getInstance().model.retrieveModel(ModelDef.TEAM);
        }

        private function perform(action:String, value:String = ""):Object
        {
            if (action == "begin" || action == "resume") begin(value, action == "begin");
            else if (action == "cancel" && run != null) run.cancel();
            else if (action == "result") showResult(value != "lose");
            else if (action == "end") endBattle();
            else if (action == "reward") showReward();
            else if (action == "rewardReadyBlocked") { readyReward(); blockReward(); }
            else if (action == "readyReward") readyReward();
            else if (action == "unblockReward") unblockReward();
            else if (action == "reopen") reopenList();
            else if (action == "snapshot") {}
            return snapshot();
        }

        private function begin(value:String, resetWindow:Boolean):void
        {
            if (run != null) run.cancel();
            if (resetWindow) windowProgress = {};
            closeBoxes();
            BoxManager.underlying = null;
            TeamNewDungeonRewardPanel.closeCalls = 0;
            TeamNewDungeonRewardPanel.backClickCalls = 0;
            var parts:Array = value.split("|");
            mode = parts.length > 1 ? String(parts[1]) : "ready";
            TeamDungeonPanel.reset();
            TeamDungeonPanel.target = this;
            TeamDungeonProgress.currentCompleted = int(parts[0]);
            TeamDungeonProgress.handoff = true;
            team.isJoined = false;
            team.matchDungeonState = "matchDungeonStateEmpty";
            battle.isFighting = false;
            battle.type = 0;
            finished = [];
            reports = [];
            fightCommands = [];
            panel = null;
            if (mode == "ready")
            {
                TeamDungeonPanel.selected = {kind:"ready", dungeonId:dungeonId, button:null, message:""};
            }
            else
            {
                TeamDungeonPanel.selected = {kind:mode,
                    message:mode == "blocked" ? "当前没有可进入的困难副本。" : ""};
            }
            run = new TeamDungeonRun(owner, onFinished, onProgress, windowProgress);
            run.start();
        }

        public function openTeamDungeonPanel():void
        {
            showNewPanel();
        }

        public function confirmTeamDungeon():void
        {
            var command:TeamNewDungeonFightCommand = new TeamNewDungeonFightCommand(dungeonId, 3);
            fightCommands.push({dungeonId:command.dungeonId, difficulty:command.difficulty,
                type:getQualifiedClassName(command)});
            Facade.getInstance().commandManager.dispatchEvent(new StrongEvent("commandRequest", command));
            battle.isFighting = true;
            battle.type = FightStartType.FIGHT_START_TYPE_NEW_TEAM_DUNGEON;
            battle.dispatchEvent(new StrongEvent("update", null, null, "start"));
            var confirm:EnterConfirmWindow = BoxManager.current as EnterConfirmWindow;
            if (confirm != null && confirm.parent != null) confirm.parent.removeChild(confirm);
            if (panel != null)
            {
                panel.isShow = false;
                panel.isShowing = false;
                BoxManager.dispathcer.dispatchEvent(new StrongEvent("boxHide", null, panel));
                if (panel.parent != null) panel.parent.removeChild(panel);
                BoxManager.dispathcer.dispatchEvent(new StrongEvent("boxHided", null, panel));
            }
            BoxManager.current = null;
        }

        private function showResult(won:Boolean):void
        {
            battle.isWin = won;
            battle.dispatchEvent(new StrongEvent("update", null, null, "showResult"));
            BoxManager.current = null;
        }

        private function endBattle():void
        {
            battle.isFighting = false;
            battle.type = FightStartType.FIGHT_START_TYPE_NEW_TEAM_DUNGEON;
            battle.dispatchEvent(new StrongEvent("update", null, null, "end"));
            if (TeamDungeonProgress.currentCompleted >= 0 && battle.isWin)
                TeamDungeonProgress.currentCompleted++;
        }

        private function reopenList():void
        {
            var reward:TeamNewDungeonRewardPanel = BoxManager.current as TeamNewDungeonRewardPanel;
            if (reward != null)
            {
                reward.isShow = false;
                reward.isShowing = false;
                if (reward.parent != null) reward.parent.removeChild(reward);
            }
            showNewPanel();
        }

        private function showReward():void
        {
            var reward:TeamNewDungeonRewardPanel = new TeamNewDungeonRewardPanel();
            addChild(reward);
            BoxManager.current = reward;
            BoxManager.dispathcer.dispatchEvent(new StrongEvent("boxShow", null, reward));
            BoxManager.dispathcer.dispatchEvent(new StrongEvent("boxShowed", null, reward));
        }

        private function readyReward():void
        {
            var reward:TeamNewDungeonRewardPanel = BoxManager.current as TeamNewDungeonRewardPanel;
            if (reward != null) reward.markReady();
        }

        private function blockReward():void
        {
            blocker = new TeamDungeonBlocker();
            blockedReward = BoxManager.current;
            BoxManager.underlying = blockedReward;
            addChild(blocker);
            BoxManager.current = blocker;
        }

        private function unblockReward():void
        {
            if (blocker != null && blocker.parent != null) blocker.parent.removeChild(blocker);
            blocker = null;
            BoxManager.current = blockedReward;
            BoxManager.underlying = null;
            blockedReward = null;
        }

        private function showNewPanel():void
        {
            panel = new TeamNewDungeonPanel();
            var button:Sprite = TeamDungeonPanel.readyButton() as Sprite;
            panel.addChild(button);
            if (mode == "ready" || mode == "vanish")
                TeamDungeonPanel.selected = {kind:"ready", dungeonId:dungeonId, button:button, message:""};
            addChild(panel);
            BoxManager.current = panel;
            BoxManager.dispathcer.dispatchEvent(new StrongEvent("boxShow", null, panel));
            BoxManager.dispathcer.dispatchEvent(new StrongEvent("boxShowed", null, panel));
            if (mode == "vanish" && TeamDungeonPanel.routeCalls == 1)
                TeamDungeonProgress.currentCompleted = -1;
        }

        private function closeBoxes():void
        {
            if (BoxManager.current != null && BoxManager.current.parent != null)
                BoxManager.current.parent.removeChild(BoxManager.current);
            BoxManager.current = null;
        }

        private function onFinished(status:String, message:String):void
        {
            finished.push({status:status, message:message});
        }

        private function onProgress(message:String):void { reports.push(message); }

        private function snapshot():Object
        {
            var current:Object = BoxManager.current;
            return {running:run != null && run.running, routeCalls:TeamDungeonPanel.routeCalls,
                chooseCalls:TeamDungeonPanel.chooseCalls, confirmCalls:TeamDungeonPanel.confirmCalls,
                fightCommands:fightCommands, completed:TeamDungeonProgress.currentCompleted,
                rewardCloseCalls:TeamNewDungeonRewardPanel.closeCalls,
                rewardBackClickCalls:TeamNewDungeonRewardPanel.backClickCalls,
                finished:finished, reports:reports, panel:current == null ? "" : getQualifiedClassName(current),
                fighting:battle.isFighting};
        }
    }
}
