package fixture {
  import com.tencent.morefun.naruto.plugin.ai.commands.StopAICommand;
  public class AiPluginDomain {
    public function hasDefinition(name:String):Boolean {
      return name == "com.tencent.morefun.naruto.plugin.ai.commands.StopAICommand";
    }
    public function getDefinition(name:String):Class { return StopAICommand; }
  }
}
