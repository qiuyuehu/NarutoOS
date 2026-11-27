package narutoos.daily
{
    import flash.display.DisplayObject;
    import flash.display.DisplayObjectContainer;
    import flash.display.InteractiveObject;
    import flash.display.Sprite;
    import flash.events.Event;
    import flash.events.MouseEvent;
    import flash.utils.getDefinitionByName;
    import flash.utils.getQualifiedClassName;

    /** Read-only adapter for the native escort UI; actions are exposed as native controls. */
    public final class EscortNativePanel
    {
        private static const PANEL:String =
            "com.tencent.morefun.naruto.plugin.task.views.escort::EscortTaskPanel";
        private static const ITEM:String =
            "com.tencent.morefun.naruto.plugin.task.views.escort::EscortTaskItemRenderer";
        private static const SUPPORT:String =
            "com.tencent.morefun.naruto.plugin.task.views.escort::EscortTaskSupportPanel";
        private static const NPC_DIALOG:String = "com.tencent.morefun.naruto.plugin.npc.views::TaskNpcDialog";
        private static const GRID:String = "com.tencent.morefun.naruto.plugin.ui.base::DirectionGrid";
        private static const TASK_TYPE:String = "task.defs.TaskTypeDef";
        private static const TASK_STATE:String = "task.defs.TaskStateDef";
        private static const MODEL_DEF:String = "def.ModelDef";
        private static const HUD_UTILS:String = "hud.utils.HudUtils";
        private static const HUD_TYPE:String = "serverProto.hud.ProtoHudType";
        private static const S_HARD:int = 4;
        private static const SS_HARD:int = 5;

        private var owner:Sprite;
        private var grade:int;
        private var gradeLabel:String;
        private var model:Object;
        private var listResponseAtOpen:int = -1;
        private var countRevisionAtOpen:int = -1;
        private var listRevision:int;
        private var escortCountRevision:int;
        private var refreshPending:Boolean;
        private var listRevisionAtRefresh:int;
        private var countRevisionAtRefresh:int;
        private var lastMessage:String;
        private var lastAcceptedId:int;
        private var entry:EscortEntry;
        private var closingPanel:DisplayObject;

        public function EscortNativePanel(owner:Sprite, grade:int = SS_HARD)
        {
            if (grade != S_HARD && grade != SS_HARD) throw new ArgumentError("无法识别押镖等级。");
            this.owner = owner;
            this.grade = grade;
            gradeLabel = grade == S_HARD ? "S 级" : "SS 级";
            model = taskModel();
            entry = new EscortEntry(owner);
            if (model != null && "addEventListener" in model)
                model.addEventListener("update", modelUpdated);
        }

        /** Follows the same native command and level gate as opening the panel in-game. */
        public function open():void
        {
            lastMessage = null;
            var reason:String = unavailableReason();
            if (reason != null)
            {
                lastMessage = reason;
                return;
            }
            try
            {
                model = taskModel();
                if (model == null || !("respondedCount" in model))
                    throw new Error("无法读取押镖任务模型。");
                listResponseAtOpen = int(model.respondedCount);
                countRevisionAtOpen = escortCountRevision;
                refreshPending = false;
                if (entry == null) throw new Error("当前客户端缺少押镖原生入口。");
                entry.open();
            }
            catch (error:Error)
            {
                lastMessage = "无法打开押镖面板。" + error.message;
                throw error;
            }
        }

        /** Returns the top native dialog state without changing the game UI. */
        public function view():String
        {
            // Native BoxManager drops a closing window from showingList before its tween ends.
            if (closingPanel != null)
            {
                if (closingPanel.stage != null) return "wait";
                closingPanel = null;
            }
            var box:Object = topBox();
            if (box == null) return boxesReady() ? "clear" : "wait";
            var name:String = getQualifiedClassName(box);
            if (name == PANEL) return "list";
            if (name == SUPPORT) return "support";
            if (name == NPC_DIALOG) return "other";
            return "other";
        }

        /** Advances only the NPC/menu entry adapter using the task's polling cadence. */
        public function stepEntry(opening:Boolean):void
        {
            if (entry != null) entry.step(topBox(), opening);
        }

        /**
         * Inspects the visible native task cards. The returned button is the game's own
         * control; callers decide whether and when to dispatch its normal click event.
         */
        public function offer():Object
        {
            var state:String = view();
            if (state == "wait") return offerResult("wait", 0, null, freeAcceptLeft(), refreshRemainder(), "等待押镖面板状态。");
            if (state != "list") return offerResult("wait", 0, null, freeAcceptLeft(), refreshRemainder(), "等待押镖列表位于最上层。");
            if (lastMessage != null) return offerResult("blocked", 0, null, freeAcceptLeft(), refreshRemainder(), lastMessage);
            if (!hasFreshList() || escortCountRevision <= countRevisionAtOpen)
                return offerResult("wait", 0, null, freeAcceptLeft(), refreshRemainder(), "等待本次押镖列表和余量加载。");

            var accepts:int = freeAcceptLeft();
            var refreshLeft:int = refreshRemainder();
            var dailyLeft:int = dailyRemainder();
            if (accepts < 0 || refreshLeft < 0 || dailyLeft < 0)
                return offerResult("wait", 0, null, accepts, refreshLeft, "等待押镖余量读取。");
            if (refreshPending)
            {
                if (listRevision <= listRevisionAtRefresh || escortCountRevision <= countRevisionAtRefresh)
                    return offerResult("wait", 0, null, accepts, refreshLeft, "等待免费刷新后的任务列表和次数更新。");
                refreshPending = false;
                // The renderer list can lag the model event by a frame; re-inspect next tick.
                return offerResult("wait", 0, null, accepts, refreshLeft, "免费刷新结果已更新，等待列表重绘。");
            }
            if (dailyLeft == 0)
                return offerResult("complete", 0, null, accepts, refreshLeft, "今日押镖完成次数已用完。");
            if (accepts == 0)
                return offerResult("complete", 0, null, accepts, refreshLeft, "免费接取 SS 级任务次数已用完。");

            var panel:DisplayObject = topBox() as DisplayObject;
            var renderers:Array = [];
            collectByClass(panel, ITEM, renderers);
            var visibleFreeCard:Boolean;
            for each (var renderer:Object in renderers)
            {
                if (!visibleOnPanel(renderer as DisplayObject, panel)) continue;
                var info:Object = renderer.data;
                if (!isFreeOfferCard(info)) continue;
                visibleFreeCard = true;
                var button:InteractiveObject = namedControl(renderer as DisplayObject, "receiveBtn");
                if (clickable(button, panel))
                    return offerResult("accept", int(info.id), button, accepts, refreshLeft, null);
            }

            var cards:Array = sourceCards(panel);
            if (cards == null) return offerResult("wait", 0, null, accepts, refreshLeft, "等待押镖卡片数据加载。");
            for (var sourceIndex:int = 0; sourceIndex < cards.length; sourceIndex++)
            {
                var card:Object = cards[sourceIndex];
                if (!isFreeOfferCard(card)) continue;
                scrollCardIntoView(panel, sourceIndex);
                return offerResult("wait", 0, null, accepts, refreshLeft, "正在定位 " + gradeLabel + "押镖卡片。");
            }

            if (refreshLeft > 0)
            {
                var refresh:InteractiveObject = namedControl(panel, "freeRefreshBtn");
                if (clickable(refresh, panel))
                {
                    return offerResult("refresh", 0, refresh, accepts, refreshLeft, null);
                }
                return offerResult("wait", 0, null, accepts, refreshLeft, "等待免费刷新控件可用。");
            }
            if (visibleFreeCard)
                return offerResult("wait", 0, null, accepts, refreshLeft, "等待 " + gradeLabel + "接取控件可用。");
            return offerResult("blocked", 0, null, accepts, refreshLeft,
                "免费刷新次数已用完，当前没有可免费接取的 " + gradeLabel + "任务。");
        }

        /** Revalidates a displayed offer, then dispatches the native button's normal CLICK. */
        public function clickOffer(offer:Object):void
        {
            if (offer == null || (offer.kind != "accept" && offer.kind != "refresh") ||
                !(offer.button is InteractiveObject))
                throw new Error("押镖操作已变化，请重新读取面板。");
            var current:Object = this.offer();
            if (current.kind != offer.kind || current.id != offer.id || current.button !== offer.button ||
                !clickable(offer.button as InteractiveObject, topBox() as DisplayObject))
                throw new Error("押镖按钮已变化，请重新读取面板。");
            if (offer.kind == "refresh")
            {
                refreshPending = true;
                listRevisionAtRefresh = listRevision;
                countRevisionAtRefresh = escortCountRevision;
            }
            else
            {
                lastAcceptedId = int(offer.id);
            }
            offer.button.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true, false));
        }

        /** Returns the native route button for the currently accepted escort task. */
        public function dispatchButton(id:int, heldGrade:int = 0):InteractiveObject
        {
            if (heldGrade == 0) heldGrade = grade;
            if (id <= 0 || (heldGrade != S_HARD && heldGrade != SS_HARD)) return null;
            var state:String = view();
            var root:DisplayObject = topBox() as DisplayObject;
            if (root == null) return null;
            if (state == "support")
            {
                if ((lastAcceptedId != 0 && id != lastAcceptedId) || !isUniqueReceivedEscort(id, heldGrade)) return null;
                var go:InteractiveObject = namedControl(root, "goBtn");
                return clickable(go, root) ? go : null;
            }
            if (state != "list") return null;
            var renderers:Array = [];
            collectByClass(root, ITEM, renderers);
            var renderer:Object;
            var info:Object;
            for each (renderer in renderers)
            {
                if (!visibleOnPanel(renderer as DisplayObject, root)) continue;
                info = renderer.data;
                if (!hasGrade(info, heldGrade) || int(info.id) != id ||
                    (int(info.state) != receivedState() && int(info.state) != commitAbleState())) continue;
                if (int(info.state) == commitAbleState())
                {
                    var done:InteractiveObject = namedControl(renderer as DisplayObject, "doneBtn");
                    return clickable(done, root) ? done : null;
                }
                if (id == lastAcceptedId && hasGuild()) return null;
                var goto:InteractiveObject = namedControl(renderer as DisplayObject, "gotoBtn");
                return clickable(goto, root) ? goto : null;
            }
            return null;
        }

        /** Reports the native escort level gate, if it can be verified. */
        public function unavailableReason():String
        {
            if (entry != null)
            {
                var entryReason:String = entry.unavailableReason();
                if (entryReason != null) return entryReason;
            }
            try
            {
                var hud:Object = getDefinitionByName(HUD_UTILS);
                var id:int = getDefinitionByName(HUD_TYPE).PROTO_HUD_TYPE_ESCORT_TASK;
                if (!hud.isHudOpened(id))
                {
                    var level:int = int(hud.hudOpenLevel(id));
                    return level > 0 ? "押镖任务" + level + "级才能领取。" : null;
                }
            }
            catch (error:Error) { }
            return null;
        }

        /** Closes only the native escort list, leaving any dialog above it untouched. */
        public function close():void
        {
            if (view() != "list") return;
            closingPanel = topBox() as DisplayObject;
            try { getDefinitionByName("com.tencent.morefun.naruto.plugin.ui.box::BoxManager").hideBoxByName("EscortTaskPanel"); }
            catch (error:Error) { }
        }

        /** Detaches the model observer; safe to call more than once. */
        public function cancel():void
        {
            if (model != null && "removeEventListener" in model)
                model.removeEventListener("update", modelUpdated);
            if (entry != null) entry.cancel();
            entry = null;
            model = null;
            owner = null;
            closingPanel = null;
            refreshPending = false;
        }

        private function modelUpdated(event:Event):void
        {
            var key:String = "key" in event ? String(event["key"]) : "";
            if (key == "taskInfos" || key == "taskInfoModify" || key == "taskInfoReceive" ||
                key == "taskInfoCommit" || key == "taskInfoGiveup" || key == "taskInfoRemove") listRevision++;
            else if (key == "escortNum") escortCountRevision++;
        }

        private function hasFreshList():Boolean
        {
            return model != null && "respondedCount" in model && int(model.respondedCount) > listResponseAtOpen;
        }

        private function taskModel():Object
        {
            var application:Object = getDefinitionByName("base.ApplicationData").singleton;
            return application.getModel(getDefinitionByName(MODEL_DEF).TASK);
        }

        private function isFreeOfferCard(info:Object):Boolean
        {
            // S must have a zero configured price. SS uses its own free-accept quota.
            return hasGrade(info, grade) && int(info.id) > 0 && int(info.state) == receiveAble() &&
                (grade == SS_HARD || info.cfg.receiveDeductYuanbao === 0);
        }

        private function hasGrade(info:Object, hard:int):Boolean
        {
            return info != null && int(info.type) == escortType() && info.cfg != null && int(info.cfg.hard) == hard;
        }

        private function isUniqueReceivedEscort(id:int, heldGrade:int):Boolean
        {
            if (model == null || !("getTaskInfosByType" in model)) return false;
            var tasks:Array = model.getTaskInfosByType(escortType()) as Array;
            if (tasks == null) return false;
            var found:Boolean;
            for each (var info:Object in tasks)
            {
                if (info == null || (int(info.state) != receivedState() && int(info.state) != commitAbleState())) continue;
                if (found || int(info.id) != id || !hasGrade(info, heldGrade)) return false;
                found = true;
            }
            return found;
        }

        private function sourceCards(panel:DisplayObject):Array
        {
            var grids:Array = [];
            collectByClass(panel, GRID, grids);
            if (grids.length != 1) return null;
            var grid:Object = grids[0];
            return "source" in grid ? grid.source as Array : null;
        }

        private function scrollCardIntoView(panel:DisplayObject, index:int):Boolean
        {
            var grids:Array = [];
            collectByClass(panel, GRID, grids);
            if (grids.length != 1) return false;
            var grid:Object = grids[0];
            if (!("verticalScrollValue" in grid) || !("maxVerScrollValue" in grid) ||
                !("cellHeight" in grid) || !("col" in grid) || !("row" in grid) || int(grid.col) <= 0) return false;
            var rowHeight:int = int(grid.cellHeight) + int(grid.vergap);
            if (rowHeight <= 0) return false;
            var firstIndex:int = int(int(grid.verticalScrollValue) / rowHeight) * int(grid.col);
            if (index >= firstIndex && index < firstIndex + int(grid.row) * int(grid.col)) return false;
            var target:int = int(index / int(grid.col)) * rowHeight;
            target = Math.max(0, Math.min(int(grid.maxVerScrollValue), target));
            if (int(grid.verticalScrollValue) == target) return false;
            grid.verticalScrollValue = target;
            return true;
        }

        private function hasGuild():Boolean
        {
            try { return Boolean(getDefinitionByName("guild.GuildUtils").hasGuild()); }
            catch (error:Error) { return false; }
            return false;
        }

        private function freeAcceptLeft():int
        {
            if (grade == S_HARD) return dailyRemainder();
            return model != null && "escortFreeAcceptRemainderNum" in model ? int(model.escortFreeAcceptRemainderNum) : -1;
        }

        private function refreshRemainder():int
        {
            return model != null && "escortRefreshNum" in model ? int(model.escortRefreshNum) : -1;
        }

        private function dailyRemainder():int
        {
            return model != null && "escortRemainderNum" in model ? int(model.escortRemainderNum) : -1;
        }

        private function escortType():int { return int(getDefinitionByName(TASK_TYPE).ESCORT); }
        private function receiveAble():int { return int(getDefinitionByName(TASK_STATE).RECEIVE_ABLE); }
        private function receivedState():int { return int(getDefinitionByName(TASK_STATE).RECEIVED); }
        private function commitAbleState():int { return int(getDefinitionByName(TASK_STATE).COMMIT_ABLE); }

        private function offerResult(kind:String, id:int, button:InteractiveObject,
                                     freeAcceptLeft:int, refreshLeft:Object, message:String):Object
        {
            return {kind:kind, id:id, button:button, canAcceptFree:kind == "accept", freeAcceptLeft:freeAcceptLeft,
                refreshLeft:refreshLeft, message:message};
        }

        private function topBox():Object
        {
            try
            {
                var boxes:Object = getDefinitionByName("com.tencent.morefun.naruto.plugin.ui.box::BoxManager");
                var list:Array = boxes.showingList as Array;
                if (list == null) return null;
                for (var i:int = list.length - 1; i >= 0; i--)
                {
                    var box:Object = list[i];
                    if (box == null || (owner != null && box.stage !== owner.stage) || !(box.isShowing || box.isShow)) continue;
                    if (box.modal || getQualifiedClassName(box) == NPC_DIALOG) return box;
                }
                return null;
            }
            catch (error:Error) { }
            return null;
        }

        private function boxesReady():Boolean
        {
            try { return getDefinitionByName("com.tencent.morefun.naruto.plugin.ui.box::BoxManager").showingList is Array; }
            catch (error:Error) { return false; }
            return false;
        }

        private function collectByClass(root:DisplayObject, className:String, output:Array):void
        {
            if (root == null) return;
            if (getQualifiedClassName(root) == className) output.push(root);
            var container:DisplayObjectContainer = root as DisplayObjectContainer;
            if (container == null) return;
            for (var i:int = 0; i < container.numChildren; i++) collectByClass(container.getChildAt(i), className, output);
        }

        private function namedControl(root:DisplayObject, field:String):InteractiveObject
        {
            if (root == null) return null;
            var dynamicRoot:Object = root;
            if (field in dynamicRoot && dynamicRoot[field] is InteractiveObject) return dynamicRoot[field] as InteractiveObject;
            var container:DisplayObjectContainer = root as DisplayObjectContainer;
            if (container != null)
            {
                for (var i:int = 0; i < container.numChildren; i++)
                {
                    var child:DisplayObject = container.getChildAt(i);
                    if (child.name == field && child is InteractiveObject) return child as InteractiveObject;
                    var found:InteractiveObject = namedControl(child, field);
                    if (found != null) return found;
                }
            }
            return null;
        }

        private function visibleOnPanel(display:DisplayObject, panel:DisplayObject):Boolean
        {
            if (display == null || display.stage == null || !display.visible) return false;
            var current:DisplayObject = display;
            while (current != null)
            {
                if (!current.visible) return false;
                if (current === panel) return true;
                current = current.parent;
            }
            return false;
        }

        private function clickable(button:InteractiveObject, panel:DisplayObject):Boolean
        {
            if (button == null || button.stage == null || !button.visible || !button.mouseEnabled || !visibleOnPanel(button, panel)) return false;
            var component:Object = button;
            if ("enabled" in component && !Boolean(component.enabled)) return false;
            if ("disabled" in component && Boolean(component.disabled)) return false;
            if ("disable" in component && Boolean(component.disable)) return false;
            return true;
        }
    }
}
