package com.tencent.morefun.naruto.plugin.ui.base
{
    import com.tencent.morefun.naruto.plugin.battle.data.BattleData;
    import com.tencent.morefun.naruto.plugin.battle.data.BattleTypeGroup;
    import flash.display.Sprite;
    import flash.events.MouseEvent;
    import fixture.AutoBattleProbe;

    public final class BaseButton extends Sprite
    {
        public var skin:Sprite;
        public var selected:Boolean;
        public var disable:Boolean;

        public function BaseButton(skin:Sprite)
        {
            this.skin = skin;
            if (skin.name == "autoFight") AutoBattleProbe.autoButton = this;
            else AutoBattleProbe.speedButton = this;
            addChild(skin);
            addEventListener(MouseEvent.CLICK, onClick);
        }

        private function onClick(event:MouseEvent):void
        {
            if (skin.name == "autoFight")
            {
                AutoBattleProbe.autoClicks++;
                if (!AutoBattleProbe.deferAutoAck)
                {
                    BattleTypeGroup.autoEnabled = !selected;
                    selected = BattleTypeGroup.autoEnabled;
                }
                return;
            }
            AutoBattleProbe.speedClicks++;
            BattleData.singleton.isSpeedUp = !BattleTypeGroup.speedEnabled;
            if (!AutoBattleProbe.deferSpeedAck)
            {
                BattleTypeGroup.speedEnabled = BattleData.singleton.isSpeedUp;
                selected = BattleTypeGroup.speedEnabled;
            }
        }
    }
}
