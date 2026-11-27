package base {
  public class ApplicationData {
    public static const singleton:ApplicationData = new ApplicationData();
    public var teamMember:Boolean;
    public var teamIsJoined:Boolean;
    public var teamMembers:Array=[];
    public var teamModelMissing:Boolean;
    public var teamMembersUnknown:Boolean;
    public var stopAICalls:int=0;
    public var stoppedAIType:String;
    public var isFightLock:Boolean=false;
    public var globelInfo:Object={sceneId:1,sceneToId:1};
    public var selfInfo:Object={state:{getFlagByName:function(name:String):Boolean{return true;}}};
    public var rows:Array=[{state:0}];
    public var battle:Object={isFighting:false,type:1};
    public var task:Object={wantedRemainderNum:2,wantedTotalNum:2,getTaskInfosByType:function(type:int):Array{return ApplicationData.singleton.rows;}};

    public function ApplicationData() {}
    public function getModel(type:String):Object {
      if(type=="task") return task; if(type=="battleStart") return battle; if(type=="player.PlayerModel") return {otherPlayersBodyVisible:false};
      if(type != "team") return null;
      if(teamModelMissing) return null;
      if(teamMembersUnknown) return {isMember:false,isJoined:true,members:null};
      return {isMember:teamMember,isJoined:teamIsJoined,members:teamMembers};
    }
  }
}
