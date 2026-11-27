package fixture {
  import flash.events.Event;
  public class NativeEvent extends Event {
    public var command:Object;
    public var box:Object;
    public function NativeEvent(type:String, command:Object = null, box:Object = null) {
      super(type);
      this.command = command;
      this.box = box;
    }
  }
}
