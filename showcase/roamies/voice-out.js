// Plays spoken replies: 16-bit mono PCM chunks from the brain (the Mac's voice or the natural one), scheduled back to back so a
// reply plays without gaps or clicks. A new reply's id replaces the old one at once; "stop" fades out fast.
// level() is the live loudness, for the body to move with the voice.
(() => {
  const R = window.Roamie;
  const LEAD = 0.12; // cushion before a reply's first chunk, so the next chunk is never late
  let ac = null, out = null, meter = null, buf = null, id = null, endAt = 0, live = [], lv = 0;
  const all = new Set(); // local-only build: every buffer that hasn't ended yet, the ones being faded out by stop() included
  // How fast the voice talks (characters a second), learned from each whole reply: its audio length against how much
  // text it said. Drawings pace their marks to it (ink.js).
  let rate = 15, secs = 0;
  // Replies that are over: their end arrived, or they were stopped or replaced (auto-listen waits for this).
  const over = new Set();
  const isOver = (x) => { over.add(x); if (over.size > 20) over.delete(over.values().next().value); };
  // Local-only build: marks. A mark asks "tell me when everything handed over so far has finished playing". It is
  // answered from the player itself: when every buffer that was scheduled at that moment has ended (its own
  // "ended" event, also when it was stopped), and the output has then stayed silent for the device's reported
  // delay plus a margin. The sidecar opens the microphone only on that answer.
  const QUIET = 0.4; // seconds of silence after the last sample, at least
  const marks = [];
  const settle = () => {
    for (const mk of marks) {
      if (mk.srcs.size || mk.t) continue;
      const wait = Math.max(QUIET, (ac?.outputLatency || 0) + (ac?.baseLatency || 0) + 0.25);
      mk.t = setTimeout(() => { marks.splice(marks.indexOf(mk), 1); R.voiceOut.onMark?.(mk.n); }, wait * 1000);
    }
  };

  const ctx = () => {
    if (!ac) {
      // The Mac's voice sends 44.1 kHz; a context at the same rate avoids resampling its chunks (older WebKit can't set it).
      try { ac = new AudioContext({ sampleRate: 44100, latencyHint: 'interactive' }); } catch { ac = new AudioContext({ latencyHint: 'interactive' }); }
      out = ac.createGain();
      meter = ac.createAnalyser(); meter.fftSize = 512; buf = new Float32Array(meter.fftSize);
      out.connect(meter); meter.connect(ac.destination);
    }
    if (ac.state !== 'running') ac.resume();
    return ac;
  };

  const pcm = (b64, rate) => {
    const raw = atob(b64), n = raw.length >> 1, f = new Float32Array(n);
    for (let i = 0; i < n; i++) { let v = raw.charCodeAt(2 * i) | (raw.charCodeAt(2 * i + 1) << 8); if (v > 32767) v -= 65536; f[i] = v / 32768; }
    const b = ac.createBuffer(1, Math.max(1, n), rate);
    b.getChannelData(0).set(f);
    return b;
  };

  const stop = () => {
    if (id) isOver(id);
    id = null; endAt = 0;
    if (!ac || !live.length) return;
    const t = ac.currentTime, old = live; live = [];
    out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(out.gain.value, t); out.gain.linearRampToValueAtTime(0, t + 0.04);
    for (const s of old) { try { s.stop(t + 0.05); } catch { /* not started */ } }
    // Local-only build: stopped buffers are silent 50 ms from now whether or not their "ended" event comes.
    setTimeout(() => { for (const s of old) { all.delete(s); for (const mk of marks) mk.srcs.delete(s); } settle(); }, 150);
  };

  const play = (m) => {
    const a = ctx();
    const first = m.id !== id;
    if (first) { stop(); id = m.id; secs = 0; }
    const b = pcm(m.pcm, m.rate || 44100), s = a.createBufferSource();
    s.buffer = b; s.connect(out);
    const now = a.currentTime;
    if (!live.length) { out.gain.cancelScheduledValues(now); out.gain.setValueAtTime(1, now); }
    const at = Math.max(endAt, now + LEAD);
    s.start(at); endAt = at + b.duration; secs += b.duration;
    // Local-only build (feature 23): when a reply's first sound plays, for the sidecar's timing (measureRequests).
    if (first) setTimeout(() => R.voiceOut.onFirst?.(m.id), Math.max(0, (at - now) * 1000 + ((a.outputLatency || 0) + (a.baseLatency || 0)) * 1000));
    live.push(s);
    s.onended = () => { live = live.filter((x) => x !== s); for (const mk of marks) mk.srcs.delete(s); settle(); };
    all.add(s); s.addEventListener('ended', () => all.delete(s));
  };

  R.voiceOut = {
    handle(m) {
      if (m.stop) return stop();
      if (m.mark) { marks.push({ n: m.mark, srcs: new Set(all), t: null }); return settle(); }
      if (m.end) { // the last chunk is already scheduled
        isOver(m.id);
        if (m.id === id && m.chars > 20 && secs > 1) rate = Math.min(30, Math.max(8, rate * 0.6 + (m.chars / secs) * 0.4));
        return;
      }
      if (m.pcm) play(m);
    },
    playing: () => !!ac && live.length > 0 && ac.currentTime < endAt + 0.05,
    cps: () => rate,
    // That reply has nothing left to play: its end arrived (or it was stopped), and nothing is still sounding.
    finished(rid) { return !this.playing() && (!rid || over.has(rid)); },
    // Smoothed RMS, roughly 0 (quiet) to 1 (loud speech).
    level() {
      if (!this.playing()) return (lv = 0);
      meter.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const v = Math.min(1, Math.sqrt(sum / buf.length) * 4);
      return (lv += (v - lv) * (v > lv ? 0.5 : 0.15));
    },
    stop,
  };
})();
