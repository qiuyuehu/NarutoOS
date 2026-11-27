package com.tencent.morefun.naruto.plugin.ui.layer {
    import flash.display.Sprite;
    public final class LayerManager {
        public static var singleton:LayerManager=new LayerManager();
        public var layer:Sprite=new Sprite();
        public function findLayerByName(name:String):Sprite { return name=="mainUI" ? layer : null; }
    }
}
