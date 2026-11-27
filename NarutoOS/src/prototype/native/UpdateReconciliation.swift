import Foundation
import Darwin

struct UpdateReconciliation {
    let updateRoot: String
    let currentVersion: String
    let bundlePath: String
    let showNotice: (_ title: String, _ message: String, _ button: String) -> Void
    let log: (_ event: String, _ detail: String) -> Void

    private var resultPath: String { updateRoot + "/result.json" }
    private var taskPath: String { updateRoot + "/task.json" }
    private var acknowledgedPath: String { updateRoot + "/recovery-acknowledged" }

    func reconcileAtLaunch() {
        guard pathExists(updateRoot), !pathIsSymlink(updateRoot) else { return }
        if let result = try? JSONDecoder().decode(UpdateResultRecord.self, from: Data(contentsOf: URL(fileURLWithPath: resultPath))) {
            handlePreviousResult(result)
        }
        if let record = try? UpdateTaskRecord.load(taskPath) {
            handlePreviousTask(record)
        }
    }

    private func handlePreviousResult(_ result: UpdateResultRecord) {
        if result.status == "success" {
            removeItemIfExists(resultPath)
            return
        }
        let message = result.messageRef.hasPrefix("\u{E000}")
            ? localized(result.messageRef)
            : localized(msg(result.messageRef, result.params))
        if result.status == "restore-failed" {
            if !result.acknowledged {
                var updated = result
                updated.acknowledged = true
                if let data = try? JSONEncoder().encode(updated) {
                    try? data.write(to: URL(fileURLWithPath: resultPath), options: .atomic)
                }
                showNotice(localized(msg("update.recovery_title")), message, localized(msg("update.acknowledge_button")))
            }
            return
        }
        removeItemIfExists(resultPath)
        showNotice(localized(msg("update.failed_title")), message, localized(msg("update.close_button")))
    }

    private func handlePreviousTask(_ record: UpdateTaskRecord) {
        let submittedStages: Set<String> = [UpdateStage.oldMoved, UpdateStage.newPlaced, UpdateStage.launched, UpdateStage.confirmed]
        if submittedStages.contains(record.stage), record.toVersion == currentVersion, record.targetApp == bundlePath,
           let version = ReleaseVersion.parse(currentVersion), record.assetName == expectedAssetName(for: version) {
            // Confirm this launch so the updater can clean up the previous version.
            let confirmation = ["updateID": record.updateID, "version": currentVersion, "targetApp": bundlePath]
            try? atomicWriteJSON(confirmation, updateRoot + "/confirm.json")
            cleanupConfirmedTaskIfHelperGone(record)
            return
        }
        if (record.stage == UpdateStage.prepared || record.stage == UpdateStage.oldMoved),
           record.fromVersion == currentVersion, record.targetApp == bundlePath {
            // A live helper may still be waiting for the old core to exit.
            if helperLockHeld(record) {
                log("update-cleanup-deferred", "helper-running")
                return
            }
            // Nothing was submitted. Remove only this attempt's temporary artefacts.
            removeItemIfExists(record.stagingDir)
            removeItemIfExists(record.downloadFile)
            removeItemIfExists(record.taskDir)
            removeItemIfExists(taskPath)
            removeItemIfExists(acknowledgedPath)
            showNotice(localized(msg("update.previous_failed_title")), localized(msg("update.previous_interrupted")),
                       localized(msg("update.acknowledge_button")))
            return
        }
        if record.stage == UpdateStage.restored || record.stage == UpdateStage.failed {
            removeItemIfExists(record.taskDir)
            removeItemIfExists(taskPath)
            return
        }
        // A replacement started but this process cannot prove the new version is
        // healthy. Keep every recoverable file and explain the manual steps once.
        if let data = FileManager.default.contents(atPath: acknowledgedPath),
           String(data: data, encoding: .utf8) == record.updateID { return }
        try? record.updateID.write(toFile: acknowledgedPath, atomically: true, encoding: .utf8)
        showNotice(localized(msg("update.recovery_title")),
                   localized(msg("update.recovery_detail", ["p0": record.backupApp, "p1": record.targetApp])),
                   localized(msg("update.acknowledge_button")))
    }

    private func helperLockHeld(_ record: UpdateTaskRecord) -> Bool {
        let descriptor = open(record.taskDir + "/updater.lock", O_RDWR)
        guard descriptor >= 0 else { return false }
        defer { close(descriptor) }
        return flock(descriptor, LOCK_EX | LOCK_NB) != 0
    }

    private func cleanupConfirmedTaskIfHelperGone(_ record: UpdateTaskRecord) {
        let descriptor = open(record.taskDir + "/updater.lock", O_RDWR)
        guard descriptor >= 0 else { return }
        defer { close(descriptor) }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else { return }
        removeItemIfExists(record.backupApp)
        removeItemIfExists(record.stagingDir)
        removeItemIfExists(record.downloadFile)
        removeItemIfExists(record.taskDir)
        removeItemIfExists(taskPath)
        removeItemIfExists(acknowledgedPath)
        let result = UpdateResultRecord(schema: 1, updateID: record.updateID, status: "success",
                                        stage: UpdateStage.confirmed, fromVersion: record.fromVersion,
                                        toVersion: record.toVersion, targetApp: record.targetApp,
                                        backupApp: record.backupApp, stagingApp: record.stagingApp,
                                        messageRef: "", params: [:], acknowledged: false,
                                        at: ISO8601DateFormatter().string(from: Date()))
        if let data = try? JSONEncoder().encode(result) {
            try? data.write(to: URL(fileURLWithPath: resultPath), options: .atomic)
        }
    }
}
