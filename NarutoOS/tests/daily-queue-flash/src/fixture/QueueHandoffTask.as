package fixture
{
    import base.ApplicationData;
    import flash.display.Sprite;
    import narutoos.daily.DailyQueue;
    import narutoos.daily.IDailyTask;

    public final class QueueHandoffTask implements IDailyTask
    {
        private var owner:Sprite;
        private var done:Function;
        private var record:Function;
        private var scoreHideFinished:Function;
        private var _running:Boolean;

        public function QueueHandoffTask(owner:Sprite, done:Function, record:Function, scoreHideFinished:Function)
        {
            this.owner = owner;
            this.done = done;
            this.record = record;
            this.scoreHideFinished = scoreHideFinished;
        }

        public function get running():Boolean { return _running; }

        public function start():void
        {
            _running = true;
            var app:Object = ApplicationData.singleton;
            var state:Object = app.selfInfo != null ? app.selfInfo.state : null;
            var safe:Boolean = !StrongEnvironment.battle.isFighting && !app.isFightLock &&
                (state != null && Boolean(state.getFlagByName("canWalk"))) &&
                owner.stage.getChildByName("fightUI") == null && StrongEnvironment.box == null;
            record({started:true, safe:safe, fighting:StrongEnvironment.battle.isFighting,
                fightLock:app.isFightLock, resultLayerOpen:owner.stage.getChildByName("fightUI") != null,
                rewardPanelOpen:StrongEnvironment.box != null,
                scoreHideFinished:Boolean(scoreHideFinished())});
            Object(owner.parent).record("after.started");
            _running = false;
            done(DailyQueue.COMPLETE, "后项已在角色可操作且结算关闭后启动。");
        }

        public function cancel():void { _running = false; }
    }
}
