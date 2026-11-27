package com.tencent.morefun.naruto.util
{
    import flash.display.Sprite;
    import flash.text.TextField;
    public final class GameTipAnim extends Sprite
    {
        public function GameTipAnim(message:String)
        {
            var body:Sprite = new Sprite();
            var label:TextField = new TextField();
            label.text = message;
            body.addChild(label);
            addChild(body);
        }
    }
}
