package com.tencent.morefun.naruto.plugin.battle.view.fightOver
{
    import flash.display.Sprite;
    import ui.battle.FightWinUI;
    public final class FightWinView extends Sprite
    {
        public var ui:FightWinUI = new FightWinUI();
        public function FightWinView() { addChild(ui); }
    }
}
