package
{
    import com.tencent.morefun.framework.apf.core.facade.Facade;
    import com.tencent.morefun.naruto.plugin.quiz.view.QuizPanel;
    import com.tencent.morefun.naruto.plugin.ui.box.BoxManager;
    import fixture.QuizWindow;
    import flash.display.MovieClip;
    import flash.display.Sprite;
    import flash.events.MouseEvent;
    import flash.external.ExternalInterface;
    import flash.text.TextField;
    import flash.utils.setTimeout;
    import narutoos.daily.DailyRegionFixture;
    import narutoos.daily.QuizRun;
    import task.commands.HrefEventCommand;

    public final class QuizWindowFixture extends Sprite
    {
        private var passes:Array = [];
        private var failures:Array = [];

        public function QuizWindowFixture()
        {
            ExternalInterface.addCallback("run", run);
        }

        private function run():String
        {
            Facade.getInstance();
            var cases:Array = [
                { label:"BR resumes an already open dynamic-name quiz", br:true, name:"baseBox17", opening:"already", clicks:"select,submit", routes:0 },
                { label:"BR recognizes a dynamic-name quiz after open events", br:true, name:"baseBox18", opening:"events", clicks:"select,submit", routes:1 },
                { label:"BR finds a dynamic-name quiz when the open events are missed", br:true, name:"baseBox19", opening:"poll", clicks:"select,submit", routes:1 },
                { label:"CN recognizes the native quiz class on an open event", br:false, name:"baseBox17", opening:"events", clicks:"select,submit", routes:1 },
                { label:"CN resumes the named native quiz", br:false, name:"QuizPanel", opening:"already", clicks:"select,submit", routes:0 },
                { label:"ignores unrelated windows with either name and quiz-like content", br:true, name:"QuizPanel", opening:"unrelated", clicks:"", routes:1 }
            ];
            next(cases);
            return "started";
        }

        private function next(cases:Array):void
        {
            if (cases.length == 0)
            {
                ExternalInterface.call("quizWindowResult", JSON.stringify({passes:passes, failures:failures}));
                return;
            }

            var test:Object = cases.shift();
            DailyRegionFixture.setBR(test.br);
            var clicks:Array = [];
            var routes:int = 0;
            HrefEventCommand.onNavigate = function():void { routes++; };
            var runner:QuizRun = new QuizRun(this, function(status:String, message:String):void
            {
                failures.push(test.label + " finished unexpectedly: " + message);
            });

            var unrelated:Boolean = test.opening == "unrelated";
            var content:Sprite = questionView(test.br, clicks);
            var panel:QuizWindow = unrelated ? new QuizWindow(test.name, content) : new QuizPanel(test.name, content);
            if (unrelated)
            {
                show(new QuizWindow("baseBox23", questionView(test.br, clicks)));
                show(panel);
            }
            if (test.opening == "already") show(panel);
            runner.start();

            if (test.opening == "events" || test.opening == "poll")
            {
                setTimeout(function():void
                {
                    show(panel);
                    if (test.opening == "events") announceOpen(panel);
                }, 30);
            }
            else if (unrelated)
            {
                announceOpen(panel);
            }

            setTimeout(function():void
            {
                runner.cancel();
                if (clicks.join() == test.clicks && routes == test.routes) passes.push(test.label);
                else failures.push(test.label + ": clicks [" + clicks.join() + "], navigation count " + routes);
                BoxManager.showingList = [];
                removeChildren();
                next(cases);
            }, 650);
        }

        private function show(panel:QuizWindow):void
        {
            addChild(panel);
            BoxManager.showingList.push(panel);
        }

        private function announceOpen(panel:QuizWindow):void
        {
            panel.isShowing = false;
            BoxManager.dispathcer.dispatchEvent(new QuizBoxEvent("boxShow", panel));
            panel.isShowing = true;
            BoxManager.dispathcer.dispatchEvent(new QuizBoxEvent("boxShowed", panel));
        }

        private static function questionView(br:Boolean, clicks:Array):Sprite
        {
            var content:MovieClip = new MovieClip();
            content.leftText = new TextField();
            content.leftText.text = br ? "Perguntas restantes: 0" : "剩余题目：0";
            content.rewardArea = null;
            content.startAnimation = null;
            content.nextAnimation = null;
            var area:MovieClip = new MovieClip();
            content.questionArea = area;
            content.addChild(area);
            area.questionText = new TextField();
            area.questionText.htmlText = "<b>10.Teste ninja?</b>";
            area.rightAnimation = null;
            area.wrongAnimation = null;
            area.timeOutAnimation = null;
            area.answer0 = new Sprite();
            area.commitButton = new Sprite();
            area.commitButton.addEventListener(MouseEvent.CLICK, function(event:MouseEvent):void { clicks.push("submit"); });
            area.addChild(area.commitButton);
            area.addChild(new QuizTabBar(area.answer0, clicks));
            return content;
        }
    }
}

import fixture.QuizWindow;
import flash.display.MovieClip;
import flash.display.Sprite;
import flash.events.Event;
import flash.events.MouseEvent;

final class QuizTabBar extends Sprite
{
    private const answer:MovieClip = new MovieClip();
    public var selectedIndex:int = -1;

    public function QuizTabBar(firstSkin:Sprite, clicks:Array)
    {
        answer.skin = firstSkin;
        answer.addEventListener(MouseEvent.CLICK, function(event:MouseEvent):void
        {
            selectedIndex = 0;
            clicks.push("select");
        });
        addChild(answer);
    }

    public function getTabItemByIndex(index:int):Sprite
    {
        return index == 0 ? answer : null;
    }
}

final class QuizBoxEvent extends Event
{
    public var box:QuizWindow;

    public function QuizBoxEvent(type:String, box:QuizWindow)
    {
        super(type);
        this.box = box;
    }
}
