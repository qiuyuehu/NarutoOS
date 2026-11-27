package ui.ai {
    import flash.display.Sprite;
    import fixture.Button;
    public class AIManageUI extends Sprite {
        public var startBtn:Button=new Button();
        public var quitBtn:Button=new Button();
        public var pageContainer:Sprite=new Sprite();
        public var page:Sprite=new Sprite();
        public function AIManageUI() {
            addChild(startBtn); addChild(quitBtn); addChild(pageContainer);
            pageContainer.addChild(page); page.visible=false;
        }
    }
}
