package
{
    import flash.display.Sprite;
    import flash.external.ExternalInterface;
    import narutoos.daily.DailyQueue;
    import narutoos.daily.IDailyTask;
    import narutoos.daily.InfiniteIllusionSweep;

    public final class InfiniteIllusionSweepFixture extends Sprite
    {
        private var queue:DailyQueue;
        private var adapter:InfiniteSweepFixtureAdapter;
        private var messages:Array = [];
        private var tail:int;
        private var timeoutMs:int = 3000;

        public function InfiniteIllusionSweepFixture()
        {
            perform("reset");
            ExternalInterface.addCallback("perform", perform);
        }

        private function createTask(id:String, done:Function, progress:Function, hasNext:Boolean):IDailyTask
        {
            if (id == "sweep") return new InfiniteIllusionSweep(this, done, function(message:String):void {}, hasNext, adapter, timeoutMs);
            return new SweepFixtureTail(function():void { tail++; adapter.tailHandoffs++; done(DailyQueue.COMPLETE, "托管"); });
        }

        private function perform(action:String, value:String = ""):Object
        {
            var counts:Array = [];
            if (action == "reset")
            {
                if (queue != null) queue.cancel();
                adapter = new InfiniteSweepFixtureAdapter(value);
                timeoutMs = value == "timeout" || value == "cancel" ? 700 : 3000;
                messages = [];
                tail = 0;
                queue = new DailyQueue(createTask, function(progress:String):void {}, function(message:String):void { messages.push(message); });
            }
            else if (action == "start") queue.start(value == "no-handoff" ? ["sweep"] : ["sweep", "tail"]);
            else if (action == "start-stop-pending") { queue.start(["sweep", "tail"]); queue.cancel(); }
            else if (action == "start-user-ok-stop") { queue.start(["sweep", "tail"]); adapter.confirm(); queue.cancel(); }
            else if (action == "reward") adapter.showReward();
            else if (action == "hideReward") adapter.finishRewardClose();
            else if (action == "refresh") adapter.refresh();
            else if (action == "reopen") adapter.reopen();
            else if (action == "restart") queue.start(["sweep", "tail"]);
            else if (action == "stop") queue.cancel();
            else if (action == "native-cold") return narutoos.daily.NativeAdapterProbe.coldStart(this);
            for each (var stage:Object in adapter.dungeons) counts.push(int(stage.passCount));
            return {running:queue.running, clicks:adapter.clicks, confirms:adapter.confirms,
                closes:adapter.closes, rewardCloses:adapter.rewardCloses, settingWrites:adapter.settingWrites,
                confirmationCancels:adapter.confirmationCancels,
                raidWasSubmitted:adapter.raidWasSubmitted,
                protocolRequests:adapter.protocolRequests, tail:tail,
                clickOrder:adapter.clickOrder, selectedIndex:adapter.selectedIndex,
                passCounts:counts,
                messages:messages, panel:adapter.panel, modal:adapter.modal};
        }
    }
}
