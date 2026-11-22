import Darwin
// Prints the memory footprint (bytes) of each process id given, as "pid bytes" lines; 0 when it can't be read.
for a in CommandLine.arguments.dropFirst() {
    guard let pid = Int32(a) else { continue }
    var info = rusage_info_v4()
    let r = withUnsafeMutablePointer(to: &info) { p in p.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) { proc_pid_rusage(pid, RUSAGE_INFO_V4, $0) } }
    print("\(pid) \(r == 0 ? info.ri_phys_footprint : 0)")
}
