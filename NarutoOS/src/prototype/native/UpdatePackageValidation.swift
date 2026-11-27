import Foundation

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
    var expectedChannel: UpdateChannel = .current
}

func validateApplication(_ appPath: String, expected: ReleaseVersion, options: BundleValidationOptions = BundleValidationOptions()) throws {
    let identity = try inspectApplication(appPath)
    guard let appInfo = readInfoPlist(appPath), UpdateChannel.installed(info: appInfo) == options.expectedChannel else {
        throw updateFailure("update.unsupported_arch")
    }
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
        guard architectures.contains(options.expectedChannel.architecture) else { throw updateFailure("update.unsupported_arch") }
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
        let updater = resources + "/dist/prototype/native/updater"
        if options.checkArchitecture {
            guard machOArchitectures(core).contains(options.expectedChannel.architecture),
                  machOArchitectures(updater).contains(options.expectedChannel.architecture) else {
                throw updateFailure("update.unsupported_arch")
            }
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
