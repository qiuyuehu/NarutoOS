package com.tencent.morefun.naruto.plugin.battle.view
{
    import flash.display.Sprite;
    import com.tencent.morefun.naruto.plugin.battle.view.fightOver.FightFailView;
    import com.tencent.morefun.naruto.plugin.battle.view.fightOver.FightWinView;
    import ui.battle.BattleViewUI;

    public final class StrongBattleLayer extends Sprite
    {
        public function StrongBattleLayer(kind:String)
        {
            name = "fightUI";
            var battle:BattleView = new BattleView();
            var ui:BattleViewUI = new BattleViewUI();
            battle.addChild(ui);
            addChild(battle);
            ui.resultPos.addChild(new FightOverView(kind == "win" ? new FightWinView() : new FightFailView()));
        }
    }
}
