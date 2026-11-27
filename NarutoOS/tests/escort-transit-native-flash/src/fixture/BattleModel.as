package fixture
{
    import flash.events.EventDispatcher;
    import com.tencent.morefun.naruto.model.event.ModelEvent;

    public final class BattleModel extends EventDispatcher
    {
        public var isFighting:Boolean;
        public var isWin:Boolean;
        public var isWatch:Boolean;
        public var type:int;
        public function dispatch(key:String):void { dispatchEvent(new ModelEvent("update", key)); }
    }
}
