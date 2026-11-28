package narutoos.daily
{
    import flash.display.DisplayObject;
    import flash.display.DisplayObjectContainer;
    import flash.display.InteractiveObject;
    import flash.display.Sprite;
    import flash.events.Event;
    import flash.events.IEventDispatcher;
    import flash.events.MouseEvent;
    import flash.events.TimerEvent;
    import flash.text.TextField;
    import flash.utils.Dictionary;
    import flash.utils.getDefinitionByName;
    import flash.utils.getQualifiedClassName;
    import flash.utils.Timer;

    public final class QuizRun implements IDailyTask
    {
        private static const QUIZ_ANSWER_COMMAND:String = "com.tencent.morefun.naruto.plugin.quiz.command::RequestAnswerQuizCommand";
        private static const QUIZ_REWARD_COMMAND:String = "com.tencent.morefun.naruto.plugin.quiz.command::RequestQuizRewardCommand";
        private static const TASK_NPC:String = "com.tencent.morefun.naruto.plugin.npc.views::TaskNpcDialog";
        private static const MENU_ROW:String = "com.tencent.morefun.naruto.plugin.npc.views::TaskNpcDialogMenuRenderer";
        private static const TASK_NPC_LIST_ID:int = 26000500;
        private static const TEST_NPC_ROUTE:String = "cgoto,2015002,26000500";
        private static const START_MENU_PARAM:String = "openui,53,closeDialog";
        private const navigationTimeout:int = DailyRegion.networkWait(45000);
        private const questionTimeout:int = DailyRegion.networkWait(60000);
        private static const POLL_INTERVAL:int = 120;
        private static const SELECT_SETTLE_MS:int = 120;
        private static const TOTAL_QUESTIONS:int = 10;

        // Keep a question marked once its native submit button was clicked. If the
        // assistant is stopped and restarted while the native reply is pending,
        // it must not submit that same question a second time.
        private static const submittedByPanel:Dictionary = new Dictionary(true);
        private static const claimRequestsByPanel:Dictionary = new Dictionary(true);

        private var owner:Sprite;
        private var onFinished:Function;
        private var progress:Function;
        private var boxEvents:IEventDispatcher;
        private var commandEvents:IEventDispatcher;
        private var timer:Timer;
        private var timerListener:Function;
        private var navigation:Object;
        private var rewardCommand:Object;
        private var quizPanel:Object;
        private var activeKey:String = "";
        private var selectedFirst:Boolean;
        private var submitted:Boolean;
        private static const ANSWER_READY_TIMEOUT:int = 1500;
        private const panelWait:QuizWait = new QuizWait(navigationTimeout, questionTimeout);
        private const questionWait:QuizWait = new QuizWait(SELECT_SETTLE_MS, ANSWER_READY_TIMEOUT, navigationTimeout, questionTimeout);
        private var generation:uint;
        private var choseMenu:Boolean;
        private var claimRequested:Boolean;
        private var claimConfirmed:Boolean;
        private var closeRequested:Boolean;
        private var hiddenAfterClaim:Boolean;

        public function QuizRun(owner:Sprite, finished:Function, progress:Function = null)
        {
            this.owner = owner;
            this.onFinished = finished;
            this.progress = progress;
        }

        public function get running():Boolean
        {
            return timer != null;
        }

        public function start():void
        {
            if (running || owner == null || !owner.stage)
            {
                return;
            }

            var runId:uint = ++generation;
            try
            {
                var boxManager:Object = getDefinitionByName("com.tencent.morefun.naruto.plugin.ui.box.BoxManager");
                var facade:Object = getDefinitionByName("com.tencent.morefun.framework.apf.core.facade.Facade");
                boxEvents = boxManager.dispathcer as IEventDispatcher;
                commandEvents = facade.getInstance().commandManager as IEventDispatcher;
                if (boxEvents == null || commandEvents == null)
                {
                    finish(DailyQueue.ABORT, "无法监听测验界面。");
                    return;
                }

                timer = new Timer(POLL_INTERVAL);
                timerListener = function(event:TimerEvent):void
                {
                    onTimer(event, runId);
                };
                timer.addEventListener(TimerEvent.TIMER, timerListener);
                owner.addEventListener(Event.REMOVED_FROM_STAGE, onOwnerRemoved);
                boxEvents.addEventListener("boxShow", onBoxShow);
                boxEvents.addEventListener("boxShowed", onBoxShowed);
                boxEvents.addEventListener("boxHided", onBoxHided);
                commandEvents.addEventListener("commandRequest", onCommandRequest, false, int.MAX_VALUE);
                commandEvents.addEventListener("commandLoadError", onCommandStopped);
                commandEvents.addEventListener("commandCancel", onCommandStopped);
                timer.start();

                panelWait.restart();
                var existing:Object = QuizBox.find(boxManager, owner.stage);
                if (existing != null)
                {
                    quizPanel = existing;
                    panelWait.restart();
                    if (isVisibleOnOwnerStage(existing))
                    {
                        attachQuizPanel(existing);
                    }
                    return;
                }

                var npcMenu:Object = boxManager.getBoxByName("taskNpcDialog");
                if (isTestNpcMenu(npcMenu))
                {
                    chooseStartMenu(npcMenu);
                    return;
                }

                var href:Class = getDefinitionByName("task.commands.HrefEventCommand") as Class;
                navigation = new href(TEST_NPC_ROUTE);
                listenToCommand(navigation, onNavigationFinished);
                navigation.call();
            }
            catch (error:Error)
            {
                if (running)
                {
                    finish(DailyQueue.ABORT, "无法导航到考官红豆。");
                }
            }
        }

        public function cancel():void
        {
            if (running)
            {
                // Invalidate callbacks before detaching listeners. A queued timer
                // or native event from the previous run can no longer click UI.
                generation++;
                reset();
            }
        }

        private function onOwnerRemoved(event:Event):void
        {
            cancel();
        }

        private function onTimer(event:TimerEvent, runId:uint):void
        {
            if (!running || runId != generation)
            {
                return;
            }

            if (quizPanel == null)
            {
                var boxManager:Object = getDefinitionByName("com.tencent.morefun.naruto.plugin.ui.box.BoxManager");
                var candidate:Object = QuizBox.find(boxManager, owner.stage);
                if (candidate != null)
                {
                    quizPanel = candidate;
                    panelWait.restart();
                    if (isVisibleOnOwnerStage(candidate))
                    {
                        attachQuizPanel(candidate);
                    }
                    return;
                }
                if (DailyRegion.isBR && !choseMenu && !panelWait.expired(navigationTimeout))
                {
                    var npcMenu:Object = boxManager.getBoxByName("taskNpcDialog");
                    if (isTestNpcMenu(npcMenu) && isTopModal(npcMenu)) chooseStartMenu(npcMenu);
                }
                if (panelWait.expired(navigationTimeout))
                {
                    finish(DailyQueue.ABORT, "等待测验界面打开超时。");
                }
                return;
            }

            if (!isVisibleOnOwnerStage(quizPanel))
            {
                if (claimRequested || closeRequested)
                {
                    if (quizPanel.stage == null) hiddenAfterClaim = true;
                    if (hiddenAfterClaim && claimConfirmed) finish(DailyQueue.COMPLETE, "忍者测验已完成。");
                    else if (questionWait.expired(questionTimeout))
                        finish(DailyQueue.ABORT, "等待测验领奖或关窗确认超时。");
                    return;
                }
                if (QuizBox.isOpening(quizPanel, owner.stage))
                {
                    if (panelWait.expired(navigationTimeout))
                    {
                        finish(DailyQueue.ABORT, "测验界面打开超时。");
                    }
                    return;
                }
                finish(DailyQueue.ABORT, "测验界面已关闭。");
                return;
            }

            processQuestion(runId);
        }

        private function onBoxShow(event:Event):void
        {
            if (!running)
            {
                return;
            }
            var box:Object = Object(event).box;
            if (QuizBox.matches(box) && QuizBox.isOpening(box, owner.stage))
            {
                quizPanel = box;
                panelWait.restart();
                if (isVisibleOnOwnerStage(box)) attachQuizPanel(box);
            }
        }

        private function onBoxShowed(event:Event):void
        {
            if (!running)
            {
                return;
            }
            var box:Object = Object(event).box;
            if (QuizBox.matches(box))
            {
                attachQuizPanel(box);
            }
            else if (!choseMenu && isTestNpcMenu(box))
            {
                chooseStartMenu(box);
            }
        }

        private function onBoxHided(event:Event):void
        {
            if (!running)
            {
                return;
            }
            var hidden:Object = Object(event).box;
            if (hidden !== quizPanel)
            {
                return;
            }
            if (closeRequested && claimConfirmed)
            {
                finish(DailyQueue.COMPLETE, "忍者测验已完成。");
                return;
            }
            if (claimRequested)
            {
                hiddenAfterClaim = true;
                if (claimConfirmed) finish(DailyQueue.COMPLETE, "忍者测验已完成。");
                return;
            }
            finish(DailyQueue.ABORT, "测验界面已关闭。");
        }

        private static function isTestNpcMenu(box:Object):Boolean
        {
            return box != null && getQualifiedClassName(box) == TASK_NPC &&
                box.taskNpcCfg != null && int(box.taskNpcCfg.listId) == TASK_NPC_LIST_ID;
        }

        private function chooseStartMenu(box:Object):void
        {
            if (!running || choseMenu || !isVisibleOnOwnerStage(box))
            {
                return;
            }

            var menus:DisplayObjectContainer = box.content.menus as DisplayObjectContainer;
            var match:InteractiveObject;
            for (var i:int = 0; menus && menus.visible && i < menus.numChildren; i++)
            {
                var list:DisplayObjectContainer = menus.getChildAt(i) as DisplayObjectContainer;
                if (!list || !list.visible) continue;
                for (var j:int = 0; j < list.numChildren; j++)
                {
                    var row:InteractiveObject = list.getChildAt(j) as InteractiveObject;
                    if (!clickable(row) || getQualifiedClassName(row) != MENU_ROW) continue;
                    var item:Object = Object(row).getData();
                    // The route and menu command identify the quiz action. The rendered label
                    // comes from the game's locale and may be Portuguese on the BR server.
                    if (!item || item.type != "npcMenu" || item.param != START_MENU_PARAM) continue;
                    if (match)
                    {
                        finish(DailyQueue.ABORT, "考官红豆的开始测验选项无法确定。");
                        return;
                    }
                    match = row;
                }
            }

            if (!match)
            {
                if (DailyRegion.isBR && !panelWait.expired(navigationTimeout)) return;
                finish(DailyQueue.ABORT, "当前 NPC 菜单没有可用的开始测验选项。");
                return;
            }

            choseMenu = true;
            if (DailyRegion.isBR) panelWait.restart();
            try
            {
                click(match);
            }
            catch (error:Error)
            {
                if (running)
                {
                    finish(DailyQueue.ABORT, "无法打开测验界面。");
                }
            }
        }

        private function attachQuizPanel(box:Object):void
        {
            if (!running || !isVisibleOnOwnerStage(box))
            {
                return;
            }
            quizPanel = box;
            panelWait.restart();
            if (isSettled(quizPanel))
            {
                processReward();
                return;
            }
        }

        private function processReward():void
        {
            if (!running || !isVisibleOnOwnerStage(quizPanel)) return;
            if (closeRequested)
            {
                if (questionWait.expired(navigationTimeout))
                    finish(DailyQueue.ABORT, "等待测验结算页关闭超时。");
                return;
            }
            if (!isTopModal(quizPanel))
            {
                if (panelWait.expired(navigationTimeout))
                    finish(DailyQueue.ABORT, "测验结算页被其他窗口遮挡，本轮已停止。");
                return;
            }
            var previous:Object = claimRequestsByPanel[quizPanel];
            if (!claimRequested && previous)
            {
                claimRequested = true;
                questionWait.restart();
                if (previous is IEventDispatcher)
                {
                    rewardCommand = previous;
                    listenToCommand(rewardCommand, onRewardFinished);
                }
            }
            var view:Object = quizPanel.content;
            var area:Object = view != null ? view.rewardArea : null;
            var button:InteractiveObject = area != null ? area.rewardButton as InteractiveObject : null;
            if (area == null || !area.visible || button == null)
            {
                finish(DailyQueue.ABORT, "无法识别测验领奖状态。");
                return;
            }
            if ("enabled" in button && !Object(button).enabled)
            {
                claimConfirmed = true;
                closeQuizPanel(view);
                return;
            }
            if (claimConfirmed)
            {
                closeQuizPanel(view);
                return;
            }
            if (claimRequested)
            {
                if (questionWait.expired(questionTimeout))
                    finish(DailyQueue.ABORT, "等待测验领奖结果超时。");
                return;
            }
            if (!clickable(button))
            {
                finish(DailyQueue.ABORT, "测验领奖按钮不可用。");
                return;
            }
            claimRequested = true;
            claimRequestsByPanel[quizPanel] = true;
            questionWait.restart();
            try
            {
                click(button);
            }
            catch (error:Error)
            {
                if (running) finish(DailyQueue.ABORT, "无法领取测验奖励。");
            }
        }

        private function closeQuizPanel(view:Object):void
        {
            if (closeRequested || !running) return;
            if (!isVisibleOnOwnerStage(quizPanel))
            {
                if (quizPanel == null || quizPanel.stage == null)
                {
                    hiddenAfterClaim = true;
                    if (claimConfirmed) finish(DailyQueue.COMPLETE, "忍者测验已完成。");
                }
                return;
            }
            if (!isTopModal(quizPanel)) return;
            var button:InteractiveObject = view != null ? view.closeButton as InteractiveObject : null;
            if (!clickable(button))
            {
                finish(DailyQueue.ABORT, "测验领奖后无法关闭结算页。");
                return;
            }
            closeRequested = true;
            questionWait.restart();
            try
            {
                click(button);
            }
            catch (error:Error)
            {
                if (running) finish(DailyQueue.ABORT, "无法关闭测验结算页。");
            }
        }

        private function processQuestion(runId:uint):void
        {
            if (!running || runId != generation)
            {
                return;
            }

            if (isSettled(quizPanel))
            {
                processReward();
                return;
            }

            if (!isTopModal(quizPanel))
            {
                if (panelWait.expired(questionTimeout))
                {
                    finish(DailyQueue.ABORT, "测验窗口被其他游戏窗口遮挡。");
                }
                return;
            }

            var view:Object = quizPanel.content;
            if (view == null || view.questionArea == null || !view.questionArea.visible)
            {
                if (panelWait.expired(questionTimeout))
                {
                    finish(DailyQueue.ABORT, "等待当前测验题目显示超时。");
                }
                return;
            }

            var remaining:int = readRemaining(view.leftText as TextField);
            if (remaining < 0)
            {
                if (DailyRegion.isBR && !panelWait.expired(questionTimeout)) return;
                finish(DailyQueue.ABORT, "无法读取当前剩余题数。");
                return;
            }
            var number:int = readQuestionNumber(view);
            if (number < 1 || number > TOTAL_QUESTIONS)
            {
                if (DailyRegion.isBR && !panelWait.expired(questionTimeout)) return;
                finish(DailyQueue.ABORT, "当前测验题号无效。");
                return;
            }

            var key:String = questionKey(view, number);
            if (key == "" )
            {
                if (panelWait.expired(questionTimeout))
                {
                    finish(DailyQueue.ABORT, "等待测验题面就绪超时。");
                }
                return;
            }
            if (key != activeKey)
            {
                activeKey = key;
                selectedFirst = false;
                submitted = wasSubmitted(quizPanel, number);
                questionWait.restart();
                panelWait.restart();
                if (progress != null) progress("忍者测验 " + number + "/" + TOTAL_QUESTIONS);
            }

            if (submitted)
            {
                if (questionWait.expired(questionTimeout))
                {
                    finish(DailyQueue.ABORT, "等待测验题目更新超时。");
                }
                return;
            }

            if (!animationsReady(view))
            {
                if (questionWait.expired(questionTimeout))
                {
                    finish(DailyQueue.ABORT, "等待测验动画结束超时。");
                }
                return;
            }

            var question:Object = view.questionArea;
            var tabBar:Object = findAnswerTabBar(question);
            var firstAnswer:InteractiveObject = tabBar != null ? tabBar.getTabItemByIndex(0) as InteractiveObject : null;
            var commit:InteractiveObject = question.commitButton as InteractiveObject;
            if (!selectedFirst)
            {
                if (tabBar == null || firstAnswer == null || Object(firstAnswer).skin !== question.answer0 ||
                    !clickable(firstAnswer) || !question.answer0.visible)
                {
                    if (DailyRegion.isBR && !questionWait.expired(questionTimeout)) return;
                    finish(DailyQueue.ABORT, "当前题目的第一个选项不可用。");
                    return;
                }
                selectedFirst = true;
                questionWait.restart();
                try
                {
                    click(firstAnswer);
                }
                catch (error:Error)
                {
                    if (running && runId == generation)
                    {
                        finish(DailyQueue.ABORT, "无法选择当前题目的第一个选项。");
                    }
                }
                // Clicking an answer may synchronously close/advance the panel.
                // The next timer tick validates the question key before submit.
                return;
            }

            if (!questionWait.expired(SELECT_SETTLE_MS))
            {
                return;
            }
            if (questionKey(view, number) != activeKey || !running || runId != generation)
            {
                return;
            }
            if (tabBar == null)
            {
                if (DailyRegion.isBR && questionWait.expired(questionTimeout))
                    finish(DailyQueue.ABORT, "等待测验选项重新显示超时。");
                return;
            }
            if (int(tabBar.selectedIndex) != 0)
            {
                if (questionWait.expired(ANSWER_READY_TIMEOUT))
                {
                    finish(DailyQueue.ABORT, "第一个选项没有被选中，已停止提交。");
                }
                return;
            }
            if (!clickable(commit))
            {
                if (questionWait.expired(ANSWER_READY_TIMEOUT))
                {
                    finish(DailyQueue.ABORT, "当前题目的提交按钮不可用。");
                }
                return;
            }

            markSubmitted(quizPanel, number);
            submitted = true;
            questionWait.restart();
            try
            {
                click(commit);
            }
            catch (error:Error)
            {
                if (running && runId == generation)
                {
                    finish(DailyQueue.ABORT, "无法提交当前测验答案。");
                }
            }
        }

        private static function questionKey(view:Object, number:int):String
        {
            var question:Object = view != null ? view.questionArea : null;
            if (question == null || question.questionText == null)
            {
                return "";
            }
            var prompt:String = String(question.questionText.htmlText).replace(/<[^>]*>/g, "");
            prompt = prompt.replace(/\s+/g, " ");
            if (prompt.length == 0)
            {
                return "";
            }
            return String(number) + "|" + prompt;
        }

        private static function readQuestionNumber(view:Object):int
        {
            var question:Object = view != null ? view.questionArea : null;
            if (question == null || question.questionText == null)
            {
                return -1;
            }
            var prompt:String = String(question.questionText.htmlText).replace(/<[^>]*>/g, "");
            var match:Object = /^\s*(\d+)\s*[.．]/.exec(prompt);
            return match != null ? int(match[1]) : -1;
        }

        private static function findAnswerTabBar(question:Object):Object
        {
            if (!(question is DisplayObjectContainer))
            {
                return null;
            }
            var container:DisplayObjectContainer = question as DisplayObjectContainer;
            for (var i:int = 0; i < container.numChildren; i++)
            {
                var candidate:DisplayObject = container.getChildAt(i);
                if (getQualifiedClassName(candidate).toLowerCase().indexOf("tabbar") >= 0 &&
                    "getTabItemByIndex" in candidate)
                {
                    return candidate;
                }
            }
            return null;
        }

        private static function readRemaining(text:TextField):int
        {
            if (text == null)
            {
                return -1;
            }
            var match:Object = /剩余题目\s*[:：]\s*(\d+)/.exec(text.text);
            if (match == null) match = /Perguntas restantes\s*:\s*(\d+)/i.exec(text.text);
            return match != null ? int(match[1]) : -1;
        }

        private static function animationsReady(view:Object):Boolean
        {
            var question:Object = view.questionArea;
            var animations:Array = [question.rightAnimation, question.wrongAnimation, question.timeOutAnimation];
            for each (var animation:Object in animations)
            {
                if (animation != null && animation.currentLabel != "end")
                {
                    return false;
                }
            }
            return view.startAnimation == null || view.startAnimation.currentLabel == "end" ?
                (view.nextAnimation == null || view.nextAnimation.currentLabel == "end") : false;
        }

        private static function isSettled(box:Object):Boolean
        {
            var view:Object = box != null ? box.content : null;
            return view != null && view.rewardArea != null && view.rewardArea.visible;
        }

        private function isVisibleOnOwnerStage(box:Object):Boolean
        {
            return box != null && box.isShow && box.isShowing && owner != null &&
                owner.stage != null && box.stage === owner.stage;
        }

        private function isTopModal(box:Object):Boolean
        {
            if (!isVisibleOnOwnerStage(box) || !box.modal)
            {
                return false;
            }
            var boxManager:Object = getDefinitionByName("com.tencent.morefun.naruto.plugin.ui.box.BoxManager");
            var showing:Array = boxManager.showingList as Array;
            if (showing == null)
            {
                return false;
            }
            var top:Object;
            for each (var candidate:Object in showing)
            {
                if (candidate != null && candidate.modal && candidate.isShow)
                {
                    top = candidate;
                }
            }
            return top === box;
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

        private static function wasSubmitted(panel:Object, questionNumber:int):Boolean
        {
            var questions:Object = submittedByPanel[panel];
            return questions != null && questions[String(questionNumber)] === true;
        }

        private static function markSubmitted(panel:Object, questionNumber:int):void
        {
            var questions:Object = submittedByPanel[panel];
            if (questions == null)
            {
                questions = {};
                submittedByPanel[panel] = questions;
            }
            questions[String(questionNumber)] = true;
        }

        private function onNavigationFinished(event:Event):void
        {
            forgetCommand(navigation, onNavigationFinished);
            navigation = null;
            if (event.type == "faild" && running)
            {
                finish(DailyQueue.ABORT, "无法导航到考官红豆。");
            }
            else if (DailyRegion.isBR && running && quizPanel == null && !choseMenu)
            {
                panelWait.restart();
            }
        }

        private function onCommandStopped(event:Event):void
        {
            var command:Object = Object(event).command;
            if (running && command != null && command === rewardCommand)
            {
                delete claimRequestsByPanel[quizPanel];
                finish(DailyQueue.ABORT, "测验领奖所需的游戏资源加载失败。");
                return;
            }
            if (running && command === navigation)
            {
                finish(DailyQueue.ABORT, event.type == "commandCancel" ? "测验导航已取消。" : "测验导航资源加载失败。");
            }
        }

        private function onCommandRequest(event:Event):void
        {
            if (!running || quizPanel == null)
            {
                return;
            }
            var command:Object = Object(event).command;
            if (command == null)
            {
                return;
            }
            if (getQualifiedClassName(command) == QUIZ_REWARD_COMMAND && claimRequested && rewardCommand == null)
            {
                rewardCommand = command;
                claimRequestsByPanel[quizPanel] = command;
                listenToCommand(rewardCommand, onRewardFinished);
                return;
            }
            if (getQualifiedClassName(command) != QUIZ_ANSWER_COMMAND) return;
            var view:Object = quizPanel.content;
            var questionNumber:int = readQuestionNumber(view);
            if (questionNumber >= 1 && questionNumber <= TOTAL_QUESTIONS &&
                int(command.questionIndex) == questionNumber - 1)
            {
                // The player may submit manually or the native timer may submit
                // its timeout answer while this runner is active. Observe that
                // request so the same question is never submitted twice.
                markSubmitted(quizPanel, questionNumber);
                if (questionNumber == activeQuestionNumber())
                {
                    submitted = true;
                    questionWait.restart();
                }
            }
        }

        private function onRewardFinished(event:Event):void
        {
            if (!running || event.currentTarget !== rewardCommand) return;
            forgetCommand(rewardCommand, onRewardFinished);
            rewardCommand = null;
            if (event.type == "faild")
            {
                if (quizPanel != null) delete claimRequestsByPanel[quizPanel];
                finish(DailyQueue.ABORT, "游戏未确认测验奖励已领取。");
                return;
            }
            claimConfirmed = true;
            if (hiddenAfterClaim)
            {
                finish(DailyQueue.COMPLETE, "忍者测验已完成。");
                return;
            }
            closeQuizPanel(quizPanel != null ? quizPanel.content : null);
        }

        private function activeQuestionNumber():int
        {
            if (activeKey == "") return 0;
            var separator:int = activeKey.indexOf("|");
            return separator > 0 ? int(activeKey.substring(0, separator)) : 0;
        }

        private static function listenToCommand(command:Object, listener:Function):void
        {
            command.addEventListener("loadingEnd", listener);
            command.addEventListener("faild", listener);
        }

        private static function forgetCommand(command:Object, listener:Function):void
        {
            if (command != null)
            {
                command.removeEventListener("loadingEnd", listener);
                command.removeEventListener("faild", listener);
            }
        }

        private function finish(status:String, message:String):void
        {
            if (!running)
            {
                return;
            }
            var callback:Function = onFinished;
            reset();
            if (callback != null)
            {
                callback(status, message);
            }
        }

        private function reset():void
        {
            panelWait.stop();
            questionWait.stop();
            if (timer != null)
            {
                timer.stop();
                timer.removeEventListener(TimerEvent.TIMER, timerListener);
                timer = null;
                timerListener = null;
            }
            if (owner != null)
            {
                owner.removeEventListener(Event.REMOVED_FROM_STAGE, onOwnerRemoved);
            }
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
                commandEvents.removeEventListener("commandLoadError", onCommandStopped);
                commandEvents.removeEventListener("commandCancel", onCommandStopped);
                commandEvents = null;
            }
            forgetCommand(navigation, onNavigationFinished);
            navigation = null;
            forgetCommand(rewardCommand, onRewardFinished);
            rewardCommand = null;
            quizPanel = null;
            activeKey = "";
            selectedFirst = false;
            submitted = false;
            choseMenu = false;
            claimRequested = false;
            claimConfirmed = false;
            closeRequested = false;
            hiddenAfterClaim = false;
        }
    }
}
