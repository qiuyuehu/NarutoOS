package narutoos.daily
{
    /** Small deterministic progress adapter for the isolated TeamDungeonRun fixture. */
    public final class TeamDungeonProgress
    {
        public static var currentCompleted:int;
        public static var handoff:Boolean = true;

        public static function completed():int { return currentCompleted; }
        public static function canHandoff(application:Object):Boolean { return handoff; }
    }
}
