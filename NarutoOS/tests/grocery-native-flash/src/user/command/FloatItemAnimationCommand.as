package user.command
{
    import flash.geom.Point;

    public final class FloatItemAnimationCommand
    {
        public var data:Array;
        public var from:Point;

        public function FloatItemAnimationCommand(data:Array, from:Point)
        {
            this.data = data;
            this.from = from;
        }
    }
}
