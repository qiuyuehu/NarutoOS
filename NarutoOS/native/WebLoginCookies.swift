import Foundation

enum WebLoginCookies {
    private static func allowedCookieHost(_ domain: String, target: String? = nil, isFixture: Bool) -> Bool {
        let host = domain.hasPrefix(".") ? String(domain.dropFirst()) : domain
        if isFixture { return host == "127.0.0.1" }
        let auth = ["oasgames.com", "narutowebgame.com", "naruto.narutowebgame.com", "naruto.oasgames.com", "passport.oasgames.com", "passport.narutowebgame.com"]
        if auth.contains(host) { return true }
        if let target = target { return host == target }
        return host.range(of: #"^(?:s\d+-naruto(?:pt|br)?|naruto-(?:pt|br)(?:-s?\d+)?)\.oasgames\.com$"#, options: .regularExpression) != nil
    }

    static func exportRecords(_ cookies: [HTTPCookie], target: String? = nil, isFixture: Bool)
        -> (records: [[String: Any]], partitionedExcluded: Int) {
        let allowed = cookies.filter { allowedCookieHost($0.domain, target: target, isFixture: isFixture) }
        // Modern WebKit includes CHIPS cookies in getAllCookies. Electron 11
        // has no partition key: flattening them would collide with ordinary
        // cookies and widen their scope. Keep them in WK only.
        let transferable = allowed.filter {
            (($0.properties?[HTTPCookiePropertyKey("StoragePartition")] as? String) ?? "").isEmpty
        }
        let records = transferable.map { cookie -> [String: Any] in
            let temporary = cookie.isSessionOnly || cookie.expiresDate == nil
            var value: [String: Any] = ["name": cookie.name, "value": cookie.value, "domain": cookie.domain,
                "path": cookie.path, "secure": cookie.isSecure, "httpOnly": cookie.isHTTPOnly,
                "hostOnly": !cookie.domain.hasPrefix("."), "session": temporary]
            if !temporary, let expiry = cookie.expiresDate { value["expirationDate"] = expiry.timeIntervalSince1970 }
            if let sameSite = cookie.sameSitePolicy { value["sameSite"] = sameSite.rawValue.lowercased() }
            return value
        }
        return (records, allowed.count - transferable.count)
    }

    static func decodeSeed(_ list: [[String: Any]], isFixture: Bool) -> [HTTPCookie]? {
        guard list.count <= 256 else { return nil }
        var cookies: [HTTPCookie] = []
        for record in list {
            guard let name = record["name"] as? String, !name.isEmpty, name.utf8.count <= 256,
                  let value = record["value"] as? String, value.utf8.count <= 8192,
                  let domain = record["domain"] as? String, allowedCookieHost(domain, isFixture: isFixture),
                  let path = record["path"] as? String, path.hasPrefix("/"),
                  let secure = record["secure"] as? Bool, let httpOnly = record["httpOnly"] as? Bool,
                  let hostOnly = record["hostOnly"] as? Bool, hostOnly == !domain.hasPrefix("."),
                  let temporary = record["session"] as? Bool else { return nil }
            var properties: [HTTPCookiePropertyKey: Any] = [.name: name, .value: value, .domain: domain, .path: path]
            // Foundation treats the Secure key's presence as true, even "FALSE".
            if secure { properties[.secure] = "TRUE" }
            if httpOnly { properties[HTTPCookiePropertyKey("HttpOnly")] = "TRUE" }
            if temporary { properties[.discard] = "TRUE" }
            else if let expiry = record["expirationDate"] as? Double, expiry.isFinite { properties[.expires] = Date(timeIntervalSince1970: expiry) }
            else { return nil }
            if let sameSite = record["sameSite"] as? String {
                guard ["lax", "strict", "none"].contains(sameSite) else { return nil }
                properties[.sameSitePolicy] = sameSite
            }
            guard let cookie = HTTPCookie(properties: properties) else { return nil }
            cookies.append(cookie)
        }
        return cookies
    }
}
