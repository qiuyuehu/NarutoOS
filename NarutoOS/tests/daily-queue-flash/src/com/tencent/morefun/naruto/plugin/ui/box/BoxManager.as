package com.tencent.morefun.naruto.plugin.ui.box
{
    import flash.events.EventDispatcher;
    import fixture.StrongEnvironment;

    public final class BoxManager
    {
        public static var dispathcer:EventDispatcher = new EventDispatcher();
        public static var current:Object;
        public static var underlying:Object;
        public static function getBoxByName(name:String):Object
        {
            return current != null && current.name == name ? current : null;
        }
        public static function get showingList():Array
        {
            if (current == null) return [];
            return underlying == null ? [current] : [underlying, current];
        }
    }
}
