package narutoos.daily
{
    import flash.display.Stage;
    import flash.utils.getQualifiedClassName;

    internal final class QuizBox
    {
        private static const NAME:String = "QuizPanel";
        private static const NATIVE_CLASS:String = "com.tencent.morefun.naruto.plugin.quiz.view::QuizPanel";

        public static function matches(box:Object):Boolean
        {
            if (box == null) return false;
            // BR omits the BaseBox name argument, so its panel is named baseBox<N>.
            return (!DailyRegion.isBR && box.name == NAME) || getQualifiedClassName(box) == NATIVE_CLASS;
        }

        public static function find(manager:Object, stage:Stage):Object
        {
            if (!DailyRegion.isBR)
            {
                var named:Object = manager.getBoxByName(NAME);
                return isOpening(named, stage) ? named : null;
            }

            for each (var candidate:Object in manager.showingList)
            {
                if (matches(candidate) && isOpening(candidate, stage)) return candidate;
            }
            return null;
        }

        public static function isOpening(box:Object, stage:Stage):Boolean
        {
            return box != null && box.isShow && stage != null && box.stage === stage;
        }
    }
}
