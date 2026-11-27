package com.tencent.morefun.naruto.plugin.battle.view
{
    import flash.display.Sprite;
    import flash.display.DisplayObject;
    public final class FightOverView extends Sprite
    {
        public var view:Object;
        public function FightOverView(value:Object)
        {
            view = value;
            addChild(value as DisplayObject);
        }
    }
}
