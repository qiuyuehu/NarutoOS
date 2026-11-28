package com.tencent.morefun.framework.apf.core.facade
{
    import flash.events.EventDispatcher;

    public final class Facade
    {
        private static var instance:Facade = new Facade();
        public var commandManager:EventDispatcher = new EventDispatcher();
        public var pluginManager:Object = {getPluginInfo:function(id:*):Object { return null; }};
        public static function getInstance():Facade { return instance; }
    }
}
