package com.tencent.morefun.framework.apf.core.facade
{
    import flash.events.EventDispatcher;

    public final class Facade
    {
        private static const instance:Facade = new Facade();
        public const commandManager:EventDispatcher = new EventDispatcher();

        public static function getInstance():Facade { return instance; }
    }
}
