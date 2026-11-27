package com.tencent.morefun.naruto.plugin.ui.tips
{
    import fixture.StrongFixtureButton;
    public final class TipsManager
    {
        public static const singleton:TipsManager = new TipsManager();
        public function getTipsData(button:Object):Object
        {
            return button is StrongFixtureButton ? StrongFixtureButton(button).tip : null;
        }
    }
}
