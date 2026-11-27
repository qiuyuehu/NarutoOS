package com.tencent.morefun.naruto.plugin.dungeon.view.reward
{
    import flash.display.Sprite;

    /** Unrelated modal used to prove the assistant never closes through another top box. */
    public final class TeamDungeonBlocker extends Sprite
    {
        public var isShow:Boolean = true;
        public var isShowing:Boolean = true;
        public var modal:Boolean = false;
        public var disableEsc:Boolean = false;
        public function TeamDungeonBlocker() { name = "TeamDungeonBlocker"; }
    }
}
