package com.tencent.morefun.naruto.model.event
{
    import flash.events.Event;
    public final class ModelEvent extends Event
    {
        public static const UPDATE:String = "update";
        public var key:String;
        public var oldValue:Object;
        public var newValue:Object;
        public function ModelEvent(type:String, key:Object = null, oldValue:Object = null, newValue:Object = null)
        { super(type); this.key = String(key); this.oldValue = oldValue; this.newValue = newValue; }
    }
}
