import AppKit
import WebKit
import Network
import Darwin

// Native login helper shared with the isolated prototype. No Safari/Keychain access.
@MainActor
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

    var bridge: Bool { arguments.contains("--bridge") }
    var sessionMode: Bool { arguments.contains("--session") }
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
        let raw = option("--fixture-url") ?? "https://naruto.narutowebgame.com/pt/serverlist"
        if arguments.contains("--production") && option("--fixture-url") != nil {
            emit(["type": "error", "code": "invalid-entry"]); terminateLogin(); return
        }
        guard let url = URL(string: raw), url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil,
              (option("--fixture-url") != nil
                ? url.scheme == "http" && url.host == "127.0.0.1" && url.port != nil
                : raw == "https://naruto.narutowebgame.com/pt/serverlist") else {
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
            let credentials = #"""
            (()=>{
              const allowed=location.protocol==='https:'&&['naruto.narutowebgame.com','naruto.oasgames.com'].includes(location.hostname)&&/^\/pt\/serverlist(?:\/s\d{1,6})?\/?$/.test(location.pathname);
              const fixture=location.protocol==='http:'&&location.hostname==='127.0.0.1'&&/^\/pt\/serverlist(?:\/s\d{1,6})?\/?$/.test(location.pathname);
              if((!allowed&&!fixture)||window.top!==window)return;
              let request=0,currentPair=null,passwordField=null,filledPassword='',timer;
              const root=document.createElement('div');root.style.cssText='all:initial;position:fixed;z-index:2147483647;display:none;';const shadow=root.attachShadow({mode:'closed'});
              const style=document.createElement('style');style.textContent=`
                :host{all:initial;color-scheme:light dark;font:13px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#403832}
                *{box-sizing:border-box}
                button{font:inherit;cursor:pointer}
                .trigger{height:32px;display:inline-flex;align-items:center;gap:8px;padding:0 11px;border:1px solid #ddc9a3;border-radius:9px;background:#fffaf0;color:#654b32;box-shadow:0 2px 7px #4d31151c;transition:background-color 150ms,border-color 150ms,box-shadow 150ms}
                .trigger:hover{background:#fff2d9;border-color:#c88945;box-shadow:0 3px 10px #4d311525}
                .trigger:focus-visible,.item:focus-visible{outline:2px solid #a94c36;outline-offset:2px}
                .trigger-icon{width:16px;height:16px;color:#a64d36;flex:none}
                .trigger-label{font-weight:600;letter-spacing:.01em;white-space:nowrap}
                .chevron{width:12px;height:12px;color:#9b7852;transition:transform 150ms}
                .trigger[aria-expanded=true] .chevron{transform:rotate(180deg)}
                .box{width:264px;margin-top:7px;padding:7px;border:1px solid #e4d5bc;border-radius:12px;background:#fffaf1;color:#403832;box-shadow:0 10px 28px #3927162b,0 1px 3px #39271612;overflow:hidden}
                .box[hidden]{display:none}
                .heading{display:flex;align-items:center;justify-content:space-between;padding:7px 8px 9px}
                .eyebrow{font-size:10px;font-weight:700;letter-spacing:.11em;color:#9b563b}
                .scope{font-size:10px;color:#897b68}
                .body{max-height:212px;overflow:auto}
                .item{width:100%;min-height:44px;display:flex;align-items:center;gap:10px;padding:6px 8px;border:0;border-radius:8px;background:transparent;color:inherit;text-align:left;transition:background-color 140ms}
                .item:hover,.item:focus-visible{background:#f7eddc}
                .avatar{width:29px;height:29px;display:grid;place-items:center;flex:none;border:1px solid #ead8b9;border-radius:8px;background:#f5e8d2;color:#9a4c35;font-size:12px;font-weight:700}
                .identity{min-width:0;display:block;flex:1}
                .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:600;color:#403832}
                .arrow{width:14px;height:14px;flex:none;color:#ad8050}
                .note{padding:12px 9px 13px;color:#746858;font-size:11px;line-height:1.5}
                @media(prefers-color-scheme:dark){
                  :host{color:#eee5d8}
                  .trigger{border-color:#5b4a38;background:#302b25;color:#eadcc5;box-shadow:0 2px 8px #0004}
                  .trigger:hover{background:#3a3027;border-color:#a87042}
                  .trigger-icon{color:#df9c72}.chevron{color:#c1a17b}
                  .box{border-color:#514538;background:#292621;color:#eee5d8;box-shadow:0 12px 30px #0008}
                  .eyebrow{color:#dfa07e}.scope,.note{color:#b8aa96}
                  .item:hover,.item:focus-visible{background:#393229}
                  .avatar{border-color:#594737;background:#3a3027;color:#e3a17e}
                  .name{color:#eee5d8}.arrow{color:#d1a06d}
                }
                @media(prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important}}
              `;
              const button=document.createElement('button');button.type='button';button.className='trigger';button.setAttribute('aria-label','已保存账号');button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');button.innerHTML='<svg class="trigger-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="7" cy="8" r="3.2" stroke="currentColor" stroke-width="1.6"/><path d="m9.4 10.4 6.1 6.1m-2.2-2.2 1.8-1.8m-3.4.2 1.8-1.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg><span class="trigger-label">已保存账号</span><svg class="chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
              const box=document.createElement('div');box.className='box';box.hidden=true;box.setAttribute('role','group');box.setAttribute('aria-label','当前网站的已保存账号');
              const heading=document.createElement('div');heading.className='heading';heading.innerHTML='<span class="eyebrow">NARUTO OS</span><span class="scope">当前网站</span>';
              const body=document.createElement('div');body.className='body';body.setAttribute('role','listbox');body.setAttribute('aria-label','已保存的账号');box.append(heading,body);shadow.append(style,button,box);document.documentElement.append(root);
              function visible(input){const r=input.getBoundingClientRect(),s=getComputedStyle(input);return r.width>=36&&r.height>=18&&s.display!=='none'&&s.visibility==='visible'&&Number(s.opacity)>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;}
              function pairFor(target){const pass=Array.from(document.querySelectorAll('input[type=password]')).find(x=>visible(x)&&!x.disabled&&!x.readOnly&&x.autocomplete!=='new-password');if(!pass)return null;const scope=pass.form||pass.closest('.login,.login_box,.loginbox,[role=dialog]')||document;const fields=Array.from(scope.querySelectorAll('input')).filter(x=>x!==pass&&visible(x)&&!x.disabled&&!x.readOnly&&['text','email','tel',''].includes(x.type));const user=fields.find(x=>/username|email|account|login|user|conta/i.test(x.name+' '+x.id+' '+x.autocomplete))||fields[0];return user&&(!target||target===user||target===pass)?{user,pass}:null;}
              function hide(){request++;if(body.childElementCount)body.replaceChildren();if(!box.hidden)box.hidden=true;if(button.getAttribute('aria-expanded')!=='false')button.setAttribute('aria-expanded','false');}
              function place(){const pair=pairFor();if(!pair){currentPair=null;hide();root.style.display='none';return;}currentPair=pair;root.style.display='block';const r=pair.user.getBoundingClientRect(),end=pair.pass.getBoundingClientRect();root.style.left=Math.max(12,Math.min(r.left,innerWidth-280))+'px';root.style.top=Math.max(12,Math.min(end.bottom+5,innerHeight-280))+'px';}
              function query(){const pair=pairFor();if(!pair){place();return;}currentPair=pair;place();const id='p'+(++request);box.hidden=false;button.setAttribute('aria-expanded','true');body.replaceChildren(Object.assign(document.createElement('div'),{className:'note',textContent:'正在读取钥匙串…'}));window.webkit.messageHandlers.narutoCredentials.postMessage({type:'query',requestId:id,query:pair.user.value});}
              window.__narutoCredentialResponse=data=>{if(!data||data.requestId!=='p'+request)return;body.replaceChildren();if(data.error){body.append(Object.assign(document.createElement('div'),{className:'note',textContent:data.error}));return;}if(!data.accounts.length){body.append(Object.assign(document.createElement('div'),{className:'note',textContent:data.query?'没有匹配的账号':'这个网站还没有保存账号'}));return;}for(const item of data.accounts){const row=document.createElement('button');row.type='button';row.className='item';row.setAttribute('role','option');const avatar=document.createElement('span');avatar.className='avatar';avatar.textContent=(item.username.trim()[0]||'·').toLocaleUpperCase();const identity=document.createElement('span');identity.className='identity';const name=document.createElement('span');name.className='name';name.textContent=item.username;identity.append(name);const arrow=document.createElementNS('http://www.w3.org/2000/svg','svg');arrow.setAttribute('viewBox','0 0 16 16');arrow.setAttribute('fill','none');arrow.setAttribute('aria-hidden','true');arrow.classList.add('arrow');arrow.innerHTML='<path d="M3.5 8h9m-3.5-3.5L12.5 8 9 11.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>';row.append(avatar,identity,arrow);row.addEventListener('click',()=>{if(currentPair&&currentPair.user.isConnected&&currentPair.pass.isConnected)window.webkit.messageHandlers.narutoCredentials.postMessage({type:'select',requestId:data.requestId,id:item.id});});body.append(row);}};
              function canTrigger(pair){return /^[A-Za-z0-9]/.test(pair.user.value.trim());}button.addEventListener('click',e=>{if(e.isTrusted)query();});document.addEventListener('focusin',e=>{if(!e.isTrusted)return;const pair=pairFor(e.target);if(!pair)return;currentPair=pair;place();if(e.target===pair.pass)hide();},true);document.addEventListener('input',e=>{if(!e.isTrusted||!currentPair)return;if(e.target===currentPair.pass){hide();return;}if(e.target===currentPair.user){clearTimeout(timer);if(canTrigger(currentPair))timer=setTimeout(query,120);else hide();}},true);document.addEventListener('click',e=>{if(e.isTrusted&&!root.contains(e.target)&&!shadow.contains(e.target))hide();},true);
              place();new MutationObserver(records=>{if(records.some(record=>!root.contains(record.target)))place();}).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','hidden']});window.addEventListener('resize',place,true);window.addEventListener('scroll',place,true);
              window.__narutoClearCredentialState=()=>{hide();if(passwordField&&passwordField.isConnected&&passwordField.value===filledPassword){passwordField.value='';passwordField.dispatchEvent(new Event('input',{bubbles:true}));}passwordField=null;filledPassword='';};
              window.__narutoCredentialFill=data=>{if(!data||data.requestId!=='p'+request||!currentPair||!currentPair.user.isConnected||!currentPair.pass.isConnected)return;if(data.error){box.hidden=false;box.replaceChildren(Object.assign(document.createElement('div'),{className:'note',textContent:data.error}));return;}const set=(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));};set(currentPair.user,data.username);set(currentPair.pass,data.password);passwordField=currentPair.pass;filledPassword=data.password;hide();};
            })();
            """#
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
    func disposeEmbedded() {
        if checkpointCookies { webView?.configuration.websiteDataStore.httpCookieStore.remove(self) }
        disposed = true; completed = true; eventSink = nil
        webView?.stopLoading(); webView?.navigationDelegate = nil; webView?.uiDelegate = nil
        webView?.removeFromSuperview(); webView = nil
    }

    @objc func reloadPage() { clearCredentialState(); webView.reload() }

    func allowedCookieHost(_ domain: String, target: String? = nil) -> Bool {
        let host = domain.hasPrefix(".") ? String(domain.dropFirst()) : domain
        if fixture != nil { return host == "127.0.0.1" }
        let auth = ["oasgames.com", "narutowebgame.com", "naruto.narutowebgame.com", "naruto.oasgames.com", "passport.oasgames.com", "passport.narutowebgame.com"]
        if auth.contains(host) { return true }
        if let target = target { return host == target }
        return host.range(of: #"^(?:s\d+-naruto(?:pt|br)?|naruto-(?:pt|br)(?:-s?\d+)?)\.oasgames\.com$"#, options: .regularExpression) != nil
    }

    func records(_ cookies: [HTTPCookie], target: String? = nil) -> [[String: Any]] {
        let allowed = cookies.filter { allowedCookieHost($0.domain, target: target) }
        // Modern WebKit includes CHIPS cookies in getAllCookies. Electron 11
        // has no partition key: flattening them would collide with ordinary
        // cookies and widen their scope. Keep them in WK only.
        let transferable = allowed.filter {
            (($0.properties?[HTTPCookiePropertyKey("StoragePartition")] as? String) ?? "").isEmpty
        }
        if transferable.count != allowed.count {
            emit(["type": "cookie-scope", "partitionedExcluded": allowed.count - transferable.count])
        }
        return transferable.map { cookie in
            let temporary = cookie.isSessionOnly || cookie.expiresDate == nil
            var value: [String: Any] = ["name": cookie.name, "value": cookie.value, "domain": cookie.domain,
                "path": cookie.path, "secure": cookie.isSecure, "httpOnly": cookie.isHTTPOnly,
                "hostOnly": !cookie.domain.hasPrefix("."), "session": temporary]
            if !temporary, let expiry = cookie.expiresDate { value["expirationDate"] = expiry.timeIntervalSince1970 }
            if let sameSite = cookie.sameSitePolicy { value["sameSite"] = sameSite.rawValue.lowercased() }
            return value
        }
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
        guard kind == "seed", !seeded, let list = message["cookies"] as? [[String: Any]], list.count <= 256 else {
            emit(["type": "error", "code": "invalid-seed"]); terminateLogin(); return
        }
        var cookies: [HTTPCookie] = []
        for record in list {
            guard let name = record["name"] as? String, !name.isEmpty, name.utf8.count <= 256,
                  let value = record["value"] as? String, value.utf8.count <= 8192,
                  let domain = record["domain"] as? String, allowedCookieHost(domain),
                  let path = record["path"] as? String, path.hasPrefix("/"),
                  let secure = record["secure"] as? Bool, let httpOnly = record["httpOnly"] as? Bool,
                  let hostOnly = record["hostOnly"] as? Bool, hostOnly == !domain.hasPrefix("."),
                  let temporary = record["session"] as? Bool else {
                emit(["type": "error", "code": "invalid-seed"]); terminateLogin(); return
            }
            var properties: [HTTPCookiePropertyKey: Any] = [.name: name, .value: value, .domain: domain, .path: path]
            // Foundation treats the Secure key's presence as true, even "FALSE".
            if secure { properties[.secure] = "TRUE" }
            if httpOnly { properties[HTTPCookiePropertyKey("HttpOnly")] = "TRUE" }
            if temporary { properties[.discard] = "TRUE" }
            else if let expiry = record["expirationDate"] as? Double, expiry.isFinite { properties[.expires] = Date(timeIntervalSince1970: expiry) }
            else { emit(["type": "error", "code": "invalid-seed"]); terminateLogin(); return }
            if let sameSite = record["sameSite"] as? String {
                guard ["lax", "strict", "none"].contains(sameSite) else { emit(["type": "error", "code": "invalid-seed"]); terminateLogin(); return }
                properties[.sameSitePolicy] = sameSite
            }
            guard let cookie = HTTPCookie(properties: properties) else { emit(["type": "error", "code": "invalid-seed"]); terminateLogin(); return }
            cookies.append(cookie)
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

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { inspect() }

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
    login.embeddedMode = true
    login.checkpointCookies = config["checkpointCookies"] as? Bool == true
    login.arguments = ["WebLogin", "--bridge", "--session"]
    if let fixture = config["fixture"] as? String { login.arguments += ["--fixture-url", fixture] }
    else { login.arguments.append("--production") }
    login.hostView = Unmanaged<NSView>.fromOpaque(host).takeUnretainedValue()
    login.eventSink = { value in value.withCString { sink($0, context) } }
    embeddedLogin = login
    login.applicationDidFinishLaunching(Notification(name: NSApplication.didFinishLaunchingNotification))
    login.handleInput((try? JSONSerialization.data(withJSONObject: ["type": "seed", "cookies": config["cookies"] ?? []])) ?? Data(), entry: login.fixture ?? URL(string: "https://naruto.narutowebgame.com/pt/serverlist")!)
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
