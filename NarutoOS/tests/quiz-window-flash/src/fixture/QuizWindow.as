package fixture
{
    import flash.display.Sprite;

    public class QuizWindow extends Sprite
    {
        public const modal:Boolean = true;
        public var isShow:Boolean = true;
        public var isShowing:Boolean = true;
        public var content:Sprite;

        public function QuizWindow(windowName:String, view:Sprite)
        {
            name = windowName;
            content = view;
            addChild(content);
        }
    }
}
