package ui.battle
{
    import flash.display.Sprite;
    import fixture.StrongExitButton;
    import fixture.StrongEnvironment;
    public final class FightWinUI extends Sprite
    {
        public var defaultOkButton:StrongExitButton;
        public var okButton:StrongExitButton;
        public function FightWinUI()
        {
            defaultOkButton = new StrongExitButton(onExit);
            okButton = new StrongExitButton(onUnused);
            defaultOkButton.enabled = true;
            okButton.enabled = false;
            addChild(defaultOkButton);
            addChild(okButton);
        }
        private function onExit(event:*):void { StrongEnvironment.target.onBattleResultExit(); }
        private function onUnused(event:*):void {}
    }
}
