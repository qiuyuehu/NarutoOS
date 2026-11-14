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
 var window:NSWindow!;var web:WKWebView!;var page:URL!
 var revision=0;var ownBatch:String?;var timer:Timer?;var refreshing=false;var autoSubmitted=false
 var dirty=false;var managementOpen=false;var pendingWrites=0;var failures=0
 var source:DispatchSourceSignal?;var lock:Int32 = -1
 let work=DispatchQueue(label:"Naruto.Center.Business")
 func applicationDidFinishLaunching(_ notification:Notification){
  do{lock=try roleLock(root,"center")}catch{_ = try? rpc(root,"center",token,"center.ensure");NSApp.terminate(nil);return}
  signal(SIGUSR1,SIG_IGN);source=DispatchSource.makeSignalSource(signal:SIGUSR1,queue:.main);source?.setEventHandler{[weak self] in self?.window.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true)};source?.resume()
  let screen=NSScreen.main?.visibleFrame ?? NSRect(x:0,y:0,width:1000,height:732)
  let smallCheck=ProcessInfo.processInfo.environment["NARUTO_C_FIXTURE"]=="1" && ProcessInfo.processInfo.environment["NARUTO_C_UI_CHECKS"]=="launcher" && ProcessInfo.processInfo.environment["NARUTO_C_LAUNCHER_SMALL"]=="1"
  window=NSWindow(contentRect:NSRect(x:0,y:0,width:min(smallCheck ? 700 : 1000,screen.width),height:min(smallCheck ? 490 : 700,max(300,screen.height-32))),styleMask:[.titled,.closable,.miniaturizable,.fullSizeContentView],backing:.buffered,defer:false)
  if Bundle.main.bundleIdentifier=="cn.youye.naruto-os" {
   let menu=NSMenu(),item=NSMenuItem(),submenu=NSMenu(title:"Naruto OS");menu.addItem(item);item.submenu=submenu
   let about=NSMenuItem(title:"关于 Naruto OS",action:#selector(NSApplication.orderFrontStandardAboutPanel(_:)),keyEquivalent:"");about.target=NSApp;submenu.addItem(about)
   let settings=NSMenuItem(title:"设置…",action:#selector(openSettings),keyEquivalent:",");settings.target=self;submenu.addItem(settings)
   let close=NSMenuItem(title:"关闭启动中心",action:#selector(NSWindow.performClose(_:)),keyEquivalent:"w");close.target=window;submenu.addItem(close)
   submenu.addItem(.separator());let quit=NSMenuItem(title:"退出启动中心",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q");quit.target=NSApp;submenu.addItem(quit)
   let edit=NSMenu(title:"编辑")
   for (title,action,key) in [("剪切","cut:","x"),("复制","copy:","c"),("粘贴","paste:","v"),("全选","selectAll:","a")] { edit.addItem(NSMenuItem(title:title,action:Selector(action),keyEquivalent:key)) }
   let editItem=NSMenuItem();editItem.submenu=edit;menu.addItem(editItem);NSApp.mainMenu=menu
  }
  window.title="Naruto OS";window.titleVisibility = .hidden;window.titlebarAppearsTransparent=true;window.isMovableByWindowBackground=false;window.center();window.delegate=self;window.collectionBehavior=[.fullScreenNone]
  let config=WKWebViewConfiguration();config.websiteDataStore = .nonPersistent();config.userContentController.add(self,name:"narutoCore")
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
 }
 @objc func fitWindow(){
  guard let window=window,let screen=window.screen ?? NSScreen.main else{return}
  let area=screen.visibleFrame;let title=window.frame.height-(window.contentView?.frame.height ?? 0)
  window.setContentSize(NSSize(width:min(1000,area.width),height:min(700,max(200,area.height-title))))
  var frame=window.frame;frame.origin.x=min(max(frame.minX,area.minX),max(area.minX,area.maxX-frame.width));frame.origin.y=min(max(frame.minY,area.minY),max(area.minY,area.maxY-frame.height));window.setFrame(frame,display:true)
 }
 func windowDidChangeScreen(_ notification:Notification){fitWindow();alignTrafficLights()}
 func windowDidResize(_ notification:Notification){alignTrafficLights()}
 func windowDidMove(_ notification:Notification){
  try? atomic(["x":window.frame.minX,"y":window.frame.minY],root+"/center-window.json")
 }
 func windowDidBecomeKey(_ notification:Notification){alignTrafficLights()}
 func windowDidUpdate(_ notification:Notification){alignTrafficLights()}
 func alignTrafficLights(){
  guard let window=window,let content=window.contentView else{return}
  for (index,type) in [NSWindow.ButtonType.closeButton,.miniaturizeButton,.zoomButton].enumerated(){
   guard let button=window.standardWindowButton(type),let parent=button.superview else{continue}
   let size=button.frame.size;let y=content.isFlipped ? CGFloat(21) : content.bounds.height-21
   let frame=parent.convert(NSRect(x:21+CGFloat(index)*22-size.width/2,y:y-size.height/2,width:size.width,height:size.height),from:content)
   if abs(button.frame.minX-frame.minX)>0.1 || abs(button.frame.minY-frame.minY)>0.1{button.setFrameOrigin(frame.origin)}
  }
 }
 func trafficLightCenters()->[CGFloat]{
  guard let content=window.contentView else{return []}
  return [NSWindow.ButtonType.closeButton,.miniaturizeButton,.zoomButton].compactMap{type in
   guard let button=window.standardWindowButton(type),let parent=button.superview else{return nil}
   let frame=content.convert(button.frame,from:parent)
   return content.isFlipped ? frame.midY : content.bounds.height-frame.midY
  }
 }
 func userContentController(_ controller:WKUserContentController,didReceive message:WKScriptMessage){
  guard message.frameInfo.isMainFrame,message.frameInfo.request.url?.standardizedFileURL==page,let body=message.body as? [String:Any],let command=body["command"] as? String else{return}
  let payload=body["payload"] as? [String:Any] ?? [:]
  if command=="ui.state"{dirty=payload["dirty"] as? Bool ?? false;managementOpen=payload["settingsOpen"] as? Bool ?? false;return}
  let allowed=["snapshot","preferences.patch","catalog.create","catalog.update","catalog.select","catalog.delete","batch.start","batch.get","credentials.metadata","credentials.reveal","credentials.addManual","credentials.edit","credentials.remove"]
  guard allowed.contains(command),let id=body["id"] as? String,UUID(uuidString:id) != nil else{return}
  if command=="batch.start"{ownBatch=payload["requestId"] as? String}
  pendingWrites+=1
  work.async {
   var reply:[String:Any]
   do{let result=try rpc(self.root,"center",self.token,command,payload);reply=["ok":true,"value":result]}catch{let message:String;if case ProtoError.failure(let detail)=error{message=detail}else{message="操作未完成，请刷新后重试"};reply=["ok":false,"message":message]}
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
   let state=try? rpc(self.root,"center",self.token,"center.open",payload)
   DispatchQueue.main.async{
    self.refreshing=false
    guard let state=state else{
     self.failures+=1
     if self.failures==3 || self.failures%20==0 {let process=Process();process.executableURL=URL(fileURLWithPath:self.project+"/dist/prototype/native/core");process.environment=ProcessInfo.processInfo.environment;process.standardInput=FileHandle.nullDevice;process.standardOutput=FileHandle.nullDevice;process.standardError=FileHandle.nullDevice;try? process.run()}
     return
    }
    self.failures=0;self.paint(state)
   }
  }
 }
 func paint(_ state:[String:Any]){
  revision=state["revision"] as? Int ?? 0
  if let text=String(data:(try? json(state)) ?? Data(),encoding:.utf8){web.evaluateJavaScript("window.__narutoSnapshot?.(\(text))",completionHandler:nil)}
  let batches=state["batches"] as? [[String:Any]] ?? []
  var rows=[String:String]()
  for profile in state["profiles"] as? [[String:Any]] ?? [] {let id=profile["id"] as! String;let status=profile["runtimeStatus"] as? String ?? "未启动";rows[id]="\(profile["name"] as! String) · \(id) · \(status)"}
  try? atomic(["pid":getpid(),"hostPID":state["hostPID"] ?? 0,"rows":rows,"width":window.frame.width,"height":window.frame.height,"engine":"WKWebView","settingsOpen":managementOpen,"dragAreaInstalled":window.contentView?.subviews.contains(where:{$0 is CenterDragArea}) == true,"trafficLightCenters":trafficLightCenters(),"integratedTitlebar":window.styleMask.contains(.fullSizeContentView) && window.titleVisibility == .hidden],root+"/center-view.json")
  if let id=ownBatch,let batch=batches.first(where:{$0["id"] as? String==id}){
   let all=batch["items"] as! [[String:Any]]
   let accepted=all.allSatisfy{$0["accepted"] as? Bool==true}
   let active=all.contains{!["cancelled","closed","interrupted"].contains($0["status"] as? String ?? "")}
   if !all.isEmpty && accepted && active && batch["autoClose"] as? Bool==true {
    if !dirty && !managementOpen && pendingWrites==0 {NSApp.terminate(nil)}
   }else if all.allSatisfy({$0["accepted"] as? Bool==true || $0["status"] as? String=="rejected"}){ownBatch=nil}
  }
  if !autoSubmitted,let auto=ProcessInfo.processInfo.environment["NARUTO_C_AUTO_PROFILES"],!auto.isEmpty{
   autoSubmitted=true;let id=UUID().uuidString;ownBatch=id
   work.async{_ = try? rpc(self.root,"center",self.token,"batch.start",["requestId":id,"profileIds":auto.split(separator:",").map(String.init)])}
  }
 }
 func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!){
  let checkMode=ProcessInfo.processInfo.environment["NARUTO_C_UI_CHECKS"] ?? ""
  guard ["1","launcher","login-tabs"].contains(checkMode),ProcessInfo.processInfo.environment["NARUTO_C_AUTO_PROFILES"]==nil else{return}
  let checkFile=checkMode=="login-tabs" ? "login-tabs-check.js" : checkMode=="launcher" ? "launcher-check.js" : "center-check.js"
  if let script=try? String(contentsOfFile:project+"/tests/fixtures/native-core/"+checkFile,encoding:.utf8){webView.evaluateJavaScript(script,completionHandler:nil)}
  var checks=0
  Timer.scheduledTimer(withTimeInterval:0.5,repeats:true){timer in
   checks+=1;if checks>35{timer.invalidate();return}
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
 func windowShouldClose(_ sender:NSWindow)->Bool{
  if dirty || pendingWrites>0 {let alert=NSAlert();alert.messageText="还有未完成的编辑或保存，确定关闭启动中心？";alert.addButton(withTitle:"继续编辑");alert.addButton(withTitle:"关闭");return alert.runModal() == .alertSecondButtonReturn};return true
 }
 @objc func openSettings(){window.makeKeyAndOrderFront(nil);web.evaluateJavaScript("if(document.getElementById('settings-panel').hidden)window.naruto.command({type:'settings'})",completionHandler:nil)}
 func applicationShouldHandleReopen(_ sender:NSApplication,hasVisibleWindows flag:Bool)->Bool{window.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true);return true}
 func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool{true}
 func applicationShouldTerminate(_ sender:NSApplication)->NSApplication.TerminateReply{
  if dirty || pendingWrites>0 {return windowShouldClose(window) ? .terminateNow:.terminateCancel};return .terminateNow
 }
 func applicationWillTerminate(_ n:Notification){timer?.invalidate();web?.configuration.userContentController.removeScriptMessageHandler(forName:"narutoCore");if lock>=0{_ = try? rpc(root,"center",token,"center.closed",["pid":getpid()]);close(lock)}}
}
@main struct LauncherMain{static func main(){let app=NSApplication.shared;app.setActivationPolicy(.regular);do{try configurePackagedCenter()}catch{let alert=NSAlert();alert.messageText="Naruto OS 未能启动";if case ProtoError.failure(let detail)=error{alert.informativeText=detail}else{alert.informativeText="请检查应用和启动资料后重试"};alert.runModal();return};let delegate=Center();app.delegate=delegate;app.run()}}
