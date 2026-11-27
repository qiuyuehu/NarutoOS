package com.tencent.morefun.naruto.model.event
{
    import flash.events.Event;
    public dynamic final class ModelEvent extends Event
    {
        public var key:String;
        public function ModelEvent(key:String) { super("update"); this.key = key; }
    }
}
