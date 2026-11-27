package com.tencent.morefun.naruto.plugin.battle.view.fightOver
{
    import flash.display.Sprite;
    import ui.battle.FightLoseUI;
    public final class FightFailView extends Sprite
    {
        public var ui:FightLoseUI = new FightLoseUI();
        public function FightFailView() { addChild(ui); }
    }
}
