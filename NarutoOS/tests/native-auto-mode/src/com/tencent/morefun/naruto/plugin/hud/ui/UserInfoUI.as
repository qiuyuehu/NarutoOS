package com.tencent.morefun.naruto.plugin.hud.ui {
    import flash.display.Sprite;
    import fixture.Button;
    public final class UserInfoUI extends Sprite {
        public var userMoneyBar:MoneyBar=new MoneyBar();
        public function UserInfoUI() { addChild(userMoneyBar); }
    }
}
import flash.display.Sprite;
import fixture.Button;
class MoneyBar extends Sprite {
    public var aiBtn:Button=new Button();
    public function MoneyBar() { addChild(aiBtn); }
}
