package
{
    public final class InfiniteSweepFixtureAdapter
    {
        public var panel:String = "ready";
        public var modal:String = "none";
        public var selectedIndex:int = 0;
        public var autoRaidEnabled:* = false;
        public var scenario:String;
        public var rewardSeen:Boolean;
        public var clicks:int;
        public var confirms:int;
        public var rewardCloses:int;
        public var listReady:Boolean = true;
        public var confirmationCancels:int;
        public var raidWasSubmitted:Boolean;
        private var rejectedOnce:Boolean;
        public var closes:int;
        public var settingWrites:int;
        public var protocolRequests:int;
        public var tailHandoffs:int;
        public var clickOrder:Array = [];
        public var listToken:Object = {};
        public var dungeons:Array;
        public var roleKey:String;

        public function InfiniteSweepFixtureAdapter(scenario:String = "")
        {
            this.scenario = scenario;
            roleKey = scenario == "" ? "fixture-default" : scenario;
            var remaining:Array = scenario == "two-one-zero" ? [2, 1, 0] :
                scenario == "one-left" ? [1, 0, 0] : [2, 2, 2];
            dungeons = [];
            var hasMoreOpportunities:Boolean = scenario == "more-opportunities" || scenario == "no-handoff";
            var dungeonTotal:int = hasMoreOpportunities ? 4 : 3;
            if (hasMoreOpportunities) remaining.push(2);
            for (var index:int = 0; index < dungeonTotal; index++)
            {
                dungeons.push({id:100 + index, index:index, unlocked:true, isRadius:true,
                    passCount:2 - remaining[index], passUpperCount:2});
            }
            if (scenario == "unknown-setting") autoRaidEnabled = undefined;
            if (scenario == "cold-ai")
            {
                autoRaidEnabled = undefined;
                for each (var exhausted:Object in dungeons) exhausted.passCount = exhausted.passUpperCount;
            }
            if (scenario == "auto-enabled") autoRaidEnabled = true;
            if (scenario == "more-opportunities") autoRaidEnabled = undefined;
            if (scenario == "no-handoff") autoRaidEnabled = true;
            if (scenario == "auto-enabled-empty")
            {
                autoRaidEnabled = true;
                for each (var info:Object in dungeons) info.passCount = info.passUpperCount;
            }
        }

        public function begin():Boolean { return true; }

        public function snapshot():Object
        {
            var available:Boolean;
            for each (var stage:Object in dungeons)
                if (stage.unlocked && stage.isRadius && stage.passCount < stage.passUpperCount) available = true;
            return {trusteeshipping:scenario == "trusteeship-active", panel:panel, topModal:modal, listValid:listReady,
                selectedIndex:selectedIndex, dungeons:listReady ? dungeons : [], listToken:listReady ? listToken : null,
                raidReady:true, autoRaidEnabled:autoRaidEnabled,
                anyStageOpportunity:available, anyAutoRaidOpportunity:available, rewardSeen:rewardSeen,
                raidWasSubmitted:raidWasSubmitted,
                roleKey:roleKey,
                canHandoff:panel == "absent" && scenario != "no-handoff"};
        }

        public function selectStage(index:int):Boolean
        {
            selectedIndex = index;
            return true;
        }

        public function resetResult():void { rewardSeen = false; raidWasSubmitted = false; }

        public function clickRaid():Boolean
        {
            if (scenario == "reject-click" && !rejectedOnce)
            {
                rejectedOnce = true;
                return false;
            }
            clicks++;
            clickOrder.push(dungeons[selectedIndex].id);
            modal = scenario == "unknown-modal" ? "other" : "confirm";
            return true;
        }

        public function confirm():Boolean
        {
            confirms++;
            raidWasSubmitted = true;
            modal = "none";
            return true;
        }

        public function cancelConfirmation():Boolean
        {
            if (modal == "confirm")
            {
                confirmationCancels++;
                modal = "none";
            }
            return true;
        }

        public function showReward():void
        {
            rewardSeen = true;
            modal = "reward";
        }

        public function closeReward():Boolean
        {
            if (modal != "reward" || !raidWasSubmitted) return false;
            rewardCloses++;
            if (scenario != "slow-close") finishRewardClose();
            return true;
        }

        public function finishRewardClose():void
        {
            modal = "none";
            listReady = false;
        }

        public function refresh():void
        {
            dungeons[selectedIndex].passCount++;
            listToken = {};
            listReady = true;
        }

        public function reopen():void { panel = "ready"; modal = "none"; }

        public function closePanel():Boolean
        {
            closes++;
            panel = "absent";
            return true;
        }

        public function dispose():void {}
    }
}
