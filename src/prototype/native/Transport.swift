import Foundation
import Darwin
import CryptoKit

enum ProtoError: Error { case failure(String) }
let protocolVersion = 1
func json(_ value: Any) throws -> Data { try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) }
func socketPath(_ root: String) -> String {
    let hash = SHA256.hash(data: Data(root.utf8)).map { String(format: "%02x", $0) }.joined().prefix(16)
    return "/tmp/naruto-c-\(getuid())-\(hash).sock"
}
func address(_ path: String) -> sockaddr_un {
    var value = sockaddr_un(); value.sun_family = sa_family_t(AF_UNIX)
    withUnsafeMutableBytes(of: &value.sun_path) { bytes in
        for (i, byte) in path.utf8.enumerated() { bytes[i] = byte }
        bytes[path.utf8.count] = 0
    }
    return value
}
func connectSocket(_ root: String) throws -> Int32 {
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    var addr = address(socketPath(root))
    let result = withUnsafePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) } }
    guard result == 0 else { close(fd); throw ProtoError.failure("核心暂未连接") }
    var timeout = timeval(tv_sec: 3, tv_usec: 0)
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
    return fd
}
func readLine(_ fd: Int32) throws -> Data {
    var data = Data(); var byte: UInt8 = 0
    while data.count < 262144 {
        let n = read(fd, &byte, 1)
        if n <= 0 { throw ProtoError.failure("连接已结束") }
        if byte == 10 { return data }; data.append(byte)
    }
    throw ProtoError.failure("消息过大")
}
func writeLine(_ fd: Int32, _ value: Any) throws {
    var data = try json(value); data.append(10)
    try data.withUnsafeBytes { bytes in
        var offset = 0
        while offset < bytes.count { let n = write(fd, bytes.baseAddress!.advanced(by: offset), bytes.count-offset); if n <= 0 { throw ProtoError.failure("发送失败") }; offset += n }
    }
}
func rpc(_ root: String, _ role: String, _ token: String, _ command: String, _ payload: [String:Any] = [:]) throws -> [String:Any] {
    let fd = try connectSocket(root); defer { close(fd) }
    try writeLine(fd, ["v":protocolVersion,"role":role,"token":token,"command":command,"payload":payload])
    guard let response = try JSONSerialization.jsonObject(with: readLine(fd)) as? [String:Any] else {throw ProtoError.failure("响应无效")}
    guard response["ok"] as? Bool == true else {throw ProtoError.failure(response["message"] as? String ?? "请求未获接受")}
    return response["value"] as? [String:Any] ?? [:]
}
func alive(_ pid: Int32) -> Bool { pid > 1 && kill(pid, 0) == 0 }
func roleLock(_ root: String, _ role: String) throws -> Int32 {
    let file = root + "/\(role).lock"
    let fd = open(file, O_CREAT | O_RDWR, mode_t(0o600))
    guard fd >= 0, flock(fd, LOCK_EX | LOCK_NB) == 0 else { if fd >= 0 { close(fd) }; throw ProtoError.failure("该角色已运行") }
    _ = fcntl(fd, F_SETFD, FD_CLOEXEC)
    return fd
}
func atomic(_ object: Any, _ file: String) throws {
    try json(object).write(to: URL(fileURLWithPath:file), options:.atomic)
    chmod(file, 0o600)
}

func packagedLocationFile() -> String {
    FileManager.default.homeDirectoryForCurrentUser.path + "/Library/Application Support/Naruto OS C/data-location.json"
}
func runtimeRootAllowed(_ root:String,_ project:String,_ env:[String:String]) -> Bool {
    if root.hasPrefix(project + "/.test-artifacts/native-core-") { return true }
    if env["NARUTO_C_DEV_REAL"] == "1" && env["NARUTO_C_FIXTURE"] != "1",
       let data=try? Data(contentsOf:URL(fileURLWithPath:packagedLocationFile())),
       let value=try? JSONSerialization.jsonObject(with:data) as? [String:Any],
       value["root"] as? String == root,
       FileManager.default.fileExists(atPath:root+"/management.json") { return true }
    guard env["NARUTO_C_PACKAGED"] == "1" else { return false }
    if env["NARUTO_C_FIXTURE"] == "1" {
        guard URL(fileURLWithPath:root).lastPathComponent.hasPrefix("native-core-package-check-"),URL(fileURLWithPath:root).deletingLastPathComponent().lastPathComponent==".test-artifacts",
              let data=try? Data(contentsOf:URL(fileURLWithPath:root+"/package-fixture.json")),let value=try? JSONSerialization.jsonObject(with:data) as? [String:Bool],value["fixture"]==true else {return false}
        return true
    }
    guard let data=try? Data(contentsOf:URL(fileURLWithPath:packagedLocationFile())),
          let value=try? JSONSerialization.jsonObject(with:data) as? [String:Any],
          value["root"] as? String == root else { return false }
    return true
}
