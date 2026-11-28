package narutoos.daily
{
    import flash.display.Sprite;
    import base.ApplicationData;
    import com.tencent.morefun.naruto.plugin.ui.box.BoxManager;
    import idol.command.OpenIdolCommand;
    import com.tencent.morefun.framework.apf.core.facade.Facade;
    import def.PluginDef;
    import dungeon.def.DungeonTypeDef;
    import com.tencent.morefun.naruto.plugin.idol.view.TabbarMedia;
    import com.tencent.morefun.naruto.plugin.idol.model.IdolModel;

    public final class NativeAdapterProbe
    {
        public static function coldStart(owner:Sprite):Object
        {
            OpenIdolCommand.calls = 0;
            ApplicationData.singleton = new ApplicationData();
            BoxManager.reset();
            var forceLink:Array = [Facade, PluginDef, DungeonTypeDef, TabbarMedia, IdolModel];
            var adapter:NativeInfiniteIllusion = new NativeInfiniteIllusion(owner);
            adapter.begin();
            var state:Object = adapter.snapshot();
            adapter.dispose();
            return {trusteeshipping:state.trusteeshipping, panel:state.panel,
                openCalls:OpenIdolCommand.calls, aiModel:ApplicationData.singleton.getModel("ai.IAIPlugin")};
        }
    }
}
