package bag.utils
{
    import narutoos.daily.DailyRegionFixture;

    public final class BagUtils
    {
        public static function createItemData(id:int):Object
        {
            return { id:id, name:DailyRegionFixture.isBR && !DailyRegionFixture.isChineseText ? "Chave da Caverna" : "洞穴密钥" };
        }
    }
}
