package
{
   import base.ApplicationData;
   import com.tencent.morefun.naruto.plugin.ui.layer.LayerManager;
   import flash.display.MovieClip;
   import flash.display.Sprite;
   import flash.events.MouseEvent;
   import flash.external.ExternalInterface;
   import narutoos.daily.NativePlayerVisibility;
   import com.tencent.morefun.naruto.plugin.hud.view.stateBar.StateBarView;
   import ui.naruto.StateBarUI;

   public class VisibilityFixture extends MovieClip
   {
      private var app:ApplicationData;
      private var model:Object;
      private var eye:MovieClip;
      private var hud:StateBarUI;
      private var stateBar:StateBarView;
      private var mainLayer:Sprite;
      private var clicks:int;

      public function VisibilityFixture()
      {
         app = new ApplicationData();
         ApplicationData.singleton = app;
         if(ExternalInterface.available) ExternalInterface.addCallback("run",run);
      }

      private function run(mode:String) : Object
      {
         clicks = 0;
         model = { otherPlayersBodyVisible: mode != "already-hidden" };
         app.model = model;
         while(numChildren) removeChildAt(0);
         mainLayer = new Sprite();
         mainLayer.name = "mainUI";
         LayerManager.singleton.mainLayer = mainLayer;
         addChild(mainLayer);
         var decoy:Sprite = new Sprite();
         decoy.name = "otherPlayerVisibleBtn";
         decoy.addEventListener(MouseEvent.CLICK,function(event:MouseEvent):void { clicks += 100; });
         mainLayer.addChild(decoy);
         stateBar = new StateBarView();
         mainLayer.addChild(stateBar);
         hud = new StateBarUI();
         stateBar.addChild(hud);
         eye = new MovieClip();
         eye.name = "otherPlayerVisibleBtn";
         eye.mouseEnabled = true;
         eye.graphics.beginFill(0x00aa00); eye.graphics.drawRect(0,0,12,12); eye.graphics.endFill();
         eye.buttonMode = true;
         hud.addEventListener(MouseEvent.CLICK,onEyeClick);
         var art:Sprite = new Sprite();
         art.name = "eyeArt";
         eye.addChild(art);
         hud.addChild(eye);
         if(mode == "hidden-ancestor") stateBar.visible = false;
         if(mode == "unreadable") app.model = {};
         var reason:String = NativePlayerVisibility.ensureHidden(this);
         if(mode == "twice") reason = NativePlayerVisibility.ensureHidden(this);
         return { reason:reason, clicks:clicks,
            hidden:app.model.hasOwnProperty("otherPlayersBodyVisible") && app.model.otherPlayersBodyVisible === false,
            otherPlayersVisible:effectiveVisible(false), teammateVisible:effectiveVisible(true),
            eyeVisible:eye.visible, eyeMouseEnabled:eye.mouseEnabled, hudVisible:hud.visible, rootVisible:visible };
      }

      private function onEyeClick(event:MouseEvent) : void
      {
         if(event.target.parent !== eye) return;
         clicks++;
         model.otherPlayersBodyVisible = !model.otherPlayersBodyVisible;
      }

      private function effectiveVisible(isTeammate:Boolean) : Boolean
      {
         return isTeammate || model.otherPlayersBodyVisible;
      }
   }
}
