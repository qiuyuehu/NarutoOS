import Foundation

func normalizedLanguage(_ value: Any?) -> String {
    guard let value=value as? String, ["zh-CN","en","pt-BR"].contains(value) else { return "zh-CN" }
    return value
}
// Only the native side reads macOS preferences. The fixture override never
// participates in an installed, non-fixture launch.
func systemPreferredLanguages() -> [String] {
    let env=ProcessInfo.processInfo.environment
    if env["NARUTO_C_FIXTURE"] == "1",let raw=env["NARUTO_C_PREFERRED_LANGUAGES"] {
        guard let data=raw.data(using:.utf8),let values=(try? JSONSerialization.jsonObject(with:data)) as? [String] else { return [] }
        return values
    }
    return Locale.preferredLanguages
}
func matchedInterfaceLanguage(_ preferredLanguages:[String]) -> String {
    for identifier in preferredLanguages {
        let primary=identifier.trimmingCharacters(in:.whitespacesAndNewlines).lowercased().components(separatedBy:CharacterSet(charactersIn:"-_")).first ?? ""
        switch primary {
        case "zh": return "zh-CN"
        case "en": return "en"
        case "pt": return "pt-BR"
        default: continue
        }
    }
    return "zh-CN"
}
// Presence matters: an explicit invalid value keeps the existing Chinese
// fallback; only an absent field opts into first-launch selection.
func initialInterfaceLanguage(_ preferences:[String:Any]) -> String {
    if preferences.keys.contains("language") { return normalizedLanguage(preferences["language"]) }
    return matchedInterfaceLanguage(systemPreferredLanguages())
}
// Read only, including before packaged startup has connected to the core.
func startupLanguage() -> String {
    let env=ProcessInfo.processInfo.environment
    var root=env["NARUTO_C_ROOT"]
    if root==nil, let i=CommandLine.arguments.firstIndex(of:"--fixture-root"),i+1<CommandLine.arguments.count { root=CommandLine.arguments[i+1] }
    if root==nil {
        do {
            let data=try Data(contentsOf:URL(fileURLWithPath:packagedLocationFile()))
            guard let pointer=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any],let path=pointer["root"] as? String,!path.isEmpty else { return "zh-CN" }
            root=path
        } catch {
            guard (error as NSError).domain==NSCocoaErrorDomain,(error as NSError).code==NSFileReadNoSuchFileError else { return "zh-CN" }
            root=defaultPackagedRoot()
        }
    }
    guard let root=root else { return "zh-CN" }
    let data:Data
    do { data=try Data(contentsOf:URL(fileURLWithPath:root+"/management.json")) }
    catch {
        guard (error as NSError).domain==NSCocoaErrorDomain,(error as NSError).code==NSFileReadNoSuchFileError else { return "zh-CN" }
        return initialInterfaceLanguage([:])
    }
    guard let state=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any],state["version"] as? Int==1,let prefs=state["preferences"] as? [String:Any] else { return "zh-CN" }
    return initialInterfaceLanguage(prefs)
}
var interfaceLanguage=startupLanguage()
private let messageCatalog: [String:[String:String]] = {
    let env=ProcessInfo.processInfo.environment
    let paths=[env["NARUTO_C_MESSAGES"],env["NARUTO_C_PROJECT"].map{$0+"/dist/shared/messages.json"},Bundle.main.resourceURL?.appendingPathComponent("app/dist/shared/messages.json").path].compactMap{$0}
    for path in paths {
        if let data=try? Data(contentsOf:URL(fileURLWithPath:path)),let value=(try? JSONSerialization.jsonObject(with:data)) as? [String:[String:String]] { return value }
    }
    return [:]
}()
func msg(_ key:String) -> String { "\u{E000}"+key+"\u{E001}" }
// Parameters travel with the retained message exactly like the JavaScript side:
// percent-encoded JSON after the key, so the same catalog and resolver are used.
func msg(_ key:String,_ params:[String:String]) -> String {
    guard !params.isEmpty,let data=try? JSONSerialization.data(withJSONObject:params,options:[.sortedKeys]),let text=String(data:data,encoding:.utf8) else { return msg(key) }
    var allowed=CharacterSet.alphanumerics
    allowed.insert(charactersIn:"-_.!~*'()")
    guard let encoded=text.addingPercentEncoding(withAllowedCharacters:allowed) else { return msg(key) }
    return "\u{E000}"+key+":"+encoded+"\u{E001}"
}
func messageCode(_ value:String) -> String {
    guard value.hasPrefix("\u{E000}") else { return value }
    return String(value.dropFirst().prefix{ $0 != ":" && $0 != "\u{E001}" })
}
private func messageParameters(_ value:String) -> [String:String] {
    guard let colon=value.firstIndex(of:":"),let end=value.lastIndex(of:"\u{E001}"),colon<end else { return [:] }
    let encoded=String(value[value.index(after:colon)..<end])
    guard let decoded=encoded.removingPercentEncoding,let data=decoded.data(using:.utf8),
          let object=(try? JSONSerialization.jsonObject(with:data)) as? [String:String] else { return [:] }
    return object
}
private func replacePlaceholders(_ template:String,_ params:[String:String]) -> String {
    guard !params.isEmpty,let expression=try? NSRegularExpression(pattern:"\\{([a-zA-Z0-9_]+)\\}") else { return template }
    let source=template as NSString
    let mutable=NSMutableString(string:template)
    let matches=expression.matches(in:template,range:NSRange(location:0,length:source.length))
    for match in matches.reversed() {
        guard match.numberOfRanges>1,let nameRange=Range(match.range(at:1),in:template) else { continue }
        let key=String(template[nameRange])
        let value=params[key] ?? source.substring(with:match.range(at:0))
        mutable.replaceCharacters(in:match.range(at:0),with:value)
    }
    return mutable as String
}
func localized(_ value:String,_ language:String?) -> String { localized(value,[:],language) }
func localized(_ value:String,_ params:[String:String]=[:],_ language:String?=nil) -> String {
    guard value.hasPrefix("\u{E000}") else { return value }
    let key=messageCode(value),locale=normalizedLanguage(language ?? interfaceLanguage)
    var merged=messageParameters(value)
    for (name,text) in params { merged[name]=text }
    guard let template=messageCatalog[key]?[locale] ?? messageCatalog[key]?["zh-CN"] else { return "[\(key)]" }
    return replacePlaceholders(template,merged)
}
