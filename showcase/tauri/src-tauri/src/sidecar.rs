// The Node sidecar (the agent): finding Node, starting it and reading its messages.

use super::*;
use std::io::{BufRead, BufReader};

/// Local-only build: switches that exist only for tests (CLAUDE.md: no test-only switch may be reachable in the installed app). The
/// shell takes them out of the environment of every process it starts (the sidecar, and through it pi and the
/// hands helper; the voice helper; the hands helper's one-shot checks), so only a test that starts the sidecar or a
/// helper itself can set them. ROAMIES_FAKE_CLAUDE puts a module in the claude program's place (mask-cc-run);
/// ROAMIES_COMPACT_AT folds the conversation early; ROAMIES_THINKING and ROAMIES_USAGE are for measuring (the second
/// writes tool calls to the log); ROAMIES_VOICE_DRYRUN(_TEXT) make the voice helper "hear" a given text.
pub(crate) const TEST_ONLY_ENV: &[&str] =
    &["ROAMIES_FAKE_CLAUDE", "ROAMIES_COMPACT_AT", "ROAMIES_THINKING", "ROAMIES_USAGE", "ROAMIES_VOICE_DRYRUN", "ROAMIES_VOICE_DRYRUN_TEXT"];
/// Cleared in release builds only: the Linux smoke test in CI runs the debug app in a throwaway data folder.
/// ROAMIES_DATA_DIR moves all of Roamies' data and keeps the keys in a plain test file instead of the keychain.
pub(crate) const RELEASE_CLEARS: &[&str] = &["ROAMIES_DATA_DIR"];
/// Set by the shell on Linux only; elsewhere an inherited value is taken out.
const LINUX_ONLY_ENV: &[&str] = &["ROAMIES_SESSION", "ROAMIES_LAUNCH"];
/// Local-only build (the owner, 2026-11-27 19:01): variables that load code, redirect or intercept traffic, or log
/// requests, taken out for the sidecar and every helper. ROAMIES_BG turned background mode off for opening apps and
/// the hands helpers; it had no setting, so background mode is now always on.
pub(crate) const CLEARED_ENV: &[&str] = &[
    "NODE_OPTIONS",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
    "http_proxy", "https_proxy", "all_proxy", "no_proxy",
    "NODE_EXTRA_CA_CERTS", "NODE_TLS_REJECT_UNAUTHORIZED", "SSL_CERT_FILE", "SSL_CERT_DIR",
    "ROAMIES_BG",
];
/// Every variable starting with one of these, in any case: the API keys, addresses, headers and logging the
/// Anthropic and OpenAI libraries read.
pub(crate) const CLEARED_PREFIXES: &[&str] = &["ANTHROPIC_", "OPENAI_"];

/// What every process the shell starts loses from the shell's own environment: the test switches, the traffic
/// redirects, and (outside Linux) the Linux-only values.
pub(crate) fn clean_env(cmd: &mut Command) -> &mut Command {
    for k in TEST_ONLY_ENV.iter().chain(CLEARED_ENV) {
        cmd.env_remove(k);
    }
    for (k, _) in std::env::vars_os() {
        let name = k.to_string_lossy().to_ascii_uppercase();
        if CLEARED_PREFIXES.iter().any(|p| name.starts_with(p)) {
            cmd.env_remove(&k);
        }
    }
    if !cfg!(debug_assertions) {
        for k in RELEASE_CLEARS {
            cmd.env_remove(k);
        }
    }
    if !cfg!(target_os = "linux") {
        for k in LINUX_ONLY_ENV {
            cmd.env_remove(k);
        }
    }
    cmd
}

/// The sidecar's command: Node, the script, what the shell sets, and clean_env's variables taken out.
fn sidecar_command(node: &std::path::Path, script: &std::path::Path, version: &str, hands: &str) -> Command {
    let mut cmd = Command::new(node);
    hide_console(&mut cmd);
    cmd.arg(script).env("ROAMIES_VERSION", version).env("ROAMIES_HANDS", hands);
    // Linux: "x11" or "wayland", for what the sidecar offers and how it words things (platform.mjs).
    #[cfg(target_os = "linux")]
    cmd.env("ROAMIES_SESSION", crate::linux::session().name()).env("ROAMIES_LAUNCH", crate::linux::launch_command());
    clean_env(&mut cmd);
    cmd
}

fn find_node() -> Option<PathBuf> {
    // Local-only build: debug builds only, another program in the sidecar's place (bench/realrun.sh starts bench/relay.mjs this way).
    #[cfg(debug_assertions)]
    if let Ok(p) = std::env::var("ROAMIES_NODE") {
        return Some(PathBuf::from(p));
    }
    // The Node.js shipped inside the app (bundle.externalBin), so users don't need Node installed.
    if let Some(p) = helper_binary("node") {
        return Some(p);
    }
    // GUI apps don't get the shell's PATH on macOS, so check the usual installs too.
    let exe = if cfg!(windows) { "node.exe" } else { "node" };
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    for d in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "C:\\Program Files\\nodejs"] {
        dirs.push(PathBuf::from(d));
    }
    dirs.into_iter().map(|d| d.join(exe)).find(|p| p.is_file())
}

fn sidecar_script(app: &AppHandle) -> Option<PathBuf> {
    let bundled = app.path().resource_dir().map(|d| d.join("sidecar").join("sidekick.mjs"));
    match bundled {
        Ok(p) if p.is_file() => Some(p),
        #[cfg(debug_assertions)]
        _ => Some(PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../sidecar/sidekick.mjs"))),
        #[cfg(not(debug_assertions))]
        _ => None,
    }
}

// Set once the app is quitting: the sidecar then exits on purpose and must not be restarted.
pub(crate) static QUITTING: AtomicBool = AtomicBool::new(false);
// Bumped per spawn, so a process replaced by a manual restart doesn't trigger an automatic one.
static GENERATION: AtomicUsize = AtomicUsize::new(0);
static CRASHES: Mutex<Vec<Instant>> = Mutex::new(Vec::new());
const BACKOFF_SECS: [u64; 3] = [1, 3, 10];

pub(crate) fn spawn_sidecar(app: &AppHandle) {
    let Some(node) = find_node() else {
        fallback_menu(app, "Roamies is missing a part; reinstall it");
        return;
    };
    let Some(script) = sidecar_script(app) else {
        fallback_menu(app, "Roamies is missing a part; reinstall it");
        return;
    };
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let stderr = log_stdio("sidekick.log");
    let hands = helper_binary("roamies-hands").map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    let mut cmd = sidecar_command(&node, &script, &app.package_info().version.to_string(), &hands);
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(stderr);
    if let Some(dir) = script.parent() {
        cmd.current_dir(dir);
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            fallback_menu(app, &format!("Roamies failed to start: {e}"));
            return;
        }
    };
    // Local-only build (feature 24, fix 4): its input is written by a thread of its own (pipe.rs).
    *app.state::<Sidecar>().0.lock().unwrap() = child.stdin.take().map(|i| PipeWriter::new(i, "sidecar"));
    let stdout = child.stdout.take().expect("piped stdout");
    let app = app.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
            let app2 = app.clone();
            let _ = app.run_on_main_thread(move || handle_sidecar(&app2, msg));
        }
        let _ = child.wait();
        *app.state::<Sidecar>().0.lock().unwrap() = None;
        if QUITTING.load(Ordering::SeqCst) || GENERATION.load(Ordering::SeqCst) != generation {
            return;
        }
        let attempt = {
            let mut crashes = CRASHES.lock().unwrap();
            crashes.retain(|t| t.elapsed() < Duration::from_secs(300));
            crashes.push(Instant::now());
            crashes.len()
        };
        let app2 = app.clone();
        if attempt > BACKOFF_SECS.len() {
            let _ = app.run_on_main_thread(move || fallback_menu(&app2, "Roamies stopped"));
            return;
        }
        thread::sleep(Duration::from_secs(BACKOFF_SECS[attempt - 1]));
        if QUITTING.load(Ordering::SeqCst) || GENERATION.load(Ordering::SeqCst) != generation {
            return;
        }
        let _ = app.run_on_main_thread(move || spawn_sidecar(&app2));
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    // The shell takes the test switches out of the sidecar's environment: what the started process sees.
    #[cfg(unix)]
    #[test]
    fn the_shell_clears_test_switches_and_redirects_for_the_sidecar() {
        for k in TEST_ONLY_ENV.iter().chain(RELEASE_CLEARS).chain(LINUX_ONLY_ENV) {
            std::env::set_var(k, "/tmp/roamies-test-switch.mjs");
        }
        for k in CLEARED_ENV {
            std::env::set_var(k, "http://proxy.example:8080");
        }
        let prefixed = ["ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "ANTHROPIC_LOG", "ANTHROPIC_CUSTOM_HEADERS", "OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_LOG", "OPENAI_ORG_ID", "anthropic_lowercase"];
        for k in prefixed {
            std::env::set_var(k, "http://elsewhere.example");
        }
        std::env::set_var("ROAMIES_SAY_VOICE", "Daniel");
        std::env::set_var("ROAMIES_ANTHROPIC_NOTE", "kept");
        // `env env` prints the environment it was given: the sidecar's command with env in Node's and the script's place.
        let env = std::path::Path::new("/usr/bin/env");
        let out = sidecar_command(env, env, "9.9.9", "/x/roamies-hands").output().expect("env runs");
        let seen = String::from_utf8_lossy(&out.stdout).into_owned();
        let has = |k: &str| seen.lines().any(|l| l.starts_with(&format!("{k}=")));
        for k in TEST_ONLY_ENV {
            assert!(!has(k), "{k} reached the sidecar");
        }
        assert!(!has("ROAMIES_FAKE_CLAUDE"));
        for k in CLEARED_ENV.iter().chain(&prefixed) {
            assert!(!has(k), "{k} reached the sidecar");
        }
        assert!(!seen.lines().any(|l| { let u = l.to_ascii_uppercase(); u.starts_with("ANTHROPIC_") || u.starts_with("OPENAI_") }));
        assert!(has("ROAMIES_ANTHROPIC_NOTE"), "only names that start with the prefix go");
        assert_eq!(has("ROAMIES_DATA_DIR"), cfg!(debug_assertions), "ROAMIES_DATA_DIR: debug builds only");
        for k in LINUX_ONLY_ENV {
            assert_eq!(has(k), cfg!(target_os = "linux"), "{k}: Linux only, set by the shell");
        }
        assert!(seen.lines().any(|l| l == "ROAMIES_VERSION=9.9.9") && seen.lines().any(|l| l == "ROAMIES_HANDS=/x/roamies-hands"));
        assert!(seen.lines().any(|l| l == "ROAMIES_SAY_VOICE=Daniel"), "the rest passes through");
        // The helpers the shell starts go through the same function.
        let out = clean_env(&mut Command::new(env)).output().expect("env runs");
        let seen = String::from_utf8_lossy(&out.stdout).into_owned();
        for k in TEST_ONLY_ENV.iter().chain(CLEARED_ENV).chain(&prefixed) {
            assert!(!seen.lines().any(|l| l.starts_with(&format!("{k}="))), "{k} reached a helper");
        }
        for k in TEST_ONLY_ENV.iter().chain(RELEASE_CLEARS).chain(LINUX_ONLY_ENV).chain(CLEARED_ENV).chain(&prefixed) {
            std::env::remove_var(k);
        }
        std::env::remove_var("ROAMIES_SAY_VOICE");
        std::env::remove_var("ROAMIES_ANTHROPIC_NOTE");
    }

    // Every process the shell starts from one of Roamies' own programs goes through clean_env.
    #[test]
    fn every_helper_start_goes_through_clean_env() {
        let src = |f: &str| std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src").join(f)).unwrap();
        for (file, starts) in [("main.rs", 4), ("voice.rs", 1)] {
            let text = src(file);
            let cleared = text.matches("clean_env(").count();
            let all = text.matches("Command::new(bin)").count();
            assert_eq!((cleared, all), (starts, starts), "{file}: every Command::new(bin) goes through clean_env");
        }
    }
}
