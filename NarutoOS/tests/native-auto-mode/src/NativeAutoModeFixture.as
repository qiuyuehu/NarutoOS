package {
    import bag.utils.BagUtils;
    import base.ApplicationData;
    import com.tencent.morefun.framework.apf.core.facade.Facade;
    import com.tencent.morefun.naruto.plugin.RSModel.modules.popup.system.TextBox;
    import com.tencent.morefun.naruto.plugin.ui.layer.LayerManager;
    import com.tencent.morefun.naruto.plugin.ui.box.BoxManager;
    import com.tencent.morefun.naruto.plugin.hud.view.userinfo.UserInfoView;
    import com.tencent.morefun.naruto.plugin.hud.ui.UserInfoUI;
    import com.tencent.morefun.naruto.plugin.ai.view.basePage.AIManageView;
    import def.BoxFlagDef;
    import fixture.Box;
    import fixture.NativeEvent;
    import flash.display.Sprite;
    import flash.events.Event;
    import flash.events.MouseEvent;
    import flash.external.ExternalInterface;
    import flash.utils.setTimeout;
    import narutoos.daily.DailyQueue;
    import narutoos.daily.NativeAutoMode;
    import narutoos.daily.DailyRegionFixture;
    import ui.command.ShowTextBoxCommand;

    [SWF(width=400, height=240, frameRate=30)]
    public final class NativeAutoModeFixture extends Sprite {
        private static const CARD_HTML:String = "<b>您今天为首次进入托管状态，需要<br>消耗<font color='#f0d647'>托管卡x1</font>，有效期持续到<font color='#f0d647'>次日5：00</font>，<br>是否确认进入托管状态？</b>";
        private static const CARD_HTML_PT_BR:String = "<b>Para que você entre em Modo Automático é preciso <br> gastar <font color='#f0d647'>1 Cartão Automático</font>, ele é eficaz até às <font color='#f0d647'>5:00 do próximo dia</font>. <br> Deseja entrar em Modo Automático?</b>";
        private static const CARD_FLAGS:int = BoxFlagDef.OK | BoxFlagDef.CANCEL;

        private var owner:Sprite = new Sprite();
        private var app:ApplicationData = ApplicationData.singleton;
        private var hud:UserInfoUI = new UserInfoUI();
        private var openCount:int;
        private var startCount:int;
        private var quitCount:int;
        private var confirmationCount:int;
        private var messages:Array = [];
        private var steps:Array;
        private var passes:Array = [];
        private var failures:Array = [];
        private var openHandler:Function;
        private var task:NativeAutoMode;
        private var latestTextBox:TextBox;
        private var phase:int;

        public function NativeAutoModeFixture() {
            var layer:Sprite = LayerManager.singleton.layer;
            var view:UserInfoView = new UserInfoView();
            addChild(layer);
            layer.addChild(view);
            view.addChild(hud);
            addChild(owner);
            hud.userMoneyBar.aiBtn.addEventListener(MouseEvent.CLICK, function(e:MouseEvent):void {
                openCount++;
                if (openHandler != null) openHandler();
            });
            ExternalInterface.addCallback("run", run);
        }

        private function run():String {
            steps = [alreadyOn, delayedPanel, confirmation, ownedCard, ownedCardPTBR, pendingOwnedPrompt, foreignTextBox, replacedPrompt, noCard,
                missingOwnedCard, currencyPrompt, wrongButton, stopAtCardPrompt, expiredCardPrompt,
                foreignModal, disabledStart, unknownState, stopPending, removePending, hiddenHud];
            setTimeout(next, 10);
            return "started";
        }

        private function next():void {
            try { advance(); }
            catch (error:Error) {
                failures.push("Case " + phase + ": " + error);
                sendResult();
            }
        }

        private function sendResult():void {
            ExternalInterface.call("nativeAutoModeResult", JSON.stringify({passes:passes, failures:failures}));
        }

        private function advance():void {
            if (phase == steps.length) {
                sendResult();
                return;
            }
            if (task != null) task.cancel();
            if (owner.parent == null) addChild(owner);
            for each (var box:Box in BoxManager.showingList)
            {
                if (box.parent === this) removeChild(box);
            }
            BoxManager.showingList = [];
            app.model = {isTrusteeshipping:false};
            BagUtils.model.cardCount = 1;
            hud.userMoneyBar.aiBtn.visible = true;
            openCount = startCount = quitCount = confirmationCount = 0;
            messages = [];
            openHandler = null;
            latestTextBox = null;
            task = new NativeAutoMode(owner, function(status:String, message:String):void {
                messages.push({status:status, message:message});
            });
            steps[phase++]();
        }

        private function expect(ok:Boolean, label:String):void {
            (ok ? passes : failures).push(label);
            setTimeout(next, 20);
        }

        private function completed(needle:String):Boolean {
            return messages.length == 1 && messages[0].status == DailyQueue.COMPLETE &&
                messages[0].message.indexOf(needle) >= 0 && !task.running;
        }

        private function panel(handler:Function = null):AIManageView {
            var view:AIManageView = new AIManageView();
            addChild(view);
            BoxManager.showingList.push(view);
            view.content.startBtn.addEventListener(MouseEvent.CLICK, function(e:MouseEvent):void {
                startCount++;
                if (handler != null) handler();
            });
            view.content.quitBtn.addEventListener(MouseEvent.CLICK, function(e:MouseEvent):void {quitCount++;});
            return view;
        }

        private function modal():Box {
            var box:Box = new Box();
            box.addEventListener(MouseEvent.CLICK, function(e:MouseEvent):void {confirmationCount++;});
            addChild(box);
            BoxManager.showingList.push(box);
            return box;
        }

        private function alreadyOn():void {
            app.model.isTrusteeshipping = true;
            task.start();
            expect(completed("已在托管") && openCount == 0 && startCount == 0 && quitCount == 0, "already active does not dispatch");
        }

        private function delayedPanel():void {
            app.model = null;
            var clickedEarly:Boolean = false;
            openHandler = function():void {
                setTimeout(function():void {
                    app.model = {isTrusteeshipping:false};
                    var view:AIManageView = panel(function():void {
                        setTimeout(function():void {app.model.isTrusteeshipping = true;}, 250);
                    });
                    setTimeout(function():void {
                        clickedEarly = startCount > 0;
                        view.content.page.visible = true;
                    }, 325);
                }, 100);
            };
            task.start();
            setTimeout(function():void {
                expect(completed("已开启") && openCount == 1 && startCount == 1 && !clickedEarly && quitCount == 0,
                    "loads native UI and settings, starts once and confirms model");
            }, 1100);
        }

        private function confirmation():void {
            openHandler = function():void {
                var view:AIManageView = panel(modal);
                view.content.page.visible = true;
            };
            task.start();
            setTimeout(function():void {
                expect(completed("等待玩家处理游戏原生提示") && openCount == 1 && startCount == 1 &&
                    confirmationCount == 0 && BoxManager.showingList.length == 2, "leaves confirmation to player");
            }, 400);
        }

        private function showTextPrompt(text:String, flags:int, delay:int = 0, onConfirm:Function = null,
                                        settleDelay:int = 0):void {
            var command:ShowTextBoxCommand = new ShowTextBoxCommand(text, flags, function():void {});
            var manager:Object = Facade.getInstance().commandManager;
            manager.dispatchEvent(new NativeEvent("commandRequest", command));
            var execute:Function = function():void {
                manager.dispatchEvent(new NativeEvent("commandExecute", command));
                latestTextBox = mountTextBox(text, flags, onConfirm);
                if (settleDelay > 0) setTimeout(function():void { command.dispatchEvent(new Event("loadingEnd")); }, settleDelay);
                else command.dispatchEvent(new Event("loadingEnd"));
            };
            if (delay > 0) setTimeout(execute, delay);
            else execute();
        }

        private function mountTextBox(text:String, flags:int, onConfirm:Function = null):TextBox {
            var box:TextBox = new TextBox(text, flags);
            box.content.ok.addEventListener(MouseEvent.CLICK, function(event:MouseEvent):void {
                confirmationCount++;
                if (onConfirm != null) onConfirm();
            });
            addChild(box);
            BoxManager.showingList.push(box);
            BoxManager.dispathcer.dispatchEvent(new NativeEvent("boxShow", box));
            return box;
        }

        private function readyPanel(handler:Function):void {
            panel(handler).content.page.visible = true;
            task.start();
        }

        private function ownedCard():void {
            var reportedEarly:Boolean = false;
            readyPanel(function():void {
                showTextPrompt(CARD_HTML, CARD_FLAGS, 20, function():void {
                    BagUtils.model.cardCount--;
                    setTimeout(function():void {
                        reportedEarly = messages.length > 0;
                        app.model.isTrusteeshipping = true;
                    }, 300);
                });
            });
            setTimeout(function():void {
                expect(completed("已开启") && startCount == 1 && confirmationCount == 1 &&
                    BagUtils.model.cardCount == 0 && !reportedEarly, "confirms one owned card and waits for the native model");
            }, 650);
        }

        private function ownedCardPTBR():void {
            var reportedEarly:Boolean = false;
            DailyRegionFixture.setBR(true);
            readyPanel(function():void {
                showTextPrompt(CARD_HTML_PT_BR, CARD_FLAGS, 20, function():void {
                    BagUtils.model.cardCount--;
                    setTimeout(function():void {
                        reportedEarly = messages.length > 0;
                        app.model.isTrusteeshipping = true;
                    }, 300);
                });
            });
            setTimeout(function():void {
                var success:Boolean = completed("已开启") && startCount == 1 && confirmationCount == 1 &&
                    BagUtils.model.cardCount == 0 && !reportedEarly;
                expect(success, "confirms the exact Portuguese first-entry card prompt");
                DailyRegionFixture.setBR(false);
            }, 650);
        }

        private function pendingOwnedPrompt():void {
            DailyRegionFixture.setBR(true);
            readyPanel(function():void {
                showTextPrompt(CARD_HTML, CARD_FLAGS, 0, function():void {
                    app.model.isTrusteeshipping = true;
                }, 800);
            });
            setTimeout(function():void {
                var waitedForLoading:Boolean = task.running && messages.length == 0 && confirmationCount == 0 &&
                    latestTextBox != null && latestTextBox.stage === owner.stage;
                setTimeout(function():void {
                    var finished:Boolean = completed("已开启") && confirmationCount == 1;
                    expect(waitedForLoading && finished,
                        "waits for its own card prompt loadingEnd before confirming (pending=" + waitedForLoading +
                        ", finished=" + finished + ", running=" + task.running + ", confirms=" + confirmationCount +
                        ", messages=" + messages.length + (messages.length ? ":" + messages[0].message : "") + ")");
                    DailyRegionFixture.setBR(false);
                }, 900);
            }, 250);
        }

        private function foreignTextBox():void {
            readyPanel(function():void {
                setTimeout(function():void { showTextPrompt(CARD_HTML, CARD_FLAGS); }, 20);
            });
            expectManualPrompt("keeps an identical prompt requested outside the start click");
        }

        private function replacedPrompt():void {
            readyPanel(function():void {
                showTextPrompt(CARD_HTML, CARD_FLAGS);
                removeChild(latestTextBox);
                BoxManager.showingList.pop();
                latestTextBox = mountTextBox(CARD_HTML, CARD_FLAGS);
            });
            expectManualPrompt("keeps an identical replacement box");
        }

        private function noCard():void {
            BagUtils.model.cardCount = 0;
            readyPanel(function():void {
                showTextPrompt("您当前没有托管卡，请先领取托管卡。", BoxFlagDef.OK | BoxFlagDef.CLOSE);
            });
            expectManualPrompt("keeps the native card collection prompt");
        }

        private function missingOwnedCard():void {
            readyPanel(function():void {
                showTextPrompt(CARD_HTML, CARD_FLAGS);
                BagUtils.model.cardCount = 0;
            });
            expectManualPrompt("keeps a matching prompt when the card is no longer owned");
        }

        private function currencyPrompt():void {
            readyPanel(function():void { showTextPrompt("是否消耗100元宝购买托管卡？", CARD_FLAGS); });
            expectManualPrompt("keeps the currency purchase prompt");
        }

        private function wrongButton():void {
            readyPanel(function():void {
                showTextPrompt(CARD_HTML, CARD_FLAGS);
                latestTextBox.content.ok.userData = BoxFlagDef.CLOSE;
            });
            expectManualPrompt("keeps a matching window with the wrong native button action");
        }

        private function expectManualPrompt(description:String, delay:int = 400):void {
            setTimeout(function():void {
                expect(completed("等待玩家处理游戏原生提示") && confirmationCount == 0 &&
                    latestTextBox != null && latestTextBox.stage === owner.stage, description);
            }, delay);
        }

        private function stopAtCardPrompt():void {
            readyPanel(function():void { showTextPrompt(CARD_HTML, CARD_FLAGS); });
            task.cancel();
            setTimeout(function():void {
                expect(!task.running && messages.length == 0 && confirmationCount == 0 &&
                    latestTextBox.stage === owner.stage, "stop leaves the current card confirmation untouched");
            }, 400);
        }

        private function expiredCardPrompt():void {
            readyPanel(function():void {
                showTextPrompt(CARD_HTML, CARD_FLAGS);
                latestTextBox.isShowing = false;
                setTimeout(function():void { latestTextBox.isShowing = true; }, 12200);
            });
            expectManualPrompt("keeps the card prompt after its confirmation deadline", 12500);
        }

        private function foreignModal():void {
            var view:AIManageView = panel();
            view.content.page.visible = true;
            modal();
            task.start();
            expect(completed("当前游戏窗口") && startCount == 0 && openCount == 0 && confirmationCount == 0, "does not click behind unrelated modal");
        }

        private function disabledStart():void {
            var view:AIManageView = panel();
            view.content.page.visible = true;
            view.content.startBtn.enabled = false;
            task.start();
            expect(completed("按钮当前不可用") && startCount == 0 && openCount == 0, "disabled start stays untouched");
        }

        private function unknownState():void {
            app.model = {isTrusteeshipping:0};
            var view:AIManageView = panel();
            view.content.page.visible = true;
            task.start();
            setTimeout(function():void {
                expect(completed("无法确认当前托管状态") && startCount == 0 && openCount == 0,
                    "a non-Boolean state times out without starting");
            }, 12500);
        }

        private function stopPending():void {
            cancelPending(task.cancel, "stop cancels while the native panel is loading");
        }

        private function removePending():void {
            cancelPending(function():void { removeChild(owner); }, "owner removal cancels while the native panel is loading");
        }

        private function cancelPending(stop:Function, description:String):void {
            openHandler = function():void {
                setTimeout(function():void { panel().content.page.visible = true; }, 225);
            };
            task.start();
            setTimeout(stop, 90);
            setTimeout(function():void {
                expect(!task.running && messages.length == 0 && startCount == 0 && openCount == 1, description);
            }, 500);
        }

        private function hiddenHud():void {
            hud.userMoneyBar.aiBtn.visible = false;
            task.start();
            expect(completed("托管入口当前不可用") && openCount == 0, "hidden HUD button stays untouched");
        }
    }
}
