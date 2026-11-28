package
{
    import flash.display.Sprite;
    import flash.external.ExternalInterface;
    import narutoos.daily.ExpeditionResetLabel;

    public final class ExpeditionResetLabelFixture extends Sprite
    {
        private var passes:Array = [];
        private var failures:Array = [];

        public function ExpeditionResetLabelFixture()
        {
            ExternalInterface.addCallback("run", run);
        }

        private function run():String
        {
            var richLabel:String = "<font size='14' face='Arial' COLOR=\"#FFFFFF\"><b>Renovar (restam 0 vezes) </b></font>";
            check("BR accepts the native rich-text label with trailing whitespace",
                ExpeditionResetLabel.matches(richLabel, 0, true));
            check("BR rejects a reset count that conflicts with the model",
                !ExpeditionResetLabel.matches(richLabel, 1, true));
            check("BR keeps accepting the localized Chinese reset label",
                ExpeditionResetLabel.matches("剩余 0 次", 0, true));
            check("CN keeps its original reset label behavior",
                ExpeditionResetLabel.matches("剩余 0 次", 0, false));
            check("CN does not accept the BR rich-text label",
                !ExpeditionResetLabel.matches(richLabel, 0, false));
            ExternalInterface.call("expeditionResetLabelResult", JSON.stringify({passes:passes, failures:failures}));
            return "started";
        }

        private function check(label:String, condition:Boolean):void
        {
            if (condition) passes.push(label);
            else failures.push(label);
        }
    }
}
