// Local-only build (feature 24, fix 4): what goes to a helper's input pipe (the sidecar's, the voice helper's) is
// written by a thread of its own. The thread that hands a line over, most often the app's main thread, which also
// answers a request to quit, never waits on a helper that has stopped reading: before, a full pipe held it, with the
// helper's lock taken, for as long as the helper didn't read.

use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::thread;

/// Lines that may wait to be written. A helper that has read none of them by then gets no more until it does: the
/// lines past this are dropped, not waited for.
pub(crate) const QUEUE: usize = 4096;

pub(crate) struct PipeWriter {
    tx: SyncSender<String>,
    name: &'static str,
    warned: AtomicBool,
}

impl PipeWriter {
    /// Takes over a helper's input; name is for the log.
    pub(crate) fn new<W: Write + Send + 'static>(mut input: W, name: &'static str) -> Self {
        let (tx, rx) = sync_channel::<String>(QUEUE);
        let spawned = thread::Builder::new().name(format!("{name} input")).spawn(move || {
            for line in rx {
                if input.write_all(line.as_bytes()).and_then(|()| input.flush()).is_err() {
                    break; // the helper has gone: what is left is dropped with the channel
                }
            }
        });
        if let Err(e) = spawned {
            eprintln!("{name}: no thread to write its input ({e})");
        }
        Self { tx, name, warned: AtomicBool::new(false) }
    }

    /// Hands one line over (a newline is added) and returns at once. → false when it was dropped: the helper is
    /// QUEUE lines behind, or has gone.
    pub(crate) fn send(&self, line: String) -> bool {
        match self.tx.try_send(line + "\n") {
            Ok(()) => true,
            Err(TrySendError::Full(_)) => {
                if !self.warned.swap(true, Ordering::Relaxed) {
                    eprintln!("{}: it has stopped reading; lines for it are dropped until it reads again", self.name);
                }
                false
            }
            Err(TrySendError::Disconnected(_)) => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::time::{Duration, Instant};

    const LINE: usize = 100;
    /// 100 kB in lines of 100 bytes, as the shell sends them: one JSON message a line.
    fn lines() -> impl Iterator<Item = String> {
        (0..1000).map(|i| format!("{{\"type\":\"voice\",\"n\":{i:5},\"pad\":\"{}\"}}", "x".repeat(LINE - 33)))
    }

    #[test]
    fn a_helper_that_never_reads_holds_nobody_up() {
        // The helper's input, never read: its pipe holds 16 to 64 kB.
        let (reader, writer) = std::io::pipe().unwrap();
        // Before: the line written straight into the pipe, as to_sidecar and to_voice did. 100 kB never gets through.
        let (reader2, mut direct) = std::io::pipe().unwrap();
        let blocked = thread::spawn(move || {
            for l in lines() {
                let _ = writeln!(direct, "{l}");
            }
        });
        thread::sleep(Duration::from_millis(500));
        assert!(!blocked.is_finished(), "a direct write of 100 kB to a pipe nobody reads waits for good");

        // Now: the same 100 kB handed to the writer by a thread standing in for the main one, which then answers
        // the quit. It does, at once; every line was taken without waiting.
        let w = std::sync::Arc::new(PipeWriter::new(writer, "test helper"));
        let w2 = w.clone();
        let t = Instant::now();
        let main = thread::spawn(move || {
            let mut slowest = Duration::ZERO;
            for l in lines() {
                let one = Instant::now();
                assert!(w2.send(l), "taken");
                slowest = slowest.max(one.elapsed());
            }
            (slowest, "quit answered")
        });
        while !main.is_finished() && t.elapsed() < Duration::from_secs(2) {
            thread::sleep(Duration::from_millis(5));
        }
        assert!(main.is_finished(), "the quit is answered within two seconds");
        let (slowest, answer) = main.join().unwrap();
        assert_eq!(answer, "quit answered");
        assert!(t.elapsed() < Duration::from_millis(200), "100 kB handed over and the quit answered in {:?}", t.elapsed());
        assert!(slowest < Duration::from_millis(20), "no line waited ({slowest:?})");
        // A helper QUEUE lines behind: what comes after is dropped, still without waiting.
        let t = Instant::now();
        let dropped = (0..QUEUE + 10).filter(|i| !w.send(format!("{{\"n\":{i}}}"))).count();
        assert!(dropped > 0, "past the queue, lines are dropped");
        assert!(t.elapsed() < Duration::from_millis(500), "and dropping waits for nothing ({:?})", t.elapsed());
        drop((reader, reader2));
    }

    #[test]
    fn every_line_arrives_whole_and_in_order() {
        let (mut reader, writer) = std::io::pipe().unwrap();
        let w = PipeWriter::new(writer, "test helper");
        let sent: Vec<String> = lines().collect();
        let all = thread::spawn(move || {
            let mut got = String::new();
            reader.read_to_string(&mut got).unwrap();
            got
        });
        for l in &sent {
            assert!(w.send(l.clone()));
        }
        drop(w); // the app lets go of the helper: its input closes once the lines before have gone
        let got = all.join().unwrap();
        assert_eq!(got.lines().collect::<Vec<_>>(), sent.iter().map(String::as_str).collect::<Vec<_>>());
    }

    #[test]
    fn a_helper_that_has_gone_costs_nothing() {
        let (reader, writer) = std::io::pipe().unwrap();
        drop(reader);
        let w = PipeWriter::new(writer, "test helper");
        let t = Instant::now();
        for l in lines() {
            w.send(l);
        }
        assert!(t.elapsed() < Duration::from_millis(200));
        thread::sleep(Duration::from_millis(100));
        assert!(!w.send("after".into()), "once the writer has seen it gone, lines are refused");
    }
}
