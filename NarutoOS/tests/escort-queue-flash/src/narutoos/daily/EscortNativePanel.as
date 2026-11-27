package narutoos.daily
{
    import flash.display.InteractiveObject;
    import flash.display.Sprite;
    import flash.events.MouseEvent;

    /** Deterministic native-panel adapter for the real EscortTask queue fixture. */
    public final class EscortNativePanel
    {
        public static var panelView:String = "list";
        public static var offerKind:String = "wait";
        public static var offerId:int = 0;
        public static var refreshLeft:int = 0;
        public static var freeAcceptLeft:int = 0;
        public static var message:String = "";
        public static var opens:int = 0;
        public static var closes:int = 0;
        public static var clicks:Array = [];
        public static var advanceClicks:int = 0;
        public static var refreshClicks:int = 0;
        public static var acceptClicks:int = 0;
        public static var allowedFree:Boolean = true;
        public static var requestedGrades:Array = [];
        private var buttons:Object = {};

        public function EscortNativePanel(owner:Sprite, grade:int = 5) { requestedGrades.push(grade); }

        public static function reset():void
        {
            panelView = "list";
            offerKind = "wait";
            offerId = 0;
            refreshLeft = 0;
            freeAcceptLeft = 0;
            message = "";
            opens = closes = advanceClicks = refreshClicks = acceptClicks = 0;
            clicks = [];
            allowedFree = true;
            requestedGrades = [];
        }

        public function view():String { return panelView; }
        public function open():void { opens++; panelView = "list"; }
        public function stepEntry(opening:Boolean):void { }
        public function offer():Object
        {
            return {kind:offerKind, id:offerId, button:button("offer"), refreshLeft:refreshLeft,
                freeAcceptLeft:freeAcceptLeft, canAcceptFree:allowedFree, message:message};
        }
        public function clickOffer(offer:Object):void
        {
            offer.button.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true));
        }

        public function dispatchButton(id:int, heldGrade:int = 0):InteractiveObject
        {
            advanceClicks++;
            return button("advance:" + id);
        }
        public function close():void { closes++; panelView = "clear"; }
        public function unavailableReason():String { return ""; }
        public function cancel():void { }

        private function button(action:String):Sprite
        {
            if(buttons[action] != null) return buttons[action] as Sprite;
            var value:Sprite = new Sprite();
            value.addEventListener(MouseEvent.CLICK, function(event:MouseEvent):void
            {
                clicks.push(action);
                if(action == "offer" && offerKind == "refresh") refreshClicks++;
                if(action == "offer" && offerKind == "accept") acceptClicks++;
            });
            buttons[action] = value;
            return value;
        }

        public static function snapshot():Object
        {
            return {view:panelView, opens:opens, closes:closes, clicks:clicks.concat(),
                advanceClicks:advanceClicks, refreshClicks:refreshClicks, acceptClicks:acceptClicks,
                grades:requestedGrades.concat()};
        }
    }
}
