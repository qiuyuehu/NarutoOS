package narutoos.daily
{
   /** Each game loads its own HUD and application domain. */
   public final class DailyRegion
   {
      internal static var isBR:Boolean = false;

      /** Allow a slow native response without delaying an action that is already ready. */
      internal static function networkWait(normalMs:int):int
      {
         return isBR ? Math.max(normalMs, 15 * 60 * 1000) : normalMs;
      }
   }
}
