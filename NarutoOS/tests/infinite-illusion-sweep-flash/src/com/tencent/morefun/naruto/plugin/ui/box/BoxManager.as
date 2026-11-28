package com.tencent.morefun.naruto.plugin.ui.box
{
    import flash.events.EventDispatcher;

    public final class BoxManager
    {
        public static var showingList:Array = [];
        public static var dispathcer:EventDispatcher = new EventDispatcher();
        public static function getBoxByName(name:String):Object { return null; }
        public static function reset():void { showingList = []; }
    }
}
