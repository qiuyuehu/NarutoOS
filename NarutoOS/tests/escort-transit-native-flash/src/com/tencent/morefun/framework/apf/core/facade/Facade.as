package com.tencent.morefun.framework.apf.core.facade
{
    import fixture.FakeModels;
    public final class Facade
    {
        private static const value:Facade = new Facade();
        public var model:FakeModels = new FakeModels();
        public var pluginManager:FakeModels = new FakeModels();
        public static function getInstance():Facade { return value; }
    }
}
