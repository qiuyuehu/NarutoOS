package dungeon.command
{
    public final class TeamNewDungeonFightCommand
    {
        public var dungeonId:int;
        public var difficulty:int;
        public function TeamNewDungeonFightCommand(dungeonId:int, difficulty:int)
        {
            this.dungeonId = dungeonId;
            this.difficulty = difficulty;
        }
    }
}
