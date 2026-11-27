package com.tencent.morefun.naruto.plugin.ui.core
{
    import def.BoxFlagDef;
    import fixture.Button;
    import flash.display.Sprite;
    import flash.text.TextField;

    public final class TextBoxUI extends Sprite
    {
        public const txt:TextField = new TextField();
        public const ok:Button = new Button();
        public const cancelBtn:Button = new Button();

        public function TextBoxUI(text:String, flags:int)
        {
            txt.htmlText = text;
            addChild(txt);
            ok.name = "okBtn";
            ok.userData = BoxFlagDef.OK;
            cancelBtn.name = "cancelBtn";
            cancelBtn.userData = BoxFlagDef.CANCEL;
            if (flags & BoxFlagDef.OK) addChild(ok);
            if (flags & BoxFlagDef.CANCEL) addChild(cancelBtn);
        }
    }
}
