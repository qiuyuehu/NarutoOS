package com.tencent.morefun.naruto.plugin.varietyShop.view.render
{
    import base.ApplicationData;
    import com.tencent.morefun.naruto.plugin.varietyShop.VarietyShopItemUI;
    import flash.display.MovieClip;
    import flash.display.Sprite;
    import flash.events.Event;
    import flash.text.TextField;

    public final class StockItemRender extends Sprite
    {
        public const skin:VarietyShopItemUI = new VarietyShopItemUI();
        public const stepper:NumericStepper_yellow = new NumericStepper_yellow();
        public var lastSubmittedCount:int;
        private var nativeFieldMode:Boolean;
        private var nativeStepper:MovieClip;
        private var nativeTextField:TextField;
        private var nativeData:Object;
        private var m_currentNum:int = 1;
        private var m_numMax:int = 999;

        public function StockItemRender(useNativeField:Boolean = false)
        {
            nativeFieldMode = useNativeField;
            addChild(skin);
            if (nativeFieldMode)
            {
                nativeStepper = new MovieClip();
                nativeTextField = new TextField();
                nativeTextField.text = "1";
                nativeStepper["textField"] = nativeTextField;
                nativeStepper.addChild(nativeTextField);
                skin.itemBg.stepper = nativeStepper;
                nativeTextField.addEventListener(Event.CHANGE, onModifyNumTF);
            }
            else addChild(stepper);
        }

        public function get data():Object { return nativeData; }

        public function set data(value:Object):void
        {
            nativeData = value;
            if (nativeFieldMode && value != null)
                m_numMax = Math.min(value.itemInfo.itemStorage,
                    int(ApplicationData.singleton.selfInfo.shadowOfMoon / value.itemInfo.price));
        }

        private function onModifyNumTF(event:Event):void
        {
            var count:uint = uint(int(nativeTextField.text));
            if (count > m_numMax) count = uint(m_numMax);
            if (count < 1) count = 1;
            m_currentNum = count;
            nativeTextField.htmlText = "<b>" + m_currentNum + "</b>";
            if (stage != null) stage.focus = nativeTextField;
        }

        public function captureSubmittedCount():int
        {
            lastSubmittedCount = nativeFieldMode ? m_currentNum : stepper.value;
            return lastSubmittedCount;
        }

        public function removeNativeQuantityHandler():void
        {
            if (nativeFieldMode) nativeTextField.removeEventListener(Event.CHANGE, onModifyNumTF);
        }
    }
}
