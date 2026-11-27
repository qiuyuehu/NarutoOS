package com.tencent.morefun.naruto.plugin.dungeon.view.reward
{
    import flash.display.Sprite;
    import flash.display.SimpleButton;
    import flash.events.MouseEvent;
    import flash.events.TimerEvent;
    import flash.utils.Timer;
    import com.tencent.morefun.naruto.plugin.ui.box.BoxManager;

    public final class TeamNewDungeonRewardPanel extends Sprite
    {
        public static var closeCalls:int = 0;
        public static var backClickCalls:int = 0;
        public var isShow:Boolean = true;
        public var isShowing:Boolean = true;
        public var modal:Boolean = true;
        public var disableEsc:Boolean = false;
        public var content:Object;
        private var closeTimer:Timer;
        public function TeamNewDungeonRewardPanel()
        {
            name = "TeamNewDungeonRewardPanel";
            var backButton:SimpleButton = new SimpleButton();
            backButton.name = "backBtn";
            backButton.visible = false;
            backButton.enabled = true;
            backButton.addEventListener(MouseEvent.CLICK, backClicked);
            content = {backBtn:backButton};
        }
        public function markReady():void { content.backBtn.visible = true; }
        private function backClicked(event:MouseEvent):void
        {
            backClickCalls++;
            content.backBtn.enabled = false;
            closeTimer = new Timer(350, 1);
            closeTimer.addEventListener(TimerEvent.TIMER_COMPLETE, closeAfterFlip);
            closeTimer.start();
        }
        private function closeAfterFlip(event:TimerEvent):void { close(); }
        public function close():void
        {
            if (closeTimer != null) closeTimer.stop();
            closeCalls++;
            isShow = false;
            isShowing = false;
            if (BoxManager.current === this) BoxManager.current = null;
            if (parent != null) parent.removeChild(this);
        }
    }
}
