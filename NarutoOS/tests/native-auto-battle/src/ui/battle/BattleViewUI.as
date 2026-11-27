package ui.battle
{
    import com.tencent.morefun.naruto.plugin.ui.base.BaseButton;
    import flash.display.Sprite;
    public final class BattleViewUI extends Sprite
    {
        public var skillPanelView:BattleSkillPanel = new BattleSkillPanel();
        public function BattleViewUI()
        {
            skillPanelView.autoFight = new Sprite();
            skillPanelView.autoFight.name = "autoFight";
            skillPanelView.speedUpBtn = new Sprite();
            skillPanelView.speedUpBtn.name = "speedUpBtn";
            skillPanelView.addChild(new BaseButton(skillPanelView.autoFight));
            skillPanelView.addChild(new BaseButton(skillPanelView.speedUpBtn));
            addChild(skillPanelView);
        }
    }
}
