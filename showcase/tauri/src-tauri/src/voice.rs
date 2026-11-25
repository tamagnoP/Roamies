// Voice helper (macOS: Apple speech; Windows: Parakeet on the PC) and the global shortcuts.

use super::*;
use std::cell::RefCell;
use std::io::{BufRead, BufReader};
use std::process::Child;
use std::sync::atomic::AtomicU32;

/// Id of the registered show/hide hotkey, read by the hotkey event handler.
static SUMMON_ID: AtomicU32 = AtomicU32::new(0);
/// Id of the registered "ask about an area" hotkey.
static SNAP_ID: AtomicU32 = AtomicU32::new(0);
static LIST_ID: AtomicU32 = AtomicU32::new(0);
/// Id of the Esc hotkey, held only while the Roamie is on screen (0 when it isn't).
static ESC_ID: AtomicU32 = AtomicU32::new(0);
/// Local-only build (feature 33): id of the stand-down hotkey, held for as long as Roamies runs.
static STAND_ID: AtomicU32 = AtomicU32::new(0);
/// Feature 33: how long the phrase must have been all that was heard, with nothing more said, before it counts
/// (STAND_SETTLE_MS in sidecar/standdown.mjs).
const STAND_SETTLE_MS: u64 = 700;

/// Feature 33: the phrase as words and the small words allowed around it (from the sidecar), and the take being heard:
/// gen counts what it has heard so far, so a wait for the phrase to settle is dropped when more comes; fired: this take
/// has already stood Roamies down, so its final words go nowhere.
struct Stand {
    phrase: Vec<String>,
    fill: Vec<String>,
    gen: u64,
    fired: bool,
}
static STAND: Mutex<Stand> = Mutex::new(Stand { phrase: Vec::new(), fill: Vec::new(), gen: 0, fired: false });

thread_local! {
    // The hotkey manager must live on the main thread; it also owns the current show/hide hotkey.
    static HOTKEYS: RefCell<Option<(global_hotkey::GlobalHotKeyManager, [Option<global_hotkey::hotkey::HotKey>; 4])>> = const { RefCell::new(None) };
    // The overlays that have the Roamie (or its card, or its ask field) on screen right now.
    static ESC_UP: RefCell<std::collections::HashSet<String>> = RefCell::new(std::collections::HashSet::new());
}

pub(crate) fn voice_binary() -> Option<PathBuf> {
    helper_binary("roamies-voice")
}

pub(crate) fn start_voice(app: &AppHandle) {
    let state = app.state::<Voice>();
    if state.0.lock().unwrap().is_some() {
        return;
    }
    let Some(bin) = voice_binary() else {
        eprintln!("voice helper not found next to the app binary");
        return;
    };
    let chord = app.state::<TalkChord>().0.lock().unwrap().join(",");
    let mut cmd = Command::new(bin);
    cmd.arg("--chord").arg(chord);
    if let Some(dir) = app.state::<VoiceModel>().0.lock().unwrap().clone() {
        cmd.arg("--model").arg(dir);
    }
    // Debug builds: ROAMIES_TEST_AUDIO=<wav> stands in for the microphone, to test talking with no mic (CI, Docker).
    #[cfg(debug_assertions)]
    if let Some(wav) = std::env::var_os("ROAMIES_TEST_AUDIO") {
        cmd.arg("--test-audio").arg(wav);
    }
    let mut child = match hide_console(&mut cmd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(log_stdio("sidekick-voice.log")).spawn() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("voice helper failed to start: {e}");
            return;
        }
    };
    let stdout = child.stdout.take().expect("piped stdout");
    let pid = child.id();
    // Local-only build (feature 24, fix 4): its input is written by a thread of its own (pipe.rs).
    *state.2.lock().unwrap() = child.stdin.take().map(|i| PipeWriter::new(i, "voice helper"));
    *state.0.lock().unwrap() = Some(child);
    let app = app.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
            let app2 = app.clone();
            let _ = app.run_on_main_thread(move || handle_voice(&app2, msg));
        }
        // Exited: anything it was drawing is gone, so the page draws the sidekick again.
        {
            let app2 = app.clone();
            let _ = app.run_on_main_thread(move || to_sidekick_buddy(&app2, &json!({ "state": "gone" })));
        }
        // If it is still the wanted helper, it died on its own: retry a few times.
        let state = app.state::<Voice>();
        let ours = {
            let mut slot = state.0.lock().unwrap();
            let ours = slot.as_ref().map(Child::id) == Some(pid);
            if ours {
                state.2.lock().unwrap().take();
                if let Some(mut c) = slot.take() {
                    let _ = c.wait();
                }
            }
            ours
        };
        if ours && state.1.fetch_add(1, Ordering::Relaxed) < 3 {
            thread::sleep(Duration::from_secs(1));
            let app2 = app.clone();
            let _ = app.run_on_main_thread(move || start_voice(&app2));
        }
    });
}

pub(crate) fn stop_voice(app: &AppHandle) {
    let state = app.state::<Voice>();
    state.2.lock().unwrap().take();
    let child = state.0.lock().unwrap().take();
    if let Some(mut c) = child {
        let _ = c.kill();
        let _ = c.wait();
    }
    to_overlays(app, &json!({ "kind": "voice", "type": "state", "state": "idle" }));
}

pub(crate) fn to_voice(app: &AppHandle, msg: &Value) {
    // Local-only build (feature 24, fix 4): handed to the writer; this never waits on the helper.
    if let Some(input) = app.state::<Voice>().2.lock().unwrap().as_ref() {
        input.send(msg.to_string());
    }
}

/// Tell the voice helper to drop a talk-chord press that turned out to be the show/hide shortcut.
fn cancel_voice(app: &AppHandle) {
    to_voice(app, &json!({ "cmd": "cancel" }));
}

/// Show/hide shortcut (default ⌃⌥S): brings the sidekick forward, or sends it away if it's out.
/// Must run on the main thread.
pub(crate) fn init_hotkeys(app: &AppHandle) {
    use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState};
    match GlobalHotKeyManager::new() {
        Ok(m) => HOTKEYS.with(|h| *h.borrow_mut() = Some((m, [None, None, None, None]))),
        Err(e) => return eprintln!("hotkeys unavailable: {e}"),
    }
    let app = app.clone();
    GlobalHotKeyEvent::set_event_handler(Some(move |e: GlobalHotKeyEvent| {
        if e.state() != HotKeyState::Pressed {
            return;
        }
        let summon = e.id() == SUMMON_ID.load(Ordering::Relaxed);
        let snap = e.id() == SNAP_ID.load(Ordering::Relaxed);
        let list = e.id() == LIST_ID.load(Ordering::Relaxed);
        let stand = e.id() != 0 && e.id() == STAND_ID.load(Ordering::Relaxed);
        if stand {
            let app2 = app.clone();
            let _ = app.run_on_main_thread(move || stand_down(&app2, "key"));
            return;
        }
        let esc = e.id() != 0 && e.id() == ESC_ID.load(Ordering::Relaxed);
        if esc {
            // The panel has the keyboard: Esc closes it, as it would without this hotkey.
            let app2 = app.clone();
            let _ = app.run_on_main_thread(move || {
                let panel = app2.get_webview_window(PANEL_LABEL).filter(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false));
                if panel.is_some() {
                    hide_panel(&app2, "esc");
                } else {
                    to_overlays(&app2, &json!({ "kind": "esc" }));
                }
            });
            return;
        }
        if !summon && !snap && !list {
            return;
        }
        let app2 = app.clone();
        let _ = app.run_on_main_thread(move || {
            // Both shortcuts share modifiers with the talk chord; that press wasn't a request to talk.
            cancel_voice(&app2);
            if summon {
                to_overlays(&app2, &json!({ "kind": "summon" }));
            } else if list {
                to_sidecar(&app2, &json!({ "type": "show_list" }));
            } else {
                to_sidecar(&app2, &json!({ "type": "snap" }));
            }
        });
    }));
}

/// Swaps one global shortcut (0 = show/hide, 1 = ask about an area, 2 = show the list, 3 = stand down). On failure
/// (bad format, or another app owns it) the old one stays.
pub(crate) fn set_hotkey(slot: usize, accel: &str) -> Result<(), String> {
    use global_hotkey::hotkey::HotKey;
    let new: HotKey = accel.parse().map_err(|e| format!("{e}"))?;
    let id_slot = [&SUMMON_ID, &SNAP_ID, &LIST_ID, &STAND_ID][slot];
    HOTKEYS.with(|h| {
        let mut h = h.borrow_mut();
        let Some((manager, keys)) = h.as_mut() else { return Err("hotkeys unavailable".to_string()) };
        let current = keys[slot];
        if current.map(|c| c.id()) == Some(new.id()) {
            return Ok(());
        }
        if keys.iter().enumerate().any(|(i, k)| i != slot && k.map(|c| c.id()) == Some(new.id())) {
            return Err("already used by the other Roamies shortcut".to_string());
        }
        if let Some(old) = current {
            let _ = manager.unregister(old);
        }
        match manager.register(new) {
            Ok(()) => {
                keys[slot] = Some(new);
                id_slot.store(new.id(), Ordering::Relaxed);
                Ok(())
            }
            Err(e) => {
                if let Some(old) = current {
                    let _ = manager.register(old);
                }
                Err(format!("{e}"))
            }
        }
    })
}

/// Esc stops the Roamie's answer, or sends it away when it's idle (overlay host.js decides which). Global, so it
/// works without clicking the Roamie first; that means other apps don't get Esc meanwhile, so it's held only
/// while some overlay has the Roamie on screen. Must run on the main thread.
pub(crate) fn set_esc(app: &AppHandle, label: &str, on: bool) {
    use global_hotkey::hotkey::{Code, HotKey};
    let any = ESC_UP.with(|up| {
        let mut up = up.borrow_mut();
        if on {
            up.insert(label.to_owned());
        } else {
            up.remove(label);
        }
        // An overlay that closed (its screen went away) can't say it's done.
        up.retain(|l| app.get_webview_window(l).is_some());
        !up.is_empty()
    });
    HOTKEYS.with(|h| {
        let mut h = h.borrow_mut();
        let Some((manager, _)) = h.as_mut() else { return };
        let key = HotKey::new(None, Code::Escape);
        let held = ESC_ID.load(Ordering::Relaxed) != 0;
        if any && !held {
            match manager.register(key) {
                Ok(()) => ESC_ID.store(key.id(), Ordering::Relaxed),
                Err(e) => eprintln!("esc hotkey: {e}"),
            }
        } else if !any && held {
            let _ = manager.unregister(key);
            ESC_ID.store(0, Ordering::Relaxed);
        }
    });
}

/// Feature 33: the phrase and its small words, as words (the sidecar's standKeys).
pub(crate) fn set_stand(phrase: Vec<String>, fill: Vec<String>) {
    let mut s = STAND.lock().unwrap();
    s.phrase = phrase;
    s.fill = fill;
}

/// Feature 33: stand down, by the shortcut or the phrase. The page stops what it plays and clears the screen now,
/// without waiting for the sidecar; the sidecar stops the rest; the microphone closes. The sidecar is told before the
/// microphone closes, so it has stood down before it hears that the take was cancelled.
pub(crate) fn stand_down(app: &AppHandle, by: &str) {
    STAND.lock().unwrap().fired = true;
    to_overlays(app, &json!({ "kind": "stand", "on": true, "clear": true }));
    to_sidecar(app, &json!({ "type": "stand_down", "by": by }));
    cancel_voice(app);
}

/// Feature 33: what has been heard so far in this take. When it is the phrase alone, it counts once nothing more has
/// been heard for STAND_SETTLE_MS: words that go on past it (the phrase opening a longer sentence) do nothing.
fn stand_heard(app: &AppHandle, text: &str) {
    let gen = {
        let mut s = STAND.lock().unwrap();
        s.gen += 1;
        if s.fired || !crate::stand::matches(text, &s.phrase, &s.fill) {
            return;
        }
        s.gen
    };
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(STAND_SETTLE_MS));
        let app2 = app.clone();
        let _ = app.run_on_main_thread(move || {
            let go = {
                let s = STAND.lock().unwrap();
                s.gen == gen && !s.fired
            };
            if go {
                stand_down(&app2, "phrase");
            }
        });
    });
}

fn handle_voice(app: &AppHandle, msg: Value) {
    let mut ui = msg.clone();
    ui["kind"] = json!("voice");
    if msg.get("type").and_then(Value::as_str) == Some("buddy") {
        to_sidekick_buddy(app, &msg);
        return;
    }
    // A click in another app while a drawing is up (see watch_clicks); not one on Roamies' own cards.
    if msg.get("type").and_then(Value::as_str) == Some("click") {
        if !crate::OVERLAY_HOT.load(Ordering::Relaxed) {
            to_sidecar(app, &json!({ "type": "user_click", "x": msg.get("x"), "y": msg.get("y"), "role": msg.get("role"), "app": msg.get("app"), "acts": msg.get("acts") }));
        }
        return;
    }
    if msg.get("type").and_then(Value::as_str) == Some("ready") {
        app.state::<Voice>().1.store(0, Ordering::Relaxed);
        return;
    }
    // Windows: the pen trail while circling something (voice-win/src/ink.rs); the overlays draw it, also during setup.
    if msg.get("type").and_then(Value::as_str) == Some("ink") {
        to_overlays(app, &ui);
        return;
    }
    // While the setup guide is open, talking is just the "try it" test: it never reaches the agent.
    if ONBOARDING.load(Ordering::Relaxed) {
        // Nothing answers here, so the listening pill goes as soon as the words are in.
        if msg.get("type").and_then(Value::as_str) == Some("final") {
            to_voice(app, &json!({ "cmd": "handoff" }));
        }
        to_onboarding(app, &ui);
        return;
    }
    match msg.get("type").and_then(Value::as_str) {
        Some("state") => {
            // Feature 33: a new take (or an answer window reopened for the next phrase) starts afresh.
            if msg.get("state").and_then(Value::as_str) == Some("listening") {
                let mut s = STAND.lock().unwrap();
                s.gen += 1;
                s.fired = false;
            }
            to_overlays(app, &ui);
            // Local-only build: "window" is the answer window the session belongs to (none for a key press).
            to_sidecar(app, &json!({ "type": "voice_state", "state": msg.get("state"), "window": msg.get("window") }));
        }
        Some("partial") => {
            to_overlays(app, &ui);
            stand_heard(app, msg.get("text").and_then(Value::as_str).unwrap_or(""));
        }
        Some("level") => to_overlays(app, &ui),
        Some("final") => {
            // Feature 33: the take that stood Roamies down, or the phrase alone in the final words: they go nowhere.
            let text = msg.get("text").and_then(Value::as_str).unwrap_or("");
            let (fired, phrase) = {
                let mut s = STAND.lock().unwrap();
                s.gen += 1;
                (s.fired, crate::stand::matches(text, &s.phrase, &s.fill))
            };
            if fired {
                return;
            }
            if phrase {
                stand_down(app, "phrase");
                return;
            }
            to_overlays(app, &ui);
            // area: the part of the screen marked with the pen while talking (a PNG, its rect and the strokes).
            to_sidecar(app, &json!({ "type": "voice", "text": msg.get("text"), "area": msg.get("area"), "ms": msg.get("ms"), "via": msg.get("via"), "window": msg.get("window") }));
        }
        Some("error") => {
            let mut m = msg.clone();
            m["type"] = json!("voice_error");
            to_sidecar(app, &m);
        }
        _ => {}
    }
}
