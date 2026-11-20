import Foundation

@main struct CookieScopeCheck {
    @MainActor static func main() {
        let login = WebLoginPrototype()
        login.eventSink = { _ in }
        let base: [HTTPCookiePropertyKey: Any] = [.name: "synthetic_scope", .value: "ordinary", .domain: "naruto.narutowebgame.com", .path: "/"]
        var partitioned = base
        partitioned[HTTPCookiePropertyKey("StoragePartition")] = "https://partition.test"
        partitioned[.value] = "partitioned"
        let plain = HTTPCookie(properties: base)!
        let scoped = HTTPCookie(properties: partitioned)!
        precondition(scoped.properties?[HTTPCookiePropertyKey("StoragePartition")] as? String == "https://partition.test")
        let records = login.records([plain, scoped])
        precondition(records.count == 1 && records[0]["value"] as? String == "ordinary")
        print("PASS partitioned Cookie stays out of unpartitioned Flash snapshot")
    }
}
