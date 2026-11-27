package com.tencent.morefun.naruto.plugin.ui.layer
{
    import flash.display.Sprite;
    public final class LayerManager
    {
        public static const singleton:LayerManager = new LayerManager();
        private var gameTip:Sprite = new Sprite();
        public function LayerManager() {}
        public function findLayerByName(name:String):Sprite { return name == "GameTip" ? gameTip : null; }
    }
}
