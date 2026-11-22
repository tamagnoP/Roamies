import Cocoa
import WebKit
import Darwin

// Stand-in for the Rust shell, for measuring the overlay page: the same WKWebView, the page under tauri://localhost,
// messages handed over the way main.rs does (evaluateJavaScript of "window.__roamieHost&&__roamieHost({...})").
// usage: host <dist folder> [probe.js]
let args = CommandLine.arguments
let root = URL(fileURLWithPath: args[1])
let probe = args.count > 2 ? (try? String(contentsOfFile: args[2], encoding: .utf8)) ?? "" : ""

func out(_ obj: Any) {
    guard let d = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: d, encoding: .utf8) else { return }
    FileHandle.standardOutput.write((s + "\n").data(using: .utf8)!)
}
func footprint(_ pid: Int32) -> UInt64 {
    var info = rusage_info_v4()
    let r = withUnsafeMutablePointer(to: &info) { p in p.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) { proc_pid_rusage(pid, RUSAGE_INFO_V4, $0) } }
    return r == 0 ? info.ri_phys_footprint : 0
}

final class Files: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let url = task.request.url!
        var p = url.path; if p == "/" || p.isEmpty { p = "/desktop.html" }
        let file = root.appendingPathComponent(String(p.dropFirst()))
        guard let data = try? Data(contentsOf: file) else {
            task.didReceive(HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil)!); task.didFinish(); return
        }
        let types = ["html": "text/html", "js": "text/javascript", "css": "text/css", "woff2": "font/woff2", "png": "image/png", "svg": "image/svg+xml", "json": "application/json", "wav": "audio/wav", "mp3": "audio/mpeg"]
        let type = types[file.pathExtension] ?? "application/octet-stream"
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": type, "Content-Length": String(data.count)])!)
        task.didReceive(data); task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

final class Bridge: NSObject, WKScriptMessageHandlerWithReply, WKNavigationDelegate {
    weak var web: WKWebView?
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        let body = message.body as? [String: Any] ?? [:]
        let cmd = body["cmd"] as? String ?? ""
        if cmd == "sidecar_send", let a = body["args"] as? [String: Any], let m = a["msg"] { out(["send": m]) }
        else if cmd != "set_hot" && cmd != "set_typing" { out(["invoke": cmd]) }
        replyHandler(cmd == "buddy" ? false : NSNull(), nil)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let s = NSScreen.main!, f = s.frame, v = s.visibleFrame
        let top = f.maxY - v.maxY, bottom = v.minY - f.minY, left = v.minX - f.minX, right = f.maxX - v.maxX
        webView.evaluateJavaScript("window.__roamieSafe&&__roamieSafe({top:\(Int(top)),left:\(Int(left)),bottom:\(Int(bottom)),right:\(Int(right)),ox:0,oy:0})")
        webView.evaluateJavaScript("window.__roamiePtr&&__roamiePtr(\(f.width / 2),\(f.height / 2),0)")
        out(["ready": ["web": pid("_webProcessIdentifier"), "gpu": pid("_gpuProcessIdentifier"), "host": getpid(), "w": f.width, "h": f.height, "scale": s.backingScaleFactor]])
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { out(["terminated": true]) }
    func pid(_ key: String) -> Int32 {
        guard let w = web, w.responds(to: NSSelectorFromString(key)) else { return 0 }
        return (w.value(forKey: key) as? NSNumber)?.int32Value ?? 0
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let screen = NSScreen.main!
let win = NSWindow(contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false)
win.isOpaque = false; win.backgroundColor = .clear; win.hasShadow = false; win.ignoresMouseEvents = true
win.level = .floating; win.collectionBehavior = [.canJoinAllSpaces, .stationary]

let cfg = WKWebViewConfiguration()
let files = Files(), bridge = Bridge()
cfg.setURLSchemeHandler(files, forURLScheme: "tauri")
cfg.mediaTypesRequiringUserActionForPlayback = []
let initJS = """
window.ROAMIE_ONLY=["sidekick"];window.ROAMIE_AUTOSOUND=true;window.ROAMIE_UNIT=400;
window.__TAURI__={core:{invoke:(cmd,args)=>window.webkit.messageHandlers.shell.postMessage({cmd,args:args??null})}};
""" + probe
cfg.userContentController.addUserScript(WKUserScript(source: initJS, injectionTime: .atDocumentStart, forMainFrameOnly: true))
cfg.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "shell")
let web = WKWebView(frame: NSRect(origin: .zero, size: screen.frame.size), configuration: cfg)
web.setValue(false, forKey: "drawsBackground")
web.navigationDelegate = bridge; bridge.web = web
if #available(macOS 13.3, *) { web.isInspectable = true }
win.contentView = web
win.orderFrontRegardless()
web.load(URLRequest(url: URL(string: "tauri://localhost/desktop.html")!))

// Commands, one JSON object a line.
let input = FileHandle.standardInput
var pending = Data()
input.readabilityHandler = { h in
    let d = h.availableData
    if d.isEmpty { DispatchQueue.main.async { exit(0) }; return }
    pending.append(d)
    while let nl = pending.firstIndex(of: 10) {
        let line = pending.subdata(in: pending.startIndex..<nl); pending.removeSubrange(pending.startIndex...nl)
        guard let m = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any] else { continue }
        DispatchQueue.main.async {
            if let msg = m["host"], let j = try? JSONSerialization.data(withJSONObject: msg), let s = String(data: j, encoding: .utf8) {
                web.evaluateJavaScript("window.__roamieHost&&__roamieHost(\(s))")
            } else if let js = m["eval"] as? String {
                web.evaluateJavaScript(js)
            } else if let js = m["ask"] as? String {
                web.evaluateJavaScript(js) { v, e in out(["answer": m["id"] ?? 0, "value": v ?? NSNull(), "error": e.map { "\($0)" } ?? NSNull()]) }
            } else if m["mem"] != nil {
                var others: [String: UInt64] = [:]
                for p in (m["pids"] as? [NSNumber]) ?? [] { others[p.stringValue] = footprint(p.int32Value) }
                out(["mem": m["mem"]!, "web": footprint(bridge.pid("_webProcessIdentifier")), "gpu": footprint(bridge.pid("_gpuProcessIdentifier")), "host": footprint(getpid()), "others": others])
            } else if m["quit"] != nil { exit(0) }
        }
    }
}
app.run()
