package {
  import ai.commands.StartAICommand;
  import ai.def.AITypeDef;
  import base.ApplicationData;
  import com.tencent.morefun.framework.apf.core.facade.Facade;
  import com.tencent.morefun.naruto.plugin.RSModel.modules.popup.system.TextBox;
  import com.tencent.morefun.naruto.plugin.ui.box.BoxManager;
  import com.tencent.morefun.naruto.plugin.npc.views.TaskNpcDialog;
  import com.tencent.morefun.naruto.plugin.npc.views.TaskNpcDialogMenuRenderer;
  import fixture.NativeBox;
  import fixture.NativeEvent;
  import fixture.PopupContent;
  import fixture.SmartList;
  import fixture.TaskMenuContent;
  import fixture.WantedContent;
  import flash.display.DisplayObject;
  import flash.display.Sprite;
  import flash.events.Event;
  import flash.events.MouseEvent;
  import flash.external.ExternalInterface;
  import flash.geom.Point;
  import flash.text.TextField;
  import flash.utils.getTimer;
  import narutoos.daily.DailyAssistant;
  import task.commands.HrefEventCommand;
  import ui.command.ShowTextBoxCommand;

  [SWF(width="500", height="320", frameRate="30", backgroundColor="#102239")]
  public class WantedFixture extends Sprite {
    private static const WANTED_TEXT:String = "你现在为单人状态，继续进行通缉任务将无法获得双倍经验奖励，是否继续本操作？";
    private static const WANTED_TEXT_PT_BR:String = "Você está solo agora, caso realize Missões de Captura não receberá prêmios em dobro. Deseja prosseguir?";
    private var world:Sprite;
    private var owner:Sprite;
    private var overlay:Sprite;
    private var wanted:NativeBox;
    private var blocker:NativeBox;
    private var navCount:int;
    private var quizNav:int;
    private var nativeTips:int;
    private var clicks:int;
    private var yesCount:int;
    private var unrelatedYesCount:int;
    private var nativeStarts:int;
    private var mode:String;
    private var ai:StartAICommand;
    private var prompt:ShowTextBoxCommand;
    private var promptBox:TextBox;
    private var taskMenu:TaskNpcDialog;
    private var menuClicks:int;
    private var decoyClicks:int;
    private var startRequests:int;
    private var promptRequests:int;

    public function WantedFixture() {
      reset("direct");
      ExternalInterface.addCallback("perform", guarded);
    }

    private function guarded(action:String, arg:String):String {
      // ExternalInterface unescapes JSON backslashes in multi-line task summaries.
      try {
        return encodeURIComponent(perform(action, arg));
      } catch (error:Error) {
        return encodeURIComponent(JSON.stringify({fixtureError: String(error)}));
      }
      return "";
    }
    private function reset(testMode:String):void {
      if (world != null) removeChild(world);
      world = new Sprite();
      addChild(world);
      owner = new Sprite();
      world.addChild(owner);
      owner.graphics.beginFill(0x1C3552);
      owner.graphics.drawRect(0, 0, 500, 54);
      owner.graphics.endFill();
      overlay = new Sprite();
      world.addChild(overlay);
      BoxManager.owner = overlay;
      mode = testMode;
      if (testMode.indexOf("BR") >= 0 || testMode.indexOf("br") >= 0)
        DailyAssistant.installBR(owner, 70, 4);
      else DailyAssistant.install(owner, 70, 4);
      HrefEventCommand.onNavigate = function(data:String):void {
        if (data.indexOf("26000500") >= 0) ++quizNav;
        if (data == HrefEventCommand.DATA_WANTED_NPC) {
          ++navCount;
          if (ApplicationData.singleton.teamMember) ++nativeTips;
          if (mode == "teamAfterNav") {
            ApplicationData.singleton.teamIsJoined = true;
            ApplicationData.singleton.teamMembers = [{}, {}];
          }
        }
      };
      wanted = null;
      blocker = null;
      ai = null;
      prompt = null;
      promptBox = null;
      taskMenu = null;
      menuClicks = decoyClicks = startRequests = promptRequests = 0;
      navCount = quizNav = clicks = yesCount = unrelatedYesCount = nativeStarts = nativeTips = 0;
      ApplicationData.singleton.teamMember = mode == "teamMember";
      ApplicationData.singleton.teamIsJoined = mode == "teamMember" || mode == "teamCaptain";
      ApplicationData.singleton.teamMembers = mode == "teamCaptain" ? [{}, {}] :
        (mode == "teamMember" ? [{}] : []);
      ApplicationData.singleton.teamModelMissing = mode == "teamUnknown";
      ApplicationData.singleton.teamMembersUnknown = mode == "teamMembersUnknown";
      ApplicationData.singleton.stopAICalls = 0;
      ApplicationData.singleton.stoppedAIType = "";
      ApplicationData.singleton.task.wantedRemainderNum = 2;
      ApplicationData.singleton.rows = [{state: 0}];
      ApplicationData.singleton.isFightLock = false;
      ApplicationData.singleton.globelInfo = {sceneId: 1, sceneToId: 1};
      ApplicationData.singleton.battle.isFighting = false;
    }

    private function panel():Sprite {
      var modal:Sprite=stage.getChildByName("dailyAssistantModal") as Sprite;
      if(!modal)modal=assistant().getChildByName("dailyAssistantModal") as Sprite;
      return modal.getChildByName("panel") as Sprite;
    }

    private function assistant():Sprite {
      return owner.getChildByName("narutoosDailyAssistant") as Sprite;
    }

    private function controls():Sprite {
      var bar:Sprite = assistant();
      if (bar == null) return null;
      var anchored:Sprite = bar.getChildByName("dailyControls") as Sprite;
      if (anchored != null) return anchored;
      var elevated:Sprite = wanted == null ? null : wanted.getChildByName("dailyControls") as Sprite;
      return elevated == null ? bar : elevated;
    }

    private function positionOf(name:String):Object {
      var element:DisplayObject = name == "entry" ? controls().getChildByName("entry") : panel().getChildByName(name);
      var position:Point = element.localToGlobal(new Point(10, 11));
      var objects:Array = stage.getObjectsUnderPoint(position);
      return {x: position.x, y: position.y, stack: objects.map(function(item:Object, ...rest):String {
        return item.name + "/" + item.parent.name;
      })};
    }

    private function click(target:DisplayObject):void {
      target.dispatchEvent(new MouseEvent(MouseEvent.CLICK, true));
    }

    private function openWanted(ready:Boolean):void {
      var content:WantedContent = new WantedContent();
      var button:Sprite = new Sprite();
      button.mouseEnabled = ready;
      button.graphics.beginFill(0xB76834);
      button.graphics.drawRect(0, 0, 100, 25);
      button.graphics.endFill();
      button.addEventListener(MouseEvent.CLICK, nativeAutoClick);
      content.addChild(button);
      content.autoFinishBtn = button;
      wanted = new NativeBox("WantedNpcDialog", content);
      wanted.x = 300;
      wanted.y = 150;
      BoxManager.show(wanted);
    }

    private function openTaskMenu(kind:String):void {
      if (taskMenu != null) BoxManager.hide(taskMenu);
      taskMenu = new TaskNpcDialog(kind == "other" ? 26900624 : 26900623);
      var content:TaskMenuContent = taskMenu.content as TaskMenuContent;
      var tasks:SmartList = new SmartList();
      content.menus.addChild(tasks);
      var menuItems:SmartList = new SmartList();
      content.menus.addChild(menuItems);
      addMenuRow(tasks, "task", "openui,51", "通缉任务", false);
      addMenuRow(menuItems, "npcMenu", "openui,52", "通缉任务", false);
      addMenuRow(menuItems, "npcMenu", "openui,51", "其他", false);
      var wantedRow:TaskNpcDialogMenuRenderer = addMenuRow(menuItems, "npcMenu", "openui,51", "通缉任务", true);
      wantedRow.enabled = kind != "unavailable";
      if (kind == "ambiguous") addMenuRow(menuItems, "npcMenu", "openui,51", "通缉任务", true);
      BoxManager.show(taskMenu);
    }

    private function addMenuRow(list:Sprite, type:String, param:String, text:String, wanted:Boolean):TaskNpcDialogMenuRenderer {
      var row:TaskNpcDialogMenuRenderer = new TaskNpcDialogMenuRenderer(type, param, text);
      row.addEventListener(MouseEvent.CLICK, function(event:MouseEvent):void {
        if (wanted) ++menuClicks;
        else ++decoyClicks;
      });
      list.addChild(row);
      return row;
    }

    private function notify(type:String, command:Object):void {
      Facade.getInstance().commandManager.dispatchEvent(new NativeEvent(type, command));
    }

    private function requestPrompt(message:String, flags:uint = 3):ShowTextBoxCommand {
      var command:ShowTextBoxCommand = new ShowTextBoxCommand(message, flags, true);
      ++promptRequests;
      notify("commandRequest", command);
      return command;
    }

    private function executePrompt(command:ShowTextBoxCommand, controlled:Boolean, ready:Boolean = true):void {
      notify("commandExecute", command);
      var box:TextBox = new TextBox(command.text);
      var content:PopupContent = box.content as PopupContent;
      box.x = 300;
      box.y = 200;
      content.yesBtn.addEventListener(MouseEvent.CLICK, function(event:MouseEvent):void {
        if (controlled) {
          ++yesCount;
          ++nativeStarts;
        } else {
          ++unrelatedYesCount;
        }
        BoxManager.hide(box);
      });
      promptBox = box;
      BoxManager.show(box, ready);
      command.dispatchEvent(new Event("loadingEnd"));
    }

    private function nativeAutoClick(event:MouseEvent):void {
      ++clicks;
      if (mode == "blocked") {
        ++nativeTips;
        return;
      }
      ai = new StartAICommand(AITypeDef.WANTED);
      ++startRequests;
      notify("commandRequest", ai);
      if (mode == "startQueued") return;

      notify("commandExecute", ai);
      if (mode == "confirm") executePrompt(requestPrompt(WANTED_TEXT), true);
      else if (mode == "confirmBR") executePrompt(requestPrompt(WANTED_TEXT_PT_BR), true);
      else if (mode == "unrelated") executePrompt(requestPrompt("这是一个无关确认"), false);
      else if (mode == "wrongFlags") executePrompt(requestPrompt(WANTED_TEXT, 1), false);
      else if (mode == "direct" || mode == "directBR" || mode == "brDelayed") ++nativeStarts;
      else if (mode == "promptQueued") prompt = requestPrompt(WANTED_TEXT);
      else if (mode == "promptWait" || mode == "promptWaitBR") executePrompt(
        requestPrompt(mode == "promptWaitBR" ? WANTED_TEXT_PT_BR : WANTED_TEXT), true, false);
      ai.dispatchEvent(new Event("loadingEnd"));
    }

    private function perform(action:String, arg:String = ""):String {
      switch (action) {
        case "reset": reset(arg); break;
        case "hide": DailyAssistant.hide(owner); break;
        case "install": DailyAssistant.install(owner, 100, 4); break;
        case "point": return JSON.stringify(positionOf(arg));
        case "entry": click(controls().getChildByName("entry")); break;
        case "block":
          blocker = new NativeBox("UnrelatedDialog", new Sprite());
          BoxManager.show(blocker);
          break;
        case "unblock": BoxManager.hide(blocker); break;
        case "closeWanted": BoxManager.hide(wanted); break;
        case "stop": var runtime:Sprite=stage.getChildByName("narutoosDailyRuntimeControls") as Sprite; click(runtime.getChildByName("stop"));break;
        case "quiz": click(panel().getChildByName("quiz"));break;
        case "left": ApplicationData.singleton.task.wantedRemainderNum=int(arg);break;
        case "row": ApplicationData.singleton.rows=[{state:int(arg)}];break;
        case "lock": ApplicationData.singleton.isFightLock=arg=="1";break;
        case "sceneUnknown": ApplicationData.singleton.globelInfo={sceneId:1};break;
        case "sceneReady": ApplicationData.singleton.globelInfo={sceneId:1,sceneToId:1};break;
        case "select": click(panel().getChildByName("wanted")); break;
        case "execute": click(panel().getChildByName("execute")); break;
        case "openWanted": openWanted(arg == "ready"); break;
        case "ready": wanted.content["autoFinishBtn"].mouseEnabled = true; break;
        case "unowned": executePrompt(requestPrompt(WANTED_TEXT), false); break;
        case "clickPrompt": if (promptBox != null) click(PopupContent(promptBox.content).yesBtn); break;
        case "openTaskMenu": openTaskMenu(arg); break;
        case "startLoadError": notify("commandLoadError", ai); break;
        case "startCancel": notify("commandCancel", ai); break;
        case "otherLoadError": notify("commandLoadError", new StartAICommand(AITypeDef.WANTED)); break;
        case "executeQueuedPrompt": executePrompt(prompt, true, false); break;
        case "showDelayedPrompt": BoxManager.ready(promptBox); break;
        case "removeEntry": owner.removeChild(assistant()); break;
      }
      var current:Sprite = assistant();
      return JSON.stringify({
        gameTime: getTimer(),
        entry: current != null,
        drawn: current != null && controls().visible && controls().parent.visible,
        parentName: current == null || controls().parent == null ? "" : controls().parent.name,
        panel: current != null && panel().parent.visible,
        entryX: current == null ? -1 : current.x,
        selected: current == null ? "" : panel().getChildByName("wanted").accessibilityProperties.description,
        action: current == null ? "" : TextField(Sprite(panel().getChildByName("execute")).getChildAt(0)).text,
        status: current == null ? "" : TextField(panel().getChildByName("status")).text,
        quizNav:quizNav, navCount: navCount, clicks: clicks, yesCount: yesCount, unrelatedYesCount: unrelatedYesCount,
        nativeStarts: nativeStarts, nativeTips: nativeTips, menuClicks: menuClicks,
        decoyClicks: decoyClicks, startRequests: startRequests, promptRequests: promptRequests,
        stopAICalls: ApplicationData.singleton.stopAICalls,
        stoppedAIType: ApplicationData.singleton.stoppedAIType
      });
    }
  }
}
