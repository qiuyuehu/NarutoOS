package narutoos.daily
{
    public interface IDailyTask
    {
        function start():void;
        function cancel():void;
        function get running():Boolean;
    }
}
