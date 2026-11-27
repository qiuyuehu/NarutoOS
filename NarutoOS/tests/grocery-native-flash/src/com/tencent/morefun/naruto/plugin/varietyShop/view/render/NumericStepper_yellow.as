package com.tencent.morefun.naruto.plugin.varietyShop.view.render
{
    import flash.display.Sprite;
    import flash.text.TextField;

    public final class NumericStepper_yellow extends Sprite
    {
        public var value:int = 1;
        public const numericUI:Object = { textField:new TextField() };

        public function drawNow():void
        {
            numericUI.textField.text = String(value);
        }
    }
}
