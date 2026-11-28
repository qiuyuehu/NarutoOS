package narutoos.daily
{
    import flash.display.DisplayObject;
    import flash.display.DisplayObjectContainer;
    import flash.display.InteractiveObject;
    import flash.events.Event;
    import flash.events.IEventDispatcher;
    import flash.events.MouseEvent;
    import flash.text.TextField;
    import flash.utils.getDefinitionByName;
    import flash.utils.getQualifiedClassName;

    /** Adapts the CN ExpeditionaryMainView to the daily assistant runner. */
    public final class ExpeditionMap
    {
        private static const MODEL_CLASS:String = "com.tencent.morefun.naruto.plugin.expeditionary.newExpedition.model.ExpeditionModel";
        private static const RESET_PROMPT:String = "生存演习尚未完成，重置会损失一部分奖励，是否确认重新开始挑战？";
        private static const RESET_REWARD_PROMPT:String = "一部分奖励尚未领取，是否确认重新开始挑战？";
        private static const CLAIM_PROMPT:String = "领取奖励后将无法更改演习难度，是否确认领取？";
        private static const TEXT_BOX_CLASS:String = "com.tencent.morefun.naruto.plugin.RSModel.modules.popup.system::TextBox";
        private static const TEXT_COMMAND_CLASS:String = "ui.command::ShowTextBoxCommand";

        private var view:Object;
        private var model:Object;
        private var boxManager:Object;
        private var boxEvents:IEventDispatcher;
        private var commandEvents:IEventDispatcher;
        private var promptCommand:Object;
        private var executingPrompt:Object;
        private var pendingPrompt:String;
        private var ownedPrompt:Object;
        private var clickingAction:Boolean;
        private var promptAccepted:Boolean;
        private var promptCancelledReason:String;

        public function ExpeditionMap(view:Object)
        {
            if (view == null)
            {
                throw new Error("未找到生存演习地图组件。");
            }
            this.view = view;
            model = resolveModel();
            if (model == null)
            {
                throw new Error("无法读取生存演习数据模型。");
            }

            boxManager = getDefinitionByName("com.tencent.morefun.naruto.plugin.ui.box.BoxManager");
            boxEvents = boxManager.dispathcer as IEventDispatcher;
            if (boxEvents != null)
            {
                boxEvents.addEventListener("boxShow", onBoxShow, false, int.MAX_VALUE);
                boxEvents.addEventListener("boxShowed", onBoxShowed, false, int.MAX_VALUE);
                boxEvents.addEventListener("boxHided", onBoxHided);
            }
            var facade:Object = getDefinitionByName("com.tencent.morefun.framework.apf.core.facade.Facade");
            commandEvents = facade.getInstance().commandManager as IEventDispatcher;
            if (commandEvents != null)
            {
                commandEvents.addEventListener("commandRequest", onCommandRequest, false, int.MAX_VALUE);
                commandEvents.addEventListener("commandExecute", onCommandExecute, false, int.MAX_VALUE);
                commandEvents.addEventListener("commandLoadError", onCommandStopped);
                commandEvents.addEventListener("commandCancel", onCommandStopped);
            }
        }

        /** null means the native server data has not loaded yet. */
        public function get snapshot():Object
        {
            var info:Object = model.expeditionInfo;
            if (info == null || !view.isShow || !view.isShowing || view.stage == null || !view.content.mouseChildren)
            {
                return null;
            }
            requireField(info, "score");
            requireField(info, "maxScore");
            requireField(info, "remainResetCount");
            requireField(info, "stageInfoAry");
            requireField(info, "boxDataAry");
            if (int(info.maxScore) <= 0)
            {
                return null;
            }
            var resetButton:Object = view.content.bottomMC.resetBtn;
            var resetLabel:String = resetButton == null ? "" : String(resetButton.label);
            if (!ExpeditionResetLabel.matches(resetLabel, int(info.remainResetCount), DailyRegion.isBR))
            {
                return null;
            }
            if (!hasRenderedScore(view.content.bottomMC as DisplayObjectContainer, int(info.score), int(info.maxScore)))
            {
                return null;
            }

            var player:Object = currentPlayer();
            var level:int = int(player.level);
            var teamId:String = player.teamId == null ? "" : String(player.teamId);
            var expeditionReady:Boolean = teamId == "" && int(info.carryNinjaCount) >= 4 &&
                int(info.hasDeadNinjaCount) != int(info.carryNinjaCount);
            var stages:Array = [];
            var rawStages:Array = info.stageInfoAry as Array;
            var needsChoice:Boolean = int(info.remainResetCount) == 0 && int(info.score) < int(info.maxScore);
            var index:int;
            var raw:Object;
            if (rawStages == null)
            {
                throw new Error("无法读取生存演习关卡数据。");
            }
            if (needsChoice && !rawStages.length) return null;
            for (index = 0; index < rawStages.length; index++)
            {
                raw = rawStages[index];
                requireField(raw, "stageId");
                requireField(raw, "remainCount");
                requireField(raw, "openLevel");
                requireField(raw, "score");
                requireField(raw, "star");
                var rank:String = rankForStar(int(raw.star));
                var slot:Object = view.content["item" + index];
                var starMovie:Object = slot == null ? null : slot["starMC"];
                var rankMatches:Boolean = starMovie != null && int(starMovie.currentFrame) == int(raw.star);
                var challengeable:Boolean = expeditionReady && int(raw.openLevel) <= level && int(raw.remainCount) > 0;
                if (needsChoice && challengeable && rank && !rankMatches) return null;
                var scoreValid:Boolean = int(raw.score) > 0;
                var available:Boolean = challengeable && rankMatches && rank != "" && scoreValid;
                stages.push({
                    stageId: uint(raw.stageId),
                    remainCount: int(raw.remainCount),
                    rank: rankMatches ? rank : "",
                    available: available,
                    challengeable: challengeable,
                    rankKnown: rank != "",
                    scoreValid: scoreValid,
                    openLevel: int(raw.openLevel),
                    score: int(raw.score),
                    rankSlot: index
                });
            }

            var canTake:Boolean = false;
            var allTaken:Boolean = true;
            var boxes:Array = info.boxDataAry as Array;
            if (boxes == null)
            {
                throw new Error("无法读取生存演习奖励状态。");
            }
            var canTakeState:int = enumValue("serverProto.expedition.ProtoNewExpeditionBoxState",
                "PROTO_NEW_EXPEDITION_BOX_STATE_CAN_TAKE", 1);
            var takenState:int = enumValue("serverProto.expedition.ProtoNewExpeditionBoxState",
                "PROTO_NEW_EXPEDITION_BOX_STATE_HAS_TAKE", 2);
            for each (raw in boxes)
            {
                requireField(raw, "state");
                if (int(raw.state) == canTakeState)
                {
                    canTake = true;
                    allTaken = false;
                }
                else if (int(raw.state) != takenState)
                {
                    allTaken = false;
                }
            }

            return {
                score: int(info.score),
                maxScore: int(info.maxScore),
                resetCount: int(info.remainResetCount),
                rewardCanTake: canTake,
                rewardTaken: boxes.length > 0 && allTaken,
                lineupUsable: expeditionReady,
                stages: stages
            };
        }

        public function reset():Boolean
        {
            var state:Object = snapshot;
            if (state == null || state.resetCount != 1 || !isTopModal(view))
            {
                return false;
            }
            var button:InteractiveObject = view.content.bottomMC.resetBtn as InteractiveObject;
            if (!clickable(button))
            {
                return false;
            }
            return clickAction(button, "reset");
        }

        public function challenge(stageId:uint):Boolean
        {
            var state:Object = snapshot;
            if (state == null || !state.lineupUsable)
            {
                return false;
            }
            for each (var item:Object in state.stages)
            {
                if (item.stageId != stageId || !item.available || !item.rank) continue;
                var button:InteractiveObject = view.content["gk" + item.rankSlot] as InteractiveObject;
                if (!isTopModal(view) || !clickable(button)) return false;
                click(button);
                return true;
            }
            return false;
        }

        public function claim():Boolean
        {
            var state:Object = snapshot;
            if (state == null || !state.rewardCanTake || state.score < state.maxScore || !isTopModal(view))
            {
                return false;
            }
            var button:InteractiveObject = view.content.bottomMC.onekeyBtn as InteractiveObject;
            if (!clickable(button))
            {
                return false;
            }
            return clickAction(button, "claim");
        }

        public function exit():Boolean
        {
            if (!view.isShow || !view.isShowing || view.stage == null || !isTopModal(view))
            {
                return false;
            }
            var button:InteractiveObject = view.content.rightareaMC.btn_close as InteractiveObject;
            if (!clickable(button))
            {
                return false;
            }
            clearPrompt();
            click(button);
            return true;
        }

        /** True only for the matching native prompt requested by this adapter's action. */
        public function ownsPrompt(box:Object):Boolean
        {
            return box != null && box === ownedPrompt && pendingPrompt != null;
        }

        /**
         * Advances only this run's reset or claim prompt. True means a matching prompt
         * is waiting, being accepted, or closing; false means there is no owned prompt.
         */
        public function get actionDeclined():Boolean { return promptCancelledReason != null; }

        public function advancePrompt():Boolean
        {
            if (promptCancelledReason != null)
            {
                throw new Error(promptCancelledReason);
            }
            if (pendingPrompt == null)
            {
                return false;
            }
            if (ownedPrompt == null)
            {
                return promptCommand != null;
            }
            var topPrompt:Boolean = isTopModal(ownedPrompt);
            if (promptAccepted || !topPrompt)
            {
                return true;
            }
            var content:DisplayObjectContainer = Object(ownedPrompt).content as DisplayObjectContainer;
            var yesButton:InteractiveObject = content == null ? null : content.getChildByName("yesBtn") as InteractiveObject;
            var noButton:InteractiveObject = content == null ? null : content.getChildByName("noBtn") as InteractiveObject;
            if (!clickable(yesButton) || !clickable(noButton))
            {
                return true;
            }
            promptAccepted = true;
            click(yesButton);
            return true;
        }

        public function cancel():void
        {
            clearPrompt();
            if (boxEvents != null)
            {
                boxEvents.removeEventListener("boxShow", onBoxShow);
                boxEvents.removeEventListener("boxShowed", onBoxShowed);
                boxEvents.removeEventListener("boxHided", onBoxHided);
                boxEvents = null;
            }
            if (commandEvents != null)
            {
                commandEvents.removeEventListener("commandRequest", onCommandRequest);
                commandEvents.removeEventListener("commandExecute", onCommandExecute);
                commandEvents.removeEventListener("commandLoadError", onCommandStopped);
                commandEvents.removeEventListener("commandCancel", onCommandStopped);
                commandEvents = null;
            }
            view = null;
            model = null;
            boxManager = null;
        }

        private function clickAction(button:InteractiveObject, prompt:String):Boolean
        {
            clearPrompt();
            pendingPrompt = prompt;
            clickingAction = true;
            try
            {
                click(button);
            }
            catch (error:Error)
            {
                clearPrompt();
                throw error;
            }
            finally
            {
                clickingAction = false;
            }
            if (promptCommand == null)
            {
                clearPrompt();
            }
            return true;
        }

        private function onBoxShow(event:Event):void
        {
            captureOwnedPrompt(Object(event).box);
        }

        private function onBoxShowed(event:Event):void
        {
            captureOwnedPrompt(Object(event).box);
        }

        private function captureOwnedPrompt(box:Object):void
        {
            if (pendingPrompt == null || promptCommand == null || executingPrompt !== promptCommand || ownedPrompt != null)
            {
                return;
            }
            if (box == null || getQualifiedClassName(box) != TEXT_BOX_CLASS)
            {
                return;
            }
            var text:TextField = Object(box.content).txt as TextField;
            var buttonMatch:Boolean = hasYesNoButtons(box);
            if (text != null && text.text == promptCommand.text && buttonMatch)
            {
                ownedPrompt = box;
            }
        }

        private function onCommandRequest(event:Event):void
        {
            if (!clickingAction || pendingPrompt == null)
            {
                return;
            }
            var command:Object = Object(event).command;
            if (command != null && getQualifiedClassName(command) == TEXT_COMMAND_CLASS && matchesPrompt(String(command.text)))
            {
                promptCommand = command;
            }
        }

        private function onCommandExecute(event:Event):void
        {
            var command:Object = Object(event).command;
            if (command != null && command === promptCommand)
            {
                executingPrompt = command;
            }
        }

        private function onCommandStopped(event:Event):void
        {
            var command:Object = Object(event).command;
            if (command != null && command === promptCommand && ownedPrompt == null)
            {
                var reason:String = pendingPrompt == "reset" ? "重置确认未能打开，生存演习已停止。" :
                    "领奖确认未能打开，生存演习已停止。";
                clearPrompt();
                promptCancelledReason = reason;
            }
        }

        private function matchesPrompt(text:String):Boolean
        {
            if (pendingPrompt == "reset")
            {
                return text == RESET_PROMPT || text == RESET_REWARD_PROMPT ||
                    (DailyRegion.isBR && (text == "O Treino de Sobrevivência não foi completado, caso você renove ira perder alguns prêmios. Deseja renovar?" ||
                                          text == "Parte dos prêmios não foi retirada, deseja recomeçar do início?"));
            }
            return pendingPrompt == "claim" && (text == CLAIM_PROMPT ||
                (DailyRegion.isBR && text == "Caso você retire os prêmios não poderá alterar a dificuldade, deseja retirar?"));
        }

        private function onBoxHided(event:Event):void
        {
            if (Object(event).box === ownedPrompt)
            {
                var reason:String = null;
                if (!promptAccepted)
                {
                    reason = pendingPrompt == "reset" ? "重置确认已取消，生存演习已停止。" :
                        "领奖确认已取消，生存演习已停止。";
                }
                clearPrompt();
                promptCancelledReason = reason;
            }
        }

        private function hasYesNoButtons(box:Object):Boolean
        {
            var content:Object = box.content;
            return content != null && content.getChildByName("yesBtn") != null &&
                content.getChildByName("noBtn") != null;
        }

        private function clearPrompt():void
        {
            pendingPrompt = null;
            ownedPrompt = null;
            promptCommand = null;
            executingPrompt = null;
            clickingAction = false;
            promptAccepted = false;
            promptCancelledReason = null;
        }

        private static function resolveModel():Object
        {
            var modelClass:Class;
            try
            {
                var facadeType:Object = getDefinitionByName("com.tencent.morefun.framework.apf.core.facade.Facade");
                var facade:Object = facadeType.getInstance();
                var pluginDef:Object = getDefinitionByName("def.PluginDef");
                var plugin:Object = facade.pluginManager.getPluginInfo(pluginDef.EXPEDITIONARY);
                var domain:Object = plugin == null ? null : plugin.domain;
                if (domain != null && domain.hasDefinition(MODEL_CLASS))
                {
                    modelClass = domain.getDefinition(MODEL_CLASS) as Class;
                }
            }
            catch (pluginError:Error)
            {
                modelClass = null;
            }
            if (modelClass == null)
            {
                try
                {
                    modelClass = getDefinitionByName(MODEL_CLASS) as Class;
                }
                catch (definitionError:Error)
                {
                    return null;
                }
            }
            return Object(modelClass)["getIns"]();
        }

        private static function currentPlayer():Object
        {
            var app:Object = getDefinitionByName("base.ApplicationData");
            if (app == null || app.singleton == null || app.singleton.selfInfo == null)
            {
                throw new Error("无法读取当前角色信息，无法确认生存演习挑战条件。");
            }
            return app.singleton.selfInfo;
        }

        private static function hasRenderedScore(container:DisplayObjectContainer, score:int, maxScore:int):Boolean
        {
            var index:int;
            var child:DisplayObject;
            for (index = 0; index < container.numChildren; index++)
            {
                child = container.getChildAt(index);
                if (getQualifiedClassName(child).indexOf("BitmapText") >= 0 && "text" in child &&
                    String(Object(child).text) == score + "/" + maxScore)
                {
                    return true;
                }
            }
            return false;
        }

        private function isTopModal(node:Object):Boolean
        {
            if (node == null || !node.isShow || !node.isShowing || node.stage == null)
            {
                return false;
            }
            var showing:Array = boxManager.showingList as Array;
            if (showing == null)
            {
                return false;
            }
            var top:Object;
            for each (var box:Object in showing)
            {
                if (box != null && box.modal && box.isShow && box.isShowing)
                {
                    top = box;
                }
            }
            return top === node;
        }

        private static function enumValue(className:String, field:String, fallback:int):int
        {
            try
            {
                var type:Class = getDefinitionByName(className) as Class;
                if (type != null && field in type)
                {
                    return int(type[field]);
                }
            }
            catch (error:Error)
            {
            }
            return fallback;
        }

        private static function requireField(value:Object, field:String):void
        {
            if (value == null || !(field in value))
            {
                throw new Error("生存演习数据缺少字段：" + field + "。");
            }
        }

        private static function rankForStar(star:int):String
        {
            // Native ExpeditionMainView feeds ProtoNewExpeditionStageInfo.star to
            // GuankaSmallIcon.star(), which advances itemN.starMC to that frame.
            if (star == 5) return "SS";
            if (star == 4) return "S";
            if (star == 3) return "A";
            if (star == 2) return "B";
            if (star == 1) return "C";
            return "";
        }

        private static function clickable(button:InteractiveObject):Boolean
        {
            return button != null && button.visible && button.mouseEnabled &&
                (!("enabled" in button) || Object(button).enabled);
        }

        private static function click(button:InteractiveObject):void
        {
            button.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true));
        }
    }
}
