package com.tencent.morefun.naruto.plugin.npc.views {
  import fixture.NativeBox;
  import fixture.TaskMenuContent;
  public class TaskNpcDialog extends NativeBox {
    public var taskNpcCfg:Object;

    public function TaskNpcDialog(listId:int) {
      super("taskNpcDialog", new TaskMenuContent());
      taskNpcCfg = {listId: listId};
    }
  }
}
