package task.commands {
  import flash.events.Event;
  import flash.events.EventDispatcher;
  public class HrefEventCommand extends EventDispatcher {
    public static const DATA_WANTED_NPC:String = "cgoto,2015003,26900623";
    public static var onNavigate:Function;
    private var data:String;
    public function HrefEventCommand(data:String) { this.data = data; }
    public function call():void {
      onNavigate(data);
      dispatchEvent(new Event("loadingEnd"));
    }
  }
}
