package com.tencent.morefun.naruto.plugin.RSModel.modules.popup.system {
  import flash.display.Sprite;
  import flash.text.TextField;
  import fixture.NativeBox;
  import fixture.PopupContent;
  public class TextBox extends NativeBox {
    public function TextBox(message:String) {
      super("TextBox", new PopupContent(message));
    }
  }
}
