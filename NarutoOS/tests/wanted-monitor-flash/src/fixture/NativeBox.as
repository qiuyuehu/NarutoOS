package fixture {
  import com.tencent.morefun.naruto.plugin.ui.box.BoxManager;
  import flash.display.Sprite;
  public dynamic class NativeBox extends Sprite {
    public var isShow:Boolean = false;
    public var isShowing:Boolean = false;
    public var content:Sprite;
    public var shield:Sprite;
    public var modal:Boolean = true;
    public function close():void { BoxManager.hide(this); }
    public function NativeBox(name:String, content:Sprite) {
      this.name = name;
      this.content = content;
      addChild(content);
    }
  }
}
