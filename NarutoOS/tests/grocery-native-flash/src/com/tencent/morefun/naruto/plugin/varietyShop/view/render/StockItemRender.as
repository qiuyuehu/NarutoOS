package com.tencent.morefun.naruto.plugin.varietyShop.view.render
{
    import com.tencent.morefun.naruto.plugin.varietyShop.VarietyShopItemUI;
    import flash.display.Sprite;

    public final class StockItemRender extends Sprite
    {
        public var data:Object;
        public const skin:VarietyShopItemUI = new VarietyShopItemUI();
        public const stepper:NumericStepper_yellow = new NumericStepper_yellow();

        public function StockItemRender()
        {
            addChild(skin);
            addChild(stepper);
        }
    }
}
