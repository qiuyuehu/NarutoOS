package com.tencent.morefun.naruto.plugin.RSModel.modules.popup.system
{
    import com.tencent.morefun.naruto.plugin.ui.box.BoxManager;
    import flash.display.Sprite;
    import flash.events.MouseEvent;
    import flash.text.TextField;

    public final class ItemIconBox extends Sprite
    {
        public var isShow:Boolean = true;
        public var isShowing:Boolean = true;
        public var modal:Boolean = true;
        public var data:Object;
        public var content:Sprite;
        private var title:TextField;
        private var okBtn:ItemIconBoxButton;
        public var clickCount:int;

        public function ItemIconBox()
        {
            content = new Sprite();
            title = new TextField();
            title.name = "txt";
            title.text = "恭喜你获得额外物品奖励！";
            content.addChild(title);
            okBtn = new ItemIconBoxButton();
            okBtn.name = "okBtn";
            okBtn.addEventListener(MouseEvent.CLICK, clicked);
            content.addChild(okBtn);
            addChild(content);
        }

        private function clicked(event:MouseEvent):void
        {
            clickCount++;
            BoxManager.showingList = [];
        }
    }
}

import flash.display.Sprite;

internal final class ItemIconBoxButton extends Sprite
{
    public var enabled:Boolean = true;
}
