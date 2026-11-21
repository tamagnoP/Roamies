import Darwin
import Foundation

// Records, every few seconds, the memory of each process of a running Roamies: the shell, its WebKit processes (the
// overlay page among them), the sidecar, the voice and hands helpers, whatever the sidecar started, and any pi.
// One JSON line per process per sample: the time, the process id, its kind and its size. Nothing else is read: no
// arguments beyond the name of the program, nothing said, nothing shown.
// usage: sample <out.jsonl> [seconds between samples, default 5] [path of the app, default /Applications/Roamies.app]

let args = CommandLine.arguments
guard args.count > 1 else { FileHandle.standardError.write("usage: sample <out.jsonl> [seconds] [app]\n".data(using: .utf8)!); exit(2) }
let outPath = args[1], every = args.count > 2 ? Double(args[2]) ?? 5 : 5
let app = (args.count > 3 ? args[3] : "/Applications/Roamies.app")
let appReal = (try? FileManager.default.destinationOfSymbolicLink(atPath: app)) ?? app

typealias Responsible = @convention(c) (pid_t) -> pid_t
let responsibleFor: Responsible? = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "responsibility_get_pid_responsible_for_pid").map { unsafeBitCast($0, to: Responsible.self) }

func allPids() -> [pid_t] {
    let n = proc_listallpids(nil, 0)
    var buf = [pid_t](repeating: 0, count: Int(n) + 64)
    let got = proc_listallpids(&buf, Int32(buf.count * MemoryLayout<pid_t>.size))
    return Array(buf.prefix(Int(max(0, got)))).filter { $0 > 0 }
}
func pathOf(_ pid: pid_t) -> String {
    var b = [CChar](repeating: 0, count: 4096)
    return proc_pidpath(pid, &b, UInt32(b.count)) > 0 ? String(cString: b) : ""
}
func parentOf(_ pid: pid_t) -> pid_t {
    var i = proc_bsdinfo()
    return proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &i, Int32(MemoryLayout<proc_bsdinfo>.size)) > 0 ? pid_t(i.pbi_ppid) : 0
}
func footprint(_ pid: pid_t) -> UInt64 {
    var info = rusage_info_v4()
    let r = withUnsafeMutablePointer(to: &info) { p in p.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) { proc_pid_rusage(pid, RUSAGE_INFO_V4, $0) } }
    return r == 0 ? info.ri_phys_footprint : 0
}
/// The file name of the script a node or python process runs (its first argument that is not an option). Only the
/// name: the rest of the arguments are never kept, since a hand-off's request is among pi's.
func scriptName(_ pid: pid_t) -> String {
    var mib: [Int32] = [CTL_KERN, KERN_PROCARGS2, pid]
    var size = 0
    guard sysctl(&mib, 3, nil, &size, nil, 0) == 0, size > 4 else { return "" }
    var buf = [UInt8](repeating: 0, count: size)
    guard sysctl(&mib, 3, &buf, &size, nil, 0) == 0 else { return "" }
    let argc = buf.withUnsafeBytes { $0.load(as: Int32.self) }
    var i = 4
    while i < size && buf[i] != 0 { i += 1 }
    while i < size && buf[i] == 0 { i += 1 }
    var seen = 0
    while i < size && seen < min(argc, 4) {
        var j = i
        while j < size && buf[j] != 0 { j += 1 }
        let a = String(decoding: buf[i..<j], as: UTF8.self)
        if seen > 0 && !a.hasPrefix("-") { return (a as NSString).lastPathComponent }
        seen += 1; i = j + 1
    }
    return ""
}

let fmt = ISO8601DateFormatter(); fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
FileManager.default.createFile(atPath: outPath, contents: nil)
guard let out = FileHandle(forWritingAtPath: outPath) else { FileHandle.standardError.write("cannot write \(outPath)\n".data(using: .utf8)!); exit(1) }
out.seekToEndOfFile()
signal(SIGTERM) { _ in exit(0) }
signal(SIGINT) { _ in exit(0) }

while true {
    let pids = allPids()
    var path: [pid_t: String] = [:], parent: [pid_t: pid_t] = [:]
    for p in pids { path[p] = pathOf(p); parent[p] = parentOf(p) }
    let shells = pids.filter { let s = path[$0] ?? ""; return s == "\(app)/Contents/MacOS/roamies" || s == "\(appReal)/Contents/MacOS/roamies" }
    func under(_ p: pid_t, _ roots: Set<pid_t>) -> Bool { var q = p, n = 0; while q > 1 && n < 32 { if roots.contains(q) { return true }; q = parent[q] ?? 0; n += 1 }; return false }
    let shellSet = Set(shells)
    let sidecars = Set(pids.filter { (path[$0] ?? "").hasSuffix("/Contents/MacOS/node") && shellSet.contains(parent[$0] ?? 0) })
    var lines = ""
    let now = fmt.string(from: Date())
    for p in pids {
        let s = path[p] ?? "", name = (s as NSString).lastPathComponent
        let script = (name == "node" || name.hasPrefix("python") || name == "Python") ? scriptName(p) : ""
        let isPi = name == "pi" || script == "pi" || script == "pi.js" || script == "cli.js" && s.contains("/pi")
        var kind = ""
        if shellSet.contains(p) { kind = "shell" }
        else if sidecars.contains(p) { kind = "sidecar" }
        else if name == "roamies-voice" && under(p, shellSet) { kind = "voice helper" }
        else if name == "roamies-hands" && under(p, shellSet) { kind = "hands helper" }
        else if under(p, sidecars) { kind = isPi ? "pi (started by Roamies)" : script == "kokoro_server.py" ? "kokoro helper" : "started by the sidecar: \(name)" }
        else if under(p, shellSet) { kind = "started by the shell: \(name)" }
        else if s.contains("com.apple.WebKit."), let r = responsibleFor, shellSet.contains(r(p)) {
            kind = name.contains("WebContent") ? "web page" : name.contains("GPU") ? "webkit graphics" : name.contains("Networking") ? "webkit network" : "webkit: \(name)"
        }
        else if isPi { kind = "pi (not started by Roamies)" }
        if kind.isEmpty { continue }
        lines += "{\"t\":\"\(now)\",\"pid\":\(p),\"kind\":\"\(kind)\",\"mb\":\(String(format: "%.1f", Double(footprint(p)) / 1048576))}\n"
    }
    if lines.isEmpty { lines = "{\"t\":\"\(now)\",\"pid\":0,\"kind\":\"Roamies is not running\",\"mb\":0}\n" }
    out.write(lines.data(using: .utf8)!)
    Thread.sleep(forTimeInterval: every)
}
