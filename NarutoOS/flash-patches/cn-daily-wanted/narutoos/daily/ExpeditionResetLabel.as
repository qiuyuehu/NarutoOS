package narutoos.daily
{
    /** Matches the localized reset-button count to the native expedition model. */
    public final class ExpeditionResetLabel
    {
        public static function matches(label:String, expectedCount:int, isBR:Boolean):Boolean
        {
            var text:String = label == null ? "" : label;
            var match:Array;
            if (isBR)
            {
                // Button.label can expose the native rich-text markup, including
                // formatting tags wrapped around the Portuguese caption.
                text = text.replace(/<[^>]*>/g, "").replace(/^\s+|\s+$/g, "");
                match = /剩余\s*(\d+)\s*次/.exec(text);
                if (match == null)
                    match = /^Renovar \(restam (\d+) vezes\)$/.exec(text);
            }
            else
            {
                // Preserve the original CN label parsing behavior.
                match = /剩余\s*(\d+)\s*次/.exec(text);
            }
            return match != null && int(match[1]) == expectedCount;
        }
    }
}
