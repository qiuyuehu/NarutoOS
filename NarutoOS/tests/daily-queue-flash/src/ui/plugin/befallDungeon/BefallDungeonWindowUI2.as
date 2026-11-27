package ui.plugin.befallDungeon
{
    import flash.display.Sprite;
    import flash.events.MouseEvent;
    import fixture.StrongEnvironment;
    import fixture.StrongFixtureButton;
    import hud.data.ActivityHubConfig;

    public final class BefallDungeonWindowUI2 extends Sprite
    {
        public var startBtn:StrongFixtureButton = new StrongFixtureButton();
        public var closeBtn:StrongFixtureButton = new StrongFixtureButton();
        public var selectedDifficulty:String = "hard";
        public function BefallDungeonWindowUI2(enabled:Boolean)
        {
            startBtn.enabled = enabled;
            startBtn.tip = ActivityHubConfig.instance.disabledTip;
            startBtn.addEventListener(MouseEvent.CLICK, startClicked);
            closeBtn.addEventListener(MouseEvent.CLICK, closeClicked);
            addChild(startBtn);
            addChild(closeBtn);
        }
        private function startClicked(event:MouseEvent):void { StrongEnvironment.target.onStartButton(); }
        private function closeClicked(event:MouseEvent):void { StrongEnvironment.closeChallenge(); }
    }
}
