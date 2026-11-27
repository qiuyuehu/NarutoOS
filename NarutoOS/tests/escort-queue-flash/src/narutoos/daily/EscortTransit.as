package narutoos.daily
{
    import flash.display.Sprite;

    /** Controlled transit receipts for queue-level EscortTask tests. */
    public final class EscortTransit
    {
        public static var stateKind:String = "none";
        public static var orderId:int = 0;
        public static var message:String = "";
        public static var hard:int = 5;
        public static var outcome:String = "";
        public static var receivedAt:int = 0;
        public static var advances:Array = [];
        public static var canceled:int = 0;

        public function EscortTransit(owner:Sprite) { }

        public static function reset():void
        {
            stateKind = "none";
            orderId = 0;
            message = "";
            hard = 5;
            outcome = "";
            receivedAt = 0;
            advances = [];
            canceled = 0;
        }

        public function read(grade:int = 5, allowActiveS:Boolean = false):Object
        {
            var kind:String = stateKind;
            if (kind == "active" || kind == "settling")
                if (hard != grade && !(allowActiveS && hard == 4)) kind = "other";
            return {kind:kind, id:orderId, message:message, hard:hard, outcome:outcome, receivedAt:receivedAt};
        }
        public function advance(id:int, newlyAccepted:Boolean, grade:int = 5, delivery:Object = null):Boolean
        {
            advances.push({id:id, newlyAccepted:newlyAccepted});
            return newlyAccepted;
        }
        public function cancel():void { canceled++; }
        public static function snapshot():Object
        {
            return {kind:stateKind, id:orderId, message:message, advances:advances.concat(), canceled:canceled};
        }
    }
}
