import AppKit
import WebKit

@MainActor enum CredentialPickerCheck {
    struct Failure: Error {
        let check: String
        init(_ check: String) { self.check = check }
    }

    static func run(_ url: URL) {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        Task { @MainActor in
            do {
                try await check(url)
                print("PASS WebKit password picker displays, selects a synthetic account and fills both fields")
                exit(0)
            } catch let failure as Failure {
                fputs("FAIL WebKit password picker: \(failure.check)\n", stderr)
                exit(1)
            } catch {
                fputs("FAIL WebKit password picker: \(error.localizedDescription)\n", stderr)
                exit(1)
            }
        }
        app.run()
    }

    private static func check(_ url: URL) async throws {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 640, height: 480),
                              styleMask: [.titled], backing: .buffered, defer: false)
        let login = WebLoginPrototype()
        login.embeddedMode = true
        login.hostView = window.contentView
        login.arguments = ["WebLogin", "--bridge", "--session", "--fixture-url", url.absoluteString]
        login.interfaceStrings = ["password.trigger": "选择已保存的账号"]
        var events: [[String: Any]] = []
        login.eventSink = { message in
            if let event = (try? JSONSerialization.jsonObject(with: Data(message.utf8))) as? [String: Any] {
                events.append(event)
            }
        }
        login.applicationDidFinishLaunching(Notification(name: NSApplication.didFinishLaunchingNotification))
        defer { login.disposeEmbedded(); window.orderOut(nil) }
        let webView = login.webView!
        let controller = webView.configuration.userContentController
        guard controller.userScripts.contains(where: {
            $0.source == LoginCredentialScript.source(strings: login.interfaceStrings)
                && $0.injectionTime == .atDocumentEnd && $0.isForMainFrameOnly
        }) else { throw Failure("script registration") }
        // Capture the closed shadow root in the fixture's isolated world for assertions and hit coordinates.
        controller.addUserScript(WKUserScript(source: """
            const attach = Element.prototype.attachShadow;
            Element.prototype.attachShadow = function(options) {
                const root = attach.call(this, options);
                if (options.mode === 'closed') window.fixturePicker = root;
                return root;
            };
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .defaultClient))
        window.makeKeyAndOrderFront(nil)
        login.handleInput(Data(#"{"type":"seed","cookies":[]}"#.utf8), entry: url)

        let trigger = try await wait("localized trigger is visible in the isolated world") {
            let value: Any? = try? await webView.callAsyncJavaScript("""
                const button = window.fixturePicker?.querySelector('.trigger');
                if (button?.textContent !== '选择已保存的账号' || !button.getClientRects().length) return null;
                const rect = button.getBoundingClientRect();
                return [rect.x + rect.width / 2, rect.y + rect.height / 2];
                """, contentWorld: .defaultClient)
            return value as? [Double]
        }
        let isolated = try await webView.evaluateJavaScript("typeof window.__narutoCredentialFill === 'undefined'")
        guard isolated as? Bool == true else { throw Failure("page world must not see credential bridge") }
        try await click(trigger, in: webView, window: window)
        let query = try await wait("credential query") { events.first { $0["type"] as? String == "credential-query" } }
        guard let requestId = query["requestId"] as? String, query["query"] as? String == "synthetic" else {
            throw Failure("credential query payload")
        }
        let id = String(repeating: "a", count: 32)
        login.credentialResponse("""
            {"requestId":"\(requestId)","accounts":[{"id":"\(id)","username":"synthetic-account"}]}
            """)
        let row = try await wait("synthetic account is visible") {
            let value: Any? = try? await webView.callAsyncJavaScript("""
                const row = window.fixturePicker?.querySelector('[role=option]');
                if (row?.querySelector('.name')?.textContent !== 'synthetic-account' || !row.getClientRects().length) return null;
                const rect = row.getBoundingClientRect();
                return [rect.x + rect.width / 2, rect.y + rect.height / 2];
                """, contentWorld: .defaultClient)
            return value as? [Double]
        }
        try await click(row, in: webView, window: window)
        let selection = try await wait("credential selection") { events.first { $0["type"] as? String == "credential-select" } }
        guard selection["id"] as? String == id, selection["requestId"] as? String == requestId else {
            throw Failure("credential selection payload")
        }
        login.credentialResponse("""
            {"type":"fill","requestId":"\(requestId)","username":"synthetic-account","password":"synthetic-password"}
            """)
        _ = try await wait("both form fields are filled") {
            let filled = try? await webView.evaluateJavaScript("""
                document.querySelector('[name=username]').value === 'synthetic-account'
                    && document.querySelector('[name=password]').value === 'synthetic-password'
                """)
            return filled as? Bool == true ? true : nil
        }
    }

    private static func wait<Value>(_ description: String, _ read: () async -> Value?) async throws -> Value {
        for _ in 0..<80 {
            if let value = await read() { return value }
            try await Task.sleep(for: .milliseconds(50))
        }
        throw Failure(description)
    }

    private static func click(_ coordinates: [Double], in webView: WKWebView, window: NSWindow) async throws {
        let y = webView.isFlipped ? coordinates[1] : webView.bounds.height - coordinates[1]
        let point = webView.convert(NSPoint(x: coordinates[0], y: y), to: nil)
        guard let container = webView.superview, let target = webView.hitTest(container.convert(point, from: nil)) else {
            throw Failure("hit test inside WebKit view")
        }
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            guard let event = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [],
                                                 timestamp: ProcessInfo.processInfo.systemUptime,
                                                 windowNumber: window.windowNumber, context: nil,
                                                 eventNumber: 0, clickCount: 1, pressure: 1) else {
                throw Failure("create click event")
            }
            if type == .leftMouseDown { target.mouseDown(with: event) }
            else { target.mouseUp(with: event) }
            try await Task.sleep(for: .milliseconds(50))
        }
    }
}
