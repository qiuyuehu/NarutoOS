package
{
    public final class GroceryFixtureShop
    {
        public var opens:int;
        public var buys:Array = [];
        public var confirms:int;
        public var closes:int;
        public var prepareCalls:int;
        public var receipt:String = "pending";
        public var hidePrompt:Boolean;
        private var scenario:String;
        private var order:Object;
        private var active:Boolean;
        private var balance:int = 1800;

        public function GroceryFixtureShop(scenario:String) { this.scenario = scenario; }
        public function open():Boolean { opens++; return true; }
        public function close():Boolean { closes++; return true; }
        public function dispose():void { }

        public function item(id:int):Object
        {
            return {id:id, name:id == 1 ? (scenario == "pt-name" ? "Chave da Caverna" : "洞穴密钥") : "秘卷残页", price:id == 1 ? 200 : 300,
                currency:scenario == "currency" ? "点券" : "月之印", balance:balance,
                stock:scenario == "stock" && id == 1 ? 4 : 20};
        }

        public function prepare(id:int, quantity:int):Object
        {
            prepareCalls++;
            if (scenario == "not-ready" && prepareCalls == 1) return null;
            order = item(id);
            order.quantity = scenario == "clamp" ? quantity - 1 : quantity;
            order.total = order.price * order.quantity + (scenario == "total" ? 1 : 0);
            return order;
        }

        public function buy():Boolean
        {
            if (scenario == "disabled") return false;
            buys.push({id:order.id, quantity:order.quantity, total:order.total});
            active = true;
            receipt = "pending";
            if (scenario == "throw") throw new Error("Native dispatch threw after submission");
            return true;
        }

        public function confirmation():Object
        {
            if (scenario == "stale") return {};
            if (!active || scenario == "no-prompt" || scenario == "balance" || scenario == "stock" || hidePrompt) return null;
            if (scenario == "unrelated") return {};
            return {name:order.name, quantity:order.quantity, currency:order.currency,
                total:order.total + (scenario == "bad-confirm" ? 1 : 0)};
        }

        public function confirm():Boolean { confirms++; return true; }

        public function result():String
        {
            if (active && (receipt == "success" || receipt == "failed"))
            {
                active = false;
                if (receipt == "success") balance -= order.total + (scenario == "balance" ? 300 : 0);
            }
            return receipt;
        }
    }
}
