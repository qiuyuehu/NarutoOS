package fixture
{
    import flash.display.Sprite;
    import flash.events.MouseEvent;

    public final class CompletionButton extends Sprite
    {
        public var label:String;
        public var clicks:int;

        public function CompletionButton(label:String)
        {
            this.label = label;
            addEventListener(MouseEvent.CLICK, function(event:MouseEvent):void { clicks++; });
        }
    }
}
