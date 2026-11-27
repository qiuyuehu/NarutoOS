import AppKit
import WebKit
import Network
import Darwin

// The portal records the launcher channel from this query string and keeps the
// value in a session cookie. Load it on the login entry page so the game entry
// the portal signs for this session uses the launcher channel.
private let brazilLoginEntry = "https://naruto.narutowebgame.com/pt/serverlist?leftbar_collapse=yes&logintype=2"
private let brazilLegacyLoginEntry = "https://naruto.narutowebgame.com/pt/serverlist"

// Native login helper shared with the isolated prototype. No Safari/Keychain access.
@MainActor
// Diagnostic logs must not persist ticket-bearing game URLs; keep origin and path.
func redactLogURL(_ raw: String?) -> String {
    guard let raw = raw, let target = URL(string: raw), let scheme = target.scheme, let host = target.host else { return "" }
    return "\(scheme)://\(host)\(target.path)"
}

final class WebLoginPrototype: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKHTTPCookieStoreObserver {
    var arguments = CommandLine.arguments
    weak var hostView: NSView?
    var eventSink: ((String) -> Void)?
    var disposed = false
    var embeddedMode = false
    var embedded: Bool { embeddedMode }
    var window: NSWindow!
    var webView: WKWebView!
    var mainStatus: Int?
    var completed = false
    var committed = false
    var fixture: URL?
    var handingOff = false
    var checkpointCookies = false
    var seeded = false
    var terminating = false
    var credentialRequests: [String: String] = [:]
    var credentialPage = 0
    var embeddedEditMenuItem: NSMenuItem?

    var bridge: Bool { arguments.contains("--bridge") }
    var sessionMode: Bool { arguments.contains("--session") }
    var interfaceStrings:[String:String]=[:]
    var caption: String { arguments.contains("--production") ? "Naruto OS · 巴西服登录" : "Naruto 登录原型" }

    func option(_ name: String) -> String? {
        guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
        return arguments[index + 1]
    }

    func emit(_ value: [String: Any]) {
        guard !disposed else { return }
        if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) {
            if let sink = eventSink { sink(String(data: data, encoding: .utf8)!) }
            else { FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10])) }
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let raw = option("--fixture-url") ?? brazilLoginEntry
        if arguments.contains("--production") && option("--fixture-url") != nil {
            emit(["type": "error", "code": "invalid-entry"]); terminateLogin(); return
        }
        guard let url = URL(string: raw) else {
            emit(["type": "error", "code": "invalid-entry"]); terminateLogin(); return
        }
        let validEntry = option("--fixture-url") != nil
            ? url.query == nil && url.scheme == "http" && url.host == "127.0.0.1" && url.port != nil
            : raw == brazilLoginEntry || (raw == brazilLegacyLoginEntry && url.query == nil)
        guard url.user == nil, url.password == nil, url.fragment == nil, validEntry else {
            emit(["type": "error", "code": "invalid-entry"])
            terminateLogin()
            return
        }
        if bridge && !embedded {
            var info = stat()
            guard fstat(STDOUT_FILENO, &info) == 0, [S_IFIFO, S_IFSOCK].contains(info.st_mode & S_IFMT) else {
                terminateLogin(); return
            }
        }
        if option("--fixture-url") != nil { fixture = url }
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        if #available(macOS 14.0, *), embedded {
            // Override this store's system proxy without changing macOS settings.
            // Only a reserved, unreachable test domain matches the proxy; all
            // actual website hosts use direct connections. Empty configs would
            // restore the system proxy instead.
            var direct = ProxyConfiguration(httpCONNECTProxy: .hostPort(host: "127.0.0.1", port: 9))
            direct.matchDomains = ["naruto-os-unused.invalid"]
            direct.allowFailover = false
            configuration.websiteDataStore.proxyConfigurations = [direct]
        }
        if fixture != nil { configuration.preferences.javaScriptCanOpenWindowsAutomatically = true }
        if bridge {
            if #available(macOS 11.0, *) {
                configuration.userContentController.add(self, contentWorld: .defaultClient, name: "narutoCredentials")
            }
            let credentials = LoginCredentialScript.source(strings: interfaceStrings)
            if #available(macOS 11.0, *) {
                configuration.userContentController.addUserScript(WKUserScript(source: credentials, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: .defaultClient))
            }
            // The portal checks for Flash before it creates the real game iframe.
            // Advertise the external Flash host only on a selected server wrapper;
            // the actual game navigation is intercepted below and never runs in WK.
            let allowedOrigin = fixture.map { "http://127.0.0.1:\($0.port!)" }
            let origins = allowedOrigin.map { [$0] } ?? ["https://naruto.narutowebgame.com", "https://naruto.oasgames.com"]
            let encoded = String(data: try! JSONSerialization.data(withJSONObject: origins), encoding: .utf8)!
            let script = """
            (()=>{
              if (!\(encoded).includes(location.origin) || !/^\\/pt\\/serverlist\\/s\\d{1,6}\\/?$/.test(location.pathname)) return;
              const plugin = {name:'Shockwave Flash',description:'Shockwave Flash 34.0 r0',filename:'PepperFlashPlayer.plugin',length:1};
              const mime = {type:'application/x-shockwave-flash',description:'Shockwave Flash',suffixes:'swf',enabledPlugin:plugin};
              plugin[0]=mime; plugin['application/x-shockwave-flash']=mime;
              const plugins=[plugin], mimes=[mime];
              plugins['Shockwave Flash']=plugin; mimes['application/x-shockwave-flash']=mime;
              for(const list of [plugins,mimes]) {list.item=i=>list[i]||null;list.namedItem=name=>list[name]||null;list.refresh=()=>{};}
              Object.defineProperty(navigator,'plugins',{configurable:true,get:()=>plugins});
              Object.defineProperty(navigator,'mimeTypes',{configurable:true,get:()=>mimes});
            })();
            """
            configuration.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1100, height: 760), configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        if let host = hostView {
            window = host.window
            webView.frame = NSRect(x: 0, y: host.isFlipped ? 42 : 0, width: host.bounds.width, height: max(0, host.bounds.height - 42))
            webView.autoresizingMask = [.width, .height]
            host.addSubview(webView, positioned: .above, relativeTo: nil)
            installEmbeddedEditMenu()
        } else {
        window = NSWindow(contentRect: webView.frame, styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = caption
        window.contentView = webView
        window.delegate = self
        window.center()
        let menu = NSMenu()
        let appMenu = NSMenu()
        appMenu.addItem(NSMenuItem(title: arguments.contains("--production") ? "关闭登录窗口" : "退出原型", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        let item = NSMenuItem()
        item.submenu = appMenu
        menu.addItem(item)
        let edit = NSMenu(title: "编辑")
        for (title, action, key) in [("剪切", "cut:", "x"), ("复制", "copy:", "c"), ("粘贴", "paste:", "v"), ("全选", "selectAll:", "a")] {
            edit.addItem(NSMenuItem(title: title, action: Selector(action), keyEquivalent: key))
        }
        let editItem = NSMenuItem(); editItem.submenu = edit; menu.addItem(editItem)
        let browser = NSMenu(title: "页面")
        let reload = NSMenuItem(title: "刷新", action: #selector(reloadPage), keyEquivalent: "r")
        reload.target = self; browser.addItem(reload)
        let browserItem = NSMenuItem(); browserItem.submenu = browser; menu.addItem(browserItem)
        NSApp.mainMenu = menu
        if arguments.contains("--visible") {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
        }
        if sessionMode && !embedded { startInput(entry: url) }
        else if !embedded { webView.load(URLRequest(url: url)) }
        DispatchQueue.main.asyncAfter(deadline: .now() + (bridge ? 900 : 30)) { [weak self] in
            guard let self = self else { return }
            if self.bridge { self.emit(["type": "error", "code": "timeout"]); self.terminateLogin() }
            else { self.finish(["ok": false, "code": "timeout"]) }
        }
    }

    func terminateLogin() {
        guard !disposed else { return }
        if !embedded { NSApp.terminate(nil); return }
        guard !terminating && !disposed else { return }
        terminating = true
        if handingOff { return }
        if seeded {
            webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
                guard let self = self, !self.disposed else { return }
                self.emit(["type": "cancelled", "cookies": self.records(cookies)])
            }
        } else { emit(["type": "cancelled"]) }
    }
    func cookiesDidChange(in cookieStore: WKHTTPCookieStore) {
        guard seeded && !terminating && !handingOff && !disposed else { return }
        cookieStore.getAllCookies { [weak self] cookies in
            guard let self, !self.disposed && !self.terminating && !self.handingOff else { return }
            self.emit(["type": "cookie-snapshot", "cookies": self.records(cookies)])
        }
    }
    // The embedded login shares the host application's menu bar. AppKit routes
    // Command-C/V/X/A through standard Edit menu items; without them macOS beeps.
    // Insert one while the login is on screen and remove it afterwards.
    func installEmbeddedEditMenu() {
        guard embedded, embeddedEditMenuItem == nil, let main = NSApp.mainMenu else { return }
        guard !main.items.contains(where: { $0.submenu?.items.contains(where: { $0.keyEquivalent == "c" && $0.keyEquivalentModifierMask.contains(.command) }) == true }) else { return }
        let edit = NSMenu(title: "编辑")
        for (title, action, key) in [("剪切", "cut:", "x"), ("复制", "copy:", "c"),
                                     ("粘贴", "paste:", "v"), ("全选", "selectAll:", "a")] {
            edit.addItem(NSMenuItem(title: title, action: Selector(action), keyEquivalent: key))
        }
        let item = NSMenuItem(); item.submenu = edit
        main.insertItem(item, at: min(1, main.items.count))
        embeddedEditMenuItem = item
    }

    func removeEmbeddedEditMenu() {
        if let item = embeddedEditMenuItem, let main = NSApp.mainMenu,
           let index = main.items.firstIndex(of: item) { main.removeItem(at: index) }
        embeddedEditMenuItem = nil
    }

    func disposeEmbedded() {
        removeEmbeddedEditMenu()
        if checkpointCookies { webView?.configuration.websiteDataStore.httpCookieStore.remove(self) }
        disposed = true; completed = true; eventSink = nil
        webView?.stopLoading(); webView?.navigationDelegate = nil; webView?.uiDelegate = nil
        webView?.removeFromSuperview(); webView = nil
    }

    @objc func reloadPage() { clearCredentialState(); webView.reload() }

    private func records(_ cookies: [HTTPCookie], target: String? = nil) -> [[String: Any]] {
        let result = WebLoginCookies.exportRecords(cookies, target: target, isFixture: fixture != nil)
        if result.partitionedExcluded > 0 {
            emit(["type": "cookie-scope", "partitionedExcluded": result.partitionedExcluded])
        }
        return result.records
    }

    func startInput(entry: URL) {
        var info = stat()
        guard bridge, fstat(STDIN_FILENO, &info) == 0, [S_IFIFO, S_IFSOCK].contains(info.st_mode & S_IFMT) else {
            emit(["type": "error", "code": "invalid-input"]); terminateLogin(); return
        }
        Thread.detachNewThread { [weak self] in
            var buffer = Data()
            while true {
                let data = FileHandle.standardInput.availableData
                if data.isEmpty { DispatchQueue.main.async { self?.terminateLogin() }; return }
                buffer.append(data)
                if buffer.count > 1048576 {
                    DispatchQueue.main.async { self?.emit(["type": "error", "code": "invalid-input"]); self?.terminateLogin() }; return
                }
                while let index = buffer.firstIndex(of: 10) {
                    let line = Data(buffer[..<index]); buffer.removeSubrange(...index)
                    DispatchQueue.main.async { self?.handleInput(line, entry: entry) }
                }
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
            guard let self = self, !self.seeded else { return }
            self.emit(["type": "error", "code": "seed-timeout"]); self.terminateLogin()
        }
    }

    func handleInput(_ data: Data, entry: URL) {
        guard let message = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let kind = message["type"] as? String else {
            emit(["type": "error", "code": "invalid-input"]); terminateLogin(); return
        }
        if kind == "close" { terminateLogin(); return }
        if kind == "focus" { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true); return }
        guard kind == "seed", !seeded, let list = message["cookies"] as? [[String: Any]],
              let cookies = WebLoginCookies.decodeSeed(list, isFixture: fixture != nil) else {
            emit(["type": "error", "code": "invalid-seed"]); terminateLogin(); return
        }
        let group = DispatchGroup()
        for cookie in cookies { group.enter(); webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) { group.leave() } }
        group.notify(queue: .main) { [weak self] in
            guard let self = self, !self.terminating else { return }
            self.seeded = true
            if self.checkpointCookies { self.webView.configuration.websiteDataStore.httpCookieStore.add(self) }
            self.webView.load(URLRequest(url: entry))
        }
    }

    func wrapperPage(_ url: URL?) -> Bool {
        guard let url = url, url.user == nil, url.password == nil,
              url.path.range(of: #"^/pt/serverlist/s\d{1,6}/?$"#, options: .regularExpression) != nil else { return false }
        if let fixture = fixture { return url.scheme == fixture.scheme && url.host == fixture.host && url.port == fixture.port }
        return url.scheme == "https" && url.port == nil && ["naruto.narutowebgame.com", "naruto.oasgames.com"].contains(url.host ?? "")
    }

    func credentialPage(_ url: URL?) -> Bool {
        guard let url = url, url.user == nil, url.password == nil,
              url.path.range(of: #"^/pt/serverlist(?:/s\d{1,6})?/?$"#, options: .regularExpression) != nil else { return false }
        if let fixture = fixture { return url.scheme == fixture.scheme && url.host == fixture.host && url.port == fixture.port }
        return url.scheme == "https" && url.port == nil && ["naruto.narutowebgame.com", "naruto.oasgames.com"].contains(url.host ?? "")
    }

    func sameOrigin(_ origin: WKSecurityOrigin, _ top: URL) -> Bool {
        let defaultPort = top.scheme == "https" ? 443 : 80
        return origin.host == top.host && origin.protocol == top.scheme &&
            (origin.port == 0 ? defaultPort : origin.port) == (top.port ?? defaultPort)
    }

    func gameEntry(_ url: URL) -> Bool {
        guard ["https", "http"].contains(url.scheme ?? ""), url.user == nil, url.password == nil else { return false }
        if let fixture = fixture {
            return url.scheme == fixture.scheme && url.host == fixture.host && url.port == fixture.port && url.path == "/game"
        }
        guard url.scheme == "https", url.port == nil, let host = url.host else { return false }
        return host.range(of: #"^(?:s\d+-naruto(?:pt|br)?|naruto-(?:pt|br)(?:-s?\d+)?)\.oasgames\.com$"#, options: .regularExpression) != nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        guard ["http", "https"].contains(url.scheme ?? "") else { decisionHandler(.cancel); return }
        if navigationAction.targetFrame?.isMainFrame != false && url.absoluteString != webView.url?.absoluteString { clearCredentialState() }
        if navigationAction.targetFrame?.isMainFrame != false {
            let official = ["naruto.narutowebgame.com", "naruto.oasgames.com", "passport.oasgames.com", "passport.narutowebgame.com"]
            let allowed: Bool
            if let fixture = fixture {
                allowed = url.scheme == fixture.scheme && url.host == fixture.host && url.port == fixture.port
            } else {
                allowed = url.scheme == "https" && url.user == nil && url.password == nil && url.port == nil &&
                    (official.contains(url.host ?? "") || gameEntry(url))
            }
            guard allowed else { decisionHandler(.cancel); return }
        }
        if bridge && gameEntry(url) {
            decisionHandler(.cancel)
            guard let top = webView.url else { return }
            let origin = navigationAction.sourceFrame.securityOrigin
            let directMain = navigationAction.targetFrame?.isMainFrame == true && navigationAction.sourceFrame.isMainFrame
            guard sameOrigin(origin, top) && (directMain || wrapperPage(top)) else {
                emit(["type": "blocked", "code": "game-source"]); return
            }
            guard !handingOff, (navigationAction.request.httpMethod ?? "GET") == "GET" else { return }
            handingOff = true
            webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
                guard let self = self, !self.disposed else { return }
                // Private parent pipe only. Never print this event to a terminal or report.
                var event: [String: Any] = ["type": "handoff", "url": url.absoluteString, "cookies": self.records(cookies, target: url.host)]
                if self.sessionMode { event["sessionCookies"] = self.records(cookies) }
                self.emit(event)
            }
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if navigationResponse.isForMainFrame, let response = navigationResponse.response as? HTTPURLResponse {
            mainStatus = response.statusCode
        }
        decisionHandler(.allow)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard bridge, embedded, !disposed, message.name == "narutoCredentials", message.frameInfo.isMainFrame,
              let top = webView.url, credentialPage(top), sameOrigin(message.frameInfo.securityOrigin, top),
              let body = message.body as? [String: Any], let type = body["type"] as? String,
              let requestId = body["requestId"] as? String,
              requestId.range(of: #"^p\d{1,12}$"#, options: .regularExpression) != nil else { return }
        let origin = "\(top.scheme ?? "")://\(top.host ?? "")" + (top.port.map { ":\($0)" } ?? "")
        if type == "query", let query = body["query"] as? String, query.count <= 320 {
            credentialPage += 1
            credentialRequests = [requestId: top.absoluteString]
            emit(["type": "credential-query", "requestId": requestId, "origin": origin, "query": query, "page": credentialPage])
        } else if type == "select", let id = body["id"] as? String,
                  id.range(of: #"^[a-f0-9]{32}$"#, options: .regularExpression) != nil,
                  credentialRequests[requestId] == top.absoluteString {
            emit(["type": "credential-select", "requestId": requestId, "origin": origin, "id": id, "page": credentialPage])
        }
    }

    func credentialResponse(_ json: String) {
        if let data=json.data(using:.utf8),let object=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any],object["type"] as? String=="language",let strings=object["strings"] as? [String:String] {
            interfaceStrings=strings
            if let payload=try? JSONSerialization.data(withJSONObject:strings),let literal=String(data:payload,encoding:.utf8),#available(macOS 11.0, *) {
                webView?.evaluateJavaScript("window.__narutoSetLanguage?.(\(literal))",in:nil,in:.defaultClient,completionHandler:nil)
            }
            return
        }
        guard !disposed, let webView = webView, let data = json.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data),
              let payload = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
              let literal = String(data: payload, encoding: .utf8),
              let requestId = (value as? [String: Any])?["requestId"] as? String,
              credentialRequests[requestId] == webView.url?.absoluteString else { return }
        let method = (value as? [String: Any])?["type"] as? String == "fill" ? "__narutoCredentialFill" : "__narutoCredentialResponse"
        if method == "__narutoCredentialFill" { credentialRequests.removeValue(forKey: requestId) }
        if #available(macOS 11.0, *) {
            webView.evaluateJavaScript("window.\(method)&&window.\(method)(\(literal))", in: nil, in: .defaultClient, completionHandler: nil)
        }
    }

    func clearCredentialState() {
        credentialRequests.removeAll(); credentialPage += 1
        if #available(macOS 11.0, *) {
            webView?.evaluateJavaScript("window.__narutoClearCredentialState&&window.__narutoClearCredentialState()", in: nil, in: .defaultClient, completionHandler: nil)
        }
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        credentialRequests.removeAll(); credentialPage += 1
        if !embedded { window.title = caption + " · " + (webView.url?.host ?? "隔离会话") }
        if !committed {
            committed = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.inspect() }
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        let root=ProcessInfo.processInfo.environment["NARUTO_C_ROOT"] ?? ""
        if !root.isEmpty {
            let line="{\"time\":\"\(ISO8601DateFormatter().string(from: Date()))\",\"kind\":\"wkcontent-terminated\",\"url\":\"\(redactLogURL(webView.url?.absoluteString))\"}\n"
            let file=root+"/host/events.log"
            if let data=line.data(using:.utf8) {
                if let handle=FileHandle(forWritingAtPath:file) { handle.seekToEndOfFile(); handle.write(data); try? handle.close() }
                else { try? data.write(to:URL(fileURLWithPath:file)) }
            }
        }
        if embedded {
            // A terminated login page leaves a blank white overlay; reload it.
            DispatchQueue.main.asyncAfter(deadline:.now()+0.3) { [weak self] in guard let self=self,!self.disposed else{return};self.webView?.reload() }
        }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let payload=try? JSONSerialization.data(withJSONObject:interfaceStrings),let literal=String(data:payload,encoding:.utf8),#available(macOS 11.0, *) {
            webView.evaluateJavaScript("window.__narutoSetLanguage?.(\(literal))",in:nil,in:.defaultClient,completionHandler:nil)
        }
        inspect()
    }

    func inspect() {
        guard !completed && !disposed else { return }
        // Only public document metadata; no forms, credentials or Cookie values.
        let script = "({title:document.title,loginForm:!!document.querySelector('.login_btn'),blocked:document.title.includes('Cloudflare')})"
        webView.evaluateJavaScript(script) { [weak self] value, error in
            guard let self = self, !self.completed else { return }
            guard var metadata = value as? [String: Any] else { return }
            let ready = metadata["loginForm"] as? Bool == true || metadata["blocked"] as? Bool == true
            let httpError = (self.mainStatus ?? 0) >= 400
            guard ready || httpError else { return }
            metadata["status"] = self.mainStatus ?? 0
            metadata["ok"] = self.mainStatus == 200 && metadata["loginForm"] as? Bool == true
            self.finish(metadata)
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let code = (error as NSError).code
        if code != NSURLErrorCancelled { finish(["ok": false, "code": "navigation-failed", "errorCode": code]) }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if bridge, let url = navigationAction.request.url, gameEntry(url) {
            guard let top = webView.url, wrapperPage(top), sameOrigin(navigationAction.sourceFrame.securityOrigin, top) else {
                emit(["type": "blocked", "code": "game-source"]); return nil
            }
        }
        if navigationAction.targetFrame == nil, let scheme = navigationAction.request.url?.scheme,
           ["https", "http"].contains(scheme) { webView.load(navigationAction.request) }
        return nil
    }

    func finish(_ result: [String: Any]) {
        guard !completed && !disposed else { return }
        completed = true
        emit(["type": "result", "result": result])
        if arguments.contains("--auto-exit") && !bridge { terminateLogin() }
    }

    func windowWillClose(_ notification: Notification) {
        if bridge && !sessionMode && !handingOff { emit(["type": "cancelled"]) }
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if sessionMode && seeded && !handingOff { terminateLogin(); return false }
        return true
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard sessionMode && seeded && !handingOff else { return .terminateNow }
        guard !terminating else { return .terminateLater }
        terminating = true
        webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
            guard let self = self else { return }
            self.emit(["type": "cancelled", "cookies": self.records(cookies)])
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

#if !NARUTO_EMBEDDED
@main
struct PrototypeMain {
    @MainActor static func main() {
        let application = NSApplication.shared
        application.setActivationPolicy(.regular)
        let delegate = WebLoginPrototype()
        application.delegate = delegate
        withExtendedLifetime(delegate) { application.run() }
    }
}

#endif

#if NARUTO_EMBEDDED
private var embeddedLogins: [UInt: WebLoginPrototype] = [:]
private var selectedLogin: UInt = 0
@_cdecl("naruto_login_select") @MainActor public func loginSelect(_ id: UInt) { selectedLogin = id }
private var embeddedLogin: WebLoginPrototype? {
    get { embeddedLogins[selectedLogin] }
    set { embeddedLogins[selectedLogin] = newValue }
}
public typealias LoginSink = @convention(c) (UnsafePointer<CChar>?, UnsafeMutableRawPointer?) -> Void
@_cdecl("naruto_login_open")
@MainActor public func loginOpen(_ host: UnsafeMutableRawPointer, _ options: UnsafePointer<CChar>, _ sink: LoginSink, _ context: UnsafeMutableRawPointer?) -> Bool {
    guard embeddedLogin == nil,
        let data = String(cString: options).data(using: .utf8),
        let config = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
    let login = WebLoginPrototype()
    login.interfaceStrings = config["strings"] as? [String:String] ?? [:]
    login.embeddedMode = true
    login.checkpointCookies = config["checkpointCookies"] as? Bool == true
    login.arguments = ["WebLogin", "--bridge", "--session"]
    if let fixture = config["fixture"] as? String { login.arguments += ["--fixture-url", fixture] }
    else { login.arguments.append("--production") }
    login.hostView = Unmanaged<NSView>.fromOpaque(host).takeUnretainedValue()
    login.eventSink = { value in value.withCString { sink($0, context) } }
    embeddedLogin = login
    login.applicationDidFinishLaunching(Notification(name: NSApplication.didFinishLaunchingNotification))
    login.handleInput((try? JSONSerialization.data(withJSONObject: ["type": "seed", "cookies": config["cookies"] ?? []])) ?? Data(), entry: login.fixture ?? URL(string: brazilLoginEntry)!)
    return true
}
@_cdecl("naruto_login_close") @MainActor public func loginClose() { embeddedLogin?.terminateLogin() }
@_cdecl("naruto_login_dispose") @MainActor public func loginDispose() { embeddedLogin?.disposeEmbedded(); embeddedLogin = nil }
@_cdecl("naruto_login_focus") @MainActor public func loginFocus() {
    guard let login = embeddedLogin else { return }
    login.webView?.isHidden = false; login.window?.makeFirstResponder(login.webView)
}
@_cdecl("naruto_login_hide") @MainActor public func loginHide(_ hidden: Bool) { guard let page=embeddedLogin, page.webView?.isHidden != hidden else { return }; if hidden { page.clearCredentialState() }; page.webView?.isHidden = hidden }
@_cdecl("naruto_login_reload") @MainActor public func loginReload() { embeddedLogin?.clearCredentialState(); embeddedLogin?.webView?.reload() }
@_cdecl("naruto_login_credentials") @MainActor public func loginCredentials(_ json: UnsafePointer<CChar>) { embeddedLogin?.credentialResponse(String(cString: json)) }
@_cdecl("naruto_login_attached") @MainActor public func loginAttached() -> Bool { embeddedLogin?.webView?.superview != nil }
@_cdecl("naruto_login_visible") @MainActor public func loginVisible() -> Bool { embeddedLogin?.webView?.superview != nil && embeddedLogin?.webView?.isHidden == false }
#endif
