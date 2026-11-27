package bag.utils
{
    public final class BagUtils
    {
        public static const model:BagUtils = new BagUtils();
        public var cardCount:int;

        public function BagUtils() { }

        public function getTotalItemNumById(itemId:int):int
        {
            return itemId == 10840007 ? cardCount : 0;
        }
    }
}
