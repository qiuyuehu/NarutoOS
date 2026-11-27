package com.tencent.morefun.naruto.plugin.ui.box
{
    public final class BoxManager
    {
        public static var showingList:Array = [];

        public static function hideBoxByName(name:String):void
        {
            for (var index:int = 0; index < showingList.length; index++)
            {
                var box:Object = showingList[index];
                if (box.name != name) continue;
                showingList.splice(index, 1);
                box.isShow = false;
                return;
            }
        }
    }
}
