// Local-only build (feature 31): whether the owner is at the Mac, and whether another app is using a microphone. Every
// few seconds the sidecar is told two things and nothing else: the seconds since the last keyboard or mouse input
// (CGEventSourceSecondsSinceLastEventType), and whether any input device is running for some process
// (kAudioDevicePropertyDeviceIsRunningSomewhere on each device that has input streams). Neither reading needs a
// permission: nothing is recorded or listened to, no event is watched, and no app is named. Roamies' own listening
// runs the device too; the sidecar knows when it listens and leaves that out. Elsewhere than macOS nothing is sent.
// Feature 23: and whether the Mac has a network at all (SCNetworkReachabilityGetFlags for the default route, as the
// system already knows it): no permission, and no request or packet is sent to find out.

use super::*;

/// How often the two readings are sent.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub const EVERY: Duration = Duration::from_secs(5);

#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::c_void;

    #[repr(C)]
    struct Address {
        selector: u32,
        scope: u32,
        element: u32,
    }
    #[link(name = "CoreAudio", kind = "framework")]
    extern "C" {
        fn AudioObjectGetPropertyDataSize(id: u32, addr: *const Address, qsize: u32, qdata: *const c_void, size: *mut u32) -> i32;
        fn AudioObjectGetPropertyData(id: u32, addr: *const Address, qsize: u32, qdata: *const c_void, size: *mut u32, data: *mut c_void) -> i32;
    }
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state: i32, event: u32) -> f64;
    }
    #[repr(C)]
    struct SockaddrIn {
        len: u8,
        family: u8,
        port: u16,
        addr: u32,
        zero: [u8; 8],
    }
    #[link(name = "SystemConfiguration", kind = "framework")]
    extern "C" {
        fn SCNetworkReachabilityCreateWithAddress(allocator: *const c_void, address: *const SockaddrIn) -> *const c_void;
        fn SCNetworkReachabilityGetFlags(target: *const c_void, flags: *mut u32) -> u8;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *const c_void);
    }
    const REACHABLE: u32 = 1 << 1; // kSCNetworkReachabilityFlagsReachable
    const CONNECTION_REQUIRED: u32 = 1 << 2; // kSCNetworkReachabilityFlagsConnectionRequired

    /// Whether the Mac has a network: the default route (0.0.0.0) is reachable without a connection first having to be
    /// made. Read from what the system knows; nothing is sent. None when it can't be read.
    pub fn network() -> Option<bool> {
        let any = SockaddrIn { len: std::mem::size_of::<SockaddrIn>() as u8, family: 2, port: 0, addr: 0, zero: [0; 8] };
        let target = unsafe { SCNetworkReachabilityCreateWithAddress(std::ptr::null(), &any) };
        if target.is_null() {
            return None;
        }
        let mut flags = 0u32;
        let ok = unsafe { SCNetworkReachabilityGetFlags(target, &mut flags) } != 0;
        unsafe { CFRelease(target) };
        ok.then_some(flags & REACHABLE != 0 && flags & CONNECTION_REQUIRED == 0)
    }
    const fn code(s: &[u8; 4]) -> u32 {
        ((s[0] as u32) << 24) | ((s[1] as u32) << 16) | ((s[2] as u32) << 8) | s[3] as u32
    }
    const SYSTEM: u32 = 1; // kAudioObjectSystemObject
    const DEVICES: u32 = code(b"dev#"); // kAudioHardwarePropertyDevices
    const STREAMS: u32 = code(b"stm#"); // kAudioDevicePropertyStreams
    const RUNNING_SOMEWHERE: u32 = code(b"gone"); // kAudioDevicePropertyDeviceIsRunningSomewhere
    const GLOBAL: u32 = code(b"glob"); // kAudioObjectPropertyScopeGlobal
    const INPUT: u32 = code(b"inpt"); // kAudioObjectPropertyScopeInput
    const MAIN: u32 = 0; // kAudioObjectPropertyElementMain

    /// Seconds since the last keyboard or mouse input, from the HID system state (kCGAnyInputEventType).
    pub fn idle_seconds() -> Option<f64> {
        let s = unsafe { CGEventSourceSecondsSinceLastEventType(1, u32::MAX) };
        (s.is_finite() && s >= 0.0).then_some(s)
    }
    /// Whether any device with input streams is running for some process. None when the devices can't be read.
    pub fn mic_in_use() -> Option<bool> {
        let addr = Address { selector: DEVICES, scope: GLOBAL, element: MAIN };
        let mut size = 0u32;
        if unsafe { AudioObjectGetPropertyDataSize(SYSTEM, &addr, 0, std::ptr::null(), &mut size) } != 0 {
            return None;
        }
        let mut ids = vec![0u32; size as usize / 4];
        if unsafe { AudioObjectGetPropertyData(SYSTEM, &addr, 0, std::ptr::null(), &mut size, ids.as_mut_ptr() as *mut c_void) } != 0 {
            return None;
        }
        ids.truncate(size as usize / 4);
        let mut any = false;
        for id in ids {
            let streams = Address { selector: STREAMS, scope: INPUT, element: MAIN };
            let mut n = 0u32;
            if unsafe { AudioObjectGetPropertyDataSize(id, &streams, 0, std::ptr::null(), &mut n) } != 0 || n == 0 {
                continue;
            }
            let running = Address { selector: RUNNING_SOMEWHERE, scope: GLOBAL, element: MAIN };
            let mut on = 0u32;
            let mut sz = 4u32;
            if unsafe { AudioObjectGetPropertyData(id, &running, 0, std::ptr::null(), &mut sz, &mut on as *mut u32 as *mut c_void) } == 0 && on != 0 {
                any = true;
            }
        }
        Some(any)
    }
}

/// The message for the sidecar: { type: 'presence', idle: whole seconds, mic: true/false, net: true/false/null }.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn reading(idle: Option<f64>, mic: Option<bool>, net: Option<bool>) -> Value {
    json!({ "type": "presence", "idle": idle.map(|s| s.floor() as u64), "mic": mic.unwrap_or(false), "net": net })
}

/// Sends the two readings every EVERY, for as long as Roamies runs (macOS only).
pub fn start(app: AppHandle) {
    #[cfg(target_os = "macos")]
    thread::spawn(move || loop {
        to_sidecar(&app, &reading(mac::idle_seconds(), mac::mic_in_use(), mac::network()));
        thread::sleep(EVERY);
    });
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_reading() {
        assert_eq!(reading(Some(612.7), Some(true), Some(true)), json!({ "type": "presence", "idle": 612, "mic": true, "net": true }));
        assert_eq!(reading(None, None, None), json!({ "type": "presence", "idle": null, "mic": false, "net": null }));
        assert_eq!(reading(Some(1.0), Some(false), Some(false))["net"], json!(false));
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn readable_without_a_permission() {
        assert!(mac::idle_seconds().is_some(), "the idle time is read");
        assert!(mac::mic_in_use().is_some(), "the devices are read");
        assert!(mac::network().is_some(), "the network status is read");
    }
}
