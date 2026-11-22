import Foundation
import Darwin
import Security

@main struct NativeCore {
 static func main() throws {
    signal(SIGPIPE, SIG_IGN)
    let env = ProcessInfo.processInfo.environment
    guard let root = env["NARUTO_C_ROOT"], let project = env["NARUTO_C_PROJECT"], let electron = env["NARUTO_C_ELECTRON"], runtimeRootAllowed(root,project,env) else { throw ProtoError.failure(msg("ui.only_isolated_prototype_directories_are_allowed")) }
    try FileManager.default.createDirectory(atPath:root, withIntermediateDirectories:true, attributes:[.posixPermissions:0o700])
    guard URL(fileURLWithPath:root).resolvingSymlinksInPath().standardizedFileURL.path == root else {throw ProtoError.failure(msg("ui.the_isolated_path_must_not_contain_links"))}
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
    let rawState:Data?
    do { rawState=try Data(contentsOf:URL(fileURLWithPath:statePath)) }
    catch {
        guard (error as NSError).domain==NSCocoaErrorDomain,(error as NSError).code==NSFileReadNoSuchFileError else { throw error }
        rawState=nil
    }
    if let data=rawState {
        guard let saved=try JSONSerialization.jsonObject(with:data) as? [String:Any],saved["version"] as? Int==1,saved["preferences"] is [String:Any] else { throw ProtoError.failure(msg("ui.management_data_is_damaged_the_original_file")) }
        state=saved
    } else {
        state=["version":1,"revision":1,"profiles":[["id":"br-1","region":"br","slot":1,"generation":1,"name":"巴西服账号"],["id":"cn-1","region":"cn","slot":1,"generation":1,"name":"国服账号"]],"preferences":[String:Any](),"batches":[]]
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
            guard let id=batch["id"] as? String,UUID(uuidString:id) != nil else{throw ProtoError.failure(msg("ui.invalid_historical_batch_id_original_records_were"))}
            try atomic(batch,receiptsPath+"/"+id+".json")
        }
        let ids=Set(finished.compactMap{$0["id"] as? String})
        batches.removeAll{ids.contains($0["id"] as? String ?? "")}
        recentBatches=boundedBatches(recentBatches+finished)
    }
    func findBatch(_ id:String) throws -> [String:Any]? {
        guard UUID(uuidString:id) != nil else{throw ProtoError.failure(msg("ui.invalid_batch_id"))}
        if let batch=(batches+recentBatches).first(where:{$0["id"] as? String==id}){return batch}
        let file=receiptsPath+"/"+id+".json"
        guard FileManager.default.fileExists(atPath:file) else{return nil}
        guard let batch=try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:file))) as? [String:Any],batch["id"] as? String==id else{throw ProtoError.failure(msg("ui.could_not_read_batch_receipt"))}
        return batch
    }
    var profiles=state["profiles"] as! [[String:Any]]
    var preferences=state["preferences"] as! [String:Any]
    let initialLanguage=initialInterfaceLanguage(preferences)
    for (key,value) in defaults where preferences[key]==nil {preferences[key]=value}
    preferences["language"]=initialLanguage
    var selected=state["selectedByRegion"] as? [String:String] ?? [:]
    var deleted=state["deletedIds"] as? [String] ?? []
    var mutations=state["mutations"] as? [String:[String:Any]] ?? [:]
    let vault=CoreVault(root,tokens["center"]!)
    var offers=[String:[String:Any]]()
    var hostRuntime:[String:Any]=[:]
    var revision=state["revision"] as! Int
    var hostPID=(state["hostPID"] as? Int32) ?? 0
    var hostInstance=state["hostInstance"] as? String ?? ""
    if hostPID != 0 && !alive(hostPID) { hostPID=0;hostInstance="" }
    var centerPID:Int32=0;var centerRegistered=false;var centerIntent:[String:Any]=[:]
    var reconciling=alive(hostPID)
    // Update handoff is runtime-only state: the centre prepares a replacement,
    // stops new work and asks the host to save and exit through its normal path.
    var updateMode=false
    // The watchdog must stay off while the host is inside an update handoff,
    // including after the centre cancels, until the host heartbeats again or exits.
    var hostWatchdogSuspended=false
    var updateHandoff:[String:Any]=[:]
    func setUpdateHandoff(_ state:String,_ extra:[String:Any]=[:]) {
        updateHandoff["state"]=state
        for (key,value) in extra {updateHandoff[key]=value}
        updateHandoff["at"]=ISO8601DateFormatter().string(from:Date())
    }
    var lastActivity=Date()
    var lastHostSeen=Date()
    var lastHostSpawn=Date.distantPast
    var lastSaved=Data()
    func logEvent(_ kind:String,_ detail:String="") {
        let file=root+"/core-events.log"
        if let attributes=try? FileManager.default.attributesOfItem(atPath:file),
           let size=attributes[.size] as? NSNumber, size.intValue>256*1024 { try? Data().write(to:URL(fileURLWithPath:file)) }
        let line=ISO8601DateFormatter().string(from:Date())+" "+kind+(detail.isEmpty ? "" : " "+detail)+"\n"
        guard let data=line.data(using:.utf8) else { return }
        if FileManager.default.fileExists(atPath:file), let handle=FileHandle(forWritingAtPath:file) {
            handle.seekToEndOfFile(); handle.write(data); try? handle.close()
        } else { try? data.write(to:URL(fileURLWithPath:file)) }
    }
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
    logEvent("core-start","pid=\(getpid()) root=\(root)")
    try reconcileDeadHost()
    try save() // Persist first-launch language and existing management migrations before accepting requests.
    func spawnRole(_ role:String) throws {
        let process=Process(); var childEnv=env
        childEnv["NARUTO_C_TOKEN"]=tokens[role]; childEnv["NARUTO_C_ROOT"]=root
        childEnv.removeValue(forKey:"ELECTRON_RUN_AS_NODE");childEnv["NARUTO_C_FLASH"]=preferences["flash"] as? String ?? "34"
        if role=="host" {
            process.executableURL=URL(fileURLWithPath:electron)
            process.arguments=env["NARUTO_C_PACKAGED"]=="1" ? [] : [project+"/dist/prototype/host.js"]
            // 游戏变速：开关开启且使用 Flash 34 时，向宿主进程树注入时间挂钩（仅 ppapi 子进程激活）。
            if (preferences["gameSpeed"] as? Bool)==true,(preferences["flash"] as? String ?? "34")=="34" {
                let dylib=project+"/assets/game-speed/libgame-speed.dylib"
                if FileManager.default.fileExists(atPath:dylib) {
                    childEnv["DYLD_INSERT_LIBRARIES"]=dylib
                    childEnv["NARUTO_GSCALE_MODE"]="sites"
                    childEnv["NARUTO_GSCALE_SITES"]="PepperFlashPlayer@1a7143,PepperFlashPlayer@1a70f5"
                    childEnv["NARUTO_GSCALE_RATE"]="2"
                    // 记忆倍率不直接作为启动档：核心恒以 1 倍启动，宿主在确认移动补丁
                    // 资源就绪后发信号恢复记忆档位，资源缺失或失配的会话保持 1 倍。
                    childEnv["NARUTO_GSCALE_START"]="1"

                    childEnv["NARUTO_SIGNAL_SWITCH"]="1"
                    childEnv["NARUTO_C_SPEED"]="1"
                }
            }
        } else {
            process.executableURL=URL(fileURLWithPath:env["NARUTO_C_CENTER_EXECUTABLE"] ?? project+"/dist/prototype/native/center")
            process.arguments=env["NARUTO_C_PACKAGED"]=="1" && env["NARUTO_C_FIXTURE"]=="1" ? ["--fixture-root",root] : []
        }
        process.environment=childEnv;process.standardInput=FileHandle.nullDevice
        if role=="host" {
            // Keep the game host's stderr so renderer/plugin crashes are diagnosable.
            try? FileManager.default.createDirectory(atPath:root+"/host",withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
            for name in ["stdout.log","stderr.log"] { try? Data().write(to:URL(fileURLWithPath:root+"/host/"+name)) }
            if let handle=FileHandle(forWritingAtPath:root+"/host/stderr.log") { process.standardError=handle }
            if let handle=FileHandle(forWritingAtPath:root+"/host/stdout.log") { process.standardOutput=handle }
        } else {
            process.standardOutput=FileHandle.nullDevice;process.standardError=FileHandle.nullDevice
        }
        try process.run()
        if role=="host" { hostPID=process.processIdentifier;lastHostSpawn=Date();lastHostSeen=Date();logEvent("host-spawn","pid=\(hostPID)");try save() } else { centerPID=process.processIdentifier;centerRegistered=false;logEvent("center-spawn","pid=\(centerPID)") }
    }
    func rearmPendingTasks() {
        for b in batches.indices {
            var items=batches[b]["items"] as! [[String:Any]]
            for i in items.indices where ["pending","queued"].contains(items[i]["status"] as? String ?? "") { items[i]["status"]="pending"; items[i]["accepted"]=false }
            batches[b]["items"]=items
        }
    }
    func ensureHost() throws {
        // An update handoff owns the process lifecycle until it finishes or aborts.
        guard !updateMode else { return }
        // Never run two hosts: the second one cannot hold the Chromium singleton
        // lock, quits immediately, and leaves the first one rejected forever.
        if hostPID != 0 {
            if alive(hostPID) {
                let limit: TimeInterval = hostInstance.isEmpty ? 30 : 10
                if !hostWatchdogSuspended && Date().timeIntervalSince(lastHostSeen) > limit { logEvent("host-kill","pid=\(hostPID) stale=\(Int(Date().timeIntervalSince(lastHostSeen)))s"); kill(hostPID, SIGTERM) }
                return
            }
            hostPID=0;hostInstance="";reconciling=false;hostWatchdogSuspended=false;rearmPendingTasks();try save()
        }
        guard Date().timeIntervalSince(lastHostSpawn) > 2 else { return }
        try spawnRole("host")
    }
    func profileIsBusy(_ id:String)->Bool {
        batches.contains{batch in (batch["items"] as! [[String:Any]]).contains{$0["profileId"] as? String==id && ["pending","queued","login-required","loading","ready","failed"].contains($0["status"] as? String ?? "")}}
    }
    func snapshot(_ preferredBatch:String? = nil) -> [String:Any] {
        var display=recentBatches+batches
        if let id=preferredBatch,let batch=try? findBatch(id){display.removeAll{$0["id"] as? String==id};display.append(batch)}
        let visibleBatches=boundedBatches(display)
        let views=profiles.map{profile -> [String:Any] in
            var view=profile
            view["runtimeStatus"]=batches.reversed().flatMap{$0["items"] as! [[String:Any]]}.first(where:{$0["profileId"] as? String==profile["id"] as? String})?["status"] as? String ?? "idle"
            view["identityNeedsConfirmation"]=(profile["name"] as? String ?? "")=="历史登录槽位\(profile["slot"] as? Int ?? 0)"
            view["cleanupStatus"]=profile["deleting"] as? Bool==true ? "pending" : NSNull()
            view["cleanupStage"]=profile["deleteError"] as? String ?? ""
            view["deleteBlockedReason"]=profileIsBusy(profile["id"] as! String) ? msg("ui.close_this_account_s_game_login_or") : ""
            return view
        }
        var choices=selected
        for region in ["br","cn"] where !profiles.contains(where:{$0["id"] as? String==choices[region] && $0["region"] as? String==region && $0["deleting"] as? Bool != true}) {
            choices[region]=profiles.first(where:{$0["region"] as? String==region && $0["deleting"] as? Bool != true})?["id"] as? String
        }
        let running=batches.flatMap{$0["items"] as! [[String:Any]]}.filter{["queued","login-required","loading","ready"].contains($0["status"] as? String ?? "")}
        return ["version":1,"runtimeIdentity":env["NARUTO_C_RUNTIME_ID"] ?? project,"centerIntent":centerIntent,"revision":revision,"update":["mode":updateMode,"handoff":updateHandoff],"corePID":getpid(),"centerPID":alive(centerPID) ? centerPID : 0,"hostPID":alive(hostPID) ? hostPID : 0,"hostInstance":hostInstance,"reconciling":reconciling,"fixture":env["NARUTO_C_FIXTURE"] == "1","profiles":views,"preferences":preferences,"batches":visibleBatches,"selectedByRegion":choices,"runtime":hostRuntime,"canCreateProfile":!reconciling,"runningAccountCount":Set(running.compactMap{$0["profileId"] as? String}).count]
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
            // A wedged host keeps its identity until it really exits; otherwise a
            // replacement would be rejected and the old window would stay blank.
            if hostPID != 0 && alive(hostPID) {
                let limit: TimeInterval = hostInstance.isEmpty ? 30 : 10
                // During a handoff the host intentionally stops polling while the
                // confirmation dialog or session save is open. The centre has its
                // own bounded wait; do not turn that pause into a SIGTERM.
                if !updateMode && !hostWatchdogSuspended && Date().timeIntervalSince(lastHostSeen) > limit { logEvent("host-kill","pid=\(hostPID) stale=\(Int(Date().timeIntervalSince(lastHostSeen)))s"); kill(hostPID, SIGTERM) }
            } else if Date().timeIntervalSince(lastHostSpawn) > 2 && batches.contains(where:{($0["items"] as! [[String:Any]]).contains{$0["status"] as? String=="pending" && $0["accepted"] as? Bool != true}}) {
                try? ensureHost()
            }
            if !alive(centerPID) && !alive(hostPID) && Date().timeIntervalSince(lastActivity)>8 { logEvent("core-idle-exit","pid=\(getpid())"); break }
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
                  let command=message["command"] as? String else {throw ProtoError.failure(msg("ui.authentication_or_protocol_failed"))}
            let payload=message["payload"] as? [String:Any] ?? [:]
            lastActivity=Date();var output:[String:Any]=[:]
            switch command {
            case "snapshot": try reconcileDeadHost();output=snapshot()
            case "center.open" where role=="center":
                centerPID=payload["pid"] as? Int32 ?? 0;centerRegistered=true;output=snapshot(payload["batchId"] as? String)
            case "center.closed" where role=="center":
                if payload["pid"] as? Int32 == centerPID {centerPID=0;centerRegistered=false;centerIntent=[:]}
                if updateMode {updateMode=false;updateHandoff=[:];logEvent("update-reset-center-closed")}
            case "center.ensure":
                if payload["page"] as? String == "settings" {centerIntent=["id":UUID().uuidString,"page":"settings"]}
                if updateMode { output=snapshot(); break }
                if alive(centerPID) {if centerRegistered {kill(centerPID,SIGUSR1)}} else { try spawnRole("center") };output=snapshot()
            case "preferences.patch" where role=="center":
                guard payload["revision"] as? Int == revision else {throw ProtoError.failure(msg("error.preferenceConflict"))}
                guard let key=payload["key"] as? String else {throw ProtoError.failure(msg("ui.missing_field"))}
                guard let value=payload["value"] else {throw ProtoError.failure(msg("ui.missing_field_value"))}
                try validatePreference(key,value)
                let old=preferences;preferences[key]=value;revision+=1
                do {try save()} catch {preferences=old;revision-=1;throw error};output=snapshot()
            case "host.speedRate" where role=="host":
                guard let rate=payload["rate"] as? Int,rate>=1,rate<=10 else {throw ProtoError.failure(msg("ui.invalid_switch_value"))}
                let oldRate=preferences;preferences["gameSpeedRate"]=rate
                do {try save()} catch {preferences=oldRate;throw error};output=snapshot()
            case "catalog.importLocal" where role=="center":
                guard !reconciling,let requestID=payload["requestId"] as? String,UUID(uuidString:requestID) != nil else{throw ProtoError.failure(msg("ui.invalid_import_request_or_reconciliation_state"))}
                if let receipt=mutations[requestID] {guard receipt["command"] as? String==command else{throw ProtoError.failure(msg("ui.import_request_id_conflict"))};output=receipt;break}
                guard payload["revision"] as? Int==revision,let incoming=payload["profiles"] as? [[String:Any]],incoming.count<=1000,let passwords=payload["credentials"] as? [[String:Any]],passwords.count<=1000 else{throw ProtoError.failure(msg("ui.invalid_import_format_or_revision"))}
                var merged=profiles;var seen=Set<String>()
                for profile in incoming {
                    guard let id=profile["id"] as? String,let region=profile["region"] as? String,["br","cn"].contains(region),let slot=profile["slot"] as? Int,slot>0,id=="\(region)-\(slot)",!seen.contains(id),!deleted.contains(id) else{throw ProtoError.failure(msg("ui.imported_slot_is_duplicate_deleted_or_invalid"))}
                    seen.insert(id);let (name,note)=try checkedName(profile)
                    if let i=merged.firstIndex(where:{$0["id"] as? String==id}) {
                        guard merged[i]["deleting"] as? Bool != true else{throw ProtoError.failure(msg("ui.imported_profile_is_being_cleaned_up"))}
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
                guard role=="center",!reconciling,let requestID=payload["requestId"] as? String,UUID(uuidString:requestID) != nil else {throw ProtoError.failure(msg("ui.invalid_request_id_or_reconciliation_state"))}
                if let previous=mutations[requestID] {guard previous["command"] as? String==command else {throw ProtoError.failure(msg("ui.request_id_conflict"))};output=previous;break}
                guard payload["revision"] as? Int==revision else {throw ProtoError.failure(msg("error.profileConflict"))}
                let oldProfiles=profiles,oldSelected=selected,oldMutations=mutations;let oldRevision=revision
                var profileID=payload["id"] as? String ?? ""
                if command=="catalog.create" {
                    guard let region=payload["region"] as? String,["br","cn"].contains(region) else {throw ProtoError.failure(msg("ui.invalid_region"))}
                    let (name,note)=try checkedName(payload)
                    let used=(profiles.compactMap{$0["id"] as? String}+deleted).filter{$0.hasPrefix(region+"-")}.compactMap{Int($0.split(separator:"-").last ?? "0")}
                    let slot=(used.max() ?? 0)+1;profileID="\(region)-\(slot)"
                    profiles.append(["id":profileID,"region":region,"slot":slot,"generation":1,"name":name,"serverNote":note]);selected[region]=profileID
                } else {
                    guard let i=profiles.firstIndex(where:{$0["id"] as? String==profileID}) else {throw ProtoError.failure(msg("ui.profile_no_longer_exists"))}
                    if command=="catalog.update" {guard profiles[i]["deleting"] as? Bool != true else {throw ProtoError.failure(msg("ui.cleanup_is_not_finished"))};let (name,note)=try checkedName(payload);profiles[i]["name"]=name;profiles[i]["serverNote"]=note}
                    else if command=="catalog.select" {selected[profiles[i]["region"] as! String]=profileID}
                    else {
                        let busy=profileIsBusy(profileID)
                        guard !busy else {throw ProtoError.failure(msg("ui.this_profile_has_game_login_or_queued"))}
                        profiles[i]["deleting"]=true;profiles[i]["deleteRequest"]=requestID;profiles[i]["deleteError"]=""
                    }
                }
                revision+=1;mutations[requestID]=["command":command,"id":profileID]
                do {try save()} catch {profiles=oldProfiles;selected=oldSelected;mutations=oldMutations;revision=oldRevision;throw error}
                if command=="catalog.delete" {try ensureHost()};output=mutations[requestID]!
            case "credentials.metadata", "credentials.reveal", "credentials.addManual", "credentials.edit", "credentials.remove":
                guard role=="center" else {throw ProtoError.failure(msg("ui.insufficient_permissions"))};output=try vault.manage(command,payload)
            case "batch.get" where role=="center":
                guard let id=payload["id"] as? String else{throw ProtoError.failure(msg("ui.missing_batch_id"))}
                if let batch=try findBatch(id){output=["found":true,"batch":batch]}else{output=["found":false]}
            case "batch.start" where role=="center":
                try reconcileDeadHost()
                guard !updateMode else {throw ProtoError.failure(msg("update.in_progress"))}
                guard !reconciling,let id=payload["requestId"] as? String,UUID(uuidString:id) != nil,let ids=payload["profileIds"] as? [String],!ids.isEmpty,ids.count<=20 else {throw ProtoError.failure(msg("ui.invalid_launch_parameters_or_reconciliation_state"))}
                if let old=try findBatch(id) {
                    guard old["profileIds"] as? [String]==ids else {throw ProtoError.failure(msg("ui.request_id_was_reused"))};output=old;break
                }
                var items=[[String:Any]]()
                for profileId in Array(NSOrderedSet(array:ids)) as! [String] {
                    let profile=profiles.first{$0["id"] as? String==profileId && $0["deleting"] as? Bool != true}
                    items.append(["operationId":UUID().uuidString,"profileId":profileId,"generation":profile?["generation"] ?? 0,"status":profile == nil ? "rejected":"pending","accepted":false,"reason":profile == nil ? "unknown-profile":""])
                }
                logEvent("batch-start","id=\(id) ids=\(ids.joined(separator:","))")
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
            case "update.prepare" where role=="center":
                guard !updateMode else {throw ProtoError.failure(msg("update.in_progress"))}
                updateMode=true;hostWatchdogSuspended=true;setUpdateHandoff("prepared");logEvent("update-prepare");output=snapshot()
            case "update.quitHost" where role=="center":
                guard updateMode else {throw ProtoError.failure(msg("update.not_in_progress"))}
                hostWatchdogSuspended=true
                setUpdateHandoff("quitting-host")
                if hostPID != 0 && alive(hostPID) {logEvent("update-host-quit","pid=\(hostPID)");kill(hostPID,SIGUSR2)} else {setUpdateHandoff("host-exited",["host":"none"])}
                output=snapshot()
            case "update.cancel" where role=="center":
                updateMode=false;updateHandoff=[:];logEvent("update-cancel");output=snapshot()
            case "host.updateHandoff" where role=="host":
                guard payload["instance"] as? String==hostInstance else {throw ProtoError.failure(msg("ui.stale_exit_request"))}
                guard let state=payload["state"] as? String,["confirming","cancelled","saving","save-failed","closed"].contains(state) else {throw ProtoError.failure(msg("update.not_in_progress"))}
                guard updateMode else {throw ProtoError.failure(msg("update.not_in_progress"))}
                setUpdateHandoff(state,["host":state]);logEvent("update-host-state",state);output=[:]
            case "host.poll" where role=="host":
                guard let pid=payload["pid"] as? Int32,alive(pid),let instance=payload["instance"] as? String,
                      let reports=payload["tasks"] as? [[String:Any]] else {throw ProtoError.failure("host-identity")}
                // The only live poller owns the window. Adopt it instead of
                // rejecting forever after a failed replacement.
                if hostPID == 0 || !alive(hostPID) { hostPID=pid;hostInstance="";reconciling=false }
                if pid != hostPID { throw ProtoError.failure("host-identity") }
                if !hostInstance.isEmpty && hostInstance != instance {throw ProtoError.failure(msg("error.staleHost"))}
                if hostInstance.isEmpty && payload["windowShown"] as? Bool != true {throw ProtoError.failure("host-window-not-ready")}
                hostInstance=instance;reconciling=false;hostWatchdogSuspended=false;lastHostSeen=Date()
                hostRuntime=payload["runtime"] as? [String:Any] ?? [:]
                for result in payload["deletionResults"] as? [[String:Any]] ?? [] {
                    guard let id=result["id"] as? String,let index=profiles.firstIndex(where:{$0["id"] as? String==id && $0["deleting"] as? Bool==true}),result["requestId"] as? String==profiles[index]["deleteRequest"] as? String else {continue}
                    if result["ok"] as? Bool==true {
                        let region=profiles[index]["region"] as! String;profiles.remove(at:index);deleted.append(id)
                        if selected[region]==id {selected[region]=profiles.first(where:{$0["region"] as? String==region && $0["deleting"] as? Bool != true})?["id"] as? String}
                    } else {if profiles[index]["handledDelete"] as? String==result["requestId"] as? String {continue};profiles[index]["deleteError"]=msg("ui.cleanup_incomplete_you_can_retry");profiles[index]["handledDelete"]=result["requestId"]}
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
                guard payload["instance"] as? String==hostInstance else {throw ProtoError.failure(msg("ui.stale_exit_request"))};hostPID=0;reconciling=true;hostWatchdogSuspended=false;try reconcileDeadHost()
                if updateMode {setUpdateHandoff("host-exited",["host":"closed"])}
            case "credentials.list" where role=="host", "credentials.select" where role=="host":
                guard let operation=payload["operationId"] as? String,let origin=payload["origin"] as? String,trustedCredentialOrigin(origin),
                      batches.contains(where:{($0["items"] as! [[String:Any]]).contains(where:{$0["operationId"] as? String==operation && (["login-required","loading"].contains($0["status"] as? String ?? "") || (hostRuntime["loginOperation"] as? [String:Any])?["profileId"] as? String==$0["profileId"] as? String)})}) else {throw ProtoError.failure(msg("ui.no_valid_login_task"))}
                let records=try vault.read().filter{$0["origin"] as? String==origin}
                if command=="credentials.list" {
                    offers=offers.filter{($0.value["expires"] as? Double ?? 0)>Date().timeIntervalSince1970}
                    let id=UUID().uuidString;offers[id]=["operation":operation,"origin":origin,"ids":records.compactMap{$0["id"] as? String},"expires":Date().timeIntervalSince1970+30]
                    output=["records":records.map(vault.metadata),"offerId":id]
                } else {
                    guard let id=payload["offerId"] as? String,let offer=offers.removeValue(forKey:id),offer["operation"] as? String==operation,offer["origin"] as? String==origin,(offer["expires"] as? Double ?? 0)>Date().timeIntervalSince1970,(offer["ids"] as? [String] ?? []).contains(payload["id"] as? String ?? ""),let record=records.first(where:{$0["id"] as? String==payload["id"] as? String}) else {throw ProtoError.failure(msg("ui.selection_expired"))}
                    output=["username":record["username"]!,"password":record["password"]!]
                }
            case "credentials.stageSave" where role=="host", "credentials.needsSave" where role=="host":
                guard let operation=payload["operationId"] as? String,let origin=payload["origin"] as? String,trustedCredentialOrigin(origin),batches.contains(where:{($0["items"] as! [[String:Any]]).contains{$0["operationId"] as? String==operation && $0["accepted"] as? Bool==true && ["login-required","loading","ready"].contains($0["status"] as? String ?? "")}}) else {throw ProtoError.failure(msg("ui.invalid_save_task"))}
                if command=="credentials.needsSave" {
                    let record=try vault.read().first{$0["origin"] as? String==origin && $0["username"] as? String==(payload["username"] as? String ?? "").trimmingCharacters(in:.whitespacesAndNewlines)}
                    output=["needed":record?["password"] as? String != payload["password"] as? String,"update":record != nil]
                }else{output=try vault.manage("credentials.stageSave",payload)}
            default: throw ProtoError.failure(msg("ui.command_or_role_is_not_available"))
            }
            try writeLine(client,["ok":true,"value":output])
        } catch {let message:String;if case ProtoError.failure(let detail)=error {message=detail} else {message=msg("ui.read_or_write_incomplete_original_data_was")};try? writeLine(client,["ok":false,"message":localized(message, "zh-CN"),"messageRef":message,"code":messageCode(message)])}
    }
 }
}
