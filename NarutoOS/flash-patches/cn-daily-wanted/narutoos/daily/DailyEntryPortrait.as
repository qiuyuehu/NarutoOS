package narutoos.daily
{
   import flash.display.BitmapData;

   /** The HUD build binds this class to the portrait stored in its SWF dictionary. */
   public final class DailyEntryPortrait extends BitmapData
   {
      public function DailyEntryPortrait(width:int = 96, height:int = 96)
      {
         super(width, height, true, 0);
      }
   }
}
