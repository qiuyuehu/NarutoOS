package narutoos.daily
{
    import flash.display.DisplayObject;
    import flash.display.DisplayObjectContainer;
    import flash.display.InteractiveObject;
    import flash.display.MovieClip;
    import flash.events.Event;
    import flash.events.IEventDispatcher;
    import flash.events.MouseEvent;
    import flash.utils.getDefinitionByName;
    import flash.utils.getQualifiedClassName;

    /** Small UI-only adapter for the native CN team-dungeon panel. */
    public final class TeamDungeonPanel
    {
        private static const NATIVE_PANEL:String =
            "com.tencent.morefun.naruto.plugin.dungeon.view.teamNewDungeon::TeamNewDungeonPanel";
        private static const ITEM_RENDERER:String =
            "com.tencent.morefun.naruto.plugin.dungeon.view.teamNewDungeon::TeamNewDungeonItemRenderer";
        private static const ENTER_CONFIRM:String =
            "com.tencent.morefun.naruto.plugin.dungeon.view.teamNewDungeon::EnterConfirmWindow";
        private static const DIFFICULTY_TYPE:String = "serverProto.dungeon.ProtoNewTeamDifficultyType";
        private static const DUNGEON_STATE_TYPE:String = "serverProto.dungeon.ProtoNewTeamDungeonState";
        private static const NATIVE_BASE_BUTTON:String = "com.tencent.morefun.naruto.plugin.ui.base::BaseButton";
        private static const HARD_DIFFICULTY:int = 3;

        /** Construct the game's native open-panel command. The caller owns listeners and calls it. */
        public static function route():Object
        {
            var commandType:Class = getDefinitionByName("dungeon.command.OpenTeamDungeonPanelCommand") as Class;
            if (commandType == null)
            {
                throw new Error("当前客户端缺少组队副本原生入口命令。");
            }
            return new commandType();
        }

        /**
         * Selects a playable hard card from the currently visible native list.
         * It changes difficulty only through the native selector on the same visible renderer.
         * It never touches the match button.
         */
        public static function choose(box:Object):Object
        {
            var panel:DisplayObject = nativePanel(box);
            if (panel == null)
            {
                return result("wait", "等待组队副本列表打开。");
            }
            var renderers:Array = [];
            collectByClass(panel, ITEM_RENDERER, renderers);
            if (renderers.length == 0)
            {
                return result("wait", "等待副本卡片加载。");
            }

            var sawData:Boolean = false;
            var sawHardEntry:Boolean = false;
            var lockedReason:String;
            var current:Object;
            var infos:Array;
            var target:Object;
            var currentInfo:Object;
            var hardInfo:Object;
            var renderer:Object;
            var itemIndex:int;
            var difficultyClip:MovieClip;
            var nextButton:InteractiveObject;

            for each (renderer in renderers)
            {
                if (!visibleOnPanel(renderer as DisplayObject, panel))
                {
                    continue;
                }
                current = renderer.data;
                if (current == null || !(current.teamNewDungeonInfoAry is Array))
                {
                    continue;
                }
                sawData = true;
                infos = current.teamNewDungeonInfoAry as Array;

                // A native recommendation is a single-difficulty card; use it only when it is
                // already recommending hard. Do not switch its identity or search another tab.
                if (current.isCommandData)
                {
                    if (int(current.curDifficulty) != HARD_DIFFICULTY || infos.length < HARD_DIFFICULTY)
                    {
                        continue;
                    }
                    hardInfo = infos[HARD_DIFFICULTY - 1];
                    if (hardInfo == null || int(hardInfo.difficultyType) != HARD_DIFFICULTY)
                    {
                        continue;
                    }
                    difficultyClip = difficultyControl(renderer as DisplayObject);
                    if (difficultyClip == null || difficultyClip.currentFrame != HARD_DIFFICULTY)
                    {
                        continue;
                    }
                    sawHardEntry = true;
                    if (isLocked(hardInfo))
                    {
                        lockedReason = lockedReason || lockReason(hardInfo);
                        continue;
                    }
                    if (!isPlayable(hardInfo))
                    {
                        continue;
                    }
                    var recommendedButton:InteractiveObject = cardButton(renderer as DisplayObject);
                    if (clickable(recommendedButton, panel))
                    {
                        return ready(recommendedButton, int(hardInfo.dungeonId));
                    }
                    continue;
                }

                if (infos.length < HARD_DIFFICULTY)
                {
                    continue;
                }
                hardInfo = infos[HARD_DIFFICULTY - 1];
                if (hardInfo == null || int(hardInfo.difficultyType) != HARD_DIFFICULTY)
                {
                    continue;
                }
                sawHardEntry = true;
                if (isLocked(hardInfo))
                {
                    lockedReason = lockedReason || lockReason(hardInfo);
                    continue;
                }
                if (!isPlayable(hardInfo))
                {
                    continue;
                }

                currentInfo = currentInfoFor(renderer, current);
                if (currentInfo == null)
                {
                    continue;
                }

                difficultyClip = difficultyControl(renderer as DisplayObject);
                if (difficultyClip == null)
                {
                    continue;
                }
                itemIndex = 0;
                while (difficultyClip.currentFrame < HARD_DIFFICULTY && itemIndex < HARD_DIFFICULTY)
                {
                    nextButton = nextDifficultyButton(renderer as DisplayObject);
                    if (!clickable(nextButton, panel) || buttonDisabled(nextButton))
                    {
                        break;
                    }
                    click(nextButton);
                    itemIndex++;
                }
                if (difficultyClip.currentFrame != HARD_DIFFICULTY)
                {
                    continue;
                }

                // The native renderer updates its selected Proto info in the same click handler.
                // Re-read its state before returning the launch control to the caller.
                currentInfo = currentInfoFor(renderer, current);
                if (currentInfo == null || int(currentInfo.difficultyType) != HARD_DIFFICULTY ||
                    currentInfo !== hardInfo || !isPlayable(currentInfo))
                {
                    continue;
                }
                target = cardButton(renderer as DisplayObject);
                if (clickable(target as InteractiveObject, panel))
                {
                    return ready(target as InteractiveObject, int(hardInfo.dungeonId));
                }
            }

            if (!sawData)
            {
                return result("wait", "等待副本数据加载。");
            }
            var fullListSwitch:Object = switchToAllAndWait(panel);
            if (fullListSwitch != null) return fullListSwitch;
            if (lockedReason != null)
            {
                return result("blocked", lockedReason);
            }
            if (sawHardEntry)
            {
                return result("unknown", "困难副本卡仍无法确认，请保持当前页面后重试。");
            }
            return result("unknown", "当前可见推荐卡没有可确认的困难档。");
        }

        /** Returns only the native solo-confirm button; the caller decides when to click it. */
        public static function confirmButton(box:Object):InteractiveObject
        {
            var dialog:DisplayObject = findClass(box as DisplayObject, ENTER_CONFIRM);
            if (dialog == null)
            {
                return null;
            }
            var button:InteractiveObject = findNamed(dialog, "confirmBtn") as InteractiveObject;
            return clickable(button, dialog) ? button : null;
        }

        private static function nativePanel(root:Object):DisplayObject
        {
            var rootDisplay:DisplayObject = root as DisplayObject;
            if (rootDisplay == null && root != null && "content" in root)
            {
                rootDisplay = root.content as DisplayObject;
            }
            if (rootDisplay == null)
            {
                return null;
            }
            if (getQualifiedClassName(rootDisplay) == NATIVE_PANEL)
            {
                return rootDisplay;
            }
            return findClass(rootDisplay, NATIVE_PANEL);
        }

        private static function selectedTab(panel:DisplayObject):int
        {
            var tab:Object = tabControl(panel);
            return tab != null && "selectedIndex" in tab ? int(tab.selectedIndex) : -1;
        }

        private static function selectAllTab(panel:DisplayObject):Boolean
        {
            var tab:Object = tabControl(panel);
            if (tab == null || !("selectedIndex" in tab) || int(tab.selectedIndex) != 0 || !(tab is IEventDispatcher))
            {
                return false;
            }

            var dispatcher:IEventDispatcher = tab as IEventDispatcher;
            var emitted:Boolean = false;
            var changed:Function = function(event:Event):void { emitted = true; };
            dispatcher.addEventListener(Event.CHANGE, changed);
            tab.selectedIndex = 1;
            dispatcher.removeEventListener(Event.CHANGE, changed);
            if (!emitted && int(tab.selectedIndex) == 1)
            {
                // The native panel listens to this exact control's CHANGE event and replaces
                // the recommendation data with the full list in its onTabChange handler.
                dispatcher.dispatchEvent(new Event(Event.CHANGE));
            }
            return int(tab.selectedIndex) == 1;
        }

        private static function switchToAllAndWait(panel:DisplayObject):Object
        {
            if (selectedTab(panel) != 0 || !selectAllTab(panel))
            {
                return null;
            }
            return result("wait", "已切到全部副本，等待原生列表刷新。");
        }

        private static function tabControl(panel:DisplayObject):Object
        {
            var box:Object = panel;
            var content:Object = box != null && "content" in box ? box.content : null;
            return content != null && "tabMc" in content ? content.tabMc : null;
        }

        private static function currentInfoFor(renderer:Object, data:Object):Object
        {
            var skin:Object = renderer.skin;
            var selector:Object = skin != null ? skin.selector : null;
            var difficulty:Object = selector != null ? selector.difficulty : null;
            var frame:int = difficulty != null ? int(difficulty.currentFrame) : int(data.curDifficulty);
            var infos:Array = data.teamNewDungeonInfoAry as Array;
            var index:int = frame - 1;
            return infos != null && index >= 0 && index < infos.length ? infos[index] : null;
        }

        private static function difficultyControl(renderer:DisplayObject):MovieClip
        {
            var item:Object = renderer;
            var skin:Object = item != null ? item.skin : null;
            var selector:Object = skin != null ? skin.selector : null;
            return selector != null ? selector.difficulty as MovieClip : null;
        }

        private static function nextDifficultyButton(renderer:DisplayObject):InteractiveObject
        {
            var item:Object = renderer;
            var skin:Object = item != null ? item.skin : null;
            var selector:Object = skin != null ? skin.selector : null;
            var count:int = selector is DisplayObjectContainer ? DisplayObjectContainer(selector).numChildren : 0;
            var child:DisplayObject;
            var button:Object;
            var skinObject:Object;
            var index:int;
            for (index = 0; index < count; index++)
            {
                child = DisplayObjectContainer(selector).getChildAt(index);
                if (getQualifiedClassName(child) != NATIVE_BASE_BUTTON)
                {
                    continue;
                }
                button = child;
                skinObject = button.skin;
                if (skinObject != null && skinObject.name == "rightBtnMc")
                {
                    return child as InteractiveObject;
                }
            }
            return null;
        }

        private static function cardButton(renderer:DisplayObject):InteractiveObject
        {
            var item:Object = renderer;
            var skin:Object = item != null ? item.skin : null;
            return skin != null ? skin.picBtn as InteractiveObject : null;
        }

        private static function isPlayable(info:Object):Boolean
        {
            var stateType:Class = getDefinitionByName(DUNGEON_STATE_TYPE) as Class;
            return info != null && stateType != null &&
                (int(info.state) == int(stateType.PROTO_NEW_TEAM_DUNGEON_STATE_HAS_OPEN) ||
                 int(info.state) == int(stateType.PROTO_NEW_TEAM_DUNGEON_STATE_RECOMMEND));
        }

        private static function isLocked(info:Object):Boolean
        {
            if (info == null)
            {
                return false;
            }
            var stateType:Class = getDefinitionByName(DUNGEON_STATE_TYPE) as Class;
            return stateType != null && int(info.state) == int(stateType.PROTO_NEW_TEAM_DUNGEON_STATE_NOT_OPEN);
        }

        private static function lockReason(info:Object):String
        {
            if (info == null || info.conf == null)
            {
                return "该困难副本尚未开启";
            }
            return "达" + int(info.conf.combatPower) + "战斗力后开启";
        }

        private static function findClass(root:DisplayObject, className:String):DisplayObject
        {
            if (root != null && getQualifiedClassName(root) == className)
            {
                return root;
            }
            var result:Array = [];
            collectByClass(root, className, result);
            return result.length > 0 ? result[0] as DisplayObject : null;
        }

        private static function collectByClass(root:DisplayObject, className:String, out:Array):void
        {
            var container:DisplayObjectContainer = root as DisplayObjectContainer;
            if (container == null)
            {
                return;
            }
            var child:DisplayObject;
            var index:int;
            for (index = 0; index < container.numChildren; index++)
            {
                child = container.getChildAt(index);
                if (getQualifiedClassName(child) == className)
                {
                    out.push(child);
                }
                collectByClass(child, className, out);
            }
        }

        private static function findNamed(root:DisplayObject, instanceName:String):DisplayObject
        {
            var container:DisplayObjectContainer = root as DisplayObjectContainer;
            if (container == null)
            {
                return null;
            }
            var child:DisplayObject;
            var found:DisplayObject;
            var index:int;
            for (index = 0; index < container.numChildren; index++)
            {
                child = container.getChildAt(index);
                if (child.name == instanceName)
                {
                    return child;
                }
                found = findNamed(child, instanceName);
                if (found != null)
                {
                    return found;
                }
            }
            return null;
        }

        private static function visibleOnPanel(target:DisplayObject, panel:DisplayObject):Boolean
        {
            if (target == null || target.stage == null || !target.visible)
            {
                return false;
            }
            var current:DisplayObject = target;
            while (current != null && current != panel)
            {
                if (!current.visible)
                {
                    return false;
                }
                current = current.parent;
            }
            return current == panel;
        }

        private static function clickable(button:InteractiveObject, within:DisplayObject):Boolean
        {
            if (button == null || button.stage == null || !button.visible || !button.mouseEnabled)
            {
                return false;
            }
            var current:DisplayObject = button;
            while (current != null && current != within)
            {
                if (!current.visible)
                {
                    return false;
                }
                current = current.parent;
            }
            return current == within;
        }

        private static function buttonDisabled(button:InteractiveObject):Boolean
        {
            var target:Object = button;
            return target != null && "disable" in target && Boolean(target["disable"]);
        }

        private static function click(button:InteractiveObject):void
        {
            button.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true, false));
        }

        private static function ready(button:InteractiveObject, dungeonId:int):Object
        {
            return {kind:"ready", message:"已确认可进入的困难副本卡。", button:button, dungeonId:dungeonId};
        }

        private static function result(kind:String, message:String):Object
        {
            return {kind:kind, message:message};
        }
    }
}
