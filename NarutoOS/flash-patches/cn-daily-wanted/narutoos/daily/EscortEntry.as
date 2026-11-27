package narutoos.daily
{
    import flash.display.InteractiveObject;
    import flash.display.Sprite;
    import flash.events.MouseEvent;
    import flash.utils.getDefinitionByName;
    import flash.utils.getQualifiedClassName;

    /** Uses the timed activity's route to the guild merchant and its visible escort menu. */
    public final class EscortEntry
    {
        private static const MERCHANT:int = 26900601;
        private static const LIST:String = "com.tencent.morefun.naruto.plugin.task.views.escort::EscortTaskPanel";
        private var owner:Sprite;
        private var merchant:Object;
        private var navigating:Boolean;
        private var sawList:Boolean;

        public function EscortEntry(owner:Sprite) { this.owner = owner; }

        private function activityId():int
        {
            return int(getDefinitionByName("hud.data.ActivityHubIdDef").ESCORT_TASK);
        }

        private function routes():Array
        {
            var config:Object = getDefinitionByName("hud.data.ActivityHubConfig").instance;
            var rows:Array = config.getCfgByActivityId(activityId());
            if (rows == null || rows.length == 0) throw new Error("未读到押镖活动配置。");
            return rows;
        }

        public function unavailableReason():String
        {
            var app:Object = getDefinitionByName("base.ApplicationData").singleton;
            var group:Object = app.selfInfo.guild;
            if (group == null || group.guildId == null) throw new Error("无法确认角色的组织状态。");
            if (group.guildId.toString() == "0") return "当前没有组织，不能领取押镖任务。";
            routes();
            var hub:Object = app.getModel(getDefinitionByName("def.ModelDef").ACTIVITY_HUB);
            if (hub != null && hub.itemDatas != null && hub.itemDatas.length > 0 &&
                !hub.isDoingByActivityId(activityId())) return "押镖劫掠当前未开放，请查看限时活动。";
            return null;
        }

        public function open():void
        {
            var rows:Array = routes();
            var href:String = String(rows[0].href);
            // Both CN time slots lead to the same guild merchant. A changed or
            // ambiguous route needs verification before we navigate a player's character.
            for each (var row:Object in rows)
                if (row.href != href || href != "gotoGuild," + MERCHANT)
                    throw new Error("押镖活动的商人入口发生变化。");
            navigating = true;
            sawList = false;
            merchant = null;
            var command:Class = getDefinitionByName("task.commands.HrefEventCommand") as Class;
            DailyActivity.call(new command(href), null);
        }

        public function step(top:Object, opening:Boolean):void
        {
            if (!navigating || top == null || top.stage !== owner.stage || !top.isShow) return;
            var type:String = getQualifiedClassName(top);
            if (type == LIST)
            {
                sawList = true;
                return;
            }
            if (type != EscortDeliveryNpc.DIALOG || top.taskNpcCfg == null || int(top.taskNpcCfg.listId) != MERCHANT) return;
            if (merchant === top && sawList)
            {
                // The native menu can stay beneath the list. Close only our own
                // merchant dialog if the list has since left the screen.
                navigating = false;
                top.close();
                return;
            }
            if (!opening || merchant != null || sawList) return;
            var match:InteractiveObject = EscortDeliveryNpc.menuRow(top, function(data:Object):Boolean {
                return data.type == "npcMenu" && data.text == "押镖任务" && data.param == "openui,49";
            });
            if (match)
            {
                merchant = top;
                match.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true));
            }
        }

        public function cancel():void
        {
            navigating = false;
            merchant = null;
        }
    }
}
