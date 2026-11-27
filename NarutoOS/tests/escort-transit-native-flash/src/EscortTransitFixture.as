package
{
    import flash.display.Sprite;
    import flash.events.Event;
    import flash.utils.setTimeout;
    import flash.external.ExternalInterface;
    import narutoos.daily.EscortTransit;
    import narutoos.daily.EscortRewardPopup;
    import com.tencent.morefun.naruto.plugin.ui.box.BoxManager;
    import com.tencent.morefun.naruto.plugin.RSModel.modules.popup.system.ItemIconBox;
import fixture.ModalCover;
    import fixture.NativeRuntime;
    import base.ApplicationData;
    import task.commands.HrefEventCommand;

    public final class EscortTransitFixture extends Sprite
    {
        private var adapter:EscortTransit;
        private var owner:Sprite;

        public function EscortTransitFixture()
        {
            addEventListener(Event.ADDED_TO_STAGE, start);
        }

        private function start(event:Event):void
        {
            removeEventListener(Event.ADDED_TO_STAGE, start);
            try
            {
                owner = new Sprite();
                addChild(owner);
                NativeRuntime.reset();
                testEscortRewardPopup(owner);
                adapter = new EscortTransit(owner);

                var unloaded:Object = adapter.read();
                assert(unloaded.kind == "unknown", "task data not loaded is " + unloaded.kind + " " + unloaded.reason);
                NativeRuntime.task.responded = true;
                var empty:Object = adapter.read();
                assert(empty.kind == "none", "loaded empty task list is " + empty.kind + " " + empty.reason);

                NativeRuntime.receive(41, 5, 1);
                NativeRuntime.player.selfPlayer.endPoint = {x:500, y:500};
                var active:Object = adapter.read();
                assert(active.kind == "active" && active.id == 41 && active.hard == 5, "locks the received SS task: " + active.kind + "/" + active.id + "/" + active.hard + " " + active.reason);
                assert(!adapter.advance(42), "does not touch a different task id");
                assert(!adapter.advance(41), "does not navigate while native movement is active");
                ApplicationData.singleton.isFightLock = true;
                assert(!adapter.advance(41, true), "does not start native route while scene handoff is locked");
                ApplicationData.singleton.isFightLock = false;

                NativeRuntime.battle.isFighting = true;
                NativeRuntime.battle.type = 29;
                NativeRuntime.battle.isWin = false;
                NativeRuntime.battle.dispatch("start");
                assert(!adapter.advance(41, true), "does not navigate during battle even for new task");
                NativeRuntime.battle.isFighting = false;
                NativeRuntime.battle.dispatch("end");
                NativeRuntime.player.selfPlayer.endPoint = {x:NativeRuntime.player.selfPlayer.x, y:NativeRuntime.player.selfPlayer.y};
            NativeRuntime.task.isEscorting = false;
                setTimeout(function():void { adapter.read(); setTimeout(continueAfterStopped, 1850); }, 50);
            }
            catch (error:Error) { report("FAIL start " + error.message + " " + error.getStackTrace()); }
        }

        private function continueAfterStopped():void
        {
            try
            {
                assert(adapter.read().stopped, "recognizes stable stopped position");
                assert(adapter.advance(41), "replays the native href after battle and stop even if local escort timer expired");
                assert(HrefEventCommand.calls.length == 1 && HrefEventCommand.calls[0] == "goto,12,99", "uses the original task route");
                assert(!adapter.advance(41), "does not repeat the same continuation at one position");

                NativeRuntime.battle.isFighting = true;
                NativeRuntime.battle.type = 29;
                NativeRuntime.battle.isWatch = true;
                NativeRuntime.battle.dispatch("start");
                NativeRuntime.battle.isFighting = false;
                NativeRuntime.battle.isWatch = false;
                NativeRuntime.battle.dispatch("end");
                assert(!adapter.read().postBattle && !adapter.advance(41), "does not continue after spectator battle");

                NativeRuntime.battle.isFighting = true;
                NativeRuntime.battle.type = 29;
                NativeRuntime.battle.dispatch("start");
                NativeRuntime.battle.isFighting = false;
                NativeRuntime.battle.dispatch("fail");
                assert(!adapter.read().postBattle && !adapter.advance(41), "does not continue after a failed battle transition");

                NativeRuntime.receive(52, 5, 2);
                adapter.cancel();
                adapter = new EscortTransit(owner);
                adapter.read();
                assert(adapter.read().kind == "settling", "commit-eligible order waits for native settlement");
                assert(adapter.advance(52), "opens the native commit panel for this task");
                assert(NativeRuntime.openCommitIds.length == 1 && NativeRuntime.openCommitIds[0] == 52, "opens only the matching id");

                var panel:Object = NativeRuntime.showCommit(owner, 52, 2);
                assert(adapter.advance(52), "clicks the native completion button once");
                assert(panel.clicked == 1, "uses the native submit button once");
                assert(!adapter.advance(52), "does not double-submit while waiting for model receipt");
                NativeRuntime.complete(52);
                assert(adapter.read().kind == "ended" && adapter.read().outcome == "completed", "waits for the native commit receipt");

                adapter.cancel();
                adapter = new EscortTransit(owner);
                NativeRuntime.receive(63, 5, 1);
                adapter.read();
                NativeRuntime.remove(63);
                var removed:Object = adapter.read();
                assert(removed.kind == "ended" && removed.outcome == "removed", "reports native removal without claiming delivery");
                adapter.cancel();

                NativeRuntime.reset();
                NativeRuntime.task.responded = true;
                NativeRuntime.receive(74, 4, 2);
                adapter = new EscortTransit(owner);
                assert(adapter.read().kind == "other", "SS-only preserves an S order");
                assert(adapter.read(5, true).kind == "settling", "both selections can settle the held S order");
                assert(!adapter.advance(74), "SS dispatch cannot handle this S order");
                var delivery:Object = {};
                panel = NativeRuntime.showCommit(owner, 74, 2);
                assert(adapter.advance(74, false, 4, delivery) && panel.clicked == 1, "native S settlement is clicked once");
                adapter.cancel();
                adapter = new EscortTransit(owner);
                assert(adapter.read(4).kind == "settling", "a stopped S order can be restored");
                assert(!adapter.advance(74, false, 4, delivery) && panel.clicked == 1, "restart does not submit the same S delivery twice");
                NativeRuntime.complete(74);
                assert(adapter.read(4).outcome == "completed", "the native receipt settles S");
                adapter.cancel();
                report("PASS production EscortTransit: grade locking, movement, battle gate, native continuation, single submit, terminal receipts, and escort bonus popup isolation");
            }
            catch (error:Error) { report("FAIL continuation " + error.message + " " + error.getStackTrace()); }
        }

        private function assert(condition:Boolean, description:String):void
        {
            if (!condition) throw new Error("FAIL " + description);
        }

        private function testEscortRewardPopup(owner:Sprite):void
        {
            var closer:EscortRewardPopup = new EscortRewardPopup(owner);
            assert(!closer.step(), "does not handle any popup before a completed escort arms it");
            closer.arm();
            var reward:ItemIconBox = new ItemIconBox();
            reward.data = [{id:1, num:1}];
            owner.addChild(reward);
            BoxManager.showingList = [reward];
            Object(reward.content.getChildByName("txt")).text = "普通物品提示";
            assert(!closer.step() && reward.clickCount == 0, "preserves another ItemIconBox title");
            Object(reward.content.getChildByName("txt")).text = "恭喜你获得额外物品奖励！";
            reward.data = [];
            assert(!closer.step() && reward.clickCount == 0, "preserves reward box without the bonus award data");
            reward.data = [{id:1, num:1}];
            var button:Object = reward.content.getChildByName("okBtn");
            button.enabled = false;
            assert(closer.step() && reward.clickCount == 0, "waits for the reward confirm button to become enabled");
            button.enabled = true;
            var cover:ModalCover = new ModalCover();
            cover.name = "UnrelatedModal";
            owner.addChild(cover);
            BoxManager.showingList = [reward, cover];
            assert(closer.step() && reward.clickCount == 0, "waits while another modal obscures the reward");
            cover.modal = false;
            assert(closer.step() && reward.clickCount == 0, "waits while a nonmodal box is above the reward in BoxManager");
            BoxManager.showingList = [reward];
            assert(closer.step() && reward.clickCount == 1, "clicks the exact native OK button once it is topmost");
            assert(!closer.step() && reward.clickCount == 1, "does not repeat a completed popup click");
            closer.arm();
            BoxManager.showingList = [];
            assert(!closer.step(), "a delivery without bonus items adds no wait to normal task flow");
            closer.disarm();
            var laterReward:ItemIconBox = new ItemIconBox();
            laterReward.data = [{id:1, num:1}];
            owner.addChild(laterReward);
            BoxManager.showingList = [laterReward];
            assert(!closer.step() && laterReward.clickCount == 0, "does not carry popup eligibility into a later task");
            BoxManager.showingList = [];
        }

        private function report(message:String):void
        {
            ExternalInterface.call("fixtureComplete", message);
        }
    }
}
