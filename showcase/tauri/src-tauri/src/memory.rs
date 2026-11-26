// Local-only build (feature 23, stage 5): memory, read by the shell when the sidecar asks (only while
// "measureRequests" is on). For this process, every process it started and theirs (the sidecar, the voice helper,
// Kokoro, a model server Roamies started), and the overlay's WebKit processes (those macOS holds this app responsible
// for): each one's memory footprint (proc_pid_rusage, as Activity Monitor's "Memory"). For the Mac: the memory
// pressure level and the swap in use (sysctl). Numbers and process names only; nothing needs a permission, and
// nothing is sent anywhere but to the sidecar. Elsewhere than macOS the answer is empty.

use super::*;

#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::{c_char, c_int, c_void, CStr};

    extern "C" {
        fn proc_listallpids(buffer: *mut c_void, buffersize: c_int) -> c_int;
        fn proc_listchildpids(ppid: c_int, buffer: *mut c_void, buffersize: c_int) -> c_int;
        fn proc_pid_rusage(pid: c_int, flavor: c_int, buffer: *mut c_void) -> c_int;
        fn proc_name(pid: c_int, buffer: *mut c_void, buffersize: u32) -> c_int;
        fn sysctlbyname(name: *const c_char, oldp: *mut c_void, oldlenp: *mut usize, newp: *mut c_void, newlen: usize) -> c_int;
        fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    }
    const RTLD_DEFAULT: *mut c_void = -2isize as *mut c_void;
    const RUSAGE_INFO_V2: c_int = 2;

    /// rusage_info_v2, as <sys/resource.h> has it.
    #[repr(C)]
    #[derive(Default)]
    struct RusageV2 {
        uuid: [u8; 16],
        user_time: u64,
        system_time: u64,
        pkg_idle_wkups: u64,
        interrupt_wkups: u64,
        pageins: u64,
        wired_size: u64,
        resident_size: u64,
        phys_footprint: u64,
        proc_start_abstime: u64,
        proc_exit_abstime: u64,
        child_user_time: u64,
        child_system_time: u64,
        child_pkg_idle_wkups: u64,
        child_interrupt_wkups: u64,
        child_pageins: u64,
        child_elapsed_abstime: u64,
        diskio_bytesread: u64,
        diskio_byteswritten: u64,
    }
    /// xsw_usage, as <sys/sysctl.h> has it.
    #[repr(C)]
    #[derive(Default)]
    struct SwapUsage {
        total: u64,
        avail: u64,
        used: u64,
        pagesize: u32,
        encrypted: u32,
    }

    /// A process's memory footprint in bytes. None when it can't be read (gone, or not this user's).
    pub fn footprint(pid: i32) -> Option<u64> {
        let mut r = RusageV2::default();
        (unsafe { proc_pid_rusage(pid, RUSAGE_INFO_V2, &mut r as *mut RusageV2 as *mut c_void) } == 0).then_some(r.phys_footprint)
    }
    pub fn name(pid: i32) -> String {
        let mut b = [0u8; 256];
        let n = unsafe { proc_name(pid, b.as_mut_ptr() as *mut c_void, b.len() as u32) };
        if n <= 0 {
            return String::new();
        }
        String::from_utf8_lossy(&b[..n as usize]).into_owned()
    }
    fn pids(list: impl Fn(*mut c_void, c_int) -> c_int) -> Vec<i32> {
        let mut buf = vec![0i32; 4096];
        let n = list(buf.as_mut_ptr() as *mut c_void, (buf.len() * 4) as c_int);
        if n <= 0 {
            return Vec::new();
        }
        buf.truncate(n as usize);
        buf.into_iter().filter(|&p| p > 0).collect()
    }
    /// Every process started by `root`, and theirs, as (pid, parent).
    pub fn descendants(root: i32) -> Vec<(i32, i32)> {
        let mut out = Vec::new();
        let mut todo = vec![root];
        while let Some(p) = todo.pop() {
            for c in pids(|b, n| unsafe { proc_listchildpids(p, b, n) }) {
                if c != p && !out.iter().any(|&(x, _)| x == c) && out.len() < 64 {
                    out.push((c, p));
                    todo.push(c);
                }
            }
        }
        out
    }
    /// The processes macOS holds `root` responsible for (the overlay's WebKit processes), by the system's own record
    /// (responsibility_get_pid_responsible_for_pid, looked up at run time). Empty when it isn't there.
    pub fn responsible(root: i32, except: &[i32]) -> Vec<i32> {
        let f = unsafe { dlsym(RTLD_DEFAULT, c"responsibility_get_pid_responsible_for_pid".as_ptr()) };
        if f.is_null() {
            return Vec::new();
        }
        let resp: extern "C" fn(c_int) -> c_int = unsafe { std::mem::transmute(f) };
        pids(|b, n| unsafe { proc_listallpids(b, n) }).into_iter().filter(|&p| p != root && !except.contains(&p) && resp(p) == root).take(32).collect()
    }
    fn sysctl<T: Default>(name: &CStr) -> Option<T> {
        let mut v = T::default();
        let mut len = std::mem::size_of::<T>();
        (unsafe { sysctlbyname(name.as_ptr(), &mut v as *mut T as *mut c_void, &mut len, std::ptr::null_mut(), 0) } == 0).then_some(v)
    }
    /// The memory pressure level: 1 normal, 2 warning, 4 critical.
    pub fn pressure() -> Option<i32> {
        sysctl::<i32>(c"kern.memorystatus_vm_pressure_level")
    }
    /// Swap in use, in bytes.
    pub fn swap_used() -> Option<u64> {
        sysctl::<SwapUsage>(c"vm.swapusage").map(|s| s.used)
    }
}

const MB: f64 = 1024.0 * 1024.0;
/// One process, for the sidecar: its pid, the pid that started it, its name and its footprint in MB.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn row(pid: i32, parent: Option<i32>, name: &str, bytes: Option<u64>) -> Value {
    json!({ "pid": pid, "parent": parent, "name": name, "mb": bytes.map(|b| (b as f64 / MB * 10.0).round() / 10.0) })
}

/// The reading: { type: 'memory', processes: [{ pid, parent, name, mb }], webkit: [...], pressure, swapMB, asked }.
pub fn reading(asked: Value) -> Value {
    #[cfg(target_os = "macos")]
    {
        let me = std::process::id() as i32;
        let mut processes = vec![row(me, None, &mac::name(me), mac::footprint(me))];
        let tree = mac::descendants(me);
        for &(p, parent) in &tree {
            processes.push(row(p, Some(parent), &mac::name(p), mac::footprint(p)));
        }
        let ours: Vec<i32> = tree.iter().map(|&(p, _)| p).collect();
        let webkit: Vec<Value> = mac::responsible(me, &ours).into_iter().map(|p| row(p, None, &mac::name(p), mac::footprint(p))).collect();
        json!({ "type": "memory", "processes": processes, "webkit": webkit, "pressure": mac::pressure(), "swapMB": mac::swap_used().map(|b| (b as f64 / MB).round()), "asked": asked })
    }
    #[cfg(not(target_os = "macos"))]
    json!({ "type": "memory", "processes": [], "webkit": [], "pressure": null, "swapMB": null, "asked": asked })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_row() {
        assert_eq!(row(7, Some(1), "node", Some(52_428_800)), json!({ "pid": 7, "parent": 1, "name": "node", "mb": 50.0 }));
        assert_eq!(row(7, None, "x", None)["mb"], Value::Null);
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn readable_without_a_permission() {
        let r = reading(json!(1));
        assert_eq!(r["type"], "memory");
        assert!(r["processes"][0]["mb"].as_f64().unwrap() > 0.0, "this process's footprint is read");
        assert!(r["pressure"].is_number(), "the memory pressure is read");
        assert!(r["swapMB"].is_number(), "the swap is read");
        let mut child = std::process::Command::new("/bin/sleep").arg("5").spawn().unwrap();
        let r = reading(json!(2));
        let found = r["processes"].as_array().unwrap().iter().any(|p| p["pid"] == child.id() as i64 && p["mb"].as_f64().unwrap_or(0.0) > 0.0);
        let _ = child.kill();
        assert!(found, "a process it started is read");
    }
}
