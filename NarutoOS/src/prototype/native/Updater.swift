import Foundation
import AppKit
import Darwin

// Independent replacement helper. The centre prepares the staging copy, writes a
// task record, launches this binary from the update directory and then exits. This
// process must survive the centre, wait for every old process to exit, submit the
// replacement and report the result back through plain files.
@main struct UpdaterMain {
    static func main() {
        let arguments = CommandLine.arguments
        guard arguments.count >= 2 else { exit(64) }
        let environment = ProcessInfo.processInfo.environment
        let testMode = environment["NARUTO_UPDATE_TEST"] == "1"
        let noUI = testMode || environment["NARUTO_UPDATE_NO_UI"] == "1"
        let updater = Updater(recordPath: arguments[1], testMode: testMode, noUI: noUI)
        exit(updater.run())
    }
}

final class Updater {
    private let recordPath: String
    private let testMode: Bool
    private let noUI: Bool
    private var record: UpdateTaskRecord
    private var updateRoot = ""
    private var taskDir = ""
    private var logPath = ""
    private var lockDescriptor: Int32 = -1

    private var processWaitTimeout: TimeInterval { testMode ? 3 : 180 }
    private var confirmTimeout: TimeInterval { testMode ? 20 : 120 }

    init(recordPath: String, testMode: Bool, noUI: Bool) {
        self.recordPath = recordPath
        self.testMode = testMode
        self.noUI = noUI
        self.record = UpdateTaskRecord(
            schema: 1, updateID: "", fromVersion: "", toVersion: "", targetApp: "",
            stagingDir: "", stagingApp: "", backupApp: "", taskDir: "", updateRoot: "",
            downloadFile: "", updaterPath: "", messagesPath: "", language: "zh-CN",
            releaseID: 0, assetID: 0, assetName: "", tag: "", centerPID: 0, hostPID: 0, corePID: 0,
            centerExecutable: "", hostExecutable: "", coreExecutable: "",
            stage: UpdateStage.prepared, detail: "", createdAt: ISO8601DateFormatter().string(from: Date()))
    }

    // MARK: - Entry

    func run() -> Int32 {
        do {
            record = try UpdateTaskRecord.load(recordPath)
            try record.validate(allowTestPaths: testMode)
        } catch {
            let text = (error as? UpdateFailure)?.display ?? msg("update.record_invalid")
            FileHandle.standardError.write((messageCode(text) + "\n").data(using: .utf8)!)
            return 2
        }
        taskDir = record.taskDir
        updateRoot = record.updateRoot
        logPath = taskDir + "/updater.log"
        interfaceLanguage = normalizedLanguage(record.language)
        if ProcessInfo.processInfo.environment["NARUTO_C_MESSAGES"] == nil, pathExists(record.messagesPath) {
            setenv("NARUTO_C_MESSAGES", record.messagesPath, 1)
        }
        guard acquireLock() else { log("lock-busy"); return 0 }
        log("start", "update=\(record.updateID) from=\(record.fromVersion) to=\(record.toVersion) stage=\(record.stage)")
        do {
            try verifyHelperContract()
        } catch {
            if record.stage == UpdateStage.launched || record.stage == UpdateStage.confirmed {
                return failAfterLaunch()
            }
            failBeforeCommit(error)
            return 1
        }
        if record.stage == UpdateStage.launched || record.stage == UpdateStage.confirmed {
            // A previous helper already submitted the replacement. Only a launch
            // confirmation can decide whether the new application is healthy.
            do {
                guard let version = ReleaseVersion.parse(record.toVersion) else {
                    throw updateFailure("update.record_invalid")
                }
                try validateApplication(record.targetApp, expected: version,
                                        options: BundleValidationOptions(verifySignature: false, expectedChannel: .current))
            } catch {
                return failAfterLaunch()
            }
            return awaitConfirmationOnly()
        }
        guard waitForOldProcesses() else {
            failBeforeCommit(updateFailure("update.helper_wait_timeout"))
            return 1
        }
        do {
            try verifyStaging()
            try verifyTargetBeforeCommit()
        } catch {
            failBeforeCommit(error)
            return 1
        }
        do {
            try submitReplacement()
        } catch {
            restoreAfterFailedSubmit(error)
            return 1
        }
        return awaitConfirmation()
    }

    // MARK: - Lock and log

    private func acquireLock() -> Bool {
        let path = taskDir + "/updater.lock"
        let descriptor = open(path, O_CREAT | O_RDWR, mode_t(0o600))
        guard descriptor >= 0 else { return false }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else { close(descriptor); return false }
        _ = fcntl(descriptor, F_SETFD, FD_CLOEXEC)
        lockDescriptor = descriptor
        return true
    }

    private func log(_ kind: String, _ detail: String = "") {
        appendLog(logPath, kind, detail)
    }

    private func localizedFailure(_ error: Error) -> String {
        if let failure = error as? UpdateFailure { return localized(failure.display) }
        return localized(msg("update.unknown_error"))
    }

    // MARK: - Waiting

    private func waitForOldProcesses() -> Bool {
        struct Waiter { let pid: Int32; let executable: String }
        var waiters: [Waiter] = []
        if record.centerPID > 1 { waiters.append(Waiter(pid: record.centerPID, executable: record.centerExecutable)) }
        if record.hostPID > 1 {
            waiters.append(Waiter(pid: record.hostPID, executable: record.hostExecutable))
            for child in processDescendants(record.hostPID) {
                waiters.append(Waiter(pid: child, executable: processExecutablePath(child) ?? ""))
            }
        }
        if record.corePID > 1 { waiters.append(Waiter(pid: record.corePID, executable: record.coreExecutable)) }
        let deadline = Date().addingTimeInterval(processWaitTimeout)
        while Date() < deadline {
            var pending = false
            for waiter in waiters {
                if !processIsAlive(waiter.pid) { continue }
                if waiter.executable.isEmpty { pending = true; continue }
                let actual = processExecutablePath(waiter.pid)
                if let actual = actual,
                   URL(fileURLWithPath: actual).resolvingSymlinksInPath().path == URL(fileURLWithPath: waiter.executable).resolvingSymlinksInPath().path {
                    pending = true
                }
            }
            if !pending { log("old-processes-exited"); return true }
            Thread.sleep(forTimeInterval: 0.15)
        }
        log("old-processes-timeout", "center=\(record.centerPID) host=\(record.hostPID) core=\(record.corePID)")
        return false
    }

    // MARK: - Verification

    private func verifyHelperContract() throws {
        guard let version = ReleaseVersion.parse(record.toVersion),
              expectedAssetName(for: version) == record.assetName,
              machOArchitectures(CommandLine.arguments[0]).contains(UpdateChannel.current.architecture) else {
            throw updateFailure("update.unsupported_arch")
        }
    }

    private func verifyStaging() throws {
        guard pathExists(record.stagingDir), !pathIsSymlink(record.stagingDir), fileOwnerMatches(record.stagingDir) else {
            throw updateFailure("update.helper_staging_invalid")
        }
        guard let version = ReleaseVersion.parse(record.toVersion) else { throw updateFailure("update.record_invalid") }
        try validateApplication(record.stagingApp, expected: version,
                                options: BundleValidationOptions(expectedChannel: .current))
        log("staging-validated", record.toVersion)
    }

    private func verifyTargetBeforeCommit() throws {
        guard pathExists(record.targetApp), !pathIsSymlink(record.targetApp) else {
            throw updateFailure("update.helper_target_changed")
        }
        guard let version = ReleaseVersion.parse(record.fromVersion) else { throw updateFailure("update.record_invalid") }
        try validateApplication(record.targetApp, expected: version,
                                options: BundleValidationOptions(verifySignature: false, expectedChannel: .current))
        let identity = try inspectApplication(record.targetApp)
        guard identity.bundleID == UpdateContract.outerBundleID else { throw updateFailure("update.helper_target_changed") }
        guard ReleaseVersion.parse(identity.version)?.description == record.fromVersion else {
            throw updateFailure("update.helper_target_changed")
        }
        log("target-validated", record.fromVersion)
    }

    // MARK: - Submission

    private func updateStage(_ stage: String, _ detail: String = "") throws {
        record.stage = stage
        record.detail = detail
        try record.write(to: recordPath)
    }

    private func submitReplacement() throws {
        guard pathExists(record.targetApp) else { throw updateFailure("update.helper_target_changed") }
        removeItemIfExists(record.backupApp)
        // Record the intent before the first rename. A crash between the two
        // renames then leaves a stage the next launch can interpret instead of an
        // empty official path with no record of what happened.
        try updateStage(UpdateStage.oldMoved)
        do {
            try FileManager.default.moveItem(atPath: record.targetApp, toPath: record.backupApp)
        } catch {
            throw updateFailure("update.helper_backup_failed")
        }
        log("old-moved")
        do {
            try FileManager.default.moveItem(atPath: record.stagingApp, toPath: record.targetApp)
        } catch {
            throw updateFailure("update.helper_place_failed")
        }
        try updateStage(UpdateStage.newPlaced)
        log("new-placed")
        guard let version = ReleaseVersion.parse(record.toVersion) else { throw updateFailure("update.record_invalid") }
        do {
            try validateApplication(record.targetApp, expected: version,
                                    options: BundleValidationOptions(verifySignature: true, checkArchitecture: true,
                                                                     requireResources: true, expectedChannel: .current))
        } catch {
            throw updateFailure("update.helper_placed_invalid")
        }
        log("placed-validated")
        // Test-only injection used by the isolated replacement check to exercise
        // the restore branch; a production launch never sets this variable.
        if testMode, ProcessInfo.processInfo.environment["NARUTO_UPDATE_TEST_FAIL_LAUNCH"] == "1" {
            throw updateFailure("update.helper_launch_failed")
        }
        let open = try runTool("/usr/bin/open", ["-n", record.targetApp], timeout: 60)
        guard open.status == 0 else { throw updateFailure("update.helper_launch_failed") }
        try updateStage(UpdateStage.launched)
        log("launched")
    }

    // MARK: - Confirmation

    private func confirmationFile() -> String { updateRoot + "/confirm.json" }

    private func readConfirmation() -> Bool {
        guard let object = try? readJSONObject(confirmationFile()) else { return false }
        guard object["updateID"] as? String == record.updateID,
              object["version"] as? String == record.toVersion,
              let target = object["targetApp"] as? String else { return false }
        return URL(fileURLWithPath: target).standardizedFileURL.path
            == URL(fileURLWithPath: record.targetApp).standardizedFileURL.path
    }

    private func awaitConfirmationOnly() -> Int32 {
        if waitForConfirmation() {
            completeSuccess()
            return 0
        }
        return failAfterLaunch()
    }

    private func awaitConfirmation() -> Int32 {
        if waitForConfirmation() {
            completeSuccess()
            return 0
        }
        return failAfterLaunch()
    }

    private func waitForConfirmation() -> Bool {
        let deadline = Date().addingTimeInterval(confirmTimeout)
        while Date() < deadline {
            if readConfirmation() { return true }
            Thread.sleep(forTimeInterval: 0.15)
        }
        return false
    }

    private func completeSuccess() {
        log("confirmed")
        let result = UpdateResultRecord(schema: 1, updateID: record.updateID, status: "success",
                                        stage: UpdateStage.confirmed, fromVersion: record.fromVersion,
                                        toVersion: record.toVersion, targetApp: record.targetApp,
                                        backupApp: record.backupApp, stagingApp: record.stagingApp,
                                        messageRef: "", params: [:], acknowledged: false,
                                        at: ISO8601DateFormatter().string(from: Date()))
        try? writeResult(result)
        removeItemIfExists(confirmationFile())
        removeItemIfExists(recordPath)
        removeItemIfExists(record.backupApp)
        removeItemIfExists(record.stagingDir)
        removeItemIfExists(record.downloadFile)
        removeItemIfExists(record.taskDir)
    }

    private func failAfterLaunch() -> Int32 {
        log("confirmation-timeout")
        let result = UpdateResultRecord(schema: 1, updateID: record.updateID, status: "failure",
                                        stage: UpdateStage.launched, fromVersion: record.fromVersion,
                                        toVersion: record.toVersion, targetApp: record.targetApp,
                                        backupApp: record.backupApp, stagingApp: record.stagingApp,
                                        messageRef: "update.helper_new_not_confirmed",
                                        params: ["p0": record.backupApp, "p1": record.targetApp],
                                        acknowledged: false,
                                        at: ISO8601DateFormatter().string(from: Date()))
        try? writeResult(result)
        showAlert(localized(msg("update.failed_title")), localized(msg("update.helper_new_not_confirmed", ["p0": record.backupApp, "p1": record.targetApp])))
        return 1
    }

    // MARK: - Failure handling

    private func failBeforeCommit(_ error: Error) {
        let display = localizedFailure(error)
        log("failed-before-commit", display)
        let result = UpdateResultRecord(schema: 1, updateID: record.updateID, status: "failure",
                                        stage: UpdateStage.failed, fromVersion: record.fromVersion,
                                        toVersion: record.toVersion, targetApp: record.targetApp,
                                        backupApp: record.backupApp, stagingApp: record.stagingApp,
                                        messageRef: (error as? UpdateFailure).map { messageCode($0.display) } ?? "update.unknown_error",
                                        params: [:], acknowledged: false,
                                        at: ISO8601DateFormatter().string(from: Date()))
        try? writeResult(result)
        removeItemIfExists(recordPath)
        removeItemIfExists(record.stagingDir)
        removeItemIfExists(record.downloadFile)
        removeItemIfExists(record.taskDir)
        showAlert(localized(msg("update.failed_title")), display)
    }

    private func restoreAfterFailedSubmit(_ error: Error) {
        let display = localizedFailure(error)
        log("restore-requested", display)
        if !pathExists(record.backupApp), pathExists(record.targetApp) {
            // The first rename never happened; the installed app is untouched.
            failBeforeCommit(error)
            return
        }
        try? updateStage(UpdateStage.restoring, display)
        var movedNew = false
        var restored = false
        if pathExists(record.targetApp) {
            let parked = pathExists(record.stagingDir) ? record.stagingApp : record.taskDir + "/failed-new.app"
            removeItemIfExists(parked)
            do {
                try FileManager.default.moveItem(atPath: record.targetApp, toPath: parked)
                movedNew = true
            } catch {
                log("park-new-failed")
            }
        } else {
            movedNew = true
        }
        if movedNew, pathExists(record.backupApp) {
            do {
                try FileManager.default.moveItem(atPath: record.backupApp, toPath: record.targetApp)
                restored = true
            } catch {
                log("restore-move-failed")
            }
        }
        if restored {
            let identity = try? inspectApplication(record.targetApp)
            if identity?.bundleID == UpdateContract.outerBundleID, identity?.version == record.fromVersion {
                try? updateStage(UpdateStage.restored, display)
                log("restored")
                let result = UpdateResultRecord(schema: 1, updateID: record.updateID, status: "failure",
                                                stage: UpdateStage.restored, fromVersion: record.fromVersion,
                                                toVersion: record.toVersion, targetApp: record.targetApp,
                                                backupApp: record.backupApp, stagingApp: record.stagingApp,
                                                messageRef: "update.helper_restored", params: ["p0": record.fromVersion],
                                                acknowledged: false,
                                                at: ISO8601DateFormatter().string(from: Date()))
                try? writeResult(result)
                removeItemIfExists(recordPath)
                removeItemIfExists(record.stagingDir)
                removeItemIfExists(record.downloadFile)
                removeItemIfExists(record.taskDir)
                showAlert(localized(msg("update.failed_title")), localized(msg("update.helper_restored", ["p0": record.fromVersion])))
                return
            }
            log("restored-identity-mismatch")
        }
        try? updateStage(UpdateStage.restoreFailed, display)
        let result = UpdateResultRecord(schema: 1, updateID: record.updateID, status: "restore-failed",
                                        stage: UpdateStage.restoreFailed, fromVersion: record.fromVersion,
                                        toVersion: record.toVersion, targetApp: record.targetApp,
                                        backupApp: record.backupApp, stagingApp: record.stagingApp,
                                        messageRef: "update.helper_restore_failed",
                                        params: ["p0": record.backupApp, "p1": record.targetApp],
                                        acknowledged: false,
                                        at: ISO8601DateFormatter().string(from: Date()))
        try? writeResult(result)
        showAlert(localized(msg("update.recovery_title")), localized(msg("update.helper_restore_failed", ["p0": record.backupApp, "p1": record.targetApp])))
    }

    // MARK: - Result and UI

    private func writeResult(_ result: UpdateResultRecord) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(result)
        try data.write(to: URL(fileURLWithPath: updateRoot + "/result.json"), options: .atomic)
        chmod(updateRoot + "/result.json", 0o600)
    }

    private func showAlert(_ title: String, _ message: String) {
        guard !noUI else { return }
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        application.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: localized(msg("update.acknowledge_button")))
        _ = alert.runModal()
    }
}
