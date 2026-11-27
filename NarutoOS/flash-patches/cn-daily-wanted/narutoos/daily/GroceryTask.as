package narutoos.daily
{
    import flash.display.Sprite;
    import flash.events.Event;
    import flash.events.TimerEvent;
    import flash.utils.Timer;

    public final class GroceryTask implements IDailyTask
    {
        private static const POLL_INTERVAL:int = 120;
        private static const TIMEOUT_MS:int = 15000;

        private var owner:Sprite;
        private var done:Function;
        private var progress:Function;
        private var orders:Array = [];
        private var windowProgress:Object;
        private var shop:Object;
        private var poll:Timer;
        private var deadline:Number;
        private var phase:String;
        private var index:int;
        private var outcomes:Array = [];
        private var pending:Object;
        private var confirmed:Boolean;
        private var started:Boolean;
        private var stopSummary:String;

        public function GroceryTask(owner:Sprite, done:Function, progress:Function, orders:Array,
                                    windowProgress:Object = null, adapter:Object = null)
        {
            this.owner = owner;
            this.done = done;
            this.progress = progress;
            this.windowProgress = windowProgress || {};
            shop = adapter;
            for each (var order:Object in orders)
            {
                this.orders.push(order == null ? null : {
                    id:order.id, name:order.name, price:order.price, quantity:order.quantity
                });
            }
        }

        public function get running():Boolean { return poll != null; }
        public function get cancellationSummary():String { return stopSummary; }

        public function start():void
        {
            if (started) return;
            started = true;
            poll = new Timer(POLL_INTERVAL);
            try
            {
                if (owner == null || owner.stage == null)
                {
                    finish(DailyQueue.ABORT, "游戏画面尚未就绪。");
                    return;
                }
                if (windowProgress.groceryPending != null)
                {
                    reconcile(windowProgress.groceryPending);
                    return;
                }
                if (orders.length == 0)
                {
                    finish(DailyQueue.COMPLETE, "没有勾选任何兑换商品。");
                    return;
                }
                if (!validOrders())
                {
                    finish(DailyQueue.ABORT, "兑换清单有误，请检查商品和数量。");
                    return;
                }
                if (shop == null) shop = new NativeGrocery(owner);
                owner.addEventListener(Event.REMOVED_FROM_STAGE, removed);
                enter("item");
                report("正在打开杂货屋");
                if (!running) return;
                if (shop.confirmation() != null || shop.open() !== true)
                {
                    finish(DailyQueue.ABORT, "无法安全打开原生杂货屋，请检查当前游戏窗口。");
                    return;
                }
                poll.addEventListener(TimerEvent.TIMER, tick);
                poll.start();
            }
            catch (error:Error) { finish(DailyQueue.ABORT, "无法打开原生杂货屋，请检查当前游戏窗口。"); }
        }

        private function validOrders():Boolean
        {
            var seen:Object = {};
            for each (var order:Object in orders)
            {
                if (order == null || !positiveInt(order.id) || !(order.name is String) || !order.name ||
                    !positiveInt(order.price) || !positiveInt(order.quantity) || seen[order.id]) return false;
                seen[order.id] = true;
            }
            return true;
        }

        private static function positiveInt(value:*):Boolean
        {
            return value is Number && value > 0 && value <= int.MAX_VALUE && value === Math.floor(value);
        }

        private static function counter(value:*):Boolean
        {
            return value is Number && value >= 0 && value <= uint.MAX_VALUE && value === Math.floor(value);
        }

        private function tick(event:TimerEvent):void
        {
            if (!running || event.currentTarget !== poll) return;
            try
            {
                if (new Date().time >= deadline)
                {
                    finish(DailyQueue.ABORT, phase == "receipt" ? "等待交易回执超时。" : "等待原生杂货屋状态超时，已保留当前画面。");
                    return;
                }
                var order:Object = orders[index];
                if (phase == "receipt")
                {
                    checkReceipt(order);
                    return;
                }
                if (shop.confirmation() != null)
                {
                    finish(DailyQueue.ABORT, "发现其他游戏弹框，已保留当前画面。");
                    return;
                }
                if (phase == "close")
                {
                    if (shop.close() === true) finish(DailyQueue.COMPLETE, "");
                    return;
                }
                if (phase == "item") checkItem(order);
                else prepare(order);
            }
            catch (error:Error) { finish(DailyQueue.ABORT, "无法核对原生杂货屋状态，已保留当前画面。"); }
        }

        private function checkItem(order:Object):void
        {
            var item:Object = shop.item(order.id);
            if (item == null) return;
            if (!matchesItem(item, order) || !counter(item.balance) || !counter(item.stock))
            {
                finish(DailyQueue.ABORT, "原生商品、币种、单价或余量无法核对，已保留当前画面。");
                return;
            }
            var insufficient:String = shortage(item, order);
            if (insufficient) next(insufficient);
            else
            {
                enter("prepare");
                report(order.name + " × " + order.quantity);
            }
        }

        private function prepare(order:Object):void
        {
            var prepared:Object = shop.prepare(order.id, order.quantity);
            if (!running || prepared == null) return;
            if (!matchesItem(prepared, order) || prepared.quantity !== order.quantity || prepared.total !== total(order) ||
                !counter(prepared.balance) || !counter(prepared.stock))
            {
                finish(DailyQueue.ABORT, "原生商品、币种、单价、数量或总价与设置不符，已保留当前画面。");
                return;
            }
            var insufficient:String = shortage(prepared, order);
            if (insufficient)
            {
                next(insufficient);
                return;
            }
            if (windowProgress.groceryPending != null)
            {
                reconcile(windowProgress.groceryPending);
                return;
            }
            pending = windowProgress.groceryPending = {adapter:shop, name:order.name, quantity:order.quantity};
            confirmed = false;
            enter("receipt");
            // Record ownership before dispatch. Even a shop exception can follow a submitted request.
            if (shop.buy() !== true && running)
            {
                clearPending();
                finish(DailyQueue.ABORT, "购买按钮或商品余量已变化，已保留当前画面。");
            }
        }

        private function checkReceipt(order:Object):void
        {
            var prompt:Object = shop.confirmation();
            if (prompt != null && (prompt.name !== order.name || prompt.quantity !== order.quantity ||
                prompt.currency !== GroceryCatalog.CURRENCY || prompt.total !== total(order)))
            {
                finish(DailyQueue.ABORT, "购买确认与设置不符或出现其他弹框，已保留当前画面。");
                return;
            }
            var receipt:String = shop.result();
            if (receipt == "success")
            {
                clearPending();
                next("已兑换 " + order.quantity + " 个");
            }
            else if (receipt == "failed")
            {
                clearPending();
                outcomes[index] = "本次购买未成交";
                finish(DailyQueue.ABORT, "原生杂货屋未完成本次购买，已保留当前画面。");
            }
            else if (receipt != "pending") finish(DailyQueue.ABORT, "出现无法核对的交易反馈，已保留当前画面。");
            else if (prompt != null && !confirmed)
            {
                confirmed = true;
                enter("receipt");
                if (shop.confirm() !== true)
                    finish(DailyQueue.ABORT, "无法安全确认本次购买，已保留当前画面。");
            }
        }

        private function reconcile(previous:Object):void
        {
            var result:String = "pending";
            try { result = previous.adapter.result(); }
            catch (error:Error) { }
            if (result == "success" || result == "failed")
            {
                delete windowProgress.groceryPending;
                release(previous.adapter);
                finish(DailyQueue.ABORT, result == "success" ?
                    "上笔已结算，" + previous.name + "已兑换 " + previous.quantity + " 个。本轮尚未下单。" :
                    "上笔" + previous.name + "购买未成交。本轮尚未下单。");
            }
            else finish(DailyQueue.ABORT, "上笔" + previous.name + " × " + previous.quantity + " 仍待核对，本轮尚未下单。");
        }

        private function clearPending():void
        {
            if (windowProgress.groceryPending === pending) delete windowProgress.groceryPending;
            pending = null;
        }

        private static function matchesItem(item:Object, order:Object):Boolean
        {
            return item.id === order.id && item.name === order.name &&
                item.currency === GroceryCatalog.CURRENCY && item.price === order.price;
        }

        private static function total(order:Object):Number { return Number(order.price) * Number(order.quantity); }

        private static function shortage(item:Object, order:Object):String
        {
            if (item.stock < order.quantity && item.balance < total(order)) return "跳过，库存和月之印余额不足";
            if (item.stock < order.quantity) return "跳过，库存不足";
            return item.balance < total(order) ? "跳过，月之印余额不足" : "";
        }

        private function next(outcome:String):void
        {
            outcomes[index++] = outcome;
            enter(index == orders.length ? "close" : "item");
        }

        private function enter(nextPhase:String):void
        {
            phase = nextPhase;
            deadline = new Date().time + TIMEOUT_MS;
        }

        private function report(message:String):void
        {
            if (progress != null) progress(message);
        }

        private function summary(message:String):String
        {
            var lines:Array = ["杂货屋兑换" + (message ? " · " + message : "")];
            if (pending != null) outcomes[index] = "待核对，已尝试购买 " + pending.quantity + " 个";
            for (var i:int = 0; i < orders.length; ++i)
            {
                if (orders[i] != null && orders[i].name)
                    lines.push(orders[i].name + " · " + (outcomes[i] || "未执行"));
            }
            return lines.join("\n");
        }

        private function finish(status:String, message:String):void
        {
            if (!running) return;
            var details:String = summary(message);
            stop();
            done(status, details);
        }

        public function cancel():void
        {
            if (!running) return;
            if (pending != null)
            {
                var receipt:String = "pending";
                try { receipt = shop.result(); }
                catch (error:Error) { }
                if (receipt == "success" || receipt == "failed")
                {
                    outcomes[index] = receipt == "success" ? "已兑换 " + pending.quantity + " 个" : "本次购买未成交";
                    clearPending();
                }
            }
            stopSummary = summary("");
            stop();
        }

        private function stop():void
        {
            poll.stop();
            poll.removeEventListener(TimerEvent.TIMER, tick);
            poll = null;
            if (owner != null) owner.removeEventListener(Event.REMOVED_FROM_STAGE, removed);
            if (shop != null && pending == null) release(shop);
        }

        private static function release(adapter:Object):void
        {
            try { if ("dispose" in adapter) adapter.dispose(); }
            catch (error:Error) { }
        }

        private function removed(event:Event):void { finish(DailyQueue.ABORT, "游戏画面已关闭。"); }
    }
}
