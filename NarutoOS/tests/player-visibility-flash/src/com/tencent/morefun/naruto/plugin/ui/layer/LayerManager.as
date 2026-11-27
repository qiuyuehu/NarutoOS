package com.tencent.morefun.naruto.plugin.ui.layer
{
   import flash.display.Sprite;
   public class LayerManager
   {
      public static const singleton:LayerManager = new LayerManager();
      public var mainLayer:Sprite;
      public function findLayerByName(name:String) : Object { return name == "mainUI" ? mainLayer : null; }
   }
}
