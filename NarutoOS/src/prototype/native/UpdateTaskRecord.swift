import Foundation
import Darwin

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

// MARK: - Shared paths

func updateRootPath() -> String { defaultUpdateRoot() }
