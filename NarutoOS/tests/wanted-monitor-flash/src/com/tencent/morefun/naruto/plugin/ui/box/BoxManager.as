package com.tencent.morefun.naruto.plugin.ui.box {
  import flash.events.Event;
  import flash.display.Sprite;
  import flash.events.EventDispatcher;
  import fixture.NativeEvent;
  import fixture.NativeBox;
  public class BoxManager {
    public static const dispathcer:EventDispatcher = new EventDispatcher();
    public static var owner:Sprite;
    public static function get showingList():Array {var a:Array=[]; for(var i:int=0;owner && i<owner.numChildren;i++) if(owner.getChildAt(i) is NativeBox)a.push(owner.getChildAt(i)); return a;}
    public static function getBoxByName(name:String):Object {
      return owner.getChildByName(name);
    }
    public static function show(box:NativeBox, isReady:Boolean = true):void {
      box.isShow = true;
      owner.addChild(box);
      dispathcer.dispatchEvent(new NativeEvent("boxShow", null, box));
      if (box.modal) {
        var shield:Sprite = new Sprite();
        shield.name = box.name + "Modal";
        shield.mouseChildren = false;
        shield.graphics.beginFill(0x000000, 0.28);
        shield.graphics.drawRect(0, 0, owner.stage.stageWidth, owner.stage.stageHeight);
        shield.graphics.endFill();
        owner.addChildAt(shield, owner.getChildIndex(box));
        box.shield = shield;
      }
      if (isReady) ready(box);
    }
    public static function ready(box:NativeBox):void {
      box.isShowing = true;
      dispathcer.dispatchEvent(new NativeEvent("boxShowed", null, box));
    }
    public static function hide(box:NativeBox):void {
      box.dispatchEvent(new Event("box#hide"));
      dispathcer.dispatchEvent(new NativeEvent("boxHide", null, box));
      owner.removeChild(box);
      if (box.shield != null) owner.removeChild(box.shield);
      box.isShow = false;
      box.isShowing = false;
      dispathcer.dispatchEvent(new NativeEvent("boxHided", null, box));
    }
  }
}
