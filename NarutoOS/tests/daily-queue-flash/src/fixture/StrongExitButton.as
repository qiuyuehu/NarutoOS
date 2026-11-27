package fixture
{
    import flash.display.Sprite;
    import flash.events.MouseEvent;
    public final class StrongExitButton extends Sprite
    {
        public var enabled:Boolean = true;
        public function StrongExitButton(handler:Function)
        {
            mouseEnabled = true;
            visible = true;
            addEventListener(MouseEvent.CLICK, handler);
        }
    }
}
