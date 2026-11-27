package com.tencent.morefun.naruto.plugin.ai.commands {
  import base.ApplicationData;
  public class StopAICommand {
    public var type:String;
    public function StopAICommand(type:String) { this.type = type; }
    public function call():void {
      ++ApplicationData.singleton.stopAICalls;
      ApplicationData.singleton.stoppedAIType = type;
    }
  }
}
