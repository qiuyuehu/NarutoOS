package com.tencent.morefun.naruto.plugin.npc.views {
  import flash.display.Sprite;
  public class TaskNpcDialogMenuRenderer extends Sprite {
    private var item:Object;
    public var enabled:Boolean = true;

    public function TaskNpcDialogMenuRenderer(type:String, param:String, text:String) {
      item = {type: type, param: param, text: text};
    }

    public function getData():Object { return item; }
  }
}
