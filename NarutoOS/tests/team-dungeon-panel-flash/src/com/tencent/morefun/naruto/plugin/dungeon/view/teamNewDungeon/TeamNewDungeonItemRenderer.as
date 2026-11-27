package com.tencent.morefun.naruto.plugin.dungeon.view.teamNewDungeon
{
    import flash.display.MovieClip;
    import flash.display.Sprite;
    import flash.events.MouseEvent;
    import com.tencent.morefun.naruto.plugin.ui.base.BaseButton;

    public final class TeamNewDungeonItemRenderer extends Sprite
    {
        public var data:Object;
        public var skin:Object;
        public var nextClicks:int;
        private var nextButton:BaseButton;

        public function TeamNewDungeonItemRenderer(data:Object)
        {
            this.data = data;
            skin = new TeamNewDungeonItemSkin();
            skin.selector.difficulty.gotoAndStop(int(data.curDifficulty));
            addChild(skin as Sprite);
            nextButton = new BaseButton(new MovieClip());
            nextButton.skin.name = "rightBtnMc";
            skin.selector.addChild(nextButton);
            addEventListener(MouseEvent.CLICK, onClick);
        }

        private function onClick(event:MouseEvent):void
        {
            if (event.target === nextButton)
            {
                ++nextClicks;
                skin.selector.difficulty.gotoAndStop(Math.min(3, skin.selector.difficulty.currentFrame + 1));
            }
        }
    }
}

import flash.display.MovieClip;
import flash.display.Sprite;

internal final class TeamNewDungeonItemSkin extends Sprite
{
    public var selector:TeamNewDungeonSelector = new TeamNewDungeonSelector();
    public var picBtn:Sprite = new Sprite();
    public function TeamNewDungeonItemSkin()
    {
        selector.difficulty.gotoAndStop(1);
        addChild(selector);
        addChild(picBtn);
    }
}

internal final class TeamNewDungeonSelector extends Sprite
{
    public var difficulty:MovieClip = new TeamDungeonDifficultyClip();
    public function TeamNewDungeonSelector()
    {
        addChild(difficulty);
    }
}

internal final class TeamDungeonDifficultyClip extends MovieClip
{
    private var frame:int = 1;
    public function TeamDungeonDifficultyClip() { super(); }
    override public function get currentFrame():int { return frame; }
    override public function get totalFrames():int { return 3; }
    override public function gotoAndStop(frame:Object, scene:String = null):void
    {
        this.frame = Math.max(1, Math.min(3, int(frame)));
    }
}
