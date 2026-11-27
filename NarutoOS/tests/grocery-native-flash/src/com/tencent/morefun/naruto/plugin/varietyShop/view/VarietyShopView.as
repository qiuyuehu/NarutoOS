package com.tencent.morefun.naruto.plugin.varietyShop.view
{
    import com.tencent.morefun.naruto.plugin.ui.base.TabBar;
    import com.tencent.morefun.naruto.plugin.ui.box.BoxManager;
    import com.tencent.morefun.naruto.plugin.ui.components.layouts.EasyLayout;
    import fixture.Box;
    import flash.display.MovieClip;
    import flash.display.Sprite;

    public final class VarietyShopView extends Box
    {
        public const content:MovieClip = new MovieClip();
        public const tab:TabBar = new TabBar();
        public const layout:EasyLayout = new EasyLayout();

        public function VarietyShopView(index:int)
        {
            content.toolBar = new Sprite();
            content.list = new Sprite();
            content.toolBar.addChild(tab);
            content.list.addChild(layout);
            content.addChild(content.toolBar);
            content.addChild(content.list);
            addChild(content);
            tab.selectedIndex = index;
        }

        public function close():void
        {
            BoxManager.showingList.splice(BoxManager.showingList.indexOf(this), 1);
            parent.removeChild(this);
            isShow = false;
        }
    }
}
