package com.tencent.morefun.naruto.plugin.ui.box {
    import flash.events.EventDispatcher;

    public final class BoxManager {
        public static const dispathcer:EventDispatcher = new EventDispatcher();
        public static var showingList:Array=[];
        public static function getBoxByName(name:String):Object {
            for each(var box:Object in showingList) if(box.name == name) return box;
            return null;
        }
    }
}
