import Foundation
import Darwin

// Targeted checks for the update contract. Compiled only by the update tests;
// never shipped inside the application bundle.
@main struct UpdateTestMain {
    static var failures = 0
    static var passes = 0

    static func check(_ name: String, _ condition: Bool, _ detail: String = "") {
        if condition {
            passes += 1
            print("PASS " + name)
        } else {
            failures += 1
            print("FAIL " + name + (detail.isEmpty ? "" : " — " + detail))
        }
    }

    static func failureCode(_ body: () throws -> Void) -> String {
        do {
            try body()
            return ""
        } catch let failure as UpdateFailure {
            return messageCode(failure.display)
        } catch {
            return "unexpected"
        }
    }

    static func main() {
        let arguments = CommandLine.arguments
        if arguments.contains("--self-test") {
            runSelfTest()
            print("SUMMARY passes=\(passes) failures=\(failures)")
            exit(failures == 0 ? 0 : 1)
        }
        if let index = arguments.firstIndex(of: "--check"), index + 2 < arguments.count {
            exit(runNetworkCheck(metadataURL: arguments[index + 1], directory: arguments[index + 2]))
        }
        if let index = arguments.firstIndex(of: "--zip-check"), index + 1 < arguments.count {
            exit(runZipCheck(path: arguments[index + 1]))
        }
        print("usage: update-tests --self-test | --check <metadata-url> <directory>")
        exit(64)
    }

    // MARK: - Logic

    static func runSelfTest() {
        testVersions()
        testDigest()
        testURLPolicy()
        testReleaseParsing()
        testZipNames()
        testMachO()
        testRecordValidation()
    }

    static func testVersions() {
        check("parse plain version", ReleaseVersion.parse("1.2.3") == ReleaseVersion(major: 1, minor: 2, patch: 3))
        check("parse v version", ReleaseVersion.parse("v1.2.3")?.description == "1.2.3")
        check("parse V version", ReleaseVersion.parse("V0.3.8")?.description == "0.3.8")
        check("parse trims whitespace", ReleaseVersion.parse(" 0.3.8 ")?.description == "0.3.8")
        check("parse leading zeros", ReleaseVersion.parse("1.02.003")?.description == "1.2.3")
        check("reject two segments", ReleaseVersion.parse("1.2") == nil)
        check("reject four segments", ReleaseVersion.parse("1.2.3.4") == nil)
        check("reject prerelease suffix", ReleaseVersion.parse("1.2.3-beta") == nil)
        check("reject empty", ReleaseVersion.parse("") == nil)
        check("reject negative", ReleaseVersion.parse("-1.2.3") == nil)
        check("reject long segment", ReleaseVersion.parse("1234567.1.1") == nil)
        check("reject non numeric", ReleaseVersion.parse("1.2.x") == nil)
        check("reject too long", ReleaseVersion.parse("111111.222222.333333.444") == nil)
        check("compare patch", ReleaseVersion.parse("1.2.3")! < ReleaseVersion.parse("1.2.4")!)
        check("compare minor", ReleaseVersion.parse("1.2.9")! < ReleaseVersion.parse("1.3.0")!)
        check("compare major", ReleaseVersion.parse("1.9.9")! < ReleaseVersion.parse("2.0.0")!)
        check("equal versions", ReleaseVersion.parse("1.2.3")! == ReleaseVersion.parse("v1.2.3")!)
    }

    static func testDigest() {
        let valid = String(repeating: "a", count: 64)
        check("parse sha256 digest", parseSHA256Digest("sha256:" + valid) == valid)
        check("uppercase digest normalizes", parseSHA256Digest("SHA256:" + String(repeating: "A", count: 64)) == valid)
        check("reject short digest", parseSHA256Digest("sha256:abc") == nil)
        check("reject other algorithm", parseSHA256Digest("md5:" + valid) == nil)
        check("reject missing prefix", parseSHA256Digest(valid) == nil)
        check("reject non hex", parseSHA256Digest("sha256:" + String(repeating: "z", count: 64)) == nil)
    }

    static func testURLPolicy() {
        let metadata = URL(string: "https://api.github.com/repos/qiuyuehu/NarutoOS/releases/latest")!
        check("metadata url accepted", UpdateURLPolicy.checkMetadataURL(metadata, allowLocal: false))
        check("metadata http rejected", !UpdateURLPolicy.checkMetadataURL(URL(string: "http://api.github.com/repos/qiuyuehu/NarutoOS/releases/latest")!, allowLocal: false))
        check("metadata lookalike rejected", !UpdateURLPolicy.checkMetadataURL(URL(string: "https://api.github.com.evil.example/x")!, allowLocal: false))
        let asset = URL(string: "https://github.com/qiuyuehu/NarutoOS/releases/download/v9.9.9/NarutoOS-9.9.9-macOS-AppleSilicon.zip")!
        check("asset url accepted", UpdateURLPolicy.checkAssetURL(asset, assetName: "NarutoOS-9.9.9-macOS-AppleSilicon.zip", allowLocal: false))
        check("asset other repository rejected", !UpdateURLPolicy.checkAssetURL(URL(string: "https://github.com/evil/NarutoOS/releases/download/v9.9.9/NarutoOS-9.9.9-macOS-AppleSilicon.zip")!, assetName: "NarutoOS-9.9.9-macOS-AppleSilicon.zip", allowLocal: false))
        check("asset query rejected", !UpdateURLPolicy.checkAssetURL(URL(string: "https://github.com/qiuyuehu/NarutoOS/releases/download/v9.9.9/NarutoOS-9.9.9-macOS-AppleSilicon.zip?token=x")!, assetName: "NarutoOS-9.9.9-macOS-AppleSilicon.zip", allowLocal: false))
        check("asset wrong name rejected", !UpdateURLPolicy.checkAssetURL(asset, assetName: "NarutoOS-9.9.9-macOS-x86.zip", allowLocal: false))
        check("redirect github accepted", UpdateURLPolicy.checkRedirectURL(URL(string: "https://github.com/x")!, allowLocal: false))
        check("redirect cdn accepted", UpdateURLPolicy.checkRedirectURL(URL(string: "https://release-assets.githubusercontent.com/x")!, allowLocal: false))
        check("redirect objects accepted", UpdateURLPolicy.checkRedirectURL(URL(string: "https://objects.githubusercontent.com/x")!, allowLocal: false))
        check("redirect http rejected", !UpdateURLPolicy.checkRedirectURL(URL(string: "http://objects.githubusercontent.com/x")!, allowLocal: false))
        check("redirect unknown host rejected", !UpdateURLPolicy.checkRedirectURL(URL(string: "https://cdn.evil.example/x")!, allowLocal: false))
        check("redirect suffix trick rejected", !UpdateURLPolicy.checkRedirectURL(URL(string: "https://github.com.evil.example/x")!, allowLocal: false))
        check("local url rejected in production", !UpdateURLPolicy.checkRedirectURL(URL(string: "http://127.0.0.1:8080/x")!, allowLocal: false))
        check("local url accepted in tests", UpdateURLPolicy.checkRedirectURL(URL(string: "http://127.0.0.1:8080/x")!, allowLocal: true))
    }

    static func releasePayload(tag: String = "v9.9.9", draft: Bool = false, prerelease: Bool = false,
                              assetName: String? = nil, size: Int64 = 1000, digest: String? = "sha256:" + String(repeating: "a", count: 64),
                              url: String? = nil, extraAssets: [[String: Any]] = []) -> [String: Any] {
        let name = assetName ?? ("NarutoOS-" + (ReleaseVersion.parse(tag)?.description ?? "9.9.9") + UpdateContract.assetSuffix)
        var asset: [String: Any] = ["id": 2, "name": name, "size": size, "state": "uploaded",
                                    "browser_download_url": url ?? "https://github.com/qiuyuehu/NarutoOS/releases/download/\(tag)/\(name)"]
        if let digest = digest { asset["digest"] = digest }
        return ["id": 1, "tag_name": tag, "draft": draft, "prerelease": prerelease,
                "body": "notes", "assets": [asset] + extraAssets]
    }

    static func testReleaseParsing() {
        let good = releasePayload()
        let parsed = try? parseReleasePayload(good, allowLocal: false)
        check("parse stable release", parsed?.version.description == "9.9.9" && parsed?.asset.name == "NarutoOS-9.9.9-macOS-AppleSilicon.zip")
        check("draft rejected", failureCode { _ = try parseReleasePayload(releasePayload(draft: true), allowLocal: false) } == "update.release_not_stable")
        check("prerelease rejected", failureCode { _ = try parseReleasePayload(releasePayload(prerelease: true), allowLocal: false) } == "update.release_not_stable")
        check("bad tag rejected", failureCode { _ = try parseReleasePayload(releasePayload(tag: "latest"), allowLocal: false) } == "update.release_invalid")
        check("missing asset rejected", failureCode { _ = try parseReleasePayload(releasePayload(assetName: "NarutoOS-9.9.9-macOS.zip"), allowLocal: false) } == "update.asset_missing")
        check("wrong asset version rejected", failureCode { _ = try parseReleasePayload(releasePayload(tag: "v9.9.9", assetName: "NarutoOS-9.9.8-macOS-AppleSilicon.zip"), allowLocal: false) } == "update.asset_missing")
        check("missing digest rejected", failureCode { _ = try parseReleasePayload(releasePayload(digest: nil), allowLocal: false) } == "update.asset_digest_missing")
        check("bad digest rejected", failureCode { _ = try parseReleasePayload(releasePayload(digest: "sha256:xyz"), allowLocal: false) } == "update.asset_digest_missing")
        check("zero size rejected", failureCode { _ = try parseReleasePayload(releasePayload(size: 0), allowLocal: false) } == "update.asset_size_invalid")
        check("huge size rejected", failureCode { _ = try parseReleasePayload(releasePayload(size: UpdateContract.maxDownloadBytes + 1), allowLocal: false) } == "update.asset_size_invalid")
        check("foreign asset url rejected", failureCode { _ = try parseReleasePayload(releasePayload(url: "https://evil.example/NarutoOS-9.9.9-macOS-AppleSilicon.zip"), allowLocal: false) } == "update.asset_url_invalid")
        check("duplicate asset rejected", failureCode {
            let base = releasePayload()
            let asset = (base["assets"] as! [[String: Any]])[0]
            var duplicate = base; duplicate["assets"] = [asset, asset]
            _ = try parseReleasePayload(duplicate, allowLocal: false)
        } == "update.asset_missing")
    }

    static func testZipNames() {
        for name in ["Naruto OS.app/Contents/Info.plist", "Naruto OS.app/Contents/Frameworks/Electron Framework.framework/Versions/Current/Electron Framework", "a"] {
            check("zip name accepted: " + name, failureCode { try validateZipEntryName(name) }.isEmpty)
        }
        for name in ["../evil", "a/../../b", "/absolute", "", "a/\u{0001}b", "~/x"] {
            check("zip name rejected: " + name.debugDescription, failureCode { try validateZipEntryName(name) } == "update.extract_failed")
        }
    }

    static func testMachO() {
        let selfPath = CommandLine.arguments[0]
        check("own binary is arm64", machOArchitectures(selfPath).contains("arm64"))
        if let x86 = ProcessInfo.processInfo.environment["NARUTO_TEST_X86_BINARY"], pathExists(x86) {
            check("x86_64 fixture detected", machOArchitectures(x86).contains("x86_64"))
        }
        check("missing binary has no architecture", machOArchitectures("/nonexistent/binary").isEmpty)
        // FAT and big-endian thin headers must be read with big-endian magic.
        let fatPath = FileManager.default.temporaryDirectory.path + "/naruto-fat-" + UUID().uuidString
        var fat = Data([0xCA, 0xFE, 0xBA, 0xBE, 0x00, 0x00, 0x00, 0x02])
        func entry(_ cpu: UInt32, _ offset: UInt32) -> [UInt8] {
            var bytes: [UInt8] = []
            for value in [cpu, UInt32(0), offset, UInt32(0), UInt32(12)] {
                withUnsafeBytes(of: value.bigEndian) { bytes.append(contentsOf: $0) }
            }
            return bytes
        }
        fat.append(contentsOf: entry(0x0100_000C, 4096))
        fat.append(contentsOf: entry(0x0100_0007, 8192))
        try? fat.write(to: URL(fileURLWithPath: fatPath))
        let fatArch = machOArchitectures(fatPath)
        check("fat header detects arm64", fatArch.contains("arm64"))
        check("fat header detects x86_64", fatArch.contains("x86_64"))
        try? FileManager.default.removeItem(atPath: fatPath)
        let thinBigEndianPath = FileManager.default.temporaryDirectory.path + "/naruto-be-" + UUID().uuidString
        try? Data([0xFE, 0xED, 0xFA, 0xCE, 0x01, 0x00, 0x00, 0x0C]).write(to: URL(fileURLWithPath: thinBigEndianPath))
        check("big-endian thin header detects arm64", machOArchitectures(thinBigEndianPath).contains("arm64"))
        try? FileManager.default.removeItem(atPath: thinBigEndianPath)
    }

    static func testRecordValidation() {
        let root = FileManager.default.temporaryDirectory.path + "/naruto-update-tests-" + UUID().uuidString
        let applications = root + "/Applications"
        let updateRoot = root + "/update"
        let taskDir = updateRoot + "/" + UUID().uuidString
        try? FileManager.default.createDirectory(atPath: applications, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(atPath: taskDir, withIntermediateDirectories: true)
        let record = UpdateTaskRecord(schema: 1, updateID: (taskDir as NSString).lastPathComponent, fromVersion: "1.0.0", toVersion: "9.9.9",
                                      targetApp: applications + "/Naruto OS.app", stagingDir: applications + "/.NarutoOS-update-x",
                                      stagingApp: applications + "/.NarutoOS-update-x/Naruto OS.app", backupApp: applications + "/.NarutoOS-backup-x",
                                      taskDir: taskDir, updateRoot: updateRoot, downloadFile: taskDir + "/package.zip",
                                      updaterPath: taskDir + "/naruto-updater", messagesPath: taskDir + "/messages.json", language: "zh-CN",
                                      releaseID: 1, assetID: 2, assetName: "NarutoOS-9.9.9-macOS-AppleSilicon.zip", tag: "v9.9.9",
                                      centerPID: 0, hostPID: 0, corePID: 0, centerExecutable: "", hostExecutable: "", coreExecutable: "",
                                      stage: UpdateStage.prepared, detail: "", createdAt: "")
        check("record validates with test paths", failureCode { try record.validate(allowTestPaths: true) }.isEmpty)
        var traversal = record; traversal.targetApp = applications + "/../Naruto OS.app"
        check("record rejects traversal", failureCode { try traversal.validate(allowTestPaths: true) } == "update.record_invalid")
        var wrongStage = record; wrongStage.stage = "unknown"
        check("record rejects unknown stage", failureCode { try wrongStage.validate(allowTestPaths: true) } == "update.record_invalid")
        var wrongRoot = record; wrongRoot.updateRoot = "/tmp"
        check("record rejects mismatched root", failureCode { try wrongRoot.validate(allowTestPaths: true) } == "update.record_invalid")
        try? FileManager.default.removeItem(atPath: root)
    }

    // MARK: - Zip check

    static func runZipCheck(path: String) -> Int32 {
        do {
            try validateZipEntries(path)
            try validateZipLinks(path)
            print("{\"ok\":true}")
            return 0
        } catch let failure as UpdateFailure {
            print("{\"ok\":false,\"error\":\"\(messageCode(failure.display))\"}")
            return 1
        } catch {
            print("{\"ok\":false,\"error\":\"unknown\"}")
            return 1
        }
    }

    // MARK: - Network check

    static func pump(_ deadline: Date, until done: () -> Bool) {
        while !done() && Date() < deadline {
            RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.05))
        }
    }

    static func runNetworkCheck(metadataURL: String, directory: String) -> Int32 {
        guard let url = URL(string: metadataURL) else {
            print("{\"ok\":false,\"error\":\"bad-url\"}")
            return 2
        }
        try? FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
        var releaseResult: Result<UpdateReleasePayload, UpdateFailure>?
        let client = UpdateMetadataClient(allowLocal: true, metadataURL: url)
        client.fetch { result in releaseResult = result }
        pump(Date().addingTimeInterval(30)) { releaseResult != nil }
        var release: UpdateRelease?
        var failureMessage = "timeout"
        if let result = releaseResult {
            switch result {
            case .success(let payload):
                do {
                    let asset = try parseReleaseAsset(payload.object, version: payload.header.version, allowLocal: true)
                    release = UpdateRelease(releaseID: payload.header.releaseID, tag: payload.header.tag,
                                            version: payload.header.version, notes: payload.header.notes, asset: asset)
                } catch let failure as UpdateFailure {
                    failureMessage = messageCode(failure.display)
                } catch {
                    failureMessage = "update.release_invalid"
                }
            case .failure(let failure): failureMessage = messageCode(failure.display)
            }
        }
        guard let release = release else {
            let display = releaseResult.map { if case .failure(let f) = $0 { return localized(f.display) } else { return "" } } ?? "timeout"
            print("{\"ok\":false,\"error\":\"\(escape(failureMessage))\",\"message\":\"\(escape(display))\"}")
            return 1
        }
        let destination = directory + "/package.zip"
        var downloadResult: Result<UpdateDownloader.ResultValue, UpdateFailure>?
        let downloader = UpdateDownloader(destination: destination, expectedSize: release.asset.size,
                                          expectedDigest: release.asset.digest, allowLocal: true)
        downloader.start(url: release.asset.downloadURL, progress: { _, _ in }) { result in downloadResult = result }
        pump(Date().addingTimeInterval(60)) { downloadResult != nil }
        switch downloadResult {
        case .success(let value):
            print("{\"ok\":true,\"version\":\"\(release.version.description)\",\"asset\":\"\(escape(release.asset.name))\",\"bytes\":\(value.bytes),\"digest\":\"\(value.digest)\"}")
            return 0
        case .failure(let failure):
            print("{\"ok\":false,\"error\":\"\(escape(messageCode(failure.display)))\",\"message\":\"\(escape(localized(failure.display)))\"}")
            return 1
        case .none:
            print("{\"ok\":false,\"error\":\"download-timeout\"}")
            return 1
        }
    }

    static func escape(_ value: String) -> String {
        value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
    }
}