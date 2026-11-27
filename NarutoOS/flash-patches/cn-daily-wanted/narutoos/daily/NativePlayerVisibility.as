package narutoos.daily
{
   import flash.display.DisplayObject;
   import flash.display.DisplayObjectContainer;
   import flash.display.InteractiveObject;
   import flash.display.MovieClip;
   import flash.display.Sprite;
   import flash.events.MouseEvent;
   import flash.utils.getDefinitionByName;
   import flash.utils.getQualifiedClassName;

   /** Applies the game's own "hide other players" toggle once, when its state is known. */
   public final class NativePlayerVisibility
   {
      private static const PLAYER_MODEL:String = "player.PlayerModel";
      private static const MAIN_UI_LAYER:String = "mainUI";
      private static const STATE_BAR_VIEW:String = "com.tencent.morefun.naruto.plugin.hud.view.stateBar::StateBarView";
      private static const STATE_BAR_UI:String = "ui.naruto::StateBarUI";
      private static const EYE_BUTTON:String = "otherPlayerVisibleBtn";

      public static function ensureHidden(owner:Sprite) : String
      {
         var model:Object;
         var visibleState:*;
         try
         {
            var appClass:Class = getDefinitionByName("base.ApplicationData") as Class;
            var app:Object = appClass["singleton"];
            if(app == null)
            {
               return "无法读取玩家显示状态，已跳过";
            }
            model = app.getModel(PLAYER_MODEL);
            if(model == null || !("otherPlayersBodyVisible" in model))
            {
               return "无法读取玩家显示状态，已跳过";
            }
            visibleState = model["otherPlayersBodyVisible"];
         }
         catch(error:Error)
         {
            return "无法读取玩家显示状态，已跳过";
         }
         if(visibleState !== true && visibleState !== false)
         {
            return "无法读取玩家显示状态，已跳过";
         }
         if(visibleState === false)
         {
            return "";
         }
         if(owner == null || owner.stage == null)
         {
            return "未找到原生隐藏按钮，已跳过";
         }
         try
         {
            var layerManagerClass:Class = getDefinitionByName("com.tencent.morefun.naruto.plugin.ui.layer.LayerManager") as Class;
            var layer:Object = layerManagerClass["singleton"].findLayerByName(MAIN_UI_LAYER);
            if(!(layer is DisplayObjectContainer))
            {
               return "未找到游戏原生 HUD，已跳过";
            }
            var stateBar:DisplayObjectContainer = findDirectChild(layer as DisplayObjectContainer,STATE_BAR_VIEW);
            var hud:DisplayObjectContainer = stateBar == null ? null : findDirectChild(stateBar,STATE_BAR_UI);
            var button:DisplayObject = hud == null ? null : hud.getChildByName(EYE_BUTTON);
            if(button == null)
            {
               return "未找到原生眼睛按钮，已跳过";
            }
            if(button.stage !== owner.stage || !isVisibleThroughStage(button))
            {
               return "原生眼睛按钮当前不可见，已跳过";
            }
            var buttonClip:MovieClip = button as MovieClip;
            if(buttonClip == null || buttonClip.numChildren == 0 || !(button is InteractiveObject) || !(button as InteractiveObject).mouseEnabled)
            {
               return "原生眼睛按钮当前不可用，已跳过";
            }
            buttonClip.getChildAt(0).dispatchEvent(new MouseEvent(MouseEvent.CLICK,true,false));
            return model["otherPlayersBodyVisible"] === false ? "" : "点击后未确认隐藏状态";
         }
         catch(clickError:Error)
         {
            return "原生隐藏操作失败，已跳过";
         }
         return "原生隐藏操作失败，已跳过";
      }

      private static function findDirectChild(root:DisplayObjectContainer, className:String) : DisplayObjectContainer
      {
         var child:DisplayObject;
         var found:DisplayObjectContainer = null;
         var i:int = 0;
         while(i < root.numChildren)
         {
            child = root.getChildAt(i);
            if(getQualifiedClassName(child) == className && child is DisplayObjectContainer)
            {
               if(found != null)
               {
                  return null;
               }
               found = child as DisplayObjectContainer;
            }
            i++;
         }
         return found;
      }

      private static function isVisibleThroughStage(target:DisplayObject) : Boolean
      {
         var node:DisplayObject = target;
         while(node != null && node.parent != null)
         {
            if(!node.visible)
            {
               return false;
            }
            node = node.parent;
         }
         return true;
      }
   }
}
