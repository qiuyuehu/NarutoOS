package ui.battle
{
    import flash.display.Sprite;
    import fixture.StrongExitButton;
    import fixture.StrongEnvironment;
    public final class FightLoseUI extends Sprite
    {
        public var defaultOkButton:StrongExitButton;
        public var okButton:StrongExitButton;
        public function FightLoseUI()
        {
            defaultOkButton = new StrongExitButton(onUnused);
            okButton = new StrongExitButton(onExit);
            defaultOkButton.enabled = false;
            okButton.enabled = true;
            addChild(defaultOkButton);
            addChild(okButton);
        }
        private function onExit(event:*):void { StrongEnvironment.target.onBattleResultExit(); }
        private function onUnused(event:*):void {}
    }
}
