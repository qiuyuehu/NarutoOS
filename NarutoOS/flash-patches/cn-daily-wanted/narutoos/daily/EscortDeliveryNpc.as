package narutoos.daily
{
    import flash.display.DisplayObjectContainer;
    import flash.display.InteractiveObject;
    import flash.events.MouseEvent;
    import flash.utils.getQualifiedClassName;

    /** Original task NPC menu and "complete task" button, tied to one delivery. */
    public final class EscortDeliveryNpc
    {
        public static const DIALOG:String = "com.tencent.morefun.naruto.plugin.npc.views::TaskNpcDialog";
        private static const ROW:String = "com.tencent.morefun.naruto.plugin.npc.views::TaskNpcDialogMenuRenderer";
        private static const COMPLETE_LABEL_CN:String = "完成任务";
        private static const COMPLETE_LABEL_BR:String = "Completar missão";
        private var selectedIn:Object;
        private var submitted:Boolean;

        public function EscortDeliveryNpc() {}

        public function get hasSubmitted():Boolean { return submitted; }

        public function step(top:Object, task:Object, model:Object, app:Object):Boolean
        {
            if (!top || getQualifiedClassName(top) != DIALOG || !top.isShow || !top.isShowing ||
                !top.visible || !task.cfg || !top.taskNpcCfg) return false;
            var scene:int = int(app.globelInfo.sceneId);
            var npc:int = int(top.taskNpcCfg.listId);
            if (scene <= 0 || npc <= 0 || scene != task.cfg.commitNpcSceneId || npc != task.cfg.commitNpcId) return false;
            if (submitted) return true;

            var button:InteractiveObject = top.content.yesBtn as InteractiveObject;
            if (button && button.visible && button.mouseEnabled &&
                (Object(button).label == COMPLETE_LABEL_CN || Object(button).label == COMPLETE_LABEL_BR))
            {
                var tasks:Array = model.getTaskInfosByNpc(scene, npc);
                if (selectedIn !== top && (!tasks || tasks.length != 1 || !sameOrder(tasks[0], task))) return true;
                if ("enabled" in button && !Object(button).enabled) return true;
                submitted = true;
                button.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true));
                return true;
            }
            if (selectedIn === top) return true;
            var row:InteractiveObject = menuRow(top, function(data:Object):Boolean {
                return data.type == "task" && sameOrder(data.data, task);
            });
            if (row)
            {
                selectedIn = top;
                row.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true));
            }
            return true;
        }

        private function sameOrder(candidate:Object, task:Object):Boolean
        {
            return candidate != null && candidate.id == task.id && candidate.type == task.type &&
                candidate.state == task.state && candidate.receiveTime == task.receiveTime;
        }

        public static function menuRow(top:Object, matches:Function):InteractiveObject
        {
            var menus:DisplayObjectContainer = top.content.menus as DisplayObjectContainer;
            if (!menus || !menus.visible) return null;
            var match:InteractiveObject;
            for (var i:int = 0; i < menus.numChildren; i++)
            {
                var list:DisplayObjectContainer = menus.getChildAt(i) as DisplayObjectContainer;
                if (!list || !list.visible) continue;
                for (var j:int = 0; j < list.numChildren; j++)
                {
                    var item:InteractiveObject = list.getChildAt(j) as InteractiveObject;
                    if (!item || !item.visible || !item.mouseEnabled || getQualifiedClassName(item) != ROW) continue;
                    if ("enabled" in item && !Object(item).enabled) continue;
                    var data:Object = Object(item).getData();
                    if (!data || !matches(data)) continue;
                    if (match) throw new Error("无法确定唯一的押镖任务菜单。");
                    match = item;
                }
            }
            return match;
        }
    }
}
