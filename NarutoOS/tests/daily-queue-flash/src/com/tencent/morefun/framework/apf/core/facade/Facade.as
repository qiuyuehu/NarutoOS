package com.tencent.morefun.framework.apf.core.facade
{
    import flash.events.EventDispatcher;
    import fixture.StrongTestModelStore;

    public final class Facade
    {
        private static const instance:Facade = new Facade();
        public var commandManager:EventDispatcher = new EventDispatcher();
        public var model:StrongTestModelStore = new StrongTestModelStore();
        public function Facade() {}
        public static function getInstance():Facade { return instance; }
    }
}
