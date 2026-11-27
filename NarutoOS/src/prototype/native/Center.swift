import AppKit
import WebKit
import Foundation
import Darwin

// Native hit area: WKWebView does not honor Electron's CSS app-region.
final class CenterDragArea:NSView {
 override func mouseDown(with event:NSEvent){window?.performDrag(with:event)}
 override func acceptsFirstMouse(for event:NSEvent?)->Bool{true}
}

final class CenterWebView: WKWebView {
 override func acceptsFirstMouse(for event:NSEvent?)->Bool { true }
}

final class Center:NSObject,NSApplicationDelegate,NSWindowDelegate,WKNavigationDelegate,WKUIDelegate,WKScriptMessageHandler {
 let root=ProcessInfo.processInfo.environment["NARUTO_C_ROOT"]!
 let token=ProcessInfo.processInfo.environment["NARUTO_C_TOKEN"]!
 let project=ProcessInfo.processInfo.environment["NARUTO_C_PROJECT"]!
 var window:NSWindow!;var web:WKWebView!;var page:URL!;var fading=false
 func fadeAndTerminate(){
  guard !fading else{return};fading=true
  logCenter("terminate","auto-close hostPid=\(hostPid)")
  NSAnimationContext.runAnimationGroup({ context in
   context.duration=0.28
   window.animator().alphaValue=0
  }, completionHandler:{ NSApp.terminate(nil) })
 }
 func fadeAndHide(){
  guard !hidden else{return}
  hideGeneration += 1;let generation=hideGeneration
  fading=true
  NSAnimationContext.runAnimationGroup({ context in
   context.duration=0.28
   window.animator().alphaValue=0
  }, completionHandler:{ [weak self] in
   guard let self=self,self.hideGeneration==generation else{return}
   self.hidden=true;self.hiddenIdle=0;self.fading=false
   self.window.alphaValue=1
   NSApp.hide(nil)
   self.activity=ProcessInfo.processInfo.beginActivity(options:[.userInitiatedAllowingIdleSystemSleep],reason:"Naruto OS launch center")
   self.logCenter("hide")
  })
 }
 func showWindow(_ cause:String="userRevealed"){
  hideGeneration += 1
  hidden=false;hiddenIdle=0;userRevealed=true;fading=false
  if let activity=activity {ProcessInfo.processInfo.endActivity(activity);self.activity=nil}
  NSApp.unhide(nil)
  window.alphaValue=1
  logCenter("show","\(cause) hostPid=\(hostPid)")
  window.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true)
 }
 var revision=0;var ownBatch:String?;var timer:Timer?;var refreshing=false;var autoSubmitted=false
 var dirty=false;var managementOpen=false;var pendingWrites=0;var failures=0
 var hidden=false;var hostPid=0;var hiddenIdle=0;var activity:NSObjectProtocol?
 // The centre is revealed from SIGUSR1 only after a post-signal snapshot has been
 // applied to the page, so a settings intent never flashes the launcher first.
 // snapshotReveals marks the one paint that owns the reveal: its completion handler
 // captured the flag at paint time, so an older snapshot's late callback cannot show.
 var pendingReveal=false;var revealRequestedAt:Date?;var snapshotReveals=false
 // A user who brings the launch centre back is using it on purpose; do not hide it again
 // for the same batch. hideGeneration invalidates an in-flight fade-out animation.
 var userRevealed=false;var hideGeneration=0
 let updates=UpdateController();var updateActive=false;var updateTerminating=false
 var source:DispatchSourceSignal?;var lock:Int32 = -1
 let work=DispatchQueue(label:"Naruto.Center.Business")
 func logCenter(_ kind:String,_ detail:String="") {
  let file=root+"/center-events.log"
  let line=ISO8601DateFormatter().string(from:Date())+" "+kind+(detail.isEmpty ? "" : " "+detail)+"\n"
  guard let data=line.data(using:.utf8) else { return }
  if let handle=FileHandle(forWritingAtPath:file) { handle.seekToEndOfFile(); handle.write(data); try? handle.close() }
  else { try? data.write(to:URL(fileURLWithPath:file)) }
 }
 func applicationDidFinishLaunching(_ notification:Notification){
  do{lock=try roleLock(root,"center")}catch{logCenter("terminate","role-lock-failed");_ = try? rpc(root,"center",token,"center.ensure");NSApp.terminate(nil);return}
  let initialState=try? rpc(root,"center",token,"center.open",["pid":getpid()])
  if let preferences=initialState?["preferences"] as? [String:Any] {interfaceLanguage=normalizedLanguage(preferences["language"])} else {interfaceLanguage=startupLanguage()}
  signal(SIGUSR1,SIG_IGN);source=DispatchSource.makeSignalSource(signal:SIGUSR1,queue:.main);source?.setEventHandler{[weak self] in self?.pendingReveal=true;self?.revealRequestedAt=Date();self?.refresh()};source?.resume()
  let smallCheck=ProcessInfo.processInfo.environment["NARUTO_C_FIXTURE"]=="1" && ["launcher","i18n"].contains(ProcessInfo.processInfo.environment["NARUTO_C_UI_CHECKS"] ?? "") && ProcessInfo.processInfo.environment["NARUTO_C_LAUNCHER_SMALL"]=="1"
  window=NSWindow(contentRect:CenterWindowLayout.initialContentRect(small:smallCheck),styleMask:[.titled,.closable,.miniaturizable,.fullSizeContentView],backing:.buffered,defer:false)
  updateMenu()
  window.title="Naruto OS";window.titleVisibility = .hidden;window.titlebarAppearsTransparent=true;window.isMovableByWindowBackground=false;window.center();window.delegate=self;window.collectionBehavior=[.fullScreenNone]
  let config=WKWebViewConfiguration();config.websiteDataStore = .nonPersistent();config.userContentController.add(self,name:"narutoCore")
  if let state=initialState,let data=try? json(state),let text=String(data:data,encoding:.utf8) {
   config.userContentController.addUserScript(WKUserScript(source:"window.__narutoInitialState=\(text)",injectionTime:.atDocumentStart,forMainFrameOnly:true))
  }
  web=CenterWebView(frame:window.contentView!.bounds,configuration:config);web.autoresizingMask=[.width,.height];web.navigationDelegate=self;web.uiDelegate=self
  let content=NSView(frame:web.frame)
  window.contentView=content;content.addSubview(web)
  let drag=CenterDragArea(frame:NSRect(x:85,y:content.bounds.height-42,width:max(0,content.bounds.width-137),height:42))
  drag.autoresizingMask=[.width,.minYMargin];content.addSubview(drag)
  page=URL(fileURLWithPath:project+"/dist/prototype/launcher/index.html").standardizedFileURL
  web.loadFileURL(page,allowingReadAccessTo:page.deletingLastPathComponent())
  if let data=try? Data(contentsOf:URL(fileURLWithPath:root+"/center-window.json")),let value=(try? JSONSerialization.jsonObject(with:data)) as? [String:Double],let x=value["x"],let y=value["y"],x.isFinite,y.isFinite{window.setFrameOrigin(NSPoint(x:x,y:y));fitWindow()}
  window.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true)
  NotificationCenter.default.addObserver(self,selector:#selector(fitWindow),name:NSApplication.didChangeScreenParametersNotification,object:nil)
  alignTrafficLights();
  refresh();timer=Timer.scheduledTimer(withTimeInterval:0.6,repeats:true){[weak self] _ in self?.refresh()}
  updates.bootstrap(self)
 }
 func updateMenu(){
  if Bundle.main.bundleIdentifier=="cn.youye.naruto-os" || (ProcessInfo.processInfo.environment["NARUTO_C_FIXTURE"]=="1" && ProcessInfo.processInfo.environment["NARUTO_C_UI_CHECKS"]=="i18n") {
   let menu=NSMenu(),item=NSMenuItem(),submenu=NSMenu(title:"Naruto OS");menu.addItem(item);item.submenu=submenu
   let about=NSMenuItem(title:localized(msg("ui.about_naruto_os")),action:#selector(showAboutPanel),keyEquivalent:"");about.target=self;submenu.addItem(about)
   let settings=NSMenuItem(title:localized(msg("ui.settings")),action:#selector(openSettings),keyEquivalent:",");settings.target=self;submenu.addItem(settings)
   let checkUpdate=NSMenuItem(title:localized(msg("update.menu_check")),action:#selector(checkForUpdates),keyEquivalent:"");checkUpdate.target=self;submenu.addItem(checkUpdate)
   let close=NSMenuItem(title:localized(msg("ui.close_launch_center")),action:#selector(NSWindow.performClose(_:)),keyEquivalent:"w");close.target=window;submenu.addItem(close)
   submenu.addItem(.separator());let quit=NSMenuItem(title:localized(msg("ui.quit_launch_center")),action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q");quit.target=NSApp;submenu.addItem(quit)
   let edit=NSMenu(title:localized(msg("ui.edit")))
   for (title,action,key) in [(localized(msg("ui.cut")),"cut:","x"),(localized(msg("ui.copy")),"copy:","c"),(localized(msg("ui.paste")),"paste:","v"),(localized(msg("ui.select_all")),"selectAll:","a")] { edit.addItem(NSMenuItem(title:title,action:Selector(action),keyEquivalent:key)) }
   let editItem=NSMenuItem();editItem.submenu=edit;menu.addItem(editItem);NSApp.mainMenu=menu
  }
 }
 @objc func fitWindow(){
  if let window=window{CenterWindowLayout.fitWindow(window)}
 }
 func windowDidChangeScreen(_ notification:Notification){fitWindow();alignTrafficLights()}
 func windowDidResize(_ notification:Notification){alignTrafficLights()}
 func windowDidMove(_ notification:Notification){
  try? atomic(["x":window.frame.minX,"y":window.frame.minY],root+"/center-window.json")
 }
 func windowDidBecomeKey(_ notification:Notification){alignTrafficLights()}
 func windowDidUpdate(_ notification:Notification){alignTrafficLights()}
 func alignTrafficLights(){
  if let window=window{CenterWindowLayout.alignTrafficLights(in:window)}
 }
 func userContentController(_ controller:WKUserContentController,didReceive message:WKScriptMessage){
  guard message.frameInfo.isMainFrame,message.frameInfo.request.url?.standardizedFileURL==page,let body=message.body as? [String:Any],let command=body["command"] as? String else{return}
  let payload=body["payload"] as? [String:Any] ?? [:]
  if command=="ui.state"{dirty=payload["dirty"] as? Bool ?? false;managementOpen=payload["settingsOpen"] as? Bool ?? false;return}
  if command=="about.open"{guard let id=body["id"] as? String,UUID(uuidString:id) != nil else{return};NSWorkspace.shared.open(URL(string:"https://github.com/qiuyuehu/NarutoOS")!);reply(id,["ok":true,"value":[:]]);return}
  if command=="update.check"{guard let id=body["id"] as? String,UUID(uuidString:id) != nil else{return};reply(id,["ok":true,"value":[:]]);DispatchQueue.main.async{self.updates.manualCheck()};return}
  let allowed=["snapshot","preferences.patch","catalog.create","catalog.update","catalog.select","catalog.delete","batch.start","batch.get","credentials.metadata","credentials.reveal","credentials.addManual","credentials.edit","credentials.remove"]
  guard allowed.contains(command),let id=body["id"] as? String,UUID(uuidString:id) != nil else{return}
  if command=="batch.start"{ownBatch=payload["requestId"] as? String;userRevealed=false}
  pendingWrites+=1
  work.async {
   var reply:[String:Any]
   do{let result=try rpc(self.root,"center",self.token,command,payload);reply=["ok":true,"value":result]}catch{let message:String;if case ProtoError.failure(let detail)=error{message=detail}else{message=msg("ui.operation_incomplete_refresh_and_retry")};reply=["ok":false,"message":localized(message),"messageRef":message,"code":messageCode(message)]}
   DispatchQueue.main.async{self.pendingWrites-=1;self.reply(id,reply);self.refresh()}
  }
 }
 func reply(_ id:String,_ object:[String:Any]){
  guard let data=try? json([id,object]),let text=String(data:data,encoding:.utf8) else{return}
  web.evaluateJavaScript("window.__narutoResponse?.(...\(text))",completionHandler:nil)
 }
 func refresh(){
  if refreshing{return};refreshing=true
  work.async{
   var payload:[String:Any]=["pid":getpid()];if let batch=self.ownBatch{payload["batchId"]=batch}
   let started=Date()
   let state=try? rpc(self.root,"center",self.token,"center.open",payload)
   DispatchQueue.main.async{
    self.refreshing=false
    guard let state=state else{
     self.failures+=1
     if self.pendingReveal{self.pendingReveal=false;self.revealRequestedAt=nil;self.showWindow()}
     if self.failures==3 || self.failures%20==0 {let process=Process();process.executableURL=URL(fileURLWithPath:self.project+"/dist/prototype/native/core");process.environment=ProcessInfo.processInfo.environment;process.standardInput=FileHandle.nullDevice;process.standardOutput=FileHandle.nullDevice;process.standardError=FileHandle.nullDevice;try? process.run()}
     return
    }
    // A poll already in flight when the centre was signalled may predate the intent
    // Core stored with it; started is captured right before the rpc, so a poll that
    // began after the signal is guaranteed to carry the intent.
    if self.pendingReveal && self.revealRequestedAt != nil && started < self.revealRequestedAt! {self.refresh();return}
    self.failures=0
    // This snapshot is the first one guaranteed to carry the wake's intent, so only
    // its paint may reveal the window. Consume the pending reveal here, not at JS
    // completion, so a failure to run the page script cannot leave the wake stuck.
    self.snapshotReveals=self.pendingReveal
    if self.pendingReveal{self.pendingReveal=false;self.revealRequestedAt=nil}
    self.paint(state)
   }
  }
 }
 func paint(_ state:[String:Any]){
  revision=state["revision"] as? Int ?? 0
  hostPid=(state["hostPID"] as? Int) ?? 0
  // Keep the centre alive after the game window closes. It used to terminate itself
  // after a few idle seconds, which looked like a crash when the user had not brought
  // it back yet. Quitting stays an explicit action.
  hiddenIdle=0
  let language=normalizedLanguage((state["preferences"] as? [String:Any])?["language"])
  if language != interfaceLanguage {interfaceLanguage=language;updateMenu()}
  if let text=String(data:(try? json(state)) ?? Data(),encoding:.utf8){
   let reveals=snapshotReveals
   web.evaluateJavaScript("window.__narutoSnapshot?.(\(text))",completionHandler:{[weak self] _,_ in
    guard let self=self else{return}
    if reveals{self.snapshotReveals=false;self.showWindow("reveal")}
   })
  }
  let batches=state["batches"] as? [[String:Any]] ?? []
  var rows=[String:String]()
  for profile in state["profiles"] as? [[String:Any]] ?? [] {let id=profile["id"] as! String;let status=profile["runtimeStatus"] as? String ?? localized(msg("ui.not_started"));rows[id]="\(profile["name"] as! String) · \(id) · \(status)"}
  try? atomic(["pid":getpid(),"hostPID":state["hostPID"] ?? 0,"rows":rows,"width":window.frame.width,"height":window.frame.height,"engine":"WKWebView","language":interfaceLanguage,"menuTitles":NSApp.mainMenu?.items.flatMap{$0.submenu?.items.map{$0.title} ?? []} ?? [],"settingsOpen":managementOpen,"dragAreaInstalled":window.contentView?.subviews.contains(where:{$0 is CenterDragArea}) == true,"trafficLightCenters":CenterWindowLayout.trafficLightCenters(in:window),"integratedTitlebar":window.styleMask.contains(.fullSizeContentView) && window.titleVisibility == .hidden],root+"/center-view.json")
  if let id=ownBatch,let batch=batches.first(where:{$0["id"] as? String==id}){
   let all=batch["items"] as! [[String:Any]]
   let accepted=all.allSatisfy{$0["accepted"] as? Bool==true}
   let active=all.contains{!["cancelled","closed","interrupted"].contains($0["status"] as? String ?? "")}
   if !all.isEmpty && accepted && active && batch["autoClose"] as? Bool==true {
    // The launch centre owns the core bridge the game host talks to, so it may only
    // hide, never terminate: a full exit leaves the game page without its parent.
    if !userRevealed && !dirty && !managementOpen && pendingWrites==0 && !updateActive {if ProcessInfo.processInfo.environment["NARUTO_C_FIXTURE"]=="1" {fadeAndTerminate()} else {fadeAndHide()}}
   }else if all.allSatisfy({$0["accepted"] as? Bool==true || $0["status"] as? String=="rejected"}){ownBatch=nil}
  }
  if !autoSubmitted,let auto=ProcessInfo.processInfo.environment["NARUTO_C_AUTO_PROFILES"],!auto.isEmpty{
   autoSubmitted=true;let id=UUID().uuidString;ownBatch=id
   work.async{_ = try? rpc(self.root,"center",self.token,"batch.start",["requestId":id,"profileIds":auto.split(separator:",").map(String.init)])}
  }
 }
 func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!){
  let checkMode=ProcessInfo.processInfo.environment["NARUTO_C_UI_CHECKS"] ?? ""
  guard ["1","launcher","login-tabs","i18n"].contains(checkMode),ProcessInfo.processInfo.environment["NARUTO_C_AUTO_PROFILES"]==nil else{return}
  let checkFile=checkMode=="i18n" ? "i18n-check.js" : checkMode=="login-tabs" ? "login-tabs-check.js" : checkMode=="launcher" ? "launcher-check.js" : "center-check.js"
  if let script=try? String(contentsOfFile:project+"/tests/fixtures/native-core/"+checkFile,encoding:.utf8){webView.evaluateJavaScript(script,completionHandler:nil)}
  var checks=0
  Timer.scheduledTimer(withTimeInterval:0.5,repeats:true){timer in
   checks+=1;if checks>120{timer.invalidate();return}
   webView.evaluateJavaScript("JSON.stringify(window.__uiTestOutcome||null)"){value,error in
    guard let text=value as? String,text != "null",let data=text.data(using:.utf8),let result=try? JSONSerialization.jsonObject(with:data) else{return}
    try? atomic(result,self.root+"/ui-check.json");timer.invalidate()
    self.web.takeSnapshot(with:nil){image,error in
     guard let data=image?.tiffRepresentation,let bitmap=NSBitmapImageRep(data:data),let png=bitmap.representation(using:.png,properties:[:]) else{return}
     try? png.write(to:URL(fileURLWithPath:self.root+"/ui-center.png"))
    }
   }
  }
 }
 func webView(_ webView:WKWebView,decidePolicyFor navigationAction:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void){decisionHandler(navigationAction.request.url?.standardizedFileURL==page ? .allow:.cancel)}
 func webView(_ webView:WKWebView,createWebViewWith configuration:WKWebViewConfiguration,for navigationAction:WKNavigationAction,windowFeatures:WKWindowFeatures)->WKWebView?{nil}
 var hasUnfinishedEditsOrSaves:Bool { dirty || pendingWrites>0 }
 func confirmClose()->Bool{
  guard hasUnfinishedEditsOrSaves else{return true}
  let alert=NSAlert();alert.messageText=localized(msg("ui.there_are_unfinished_edits_or_saves_close"))
  alert.addButton(withTitle:localized(msg("ui.continue_editing")));alert.addButton(withTitle:localized(msg("ui.close_214")))
  return alert.runModal() == .alertSecondButtonReturn
 }
 func windowShouldClose(_ sender:NSWindow)->Bool{
  if !hidden && hostPid != 0 { logCenter("hide","window-close hostPid=\(hostPid)"); fadeAndHide(); return false }
  guard hasUnfinishedEditsOrSaves else{return true}
  // Keep the window alive while AppKit asks once whether to discard pending changes.
  DispatchQueue.main.async { NSApp.terminate(nil) }
  return false
 }
 @objc func showAboutPanel(){
  let credits=NSMutableAttributedString(string:"Qiuyue · Codex",attributes:[.font:NSFont.systemFont(ofSize:11)])
  credits.append(NSAttributedString(string:"\ngithub.com/qiuyuehu/NarutoOS",attributes:[.font:NSFont.systemFont(ofSize:10),.foregroundColor:NSColor.secondaryLabelColor]))
  NSApp.orderFrontStandardAboutPanel(options:[.applicationName:"Naruto OS",.credits:credits])
 }
 @objc func openSettings(){web.evaluateJavaScript("if(document.getElementById('settings-panel').hidden)window.naruto.command({type:'settings'})",completionHandler:{[weak self] _,_ in self?.showWindow()})}
 @objc func checkForUpdates(){updates.manualCheck()}
 func applicationShouldHandleReopen(_ sender:NSApplication,hasVisibleWindows flag:Bool)->Bool{showWindow();return true}
 // Clicking the Dock icon or switching back may only unhide the app without a reopen
 // callback. Resync the internal state, otherwise the idle timer keeps counting and
 // terminates a centre the user is looking at.
 func applicationDidBecomeActive(_ notification:Notification){
  guard window != nil else{return}
  // Only resync the flag the user can observe. Testing window visibility here would
  // let activate -> showWindow -> activate recurse if the flag lags a frame behind.
  if hidden {showWindow()}
 }
 func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool{ !hidden }
 func applicationShouldTerminate(_ sender:NSApplication)->NSApplication.TerminateReply{
  // The update handoff already asked the host to save and exit; the centre must
  // terminate instead of being converted into a hide.
  if updateTerminating { logCenter("terminate","update-handoff"); return .terminateNow }
  if !hidden && hostPid != 0 && ProcessInfo.processInfo.environment["NARUTO_C_FIXTURE"] != "1" { logCenter("hide","app-terminate hostPid=\(hostPid)"); fadeAndHide(); return .terminateCancel }
  if hidden && hasUnfinishedEditsOrSaves { showWindow() }
  return confirmClose() ? .terminateNow:.terminateCancel
 }
 func applicationWillTerminate(_ n:Notification){logCenter("will-terminate","hidden=\(hidden) hostPid=\(hostPid)");timer?.invalidate();web?.configuration.userContentController.removeScriptMessageHandler(forName:"narutoCore");if lock>=0{_ = try? rpc(root,"center",token,"center.closed",["pid":getpid()]);close(lock)}}
}
@main struct LauncherMain{static func main(){let app=NSApplication.shared;app.setActivationPolicy(.regular);do{try configurePackagedCenter()}catch{let alert=NSAlert();alert.messageText=localized(msg("ui.naruto_os_could_not_start"));if case ProtoError.failure(let detail)=error{alert.informativeText=localized(detail)}else{alert.informativeText=localized(msg("ui.check_the_app_and_startup_data_then"))};alert.runModal();return};let delegate=Center();app.delegate=delegate;app.run()}}
