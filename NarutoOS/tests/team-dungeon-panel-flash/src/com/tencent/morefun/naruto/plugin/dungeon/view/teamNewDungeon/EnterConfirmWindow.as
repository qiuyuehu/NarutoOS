package com.tencent.morefun.naruto.plugin.dungeon.view.teamNewDungeon
{
    import flash.display.Sprite;

    public final class EnterConfirmWindow extends Sprite
    {
        public var confirmBtn:Object = new ConfirmLabelButton("确认进入");
        public var cancelBtn:Object = new ConfirmLabelButton("取消");
        public function EnterConfirmWindow()
        {
            confirmBtn.name = "confirmBtn";
            cancelBtn.name = "cancelBtn";
            addChild(confirmBtn as Sprite);
            addChild(cancelBtn as Sprite);
        }
    }
}

import flash.display.Sprite;

internal final class ConfirmLabelButton extends Sprite
{
    public var label:String;
    public function ConfirmLabelButton(value:String) { label = value; }
}
