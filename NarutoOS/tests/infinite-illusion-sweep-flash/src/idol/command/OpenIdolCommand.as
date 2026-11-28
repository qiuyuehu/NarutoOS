package idol.command
{
    public final class OpenIdolCommand
    {
        public static var calls:int;
        public function addEventListener(type:String, listener:Function):void {}
        public function removeEventListener(type:String, listener:Function):void {}
        public function call():void { calls++; }
    }
}
