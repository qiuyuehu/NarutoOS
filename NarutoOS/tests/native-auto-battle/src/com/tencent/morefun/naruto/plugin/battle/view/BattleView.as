package com.tencent.morefun.naruto.plugin.battle.view
{
    import flash.display.Sprite;
    import ui.battle.BattleViewUI;
    public final class BattleView extends Sprite
    {
        public var uiShowing:Boolean = true;
        public function getUIIsShowing():Boolean { return uiShowing; }
        public function BattleView() { addChild(new BattleViewUI()); }
    }
}
