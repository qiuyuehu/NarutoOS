package com.tencent.morefun.naruto.plugin.battle.data
{
    public final class BattleTypeGroup
    {
        public static var allowAuto:Boolean;
        public static var allowSpeed:Boolean;
        public static var autoEnabled:Boolean;
        public static var speedEnabled:Boolean;

        public static function isEnableAutoType(type:int):Boolean { return allowAuto; }
        public static function isEnableSpeedType(type:int):Boolean { return allowSpeed; }
        public static function getAutoStatus(type:int):Boolean { return autoEnabled; }
        public static function getSpeedStatus(type:int):Boolean { return speedEnabled; }
    }
}
