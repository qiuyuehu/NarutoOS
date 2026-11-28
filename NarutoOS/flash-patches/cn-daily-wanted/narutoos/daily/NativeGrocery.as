package narutoos.daily
{
    import flash.display.DisplayObject;
    import flash.display.DisplayObjectContainer;
    import flash.display.InteractiveObject;
    import flash.events.Event;
    import flash.events.IEventDispatcher;
    import flash.events.MouseEvent;
    import flash.geom.Point;
    import flash.text.TextField;
    import flash.utils.getDefinitionByName;
    import flash.utils.getQualifiedClassName;

    public final class NativeGrocery
    {
        private static const SHOP:String = "com.tencent.morefun.naruto.plugin.varietyShop.";
        private static const VIEW:String = SHOP + "view::VarietyShopView";
        private static const RENDERER:String = SHOP + "view.render::StockItemRender";
        private static const STEPPER:String = SHOP + "view.render::NumericStepper_yellow";
        private static const SKIN:String = "com.tencent.morefun.naruto.plugin.varietyShop::VarietyShopItemUI";
        private static const TAB:String = "com.tencent.morefun.naruto.plugin.ui.base::TabBar";
        private static const LAYOUT:String = "com.tencent.morefun.naruto.plugin.ui.components.layouts::EasyLayout";
        private static const TEXT_BOX:String = "com.tencent.morefun.naruto.plugin.RSModel.modules.popup.system::TextBox";
        private static const TEXT_SKIN:String = "com.tencent.morefun.naruto.plugin.ui.core::TextBoxUI";
        private static const TEXT_COMMAND:String = "ui.command::ShowTextBoxCommand";
        private static const AWARD_COMMAND:String = "user.command::FloatItemAnimationCommand";
        private static const MOON_TAB:int = 1;
        private static const UNREADABLE:Object = {};

        private var owner:DisplayObject;
        private var application:Object;
        private var boxes:Object;
        private var bag:Object;
        private var commands:IEventDispatcher;
        private var boxEvents:IEventDispatcher;
        private var flags:Object;
        private var shop:Object;
        private var selfInfo:Object;
        private var opening:Boolean;
        private var closing:Boolean;
        private var prepared:Object;
        private var pending:Object;
        private var dispatchingBuy:Boolean;
        private var dialogCommand:Object;
        private var dialog:Object;
        private var dialogReady:Boolean;
        private var sawDialog:Boolean;
        private var confirmed:Boolean;
        private var awardSeen:Boolean;
        private var notSent:Boolean;
        private var refresh:Object;

        public function NativeGrocery(owner:DisplayObject)
        {
            this.owner = owner;
            boxes = getDefinitionByName("com.tencent.morefun.naruto.plugin.ui.box.BoxManager");
            application = Object(getDefinitionByName("base.ApplicationData")).singleton;
            bag = getDefinitionByName("bag.utils.BagUtils");
            flags = getDefinitionByName("def.BoxFlagDef");
            commands = Object(getDefinitionByName(
                "com.tencent.morefun.framework.apf.core.facade.Facade")).getInstance().commandManager as IEventDispatcher;
            boxEvents = boxes.dispathcer as IEventDispatcher;
        }

        public function open():Boolean
        {
            if (opening || commands == null || boxEvents == null || owner.stage == null || application.isFightLock ||
                NativeFightResult.current(owner.stage) != null || modal() != null) return false;
            selfInfo = application.selfInfo;
            if (selfInfo == null) return false;
            var type:Class = getDefinitionByName("varietyShop.command.OpenVarietyShopCommand") as Class;
            opening = true;
            var command:Object = new type(MOON_TAB);
            command.call();
            return true;
        }

        public function item(id:int):Object
        {
            if (!refreshed()) return null;
            var row:Object = findOffer(id, false);
            return row == null || row === UNREADABLE ? row : row.snapshot;
        }

        public function prepare(id:int, quantity:int):Object
        {
            prepared = null;
            var row:Object = findOffer(id, false);
            if (row == null || row === UNREADABLE) return row;
            var snapshot:Object = row.snapshot;
            snapshot.quantity = quantity;
            snapshot.total = Number(snapshot.price) * quantity;
            if (snapshot.stock < quantity || snapshot.balance < snapshot.total) return snapshot;

            row.layout.scrollTo(row.index);
            var control:Object = controls(row);
            if (control == null) return null;
            if (control === UNREADABLE || !enabled(control.button)) return UNREADABLE;
            if (!writeQuantity(control, quantity)) return UNREADABLE;
            snapshot.quantity = readControlQuantity(control);
            snapshot.total = Number(snapshot.price) * snapshot.quantity;
            if (snapshot.quantity !== quantity) return UNREADABLE;
            prepared = {row:row, control:control, renderer:control.renderer, quantity:snapshot.quantity, total:snapshot.total};
            return snapshot;
        }

        public function buy():Boolean
        {
            if (prepared == null || pending != null || !stillPrepared(prepared, false)) return false;
            pending = prepared;
            prepared = null;
            dialogCommand = dialog = null;
            awardSeen = confirmed = sawDialog = dialogReady = notSent = false;
            pending.from = pending.control.button.localToGlobal(new Point(-60, -60));
            commands.addEventListener("commandRequest", onCommand, false, int.MAX_VALUE, true);
            commands.addEventListener("commandExecute", onDialogExecute, false, int.MAX_VALUE, true);
            dispatchingBuy = true;
            try
            {
                pending.control.button.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true, false));
            }
            finally { dispatchingBuy = false; }
            return true;
        }

        public function confirmation():Object
        {
            var top:Object = modal();
            if (shop == null && opening && top != null && getQualifiedClassName(top) == VIEW) shop = top;
            if (top == null || top === shop) return null;
            if (pending == null || dialog !== top || getQualifiedClassName(top) != TEXT_BOX) return UNREADABLE;
            if (!dialogReady || !top.isShowing) return null;
            var content:DisplayObjectContainer = top.content as DisplayObjectContainer;
            var match:Array;
            var name:String;
            var quantity:int;
            var total:int;
            if (DailyRegion.isBR)
            {
                // The BR shop may be rendered in Portuguese or through the user's existing
                // Chinese localization. Accept only these two verified native templates.
                match = /^Deseja gastar\s*([1-9][0-9]*)\s+Selos? da Lua,\s*para comprar\s*([1-9][0-9]*)\s+(.+)\?$/s.exec(content["txt"].text);
            }
            if (match == null)
            {
                match = /^确定购买([1-9][0-9]*)个(.+)，共花费([1-9][0-9]*)(月之印)\?$/s.exec(content["txt"].text);
                if (match == null) return UNREADABLE;
                quantity = readCount(match[1]);
                name = match[2];
                total = readCount(match[3]);
            }
            else
            {
                total = readCount(match[1]);
                quantity = readCount(match[2]);
                name = match[3];
            }
            if (!dialogButton(content, "okBtn", flags.OK) || !dialogButton(content, "cancelBtn", flags.CANCEL))
                return UNREADABLE;
            return {name:name, quantity:quantity, currency:GroceryCatalog.CURRENCY, total:total};
        }

        public function confirm():Boolean
        {
            if (confirmed || pending == null || dialog == null) return false;
            var details:Object = confirmation();
            var expected:Object = pending.row.snapshot;
            if (details == null || details === UNREADABLE || details.name !== expected.name ||
                details.quantity !== pending.quantity || details.currency !== expected.currency ||
                details.total !== pending.total || !stillPrepared(pending, true)) return false;
            var content:DisplayObjectContainer = dialog.content as DisplayObjectContainer;
            var button:InteractiveObject = content.getChildByName("okBtn") as InteractiveObject;
            confirmed = true;
            button.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true, false));
            return true;
        }

        public function result():String
        {
            if (pending == null || application.selfInfo !== selfInfo) return "pending";
            if (notSent)
            {
                finishReceipt();
                return "failed";
            }
            if (!awardSeen) return "pending";
            refresh = pending;
            finishReceipt();
            return "success";
        }

        private function refreshed():Boolean
        {
            if (refresh == null) return true;
            // The receipt is independent of these updates. A subsequent order still needs a
            // fresh native inventory and wallet so it cannot act against the previous offer.
            var previous:Object = refresh.row;
            if (!onStage(shop) || application.selfInfo !== selfInfo) return true;
            var current:Object = findOffer(previous.snapshot.id, false);
            if (current == null || current === UNREADABLE || current.data.itemInfo === previous.data.itemInfo ||
                current.snapshot.balance != previous.snapshot.balance - refresh.total) return false;
            refresh = null;
            return true;
        }

        public function close():Boolean
        {
            if (pending != null || (modal() != null && modal() !== shop)) return false;
            if (!onStage(shop)) return true;
            if (!closing)
            {
                closing = true;
                shop.close();
            }
            return !onStage(shop);
        }

        public function dispose():void
        {
            finishReceipt();
            owner = null;
            shop = null;
            selfInfo = null;
            prepared = refresh = null;
        }

        private function finishReceipt():void
        {
            if (commands != null) commands.removeEventListener("commandRequest", onCommand);
            detachDialogWatch();
            pending = dialog = null;
        }

        private function onCommand(event:Event):void
        {
            if (pending == null || application.selfInfo !== selfInfo) return;
            var command:Object = Object(event).command;
            switch (getQualifiedClassName(command))
            {
                case TEXT_COMMAND:
                    // The purchase handler requests its confirmation synchronously during its click.
                    if (dispatchingBuy && command.flags == (flags.OK | flags.CANCEL | flags.CHECK) &&
                        command.modal && command.flagNames == null && command.closingFun == null &&
                        command.closedFun is Function && dialogCommand == null) watchDialog(command);
                    break;
                case AWARD_COMMAND:
                    var items:Array = command.data as Array;
                    var from:Point = command.from as Point;
                    if (items != null && items.length == 1 && items[0].id === pending.row.snapshot.id &&
                        items[0].num === pending.quantity && from != null && from.equals(pending.from))
                        awardSeen = true;
                    break;
            }
        }

        private function watchDialog(command:Object):void
        {
            dialogCommand = command;
            var source:IEventDispatcher = command as IEventDispatcher;
            source.addEventListener("loadingEnd", onDialogSettled, false, int.MAX_VALUE, true);
            source.addEventListener("faild", onDialogSettled, false, int.MAX_VALUE, true);
            var nativeClose:Function = command.closedFun;
            var order:Object = pending;
            command.closedFun = function(flag:int, data:Object, skipNextPrompt:Boolean):void
            {
                if (flag == flags.OK && pending === order && confirmed)
                {
                    // The native handler reads its recycled renderer after the close animation.
                    if (!stillPrepared(order, false))
                    {
                        notSent = true;
                        return;
                    }
                    order.from = order.control.button.localToGlobal(new Point(-60, -60));
                }
                else if (flag != flags.OK && pending === order) notSent = true;
                nativeClose(flag, data, skipNextPrompt);
            };
        }

        private function onDialogExecute(event:Event):void
        {
            if (dialogCommand != null && Object(event).command === dialogCommand)
                boxEvents.addEventListener("boxShow", onDialogShow, false, int.MAX_VALUE, true);
        }

        private function onDialogShow(event:Event):void
        {
            var box:Object = Object(event).box;
            if (getQualifiedClassName(box) != TEXT_BOX || !box.modal || box.name !== "TextBox" ||
                getQualifiedClassName(box.content) != TEXT_SKIN) return;
            var expected:TextField = new TextField();
            expected.htmlText = dialogCommand.text;
            if (box.content.txt.text === expected.text)
            {
                dialog = sawDialog ? null : box;
                sawDialog = true;
            }
        }

        private function onDialogSettled(event:Event):void
        {
            dialogReady = event.type == "loadingEnd" && dialog != null;
            if (!dialogReady) dialog = null;
            detachDialogWatch();
        }

        private function detachDialogWatch():void
        {
            if (dialogCommand != null)
            {
                dialogCommand.removeEventListener("loadingEnd", onDialogSettled);
                dialogCommand.removeEventListener("faild", onDialogSettled);
                dialogCommand = null;
            }
            if (commands != null) commands.removeEventListener("commandExecute", onDialogExecute);
            if (boxEvents != null) boxEvents.removeEventListener("boxShow", onDialogShow);
        }

        private function findOffer(id:int, allowDialog:Boolean):Object
        {
            if (!opening || closing || owner == null || owner.stage == null) return UNREADABLE;
            if (application.selfInfo !== selfInfo || application.isFightLock ||
                NativeFightResult.current(owner.stage) != null) return UNREADABLE;
            var top:Object = modal();
            if (shop == null)
            {
                if (top == null) return null;
                if (getQualifiedClassName(top) != VIEW) return UNREADABLE;
                shop = top;
            }
            if (!onStage(shop) || (top !== shop && (!allowDialog || top !== dialog))) return UNREADABLE;

            var content:Object = shop.content;
            if (content == null || !shop.isShowing) return null;
            var tab:Object = directChild(content.toolBar, TAB);
            var layout:Object = directChild(content.list, LAYOUT);
            if (tab == null || layout == null || tab.selectedIndex != MOON_TAB) return UNREADABLE;
            var rows:Array = layout.dataProvider as Array;
            if (rows == null || rows.length == 0) return null;

            var found:Object;
            for (var index:int = 0; index < rows.length; index++)
            {
                for each (var entry:Object in rows[index])
                {
                    if (entry.itemInfo.itemId != id) continue;
                    if (found != null) return UNREADABLE;
                    found = {data:entry, layout:layout, index:index};
                }
            }
            if (found == null) return UNREADABLE;

            var info:Object = found.data.itemInfo;
            var shopInfo:Object = found.data.shopInfo;
            var itemData:Object = bag.createItemData(id);
            var balance:Number = Number(selfInfo.shadowOfMoon);
            // Some offers omit currencyId. The native moon tab and the offer's rendered cost icon
            // still have to agree before the purchase button is available to this adapter.
            var defaultCurrency:Boolean = shopInfo.currencyId === 0 &&
                (!("hasCurrencyId" in shopInfo) || shopInfo.hasCurrencyId === false);
            if ((!defaultCurrency && shopInfo.currencyId !== GroceryCatalog.CURRENCY_ID) || !shopInfo.isOpen ||
                itemData == null || itemData.id != id || info.num != 1 || info.price <= 0 || info.goodsId <= 0 ||
                !isFinite(balance) || balance < 0 || info.itemStorage < 0) return UNREADABLE;
            found.snapshot = {id:id, name:itemData.name, currency:GroceryCatalog.CURRENCY, price:Number(info.price),
                              balance:balance, stock:Number(info.itemStorage)};
            return found;
        }

        private function controls(row:Object):Object
        {
            for each (var rack:DisplayObject in row.layout.layout.items)
            {
                if (rack == null || !rack.visible || Object(rack).data !== row.layout.dataProvider[row.index]) continue;
                var renderer:DisplayObjectContainer = findRenderer(rack as DisplayObjectContainer, row.data);
                if (renderer == null) continue;
                var skin:Object = directChild(renderer as DisplayObjectContainer, SKIN);
                if (skin == null || skin.itemBg == null) return UNREADABLE;
                if (skin.itemBg.currentFrame != 1 ||
                    skin.itemBg.costType.currentFrame != MOON_TAB + 1 || skin.itemNameTf.text !== row.snapshot.name ||
                    readCount(skin.itemBg.costTf.text) !== row.snapshot.price) return UNREADABLE;
                var stepper:Object = directChild(renderer as DisplayObjectContainer, STEPPER);
                if (stepper != null)
                {
                    if (!stepper.visible || stepper.numericUI == null || !(stepper.numericUI.textField is TextField))
                        return UNREADABLE;
                    return {button:skin.itemBg.buyBtn, stepper:stepper, renderer:renderer, nativeQuantity:false};
                }

                // PT9.41 moved quantity handling into StockItemRender: the skin contains a
                // MovieClip/TextField and the renderer updates its private m_currentNum from
                // Event.CHANGE. Require that handler before writing so the eventual native
                // click cannot submit a stale private quantity.
                if (!DailyRegion.isBR) return UNREADABLE;
                var nativeStepper:Object = skin.itemBg.stepper;
                var textField:TextField = nativeStepper == null ? null : nativeStepper.textField as TextField;
                if (nativeStepper == null || !(nativeStepper is DisplayObject) || !nativeStepper.visible ||
                    textField == null || !textField.hasEventListener(Event.CHANGE)) return UNREADABLE;
                return {button:skin.itemBg.buyBtn, stepper:nativeStepper, textField:textField,
                        renderer:renderer, nativeQuantity:true};
            }
            return null;
        }

        private function writeQuantity(control:Object, quantity:int):Boolean
        {
            if (control == null || control.renderer == null) return false;
            if (control.nativeQuantity)
            {
                var field:TextField = control.textField as TextField;
                if (field == null || !field.hasEventListener(Event.CHANGE)) return false;
                field.htmlText = "<b>" + quantity + "</b>";
                field.dispatchEvent(new Event(Event.CHANGE));
                return field.hasEventListener(Event.CHANGE) && readCount(field.text) === quantity;
            }
            control.stepper.value = quantity;
            control.stepper.drawNow();
            return control.stepper.value === quantity &&
                readCount(control.stepper.numericUI.textField.text) === quantity;
        }

        private function readControlQuantity(control:Object):Number
        {
            if (control == null) return NaN;
            return control.nativeQuantity ? readCount(control.textField.text) :
                readCount(control.stepper.numericUI.textField.text);
        }

        private static function findRenderer(branch:DisplayObjectContainer, data:Object):DisplayObjectContainer
        {
            if (branch == null || !branch.visible) return null;
            if (getQualifiedClassName(branch) == RENDERER) return Object(branch).data === data ? branch : null;
            for (var i:int = 0; i < branch.numChildren; i++)
            {
                var renderer:DisplayObjectContainer = findRenderer(branch.getChildAt(i) as DisplayObjectContainer, data);
                if (renderer != null) return renderer;
            }
            return null;
        }

        private function stillPrepared(order:Object, inDialog:Boolean):Boolean
        {
            var previous:Object = order.row.snapshot;
            var row:Object = findOffer(previous.id, inDialog);
            if (row == null || row === UNREADABLE || row.data.itemInfo !== order.row.data.itemInfo ||
                row.snapshot.name !== previous.name || row.snapshot.price !== previous.price ||
                row.snapshot.stock < order.quantity || row.snapshot.balance < order.total) return false;
            var control:Object = controls(row);
            if (control == null || control === UNREADABLE || control.renderer !== order.renderer ||
                control.button !== order.control.button || control.stepper !== order.control.stepper ||
                control.nativeQuantity !== order.control.nativeQuantity ||
                (control.nativeQuantity && control.textField !== order.control.textField)) return false;
            var liveQuantity:Number = readControlQuantity(control);
            if (liveQuantity !== order.quantity ||
                (control.nativeQuantity && !control.textField.hasEventListener(Event.CHANGE)) ||
                (!control.nativeQuantity && control.stepper.value !== order.quantity))
                return false;
            if (!inDialog) order.row = row;
            return inDialog || enabled(control.button);
        }

        private function modal():Object
        {
            var list:Array = boxes.showingList as Array;
            if (owner == null || owner.stage == null || list == null) return UNREADABLE;
            for (var i:int = list.length - 1; i >= 0; i--)
            {
                var box:Object = list[i];
                if (onStage(box) && box.modal && box.isShow) return box;
            }
            return null;
        }

        private function onStage(box:Object):Boolean
        {
            return box != null && owner != null && owner.stage != null && box.stage === owner.stage;
        }

        private static function directChild(parent:DisplayObjectContainer, type:String):Object
        {
            if (parent == null) return null;
            for (var i:int = 0; i < parent.numChildren; i++)
            {
                var child:DisplayObject = parent.getChildAt(i);
                if (getQualifiedClassName(child) == type) return child;
            }
            return null;
        }

        private static function enabled(button:InteractiveObject):Boolean
        {
            if (button == null || button.stage == null || !button.mouseEnabled ||
                ("enabled" in button && !Object(button).enabled)) return false;
            for (var branch:DisplayObject = button; branch != null; branch = branch.parent)
            {
                if (!branch.visible || branch.alpha <= 0) return false;
                if (branch !== button && branch is DisplayObjectContainer &&
                    !DisplayObjectContainer(branch).mouseChildren) return false;
            }
            return true;
        }

        private static function readCount(text:String):Number
        {
            return /^[0-9]+$/.test(text) ? Number(text) : NaN;
        }

        private static function dialogButton(content:DisplayObjectContainer, name:String, flag:int):Boolean
        {
            var button:InteractiveObject = content.getChildByName(name) as InteractiveObject;
            return enabled(button) && Object(button).enabled === true && Object(button).userData == flag;
        }
    }
}
