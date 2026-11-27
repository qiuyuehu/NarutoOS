package com.tencent.morefun.framework.apf.core.facade {
  import base.ApplicationData;
  import fixture.AiPluginDomain;
  import flash.events.EventDispatcher;
  public class Facade {
    private static const current:Facade = new Facade();
    public var model:Object={retrieveModel:ApplicationData.singleton.getModel};
    public const commandManager:EventDispatcher = new EventDispatcher();
    public var pluginManager:Object={getPluginInfo:function(pluginId:String):Object{return {domain:new AiPluginDomain()};}};
    public static function getInstance():Facade { return current; }
  }
}
