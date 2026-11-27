package varietyShop.command
{
    public final class OpenVarietyShopCommand
    {
        public static var opened:Function;
        private var tab:int;

        public function OpenVarietyShopCommand(tab:int)
        {
            this.tab = tab;
        }

        public function call():void
        {
            opened(tab);
        }
    }
}
