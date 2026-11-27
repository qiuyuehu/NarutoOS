package
{
    import bag.utils.BagUtils;
    import base.ApplicationData;
    import com.tencent.morefun.framework.apf.core.facade.Facade;
    import com.tencent.morefun.naruto.plugin.RSModel.modules.popup.system.TextBox;
    import com.tencent.morefun.naruto.plugin.ui.box.BoxManager;
    import com.tencent.morefun.naruto.plugin.varietyShop.view.VarietyShopView;
    import com.tencent.morefun.naruto.plugin.varietyShop.view.render.StockItemRender;
    import def.BoxFlagDef;
    import fixture.NativeEvent;
    import flash.display.Sprite;
    import flash.events.Event;
    import flash.events.MouseEvent;
    import flash.external.ExternalInterface;
    import flash.geom.Point;
    import narutoos.daily.GroceryCatalog;
    import narutoos.daily.NativeGrocery;
    import ui.command.ShowTextBoxCommand;
    import user.command.FloatItemAnimationCommand;
    import varietyShop.command.OpenVarietyShopCommand;

    public final class GroceryNativeFixture extends Sprite
    {
        private const ITEM:int = 10800057;
        private const TARGET_ROW:int = 5;
        private var view:VarietyShopView;
        private var adapter:NativeGrocery;
        private var renderer:StockItemRender;
        private var pop:TextBox;
        private var buyCount:int;
        private var confirmCount:int;
        private var prompting:Boolean = true;
        private var skipNextPrompt:Boolean;
        private var stock:int = 9;
        private var closingCallback:Function;
        private var orderDone:Function;
        private var boughtFrom:Point;
        private var passes:Array = [];
        private var failures:Array = [];

        public function GroceryNativeFixture()
        {
            ExternalInterface.addCallback("run", run);
        }

        private function run():String
        {
            try
            {
                // Reference the native classes looked up through getDefinitionByName.
                check(BagUtils != null && BoxFlagDef.CHECK == 32 && GroceryCatalog.ITEMS.length == 8,
                      "fixture links adapter dependencies and catalog");
                start();
                check(adapter.item(ITEM).price == 200 && adapter.item(ITEM).stock == 9, "reads offer by ID and native live balance/stock");
                check(!renderer.visible, "item starts outside the visible rows");
                var prepared:Object = adapter.prepare(ITEM, 5);
                check(prepared.quantity == 5 && prepared.total == 1000 &&
                      view.layout.firstVisibleRow == 3 && renderer.visible,
                      "scrolls to the last row and reads native quantity and total");
                check(adapter.buy() && !adapter.buy(), "dispatches at most one click for the prepared order");
                var prompt:Object = adapter.confirmation();
                check(prompt.name == "洞穴密钥" && prompt.quantity == 5 && prompt.total == 1000 && prompt.currency == "月之印", "binds and reads the command-owned confirmation");
                check(adapter.confirm() && !adapter.confirm() && confirmCount == 1 && buyCount == 0, "clicks the native confirmation once and waits through dismissal");
                closingCallback();
                check(buyCount == 1 && !skipNextPrompt && adapter.result() == "pending", "forwards native preference and does not infer success from disappearance");
                award(ITEM, 4, boughtFrom);
                award(ITEM, 5, new Point(100, 100));
                check(adapter.result() == "pending", "unrelated award quantity and origin cannot settle the order");
                award(ITEM, 5, boughtFrom);
                check(adapter.result() == "success" && adapter.item(ITEM) == null, "identifies the native receipt while stale limits remain blocked");
                ApplicationData.singleton.selfInfo.shadowOfMoon = 200;
                view.layout.dataProvider = view.layout.dataProvider.concat();
                check(adapter.item(ITEM) == null, "relayout with old item data cannot qualify as inventory refresh");
                stock = 4;
                stockRefresh();
                check(adapter.item(ITEM).balance == 200 && adapter.item(ITEM).stock == 4 && adapter.close(), "allows new offers only after native wallet and stock refresh");
                start();
                prompting = false;
                adapter.prepare(ITEM, 1);
                check(adapter.buy() && adapter.confirmation() == null && buyCount == 2 && adapter.result() == "pending", "supports native no-prompt purchasing");
                award(ITEM, 1, boughtFrom);
                check(adapter.result() == "success" && adapter.close(), "uses the same native receipt for no-prompt buying");
                start();
                prompting = true;
                adapter.prepare(ITEM, 1);
                adapter.buy();
                check(adapter.confirm(), "prepares to verify renderer recycling during native close");
                stockRefresh();
                closingCallback();
                check(buyCount == 2 && adapter.result() == "failed", "suppresses transaction if renderer is recycled after OK");
                adapter.close();
                start();
                adapter.prepare(ITEM, 1);
                adapter.buy();
                var replacement:TextBox = new TextBox(pop.content.txt.htmlText, 35);
                BoxManager.showingList.push(replacement);
                addChild(replacement);
                check(adapter.confirmation() != null && adapter.confirmation().name == null && !adapter.confirm(),
                      "retains an unrelated replacement with identical confirmation text");
                BoxManager.showingList.pop();
                removeChild(replacement);
                pop.content.ok.dispatchEvent(new MouseEvent(MouseEvent.CLICK));
                closingCallback(BoxFlagDef.OK, true);
                check(buyCount == 3 && skipNextPrompt,
                      "manual confirmation passes its original preference through unchanged");
                award(ITEM, 1, boughtFrom);
                check(adapter.result() == "success" && adapter.close(), "recognizes the manually completed pending order");
                start();
                adapter.prepare(ITEM, 1);
                adapter.buy();
                pop.content.cancelBtn.dispatchEvent(new MouseEvent(MouseEvent.CLICK));
                closingCallback(BoxFlagDef.CANCEL, false);
                check(adapter.result() == "failed" && buyCount == 3, "native cancellation leaves the order unsubmitted");
                var offer:Object = view.layout.dataProvider[TARGET_ROW][0];
                offer.shopInfo.currencyId = 13102001;
                offer.shopInfo.hasCurrencyId = true;
                check(adapter.item(ITEM).id == null && !adapter.buy(), "rejects an explicit non-moon currency");
                offer.shopInfo.currencyId = 0;
                check(adapter.item(ITEM).id == null && !adapter.buy(), "rejects an explicitly supplied zero currency");
                offer.shopInfo.hasCurrencyId = false;
                check(adapter.item(ITEM).currency == "月之印" && adapter.prepare(ITEM, 1).total == 200,
                      "uses the moon tab and native cost icon when currency is omitted");
                delete offer.shopInfo.hasCurrencyId;
                check(adapter.prepare(ITEM, 1).total == 200, "accepts the native default zero without a presence flag");
                renderer.skin.itemBg.costType.currentFrame = 1;
                check(adapter.prepare(ITEM, 1).id == null && !adapter.buy(), "rejects the wrong cost icon despite the moon tab");
            }
            catch (error:Error) { failures.push(error.getStackTrace()); }
            ExternalInterface.call("groceryFixtureResult", JSON.stringify({passes:passes,failures:failures}));
            return "started";
        }

        private function start():void
        {
            if (adapter != null) adapter.dispose();
            OpenVarietyShopCommand.opened = show;
            adapter = new NativeGrocery(this);
            if (!adapter.open() || adapter.confirmation() != null) throw new Error("failed to open expected shop");
        }

        private function show(tab:int):void
        {
            view = new VarietyShopView(tab);
            addChild(view);
            BoxManager.showingList.push(view);
            var rack:GroceryRack = new GroceryRack();
            renderer = new StockItemRender();
            rack.addChild(renderer);
            view.layout.addChild(rack);
            view.layout.layout.items = [rack];
            view.layout.render = function():void
            {
                var visible:Boolean = TARGET_ROW >= view.layout.firstVisibleRow &&
                    TARGET_ROW < view.layout.firstVisibleRow + 3;
                rack.visible = renderer.visible = visible;
                rack.data = visible ? view.layout.dataProvider[TARGET_ROW] : null;
                renderer.data = visible ? rack.data[0] : null;
            };
            stockRefresh();
            renderer.skin.itemBg.buyBtn.addEventListener(MouseEvent.CLICK, buy);
        }

        private function stockRefresh():void
        {
            view.layout.dataProvider = [[], [], [], [], [], [{
                itemInfo:{ itemId:ITEM, goodsId:37, num:1, price:200, itemStorage:stock },
                shopInfo:{ currencyId:13103001, isOpen:true }
            }]];
            view.layout.render();
            renderer.stepper.value = 1;
            renderer.stepper.drawNow();
        }

        private function buy(event:MouseEvent):void
        {
            orderDone = function():void
            {
                buyCount++;
                boughtFrom = renderer.skin.itemBg.buyBtn.localToGlobal(new Point(-60,-60));
            };
            if (!prompting)
            {
                orderDone();
                return;
            }
            var count:int = renderer.stepper.value;
            var text:String = "<b><font color='#ffffff'>确定购买<font color='#e9e499'>" + count +
                "</font>个<font color='#e9e499'>洞穴密钥</font>，共花费<font color='#e9e499'>" +
                200 * count + "月之印</font>?</b>";
            var command:ShowTextBoxCommand = new ShowTextBoxCommand(text,
                function(flag:int, data:Object, checked:Boolean):void
                {
                    if (flag == BoxFlagDef.OK) { skipNextPrompt = checked; orderDone(); }
                });
            Facade.getInstance().commandManager.dispatchEvent(new NativeEvent("commandRequest",command));
            Facade.getInstance().commandManager.dispatchEvent(new NativeEvent("commandExecute",command));
            pop = new TextBox(command.text, command.flags);
            addChild(pop);
            BoxManager.showingList.push(pop);
            BoxManager.dispathcer.dispatchEvent(new NativeEvent("boxShow",pop));
            command.dispatchEvent(new Event("loadingEnd"));
            var dismiss:Function = function(event:MouseEvent):void
            {
                if (event.currentTarget === pop.content.ok) confirmCount++;
                BoxManager.showingList.splice(BoxManager.showingList.indexOf(pop),1);
                removeChild(pop);
                closingCallback = function(flag:int = BoxFlagDef.OK, checked:Boolean = false):void
                {
                    command.closedFun(flag, null, checked);
                };
            };
            pop.content.ok.addEventListener(MouseEvent.CLICK, dismiss);
            pop.content.cancelBtn.addEventListener(MouseEvent.CLICK, dismiss);
        }

        private function award(id:int, count:int, from:Point):void
        {
            Facade.getInstance().commandManager.dispatchEvent(new NativeEvent("commandRequest",
                new FloatItemAnimationCommand([{id:id,num:count}],from)));
        }

        private function check(condition:Boolean, test:String):void
        {
            (condition ? passes : failures).push(test);
            if (!condition) throw new Error(test);
        }
    }
}
class GroceryRack extends flash.display.Sprite
{
    public var data:Array;
}
