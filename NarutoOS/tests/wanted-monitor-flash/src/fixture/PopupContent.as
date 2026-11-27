package fixture {
  import flash.display.Sprite;
  import flash.text.TextField;
  public class PopupContent extends Sprite {
    public var txt:TextField = new TextField();
    public var yesBtn:Sprite = new Sprite();
    public function PopupContent(message:String) {
      txt.text = message;
      addChild(txt);
      yesBtn.name = "yesBtn";
      yesBtn.graphics.beginFill(0x947350);
      yesBtn.graphics.drawRect(0, 0, 30, 15);
      yesBtn.graphics.endFill();
      addChild(yesBtn);
      var noBtn:Sprite = new Sprite();
      noBtn.name = "noBtn";
      addChild(noBtn);
    }
  }
}
