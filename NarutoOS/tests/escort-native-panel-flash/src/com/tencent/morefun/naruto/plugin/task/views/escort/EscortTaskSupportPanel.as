package com.tencent.morefun.naruto.plugin.task.views.escort
{
    import flash.display.Sprite;
    import flash.display.SimpleButton;
    public dynamic class EscortTaskSupportPanel extends Sprite
    {
        public var modal:Boolean = true;
        public var isShowing:Boolean = true;
        public var isShow:Boolean = true;
        public var goBtn:SimpleButton = new SimpleButton();
        public function EscortTaskSupportPanel()
        {
            goBtn.name = "goBtn";
            addChild(goBtn);
        }
    }
}
