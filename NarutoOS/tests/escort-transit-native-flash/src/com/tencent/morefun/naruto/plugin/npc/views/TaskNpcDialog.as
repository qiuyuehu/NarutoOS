package com.tencent.morefun.naruto.plugin.npc.views
{
    import flash.display.Sprite;
    import fixture.CompletionButton;

    public final class TaskNpcDialog extends Sprite
    {
        public var isShow:Boolean = true;
        public var isShowing:Boolean = true;
        public var taskNpcCfg:Object;
        public var content:Object;

        public function TaskNpcDialog(label:String)
        {
            content = {yesBtn:new CompletionButton(label)};
            addChild(content.yesBtn);
        }
    }
}
