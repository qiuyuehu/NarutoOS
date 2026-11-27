package com.tencent.morefun.naruto.plugin.befallDungeon.command
{
    import flash.events.EventDispatcher;
    public final class BefallDungeonQueryCommand extends EventDispatcher
    {
        public var ecode:int = 0;
        public var dungeons:Array = [{id:55096}];
        public function BefallDungeonQueryCommand() {}
    }
}
