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
            exit(runNetworkCheck(metadataURL: arguments[index + 1], directory: arguments[index + 2],
                                 cancelAfterProgress: arguments.contains("--cancel-after-progress"),
                                 channel: arguments.contains("--intel-test") ? .intelTest : .appleSilicon))
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
        testUpdateChannels()
        testZipNames()
        testMachO()
        testRecordValidation()
        testLaunchReconciliation()
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
                              url: String? = nil, extraAssets: [[String: Any]] = [],
                              channel: UpdateChannel = .appleSilicon) -> [String: Any] {
        let name = assetName ?? expectedAssetName(for: ReleaseVersion.parse(tag) ?? ReleaseVersion(major: 9, minor: 9, patch: 9), channel: channel)
        var asset: [String: Any] = ["id": 2, "name": name, "size": size, "state": "uploaded",
                                    "browser_download_url": url ?? "https://github.com/qiuyuehu/NarutoOS/releases/download/\(tag)/\(name)"]
        if let digest = digest { asset["digest"] = digest }
        return ["id": 1, "tag_name": tag, "draft": draft, "prerelease": prerelease,
                "body": "notes", "assets": [asset] + extraAssets]
    }

    static func testReleaseParsing() {
        let good = releasePayload()
        let parsed = try? parseReleasePayload(good, allowLocal: false, channel: .appleSilicon)
        check("parse stable release", parsed?.version.description == "9.9.9" && parsed?.asset.name == "NarutoOS-9.9.9-macOS-AppleSilicon.zip")
        check("draft rejected", failureCode { _ = try parseReleasePayload(releasePayload(draft: true), allowLocal: false, channel: .appleSilicon) } == "update.release_not_stable")
        check("prerelease rejected", failureCode { _ = try parseReleasePayload(releasePayload(prerelease: true), allowLocal: false, channel: .appleSilicon) } == "update.release_not_stable")
        check("bad tag rejected", failureCode { _ = try parseReleasePayload(releasePayload(tag: "latest"), allowLocal: false, channel: .appleSilicon) } == "update.release_invalid")
        check("missing asset rejected", failureCode { _ = try parseReleasePayload(releasePayload(assetName: "NarutoOS-9.9.9-macOS.zip"), allowLocal: false, channel: .appleSilicon) } == "update.asset_missing")
        check("wrong asset version rejected", failureCode { _ = try parseReleasePayload(releasePayload(tag: "v9.9.9", assetName: "NarutoOS-9.9.8-macOS-AppleSilicon.zip"), allowLocal: false, channel: .appleSilicon) } == "update.asset_missing")
        check("missing digest rejected", failureCode { _ = try parseReleasePayload(releasePayload(digest: nil), allowLocal: false, channel: .appleSilicon) } == "update.asset_digest_missing")
        check("bad digest rejected", failureCode { _ = try parseReleasePayload(releasePayload(digest: "sha256:xyz"), allowLocal: false, channel: .appleSilicon) } == "update.asset_digest_missing")
        check("zero size rejected", failureCode { _ = try parseReleasePayload(releasePayload(size: 0), allowLocal: false, channel: .appleSilicon) } == "update.asset_size_invalid")
        check("huge size rejected", failureCode { _ = try parseReleasePayload(releasePayload(size: UpdateContract.maxDownloadBytes + 1), allowLocal: false, channel: .appleSilicon) } == "update.asset_size_invalid")
        check("foreign asset url rejected", failureCode { _ = try parseReleasePayload(releasePayload(url: "https://evil.example/NarutoOS-9.9.9-macOS-AppleSilicon.zip"), allowLocal: false, channel: .appleSilicon) } == "update.asset_url_invalid")
        check("duplicate asset rejected", failureCode {
            let base = releasePayload()
            let asset = (base["assets"] as! [[String: Any]])[0]
            var duplicate = base; duplicate["assets"] = [asset, asset]
            _ = try parseReleasePayload(duplicate, allowLocal: false, channel: .appleSilicon)
        } == "update.asset_missing")

        let intelName = expectedAssetName(for: ReleaseVersion(major: 9, minor: 9, patch: 9), channel: .intelTest)
        let intelAsset: [String: Any] = [
            "id": 3, "name": intelName, "size": 1000, "state": "uploaded",
            "digest": "sha256:" + String(repeating: "b", count: 64),
            "browser_download_url": "https://github.com/qiuyuehu/NarutoOS/releases/download/v9.9.9/\(intelName)"
        ]
        var dual = releasePayload(extraAssets: [intelAsset])
        check("release has distinct architecture asset names", expectedAssetName(for: ReleaseVersion(major: 9, minor: 9, patch: 9), channel: .appleSilicon) != intelName)
        let armRelease = try? parseReleasePayload(dual, allowLocal: false, channel: .appleSilicon)
        let intelRelease = try? parseReleasePayload(dual, allowLocal: false, channel: .intelTest)
        check("dual release selects Apple Silicon asset", armRelease?.asset.name == "NarutoOS-9.9.9-macOS-AppleSilicon.zip" && armRelease?.asset.id == 2)
        check("dual release selects Intel asset", intelRelease?.asset.name == intelName && intelRelease?.asset.id == 3)
        check("missing Intel asset does not fall back to Apple Silicon", failureCode {
            _ = try parseReleasePayload(releasePayload(), allowLocal: false, channel: .intelTest)
        } == "update.asset_missing")
        check("missing Apple Silicon asset does not fall back to Intel", failureCode {
            _ = try parseReleasePayload(["id": 1, "tag_name": "v9.9.9", "draft": false, "prerelease": false, "assets": [intelAsset]], allowLocal: false, channel: .appleSilicon)
        } == "update.asset_missing")
        // The selected channel's name and download URL must agree. Swapping URLs
        // between the architecture entries must be rejected before downloading.
        var swappedArm = (dual["assets"] as! [[String: Any]])[0]
        swappedArm["browser_download_url"] = "https://github.com/qiuyuehu/NarutoOS/releases/download/v9.9.9/\(intelName)"
        dual["assets"] = [swappedArm, intelAsset]
        check("swapped architecture asset URL rejected", failureCode {
            _ = try parseReleasePayload(dual, allowLocal: false, channel: .appleSilicon)
        } == "update.asset_url_invalid")
    }

    static func testUpdateChannels() {
        check("legacy bundle without marker stays Apple Silicon", UpdateChannel.installed(info: ["CFBundleIdentifier": UpdateContract.outerBundleID]) == .appleSilicon)
        check("marked bundle selects Intel test channel", UpdateChannel.installed(info: ["NarutoOSIntelTest": true]) == .intelTest)
        check("non-boolean Intel marker does not select Intel", UpdateChannel.installed(info: ["NarutoOSIntelTest": "true"]) == .appleSilicon)
        check("Apple Silicon asset name remains backward compatible",
              expectedAssetName(for: ReleaseVersion(major: 0, minor: 3, patch: 8), channel: .appleSilicon) == "NarutoOS-0.3.8-macOS-AppleSilicon.zip")
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
        check("own binary matches test architecture", machOArchitectures(selfPath).contains(UpdateChannel.current.architecture))
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

    static func taskRecord(in root: String, stage: String) -> UpdateTaskRecord {
        let applications = root + "/Applications"
        let updateRoot = root + "/update"
        let updateID = UUID().uuidString
        let taskDir = updateRoot + "/" + updateID
        let stagingDir = applications + "/.NarutoOS-update-" + updateID
        return UpdateTaskRecord(schema: 1, updateID: updateID, fromVersion: "1.0.0", toVersion: "9.9.9",
                                targetApp: applications + "/Naruto OS.app", stagingDir: stagingDir,
                                stagingApp: stagingDir + "/Naruto OS.app", backupApp: applications + "/.NarutoOS-backup-" + updateID,
                                taskDir: taskDir, updateRoot: updateRoot, downloadFile: taskDir + "/package.zip",
                                updaterPath: taskDir + "/naruto-updater", messagesPath: taskDir + "/messages.json", language: "zh-CN",
                                releaseID: 1, assetID: 2,
                                assetName: expectedAssetName(for: ReleaseVersion(major: 9, minor: 9, patch: 9), channel: .current), tag: "v9.9.9",
                                centerPID: 0, hostPID: 0, corePID: 0, centerExecutable: "", hostExecutable: "", coreExecutable: "",
                                stage: stage, detail: "", createdAt: "")
    }

    static func testRecordValidation() {
        let root = FileManager.default.temporaryDirectory.path + "/naruto-update-tests-" + UUID().uuidString
        let applications = root + "/Applications"
        let record = taskRecord(in: root, stage: UpdateStage.prepared)
        try? FileManager.default.createDirectory(atPath: applications, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(atPath: record.taskDir, withIntermediateDirectories: true)
        check("record validates with test paths", failureCode { try record.validate(allowTestPaths: true) }.isEmpty)
        var traversal = record; traversal.targetApp = applications + "/../Naruto OS.app"
        check("record rejects traversal", failureCode { try traversal.validate(allowTestPaths: true) } == "update.record_invalid")
        var wrongStage = record; wrongStage.stage = "unknown"
        check("record rejects unknown stage", failureCode { try wrongStage.validate(allowTestPaths: true) } == "update.record_invalid")
        var wrongRoot = record; wrongRoot.updateRoot = "/tmp"
        check("record rejects mismatched root", failureCode { try wrongRoot.validate(allowTestPaths: true) } == "update.record_invalid")
        try? FileManager.default.removeItem(atPath: root)
    }

    static func withReconciliationFixture(stage: String, _ exercise: (UpdateTaskRecord) throws -> Void) {
        let files = FileManager.default
        let root = files.temporaryDirectory.path + "/naruto-update-reconciliation-" + UUID().uuidString
        defer { try? files.removeItem(atPath: root) }
        let record = taskRecord(in: root, stage: stage)
        do {
            for directory in [record.targetApp, record.backupApp, record.stagingApp, record.taskDir] {
                try files.createDirectory(atPath: directory, withIntermediateDirectories: true)
            }
            try Data("package fixture".utf8).write(to: URL(fileURLWithPath: record.downloadFile))
            try record.write(to: record.updateRoot + "/task.json")
            try exercise(record)
        } catch {
            check("launch reconciliation fixture (\(stage)): \(error)", false)
        }
    }

    static func withUpdaterLock(_ record: UpdateTaskRecord, _ exercise: () -> Void) throws {
        let descriptor = open(record.taskDir + "/updater.lock", O_CREAT | O_RDWR, mode_t(0o600))
        guard descriptor >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        defer { close(descriptor) }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
        }
        exercise()
    }

    static func testLaunchReconciliation() {
        withReconciliationFixture(stage: UpdateStage.launched) { record in
            let task = record.updateRoot + "/task.json"
            let resultPath = record.updateRoot + "/result.json"
            let recoverable = [task, record.taskDir, record.backupApp, record.stagingDir, record.downloadFile]
            var noticeCount = 0
            let reconciliation = UpdateReconciliation(updateRoot: record.updateRoot, currentVersion: record.toVersion,
                                                      bundlePath: record.targetApp,
                                                      showNotice: { _, _, _ in noticeCount += 1 }, log: { _, _ in })
            try withUpdaterLock(record) {
                reconciliation.reconcileAtLaunch()
                let confirmation = try? readJSONObject(record.updateRoot + "/confirm.json")
                check("new launch confirms the task ID, version, and target app",
                      confirmation?["updateID"] as? String == record.updateID &&
                      confirmation?["version"] as? String == record.toVersion &&
                      confirmation?["targetApp"] as? String == record.targetApp)
                check("helper lock preserves the task and all recoverable files",
                      recoverable.allSatisfy(pathExists) && !pathExists(resultPath))
            }
            reconciliation.reconcileAtLaunch()
            check("new launch without a helper cleans up the task and keeps the installed app",
                  !recoverable.contains(where: pathExists) && pathIsDirectory(record.targetApp))
            let result = try? JSONDecoder().decode(UpdateResultRecord.self, from: Data(contentsOf: URL(fileURLWithPath: resultPath)))
            check("cleanup records a successful confirmation without a notice",
                  result?.status == "success" && result?.stage == UpdateStage.confirmed && result?.updateID == record.updateID && noticeCount == 0)
        }

        for mismatch in ["version", "target"] {
            withReconciliationFixture(stage: UpdateStage.launched) { record in
                let version = mismatch == "version" ? record.fromVersion : record.toVersion
                let bundle = mismatch == "target" ? record.targetApp + ".other" : record.targetApp
                var notices: [String] = []
                let reconciliation = UpdateReconciliation(updateRoot: record.updateRoot, currentVersion: version, bundlePath: bundle,
                                                          showNotice: { _, message, _ in notices.append(message) }, log: { _, _ in })
                reconciliation.reconcileAtLaunch()
                reconciliation.reconcileAtLaunch()
                let acknowledged = try? String(contentsOfFile: record.updateRoot + "/recovery-acknowledged", encoding: .utf8)
                let recoverable = [record.updateRoot + "/task.json", record.backupApp, record.stagingApp, record.downloadFile]
                check("\(mismatch) mismatch keeps recoverable files without confirming",
                      !pathExists(record.updateRoot + "/confirm.json") && recoverable.allSatisfy(pathExists))
                let detail = localized(msg("update.recovery_detail", ["p0": record.backupApp, "p1": record.targetApp]))
                check("\(mismatch) mismatch shows manual recovery once", notices == [detail] && acknowledged == record.updateID)
            }
        }

        withReconciliationFixture(stage: UpdateStage.launched) { record in
            let version = ReleaseVersion(major: 9, minor: 9, patch: 9)
            let oppositeChannel: UpdateChannel = UpdateChannel.current == .appleSilicon ? .intelTest : .appleSilicon
            var mismatchedRecord = record
            mismatchedRecord.assetName = expectedAssetName(for: version, channel: oppositeChannel)
            try mismatchedRecord.write(to: record.updateRoot + "/task.json")
            var notices: [String] = []
            let reconciliation = UpdateReconciliation(updateRoot: record.updateRoot, currentVersion: record.toVersion,
                                                      bundlePath: record.targetApp,
                                                      showNotice: { _, message, _ in notices.append(message) }, log: { _, _ in })
            reconciliation.reconcileAtLaunch()
            reconciliation.reconcileAtLaunch()
            let recoverable = [record.updateRoot + "/task.json", record.backupApp, record.stagingApp, record.downloadFile]
            let acknowledged = try? String(contentsOfFile: record.updateRoot + "/recovery-acknowledged", encoding: .utf8)
            let detail = localized(msg("update.recovery_detail", ["p0": record.backupApp, "p1": record.targetApp]))
            check("cross-architecture restart does not confirm or clean recovery files",
                  !pathExists(record.updateRoot + "/confirm.json") && recoverable.allSatisfy(pathExists))
            check("cross-architecture restart reports manual recovery once",
                  notices == [detail] && acknowledged == record.updateID)
        }

        withReconciliationFixture(stage: UpdateStage.prepared) { record in
            let task = record.updateRoot + "/task.json"
            let resultPath = record.updateRoot + "/result.json"
            let previousResult = UpdateResultRecord(schema: 1, updateID: UUID().uuidString, status: "failure", stage: UpdateStage.failed,
                                                    fromVersion: record.fromVersion, toVersion: record.toVersion, targetApp: record.targetApp,
                                                    backupApp: record.backupApp, stagingApp: record.stagingApp,
                                                    messageRef: "update.unknown_error", params: [:], acknowledged: false, at: "")
            try JSONEncoder().encode(previousResult).write(to: URL(fileURLWithPath: resultPath))
            var events: [String] = []
            let reconciliation = UpdateReconciliation(updateRoot: record.updateRoot, currentVersion: record.fromVersion,
                                                      bundlePath: record.targetApp,
                                                      showNotice: { title, _, _ in events.append(title) },
                                                      log: { event, _ in events.append(event) })
            try withUpdaterLock(record) {
                reconciliation.reconcileAtLaunch()
                check("previous result is handled before the prepared task defers cleanup",
                      events == [localized(msg("update.failed_title")), "update-cleanup-deferred"] && !pathExists(resultPath))
                check("old launch preserves a locked prepared task without confirming",
                      [task, record.stagingApp, record.downloadFile].allSatisfy(pathExists) && !pathExists(record.updateRoot + "/confirm.json"))
            }
            reconciliation.reconcileAtLaunch()
            check("old launch clears an unlocked prepared task and reports the interruption",
                  ![task, record.stagingDir, record.taskDir].contains(where: pathExists) && pathIsDirectory(record.targetApp) &&
                  events.last == localized(msg("update.previous_failed_title")))
        }

        withReconciliationFixture(stage: UpdateStage.restoreFailed) { record in
            let taskPath = record.updateRoot + "/task.json"
            let resultURL = URL(fileURLWithPath: record.updateRoot + "/result.json")
            try FileManager.default.removeItem(atPath: taskPath)
            let previousResult = UpdateResultRecord(schema: 1, updateID: record.updateID, status: "restore-failed",
                                                    stage: record.stage, fromVersion: record.fromVersion, toVersion: record.toVersion,
                                                    targetApp: record.targetApp, backupApp: record.backupApp, stagingApp: record.stagingApp,
                                                    messageRef: "update.unknown_error", params: [:], acknowledged: false, at: "")
            try JSONEncoder().encode(previousResult).write(to: resultURL)
            var noticeCount = 0
            let reconciliation = UpdateReconciliation(updateRoot: record.updateRoot, currentVersion: record.toVersion,
                                                      bundlePath: record.targetApp,
                                                      showNotice: { _, _, _ in noticeCount += 1 }, log: { _, _ in })
            reconciliation.reconcileAtLaunch()
            reconciliation.reconcileAtLaunch()
            let acknowledged = try JSONDecoder().decode(UpdateResultRecord.self, from: Data(contentsOf: resultURL))
            check("failed restore keeps its acknowledged result and backup after one notice",
                  acknowledged.status == "restore-failed" && acknowledged.acknowledged && noticeCount == 1 && pathExists(record.backupApp))
        }

        withReconciliationFixture(stage: UpdateStage.launched) { record in
            let linkedRoot = record.updateRoot + "-link"
            try FileManager.default.createSymbolicLink(atPath: linkedRoot, withDestinationPath: record.updateRoot)
            let reconciliation = UpdateReconciliation(updateRoot: linkedRoot, currentVersion: record.toVersion,
                                                      bundlePath: record.targetApp, showNotice: { _, _, _ in }, log: { _, _ in })
            reconciliation.reconcileAtLaunch()
            check("launch ignores a symlinked update root",
                  !pathExists(record.updateRoot + "/confirm.json") &&
                  [record.updateRoot + "/task.json", record.backupApp, record.stagingDir].allSatisfy(pathExists))
        }
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

    static func runNetworkCheck(metadataURL: String, directory: String, cancelAfterProgress: Bool,
                                channel: UpdateChannel) -> Int32 {
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
                    let asset = try parseReleaseAsset(payload.object, version: payload.header.version,
                                                      allowLocal: true, channel: channel)
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
        var requestedCancel = false
        downloader.start(url: release.asset.downloadURL, progress: { received, _ in
            if cancelAfterProgress && received > 0 && !requestedCancel {
                requestedCancel = true
                downloader.cancel()
            }
        }) { result in downloadResult = result }
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
