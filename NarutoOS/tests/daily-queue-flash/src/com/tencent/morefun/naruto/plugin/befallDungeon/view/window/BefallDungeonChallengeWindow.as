package com.tencent.morefun.naruto.plugin.befallDungeon.view.window
{
    import flash.display.Sprite;
    import ui.plugin.befallDungeon.BefallDungeonWindowUI2;

    public final class BefallDungeonChallengeWindow extends Sprite
    {
        public var isShow:Boolean = true;
        public var isShowing:Boolean = true;
        public var content:BefallDungeonWindowUI2;
        public var modal:Boolean = true;
        public function BefallDungeonChallengeWindow(enabled:Boolean)
        {
            name = "BefallDungeonChallengeWindow";
            content = new BefallDungeonWindowUI2(enabled);
            addChild(content);
        }
    }
}
