package com.tencent.morefun.naruto.plugin.dungeon.view.teamNewDungeon
{
    import flash.display.Sprite;
    import flash.events.Event;
    import flash.events.EventDispatcher;
    import flash.events.MouseEvent;
    import com.tencent.morefun.naruto.plugin.ui.box.BoxManager;
    import narutoos.daily.TeamDungeonPanel;

    public final class TeamNewDungeonPanel extends Sprite
    {
        public var isShow:Boolean = true;
        public var isShowing:Boolean = true;
        public var modal:Boolean = true;
        public var content:Sprite;
        public function TeamNewDungeonPanel()
        {
            name = "TeamNewDungeonPanel";
            content = new Sprite();
            addChild(content);
        }

        public function openTeamDungeonConfirm():void
        {
            var confirm:EnterConfirmWindow = new EnterConfirmWindow();
            if (parent != null) parent.addChild(confirm);
            BoxManager.current = confirm;
            BoxManager.dispathcer.dispatchEvent(new TeamDungeonBoxEvent("boxShow", confirm));
            BoxManager.dispathcer.dispatchEvent(new TeamDungeonBoxEvent("boxShowed", confirm));
        }

        public function close():void
        {
            isShow = false;
            isShowing = false;
            BoxManager.dispathcer.dispatchEvent(new TeamDungeonBoxEvent("boxHide", this));
            if (BoxManager.current === this) BoxManager.current = null;
            if (parent != null) parent.removeChild(this);
            BoxManager.dispathcer.dispatchEvent(new TeamDungeonBoxEvent("boxHided", this));
        }
    }
}

import flash.events.Event;

internal final class TeamDungeonBoxEvent extends Event
{
    public var box:Object;
    public function TeamDungeonBoxEvent(type:String, box:Object) { super(type); this.box = box; }
}
