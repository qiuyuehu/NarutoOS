package com.tencent.morefun.naruto.plugin.dungeon.view.teamNewDungeon
{
    import flash.display.Sprite;
    import flash.events.MouseEvent;
    import narutoos.daily.TeamDungeonPanel;

    public final class EnterConfirmWindow extends Sprite
    {
        public var isShow:Boolean = true;
        public var isShowing:Boolean = true;
        public var modal:Boolean = true;
        public var confirmButton:Sprite;
        public function EnterConfirmWindow()
        {
            name = "EnterConfirmWindow";
            confirmButton = new Sprite();
            confirmButton.name = "confirmBtn";
            confirmButton.addEventListener(MouseEvent.CLICK, clicked);
            addChild(confirmButton);
        }

        private function clicked(event:MouseEvent):void
        {
            if (TeamDungeonPanel.target != null) TeamDungeonPanel.target.confirmTeamDungeon();
        }
    }
}
