package base {
    public final class ApplicationData {
        public static var singleton:ApplicationData=new ApplicationData();
        public var model:Object;
        public var selfInfo:Object={level:100};
        public function getModel(name:String):Object { return name=="ai.IAIPlugin" ? model : null; }
    }
}
