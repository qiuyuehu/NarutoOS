package narutoos.daily
{
    import flash.display.Sprite;
    import flash.events.MouseEvent;
    import flash.utils.getDefinitionByName;
    import flash.utils.getQualifiedClassName;

    /** Closes only the native bonus-item popup caused by a just-completed escort. */
    public final class EscortRewardPopup
    {
        private static const ITEM_BOX:String =
            "com.tencent.morefun.naruto.plugin.RSModel.modules.popup.system::ItemIconBox";
        private static const BONUS_TITLE:String = "恭喜你获得额外物品奖励！";

        private var owner:Sprite;
        private var armed:Boolean;

        public function EscortRewardPopup(owner:Sprite)
        {
            this.owner = owner;
        }

        public function arm():void
        {
            armed = true;
        }

        public function disarm():void
        {
            armed = false;
        }

        /** Returns true while this escort's reward popup is being handled. */
        public function step():Boolean
        {
            if (!armed) return false;

            var manager:Object;
            try { manager = getDefinitionByName("com.tencent.morefun.naruto.plugin.ui.box.BoxManager"); }
            catch (missingNativeBoxManager:Error) { return false; }
            var list:Array = manager.showingList as Array;
            if (list == null || list.length == 0) return false;
            var reward:Object;
            for (var i:int = list.length - 1; i >= 0; i--)
            {
                if (!isEscortBonus(list[i])) continue;
                if (i != list.length - 1) return true;
                reward = list[i];
                break;
            }
            if (reward == null) return false;
            if (!reward.visible || !reward.isShow || !reward.modal) return true;

            var content:Object = reward.content;
            var button:Object = content.getChildByName("okBtn");
            if (button == null || !button.visible || !button.mouseEnabled ||
                !("enabled" in button) || !button.enabled) return true;

            // The native ItemIconBox OK handler also plays the received item animation.
            button.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true, false));
            armed = false;
            return true;
        }

        private function isEscortBonus(box:Object):Boolean
        {
            if (box == null || box.stage !== owner.stage || getQualifiedClassName(box) != ITEM_BOX ||
                !(box.data is Array) || box.data.length == 0) return false;
            var content:Object = box.content;
            var title:Object = content ? content.getChildByName("txt") : null;
            return title != null && String(title.text) == BONUS_TITLE;
        }

    }
}
