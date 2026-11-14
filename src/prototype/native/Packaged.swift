import AppKit
import Foundation
import Darwin

// The installed application's executable is the center itself, not a short-lived wrapper.
func configurePackagedCenter() throws {
    guard Bundle.main.bundleIdentifier == "cn.youye.naruto-os" else { return }
    guard let resources=Bundle.main.resourceURL,let executable=Bundle.main.executableURL else {throw ProtoError.failure("应用文件不完整，请重新安装")}
    let project=resources.appendingPathComponent("app").path
    let arguments=CommandLine.arguments
    var config=ProcessInfo.processInfo.environment
    for key in Array(config.keys) where key.hasPrefix("NARUTO_C_") || key == "ELECTRON_RUN_AS_NODE" || key == "NODE_OPTIONS" {config.removeValue(forKey:key);unsetenv(key)}
    let root:String
    if let index=arguments.firstIndex(of:"--fixture-root"),index+1<arguments.count {
        root=URL(fileURLWithPath:arguments[index+1]).standardizedFileURL.path
        guard URL(fileURLWithPath:root).lastPathComponent.hasPrefix("native-core-package-check-"),URL(fileURLWithPath:root).deletingLastPathComponent().lastPathComponent==".test-artifacts",URL(fileURLWithPath:root).resolvingSymlinksInPath().standardizedFileURL.path==root else {throw ProtoError.failure("检查资料目录无效")}
        try FileManager.default.createDirectory(atPath:root,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        let marker=root+"/package-fixture.json"
        if FileManager.default.contents(atPath:marker)==nil {
            guard try FileManager.default.contentsOfDirectory(atPath:root).isEmpty else {throw ProtoError.failure("检查目录必须为空，现有资料已保留")}
            try atomic(["fixture":true],marker)
        }
        guard let data=FileManager.default.contents(atPath:marker),let value=try? JSONSerialization.jsonObject(with:data) as? [String:Bool],value["fixture"]==true else {throw ProtoError.failure("检查目录标记无效")}
        if let data=try? Data(contentsOf:URL(fileURLWithPath:packagedLocationFile())),let value=try? JSONSerialization.jsonObject(with:data) as? [String:String],value["root"]==root {throw ProtoError.failure("检查模式不可使用正式资料")}
        config["NARUTO_C_FIXTURE"]="1"
    } else {
        guard let data=try? Data(contentsOf:URL(fileURLWithPath:packagedLocationFile())),
              let location=try? JSONSerialization.jsonObject(with:data) as? [String:Any],let path=location["root"] as? String,
              FileManager.default.fileExists(atPath:path+"/management.json") else {throw ProtoError.failure("找不到原有启动资料，请重新安装；原资料会保留")}
        root=path;config["NARUTO_C_FIXTURE"]="0"
    }
    guard root.hasPrefix("/"),URL(fileURLWithPath:root).resolvingSymlinksInPath().standardizedFileURL.path == root,
          let owner=(try FileManager.default.attributesOfItem(atPath:root)[.ownerAccountID]) as? NSNumber,owner.uint32Value==getuid() else {throw ProtoError.failure("启动资料目录无效，原资料已保留")}
    let game=Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/Naruto OS 游戏.app/Contents/MacOS/Naruto OS 游戏").path
    guard let buildData=try? Data(contentsOf:URL(fileURLWithPath:project+"/build-info.json")),let build=try? JSONSerialization.jsonObject(with:buildData) as? [String:Any],let buildID=build["buildID"] as? String else {throw ProtoError.failure("应用构建信息缺失，请重新安装")}
    let identity=(Bundle.main.object(forInfoDictionaryKey:"CFBundleShortVersionString") as? String ?? "")+":"+buildID+":"+project
    config["NARUTO_C_PACKAGED"]="1";config["NARUTO_C_ROOT"]=root;config["NARUTO_C_PROJECT"]=project
    config["NARUTO_C_ELECTRON"]=game;config["NARUTO_C_CENTER_EXECUTABLE"]=executable.path;config["NARUTO_C_RUNTIME_ID"]=identity
    func connect() throws -> [String:Any] {
        let data=try Data(contentsOf:URL(fileURLWithPath:root+"/capabilities.json"))
        guard let tokens=try JSONSerialization.jsonObject(with:data) as? [String:String],let token=tokens["center"] else {throw ProtoError.failure("启动资料读取失败")}
        let state=try rpc(root,"center",token,"snapshot")
        guard state["runtimeIdentity"] as? String == identity,state["fixture"] as? Bool == (config["NARUTO_C_FIXTURE"]=="1") else {throw ProtoError.failure("请先正常退出旧版游戏和启动中心，等待约十秒后重开")}
        config["NARUTO_C_TOKEN"]=token;return state
    }
    // An answering old core must not be mistaken for an absent core.
    if let data=try? Data(contentsOf:URL(fileURLWithPath:root+"/capabilities.json")),let tokens=try? JSONSerialization.jsonObject(with:data) as? [String:String],let token=tokens["center"],let state=try? rpc(root,"center",token,"snapshot") {
        guard state["runtimeIdentity"] as? String == identity,state["fixture"] as? Bool == (config["NARUTO_C_FIXTURE"]=="1") else {throw ProtoError.failure("请先正常退出旧版游戏和启动中心，等待约十秒后重开")}
        config["NARUTO_C_TOKEN"]=token
    } else {
        let process=Process();process.executableURL=URL(fileURLWithPath:project+"/dist/prototype/native/core");process.environment=config
        process.standardInput=FileHandle.nullDevice;process.standardOutput=FileHandle.nullDevice;process.standardError=FileHandle.nullDevice
        try process.run()
        var connected=false
        for _ in 0..<40 {if (try? connect()) != nil {connected=true;break};Thread.sleep(forTimeInterval:0.1)}
        guard connected else {throw ProtoError.failure("启动未完成，原资料已保留；请稍后重试")}
    }
    for (key,value) in config {setenv(key,value,1)}
}
