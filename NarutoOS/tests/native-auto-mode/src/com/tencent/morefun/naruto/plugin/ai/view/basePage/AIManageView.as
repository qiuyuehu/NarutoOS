package com.tencent.morefun.naruto.plugin.ai.view.basePage {
    import fixture.Box;
    import ui.ai.AIManageUI;
    public class AIManageView extends Box {
        public var content:AIManageUI=new AIManageUI();
        public function AIManageView() { name="AIManageView"; addChild(content); }
    }
}
