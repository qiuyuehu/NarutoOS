package com.tencent.morefun.naruto.plugin.task.views
{
    import flash.display.Sprite;
    import fixture.CommitButton;
    import task.datas.TaskInfo;

    public final class TaskCommitPanel extends Sprite
    {
        private var info:TaskInfo;
        public var content:Object;
        public var modal:Boolean = true;
        public var isShow:Boolean = true;
        public var isShowing:Boolean = true;
        public function TaskCommitPanel(info:TaskInfo)
        {
            this.info = info;
            var button:CommitButton = new CommitButton();
            button.addEventListener("click", function(event:*):void { clicked++; });
            addChild(button);
            content = {okBtn:button};
        }
        public var clicked:int;
        public function getTaskInfo():TaskInfo { return info; }
    }

}
