package com.tencent.morefun.naruto.plugin.dungeon.view.teamNewDungeon
{
    import flash.display.Sprite;
    import flash.events.Event;

    public final class TeamNewDungeonPanel extends Sprite
    {
        public var content:TeamDungeonTestContent = new TeamDungeonTestContent();
        public var currentRenderer:TeamNewDungeonItemRenderer;
        private var recommendation:Array;
        private var all:Array;

        public function TeamNewDungeonPanel()
        {
            addChild(content);
            content.tabMc.addEventListener(Event.CHANGE, onTabChange);
        }

        public function setPages(recommendation:Array, all:Array):void
        {
            this.recommendation = recommendation;
            this.all = all;
            onTabChange(null);
        }

        private function onTabChange(event:Event):void
        {
            var rows:Array = content.tabMc.selectedIndex == 0 ? recommendation : all;
            while (numChildren > 1) removeChildAt(1);
            currentRenderer = rows != null && rows.length > 0 ? rows[0] as TeamNewDungeonItemRenderer : null;
            if (currentRenderer != null) addChild(currentRenderer);
        }
    }
}

import flash.display.Sprite;
import flash.events.Event;

internal final class TeamDungeonTestContent extends Sprite
{
    public var tabMc:TeamDungeonTestTabs = new TeamDungeonTestTabs();
    public function TeamDungeonTestContent() { addChild(tabMc); }
}

internal final class TeamDungeonTestTabs extends Sprite
{
    private var index:int = 0;
    public function TeamDungeonTestTabs() { super(); }
    public function get selectedIndex():int { return index; }
    public function set selectedIndex(value:int):void
    {
        if (index == value) return;
        index = value;
        dispatchEvent(new Event(Event.CHANGE));
    }
}
