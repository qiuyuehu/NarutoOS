import AppKit
import Foundation
import Darwin

// The installed application's executable is the center itself, not a short-lived wrapper.
func configurePackagedCenter() throws {
    guard Bundle.main.bundleIdentifier == "cn.youye.naruto-os" else { return }
    guard let resources=Bundle.main.resourceURL,let executable=Bundle.main.executableURL else {throw ProtoError.failure(msg("ui.app_files_are_incomplete_please_reinstall"))}
    let project=resources.appendingPathComponent("app").path
    let arguments=CommandLine.arguments
    var config=ProcessInfo.processInfo.environment
    for key in Array(config.keys) where key.hasPrefix("NARUTO_C_") || key == "ELECTRON_RUN_AS_NODE" || key == "NODE_OPTIONS" {config.removeValue(forKey:key);unsetenv(key)}
    let root:String
    if let index=arguments.firstIndex(of:"--fixture-root"),index+1<arguments.count {
        root=URL(fileURLWithPath:arguments[index+1]).standardizedFileURL.path
        guard URL(fileURLWithPath:root).lastPathComponent.hasPrefix("native-core-package-check-"),URL(fileURLWithPath:root).deletingLastPathComponent().lastPathComponent==".test-artifacts",URL(fileURLWithPath:root).resolvingSymlinksInPath().standardizedFileURL.path==root else {throw ProtoError.failure(msg("ui.invalid_test_data_directory"))}
        try FileManager.default.createDirectory(atPath:root,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        let marker=root+"/package-fixture.json"
        if FileManager.default.contents(atPath:marker)==nil {
            guard try FileManager.default.contentsOfDirectory(atPath:root).isEmpty else {throw ProtoError.failure(msg("ui.test_directory_must_be_empty_existing_data"))}
            try atomic(["fixture":true],marker)
        }
        guard let data=FileManager.default.contents(atPath:marker),let value=try? JSONSerialization.jsonObject(with:data) as? [String:Bool],value["fixture"]==true else {throw ProtoError.failure(msg("ui.invalid_test_directory_marker"))}
        if let data=try? Data(contentsOf:URL(fileURLWithPath:packagedLocationFile())),let value=try? JSONSerialization.jsonObject(with:data) as? [String:String],value["root"]==root {throw ProtoError.failure(msg("ui.test_mode_cannot_use_production_data"))}
        config["NARUTO_C_FIXTURE"]="1"
    } else {
        let pointer=URL(fileURLWithPath:packagedLocationFile())
        let recorded:String? = {
            guard let data=try? Data(contentsOf:pointer),
                  let location=try? JSONSerialization.jsonObject(with:data) as? [String:Any] else { return nil }
            return location["root"] as? String
        }()
        if let path=recorded {
            guard FileManager.default.fileExists(atPath:path+"/management.json") else {throw ProtoError.failure(msg("ui.original_startup_data_not_found_reinstall_existing"))}
            root=path
        } else if FileManager.default.fileExists(atPath:pointer.path) {
            throw ProtoError.failure(msg("ui.invalid_startup_data_location_reinstall_existing_data"))
        } else {
            // First launch on a new machine: create a private data directory and
            // remember it so later launches keep the same location.
            let created=defaultPackagedRoot()
            try FileManager.default.createDirectory(atPath:created,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
            try FileManager.default.createDirectory(atPath:(pointer.path as NSString).deletingLastPathComponent,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
            try atomic(["root":created],pointer.path)
            root=created
        }
        config["NARUTO_C_FIXTURE"]="0"
    }
    guard root.hasPrefix("/"),URL(fileURLWithPath:root).resolvingSymlinksInPath().standardizedFileURL.path == root,
          let owner=(try FileManager.default.attributesOfItem(atPath:root)[.ownerAccountID]) as? NSNumber,owner.uint32Value==getuid() else {throw ProtoError.failure(msg("ui.invalid_startup_data_directory_original_data_was"))}
    let game=Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/Naruto OS 游戏.app/Contents/MacOS/Naruto OS 游戏").path
    guard let buildData=try? Data(contentsOf:URL(fileURLWithPath:project+"/build-info.json")),let build=try? JSONSerialization.jsonObject(with:buildData) as? [String:Any],let buildID=build["buildID"] as? String else {throw ProtoError.failure(msg("ui.app_build_information_missing_please_reinstall"))}
    let identity=(Bundle.main.object(forInfoDictionaryKey:"CFBundleShortVersionString") as? String ?? "")+":"+buildID+":"+project
    config["NARUTO_C_PACKAGED"]="1";config["NARUTO_C_ROOT"]=root;config["NARUTO_C_PROJECT"]=project
    config["NARUTO_C_ELECTRON"]=game;config["NARUTO_C_CENTER_EXECUTABLE"]=executable.path;config["NARUTO_C_RUNTIME_ID"]=identity
    func connect() throws -> [String:Any] {
        let data=try Data(contentsOf:URL(fileURLWithPath:root+"/capabilities.json"))
        guard let tokens=try JSONSerialization.jsonObject(with:data) as? [String:String],let token=tokens["center"] else {throw ProtoError.failure(msg("ui.could_not_read_startup_data"))}
        let state=try rpc(root,"center",token,"snapshot")
        guard state["runtimeIdentity"] as? String == identity,state["fixture"] as? Bool == (config["NARUTO_C_FIXTURE"]=="1") else {throw ProtoError.failure(msg("ui.quit_the_old_game_and_launch_center"))}
        config["NARUTO_C_TOKEN"]=token;return state
    }
    // An answering old core must not be mistaken for an absent core.
    if let data=try? Data(contentsOf:URL(fileURLWithPath:root+"/capabilities.json")),let tokens=try? JSONSerialization.jsonObject(with:data) as? [String:String],let token=tokens["center"],let state=try? rpc(root,"center",token,"snapshot") {
        guard state["runtimeIdentity"] as? String == identity,state["fixture"] as? Bool == (config["NARUTO_C_FIXTURE"]=="1") else {throw ProtoError.failure(msg("ui.quit_the_old_game_and_launch_center"))}
        config["NARUTO_C_TOKEN"]=token
    } else {
        let process=Process();process.executableURL=URL(fileURLWithPath:project+"/dist/prototype/native/core");process.environment=config
        process.standardInput=FileHandle.nullDevice;process.standardOutput=FileHandle.nullDevice;process.standardError=FileHandle.nullDevice
        try process.run()
        var connected=false
        for _ in 0..<40 {if (try? connect()) != nil {connected=true;break};Thread.sleep(forTimeInterval:0.1)}
        guard connected else {throw ProtoError.failure(msg("ui.startup_incomplete_original_data_was_kept_try"))}
    }
    for (key,value) in config {setenv(key,value,1)}
}
