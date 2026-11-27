package com.tencent.morefun.naruto.plugin.befallDungeon.view.window
{
    import flash.display.Sprite;
    import flash.events.MouseEvent;
    import fixture.StrongEnvironment;
    import fixture.StrongFixtureButton;
    import fixture.StrongRewardContent;
    import fixture.StrongRewardBody;

    public final class BefallDungeonAwardPanel extends Sprite
    {
        public var isShow:Boolean = true;
        public var isShowing:Boolean = true;
        public var modal:Boolean = true;
        public var content:StrongRewardContent = new StrongRewardContent();
        public function BefallDungeonAwardPanel()
        {
            name = "BefallDungeonAwardPanel";
            var body:StrongRewardBody = new StrongRewardBody();
            body.ok_btn = new StrongFixtureButton();
            body.addChild(body.ok_btn);
            content.content_mc = body;
            content.addChild(body);
            addChild(content);
            body.ok_btn.addEventListener(MouseEvent.CLICK, onClick);
        }
        private function onClick(event:MouseEvent):void { StrongEnvironment.target.onAwardButton(); }
    }
}
