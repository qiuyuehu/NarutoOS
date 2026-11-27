import Foundation
import Darwin

// MARK: - Errors

enum UpdateFailure: Error {
    case message(String)
    var display: String {
        if case .message(let text) = self { return text }
        return msg("update.unknown_error")
    }
}

func updateFailure(_ key: String, _ params: [String: String] = [:]) -> UpdateFailure {
    .message(msg(key, params))
}

// MARK: - Contract

enum UpdateContract {
    static let repository = "qiuyuehu/NarutoOS"
    static let metadataURL = "https://api.github.com/repos/" + repository + "/releases/latest"
    static let releasePageURL = "https://github.com/" + repository + "/releases"
    static let maxMetadataRedirects = 3
    static let outerBundleID = "cn.youye.naruto-os"
    static let gameBundleID = "cn.youye.naruto-os.game"
    static let applicationName = "Naruto OS"
    static let standardApplicationPath = "/Applications/Naruto OS.app"
    static let appleSiliconAssetSuffix = "-macOS-AppleSilicon.zip"
    static let intelTestAssetSuffix = "-macOS-Intel-Test.zip"
    static let downloadHosts: Set<String> = ["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]
    static let maxRedirects = 6
    static let maxDownloadBytes: Int64 = 512 * 1024 * 1024
    static let maxExtractedBytes: Int64 = 2 * 1024 * 1024 * 1024
    static let maxZipEntries = 200_000
    static let maxNotesCharacters = 3000
    static let metadataTimeout: TimeInterval = 15
    static let downloadIdleTimeout: TimeInterval = 30
    static let downloadTotalTimeout: TimeInterval = 1800
    static let extractTimeout: TimeInterval = 900
    static let signatureTimeout: TimeInterval = 300
}

enum UpdateChannel: Equatable {
    case appleSilicon
    case intelTest

    var architecture: String {
        switch self {
        case .appleSilicon: return "arm64"
        case .intelTest: return "x86_64"
        }
    }

    var assetSuffix: String {
        switch self {
        case .appleSilicon: return UpdateContract.appleSiliconAssetSuffix
        case .intelTest: return UpdateContract.intelTestAssetSuffix
        }
    }

    static var current: UpdateChannel {
        #if arch(x86_64)
        return .intelTest
        #else
        return .appleSilicon
        #endif
    }

    var matchesCurrentArchitecture: Bool { self == Self.current }

    // Channel selection is based on the installed application's own metadata,
    // never on the package being downloaded or validated.
    static func installed(info: [String: Any]) -> UpdateChannel {
        if info["NarutoOSIntelTest"] as? Bool == true { return .intelTest }
        return .appleSilicon
    }
}

func expectedAssetName(for version: ReleaseVersion, channel: UpdateChannel = .current) -> String {
    "NarutoOS-" + version.description + channel.assetSuffix
}

// MARK: - Version

struct ReleaseVersion: Comparable, Equatable, CustomStringConvertible {
    let major: Int
    let minor: Int
    let patch: Int

    static func parse(_ raw: String) -> ReleaseVersion? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 24 else { return nil }
        var body = trimmed
        if body.hasPrefix("v") || body.hasPrefix("V") { body.removeFirst() }
        let parts = body.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3 else { return nil }
        var values: [Int] = []
        for part in parts {
            guard part.count >= 1, part.count <= 6, part.allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
            guard let value = Int(part), value >= 0, value <= 999_999 else { return nil }
            values.append(value)
        }
        return ReleaseVersion(major: values[0], minor: values[1], patch: values[2])
    }

    var description: String { "\(major).\(minor).\(patch)" }

    static func < (lhs: ReleaseVersion, rhs: ReleaseVersion) -> Bool {
        if lhs.major != rhs.major { return lhs.major < rhs.major }
        if lhs.minor != rhs.minor { return lhs.minor < rhs.minor }
        return lhs.patch < rhs.patch
    }
}

// MARK: - Tool runner

struct ToolResult {
    let status: Int32
    let stdout: Data
    let stderr: Data
}

func runTool(_ executable: String, _ arguments: [String], timeout: TimeInterval = 120, environment: [String: String]? = nil) throws -> ToolResult {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    if let environment = environment { process.environment = environment }
    process.standardInput = FileHandle.nullDevice
    let outPipe = Pipe()
    let errPipe = Pipe()
    process.standardOutput = outPipe
    process.standardError = errPipe
    let semaphore = DispatchSemaphore(value: 0)
    process.terminationHandler = { _ in semaphore.signal() }
    do {
        try process.run()
    } catch {
        throw updateFailure("update.tool_missing", ["p0": (executable as NSString).lastPathComponent])
    }
    var outData = Data()
    var errData = Data()
    let group = DispatchGroup()
    group.enter()
    DispatchQueue.global().async {
        outData = outPipe.fileHandleForReading.readDataToEndOfFile()
        group.leave()
    }
    group.enter()
    DispatchQueue.global().async {
        errData = errPipe.fileHandleForReading.readDataToEndOfFile()
        group.leave()
    }
    if semaphore.wait(timeout: .now() + timeout) == .timedOut {
        process.terminate()
        _ = semaphore.wait(timeout: .now() + 5)
        group.wait()
        throw updateFailure("update.tool_timeout")
    }
    group.wait()
    return ToolResult(status: process.terminationStatus, stdout: outData, stderr: errData)
}

// MARK: - File helpers

func pathIsSymlink(_ path: String) -> Bool {
    (try? FileManager.default.attributesOfItem(atPath: path)[.type]) as? FileAttributeType == .typeSymbolicLink
}

func pathIsDirectory(_ path: String) -> Bool {
    (try? FileManager.default.attributesOfItem(atPath: path)[.type]) as? FileAttributeType == .typeDirectory
}

func pathExists(_ path: String) -> Bool {
    FileManager.default.fileExists(atPath: path)
}

func fileOwnerMatches(_ path: String) -> Bool {
    guard let owner = (try? FileManager.default.attributesOfItem(atPath: path)[.ownerAccountID]) as? NSNumber else { return false }
    return owner.uint32Value == getuid()
}

func ensurePrivateDirectory(_ path: String) throws {
    if pathExists(path) {
        guard !pathIsSymlink(path), pathIsDirectory(path), fileOwnerMatches(path) else {
            throw updateFailure("update.directory_invalid")
        }
        try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: path)
        return
    }
    try FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    guard !pathIsSymlink(path), fileOwnerMatches(path) else { throw updateFailure("update.directory_invalid") }
    try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: path)
}

func removeItemIfExists(_ path: String) {
    try? FileManager.default.removeItem(atPath: path)
}

func atomicWriteJSON(_ value: Any, _ path: String) throws {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    try data.write(to: URL(fileURLWithPath: path), options: .atomic)
    chmod(path, 0o600)
}

func readJSONObject(_ path: String) throws -> [String: Any] {
    let data = try Data(contentsOf: URL(fileURLWithPath: path))
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw updateFailure("update.record_invalid")
    }
    return object
}

func availableCapacity(_ path: String) -> Int64? {
    guard let values = try? URL(fileURLWithPath: path).resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]) else { return nil }
    return values.volumeAvailableCapacityForImportantUsage
}

func directoryBytes(_ path: String) -> Int64? {
    var total: Int64 = 0
    guard let enumerator = FileManager.default.enumerator(atPath: path) else { return nil }
    for case let relative as String in enumerator {
        let full = path + "/" + relative
        if pathIsSymlink(full) { continue }
        if let size = (try? FileManager.default.attributesOfItem(atPath: full)[.size]) as? NSNumber {
            total += size.int64Value
        }
    }
    return total
}

func appendLog(_ path: String, _ kind: String, _ detail: String) {
    if let attributes = try? FileManager.default.attributesOfItem(atPath: path),
       let size = attributes[.size] as? NSNumber, size.intValue > 256 * 1024 {
        try? Data().write(to: URL(fileURLWithPath: path))
    }
    let safeDetail = detail.replacingOccurrences(of: "\n", with: " ")
    let line = ISO8601DateFormatter().string(from: Date()) + " " + kind + (safeDetail.isEmpty ? "" : " " + safeDetail) + "\n"
    guard let data = line.data(using: .utf8) else { return }
    if pathExists(path), let handle = FileHandle(forWritingAtPath: path) {
        handle.seekToEndOfFile()
        handle.write(data)
        try? handle.close()
    } else {
        try? data.write(to: URL(fileURLWithPath: path))
        chmod(path, 0o600)
    }
}

// MARK: - Process helpers

@_silgen_name("proc_pidpath")
private func c_proc_pidpath(_ pid: Int32, _ buffer: UnsafeMutableRawPointer?, _ buffersize: UInt32) -> Int32
@_silgen_name("proc_listchildpids")
private func c_proc_listchildpids(_ ppid: Int32, _ buffer: UnsafeMutableRawPointer?, _ buffersize: Int32) -> Int32

func processIsAlive(_ pid: Int32) -> Bool {
    pid > 1 && kill(pid, 0) == 0
}

func processExecutablePath(_ pid: Int32) -> String? {
    guard pid > 1 else { return nil }
    var buffer = [UInt8](repeating: 0, count: 4096)
    let length = c_proc_pidpath(pid, &buffer, UInt32(buffer.count))
    guard length > 0 else { return nil }
    return String(cString: buffer)
}

func processChildren(_ pid: Int32) -> [Int32] {
    guard pid > 1 else { return [] }
    var buffer = [Int32](repeating: 0, count: 4096)
    let count = c_proc_listchildpids(pid, &buffer, Int32(buffer.count * 4))
    guard count > 0 else { return [] }
    return Array(buffer.prefix(Int(count))).filter { $0 > 1 }
}

func processDescendants(_ pid: Int32) -> [Int32] {
    var result: [Int32] = []
    var queue = [pid]
    var seen = Set<Int32>()
    while let current = queue.popLast() {
        for child in processChildren(current) where !seen.contains(child) {
            seen.insert(child)
            result.append(child)
            queue.append(child)
        }
    }
    return result
}
