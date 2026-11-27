package task.commands
{
    import flash.events.EventDispatcher;

    public final class HrefEventCommand extends EventDispatcher
    {
        public static const DATA_WANTED_NPC:String = "wanted-npc";
        public function HrefEventCommand(route:String) {}
        public function call():void {}
    }
}
