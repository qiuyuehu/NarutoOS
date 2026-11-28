package
{
    import flash.display.Sprite;
    import flash.external.ExternalInterface;
    import narutoos.daily.DailyQueue;
    import narutoos.daily.GroceryTask;
    import narutoos.daily.IDailyTask;

    public final class GroceryTaskFixture extends Sprite
    {
        private var queue:DailyQueue;
        private var shop:GroceryFixtureShop;
        private var shopState:Object;
        private var nextAdapter:GroceryFixtureShop;
        private var orders:Array;
        private var messages:Array;
        private var tail:int;

        public function GroceryTaskFixture()
        {
            perform("reset");
            ExternalInterface.addCallback("perform", perform);
        }

        private function createTask(id:String, done:Function, progress:Function, hasNext:Boolean):IDailyTask
        {
            if (id == "grocery") return new GroceryTask(this, done, progress, orders, shopState, nextAdapter);
            return new GroceryFixtureTail(function():void { tail++; done(DailyQueue.COMPLETE, "托管"); });
        }

        private function perform(action:String, value:String = ""):Object
        {
            if (action == "reset")
            {
                if (queue != null) queue.cancel();
                orders = [{id:1, name:"洞穴密钥", price:200, quantity:5}, {id:2, name:"秘卷残页", price:300, quantity:2}];
                if (value == "empty") orders = [];
                if (value == "invalid") orders[0].quantity = 2.5;
                if (value == "duplicate") orders[1] = orders[0];
                shopState = {};
                shop = new GroceryFixtureShop(value);
                nextAdapter = shop;
                messages = [];
                tail = 0;
                queue = new DailyQueue(createTask, function(progress:String):void {}, function(message:String):void { messages.push(message); });
            }
            else if (action == "start") queue.start(["grocery", "tail"]);
            else if (action == "receipt") shop.receipt = value;
            else if (action == "hide") shop.hidePrompt = true;
            else if (action == "stop") queue.cancel();
            else if (action == "settleAndStop")
            {
                shop.receipt = "success";
                queue.cancel();
            }
            else if (action == "retry")
            {
                nextAdapter = new GroceryFixtureShop("no-prompt");
                queue.start(["grocery", "tail"]);
            }
            return {running:queue.running, opens:shop.opens, buys:shop.buys, confirms:shop.confirms, closes:shop.closes,
                prepareCalls:shop.prepareCalls,
                messages:messages, tail:tail, pending:shopState.groceryPending != null,
                retryOpens:nextAdapter === shop ? 0 : nextAdapter.opens, retryBuys:nextAdapter === shop ? [] : nextAdapter.buys};
        }
    }
}
