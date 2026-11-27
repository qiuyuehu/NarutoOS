package ai.commands {
  import flash.events.EventDispatcher;
  public class StartAICommand extends EventDispatcher {
    public var type:String;
    public function StartAICommand(type:String) { this.type = type; }
  }
}
