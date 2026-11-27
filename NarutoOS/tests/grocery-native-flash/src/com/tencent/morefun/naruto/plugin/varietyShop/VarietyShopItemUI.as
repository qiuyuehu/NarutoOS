package com.tencent.morefun.naruto.plugin.varietyShop
{
    import fixture.Button;
    import flash.display.Sprite;
    import flash.text.TextField;

    public final class VarietyShopItemUI extends Sprite
    {
        public const itemNameTf:TextField = new TextField();
        public const itemBg:Object = {
            currentFrame:1,
            costType:{ currentFrame:2 },
            costTf:new TextField(),
            buyBtn:new Button()
        };

        public function VarietyShopItemUI()
        {
            addChild(itemBg.buyBtn);
            itemBg.costTf.text = "200";
            itemNameTf.text = "洞穴密钥";
        }
    }
}
