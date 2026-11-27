package ui.command {
  import flash.events.EventDispatcher;
  public class ShowTextBoxCommand extends EventDispatcher {
    public var text:String;
    public var flags:uint;
    public var modal:Boolean;
    public function ShowTextBoxCommand(text:String, flags:uint, modal:Boolean) {
      this.text = text;
      this.flags = flags;
      this.modal = modal;
    }
  }
}
