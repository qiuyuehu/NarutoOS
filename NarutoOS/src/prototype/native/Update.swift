import Foundation
import CryptoKit
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
    static let assetSuffix = "-macOS-AppleSilicon.zip"
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

func expectedAssetName(for version: ReleaseVersion) -> String {
    "NarutoOS-" + version.description + UpdateContract.assetSuffix
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

// MARK: - URL policy

enum UpdateURLPolicy {
    static func isLocalHost(_ host: String) -> Bool {
        host == "127.0.0.1" || host == "::1" || host == "localhost"
    }

    static func allowedDownloadHost(_ host: String, allowLocal: Bool) -> Bool {
        if UpdateContract.downloadHosts.contains(host) { return true }
        return allowLocal && isLocalHost(host)
    }

    static func checkMetadataURL(_ url: URL, allowLocal: Bool) -> Bool {
        guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased(),
              url.user == nil, url.password == nil else { return false }
        if allowLocal && isLocalHost(host) { return scheme == "http" || scheme == "https" }
        return scheme == "https" && host == "api.github.com" && url.port == nil && url.query == nil
    }

    static func checkAssetURL(_ url: URL, assetName: String, allowLocal: Bool) -> Bool {
        guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased(),
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else { return false }
        if allowLocal && isLocalHost(host) { return scheme == "http" || scheme == "https" }
        guard scheme == "https", host == "github.com", url.port == nil else { return false }
        guard url.path.hasPrefix("/" + UpdateContract.repository + "/releases/download/") else { return false }
        let last = url.path.split(separator: "/").last.map(String.init) ?? ""
        return last == assetName
    }

    static func checkMetadataRedirectURL(_ url: URL, allowLocal: Bool) -> Bool {
        guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased(),
              url.user == nil, url.password == nil else { return false }
        if allowLocal && isLocalHost(host) { return scheme == "http" || scheme == "https" }
        return scheme == "https" && host == "api.github.com" && url.port == nil
    }

    static func checkRedirectURL(_ url: URL, allowLocal: Bool) -> Bool {
        guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased(),
              url.user == nil, url.password == nil else { return false }
        if allowLocal && isLocalHost(host) { return scheme == "http" || scheme == "https" }
        return scheme == "https" && allowedDownloadHost(host, allowLocal: false)
    }
}

// MARK: - Digest

func parseSHA256Digest(_ raw: String) -> String? {
    let text = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard text.hasPrefix("sha256:") else { return nil }
    let hex = String(text.dropFirst("sha256:".count))
    guard hex.count == 64, hex.allSatisfy({ $0.isHexDigit && $0.isASCII }) else { return nil }
    return hex
}

// MARK: - Release payload

struct UpdateReleaseAsset {
    let id: Int64
    let name: String
    let size: Int64
    let digest: String
    let downloadURL: URL
}

struct UpdateReleaseHeader {
    let releaseID: Int64
    let tag: String
    let version: ReleaseVersion
    let notes: String
}

struct UpdateReleasePayload {
    let header: UpdateReleaseHeader
    let object: [String: Any]
}

struct UpdateRelease {
    let releaseID: Int64
    let tag: String
    let version: ReleaseVersion
    let notes: String
    let asset: UpdateReleaseAsset
}

func parseReleaseHeader(_ object: [String: Any]) throws -> UpdateReleaseHeader {
    if object["draft"] as? Bool == true || object["prerelease"] as? Bool == true {
        throw updateFailure("update.release_not_stable")
    }
    guard let tag = object["tag_name"] as? String, let version = ReleaseVersion.parse(tag) else {
        throw updateFailure("update.release_invalid")
    }
    guard let releaseID = (object["id"] as? NSNumber)?.int64Value else {
        throw updateFailure("update.release_invalid")
    }
    let notes = ((object["body"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    return UpdateReleaseHeader(releaseID: releaseID, tag: tag, version: version, notes: notes)
}

func parseReleaseAsset(_ object: [String: Any], version: ReleaseVersion, allowLocal: Bool) throws -> UpdateReleaseAsset {
    guard let assets = object["assets"] as? [[String: Any]] else {
        throw updateFailure("update.asset_missing")
    }
    let expected = expectedAssetName(for: version)
    let matches = assets.filter { ($0["name"] as? String) == expected && ($0["state"] as? String ?? "uploaded") == "uploaded" }
    guard matches.count == 1 else { throw updateFailure("update.asset_missing") }
    let entry = matches[0]
    guard let assetID = (entry["id"] as? NSNumber)?.int64Value else { throw updateFailure("update.release_invalid") }
    guard let size = (entry["size"] as? NSNumber)?.int64Value, size > 0, size <= UpdateContract.maxDownloadBytes else {
        throw updateFailure("update.asset_size_invalid")
    }
    guard let digestRaw = entry["digest"] as? String, let digest = parseSHA256Digest(digestRaw) else {
        throw updateFailure("update.asset_digest_missing")
    }
    guard let urlText = entry["browser_download_url"] as? String,
          let url = URL(string: urlText),
          UpdateURLPolicy.checkAssetURL(url, assetName: expected, allowLocal: allowLocal) else {
        throw updateFailure("update.asset_url_invalid")
    }
    return UpdateReleaseAsset(id: assetID, name: expected, size: size, digest: digest, downloadURL: url)
}

// The asset is only validated after the version is known to be newer: an older
// release with a non-conforming asset name must not turn "up to date" into an error.
func parseReleasePayload(_ object: [String: Any], allowLocal: Bool) throws -> UpdateRelease {
    let header = try parseReleaseHeader(object)
    let asset = try parseReleaseAsset(object, version: header.version, allowLocal: allowLocal)
    return UpdateRelease(releaseID: header.releaseID, tag: header.tag, version: header.version, notes: header.notes, asset: asset)
}

// MARK: - Metadata

final class UpdateMetadataClient: NSObject, URLSessionTaskDelegate {
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var completion: ((Result<UpdateReleasePayload, UpdateFailure>) -> Void)?
    private var redirectFailure: UpdateFailure?
    private var redirects = 0
    private let allowLocal: Bool
    private let metadataURL: URL?

    init(allowLocal: Bool, metadataURL: URL? = nil) {
        self.allowLocal = allowLocal
        self.metadataURL = metadataURL
        super.init()
    }

    func fetch(completion: @escaping (Result<UpdateReleasePayload, UpdateFailure>) -> Void) {
        self.completion = completion
        perform(direct: false)
    }

    // The system proxy is the normal path. A shared proxy exit can be rate limited
    // (GitHub returns 403/429 for the shared IP) or unreachable; retry once without
    // the proxy so an update check is not blocked by that environment.
    private func perform(direct: Bool) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = UpdateContract.metadataTimeout
        configuration.timeoutIntervalForResource = UpdateContract.metadataTimeout * 2
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        // Local test servers must not be reached through the user's system proxy.
        if allowLocal || direct { configuration.connectionProxyDictionary = [:] }
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        self.session = session
        guard let url = metadataURL ?? URL(string: UpdateContract.metadataURL) else {
            finish(.failure(updateFailure("update.release_invalid")))
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        request.setValue("NarutoOS-Update/1", forHTTPHeaderField: "User-Agent")
        let task = session.dataTask(with: request) { [weak self] data, response, error in
            guard let self = self else { return }
            if let failure = self.redirectFailure {
                self.finish(.failure(failure))
                return
            }
            if let error = error {
                let code = (error as NSError).code
                if code == NSURLErrorCancelled { self.finish(.failure(updateFailure("update.cancelled"))); return }
                if self.canRetryDirect(direct) { self.retryDirect(); return }
                self.finish(.failure(updateFailure("update.check_network")))
                return
            }
            guard let http = response as? HTTPURLResponse else {
                if self.canRetryDirect(direct) { self.retryDirect(); return }
                self.finish(.failure(updateFailure("update.release_invalid")))
                return
            }
            if http.statusCode == 403 || http.statusCode == 429 {
                if self.canRetryDirect(direct) { self.retryDirect(); return }
                self.finish(.failure(updateFailure("update.check_http", ["p0": String(http.statusCode)])))
                return
            }
            guard http.statusCode == 200 else {
                if http.statusCode >= 500, self.canRetryDirect(direct) { self.retryDirect(); return }
                self.finish(.failure(updateFailure("update.check_http", ["p0": String(http.statusCode)])))
                return
            }
            if let finalURL = http.url, !UpdateURLPolicy.checkMetadataURL(finalURL, allowLocal: self.allowLocal) {
                self.finish(.failure(updateFailure("update.check_network")))
                return
            }
            guard let data = data, let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                self.finish(.failure(updateFailure("update.release_invalid")))
                return
            }
            do {
                let header = try parseReleaseHeader(object)
                self.finish(.success(UpdateReleasePayload(header: header, object: object)))
            } catch let failure as UpdateFailure {
                self.finish(.failure(failure))
            } catch {
                self.finish(.failure(updateFailure("update.release_invalid")))
            }
        }
        self.task = task
        task.resume()
    }

    private func canRetryDirect(_ direct: Bool) -> Bool {
        !direct && !allowLocal
    }

    private func retryDirect() {
        redirectFailure = nil
        redirects = 0
        task?.cancel()
        task = nil
        session?.invalidateAndCancel()
        session = nil
        perform(direct: true)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard let url = request.url, UpdateURLPolicy.checkMetadataRedirectURL(url, allowLocal: allowLocal) else {
            redirectFailure = updateFailure("update.redirect_rejected")
            completionHandler(nil)
            return
        }
        redirects += 1
        if redirects > UpdateContract.maxMetadataRedirects {
            redirectFailure = updateFailure("update.redirect_rejected")
            completionHandler(nil)
            return
        }
        completionHandler(request)
    }

    func cancel() {
        task?.cancel()
        task = nil
    }

    private func finish(_ result: Result<UpdateReleasePayload, UpdateFailure>) {
        DispatchQueue.main.async {
            let callback = self.completion
            self.completion = nil
            self.task = nil
            self.session?.invalidateAndCancel()
            self.session = nil
            callback?(result)
        }
    }
}

// MARK: - Download

final class UpdateDownloader: NSObject, URLSessionDataDelegate {
    struct ResultValue {
        let bytes: Int64
        let digest: String
    }

    private let destination: String
    private let expectedSize: Int64
    private let expectedDigest: String
    private let allowLocal: Bool
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var fileHandle: FileHandle?
    private var hasher = SHA256()
    private var received: Int64 = 0
    private var redirects = 0
    private var cancelled = false
    private var failed: UpdateFailure?
    private var completion: ((Result<ResultValue, UpdateFailure>) -> Void)?
    private var progress: ((Int64, Int64) -> Void)?
    private let queue = DispatchQueue(label: "Naruto.Update.Download")

    init(destination: String, expectedSize: Int64, expectedDigest: String, allowLocal: Bool) {
        self.destination = destination
        self.expectedSize = expectedSize
        self.expectedDigest = expectedDigest
        self.allowLocal = allowLocal
        super.init()
    }

    func start(url: URL, progress: @escaping (Int64, Int64) -> Void, completion: @escaping (Result<ResultValue, UpdateFailure>) -> Void) {
        self.progress = progress
        self.completion = completion
        FileManager.default.createFile(atPath: destination, contents: nil, attributes: [.posixPermissions: 0o600])
        guard let handle = FileHandle(forWritingAtPath: destination) else {
            finish(.failure(updateFailure("update.download_failed")))
            return
        }
        fileHandle = handle
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = UpdateContract.downloadIdleTimeout
        configuration.timeoutIntervalForResource = UpdateContract.downloadTotalTimeout
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        if allowLocal { configuration.connectionProxyDictionary = [:] }
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: OperationQueue())
        self.session = session
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("NarutoOS-Update/1", forHTTPHeaderField: "User-Agent")
        let task = session.dataTask(with: request)
        self.task = task
        task.resume()
    }

    func cancel() {
        queue.sync { cancelled = true }
        task?.cancel()
    }

    private func finish(_ result: Result<ResultValue, UpdateFailure>) {
        DispatchQueue.main.async {
            let callback = self.completion
            self.completion = nil
            self.task = nil
            self.session?.invalidateAndCancel()
            self.session = nil
            try? self.fileHandle?.close()
            self.fileHandle = nil
            if case .failure = result { try? FileManager.default.removeItem(atPath: self.destination) }
            callback?(result)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        queue.async {
            guard let url = request.url, UpdateURLPolicy.checkRedirectURL(url, allowLocal: self.allowLocal) else {
                self.failed = updateFailure("update.redirect_rejected")
                completionHandler(nil)
                return
            }
            self.redirects += 1
            if self.redirects > UpdateContract.maxRedirects {
                self.failed = updateFailure("update.redirect_rejected")
                completionHandler(nil)
                return
            }
            completionHandler(request)
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        queue.async {
            if self.failed != nil { completionHandler(.cancel); return }
            guard let http = response as? HTTPURLResponse else {
                self.failed = updateFailure("update.download_failed")
                completionHandler(.cancel)
                return
            }
            if (300...399).contains(http.statusCode) {
                // A redirect that reached this point was already rejected by the
                // delegate; keep the redirect reason instead of an HTTP status.
                if self.failed == nil { self.failed = updateFailure("update.redirect_rejected") }
                completionHandler(.cancel)
                return
            }
            guard http.statusCode == 200 else {
                self.failed = updateFailure("update.check_http", ["p0": String(http.statusCode)])
                completionHandler(.cancel)
                return
            }
            if http.expectedContentLength > UpdateContract.maxDownloadBytes {
                self.failed = updateFailure("update.asset_size_invalid")
                completionHandler(.cancel)
                return
            }
            completionHandler(.allow)
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        queue.async {
            if self.cancelled || self.failed != nil { return }
            if self.received + Int64(data.count) > UpdateContract.maxDownloadBytes {
                self.failed = updateFailure("update.asset_size_invalid")
                dataTask.cancel()
                return
            }
            self.fileHandle?.write(data)
            self.hasher.update(data: data)
            self.received += Int64(data.count)
            let received = self.received
            let expected = self.expectedSize
            DispatchQueue.main.async { self.progress?(received, expected) }
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        queue.async {
            if self.cancelled {
                self.finish(.failure(updateFailure("update.cancelled")))
                return
            }
            if let failed = self.failed {
                self.finish(.failure(failed))
                return
            }
            if let error = error {
                let code = (error as NSError).code
                if code == NSURLErrorCancelled { self.finish(.failure(updateFailure("update.cancelled"))) }
                else if code == NSURLErrorTimedOut { self.finish(.failure(updateFailure("update.download_timeout"))) }
                else { self.finish(.failure(updateFailure("update.download_failed"))) }
                return
            }
            if self.received != self.expectedSize {
                self.finish(.failure(updateFailure("update.asset_size_mismatch")))
                return
            }
            let digest = self.hasher.finalize().map { String(format: "%02x", $0) }.joined()
            guard digest == self.expectedDigest else {
                self.finish(.failure(updateFailure("update.asset_digest_mismatch")))
                return
            }
            self.finish(.success(ResultValue(bytes: self.received, digest: digest)))
        }
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

func makePrivateFile(_ path: String) throws {
    guard FileManager.default.createFile(atPath: path, contents: nil, attributes: [.posixPermissions: 0o600]) else {
        throw updateFailure("update.directory_invalid")
    }
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

// MARK: - Mach-O architecture

func machOArchitectures(_ path: String) -> Set<String> {
    guard let handle = FileHandle(forReadingAtPath: path) else { return [] }
    defer { try? handle.close() }
    let data = handle.readData(ofLength: 4096)
    guard data.count >= 8 else { return [] }
    func le32(_ offset: Int) -> UInt32 {
        data.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: offset, as: UInt32.self) }
    }
    func be32(_ offset: Int) -> UInt32 {
        le32(offset).byteSwapped
    }
    func name(_ cpu: UInt32) -> String? {
        switch cpu {
        case 0x0100_000C: return "arm64"
        case 0x0000_000C: return "arm"
        case 0x0100_0007: return "x86_64"
        case 0x0000_0007: return "i386"
        default: return nil
        }
    }
    let magic = le32(0)
    var result = Set<String>()
    // Little-endian thin Mach-O.
    if magic == 0xFEED_FACF || magic == 0xFEED_FACE {
        if let value = name(le32(4)) { result.insert(value) }
        return result
    }
    // Big-endian thin Mach-O and FAT/FAT64 headers are big-endian on disk.
    let bigMagic = be32(0)
    if bigMagic == 0xFEED_FACF || bigMagic == 0xFEED_FACE {
        if let value = name(be32(4)) { result.insert(value) }
        return result
    }
    if bigMagic == 0xCAFE_BABE || bigMagic == 0xCAFE_BABF {
        let count = Int(be32(4))
        let entrySize = bigMagic == 0xCAFE_BABF ? 32 : 20
        guard count > 0, count <= 32 else { return [] }
        for index in 0..<count {
            let offset = 8 + entrySize * index
            guard offset + 4 <= data.count else { break }
            if let value = name(be32(offset)) { result.insert(value) }
        }
        return result
    }
    return result
}

// MARK: - Zip and extraction

func validateZipEntryName(_ name: String) throws {
    guard !name.isEmpty, name.count <= 1024, !name.hasPrefix("/"), !name.hasPrefix("~") else {
        throw updateFailure("update.extract_failed")
    }
    let components = name.split(separator: "/", omittingEmptySubsequences: false)
    guard !components.contains("..") else { throw updateFailure("update.extract_failed") }
    guard !name.unicodeScalars.contains(where: { $0.value < 0x20 }) else { throw updateFailure("update.extract_failed") }
}

func validateZipEntries(_ zipPath: String) throws {
    // bsdtar decodes the archive names as UTF-8; unzip emits legacy-encoded bytes
    // for non-ASCII bundle names and would reject our own release package.
    let listing = try runTool("/usr/bin/tar", ["-tf", zipPath], timeout: 300)
    guard listing.status == 0 else { throw updateFailure("update.extract_failed") }
    guard let text = String(data: listing.stdout, encoding: .utf8) else { throw updateFailure("update.extract_failed") }
    var count = 0
    for line in text.split(separator: "\n", omittingEmptySubsequences: true) {
        count += 1
        if count > UpdateContract.maxZipEntries { throw updateFailure("update.extract_failed") }
        try validateZipEntryName(String(line))
    }
}

// ZIP symlinks are created by extraction before later entries are written. Validate
// their targets from the archive listing first so an entry can never be written
// through a link that points outside the extraction root.
func validateZipLinks(_ zipPath: String) throws {
    let listing = try runTool("/usr/bin/tar", ["-tvf", zipPath], timeout: 300)
    guard listing.status == 0, let text = String(data: listing.stdout, encoding: .utf8) else {
        throw updateFailure("update.extract_failed")
    }
    for line in text.split(separator: "\n", omittingEmptySubsequences: true) where line.hasPrefix("l") {
        guard let marker = line.range(of: " -> ", options: .backwards) else {
            throw updateFailure("update.extract_failed")
        }
        let target = String(line[marker.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !target.isEmpty, target.count <= 1024, !target.hasPrefix("/"), !target.hasPrefix("~") else {
            throw updateFailure("update.extract_failed")
        }
        let components = target.split(separator: "/", omittingEmptySubsequences: false)
        guard !components.contains("..") else { throw updateFailure("update.extract_failed") }
        guard !target.unicodeScalars.contains(where: { $0.value < 0x20 }) else {
            throw updateFailure("update.extract_failed")
        }
    }
}

func validateExtractionRoot(_ root: String) throws {
    let standardizedRoot = URL(fileURLWithPath: root).standardizedFileURL.path
    guard let enumerator = FileManager.default.enumerator(atPath: root) else {
        throw updateFailure("update.extract_failed")
    }
    var total: Int64 = 0
    var count = 0
    for case let relative as String in enumerator {
        count += 1
        if count > UpdateContract.maxZipEntries { throw updateFailure("update.extract_failed") }
        let full = standardizedRoot + "/" + relative
        let standardized = URL(fileURLWithPath: full).standardizedFileURL.path
        guard standardized == standardizedRoot || standardized.hasPrefix(standardizedRoot + "/") else {
            throw updateFailure("update.extract_failed")
        }
        if pathIsSymlink(full) {
            guard let target = try? FileManager.default.destinationOfSymbolicLink(atPath: full) else {
                throw updateFailure("update.extract_failed")
            }
            let parent = (full as NSString).deletingLastPathComponent
            let resolved = target.hasPrefix("/")
                ? URL(fileURLWithPath: target).standardizedFileURL.path
                : URL(fileURLWithPath: parent + "/" + target).standardizedFileURL.path
            guard resolved == standardizedRoot || resolved.hasPrefix(standardizedRoot + "/") else {
                throw updateFailure("update.extract_failed")
            }
            continue
        }
        if let size = (try? FileManager.default.attributesOfItem(atPath: full)[.size]) as? NSNumber {
            total += size.int64Value
            if total > UpdateContract.maxExtractedBytes { throw updateFailure("update.extract_failed") }
        }
    }
}

func locateApplication(in extractionRoot: String) throws -> String {
    let root = URL(fileURLWithPath: extractionRoot).standardizedFileURL.path
    let entries = (try? FileManager.default.contentsOfDirectory(atPath: root)) ?? []
    let apps = entries.filter { $0.hasSuffix(".app") }.map { root + "/" + $0 }
    if apps.count == 1, pathIsDirectory(apps[0]) { return apps[0] }
    if apps.count > 1 { throw updateFailure("update.bundle_invalid") }
    let directories = entries.map { root + "/" + $0 }.filter { pathIsDirectory($0) && !pathIsSymlink($0) }
    guard directories.count == 1 else { throw updateFailure("update.bundle_invalid") }
    let nested = ((try? FileManager.default.contentsOfDirectory(atPath: directories[0])) ?? []).filter { $0.hasSuffix(".app") }
    guard nested.count == 1 else { throw updateFailure("update.bundle_invalid") }
    let candidate = directories[0] + "/" + nested[0]
    guard pathIsDirectory(candidate) else { throw updateFailure("update.bundle_invalid") }
    return candidate
}

// MARK: - Bundle inspection

struct ApplicationIdentity {
    let appPath: String
    let bundleID: String
    let version: String
    let executableName: String
    let minimumSystemVersion: String
    let gameAppPath: String
}

func readInfoPlist(_ appPath: String) -> [String: Any]? {
    let plist = appPath + "/Contents/Info.plist"
    guard let data = FileManager.default.contents(atPath: plist) else { return nil }
    return (try? PropertyListSerialization.propertyList(from: data, options: [], format: nil)) as? [String: Any]
}

func inspectApplication(_ appPath: String) throws -> ApplicationIdentity {
    guard pathExists(appPath), pathIsDirectory(appPath), !pathIsSymlink(appPath) else {
        throw updateFailure("update.bundle_invalid")
    }
    guard let info = readInfoPlist(appPath) else { throw updateFailure("update.bundle_invalid") }
    guard let bundleID = info["CFBundleIdentifier"] as? String,
          let version = info["CFBundleShortVersionString"] as? String,
          let executable = info["CFBundleExecutable"] as? String, !executable.isEmpty else {
        throw updateFailure("update.bundle_invalid")
    }
    let minimum = (info["LSMinimumSystemVersion"] as? String) ?? ""
    let gamePath = appPath + "/Contents/Helpers/Naruto OS 游戏.app"
    return ApplicationIdentity(appPath: appPath, bundleID: bundleID, version: version,
                               executableName: executable, minimumSystemVersion: minimum, gameAppPath: gamePath)
}

func systemVersionComponents() -> (major: Int, minor: Int) {
    let version = ProcessInfo.processInfo.operatingSystemVersion
    return (version.majorVersion, version.minorVersion)
}

func minimumSystemVersionCompatible(_ raw: String) -> Bool {
    let parts = raw.split(separator: ".")
    guard let major = parts.first.flatMap({ Int($0) }) else { return false }
    let minor = parts.count > 1 ? (Int(parts[1]) ?? 0) : 0
    let current = systemVersionComponents()
    if major != current.major { return major < current.major }
    return minor <= current.minor
}

func validateBundleLinks(_ appPath: String) throws {
    let root = URL(fileURLWithPath: appPath).standardizedFileURL.path
    guard let enumerator = FileManager.default.enumerator(atPath: root) else { throw updateFailure("update.bundle_invalid") }
    for case let relative as String in enumerator {
        let full = root + "/" + relative
        guard pathIsSymlink(full) else { continue }
        guard let target = try? FileManager.default.destinationOfSymbolicLink(atPath: full) else {
            throw updateFailure("update.bundle_invalid")
        }
        let parent = (full as NSString).deletingLastPathComponent
        let resolved = target.hasPrefix("/") ? URL(fileURLWithPath: target).standardizedFileURL.path
            : URL(fileURLWithPath: parent + "/" + target).standardizedFileURL.path
        guard resolved == root || resolved.hasPrefix(root + "/") else { throw updateFailure("update.bundle_invalid") }
    }
}

struct BundleValidationOptions {
    var verifySignature = true
    var checkArchitecture = true
    var requireResources = true
}

func validateApplication(_ appPath: String, expected: ReleaseVersion, options: BundleValidationOptions = BundleValidationOptions()) throws {
    let identity = try inspectApplication(appPath)
    guard identity.bundleID == UpdateContract.outerBundleID else { throw updateFailure("update.bundle_identity") }
    guard let version = ReleaseVersion.parse(identity.version), version == expected else {
        throw updateFailure("update.version_mismatch")
    }
    guard !identity.minimumSystemVersion.isEmpty else { throw updateFailure("update.system_requirement_missing") }
    guard minimumSystemVersionCompatible(identity.minimumSystemVersion) else {
        throw updateFailure("update.unsupported_system")
    }
    let executable = appPath + "/Contents/MacOS/" + identity.executableName
    guard pathExists(executable), !pathIsDirectory(executable) else { throw updateFailure("update.bundle_invalid") }
    if options.checkArchitecture {
        let architectures = machOArchitectures(executable)
        guard architectures.contains("arm64") else { throw updateFailure("update.unsupported_arch") }
    }
    let resources = appPath + "/Contents/Resources/app"
    let required = [
        resources + "/build-info.json",
        resources + "/package.json",
        resources + "/dist/shared/messages.json",
        resources + "/dist/prototype/host.js",
        resources + "/dist/prototype/host-preload.js",
        resources + "/dist/prototype/toolbar.html",
        resources + "/dist/prototype/launcher/index.html",
        resources + "/dist/prototype/native/core",
        resources + "/dist/prototype/native/updater"
    ]
    if options.requireResources {
        for path in required where !pathExists(path) { throw updateFailure("update.bundle_incomplete") }
        let core = resources + "/dist/prototype/native/core"
        if options.checkArchitecture {
            guard machOArchitectures(core).contains("arm64") else { throw updateFailure("update.unsupported_arch") }
        }
        guard let buildData = FileManager.default.contents(atPath: resources + "/build-info.json"),
              let build = (try? JSONSerialization.jsonObject(with: buildData)) as? [String: Any],
              let buildVersion = build["version"] as? String,
              let parsed = ReleaseVersion.parse(buildVersion), parsed == expected else {
            throw updateFailure("update.bundle_incomplete")
        }
    }
    guard pathExists(identity.gameAppPath), pathIsDirectory(identity.gameAppPath) else { throw updateFailure("update.bundle_incomplete") }
    guard let gameInfo = readInfoPlist(identity.gameAppPath),
          (gameInfo["CFBundleIdentifier"] as? String) == UpdateContract.gameBundleID,
          let gameVersion = gameInfo["CFBundleShortVersionString"] as? String,
          let parsedGame = ReleaseVersion.parse(gameVersion), parsedGame == expected,
          let gameExecutable = gameInfo["CFBundleExecutable"] as? String, !gameExecutable.isEmpty else {
        throw updateFailure("update.bundle_incomplete")
    }
    let gameBinary = identity.gameAppPath + "/Contents/MacOS/" + gameExecutable
    guard pathExists(gameBinary) else { throw updateFailure("update.bundle_incomplete") }
    if options.checkArchitecture {
        guard machOArchitectures(gameBinary).contains("x86_64") else { throw updateFailure("update.unsupported_arch") }
    }
    try validateBundleLinks(appPath)
    if options.verifySignature {
        let result = try runTool("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath], timeout: UpdateContract.signatureTimeout)
        guard result.status == 0 else { throw updateFailure("update.signature_invalid") }
    }
}

// MARK: - Target inspection

struct UpdateTarget {
    let appPath: String
    let parentDirectory: String
    let version: ReleaseVersion
    let currentVersionText: String
}

func inspectUpdateTarget(standardPathOnly: Bool) throws -> UpdateTarget {
    let appURL = Bundle.main.bundleURL.standardizedFileURL
    let appPath = appURL.path
    if standardPathOnly {
        guard appPath == UpdateContract.standardApplicationPath else { throw updateFailure("update.target_not_standard") }
    }
    guard appPath.hasSuffix("/" + UpdateContract.applicationName + ".app") else { throw updateFailure("update.target_not_standard") }
    let parent = (appPath as NSString).deletingLastPathComponent
    guard !pathIsSymlink(appPath), !pathIsSymlink(parent), pathIsDirectory(parent) else {
        throw updateFailure("update.target_not_standard")
    }
    guard let versionText = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
          let version = ReleaseVersion.parse(versionText) else {
        throw updateFailure("update.bundle_invalid")
    }
    return UpdateTarget(appPath: appPath, parentDirectory: parent, version: version, currentVersionText: versionText)
}

func checkParentWritable(_ parent: String) -> Bool {
    let probe = parent + "/.naruto-os-write-probe-" + UUID().uuidString
    do {
        try FileManager.default.createDirectory(atPath: probe, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        try? FileManager.default.removeItem(atPath: probe)
        return true
    } catch {
        return false
    }
}

// MARK: - Task record

enum UpdateStage {
    static let prepared = "prepared"
    static let oldMoved = "old-moved"
    static let newPlaced = "new-placed"
    static let launched = "launched"
    static let confirmed = "confirmed"
    static let failed = "failed"
    static let restoring = "restoring"
    static let restored = "restored"
    static let restoreFailed = "restore-failed"
    static let allowed: Set<String> = [prepared, oldMoved, newPlaced, launched, confirmed, failed, restoring, restored, restoreFailed]
}

struct UpdateTaskRecord: Codable {
    var schema: Int
    var updateID: String
    var fromVersion: String
    var toVersion: String
    var targetApp: String
    var stagingDir: String
    var stagingApp: String
    var backupApp: String
    var taskDir: String
    var updateRoot: String
    var downloadFile: String
    var updaterPath: String
    var messagesPath: String
    var language: String
    var releaseID: Int64
    var assetID: Int64
    var assetName: String
    var tag: String
    var centerPID: Int32
    var hostPID: Int32
    var corePID: Int32
    var centerExecutable: String
    var hostExecutable: String
    var coreExecutable: String
    var stage: String
    var detail: String
    var createdAt: String

    static func load(_ path: String) throws -> UpdateTaskRecord {
        let data = try Data(contentsOf: URL(fileURLWithPath: path))
        guard let record = try? JSONDecoder().decode(UpdateTaskRecord.self, from: data) else {
            throw updateFailure("update.record_invalid")
        }
        return record
    }

    func write(to path: String) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(self)
        try data.write(to: URL(fileURLWithPath: path), options: .atomic)
        chmod(path, 0o600)
    }

    func validate(allowTestPaths: Bool) throws {
        guard schema == 1, UUID(uuidString: updateID) != nil else { throw updateFailure("update.record_invalid") }
        guard ReleaseVersion.parse(fromVersion) != nil, ReleaseVersion.parse(toVersion) != nil else {
            throw updateFailure("update.record_invalid")
        }
        guard UpdateStage.allowed.contains(stage) else { throw updateFailure("update.record_invalid") }
        let paths = [targetApp, stagingDir, stagingApp, backupApp, taskDir, updateRoot, downloadFile, updaterPath, messagesPath]
        for path in paths where !path.hasPrefix("/") || path.contains("..") {
            throw updateFailure("update.record_invalid")
        }
        guard (targetApp as NSString).lastPathComponent == UpdateContract.applicationName + ".app",
              pathIsDirectory((targetApp as NSString).deletingLastPathComponent) else {
            throw updateFailure("update.record_invalid")
        }
        let parent = (targetApp as NSString).deletingLastPathComponent
        guard (stagingDir as NSString).deletingLastPathComponent == parent,
              (backupApp as NSString).deletingLastPathComponent == parent,
              (stagingApp as NSString).deletingLastPathComponent == stagingDir,
              (stagingApp as NSString).lastPathComponent == UpdateContract.applicationName + ".app" else {
            throw updateFailure("update.record_invalid")
        }
        guard stagingDir != targetApp, backupApp != targetApp, stagingDir != backupApp else {
            throw updateFailure("update.record_invalid")
        }
        guard taskDir.hasPrefix(updateRoot + "/"), downloadFile.hasPrefix(taskDir + "/"),
              updaterPath.hasPrefix(taskDir + "/"), messagesPath.hasPrefix(taskDir + "/") else {
            throw updateFailure("update.record_invalid")
        }
        if !allowTestPaths {
            guard updateRoot == defaultUpdateRoot() else { throw updateFailure("update.record_invalid") }
            guard targetApp == UpdateContract.standardApplicationPath else { throw updateFailure("update.record_invalid") }
        }
        guard pathExists(updateRoot), !pathIsSymlink(updateRoot), fileOwnerMatches(updateRoot) else {
            throw updateFailure("update.record_invalid")
        }
        guard pathExists(taskDir), !pathIsSymlink(taskDir), fileOwnerMatches(taskDir) else {
            throw updateFailure("update.record_invalid")
        }
        guard (updaterPath as NSString).lastPathComponent == "naruto-updater" else { throw updateFailure("update.record_invalid") }
    }
}

struct UpdateResultRecord: Codable {
    var schema: Int
    var updateID: String
    var status: String
    var stage: String
    var fromVersion: String
    var toVersion: String
    var targetApp: String
    var backupApp: String
    var stagingApp: String
    var messageRef: String
    var params: [String: String]
    var acknowledged: Bool
    var at: String
}

func defaultUpdateRoot() -> String {
    FileManager.default.homeDirectoryForCurrentUser.path + "/Library/Application Support/Naruto OS C/update"
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

func waitForProcessExit(pid: Int32, executable: String, timeout: TimeInterval) -> Bool {
    guard processIsAlive(pid) else { return true }
    let path = processExecutablePath(pid)
    guard let actual = path else { return true }
    let standardizedActual = URL(fileURLWithPath: actual).resolvingSymlinksInPath().path
    let standardizedExpected = URL(fileURLWithPath: executable).resolvingSymlinksInPath().path
    guard standardizedActual == standardizedExpected else { return true }
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if !processIsAlive(pid) { return true }
        if let current = processExecutablePath(pid) {
            let standardizedCurrent = URL(fileURLWithPath: current).resolvingSymlinksInPath().path
            if standardizedCurrent != standardizedExpected { return true }
        } else {
            return true
        }
        Thread.sleep(forTimeInterval: 0.15)
    }
    return !processIsAlive(pid)
}

// MARK: - Shared paths

func updateRootPath() -> String { defaultUpdateRoot() }