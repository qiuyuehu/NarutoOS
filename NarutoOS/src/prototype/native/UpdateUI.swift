import AppKit
import Foundation
import Darwin

// MARK: - Progress panel

final class UpdateProgressPanel: NSObject {
    private let window: NSWindow
    private let titleLabel = NSTextField(labelWithString: "")
    private let detailLabel = NSTextField(labelWithString: "")
    private let progress = NSProgressIndicator()
    private let cancelButton = NSButton()
    var onCancel: (() -> Void)?

    override init() {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 168),
                          styleMask: [.titled, .fullSizeContentView], backing: .buffered, defer: false)
        super.init()
        window.title = UpdateContract.applicationName
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true
        window.isReleasedWhenClosed = false
        window.level = .floating
        window.standardWindowButton(.closeButton)?.isHidden = true
        window.standardWindowButton(.miniaturizeButton)?.isHidden = true
        window.standardWindowButton(.zoomButton)?.isHidden = true
        let content = NSView(frame: NSRect(x: 0, y: 0, width: 480, height: 168))
        window.contentView = content
        titleLabel.frame = NSRect(x: 24, y: 118, width: 432, height: 22)
        titleLabel.font = .systemFont(ofSize: 15, weight: .semibold)
        detailLabel.frame = NSRect(x: 24, y: 64, width: 432, height: 44)
        detailLabel.font = .systemFont(ofSize: 12)
        detailLabel.textColor = .secondaryLabelColor
        detailLabel.lineBreakMode = .byWordWrapping
        detailLabel.maximumNumberOfLines = 2
        progress.frame = NSRect(x: 24, y: 46, width: 432, height: 12)
        progress.isIndeterminate = false
        progress.minValue = 0
        progress.maxValue = 1
        cancelButton.frame = NSRect(x: 360, y: 12, width: 96, height: 26)
        cancelButton.bezelStyle = .rounded
        cancelButton.target = self
        cancelButton.action = #selector(cancelTapped)
        content.addSubview(titleLabel)
        content.addSubview(detailLabel)
        content.addSubview(progress)
        content.addSubview(cancelButton)
    }

    @objc private func cancelTapped() {
        onCancel?()
    }

    func show(title: String, detail: String, determinate: Bool, cancelVisible: Bool) {
        titleLabel.stringValue = title
        detailLabel.stringValue = detail
        progress.isIndeterminate = !determinate
        if determinate {
            progress.doubleValue = 0
        } else {
            progress.startAnimation(nil)
        }
        cancelButton.isHidden = !cancelVisible
        cancelButton.isEnabled = cancelVisible
        cancelButton.title = localized(msg("update.cancel_button"))
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func setTitle(_ title: String) {
        titleLabel.stringValue = title
    }

    func setDetail(_ detail: String) {
        detailLabel.stringValue = detail
    }

    func setProgress(_ value: Double) {
        progress.isIndeterminate = false
        progress.doubleValue = min(1, max(0, value))
    }

    func setDeterminate(_ determinate: Bool) {
        progress.isIndeterminate = !determinate
        if determinate { progress.stopAnimation(nil) } else { progress.startAnimation(nil) }
    }

    func setCancelEnabled(_ enabled: Bool) {
        cancelButton.isHidden = !enabled
        cancelButton.isEnabled = enabled
    }

    func close() {
        progress.stopAnimation(nil)
        window.orderOut(nil)
    }
}

// MARK: - Update controller

final class UpdateController: NSObject {
    private enum Phase {
        case idle
        case checking
        case available
        case downloading
        case preparing
        case handoff
        case submitting
    }

    private weak var center: Center?
    private var phase: Phase = .idle
    private var release: UpdateRelease?
    private var metadataClient: UpdateMetadataClient?
    private var downloader: UpdateDownloader?
    private var panel: UpdateProgressPanel?
    private var taskDir: String?
    private var stagingDir: String?
    private var record: UpdateTaskRecord?
    private var recordPath: String?
    private var handoffTimer: Timer?
    private var handoffDeadline = Date()
    private var prepareGeneration = 0
    private var cancelRequested = false
    private var handoffHostExpected = false

    private var isPackagedApplication: Bool {
        Bundle.main.bundleIdentifier == UpdateContract.outerBundleID
    }

    private var isFixture: Bool {
        ProcessInfo.processInfo.environment["NARUTO_C_FIXTURE"] == "1"
    }

    // MARK: - Bootstrap

    func bootstrap(_ center: Center) {
        self.center = center
        guard isPackagedApplication, !isFixture else { return }
        reconcileAtLaunch()
        // A centre that starts while the core still remembers an update attempt
        // means the previous centre stopped before the handoff finished.
        _ = try? coreRPC("update.cancel")
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
            guard let self = self, self.phase == .idle else { return }
            self.startCheck(manual: false)
        }
    }

    func manualCheck() {
        guard isPackagedApplication else { return }
        guard !isFixture else { return }
        if phase == .available {
            showAvailablePrompt(manual: true)
            return
        }
        guard phase == .idle else {
            if phase == .checking { return }
            center?.showWindow()
            return
        }
        startCheck(manual: true)
    }

    // MARK: - Check

    private func startCheck(manual: Bool) {
        guard phase == .idle else { return }
        phase = .checking
        center?.logCenter("update-check-start", "manual=\(manual)")
        // A silent startup check must not bring the centre forward or reset the
        // auto-hide state while the user is already opening a game.
        if manual { center?.showWindow() }
        let client = UpdateMetadataClient(allowLocal: false)
        metadataClient = client
        client.fetch { [weak self] result in
            guard let self = self else { return }
            self.metadataClient = nil
            switch result {
            case .success(let payload):
                let current = ReleaseVersion.parse(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
                guard let current = current else {
                    self.phase = .idle
                    if manual { self.showFailure(localized(msg("update.check_failed", ["p0": localized(msg("update.bundle_invalid"))]))) }
                    return
                }
                // Compare versions before validating the asset: an older release with a
                // non-conforming asset name must still read as "up to date".
                guard payload.header.version > current else {
                    self.release = nil
                    self.phase = .idle
                    self.center?.logCenter("update-check-current", "version=\(current)")
                    if manual {
                        self.showInfo(localized(msg("update.up_to_date_title")),
                                      localized(msg("update.up_to_date_detail", ["p0": current.description])))
                    }
                    return
                }
                do {
                    let asset = try parseReleaseAsset(payload.object, version: payload.header.version, allowLocal: false)
                    let release = UpdateRelease(releaseID: payload.header.releaseID, tag: payload.header.tag,
                                                version: payload.header.version, notes: payload.header.notes, asset: asset)
                    self.release = release
                    self.phase = .available
                    self.center?.logCenter("update-check-found", "remote=\(release.version) current=\(current)")
                    self.showAvailablePrompt(manual: manual)
                } catch {
                    self.phase = .idle
                    let failure = (error as? UpdateFailure) ?? updateFailure("update.release_invalid")
                    self.center?.logCenter("update-check-failed", messageCode(failure.display))
                    if manual {
                        self.showCheckFailure(failure) { [weak self] in
                            self?.startCheck(manual: true)
                        }
                    }
                }
            case .failure(let failure):
                self.phase = .idle
                self.center?.logCenter("update-check-failed", messageCode(failure.display))
                if manual {
                    self.showCheckFailure(failure) { [weak self] in
                        self?.startCheck(manual: true)
                    }
                }
            }
        }
    }

    private func showAvailablePrompt(manual: Bool) {
        guard let release = release else { return }
        if manual { center?.showWindow() }
        else if NSApp.isHidden { NSApp.unhide(nil) }
        let current = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        var notes = release.notes
        if notes.isEmpty { notes = localized(msg("update.release_notes_empty")) }
        if notes.count > UpdateContract.maxNotesCharacters {
            notes = String(notes.prefix(UpdateContract.maxNotesCharacters)) + "\n" + localized(msg("update.notes_truncated"))
        }
        let alert = NSAlert()
        alert.messageText = localized(msg("update.available_title", ["p0": release.version.description]))
        alert.informativeText = localized(msg("update.available_detail", ["p0": current, "p1": notes]))
        alert.addButton(withTitle: localized(msg("update.download_button")))
        alert.addButton(withTitle: localized(msg("update.later_button")))
        center?.logCenter("update-prompt", "version=\(release.version) manual=\(manual)")
        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            beginDownload()
        } else {
            // "Later" only suppresses this launch's automatic prompt; the menu
            // remains able to show the same release again.
            center?.logCenter("update-later", "version=\(release.version)")
            phase = .available
        }
    }

    // MARK: - Download

    private func beginDownload() {
        guard phase == .available, let release = release else { return }
        center?.showWindow()
        let target: UpdateTarget
        do {
            target = try inspectUpdateTarget(standardPathOnly: true)
        } catch {
            showManualInstall((error as? UpdateFailure)?.display ?? msg("update.target_not_standard"))
            return
        }
        guard checkParentWritable(target.parentDirectory) else {
            showManualInstall(msg("update.not_writable"))
            return
        }
        let needed = release.asset.size + 512 * 1024 * 1024
        if let capacity = availableCapacity(target.parentDirectory), capacity < needed {
            showInfo(localized(msg("update.failed_title")), localized(msg("update.no_space")))
            return
        }
        let updateRoot = updateRootPath()
        do {
            try ensurePrivateDirectory(updateRoot)
        } catch {
            showManualInstall(msg("update.directory_invalid"))
            return
        }
        let identifier = UUID().uuidString
        let directory = updateRoot + "/" + identifier
        do {
            try ensurePrivateDirectory(directory)
        } catch {
            showManualInstall(msg("update.directory_invalid"))
            return
        }
        taskDir = directory
        center?.logCenter("update-download-start", "version=\(release.version) bytes=\(release.asset.size)")
        let downloadFile = directory + "/package.zip"
        let downloader = UpdateDownloader(destination: downloadFile, expectedSize: release.asset.size,
                                          expectedDigest: release.asset.digest, allowLocal: false)
        self.downloader = downloader
        phase = .downloading
        cancelRequested = false
        let panel = makePanel()
        panel.show(title: localized(msg("update.downloading")),
                   detail: localized(msg("update.downloading_detail", ["p0": "0%", "p1": formatBytes(release.asset.size)])),
                   determinate: true, cancelVisible: true)
        downloader.start(url: release.asset.downloadURL, progress: { [weak self] received, expected in
            guard let self = self, self.phase == .downloading, !self.cancelRequested else { return }
            let fraction = expected > 0 ? Double(received) / Double(expected) : 0
            let percent = "\(Int(fraction * 100))%"
            self.panel?.setProgress(fraction)
            self.panel?.setDetail(localized(msg("update.downloading_detail", ["p0": percent, "p1": self.formatBytes(expected)])))
        }, completion: { [weak self] result in
            guard let self = self else { return }
            self.downloader = nil
            guard self.phase == .downloading else { return }
            switch result {
            case .success:
                self.center?.logCenter("update-download-done", "version=\(release.version)")
                self.prepareUpdate()
            case .failure(let failure):
                self.finishWithFailure(localized(msg("update.download_failed", ["p0": localized(failure.display)])))
            }
        })
    }

    private func cancelDownload() {
        guard phase == .downloading else { return }
        cancelRequested = true
        downloader?.cancel()
        downloader = nil
        closePanel()
        cleanupTaskDirectory()
        phase = .idle
        showInfo(localized(msg("update.failed_title")), localized(msg("update.cancelled")))
    }

    // MARK: - Prepare

    private func prepareUpdate() {
        guard let release = release, let taskDir = taskDir else { return }
        phase = .preparing
        cancelRequested = false
        prepareGeneration += 1
        let generation = prepareGeneration
        let downloadFile = taskDir + "/package.zip"
        panel?.setDeterminate(false)
        panel?.setTitle(localized(msg("update.preparing")))
        panel?.setDetail(localized(msg("update.preparing_detail", ["p0": release.version.description])))
        panel?.setCancelEnabled(true)
        DispatchQueue.global(qos: .userInitiated).async {
            var stagingDirectory: String?
            do {
                try validateZipEntries(downloadFile)
                try validateZipLinks(downloadFile)
                let extraction = taskDir + "/extracted"
                try? FileManager.default.createDirectory(atPath: extraction, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
                let extracted = try runTool("/usr/bin/ditto", ["-x", "-k", downloadFile, extraction], timeout: UpdateContract.extractTimeout)
                guard extracted.status == 0 else { throw updateFailure("update.extract_failed") }
                try validateExtractionRoot(extraction)
                let newApplication = try locateApplication(in: extraction)
                try validateApplication(newApplication, expected: release.version)
                let target = try inspectUpdateTarget(standardPathOnly: true)
                guard checkParentWritable(target.parentDirectory) else { throw updateFailure("update.not_writable") }
                let applicationBytes = directoryBytes(newApplication) ?? 0
                if let capacity = availableCapacity(target.parentDirectory), capacity < applicationBytes + 256 * 1024 * 1024 {
                    throw updateFailure("update.no_space")
                }
                let identifier = (taskDir as NSString).lastPathComponent
                let directory = target.parentDirectory + "/.NarutoOS-update-" + identifier
                removeItemIfExists(directory)
                try ensurePrivateDirectory(directory)
                stagingDirectory = directory
                let staged = directory + "/" + UpdateContract.applicationName + ".app"
                let copied = try runTool("/usr/bin/ditto", [newApplication, staged], timeout: UpdateContract.extractTimeout)
                guard copied.status == 0 else { throw updateFailure("update.prepare_failed") }
                try validateApplication(staged, expected: release.version)
                DispatchQueue.main.async {
                    guard generation == self.prepareGeneration, !self.cancelRequested else {
                        removeItemIfExists(directory)
                        return
                    }
                    self.stagingDir = directory
                    self.prepareHandoff(stagingDirectory: directory, stagedApplication: staged)
                }
            } catch {
                DispatchQueue.main.async {
                    if let directory = stagingDirectory { removeItemIfExists(directory) }
                    guard generation == self.prepareGeneration else { return }
                    if self.cancelRequested { return }
                    self.finishWithFailure(localized(msg("update.prepare_failed_with_reason", ["p0": self.localizedError(error)])))
                }
            }
        }
    }

    private func prepareHandoff(stagingDirectory: String, stagedApplication: String) {
        guard let release = release, let taskDir = taskDir else { return }
        do {
            let target = try inspectUpdateTarget(standardPathOnly: true)
            let snapshot = try coreRPC("snapshot")
            let corePID = (snapshot["corePID"] as? NSNumber)?.int32Value ?? 0
            let hostPID = (snapshot["hostPID"] as? NSNumber)?.int32Value ?? 0
            self.handoffHostExpected = hostPID != 0
            let resources = (Bundle.main.resourceURL?.path ?? "") + "/app"
            let updaterSource = resources + "/dist/prototype/native/updater"
            let messagesSource = resources + "/dist/shared/messages.json"
            guard pathExists(updaterSource), pathExists(messagesSource) else { throw updateFailure("update.bundle_incomplete") }
            let updaterPath = taskDir + "/naruto-updater"
            let messagesPath = taskDir + "/messages.json"
            try FileManager.default.copyItem(atPath: updaterSource, toPath: updaterPath)
            chmod(updaterPath, 0o700)
            try FileManager.default.copyItem(atPath: messagesSource, toPath: messagesPath)
            chmod(messagesPath, 0o600)
            let bundleURL = Bundle.main.bundleURL
            let centerExecutable = Bundle.main.executableURL?.resolvingSymlinksInPath().path ?? ""
            let hostExecutable = bundleURL.path + "/Contents/Helpers/" + UpdateContract.applicationName + " 游戏.app/Contents/MacOS/" + UpdateContract.applicationName + " 游戏"
            let coreExecutable = resources + "/dist/prototype/native/core"
            let identifier = (taskDir as NSString).lastPathComponent
            let record = UpdateTaskRecord(
                schema: 1, updateID: identifier, fromVersion: target.currentVersionText,
                toVersion: release.version.description, targetApp: target.appPath,
                stagingDir: stagingDirectory, stagingApp: stagedApplication,
                backupApp: target.parentDirectory + "/.NarutoOS-backup-" + identifier,
                taskDir: taskDir, updateRoot: updateRootPath(), downloadFile: taskDir + "/package.zip",
                updaterPath: updaterPath, messagesPath: messagesPath, language: interfaceLanguage,
                releaseID: release.releaseID, assetID: release.asset.id, assetName: release.asset.name,
                tag: release.tag, centerPID: getpid(), hostPID: hostPID, corePID: corePID,
                centerExecutable: centerExecutable, hostExecutable: hostExecutable, coreExecutable: coreExecutable,
                stage: UpdateStage.prepared, detail: "", createdAt: ISO8601DateFormatter().string(from: Date()))
            let path = updateRootPath() + "/task.json"
            try record.write(to: path)
            recordPath = path
            self.record = record
            _ = try coreRPC("update.prepare")
            _ = try coreRPC("update.quitHost")
            center?.logCenter("update-prepared", "version=\(release.version)")
            phase = .handoff
            panel?.setDeterminate(false)
            panel?.setTitle(localized(msg("update.handoff")))
            panel?.setDetail(localized(msg("update.handoff_detail")))
            panel?.setCancelEnabled(true)
            startHandoffPolling()
        } catch {
            finishWithFailure(localized(msg("update.prepare_failed_with_reason", ["p0": localizedError(error)])))
        }
    }

    // MARK: - Exit handoff

    private func startHandoffPolling() {
        handoffTimer?.invalidate()
        handoffDeadline = Date().addingTimeInterval(180)
        handoffTimer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { [weak self] _ in
            self?.pollHandoff()
        }
    }

    private func pollHandoff() {
        guard phase == .handoff else { return }
        guard Date() < handoffDeadline else {
            abortHandoff(localized(msg("update.handoff_timeout")))
            return
        }
        guard let snapshot = try? coreRPC("snapshot") else {
            abortHandoff(localized(msg("update.handoff_failed", ["p0": localized(msg("error.coreDisconnected"))])))
            return
        }
        let update = snapshot["update"] as? [String: Any] ?? [:]
        let handoff = update["handoff"] as? [String: Any] ?? [:]
        let hostState = handoff["host"] as? String ?? ""
        if hostState == "cancelled" {
            abortHandoff(localized(msg("update.handoff_cancelled")))
            return
        }
        if hostState == "save-failed" {
            abortHandoff(localized(msg("update.host_save_failed")))
            return
        }
        let hostPID = (snapshot["hostPID"] as? NSNumber)?.int32Value ?? 0
        if handoffHostExpected {
            // The host must explicitly acknowledge a completed save before it
            // disappears; the exit guard's force-exit must not be treated as success.
            if hostState == "closed" && hostPID == 0 {
                handoffTimer?.invalidate()
                handoffTimer = nil
                launchUpdater()
            } else if hostPID == 0 {
                abortHandoff(localized(msg("update.host_save_unconfirmed")))
            }
        } else if hostPID == 0 {
            handoffTimer?.invalidate()
            handoffTimer = nil
            launchUpdater()
        }
    }

    private func abortHandoff(_ message: String) {
        center?.logCenter("update-handoff-aborted")
        handoffTimer?.invalidate()
        handoffTimer = nil
        _ = try? coreRPC("update.cancel")
        handoffHostExpected = false
        cleanupTaskDirectory()
        removeItemIfExists(updateRootPath() + "/task.json")
        if let directory = stagingDir { removeItemIfExists(directory) }
        stagingDir = nil
        closePanel()
        phase = .idle
        record = nil
        recordPath = nil
        showFailure(message)
    }

    private func launchUpdater() {
        guard let record = record, let recordPath = recordPath else { return }
        center?.logCenter("update-submitting", "version=\(record.toVersion)")
        phase = .submitting
        panel?.setDeterminate(false)
        panel?.setTitle(localized(msg("update.submitting")))
        panel?.setDetail(localized(msg("update.submitting_detail")))
        panel?.setCancelEnabled(false)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: record.updaterPath)
        process.arguments = [recordPath]
        var environment = ProcessInfo.processInfo.environment
        environment["NARUTO_C_MESSAGES"] = record.messagesPath
        process.environment = environment
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
        } catch {
            abortHandoff(localized(msg("update.prepare_failed_with_reason", ["p0": localized(msg("update.tool_missing", ["p0": "naruto-updater"]))])))
            return
        }
        center?.updateTerminating = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            NSApp.terminate(nil)
        }
    }

    // MARK: - Cancel during preparation

    private func cancelPreparation() {
        guard phase == .preparing else { return }
        cancelRequested = true
        prepareGeneration += 1
        cleanupTaskDirectory()
        if let directory = stagingDir { removeItemIfExists(directory) }
        stagingDir = nil
        closePanel()
        phase = .idle
        showInfo(localized(msg("update.failed_title")), localized(msg("update.cancelled")))
    }

    // MARK: - Failure helpers

    private func finishWithFailure(_ message: String) {
        _ = try? coreRPC("update.cancel")
        closePanel()
        cleanupTaskDirectory()
        removeItemIfExists(updateRootPath() + "/task.json")
        if let directory = stagingDir { removeItemIfExists(directory) }
        stagingDir = nil
        // Download and preparation failures keep the release metadata, so the
        // failure dialog can retry without another check.
        phase = release == nil ? .idle : .available
        showRetryFailure(message, manualDownload: true) { [weak self] in
            guard let self = self, self.phase == .available else { return }
            self.beginDownload()
        }
    }

    private func cleanupTaskDirectory() {
        if let directory = taskDir { removeItemIfExists(directory) }
        taskDir = nil
    }

    private func localizedError(_ error: Error) -> String {
        if let failure = error as? UpdateFailure { return localized(failure.display) }
        return localized(msg("update.unknown_error"))
    }

    private func makePanel() -> UpdateProgressPanel {
        let panel = UpdateProgressPanel()
        panel.onCancel = { [weak self] in
            guard let self = self else { return }
            switch self.phase {
            case .downloading: self.cancelDownload()
            case .preparing: self.cancelPreparation()
            case .handoff: self.abortHandoff(localized(msg("update.cancelled")))
            default: break
            }
        }
        self.panel = panel
        center?.updateActive = true
        return panel
    }

    private func closePanel() {
        panel?.close()
        panel = nil
        center?.updateActive = false
    }

    private func formatBytes(_ bytes: Int64) -> String {
        let formatter = ByteCountFormatter()
        formatter.allowedUnits = [.useMB, .useGB]
        formatter.countStyle = .file
        return formatter.string(fromByteCount: bytes)
    }

    private func coreRPC(_ command: String, _ payload: [String: Any] = [:]) throws -> [String: Any] {
        guard let center = center else { throw updateFailure("update.unknown_error") }
        return try rpc(center.root, "center", center.token, command, payload)
    }

    // MARK: - Dialogs

    private func showInfo(_ title: String, _ message: String) {
        center?.showWindow()
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: localized(msg("update.close_button")))
        _ = alert.runModal()
    }

    private func showFailure(_ message: String) {
        center?.showWindow()
        let alert = NSAlert()
        alert.messageText = localized(msg("update.failed_title"))
        alert.informativeText = message
        alert.addButton(withTitle: localized(msg("update.close_button")))
        _ = alert.runModal()
    }

    private func showRetryFailure(_ message: String, manualDownload: Bool = false, retry: @escaping () -> Void) {
        center?.showWindow()
        let alert = NSAlert()
        alert.messageText = localized(msg("update.failed_title"))
        alert.informativeText = message
        alert.addButton(withTitle: localized(msg("update.retry_button")))
        if manualDownload { alert.addButton(withTitle: localized(msg("update.manual_button"))) }
        alert.addButton(withTitle: localized(msg("update.close_button")))
        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            retry()
        } else if manualDownload && response == .alertSecondButtonReturn {
            openReleasePage()
        }
    }

    private func showCheckFailure(_ failure: UpdateFailure, retry: @escaping () -> Void) {
        let message = localized(msg("update.check_failed", ["p0": localized(failure.display)]))
        let manual = failureNeedsManualDownload(failure.display)
        center?.showWindow()
        let alert = NSAlert()
        alert.messageText = localized(msg("update.failed_title"))
        alert.informativeText = message
        alert.addButton(withTitle: localized(msg("update.retry_button")))
        if manual { alert.addButton(withTitle: localized(msg("update.manual_button"))) }
        alert.addButton(withTitle: localized(msg("update.close_button")))
        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            retry()
        } else if manual && response == .alertSecondButtonReturn {
            openReleasePage()
        }
    }

    private func failureNeedsManualDownload(_ value: String) -> Bool {
        let code = messageCode(value)
        return code.hasPrefix("update.asset_") || code == "update.release_invalid" || code == "update.release_not_stable"
    }

    private func openReleasePage() {
        guard let url = URL(string: UpdateContract.releasePageURL) else { return }
        NSWorkspace.shared.open(url)
    }

    private func showManualInstall(_ reason: String) {
        center?.showWindow()
        let alert = NSAlert()
        alert.messageText = localized(msg("update.failed_title"))
        alert.informativeText = localized(reason) + "\n\n" + localized(msg("update.manual_install_required", ["p0": UpdateContract.releasePageURL]))
        alert.addButton(withTitle: localized(msg("update.manual_button")))
        alert.addButton(withTitle: localized(msg("update.close_button")))
        if alert.runModal() == .alertFirstButtonReturn { openReleasePage() }
        phase = .idle
    }

    // MARK: - Startup reconciliation

    private func reconcileAtLaunch() {
        let updateRoot = updateRootPath()
        guard pathExists(updateRoot), !pathIsSymlink(updateRoot) else { return }
        let resultPath = updateRoot + "/result.json"
        if let result = (try? JSONDecoder().decode(UpdateResultRecord.self, from: Data(contentsOf: URL(fileURLWithPath: resultPath)))) {
            handlePreviousResult(result, at: resultPath)
        }
        let taskPath = updateRoot + "/task.json"
        if let record = try? UpdateTaskRecord.load(taskPath) {
            handlePreviousTask(record, at: taskPath)
        }
    }

    private func handlePreviousResult(_ result: UpdateResultRecord, at path: String) {
        if result.status == "success" {
            removeItemIfExists(path)
            return
        }
        let message = result.messageRef.hasPrefix("\u{E000}")
            ? localized(result.messageRef)
            : localized(msg(result.messageRef, result.params))
        if result.status == "restore-failed" {
            if !result.acknowledged {
                var updated = result
                updated.acknowledged = true
                if let data = try? JSONEncoder().encode(updated) { try? data.write(to: URL(fileURLWithPath: path), options: .atomic) }
                center?.showWindow()
                let alert = NSAlert()
                alert.messageText = localized(msg("update.recovery_title"))
                alert.informativeText = message
                alert.addButton(withTitle: localized(msg("update.acknowledge_button")))
                _ = alert.runModal()
            }
            return
        }
        removeItemIfExists(path)
        center?.showWindow()
        let alert = NSAlert()
        alert.messageText = localized(msg("update.failed_title"))
        alert.informativeText = message
        alert.addButton(withTitle: localized(msg("update.close_button")))
        _ = alert.runModal()
    }

    private func handlePreviousTask(_ record: UpdateTaskRecord, at path: String) {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        let bundlePath = Bundle.main.bundleURL.standardizedFileURL.path
        let updateRoot = updateRootPath()
        let submittedStages: Set<String> = [UpdateStage.oldMoved, UpdateStage.newPlaced, UpdateStage.launched, UpdateStage.confirmed]
        if submittedStages.contains(record.stage), record.toVersion == version, record.targetApp == bundlePath {
            // The replacement happened and this process is the new centre. Confirm
            // the launch so the helper can clean up.
            let confirmation: [String: Any] = ["updateID": record.updateID, "version": version, "targetApp": bundlePath]
            try? atomicWriteJSON(confirmation, updateRoot + "/confirm.json")
            cleanupConfirmedTaskIfHelperGone(record)
            return
        }
        if (record.stage == UpdateStage.prepared || record.stage == UpdateStage.oldMoved),
           record.fromVersion == version, record.targetApp == bundlePath {
            // A live helper may still be waiting for the old core to exit; never
            // delete its staging or task record from under it.
            if helperLockHeld(record) {
                center?.logCenter("update-cleanup-deferred", "helper-running")
                return
            }
            // Nothing was submitted. Remove this attempt's temporary artefacts and
            // keep the installed application untouched.
            removeItemIfExists(record.stagingDir)
            removeItemIfExists(record.downloadFile)
            removeItemIfExists(record.taskDir)
            removeItemIfExists(updateRoot + "/task.json")
            removeItemIfExists(updateRoot + "/recovery-acknowledged")
            center?.showWindow()
            let alert = NSAlert()
            alert.messageText = localized(msg("update.previous_failed_title"))
            alert.informativeText = localized(msg("update.previous_interrupted"))
            alert.addButton(withTitle: localized(msg("update.acknowledge_button")))
            _ = alert.runModal()
            return
        }
        if record.stage == UpdateStage.restored || record.stage == UpdateStage.failed {
            removeItemIfExists(record.taskDir)
            removeItemIfExists(updateRoot + "/task.json")
            return
        }
        // A replacement started but this process cannot prove the new version is
        // healthy. Keep every recoverable file and explain the manual steps once.
        let acknowledgedPath = updateRoot + "/recovery-acknowledged"
        if let data = FileManager.default.contents(atPath: acknowledgedPath),
           String(data: data, encoding: .utf8) == record.updateID { return }
        try? record.updateID.write(toFile: acknowledgedPath, atomically: true, encoding: .utf8)
        center?.showWindow()
        let alert = NSAlert()
        alert.messageText = localized(msg("update.recovery_title"))
        alert.informativeText = localized(msg("update.recovery_detail", ["p0": record.backupApp, "p1": record.targetApp]))
        alert.addButton(withTitle: localized(msg("update.acknowledge_button")))
        _ = alert.runModal()
    }

    private func helperLockHeld(_ record: UpdateTaskRecord) -> Bool {
        let descriptor = open(record.taskDir + "/updater.lock", O_RDWR)
        guard descriptor >= 0 else { return false }
        defer { close(descriptor) }
        return flock(descriptor, LOCK_EX | LOCK_NB) != 0
    }

    private func cleanupConfirmedTaskIfHelperGone(_ record: UpdateTaskRecord) {
        let lockPath = record.taskDir + "/updater.lock"
        let descriptor = open(lockPath, O_RDWR)
        guard descriptor >= 0 else { return }
        defer { close(descriptor) }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else { return }
        removeItemIfExists(record.backupApp)
        removeItemIfExists(record.stagingDir)
        removeItemIfExists(record.downloadFile)
        removeItemIfExists(record.taskDir)
        removeItemIfExists(updateRootPath() + "/task.json")
        removeItemIfExists(updateRootPath() + "/recovery-acknowledged")
        let result = UpdateResultRecord(schema: 1, updateID: record.updateID, status: "success",
                                        stage: UpdateStage.confirmed, fromVersion: record.fromVersion,
                                        toVersion: record.toVersion, targetApp: record.targetApp,
                                        backupApp: record.backupApp, stagingApp: record.stagingApp,
                                        messageRef: "", params: [:], acknowledged: false,
                                        at: ISO8601DateFormatter().string(from: Date()))
        if let data = try? JSONEncoder().encode(result) {
            try? data.write(to: URL(fileURLWithPath: updateRootPath() + "/result.json"), options: .atomic)
        }
    }
}