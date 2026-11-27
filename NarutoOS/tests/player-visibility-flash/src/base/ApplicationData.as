package base
{
   public class ApplicationData
   {
      public static var singleton:ApplicationData;
      public var model:Object;
      public function getModel(name:String) : Object { return name == "player.PlayerModel" ? model : null; }
   }
}
