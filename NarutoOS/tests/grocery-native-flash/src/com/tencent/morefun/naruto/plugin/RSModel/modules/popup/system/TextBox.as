package com.tencent.morefun.naruto.plugin.RSModel.modules.popup.system
{
    import com.tencent.morefun.naruto.plugin.ui.core.TextBoxUI;
    import fixture.Box;

    public final class TextBox extends Box
    {
        public var content:TextBoxUI;

        public function TextBox(text:String, flags:int)
        {
            name = "TextBox";
            content = new TextBoxUI(text, flags);
            addChild(content);
        }
    }
}
