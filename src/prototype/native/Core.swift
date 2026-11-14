import Foundation
import Darwin
import Security

@main struct NativeCore {
 static func main() throws {
    signal(SIGPIPE, SIG_IGN)
    let env = ProcessInfo.processInfo.environment
    guard let root = env["NARUTO_C_ROOT"], let project = env["NARUTO_C_PROJECT"], let electron = env["NARUTO_C_ELECTRON"], runtimeRootAllowed(root,project,env) else { throw ProtoError.failure("仅允许原型隔离目录") }
    try FileManager.default.createDirectory(atPath:root, withIntermediateDirectories:true, attributes:[.posixPermissions:0o700])
    guard URL(fileURLWithPath:root).resolvingSymlinksInPath().standardizedFileURL.path == root else {throw ProtoError.failure("隔离路径不可含链接或跳转")}
    let lock = try roleLock(root,"core"); defer { close(lock) }
    let capabilitiesPath = root + "/capabilities.json"
    let tokens: [String:String]
    if FileManager.default.fileExists(atPath: capabilitiesPath) {
        tokens = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath:capabilitiesPath))) as! [String:String]
    } else {
        tokens = ["center":UUID().uuidString+UUID().uuidString,"host":UUID().uuidString+UUID().uuidString]
        try atomic(tokens,capabilitiesPath)
    }
    let statePath=root+"/management.json"
    let defaults=defaultPreferences()
    var state: [String:Any]
    if FileManager.default.fileExists(atPath:statePath) {
        guard let saved = try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:statePath))) as? [String:Any], saved["version"] as? Int == 1 else { throw ProtoError.failure("管理资料损坏，保留原文件") }
        state=saved
    } else {
        state=["version":1,"revision":1,"profiles":[["id":"br-1","region":"br","slot":1,"generation":1,"name":"合成巴西账号"],["id":"cn-1","region":"cn","slot":1,"generation":1,"name":"合成国服账号"]],"preferences":defaults,"batches":[]]
        try atomic(state,statePath)
    }
    var batches=state["batches"] as! [[String:Any]]
    var recentBatches=state["recentBatches"] as? [[String:Any]] ?? []
    let receiptsPath=root+"/batch-receipts"
    try FileManager.default.createDirectory(atPath:receiptsPath,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
    let terminalStates=Set(["rejected","cancelled","interrupted","closed"])
    func boundedBatches(_ candidates:[[String:Any]]) -> [[String:Any]] {
        var result=[[String:Any]]();var ids=Set<String>();var bytes=0
        for batch in candidates.reversed(){
            guard let id=batch["id"] as? String,!ids.contains(id) else{continue}
            let size=(try? json(batch).count) ?? Int.max
            if result.count<16 && size<=65536-bytes{result.insert(batch,at:0);ids.insert(id);bytes+=size}
        }
        return result
    }
    func compactBatches() throws {
        let finished=batches.filter{($0["items"] as! [[String:Any]]).allSatisfy{terminalStates.contains($0["status"] as? String ?? "")}}
        guard !finished.isEmpty else{return}
        for batch in finished{
            guard let id=batch["id"] as? String,UUID(uuidString:id) != nil else{throw ProtoError.failure("历史批次ID无效，原记录保留")}
            try atomic(batch,receiptsPath+"/"+id+".json")
        }
        let ids=Set(finished.compactMap{$0["id"] as? String})
        batches.removeAll{ids.contains($0["id"] as? String ?? "")}
        recentBatches=boundedBatches(recentBatches+finished)
    }
    func findBatch(_ id:String) throws -> [String:Any]? {
        guard UUID(uuidString:id) != nil else{throw ProtoError.failure("批次ID无效")}
        if let batch=(batches+recentBatches).first(where:{$0["id"] as? String==id}){return batch}
        let file=receiptsPath+"/"+id+".json"
        guard FileManager.default.fileExists(atPath:file) else{return nil}
        guard let batch=try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:file))) as? [String:Any],batch["id"] as? String==id else{throw ProtoError.failure("批次收据读取失败")}
        return batch
    }
    var profiles=state["profiles"] as! [[String:Any]]
    var preferences=state["preferences"] as! [String:Any]
    for (key,value) in defaults where preferences[key]==nil {preferences[key]=value}
    var selected=state["selectedByRegion"] as? [String:String] ?? [:]
    var deleted=state["deletedIds"] as? [String] ?? []
    var mutations=state["mutations"] as? [String:[String:Any]] ?? [:]
    let vault=CoreVault(root,tokens["center"]!)
    var offers=[String:[String:Any]]()
    var hostRuntime:[String:Any]=[:]
    var revision=state["revision"] as! Int
    var hostPID=(state["hostPID"] as? Int32) ?? 0
    var hostInstance=state["hostInstance"] as? String ?? ""
    var centerPID:Int32=0;var centerRegistered=false;var centerIntent:[String:Any]=[:]
    var reconciling=alive(hostPID)
    var lastActivity=Date()
    var lastSaved=Data()
    func save() throws {
        try compactBatches()
        state["recentBatches"]=recentBatches
        state["profiles"]=profiles;state["selectedByRegion"]=selected;state["deletedIds"]=deleted;state["mutations"]=mutations;state["batches"]=batches;state["preferences"]=preferences;state["revision"]=revision;state["hostPID"]=hostPID;state["hostInstance"]=hostInstance
        let bytes=try json(state); if bytes != lastSaved {try atomic(state,statePath);lastSaved=bytes}
    }
    func reconcileDeadHost() throws {
        guard !alive(hostPID) else { return }
        if hostPID == 0 && !reconciling && !batches.contains(where:{($0["items"] as! [[String:Any]]).contains{["pending","queued","login-required","loading","ready","failed"].contains($0["status"] as? String ?? "")}}) { return }
        for b in batches.indices {
            var items=batches[b]["items"] as! [[String:Any]]
            for i in items.indices where !["rejected","cancelled","interrupted","closed"].contains(items[i]["status"] as? String ?? "") { items[i]["status"]="interrupted"; items[i]["accepted"]=false }
            batches[b]["items"]=items
        }
        hostPID=0;hostInstance="";reconciling=false;try save()
    }
    try reconcileDeadHost()
    try save() // Migrate terminal receipts from older management.json once.
    func spawnRole(_ role:String) throws {
        let process=Process(); var childEnv=env
        childEnv["NARUTO_C_TOKEN"]=tokens[role]; childEnv["NARUTO_C_ROOT"]=root
        childEnv.removeValue(forKey:"ELECTRON_RUN_AS_NODE");childEnv["NARUTO_C_FLASH"]=preferences["flash"] as? String ?? "34"
        if role=="host" {
            process.executableURL=URL(fileURLWithPath:electron)
            process.arguments=env["NARUTO_C_PACKAGED"]=="1" ? [] : [project+"/dist/prototype/host.js"]
        } else {
            process.executableURL=URL(fileURLWithPath:env["NARUTO_C_CENTER_EXECUTABLE"] ?? project+"/dist/prototype/native/center")
            process.arguments=env["NARUTO_C_PACKAGED"]=="1" && env["NARUTO_C_FIXTURE"]=="1" ? ["--fixture-root",root] : []
        }
        process.environment=childEnv;process.standardInput=FileHandle.nullDevice;process.standardOutput=FileHandle.nullDevice;process.standardError=FileHandle.nullDevice
        try process.run()
        if role=="host" { hostPID=process.processIdentifier;try save() } else { centerPID=process.processIdentifier;centerRegistered=false }
    }
    func ensureHost() throws { if !alive(hostPID) { try spawnRole("host") } }
    func profileIsBusy(_ id:String)->Bool {
        batches.contains{batch in (batch["items"] as! [[String:Any]]).contains{$0["profileId"] as? String==id && ["pending","queued","login-required","loading","ready","failed"].contains($0["status"] as? String ?? "")}}
    }
    func snapshot(_ preferredBatch:String? = nil) -> [String:Any] {
        var display=recentBatches+batches
        if let id=preferredBatch,let batch=try? findBatch(id){display.removeAll{$0["id"] as? String==id};display.append(batch)}
        let visibleBatches=boundedBatches(display)
        let views=profiles.map{profile -> [String:Any] in
            var view=profile
            view["runtimeStatus"]=batches.reversed().flatMap{$0["items"] as! [[String:Any]]}.first(where:{$0["profileId"] as? String==profile["id"] as? String})?["status"] as? String ?? "未启动"
            view["identityNeedsConfirmation"]=(profile["name"] as? String ?? "")=="历史登录槽位\(profile["slot"] as? Int ?? 0)"
            view["cleanupStatus"]=profile["deleting"] as? Bool==true ? "pending" : NSNull()
            view["cleanupStage"]=profile["deleteError"] as? String ?? ""
            view["deleteBlockedReason"]=profileIsBusy(profile["id"] as! String) ? "请先关闭该账号的游戏／登录／排队任务" : ""
            return view
        }
        var choices=selected
        for region in ["br","cn"] where !profiles.contains(where:{$0["id"] as? String==choices[region] && $0["region"] as? String==region && $0["deleting"] as? Bool != true}) {
            choices[region]=profiles.first(where:{$0["region"] as? String==region && $0["deleting"] as? Bool != true})?["id"] as? String
        }
        let running=batches.flatMap{$0["items"] as! [[String:Any]]}.filter{["queued","login-required","loading","ready"].contains($0["status"] as? String ?? "")}
        return ["version":1,"runtimeIdentity":env["NARUTO_C_RUNTIME_ID"] ?? project,"centerIntent":centerIntent,"revision":revision,"corePID":getpid(),"centerPID":alive(centerPID) ? centerPID : 0,"hostPID":alive(hostPID) ? hostPID : 0,"hostInstance":hostInstance,"reconciling":reconciling,"fixture":env["NARUTO_C_FIXTURE"] == "1","profiles":views,"preferences":preferences,"batches":visibleBatches,"selectedByRegion":choices,"runtime":hostRuntime,"canCreateProfile":!reconciling,"runningAccountCount":Set(running.compactMap{$0["profileId"] as? String}).count]
    }
    let server=socket(AF_UNIX,SOCK_STREAM,0); guard server>=0 else { throw ProtoError.failure("socket") }
    let sock=socketPath(root);unlink(sock);var addr=address(sock)
    let result=withUnsafePointer(to:&addr) { $0.withMemoryRebound(to:sockaddr.self,capacity:1) { Darwin.bind(server,$0,socklen_t(MemoryLayout<sockaddr_un>.size)) } }
    guard result==0 else { throw ProtoError.failure("bind") };chmod(sock,0o600);listen(server,16)
    defer {close(server);unlink(sock)}
    try atomic(["pid":getpid(),"socket":sock],root+"/core-runtime.json")
    while true {
        var descriptor=pollfd(fd:server,events:Int16(POLLIN),revents:0)
        if poll(&descriptor,1,500)<=0 {
            try reconcileDeadHost()
            if !alive(centerPID) && !alive(hostPID) && Date().timeIntervalSince(lastActivity)>8 { break }
            continue
        }
        let client=accept(server,nil,nil);if client<0 {continue}
        defer {close(client)}
        var uid:uid_t=0;var gid:gid_t=0
        guard getpeereid(client,&uid,&gid)==0 && uid==getuid() else {continue}
        var timeout=timeval(tv_sec:2,tv_usec:0);setsockopt(client,SOL_SOCKET,SO_RCVTIMEO,&timeout,socklen_t(MemoryLayout<timeval>.size))
        do {
            guard let message=try JSONSerialization.jsonObject(with:readLine(client)) as? [String:Any], message["v"] as? Int == 1,
                  let role=message["role"] as? String, let token=message["token"] as? String, tokens[role]==token,
                  let command=message["command"] as? String else {throw ProtoError.failure("认证或协议失败")}
            let payload=message["payload"] as? [String:Any] ?? [:]
            lastActivity=Date();var output:[String:Any]=[:]
            switch command {
            case "snapshot": try reconcileDeadHost();output=snapshot()
            case "center.open" where role=="center":
                centerPID=payload["pid"] as? Int32 ?? 0;centerRegistered=true;output=snapshot(payload["batchId"] as? String)
            case "center.closed" where role=="center":
                if payload["pid"] as? Int32 == centerPID {centerPID=0;centerRegistered=false;centerIntent=[:]}
            case "center.ensure":
                if payload["page"] as? String == "settings" {centerIntent=["id":UUID().uuidString,"page":"settings"]}
                if alive(centerPID) {if centerRegistered {kill(centerPID,SIGUSR1)}} else { try spawnRole("center") };output=snapshot()
            case "preferences.patch" where role=="center":
                guard payload["revision"] as? Int == revision else {throw ProtoError.failure("配置版本已变化")}
                guard let key=payload["key"] as? String else {throw ProtoError.failure("无字段")}
                guard let value=payload["value"] else {throw ProtoError.failure("无字段值")}
                try validatePreference(key,value)
                let old=preferences;preferences[key]=value;revision+=1
                do {try save()} catch {preferences=old;revision-=1;throw error};output=snapshot()
            case "catalog.importLocal" where role=="center":
                guard !reconciling,let requestID=payload["requestId"] as? String,UUID(uuidString:requestID) != nil else{throw ProtoError.failure("导入请求或对账状态无效")}
                if let receipt=mutations[requestID] {guard receipt["command"] as? String==command else{throw ProtoError.failure("导入请求ID冲突")};output=receipt;break}
                guard payload["revision"] as? Int==revision,let incoming=payload["profiles"] as? [[String:Any]],incoming.count<=1000,let passwords=payload["credentials"] as? [[String:Any]],passwords.count<=1000 else{throw ProtoError.failure("导入资料格式或版本无效")}
                var merged=profiles;var seen=Set<String>()
                for profile in incoming {
                    guard let id=profile["id"] as? String,let region=profile["region"] as? String,["br","cn"].contains(region),let slot=profile["slot"] as? Int,slot>0,id=="\(region)-\(slot)",!seen.contains(id),!deleted.contains(id) else{throw ProtoError.failure("导入槽位重复、已删除或无效")}
                    seen.insert(id);let (name,note)=try checkedName(profile)
                    if let i=merged.firstIndex(where:{$0["id"] as? String==id}) {
                        guard merged[i]["deleting"] as? Bool != true else{throw ProtoError.failure("导入档案正在清理")}
                        merged[i]["name"]=name;merged[i]["serverNote"]=note
                    }else{merged.append(["id":id,"region":region,"slot":slot,"generation":1,"name":name,"serverNote":note])}
                }
                var nextSelected=selected;var nextDeleted=deleted
                if let values=payload["selectedByRegion"] as? [String:Any] {for region in ["br","cn"] {if let id=values[region] as? String,merged.contains(where:{$0["id"] as? String==id && $0["region"] as? String==region}){nextSelected[region]=id}}}
                for id in payload["deletedIds"] as? [String] ?? [] where id.range(of:"^(br|cn)-[1-9][0-9]*$",options:.regularExpression) != nil && !merged.contains(where:{$0["id"] as? String==id}) {if !nextDeleted.contains(id){nextDeleted.append(id)}}
                let imported=try vault.mergedImport(passwords)
                // Each store remains owned by the core; a retry safely completes a partial import.
                if imported.changed>0{try vault.write(imported.records)}
                let oldProfiles=profiles,oldSelected=selected,oldDeleted=deleted,oldMutations=mutations;let oldRevision=revision
                profiles=merged;selected=nextSelected;deleted=nextDeleted;revision+=1
                output=["command":command,"profiles":incoming.count,"credentialsChanged":imported.changed,"credentialsTotal":imported.records.count]
                mutations[requestID]=output
                do{try save()}catch{profiles=oldProfiles;selected=oldSelected;deleted=oldDeleted;mutations=oldMutations;revision=oldRevision;throw error}
            case "catalog.create", "catalog.update", "catalog.select", "catalog.delete":
                guard role=="center",!reconciling,let requestID=payload["requestId"] as? String,UUID(uuidString:requestID) != nil else {throw ProtoError.failure("请求ID或对账状态无效")}
                if let previous=mutations[requestID] {guard previous["command"] as? String==command else {throw ProtoError.failure("请求ID冲突")};output=previous;break}
                guard payload["revision"] as? Int==revision else {throw ProtoError.failure("档案已更新，请重试")}
                let oldProfiles=profiles,oldSelected=selected,oldMutations=mutations;let oldRevision=revision
                var profileID=payload["id"] as? String ?? ""
                if command=="catalog.create" {
                    guard let region=payload["region"] as? String,["br","cn"].contains(region) else {throw ProtoError.failure("地区无效")}
                    let (name,note)=try checkedName(payload)
                    let used=(profiles.compactMap{$0["id"] as? String}+deleted).filter{$0.hasPrefix(region+"-")}.compactMap{Int($0.split(separator:"-").last ?? "0")}
                    let slot=(used.max() ?? 0)+1;profileID="\(region)-\(slot)"
                    profiles.append(["id":profileID,"region":region,"slot":slot,"generation":1,"name":name,"serverNote":note]);selected[region]=profileID
                } else {
                    guard let i=profiles.firstIndex(where:{$0["id"] as? String==profileID}) else {throw ProtoError.failure("档案已不存在")}
                    if command=="catalog.update" {guard profiles[i]["deleting"] as? Bool != true else {throw ProtoError.failure("清理尚未完成")};let (name,note)=try checkedName(payload);profiles[i]["name"]=name;profiles[i]["serverNote"]=note}
                    else if command=="catalog.select" {selected[profiles[i]["region"] as! String]=profileID}
                    else {
                        let busy=profileIsBusy(profileID)
                        guard !busy else {throw ProtoError.failure("该档案有游戏、登录或排队任务，请先关闭")}
                        profiles[i]["deleting"]=true;profiles[i]["deleteRequest"]=requestID;profiles[i]["deleteError"]=""
                    }
                }
                revision+=1;mutations[requestID]=["command":command,"id":profileID]
                do {try save()} catch {profiles=oldProfiles;selected=oldSelected;mutations=oldMutations;revision=oldRevision;throw error}
                if command=="catalog.delete" {try ensureHost()};output=mutations[requestID]!
            case "credentials.metadata", "credentials.reveal", "credentials.addManual", "credentials.edit", "credentials.remove":
                guard role=="center" else {throw ProtoError.failure("权限不足")};output=try vault.manage(command,payload)
            case "batch.get" where role=="center":
                guard let id=payload["id"] as? String else{throw ProtoError.failure("无批次ID")}
                if let batch=try findBatch(id){output=["found":true,"batch":batch]}else{output=["found":false]}
            case "batch.start" where role=="center":
                try reconcileDeadHost()
                guard !reconciling,let id=payload["requestId"] as? String,UUID(uuidString:id) != nil,let ids=payload["profileIds"] as? [String],!ids.isEmpty,ids.count<=20 else {throw ProtoError.failure("启动参数或对账状态无效")}
                if let old=try findBatch(id) {
                    guard old["profileIds"] as? [String]==ids else {throw ProtoError.failure("请求ID重复使用")};output=old;break
                }
                var items=[[String:Any]]()
                for profileId in Array(NSOrderedSet(array:ids)) as! [String] {
                    let profile=profiles.first{$0["id"] as? String==profileId && $0["deleting"] as? Bool != true}
                    items.append(["operationId":UUID().uuidString,"profileId":profileId,"generation":profile?["generation"] ?? 0,"status":profile == nil ? "rejected":"pending","accepted":false,"reason":profile == nil ? "unknown-profile":""])
                }
                let batch:[String:Any]=["id":id,"profileIds":ids,"items":items,"autoClose":preferences["autoClose"] as? Bool ?? true]
                let previousBatches=batches,previousSelected=selected,previousPreferences=preferences,previousRevision=revision
                // Remember the first requested valid account per region, and the primary region.
                var remembered=Set<String>()
                for item in items where item["status"] as? String == "pending" {
                    guard let profile=profiles.first(where:{$0["id"] as? String == item["profileId"] as? String}),let region=profile["region"] as? String else {continue}
                    if remembered.isEmpty {preferences["region"]=region}
                    if remembered.insert(region).inserted {selected[region]=profile["id"] as? String}
                }
                if !remembered.isEmpty {revision+=1}
                batches.append(batch);do {try save()} catch {batches=previousBatches;selected=previousSelected;preferences=previousPreferences;revision=previousRevision;throw error}
                if items.contains(where:{$0["status"] as? String=="pending"}) {try ensureHost()};output=batch
            case "host.poll" where role=="host":
                guard let pid=payload["pid"] as? Int32,pid==hostPID,alive(pid),let instance=payload["instance"] as? String,
                      let reports=payload["tasks"] as? [[String:Any]] else {throw ProtoError.failure("宿主身份或窗口未就绪")}
                if !hostInstance.isEmpty && hostInstance != instance {throw ProtoError.failure("过期宿主实例")}
                if hostInstance.isEmpty && payload["windowShown"] as? Bool != true {throw ProtoError.failure("首次接管窗口未显示")}
                hostInstance=instance;reconciling=false
                hostRuntime=payload["runtime"] as? [String:Any] ?? [:]
                for result in payload["deletionResults"] as? [[String:Any]] ?? [] {
                    guard let id=result["id"] as? String,let index=profiles.firstIndex(where:{$0["id"] as? String==id && $0["deleting"] as? Bool==true}),result["requestId"] as? String==profiles[index]["deleteRequest"] as? String else {continue}
                    if result["ok"] as? Bool==true {
                        let region=profiles[index]["region"] as! String;profiles.remove(at:index);deleted.append(id)
                        if selected[region]==id {selected[region]=profiles.first(where:{$0["region"] as? String==region && $0["deleting"] as? Bool != true})?["id"] as? String}
                    } else {if profiles[index]["handledDelete"] as? String==result["requestId"] as? String {continue};profiles[index]["deleteError"]="清理未完成，可重试";profiles[index]["handledDelete"]=result["requestId"]}
                    revision+=1
                }

                for slot in hostRuntime["slots"] as? [String] ?? [] {
                    guard slot.range(of:"^persist:naruto-(br|cn)-[1-9][0-9]*$",options:.regularExpression) != nil else {continue}
                    let id=String(slot.dropFirst("persist:naruto-".count));let parts=id.split(separator:"-");guard let n=Int(parts[1]),n<1000000,!deleted.contains(id),!profiles.contains(where:{$0["id"] as? String==id}) else {continue}
                    profiles.append(["id":id,"region":String(parts[0]),"slot":n,"generation":1,"name":"历史登录槽位\(n)","serverNote":""]);revision+=1
                }
                let states=["queued","login-required","loading","ready","failed","cancelled","closed"]
                for b in batches.indices {
                    var items=batches[b]["items"] as! [[String:Any]]
                    for i in items.indices {
                        if let report=reports.first(where:{$0["operationId"] as? String==items[i]["operationId"] as? String}),let status=report["status"] as? String,states.contains(status),report["profileId"] as? String==items[i]["profileId"] as? String {
                            if items[i]["accepted"] as? Bool != true && payload["windowShown"] as? Bool != true {continue}
                            items[i]["status"]=status;items[i]["accepted"]=true;items[i]["instance"]=instance
                        }
                    };batches[b]["items"]=items
                }
                try save()
                var work=[[String:Any]]()
                for batch in batches {for item in batch["items"] as! [[String:Any]] where item["status"] as? String=="pending" {
                    if let profile=profiles.first(where:{$0["id"] as? String==item["profileId"] as? String && $0["generation"] as? Int==item["generation"] as? Int}) {var task=item;task["profile"]=profile;work.append(task)}
                }}
                output=["tasks":work,"profiles":profiles,"preferences":preferences,"revision":revision,"deletions":profiles.filter{$0["deleting"] as? Bool==true}]
            case "host.closed" where role=="host":
                guard payload["instance"] as? String==hostInstance else {throw ProtoError.failure("过期退出")};hostPID=0;reconciling=true;try reconcileDeadHost()
            case "credentials.list" where role=="host", "credentials.select" where role=="host":
                guard let operation=payload["operationId"] as? String,let origin=payload["origin"] as? String,trustedCredentialOrigin(origin),
                      batches.contains(where:{($0["items"] as! [[String:Any]]).contains(where:{$0["operationId"] as? String==operation && (["login-required","loading"].contains($0["status"] as? String ?? "") || (hostRuntime["loginOperation"] as? [String:Any])?["profileId"] as? String==$0["profileId"] as? String)})}) else {throw ProtoError.failure("无有效登录任务")}
                let records=try vault.read().filter{$0["origin"] as? String==origin}
                if command=="credentials.list" {
                    offers=offers.filter{($0.value["expires"] as? Double ?? 0)>Date().timeIntervalSince1970}
                    let id=UUID().uuidString;offers[id]=["operation":operation,"origin":origin,"ids":records.compactMap{$0["id"] as? String},"expires":Date().timeIntervalSince1970+30]
                    output=["records":records.map(vault.metadata),"offerId":id]
                } else {
                    guard let id=payload["offerId"] as? String,let offer=offers.removeValue(forKey:id),offer["operation"] as? String==operation,offer["origin"] as? String==origin,(offer["expires"] as? Double ?? 0)>Date().timeIntervalSince1970,(offer["ids"] as? [String] ?? []).contains(payload["id"] as? String ?? ""),let record=records.first(where:{$0["id"] as? String==payload["id"] as? String}) else {throw ProtoError.failure("选择已失效")}
                    output=["username":record["username"]!,"password":record["password"]!]
                }
            case "credentials.stageSave" where role=="host", "credentials.needsSave" where role=="host":
                guard let operation=payload["operationId"] as? String,let origin=payload["origin"] as? String,trustedCredentialOrigin(origin),batches.contains(where:{($0["items"] as! [[String:Any]]).contains{$0["operationId"] as? String==operation && $0["accepted"] as? Bool==true && ["login-required","loading","ready"].contains($0["status"] as? String ?? "")}}) else {throw ProtoError.failure("保存任务无效")}
                if command=="credentials.needsSave" {
                    let record=try vault.read().first{$0["origin"] as? String==origin && $0["username"] as? String==(payload["username"] as? String ?? "").trimmingCharacters(in:.whitespacesAndNewlines)}
                    output=["needed":record?["password"] as? String != payload["password"] as? String,"update":record != nil]
                }else{output=try vault.manage("credentials.stageSave",payload)}
            default: throw ProtoError.failure("命令或角色未开放")
            }
            try writeLine(client,["ok":true,"value":output])
        } catch {let message:String;if case ProtoError.failure(let detail)=error {message=detail} else {message="读写未完成，原资料保留"};try? writeLine(client,["ok":false,"message":message])}
    }
 }
}
