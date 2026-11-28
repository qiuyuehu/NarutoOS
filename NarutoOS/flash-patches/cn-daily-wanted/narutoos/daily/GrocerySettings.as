package narutoos.daily
{
   import flash.display.Sprite;
   import flash.events.Event;
   import flash.events.KeyboardEvent;
   import flash.text.TextField;
   import flash.text.TextFieldType;
   import flash.ui.Keyboard;

   /** Edits a draft of the role's list. Only Save returns the draft to the assistant. */
   public final class GrocerySettings extends Sprite
   {
      public static const WIDTH:int = 400;
      public static const HEIGHT:int = 390;
      private var rows:Array = [];
      private var footer:TextField;
      private var onClose:Function;

      public function GrocerySettings(saved:Object, onClose:Function)
      {
         this.onClose = onClose;
         name = "groceryPage";
         var background:Sprite = DailyAssistant.nativeSkin("Background_11");
         if(!background)
         {
            background = new Sprite();
            DailyAssistant.drawBackground(background.graphics, WIDTH, HEIGHT, 0x28211C, 0xAF8348);
         }
         background.width = WIDTH;
         background.height = HEIGHT;
         addChild(background);
         addChild(DailyAssistant.makeLabel("杂货屋兑换设置", 16, 10, WIDTH - 32, 26, 17, "center"));
         addChild(DailyAssistant.makeLabel("商品", 18, 49, 156, 22, 13));
         addChild(DailyAssistant.makeLabel("单价（月之印）", 174, 49, 115, 22, 13, "center"));
         addChild(DailyAssistant.makeLabel("每次兑换数量", 288, 49, 100, 22, 13, "center"));

         for each(var product:Object in GroceryCatalog.ITEMS)
         {
            var row:Object = {id:product.id};
            var stored:Object = saved == null ? null : saved[product.id];
            var y:int = 77 + rows.length * 29;
            var button:Sprite = DailyAssistant.makeChoice("item" + product.id, product.name, toggle(row), y);
            row.button = button;
            row.enabled = stored != null && stored.enabled === true;
            DailyAssistant.updateChoice(button, row.enabled, false);
            addChild(button);
            addChild(DailyAssistant.makeLabel(String(product.price), 175, y + 1, 115, 24, 14, "center"));
            var input:TextField = DailyAssistant.makeLabel("", 303, y + 1, 70, 22, 14, "center");
            input.name = "quantity" + product.id;
            input.type = TextFieldType.INPUT;
            input.mouseEnabled = input.selectable = input.tabEnabled = true;
            input.border = input.background = true;
            input.borderColor = 0x927D57;
            input.backgroundColor = 0x192630;
            input.text = stored != null && validQuantity(String(stored.quantity)) ? String(stored.quantity) : "1";
            input.addEventListener(Event.CHANGE, updateTotal);
            row.input = input;
            row.product = product;
            addChild(input);
            rows.push(row);
         }
         footer = DailyAssistant.makeLabel("", 15, 315, WIDTH - 30, 25, 14, "center");
         footer.name = "total";
         addChild(footer);
         var back:Sprite = DailyAssistant.actionButton("返回", dismiss, 84);
         back.name = "back";
         back.x = 106;
         back.y = 348;
         addChild(back);
         var save:Sprite = DailyAssistant.actionButton("保存", saveChoices, 84);
         save.name = "save";
         save.x = 210;
         save.y = 348;
         addChild(save);
         addEventListener(KeyboardEvent.KEY_DOWN, handleKey);
         updateTotal();
      }

      private function dismiss():void { onClose(); }

      private function handleKey(event:KeyboardEvent):void
      {
         event.stopPropagation();
         if(event.keyCode == Keyboard.ESCAPE) dismiss();
      }

      private function toggle(row:Object):Function
      {
         return function():void
         {
            row.enabled = !row.enabled;
            DailyAssistant.updateChoice(row.button, row.enabled, false);
            updateTotal();
         };
      }

      private static function validQuantity(value:String):Boolean
      {
         return /^[1-9][0-9]*$/.test(value) && Number(value) <= int.MAX_VALUE;
      }

      private function updateTotal(event:Event = null):void
      {
         var total:Number = 0;
         for each(var row:Object in rows)
         {
            if(!validQuantity(row.input.text))
            {
               footer.text = row.product.name + "的数量须为正整数。";
               return;
            }
            if(row.enabled) total += Number(row.input.text) * row.product.price;
         }
         footer.text = "本轮合计 " + total + " 月之印";
      }

      private function saveChoices():void
      {
         var result:Object = {};
         for each(var row:Object in rows)
         {
            if(!validQuantity(row.input.text))
            {
               updateTotal();
               stage.focus = row.input;
               return;
            }
            result[row.id] = {enabled:row.enabled, quantity:int(row.input.text)};
         }
         onClose(result);
      }

      public static function orders(saved:Object):Array
      {
         var result:Array = [];
         for each(var product:Object in GroceryCatalog.ITEMS)
         {
            var row:Object = saved == null ? null : saved[product.id];
            if(row != null && row.enabled === true && validQuantity(String(row.quantity)))
            {
               var itemId:int = DailyRegion.isBR && product.hasOwnProperty("brId") ? product.brId : product.id;
               result.push({id:itemId, name:product.name, price:product.price, quantity:int(row.quantity)});
            }
         }
         return result;
      }
   }
}
