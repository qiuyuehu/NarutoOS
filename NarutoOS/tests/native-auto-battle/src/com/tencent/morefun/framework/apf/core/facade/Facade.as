package com.tencent.morefun.framework.apf.core.facade
{
    import flash.events.EventDispatcher;
    import fixture.ModelRegistry;

    public final class Facade
    {
        private static const instance:Facade = new Facade();
        public var commandManager:EventDispatcher = new EventDispatcher();
        public var model:ModelRegistry = new ModelRegistry();
        public static function getInstance():Facade { return instance; }
    }
}
