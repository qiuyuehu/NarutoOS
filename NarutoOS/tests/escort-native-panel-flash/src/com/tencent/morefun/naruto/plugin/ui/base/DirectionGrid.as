package com.tencent.morefun.naruto.plugin.ui.base
{
    import flash.display.Sprite;
    public dynamic class DirectionGrid extends Sprite
    {
        public var source:Array = [];
        public var verticalScrollValue:Number = 0;
        public var maxVerScrollValue:int = 100;
        public var cellHeight:int = 100;
        public var vergap:int = 0;
        public var col:int = 1;
        public var row:int = 3;
        public function DirectionGrid() { }
    }
}
