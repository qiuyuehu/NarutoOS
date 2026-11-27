package com.tencent.morefun.naruto.plugin.ui.components.layouts
{
    import flash.display.Sprite;

    public final class EasyLayout extends Sprite
    {
        public var dataProvider:Array;
        public var layout:Object = { items:[] };
        public var render:Function;
        public var firstVisibleRow:int;

        public function scrollTo(index:int):void
        {
            firstVisibleRow = Math.min(index, Math.max(0, dataProvider.length - 3));
            render();
        }
    }
}
