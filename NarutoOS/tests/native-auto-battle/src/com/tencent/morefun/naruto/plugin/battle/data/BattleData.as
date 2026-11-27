package com.tencent.morefun.naruto.plugin.battle.data
{
    public final class BattleData
    {
        public static var singleton:BattleData = new BattleData();
        public static const FIGHT_STATE_FIGHTING:int = 5;
        public var fightState:int;
        public var fightType:int;
        public var isAutoChallenge:Boolean;
        public var isSpeedUp:Boolean;
        public var isWatch:Boolean;
        public var isReplay:Boolean;
        public var isSharedReplaying:Boolean;
    }
}
