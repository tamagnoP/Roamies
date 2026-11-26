// Local-only build, feature 23 (stage 5): measuring, off by default ("measureRequests"). Per request, from the end of
// his speech to the first word spoken back: hearing (the end of speech to the words), getting ready (the words to the
// request going out), the reading of the prompt (to the first word of the reply), and the voice (that word to the
// first sound played); with the whole reply's time, the tokens, the tools called and the route. And memory, read by
// the shell (memory.rs): each process of Roamies' and the Mac's memory pressure and swap. Numbers and tool names
// only, in the activity log; nothing at all when it is off.

/** The memory reading as the log gets it: each process by its role, in MB. roles: { pid: role } that the sidecar
 *  knows (itself, Kokoro, the model server); the shell is the first process, the voice helper a child of the shell
 *  that isn't the sidecar, WebKit what macOS holds the app responsible for. */
export function memoryLine(m, roles = {}) {
  const procs = Array.isArray(m?.processes) ? m.processes : [], shell = procs[0];
  const role = (p) => roles[p.pid] ?? (p === shell ? 'shell' : p.parent === shell?.pid ? (/voice/i.test(p.name) ? 'voice' : 'child') : 'other');
  const by = {};
  for (const p of procs) { const r = role(p); if (typeof p.mb === 'number') by[r] = Math.round(((by[r] ?? 0) + p.mb) * 10) / 10; }
  const web = (m?.webkit ?? []).filter((p) => typeof p.mb === 'number');
  if (web.length) by.webkit = Math.round(web.reduce((a, p) => a + p.mb, 0) * 10) / 10;
  return { mb: by, processes: procs.length + web.length, pressure: m?.pressure ?? null, swapMB: m?.swapMB ?? null };
}

/** on(): measureRequests; log(kind, data); now(); askMemory(): the shell is asked (its answer comes to memory()). */
export function createTiming({ on = () => false, log = () => {}, now = () => Date.now(), askMemory = () => {}, roles = () => ({}), memoryEverySeconds = 60, soundWaitMs = 8000, timers = { set: setTimeout, clear: clearTimeout } } = {}) {
  let t = null, lastMemory = -Infinity;
  const mark = (k) => { if (t && t[k] == null) t[k] = now(); };
  // A request that is over and waits for its first sound is written before the next one starts.
  const flush = () => { if (t?.meta) self.finish(t.meta); };
  const self = {
    /** The shell says he stopped talking (the voice state turned to processing). */
    speechEnd() { flush(); if (!on()) { t = null; return; } t = { speechEnd: now() }; },
    heard() { if (!on()) return; flush(); if (!t || t.heard != null) t = {}; mark('heard'); }, // spoken: after speechEnd; typed: a new one
    sent() { mark('sent'); },
    firstText() { mark('firstText'); },
    replied() { mark('replied'); },
    firstSound() { mark('firstSound'); if (t?.meta) self.finish(t.meta); },
    /** The request is over: its line is written once its first sound has played, or soundWaitMs on. */
    done(meta = {}) {
      if (!on() || !t) { t = null; return; }
      t.meta = meta;
      if (t.firstSound != null) { self.finish(meta); return; }
      const mine = t;
      mine.timer = timers.set(() => { if (t === mine) self.finish(meta); }, soundWaitMs);
    },
    /** One line, numbers and tool names only. */
    finish({ route = 'claude', tools = [], tokens = null } = {}) {
      if (t?.timer) timers.clear(t.timer);
      if (!on() || !t) { t = null; return null; }
      const d = (a, b) => (t[a] != null && t[b] != null ? t[b] - t[a] : null);
      const line = { route, hearing: d('speechEnd', 'heard'), ready: d('heard', 'sent'), reading: d('sent', 'firstText'), voice: d('firstText', 'firstSound'), toFirstSound: d('speechEnd', 'firstSound'), reply: d('firstText', 'replied'), tools: [...tools].slice(0, 20).map((x) => String(x).slice(0, 40)), ...(tokens ? { tokens } : {}) };
      log('timing', line);
      t = null;
      if (now() - lastMemory >= memoryEverySeconds * 1000) { lastMemory = now(); try { askMemory(); } catch { /* not measured */ } }
      return line;
    },
    /** The shell's memory reading. */
    memory(m) { if (!on()) return null; const line = memoryLine(m, roles()); log('memory', line); return line; },
    pending: () => !!t,
  };
  return self;
}
