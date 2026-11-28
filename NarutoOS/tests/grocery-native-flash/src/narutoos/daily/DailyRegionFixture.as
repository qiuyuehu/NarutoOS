package narutoos.daily
{
    /** Test-only access to the game-domain region flag. */
    public final class DailyRegionFixture
    {
        private static var chineseText:Boolean;
        public static function setBR(value:Boolean):void { DailyRegion.isBR = value; }
        public static function get isBR():Boolean { return DailyRegion.isBR; }
        public static function setChineseText(value:Boolean):void { chineseText = value; }
        public static function get isChineseText():Boolean { return chineseText; }
    }
}
