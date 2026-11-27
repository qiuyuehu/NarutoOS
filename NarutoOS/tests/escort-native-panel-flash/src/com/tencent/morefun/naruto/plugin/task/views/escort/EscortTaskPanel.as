package com.tencent.morefun.naruto.plugin.task.views.escort
{
    import flash.display.Sprite;
    import flash.display.SimpleButton;
    import com.tencent.morefun.naruto.plugin.ui.base.DirectionGrid;
    public dynamic class EscortTaskPanel extends Sprite
    {
        public var modal:Boolean = true;
        public var isShowing:Boolean = true;
        public var isShow:Boolean = true;
        public var renderer:EscortTaskItemRenderer;
        public var grid:DirectionGrid = new DirectionGrid();
        public var refresh:SimpleButton = new SimpleButton();
        public function EscortTaskPanel()
        {
            refresh.name = "freeRefreshBtn";
            addChild(refresh);
            addChild(grid);
        }
    }
}
