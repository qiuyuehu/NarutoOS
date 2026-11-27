package fixture
{
    import com.tencent.morefun.framework.apf.core.facade.Facade;
    import com.tencent.morefun.naruto.plugin.ui.box.BoxManager;
    import com.tencent.morefun.naruto.util.GameTipAnim;
    import com.tencent.morefun.naruto.plugin.ui.layer.LayerManager;
    import flash.events.EventDispatcher;
    import flash.events.Event;
    import flash.display.DisplayObject;
    import flash.utils.getQualifiedClassName;
    import flash.utils.setTimeout;
    import flash.utils.clearTimeout;
    import base.ApplicationData;
    import base.StrongTestUserState;
    import serverProto.fight.FightStartType;
    import battle.command.RequestPveFightStartCommand;
    import com.tencent.morefun.naruto.plugin.befallDungeon.view.window.BefallDungeonAwardPanel;
    import com.tencent.morefun.naruto.plugin.befallDungeon.view.window.BefallDungeonScorePanel;
    import com.tencent.morefun.naruto.plugin.battle.view.StrongBattleLayer;
    import com.tencent.morefun.naruto.plugin.befallDungeon.command.BefallDungeonQueryCommand;
    import com.tencent.morefun.framework.base.CommandEvent;
    import befallDungeon.command.OpenBefallDungeonAwardCommand;
    import befallDungeon.command.OpenBefallDungeonScoreCommand;

    public final class StrongEnvironment
    {
        public static var boxEvents:EventDispatcher = BoxManager.dispathcer;
        public static var commands:EventDispatcher = Facade.getInstance().commandManager;
        public static var battle:StrongBattleState = ApplicationData.singleton.getModel("battleStart") as StrongBattleState;
        public static var box:Object;
        public static var target:Object;
        public static var emptyQuery:Boolean;
        public static var delayStartAck:Boolean;
        private static var scoreHideTimer:uint;

        public static function reset():void
        {
            if (scoreHideTimer != 0) clearTimeout(scoreHideTimer);
            scoreHideTimer = 0;
            if (target != null && target.stage != null)
            {
                var oldBattle:DisplayObject = target.stage.getChildByName("fightUI");
                if (oldBattle != null) target.stage.removeChild(oldBattle);
            }
            if (box != null && box.parent != null) box.parent.removeChild(box);
            box = null;
            BoxManager.current = null;
            battle.isFighting = false;
            battle.type = 0;
            ApplicationData.singleton.isFightLock = false;
            ApplicationData.singleton.selfInfo = {state:new StrongTestUserState()};
            emptyQuery = false;
            delayStartAck = false;
        }

        public static function startBattle():void
        {
            var command:Object = new RequestPveFightStartCommand(FightStartType.FIGHT_START_TYPE_BEFALL_DUNGEON);
            commands.dispatchEvent(new StrongEvent("commandRequest", command));
            commands.dispatchEvent(new StrongEvent("commandExecute", command));
            if (delayStartAck) return;
            acknowledgeBattleStart();
        }

        public static function acknowledgeBattleStart():void
        {
            battle.isFighting = true;
            battle.type = FightStartType.FIGHT_START_TYPE_BEFALL_DUNGEON;
            battle.dispatchEvent(new StrongEvent("update", null, null, "start"));
            closeBox();
        }

        public static function queryChallenge():void
        {
            var command:BefallDungeonQueryCommand = new BefallDungeonQueryCommand();
            if (emptyQuery) command.dungeons = [];
            target.record("query.request");
            commands.dispatchEvent(new StrongEvent("commandRequest", command));
            command.dispatchEvent(new Event(CommandEvent.FINISH));
            target.record("query.finish");
            if (emptyQuery) closeBox();
        }

        public static function showResult(kind:String):void
        {
            var layer:StrongBattleLayer = new StrongBattleLayer(kind);
            target.stage.addChild(layer);
        }

        public static function showClosedTip():void
        {
            LayerManager.singleton.findLayerByName("GameTip").addChild(new GameTipAnim("降临副本已关闭"));
        }

        public static function closeResultAndShowAwards():void
        {
            var layer:Object = target.stage.getChildByName("fightUI");
            if (layer != null) target.stage.removeChild(layer);
            battle.isFighting = false;
            var openAward:Object = new OpenBefallDungeonAwardCommand();
            commands.dispatchEvent(new StrongEvent("commandRequest", openAward));
            showBox(new BefallDungeonAwardPanel());
        }

        public static function closeAwardAndShowScore():void
        {
            closeBox();
            var openScore:Object = new OpenBefallDungeonScoreCommand();
            commands.dispatchEvent(new StrongEvent("commandRequest", openScore));
            showBox(new BefallDungeonScorePanel());
        }

        public static function closeScore():void { closeBox(); }
        public static function closeChallenge():void { closeBox(); }

        public static function beginScoreHide():void
        {
            target.record("score.hide.start");
            if (box != null) box.isShow = false;
            BoxManager.current = null;
            scoreHideTimer = setTimeout(finishScoreHide, 350);
        }

        private static function finishScoreHide():void
        {
            scoreHideTimer = 0;
            closeBox();
            target.record("score.boxHided");
        }

        private static function showBox(value:Object):void
        {
            target.record("box.show:" + getQualifiedClassName(value));
            box = value;
            BoxManager.current = value;
            target.addChild(value);
            boxEvents.dispatchEvent(new StrongEvent("boxShow", null, value));
            boxEvents.dispatchEvent(new StrongEvent("boxShowed", null, value));
        }

        private static function closeBox():void
        {
            var old:Object = box;
            boxEvents.dispatchEvent(new StrongEvent("boxHided", null, old));
            if (old != null && old.parent != null) old.parent.removeChild(old);
            box = null;
            BoxManager.current = null;
        }
    }
}
