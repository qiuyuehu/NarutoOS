import Foundation

@main struct CookieScopeCheck {
    @MainActor static func main() {
        if CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--credential-picker" {
            CredentialPickerCheck.run(URL(string: CommandLine.arguments[2])!)
            return
        }
        checkExportScope()
        checkSeedDecode()
    }

    private static func checkExportScope() {
        let base: [HTTPCookiePropertyKey: Any] = [.name: "synthetic_scope", .value: "ordinary", .domain: "naruto.narutowebgame.com", .path: "/"]
        var partitioned = base
        partitioned[HTTPCookiePropertyKey("StoragePartition")] = "https://partition.test"
        partitioned[.value] = "partitioned"
        let plain = HTTPCookie(properties: base)!
        let scoped = HTTPCookie(properties: partitioned)!
        precondition(scoped.properties?[HTTPCookiePropertyKey("StoragePartition")] as? String == "https://partition.test")
        let result = WebLoginCookies.exportRecords([plain, scoped], isFixture: false)
        precondition(result.records.count == 1 && result.records[0]["value"] as? String == "ordinary")
        precondition(result.partitionedExcluded == 1)
        print("PASS partitioned Cookie stays out of unpartitioned Flash snapshot")

        let target = "s776-narutopt.oasgames.com", other = "s777-narutopt.oasgames.com"
        let targetCookie = HTTPCookie(properties: base.merging([.domain: target]) { _, new in new })!
        let otherCookie = HTTPCookie(properties: base.merging([.domain: other]) { _, new in new })!
        let fixtureCookie = HTTPCookie(properties: base.merging([.domain: "127.0.0.1"]) { _, new in new })!
        let candidates = [plain, scoped, targetCookie, otherCookie, fixtureCookie]

        let handoff = WebLoginCookies.exportRecords(candidates, target: target, isFixture: false)
        precondition(handoff.records.compactMap { $0["domain"] as? String } == [plain.domain, target])
        precondition(handoff.partitionedExcluded == 1)
        let snapshot = WebLoginCookies.exportRecords(candidates, isFixture: false)
        precondition(snapshot.records.compactMap { $0["domain"] as? String } == [plain.domain, target, other])
        let fixture = WebLoginCookies.exportRecords(candidates, target: "127.0.0.1", isFixture: true)
        precondition(fixture.records.compactMap { $0["domain"] as? String } == ["127.0.0.1"])
        precondition(fixture.partitionedExcluded == 0)
        print("PASS handoff, session snapshot and loopback fixture retain their Cookie scopes")
    }

    private static func checkSeedDecode() {
        let expiry = Date().addingTimeInterval(3600).timeIntervalSince1970.rounded()
        let session: [String: Any] = ["name": "synthetic_session", "value": "session", "domain": "naruto.narutowebgame.com",
                                     "path": "/", "secure": false, "httpOnly": false, "hostOnly": true, "session": true, "sameSite": "lax"]
        let persistent = session.merging(["name": "synthetic_persistent", "domain": ".oasgames.com", "path": "/game",
                                           "secure": true, "httpOnly": true, "hostOnly": false, "session": false,
                                           "sameSite": "strict", "expirationDate": expiry]) { _, new in new }
        let cookies = WebLoginCookies.decodeSeed([session, persistent], isFixture: false)!
        let records = WebLoginCookies.exportRecords(cookies, isFixture: false).records
        precondition(records.count == 2)
        precondition(NSDictionary(dictionary: records[0]).isEqual(to: session))
        precondition(NSDictionary(dictionary: records[1]).isEqual(to: persistent))

        let loopback = session.merging(["domain": "127.0.0.1"]) { _, new in new }
        precondition(WebLoginCookies.decodeSeed([loopback], isFixture: true)?.first?.domain == "127.0.0.1")
        precondition(WebLoginCookies.decodeSeed([loopback, session], isFixture: true) == nil)
        for change: [String: Any] in [["domain": "unrelated.test"], ["hostOnly": true], ["sameSite": "invalid"],
                                       ["expirationDate": Double.infinity]] {
            let invalid = persistent.merging(change) { _, new in new }
            precondition(WebLoginCookies.decodeSeed([session, invalid], isFixture: false) == nil)
        }
        precondition(WebLoginCookies.decodeSeed(Array(repeating: session, count: 257), isFixture: false) == nil)
        print("PASS seed preserves Cookie attributes and rejects an invalid batch in full")
    }
}
