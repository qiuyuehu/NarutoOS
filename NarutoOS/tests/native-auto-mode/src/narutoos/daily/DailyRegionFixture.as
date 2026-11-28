package narutoos.daily
{
    /** Test-only setter for the internal Brazil region flag. */
    public final class DailyRegionFixture
    {
        public static function setBR(value:Boolean):void { DailyRegion.isBR = value; }
    }
}
