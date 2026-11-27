package com.tencent.morefun.naruto.plugin.task.views.escort
{
    import flash.display.Sprite;
    import flash.display.SimpleButton;
    import flash.events.MouseEvent;
    public dynamic class EscortTaskItemRenderer extends Sprite
    {
        public var data:Object;
        public var receiveBtn:SimpleButton = new SimpleButton();
        public var receiveBtn1:SimpleButton = new SimpleButton();
        public var gotoBtn:SimpleButton = new SimpleButton();
        public var doneBtn:SimpleButton = new SimpleButton();
        public var normalClicks:int;
        public var badgeClicks:int;
        public function EscortTaskItemRenderer(data:Object)
        {
            this.data = data;
            receiveBtn.name = "receiveBtn";
            receiveBtn1.name = "receiveBtn1";
            gotoBtn.name = "gotoBtn";
            doneBtn.name = "doneBtn";
            addChild(receiveBtn);
            addChild(receiveBtn1);
            addChild(gotoBtn);
            addChild(doneBtn);
            receiveBtn.addEventListener(MouseEvent.CLICK, function(event:MouseEvent):void { normalClicks++; });
            receiveBtn1.addEventListener(MouseEvent.CLICK, function(event:MouseEvent):void { badgeClicks++; });
        }
    }
}
