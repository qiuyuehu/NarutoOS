package
{
    import flash.display.Sprite;
    import flash.external.ExternalInterface;
    import narutoos.daily.EscortNativePanel;
    import base.ApplicationData;
    import com.tencent.morefun.naruto.plugin.ui.box.BoxManager;
    import com.tencent.morefun.naruto.plugin.task.views.escort.EscortTaskPanel;
    import com.tencent.morefun.naruto.plugin.task.views.escort.EscortTaskItemRenderer;
    import com.tencent.morefun.naruto.plugin.task.views.escort.EscortTaskSupportPanel;
    import task.models.TaskModel;
    import serverProto.hud.ProtoHudType;
    import task.defs.TaskTypeDef;
    import task.defs.TaskStateDef;
    import hud.data.ActivityHubConfig;
    import hud.data.ActivityHubIdDef;
    import guild.GuildUtils;
    import task.commands.HrefEventCommand;

    public final class EscortNativePanelFixture extends Sprite
    {
        // The adapter resolves these native classes by name.
        private static const NATIVE_CLASSES:Array = [
            ProtoHudType, TaskTypeDef, TaskStateDef, ActivityHubIdDef, ActivityHubConfig, GuildUtils, HrefEventCommand
        ];
        private var adapter:EscortNativePanel;
        private var nativePanel:EscortTaskPanel;

        public function EscortNativePanelFixture()
        {
            ApplicationData.singleton = new ApplicationData();
            ExternalInterface.addCallback("perform", perform);
            ExternalInterface.call("fixtureReady");
        }

        public function perform(scenario:String):Object
        {
            reset(scenario);
            adapter = isSScenario(scenario) ? new EscortNativePanel(this, 4) : new EscortNativePanel(this);
            adapter.open();
            var offer:Object = adapter.offer();
            var output:Object = {
                kind:offer.kind,
                id:offer.id,
                freeAcceptLeft:offer.freeAcceptLeft,
                canAcceptFree:offer.canAcceptFree,
                refreshLeft:offer.refreshLeft,
                hasButton:offer.button != null,
                isNativeButton:offer.button === (offer.kind == "refresh" ? nativePanel.refresh : nativePanel.renderer.receiveBtn),
                message:offer.message
            };

            if (scenario == "acceptS")
            {
                adapter.clickOffer(offer);
                output.normalClicks = nativePanel.renderer.normalClicks;
                output.badgeClicks = nativePanel.renderer.badgeClicks;
            }
            else if (scenario == "staleS")
            {
                nativePanel.renderer.data.cfg.receiveDeductYuanbao = 20;
                try { adapter.clickOffer(offer); }
                catch (error:Error) { output.staleOfferRejected = true; }
                output.normalClicks = nativePanel.renderer.normalClicks;
                output.badgeClicks = nativePanel.renderer.badgeClicks;
            }
            else if (scenario == "refresh" || scenario == "refreshS")
            {
                adapter.clickOffer(offer);
                ApplicationData.singleton.taskModel.setRefreshRemainder(0);
                var afterCount:Object = adapter.offer();
                ApplicationData.singleton.taskModel.setTasks([]);
                var afterList:Object = adapter.offer();
                var afterRender:Object = adapter.offer();
                output.waitsForBothUpdates = afterCount.kind == "wait" && afterList.kind == "wait";
                output.afterRefreshKind = afterRender.kind;
            }
            else if (scenario == "support")
            {
                adapter.clickOffer(offer);
                var noSupportRoute:Object = adapter.dispatchButton(101);
                ApplicationData.singleton.taskModel.setTasks([task(101, 1, 5)]);
                var pendingRoute:Object = adapter.dispatchButton(101);
                var support:EscortTaskSupportPanel = new EscortTaskSupportPanel();
                addChild(support);
                BoxManager.showingList = [support];
                var supportRoute:Object = adapter.dispatchButton(101);
                output.initialRouteNull = noSupportRoute == null;
                output.waitsForSupport = pendingRoute == null;
                output.supportButtonMatches = supportRoute === EscortTaskSupportPanel(BoxManager.showingList[0]).goBtn;
            }
            else if (scenario == "resumeSupport")
            {
                var supportForResume:EscortTaskSupportPanel = new EscortTaskSupportPanel();
                addChild(supportForResume);
                BoxManager.showingList = [supportForResume];
                output.supportButtonMatches = adapter.dispatchButton(101) === supportForResume.goBtn;
            }
            else if (scenario == "resumeSFromSS")
            {
                output.listButtonMatches = adapter.dispatchButton(101, 4) === nativePanel.renderer.gotoBtn;
                output.listWrongGradeRejected = adapter.dispatchButton(101) == null;
                var supportForS:EscortTaskSupportPanel = new EscortTaskSupportPanel();
                addChild(supportForS);
                BoxManager.showingList = [supportForS];
                output.supportButtonMatches = adapter.dispatchButton(101, 4) === supportForS.goBtn;
                output.supportWrongGradeRejected = adapter.dispatchButton(101) == null;
            }
            else if (scenario == "closingTween")
            {
                adapter.close();
                output.removedFromShowingList = BoxManager.showingList.length == 0;
                output.duringTween = adapter.view();
                removeChild(nativePanel);
                output.afterTween = adapter.view();
            }
            else if (scenario == "delivered")
            {
                output.doneButtonMatches = adapter.dispatchButton(101) === nativePanel.renderer.doneBtn;
            }
            else if (scenario == "fourthSS")
            {
                var first:Object = offer;
                if (nativePanel.renderer.parent === nativePanel.grid) nativePanel.grid.removeChild(nativePanel.renderer);
                nativePanel.renderer = new EscortTaskItemRenderer(ApplicationData.singleton.taskModel.tasks[3]);
                nativePanel.grid.addChild(nativePanel.renderer);
                var afterScroll:Object = adapter.offer();
                output.firstKind = first.kind;
                output.scrollValue = nativePanel.grid.verticalScrollValue;
                output.afterScrollKind = afterScroll.kind;
                output.afterScrollId = afterScroll.id;
            }
            adapter.cancel();
            return output;
        }

        private function reset(scenario:String):void
        {
            var model:TaskModel = ApplicationData.singleton.taskModel;
            model.respondedCount = 0;
            model.escortRemainderNum = scenario == "dailyDone" ? 0 : 3;
            model.escortFreeAcceptRemainderNum = scenario == "zeroAccept" || isSScenario(scenario) ? 0 : 2;
            model.escortRefreshNum = scenario == "refresh" || scenario == "refreshS" || scenario == "fourthSS" ? 1 : 0;
            if (scenario == "refresh" || scenario == "refreshS") model.tasks = [];
            else if (scenario == "fourthSS") model.tasks = [task(101, 0, 4), task(102, 0, 4), task(103, 0, 4), task(104, 0, 5)];
            else if (scenario == "resumeSupport") model.tasks = [task(101, 1, 5)];
            else if (scenario == "resumeSFromSS") model.tasks = [task(101, 1, 4)];
            else if (scenario == "delivered") model.tasks = [task(101, 2, 5)];
            else if (isSScenario(scenario))
            {
                var s:Object = task(101, 0, 4);
                if (scenario == "paidS") s.cfg.receiveDeductYuanbao = 20;
                if (scenario == "unknownPriceS") delete s.cfg.receiveDeductYuanbao;
                model.tasks = [s, task(102, 0, 5)];
            }
            else model.tasks = [task(101, 0, 5)];
            model.setCountInfo();
            model.setTasks(model.tasks);
            nativePanel = new EscortTaskPanel();
            nativePanel.name = "EscortTaskPanel";
            nativePanel.renderer = new EscortTaskItemRenderer(model.tasks.length > 0 ? model.tasks[0] : null);
            nativePanel.grid.source = model.tasks;
            if (model.tasks.length > 0 && scenario != "fourthSS") nativePanel.grid.addChild(nativePanel.renderer);
            nativePanel.refresh.visible = model.escortRefreshNum > 0;
            addChild(nativePanel);
            BoxManager.showingList = [nativePanel];
        }

        private function isSScenario(scenario:String):Boolean
        {
            return scenario == "acceptS" || scenario == "refreshS" || scenario == "paidS" ||
                scenario == "unknownPriceS" || scenario == "staleS";
        }

        private function task(id:int, state:int, hard:int):Object
        {
            return {id:id, type:9, state:state, cfg:{hard:hard, receiveDeductYuanbao:hard == 5 ? 20 : 0}};
        }
    }
}
