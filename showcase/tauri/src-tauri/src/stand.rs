// Local-only build, feature 33: the stand-down phrase, matched on what the voice helper has heard so far. The twin of
// isStandDown in sidecar/standdown.mjs; both are checked against one table (sidecar/test/stand-phrases.json).
// Pure: no state and no I/O, so it is tested without a microphone.

/// The words of what was heard, as they are compared: lower case, apostrophes dropped, split on anything that is not a
/// letter or a digit.
pub fn words(text: &str) -> Vec<String> {
    let flat: String = text.chars().filter(|c| !matches!(c, '\'' | '’' | '`')).flat_map(char::to_lowercase).collect();
    flat.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(str::to_owned).collect()
}

/// Whether what was heard is the phrase alone: the phrase, once or more, and nothing else but the small words (fill).
pub fn matches(text: &str, phrase: &[String], fill: &[String]) -> bool {
    if phrase.is_empty() {
        return false;
    }
    let w = words(text);
    let (mut i, mut found) = (0, false);
    while i < w.len() {
        if w[i..].starts_with(phrase) {
            found = true;
            i += phrase.len();
        } else if fill.contains(&w[i]) {
            i += 1;
        } else {
            return false;
        }
    }
    found
}

/// How long the phrase must have been all that was heard, with nothing more said, before it counts, until the sidecar
/// sends "standDown.waitSeconds" (sidecar/pi.mjs, STAND_DOWN.waitSeconds: its default and bounds).
pub const WAIT_MS: u64 = 1500;
pub const WAIT_MIN_MS: u64 = 500;
pub const WAIT_MAX_MS: u64 = 3000;

/// The wait in milliseconds, for a wait in seconds as the sidecar sends it; missing or out of bounds: the default.
pub fn wait_ms(wait_seconds: Option<f64>) -> u64 {
    match wait_seconds.filter(|w| w.is_finite()).map(|w| (w * 1000.0).round()) {
        Some(ms) if ms >= WAIT_MIN_MS as f64 && ms <= WAIT_MAX_MS as f64 => ms as u64,
        _ => WAIT_MS,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn list(v: &Value, key: &str) -> Vec<String> {
        v[key].as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_owned()).collect()
    }

    #[test]
    fn the_shared_table() {
        let t: Value = serde_json::from_str(include_str!("../../sidecar/test/stand-phrases.json")).unwrap();
        let phrase = words(t["phrase"].as_str().unwrap());
        let fill = list(&t, "fill");
        for s in list(&t, "fires") {
            assert!(matches(&s, &phrase, &fill), "fires: {s}");
        }
        for s in list(&t, "quiet") {
            assert!(!matches(&s, &phrase, &fill), "does nothing: {s}");
        }
    }

    #[test]
    fn words_as_the_sidecar_has_them() {
        assert_eq!(words("Stand-down, JARVIS!"), ["stand", "down", "jarvis"]);
        assert_eq!(words("ma'am"), ["maam"]);
        assert!(words("  ... ").is_empty());
        assert!(!matches("stand down", &[], &[]));
    }

    #[test]
    fn the_wait() {
        assert_eq!(wait_ms(Some(1.5)), 1500);
        assert_eq!(wait_ms(Some(0.5)), 500);
        assert_eq!(wait_ms(Some(3.0)), 3000);
        assert_eq!(wait_ms(Some(2.25)), 2250);
        for out in [None, Some(0.4), Some(3.1), Some(f64::NAN), Some(f64::INFINITY), Some(-1.0)] {
            assert_eq!(wait_ms(out), WAIT_MS, "{out:?}");
        }
    }
}
