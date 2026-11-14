import Foundation
import Security

// JSON over stdin/stdout; secrets never appear in process arguments or error messages.
struct Request: Decodable { let action: String; let service: String; let value: String? }
func output(_ value: [String: Any]) {
    if let bytes = try? JSONSerialization.data(withJSONObject: value) { FileHandle.standardOutput.write(bytes) }
}
do {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    let request = try JSONDecoder().decode(Request.self, from: input)
    guard request.service == "cn.youye.naruto-os.credentials" || request.service == "cn.youye.naruto-os.sessions" || request.service.hasPrefix("cn.youye.naruto-os.test.") else {
        output(["ok": false, "code": "invalid-service"]); exit(1)
    }
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: request.service, kSecAttrAccount as String: "vault-v1"]
    if request.action == "read" {
        var lookup = query; lookup[kSecReturnData as String] = true; lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &result)
        if status == errSecItemNotFound { output(["ok": true, "value": "[]"]) }
        else if status == errSecSuccess, let data = result as? Data, let value = String(data: data, encoding: .utf8) { output(["ok": true, "value": value]) }
        else { output(["ok": false, "code": Int(status)]) }
    } else if request.action == "list-partitions" {
        guard request.service == "cn.youye.naruto-os.sessions" || request.service.hasPrefix("cn.youye.naruto-os.test.sessions.") else {
            output(["ok": false, "code": "invalid-service"]); exit(1)
        }
        var lookup = query; lookup[kSecReturnData as String] = true; lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &result)
        if status == errSecItemNotFound { output(["ok": true, "value": "[]"]) }
        else if status == errSecSuccess, let data = result as? Data {
            do {
                let object = try JSONSerialization.jsonObject(with: data)
                if let empty = object as? [Any], empty.isEmpty { output(["ok": true, "value": "[]"]) }
                else if let stored = object as? [String: Any], (stored["version"] as? Int) == 1,
                        let partitions = stored["partitions"] as? [String: Any] {
                    let keys = partitions.keys.sorted()
                    let pattern = try NSRegularExpression(pattern: "^persist:naruto-(br|cn)-[1-9][0-9]*$")
                    let valid = keys.allSatisfy { key in
                        let range = NSRange(key.startIndex..<key.endIndex, in: key)
                        return pattern.firstMatch(in: key, range: range) != nil
                    }
                    if valid, let encoded = try? JSONSerialization.data(withJSONObject: keys), let value = String(data: encoded, encoding: .utf8) {
                        output(["ok": true, "value": value])
                    } else { output(["ok": false, "code": "invalid-session-data"]) }
                } else { output(["ok": false, "code": "invalid-session-data"]) }
            } catch { output(["ok": false, "code": "invalid-session-data"]) }
        } else { output(["ok": false, "code": Int(status)]) }
    } else if request.action == "write", let value = request.value, let data = value.data(using: .utf8) {
        var status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = query; item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            status = SecItemAdd(item as CFDictionary, nil)
        }
        output(["ok": status == errSecSuccess, "code": Int(status)])
    } else if request.action == "delete-test" && request.service.hasPrefix("cn.youye.naruto-os.test.") {
        let status = SecItemDelete(query as CFDictionary)
        output(["ok": status == errSecSuccess || status == errSecItemNotFound])
    } else { output(["ok": false, "code": "invalid-action"]) }
} catch { output(["ok": false, "code": "invalid-request"]) }
