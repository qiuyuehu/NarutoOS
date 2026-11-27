package com.tencent.morefun.naruto.plugin.ui.base
{
    import flash.display.MovieClip;
    import flash.display.Sprite;

    public final class BaseButton extends Sprite
    {
        public var disable:Boolean;
        public var skin:MovieClip;

        public function BaseButton(skin:MovieClip)
        {
            this.skin = skin;
            addChild(skin);
        }
    }
}
