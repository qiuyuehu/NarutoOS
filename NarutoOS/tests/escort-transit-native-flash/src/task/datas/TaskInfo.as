package task.datas
{
    public final class TaskInfo
    {
        public var id:int;
        public var state:int;
        public var receiveTime:uint;
        public var cfg:Object;
        public var conditions:Array;
        public function TaskInfo(id:int, hard:int, state:int)
        {
            this.id = id; this.state = state; this.receiveTime = uint(id);
            conditions = [{state:0}];
            cfg = {hard:hard, conditions:[{data:"goto,12,99"}]};
        }
    }
}
