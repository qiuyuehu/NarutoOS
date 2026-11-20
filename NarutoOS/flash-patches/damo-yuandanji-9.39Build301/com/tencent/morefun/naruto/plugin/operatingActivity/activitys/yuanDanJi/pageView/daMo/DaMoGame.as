package com.tencent.morefun.naruto.plugin.operatingActivity.activitys.yuanDanJi.pageView.daMo
{
   import flash.display.MovieClip;
   import flash.display.Sprite;
   import flash.events.Event;
   import flash.events.MouseEvent;
   import flash.geom.Point;
   import flash.utils.getTimer;

   public class DaMoGame
   {

      private var view:MovieClip;

      private var _progress:ProgressView;

      private var _cylinders:Vector.<CylinderView> = new Vector.<CylinderView>();

      private var _curHitCyl:CylinderView;

      private var _cylinderContainer:Sprite;

      private var _hammer:HammerView;

      private var _gameOverEff:MovieClip;

      private var _fristMC:MovieClip;

      private var _isStart:Boolean;

      private var _isGameOver:Boolean;

      private var _time:Number = 0;

      private var _timestamp:Number = 0;

      private var _radius:int = 57;

      private var _hitCount:int = 0;

      private var _direction:int;

      private var _round:int = 0;

      private var _roundMax:int = 1;

      private var _assistRunMode:String = "manual";

      private var _assistActive:Boolean = false;

      private var _assistTargetHits:int = 0;

      private var _assistStartedAt:int = 0;

      private var applyStart:Function;

      private var applyAward:Function;

      private var onGameOver:Function;

      private var onAssistStatus:Function;

      private var _fristCallback:Function;

      public function DaMoGame(param1:MovieClip, param2:Function, param3:Function, param4:Function, param5:Function = null)
      {
         super();
         this.view = param1;
         this.applyStart = param2;
         this.applyAward = param3;
         this.onGameOver = param4;
         this.onAssistStatus = param5;
         this.initUI();
      }

      public function assistOnePerfectHit() : Boolean
      {
         return this.beginAssist("single",this._hitCount + 1,"single-started");
      }

      public function assistCompleteRound() : Boolean
      {
         return this.beginAssist("round",6,"round-started");
      }

      private function beginAssist(param1:String, param2:int, param3:String) : Boolean
      {
         if(!this._isStart || this._isGameOver || this._assistActive)
         {
            return false;
         }
         if(this._hitCount >= param2)
         {
            return false;
         }
         this._assistRunMode = param1;
         this._assistTargetHits = param2;
         this._assistStartedAt = getTimer();
         this._assistActive = true;
         if(this.onAssistStatus != null)
         {
            this.onAssistStatus(param3,param1,this._hitCount);
         }
         return true;
      }

      public function get isGameOver() : Boolean
      {
         return this._isGameOver;
      }

      private function finishAssist(param1:String) : void
      {
         if(!this._assistActive)
         {
            return;
         }
         var mode:String = this._assistRunMode;
         this._assistActive = false;
         this._assistRunMode = "manual";
         this._assistTargetHits = 0;
         if(this.onAssistStatus != null)
         {
            this.onAssistStatus(param1,mode,this._hitCount);
         }
      }

      private function getAssistPoint() : Point
      {
         var cylinder:CylinderView = null;
         var top:Point = null;
         var bottom:Point = null;
         for each(cylinder in this._cylinders)
         {
            if(cylinder != null && cylinder.floor > 0 && cylinder.floor < 7)
            {
               top = cylinder.topGlobal;
               bottom = cylinder.bottomGlobal;
               return new Point(this._hammer.globalPoint.x,(top.y + bottom.y) / 2);
            }
         }
         return null;
      }

      private function runAssistFrame() : void
      {
         var point:Point = null;
         var previousHitCount:int = 0;
         if(!this._assistActive)
         {
            return;
         }
         if(getTimer() - this._assistStartedAt > 60000)
         {
            this.finishAssist("timeout");
            return;
         }
         if(!this._progress.isPerfect())
         {
            return;
         }
         point = this.getAssistPoint();
         if(point == null)
         {
            this.finishAssist("no-target");
            return;
         }
         previousHitCount = this._hitCount;
         this.onHammerHit(point);
         if(this._hitCount == previousHitCount)
         {
            this.finishAssist("missed-target");
            return;
         }
         if(this._hitCount >= this._assistTargetHits)
         {
            this.finishAssist(this._assistRunMode == "round" ? "round-complete" : "single-complete");
         }
         else if(this.onAssistStatus != null)
         {
            this.onAssistStatus("hit",this._assistRunMode,this._hitCount);
         }
      }

      private function initUI() : void
      {
         this._progress = new ProgressView(this.view.mc_progressBar,this.onProgressEnd);
         this._cylinderContainer = this.view["container_cylinder"];
         this.view["btn_start"].addEventListener(MouseEvent.CLICK,this.onClickStart);
         this.view["mc_gameOver"].visible = false;
         this.initCylinder();
         this.initMouse();
         this.resetLight();
         this._gameOverEff = this.view["gameOverEff"];
         this._gameOverEff.stop();
         this._gameOverEff.visible = false;
         this._fristMC = this.view["mc_frist"];
         this._fristMC.visible = false;
      }

      public function dispose() : void
      {
         this._fristMC.removeEventListener(MouseEvent.CLICK,this.onClickFrist);
         this.view["btn_start"].removeEventListener(MouseEvent.CLICK,this.onClickStart);
         this.stop();
         var _loc1_:int = 0;
         while(_loc1_ < this._cylinders.length)
         {
            this._cylinders[_loc1_].dispose();
            this._cylinders[_loc1_] = null;
            _loc1_++;
         }
         this._cylinders = null;
         this._curHitCyl = null;
         this._cylinderContainer = null;
         this._hammer.dispose();
         this._hammer = null;
         this._progress.dispose();
         this._progress = null;
         this.view = null;
         this.applyStart = null;
         this.applyAward = null;
         this.onGameOver = null;
         this.onAssistStatus = null;
         this._fristMC = null;
         this._fristCallback = null;
      }

      public function start() : void
      {
         this.reset();
         this._assistRunMode = "manual";
         this._assistActive = false;
         this._assistTargetHits = 0;
         this._isStart = true;
         this._isGameOver = false;
         this.view["btn_start"].visible = false;
         this.view["mc_gameOver"].visible = false;
         this.view["mc_blackRect"].visible = false;
         this._cylinderContainer.visible = true;
         this._gameOverEff.visible = false;
         this._fristMC.visible = false;
         this._round = 0;
         this.startRound();
      }

      private function startRound() : void
      {
         this.reset();
         ++this._round;
         this._hammer.enabled = true;
         this._isStart = true;
         this._isGameOver = false;
         this._timestamp = getTimer();
         this._hitCount = 0;
         this.view.addEventListener(Event.ENTER_FRAME,this.onLoop);
      }

      public function stop() : void
      {
         this.finishAssist("interrupted");
         this._isStart = false;
         this._isGameOver = false;
         this._hammer.enabled = false;
         this.view.removeEventListener(Event.ENTER_FRAME,this.onLoop);
      }

      public function reset() : void
      {
         var _loc2_:CylinderView = null;
         this._time = 0;
         this._timestamp = 0;
         this._hitCount = 0;
         this._hammer.enabled = false;
         this.view.removeEventListener(Event.ENTER_FRAME,this.onLoop);
         this._progress.reset();
         var _loc1_:int = 0;
         while(_loc1_ < this._cylinders.length)
         {
            _loc2_ = this._cylinders[_loc1_];
            _loc2_.floor = _loc1_ + 1;
            if(_loc1_ > 0)
            {
               _loc2_.bottomCylinder = this._cylinders[_loc1_ - 1];
               this._cylinders[_loc1_ - 1].topCylinder = _loc2_;
            }
            this._cylinderContainer.addChild(_loc2_.view);
            _loc2_.reset();
            _loc2_.view.x = 0;
            _loc2_.view.y = -10 + _loc1_ * -31;
            _loc1_++;
         }
         this.resetLight();
         this.resetEffect();
         this._cylinderContainer.visible = true;
         this._gameOverEff.visible = false;
      }

      protected function onLoop(param1:Event) : void
      {
         var _loc2_:Number = getTimer();
         var _loc3_:Number = _loc2_ - this._timestamp;
         this._timestamp = _loc2_;
         this._time += _loc3_;
         this._direction = this._hammer.localPoint.x < this.view["container_cylinder"].x ? 1 : -1;
         this._progress.render(_loc2_,_loc3_,this._time);
         this.updateCylinders(_loc3_);
         this.updateLight();
         this.runAssistFrame();
         var _loc4_:int = 0;
         var _loc5_:* = int(this._cylinders.length - 1);
         while(_loc5_ >= 1)
         {
            if(Boolean(this._cylinders[_loc5_]) && Boolean(this._cylinders[_loc5_].bottomCylinder) && this._cylinders[_loc5_].bottomCylinder.floor != 0)
            {
               _loc4_ += this._cylinders[_loc5_].view.x - this._cylinders[_loc5_].bottomCylinder.view.x;
               if(Math.abs(_loc4_) > this._radius)
               {
                  this.roundEnd(-1);
                  break;
               }
            }
            _loc5_--;
         }
         if(this._hitCount >= 6)
         {
            this.roundEnd();
         }
      }

      private function updateCylinders(param1:Number) : void
      {
         var _loc2_:int = 0;
         while(_loc2_ < this._cylinders.length)
         {
            this._cylinders[_loc2_].selected = false;
            this._cylinders[_loc2_].render(param1);
            _loc2_++;
         }
         _loc2_ = 0;
         while(_loc2_ < this._cylinders.length)
         {
            if(this._cylinders[_loc2_].floor != 0 && this._cylinders[_loc2_].hitTest(this._hammer.globalPoint) && this._cylinders[_loc2_].floor != 7)
            {
               this._cylinders[_loc2_].selected = true;
               this.view["mc_whiteLight"].visible = true;
               this.view["mc_whiteLight"].y = this._cylinders[_loc2_].view.y + this.view["container_cylinder"].y;
               break;
            }
            _loc2_++;
         }
      }

      private function roundEnd(param1:int = 0) : void
      {
         if(this._round + 1 > this._roundMax)
         {
            if(!this._isGameOver)
            {
               this.gameOver(param1);
            }
            return;
         }
         this.startRound();
      }

      protected function onProgressEnd() : void
      {
         this.roundEnd();
      }

      protected function onClickStart(param1:MouseEvent) : void
      {
         if(this.applyStart != null)
         {
            this.applyStart();
         }
      }

      protected function gameOver(param1:int = 0) : void
      {
         var onPlayEnd:Function = null;
         var cyl:CylinderView = null;
         var value:int = param1;
         onPlayEnd = function():void
         {
            _gameOverEff.removeEventListener("PLAY_END",onPlayEnd);
            _gameOverEff.stop();
            view["mc_gameOver"].visible = true;
            view["btn_start"].visible = true;
            view["mc_blackRect"].visible = true;
            if(onGameOver != null)
            {
               onGameOver();
            }
         };
         this._isGameOver = true;
         this.finishAssist(this._hitCount >= 6 ? "round-complete" : "game-over");
         this._hammer.enabled = false;
         this._progress.stop();
         this.resetLight();
         if(value == -1)
         {
            cyl = this._cylinders[this._cylinders.length - 1];
            this._gameOverEff.x = cyl.view.x + this._cylinderContainer.x;
            this._gameOverEff.visible = true;
            this._gameOverEff.gotoAndPlay(2);
            this._gameOverEff.addEventListener("PLAY_END",onPlayEnd);
            this._cylinderContainer.visible = false;
         }
         else
         {
            this.view["mc_gameOver"].visible = true;
            this.view["btn_start"].visible = true;
            this.view["mc_blackRect"].visible = true;
            if(this.onGameOver != null)
            {
               this.onGameOver();
            }
         }
      }

      public function get isStart() : Boolean
      {
         return this._isStart;
      }

      private function initCylinder() : void
      {
         var _loc3_:CylinderView = null;
         var _loc1_:Array = [CylinderView.BLACK,CylinderView.YELLOW,CylinderView.ORANGE,CylinderView.RED,CylinderView.BLACK,CylinderView.YELLOW,CylinderView.FACE];
         var _loc2_:int = 0;
         while(_loc2_ < _loc1_.length)
         {
            _loc3_ = new CylinderView(_loc1_[_loc2_]);
            _loc3_.floor = _loc2_ + 1;
            this._cylinders.push(_loc3_);
            if(_loc2_ > 0)
            {
               _loc3_.bottomCylinder = this._cylinders[_loc2_ - 1];
               this._cylinders[_loc2_ - 1].topCylinder = _loc3_;
            }
            this._cylinderContainer.addChild(_loc3_.view);
            _loc3_.view.x = 0;
            _loc3_.view.y = -10 + _loc2_ * -31;
            _loc2_++;
         }
      }

      private function initMouse() : void
      {
         this._hammer = new HammerView(this.view);
         this._hammer.onHit = this.onHammerHit;
      }

      protected function onHammerHit(param1:Point) : void
      {
         var _loc4_:CylinderView = null;
         var _loc5_:CylinderView = null;
         var _loc2_:int = this._progress.getScore();
         if(_loc2_ == -1)
         {
            return;
         }
         this._curHitCyl = null;
         var _loc3_:int = 0;
         while(_loc3_ < this._cylinders.length)
         {
            if(this._cylinders[_loc3_].floor != 0 && this._cylinders[_loc3_].hitTest(param1) && this._cylinders[_loc3_].floor != 7)
            {
               this._curHitCyl = this._cylinders[_loc3_];
               break;
            }
            _loc3_++;
         }
         if(this._curHitCyl)
         {
            if(this._progress.isPerfect())
            {
               ++this._hitCount;
               this._curHitCyl.floor = 0;
               this._curHitCyl.selected = false;
               this._curHitCyl.direction = this._direction;
               this._curHitCyl.targetX += 400 * this._direction;
               this._curHitCyl.speedX = 50;
               _loc4_ = this._curHitCyl.bottomCylinder;
               _loc5_ = this._curHitCyl.topCylinder;
               if(Boolean(_loc4_) && Boolean(_loc5_))
               {
                  _loc4_.topCylinder = _loc5_;
                  _loc5_.bottomCylinder = _loc4_;
               }
               else if(_loc4_ == null && Boolean(_loc5_))
               {
                  _loc5_.bottomCylinder = null;
               }
               this._curHitCyl.topCylinder = this._curHitCyl.bottomCylinder = null;
               if(this.applyAward != null)
               {
                  this.applyAward();
               }
               this.showEffect(4,this._direction);
               this._progress.small();
            }
            else
            {
               this.moveAllTop(_loc2_,this._curHitCyl,0,this._direction);
               if(this._curHitCyl.bottomCylinder)
               {
                  this.moveAllBottom(_loc2_,this._curHitCyl.bottomCylinder,1,this._direction);
               }
            }
            this.showHitLight();
            this._progress.playEff();
            this._progress.shift();
         }
      }

      private function moveAllBottom(param1:int, param2:CylinderView, param3:int, param4:int) : void
      {
         var _loc5_:Number = param1 / 100 * this._radius * Math.pow(0.4,param3);
         param2.targetX += _loc5_ * param4 + param2.view.x;
         param2.speedX = 10;
         param2.direction = param4;
         if(param2.bottomCylinder == null)
         {
            return;
         }
         this.moveAllBottom(param1,param2.bottomCylinder,param3 + 1,param4);
      }

      private function moveAllTop(param1:int, param2:CylinderView, param3:int, param4:int) : void
      {
         var _loc5_:Number = param1 / 100 * this._radius * Math.pow(0.4,param3);
         param2.targetX += _loc5_ * param4 + param2.view.x;
         param2.speedX = 10;
         param2.direction = param4;
         if(param2.topCylinder == null)
         {
            return;
         }
         this.moveAllTop(param1,param2.topCylinder,param3 + 1,param4);
      }

      private function resetLight() : void
      {
         var _loc1_:int = 0;
         while(_loc1_ < 6)
         {
            this.view["mc_yellowLight" + _loc1_].mouseChildren = this.view["mc_yellowLight" + _loc1_].mouseEnabled = false;
            this.view["mc_yellowLight" + _loc1_].visible = false;
            _loc1_++;
         }
         this.view["mc_whiteLight"].mouseChildren = this.view["mc_whiteLight"].mouseEnabled = false;
         this.view["mc_whiteLight"].visible = false;
         this.view["mc_hitLight"].mouseChildren = this.view["mc_hitLight"].mouseEnabled = false;
         this.view["mc_hitLight"].visible = false;
      }

      private function updateLight() : void
      {
         var _loc2_:CylinderView = null;
         var _loc1_:int = 0;
         while(_loc1_ < 6)
         {
            _loc2_ = this._cylinders[_loc1_];
            if(_loc2_.floor == 0)
            {
               this.view["mc_yellowLight" + _loc1_].visible = false;
            }
            else
            {
               this.view["mc_yellowLight" + _loc1_].visible = true;
               this.view["mc_yellowLight" + _loc1_].y = _loc2_.view.y + this.view["container_cylinder"].y;
            }
            _loc1_++;
         }
      }

      private function showHitLight() : void
      {
         var onHitLightEnd:Function = null;
         if(this._curHitCyl)
         {
            onHitLightEnd = function(param1:Event):void
            {
               if(view == null)
               {
                  return;
               }
               view["mc_hitLight"].removeEventListener("PLAY_END",onHitLightEnd);
               view["mc_hitLight"].visible = false;
            };
            this.view["mc_hitLight"].visible = true;
            this.view["mc_hitLight"].y = this._curHitCyl.view.y + this.view["container_cylinder"].y;
            this.view["mc_hitLight"].scaleX = this._curHitCyl.direction;
            this.view["mc_hitLight"].addEventListener("PLAY_END",onHitLightEnd);
            this.view["mc_hitLight"].gotoAndPlay(2);
         }
      }

      private function resetEffect() : void
      {
         this.view["mc_effect"].mouseChildren = this.view["mc_effect"].mouseEnabled = false;
         this.view["mc_effect"].visible = false;
         this.view["mc_effect"].gotoAndStop(1);
      }

      private function showEffect(param1:int, param2:int) : void
      {
         var onPlayEnd:Function = null;
         var appraisal:int = param1;
         var direction:int = param2;
         onPlayEnd = function(param1:Event):void
         {
            if(view == null)
            {
               return;
            }
            view["mc_effect"].removeEventListener("PLAY_END",onPlayEnd);
            view["mc_effect"].visible = false;
         };
         if(appraisal == 0 || direction == 0)
         {
            return;
         }
         this.view["mc_effect"].visible = true;
         this.view["mc_effect"].x = direction == 1 ? 482 : 153;
         this.view["mc_effect"].addEventListener("PLAY_END",onPlayEnd);
         this.view["mc_effect"].gotoAndPlay("clip" + appraisal);
      }

      public function frist(param1:Function) : void
      {
         this._fristCallback = param1;
         this._fristMC.visible = true;
         this._fristMC.addEventListener(MouseEvent.CLICK,this.onClickFrist);
         this.view["btn_start"].visible = false;
      }

      protected function onClickFrist(param1:MouseEvent) : void
      {
         this._fristMC.removeEventListener(MouseEvent.CLICK,this.onClickFrist);
         this._fristMC.visible = false;
         if(this._fristCallback != null)
         {
            this._fristCallback();
         }
      }
   }
}
