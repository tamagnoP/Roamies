// Local-only build (feature 16): the natural voice. Kokoro runs in one helper process that Roamies starts itself and
// keeps loaded: the Python named under "kokoro" in settings.json, running kokoro_server.py (shipped beside this file).
// - No port. Sentences go in on the helper's standard input, one JSON line each; audio comes back on its standard
//   output as framed blocks (see kokoro_server.py). Its error stream is thrown away: nothing it prints is ever logged.
// - No network. The helper runs under sandbox-exec with every kind of network denied, and with the libraries'
//   offline switches set. It may write only in a private temporary folder, and in the home folder it may read only
//   the model's own files (and its Python, if that lives in the home folder).
// - The Python is used only if it is a full path to a program that exists. It is started directly, never through a
//   shell, with a fixed list of arguments; what is to be said is never among them.
// - If the helper can't start, dies, answers wrongly or takes too long, it is marked down for the session: one bubble
//   says so (onDown), and every sentence from then on, the one in hand included, is spoken by the macOS voice.
// - KokoroVoice is LocalVoice with one step replaced (a sentence → audio). The queue, the marks and the cutting are
//   the same code, so "everything before this mark has been handed over" means what it meant before.
// - Feature 24: after "kokoro.sleepAfterMinutes" without a sentence (0: never) the helper is ended to give its memory
//   back, and started again when sidecar.mjs wakes it (the talk key, an answer window, a spoken request, shortly
//   before a briefing). Asleep or waking, replies are spoken by the macOS voice; a reply keeps the voice it started
//   with to its end, and the helper never sleeps while a reply in its voice is open. No bubble either way.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalVoice, spoken } from './localvoice.mjs';

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
export const SCRIPT = 'kokoro_server.py';
/** Set for the helper: the libraries look for nothing online. */
export const OFFLINE = { HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_DATASETS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', HF_HUB_DISABLE_IMPLICIT_TOKEN: '1', DO_NOT_TRACK: '1', NO_PROXY: '*' };
export const START_FACTOR = 6; // the helper may take this many sentence time limits to load the model
export const QUIT_KILL_MS = 2000; // after its input is closed at quit, the helper is killed if it is still there
export const SLEEP_CHECK_MS = 30_000; // feature 24: how often the helper's quiet time is looked at
export const WAKE_BEFORE_BRIEFING_MINUTES = 2; // feature 24: sidekick.mjs wakes it this long before a briefing is due
// A failure's kind as the helper names it: one word (a Python error's class name). Anything else is not passed on,
// so no sentence can travel in a failure message.
const kindOf = (e) => (typeof e === 'string' && /^[A-Za-z]{1,40}$/.test(e) ? e : 'Error');
const MAX_BLOCK = 64 * 1024 * 1024, MAX_HEADER = 4096;

/** The helper's whole environment: nothing is passed on from Roamies' own (no proxy settings, no tokens). */
export function helperEnv({ home, tmp, hub }) {
  return { PATH: '/usr/bin:/bin', HOME: home, TMPDIR: tmp, LANG: 'en_US.UTF-8', PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1', HF_HUB_CACHE: hub, ...OFFLINE };
}

/** Why the Python under "kokoro.python" can't be used, or '' when it can: a full path to a program that exists. */
export function pythonProblem(p) {
  if (typeof p !== 'string' || !p.trim() || /[\0\n\r]/.test(p)) return 'kokoro.python is empty';
  if (!path.isAbsolute(p)) return 'kokoro.python is not a full path';
  try {
    if (!fs.statSync(p).isFile()) return 'kokoro.python is not a program';
    fs.accessSync(p, fs.constants.X_OK);
  } catch { return 'kokoro.python is not a program that exists'; }
  return '';
}

/** Where the model is on disk, and the name the helper loads it by. "owner/name" is the copy already downloaded. */
export function modelPlace(model, home) {
  const hub = path.join(home, '.cache', 'huggingface', 'hub');
  if (model.startsWith('/') || model.startsWith('~/')) { const dir = path.resolve(model.replace(/^~(?=\/)/, home)); return { hub, dir, name: dir }; }
  return { hub, dir: path.join(hub, `models--${model.split('/').join('--')}`), name: model };
}

const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const inside = (p, dir) => p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
/** Every file under the model's folder, by its real path (the download keeps the bytes in a shared store beside it). */
function modelFiles(dir) {
  const out = new Set();
  const walk = (d, depth) => {
    if (depth > 6) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else { try { const r = fs.realpathSync(p); if (fs.statSync(r).isFile()) out.add(r); } catch { /* a link to nothing */ } }
    }
  };
  walk(dir, 0);
  return [...out];
}

/** The sandbox profile the helper runs under. A later rule wins over an earlier one. */
export function kokoroProfile({ home, tmp, modelDir, python, files = modelFiles(modelDir) }) {
  const q = (p) => { if (/[\0\n\r]/.test(p)) throw new Error('a path with a line break in it'); return `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`; };
  const h = real(home), t = real(tmp), m = real(modelDir), py = real(python);
  const lit = (list) => list.map((p) => `(literal ${q(p)})`).join(' ');
  const sub = (list) => list.map((p) => `(subpath ${q(p)})`).join(' ');
  // The Python's own folder (".../envs/name"), when it is inside the home folder: by its path as written and as it resolves.
  const envs = [...new Set([path.dirname(path.dirname(path.resolve(python))), path.dirname(path.dirname(py))])].filter((p) => inside(p, h) && p !== h);
  const outside = files.filter((f) => !inside(f, m)); // the model's bytes, kept in the shared store
  const above = new Set();
  for (const p of [m, ...outside, ...envs]) for (let up = path.dirname(p); inside(up, h); up = path.dirname(up)) { above.add(up); if (up === h) break; }
  const lines = [
    '(version 1)',
    '(allow default)',
    ';; no network of any kind',
    '(deny network*)',
    ';; writing: only its own temporary folder',
    '(deny file-write* (subpath "/"))',
    `(allow file-write* (subpath ${q(t)}) (literal "/dev/null"))`,
    ';; reading in the home folder: only the model\'s own files' + (envs.length ? ' and its Python' : ''),
    `(deny file-read* (subpath ${q(h)}))`,
    ...(above.size ? [`(allow file-read-metadata ${lit([...above])})`] : []),
    `(allow file-read* ${sub([m, ...envs])})`,
    ...(outside.length ? [`(allow file-read* ${lit(outside)})`] : []),
    ';; it starts no other program',
    '(deny process-exec*)',
    `(allow process-exec* ${lit([...new Set([path.resolve(python), py])])})`,
  ];
  return `${lines.join('\n')}\n`;
}

/** A sentence longer than `max` characters, cut at clause boundaries (", ; : – —"), else between words, so each
 *  piece is made on its own and the wait for one piece stays short. */
export function splitLong(text, max) {
  const out = [];
  let rest = String(text).trim();
  while (rest.length > max) {
    const head = rest.slice(0, max + 1);
    let at = -1;
    for (const m of head.matchAll(/[,;:–—]\s/g)) if (m.index + 1 >= max * 0.3) at = m.index + 1;
    if (at < 0) at = head.lastIndexOf(' ');
    if (at <= 0) at = max; // one unbroken run of characters
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** The helper process and the one conversation with it. settings() → { kokoro, limits } as they stand now. */
export function createKokoro({ settings, home = os.homedir(), script = path.join(path.dirname(fileURLToPath(import.meta.url)), SCRIPT), spawnImpl = spawn, sandboxExec = SANDBOX_EXEC, onDown = () => {}, onReady = () => {}, log = () => {}, profileFor = kokoroProfile, tmpRoot = os.tmpdir(), now = () => Date.now(), every = (fn, ms) => { const t = setInterval(fn, ms); t.unref?.(); return t; } }) {
  let state = 'off'; // off → starting → ready (→ asleep → starting → ready …); down is final for the session
  let lastUse = now(), holds = 0; // feature 24: when a sentence was last asked for or a reply's voice let go; replies' voices open now
  let child = null, tmp = null, buf = Buffer.alloc(0), seq = 0, current = null, startTimer = null, why = '', t0 = 0, rate = 24000, profile = '';
  const waiting = []; // sentences asked for while another is being made
  // The owner, 2026-11-28: the first load of the session ("at start", not a wake from sleep), and the replies' voices
  // waiting for it (whenReady).
  let loads = 0;
  const readyWaiters = new Set();
  const settle = (ok) => { for (const w of [...readyWaiters]) w(ok); };
  const limitMs = () => { try { return settings().limits.kokoroTimeoutSeconds * 1000; } catch { return 20_000; } };
  const clean = () => { if (tmp) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } tmp = null; } };
  const kill = () => { try { child?.kill('SIGKILL'); } catch { /* already gone */ } child = null; };
  process.once('exit', () => { kill(); clean(); });

  /** Down for the session. `reason` is ours or the helper's kind of failure: it never holds what was to be said. */
  function down(reason) {
    if (state === 'down' || state === 'stopped') return;
    const was = state;
    state = 'down'; why = String(reason).slice(0, 300);
    clearTimeout(startTimer);
    kill(); clean();
    const err = new Error('The natural voice stopped.');
    if (current) { clearTimeout(current.timer); current.reject(err); current = null; }
    for (const w of waiting.splice(0)) w.reject(err);
    settle(false);
    log('kokoro_down', { reason: why, was });
    onDown(why);
  }

  // Feature 24: asleep after "kokoro.sleepAfterMinutes" with nothing asked of it and no reply's voice open. Its input
  // is closed (it ends by itself) and it is killed if it is still there shortly after, as at quit; nothing is said.
  const sleepAfterMs = () => { try { const m = settings().kokoro.sleepAfterMinutes; return Number.isFinite(m) && m > 0 ? m * 60_000 : 0; } catch { return 0; } };
  function sleep() {
    const c = child, dirWas = tmp;
    state = 'asleep'; child = null; tmp = null; buf = Buffer.alloc(0);
    log('kokoro_sleep', { quietMinutes: Math.round((now() - lastUse) / 6000) / 10 });
    if (!c) return;
    try { c.stdin.end(); } catch { /* already closed */ }
    const t = setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* gone */ } }, QUIT_KILL_MS);
    t.unref?.();
    c.once('close', () => { clearTimeout(t); try { fs.rmSync(dirWas, { recursive: true, force: true }); } catch { /* best effort */ } });
  }
  every(() => {
    const ms = sleepAfterMs();
    if (ms && state === 'ready' && !current && !waiting.length && holds === 0 && now() - lastUse >= ms) sleep();
  }, SLEEP_CHECK_MS);

  function next() {
    if (current || state !== 'ready' || !waiting.length) return;
    current = waiting.shift();
    current.timer = setTimeout(() => down('a sentence took too long'), limitMs());
    try { child.stdin.write(`${JSON.stringify({ id: current.id, text: current.text, voice: current.voice, speed: current.speed })}\n`); } catch { down('its input closed'); }
  }

  function block(head, pcm) {
    if (head.ready === true && state === 'starting') {
      state = 'ready'; rate = Number(head.rate) || 24000; clearTimeout(startTimer); lastUse = now();
      log('kokoro_ready', { ms: Date.now() - t0, rate, voices: head.voices });
      settle(true);
      onReady();
      return next();
    }
    if (head.ready === false) return down(`it couldn't load the model (${seq ? kindOf(head.error) : String(head.error ?? '').replace(/\s+/g, ' ').slice(0, 200)})`);
    if (!current || head.id !== current.id) return down('it answered out of turn');
    if (head.error) return down(head.error === 'UnknownVoice' ? `the model has no voice named ${current.voice}` : `it failed on a sentence (${kindOf(head.error)})`);
    if (!pcm.length || pcm.length % 2) return down('it sent audio I can\'t play');
    const c = current; current = null; clearTimeout(c.timer);
    c.resolve({ pcm: Buffer.from(pcm), rate: Number(head.rate) || rate });
    next();
  }

  function feed(data) {
    buf = buf.length ? Buffer.concat([buf, data]) : data;
    while (state !== 'down') {
      if (buf.length < 4) return;
      const n = buf.readUInt32BE(0);
      if (n < 2 || n > MAX_HEADER) return down('it sent something that isn\'t audio');
      if (buf.length < 4 + n) return;
      let head;
      try { head = JSON.parse(buf.subarray(4, 4 + n).toString('utf8')); } catch { return down('it sent something that isn\'t audio'); }
      const bytes = Number(head.bytes) || 0;
      if (bytes < 0 || bytes > MAX_BLOCK) return down('it sent something that isn\'t audio');
      if (buf.length < 4 + n + bytes) return;
      const pcm = buf.subarray(4 + n, 4 + n + bytes);
      buf = buf.subarray(4 + n + bytes);
      block(head, pcm);
    }
  }

  /** Starts the helper. Safe to call again: it starts once. */
  function start() {
    if (state !== 'off') return;
    let k;
    try { k = settings().kokoro; } catch (e) { return down(`the settings can't be read (${e.message})`); }
    const problem = pythonProblem(k.python);
    if (problem) return down(problem);
    const place = modelPlace(k.model, home);
    if (!fs.existsSync(place.dir)) return down('the model is not on this Mac');
    state = 'starting'; t0 = Date.now(); loads++;
    try {
      tmp = fs.realpathSync(fs.mkdtempSync(path.join(tmpRoot, 'roamies-kokoro-'))); // owner-only (0700)
      const copy = path.join(tmp, SCRIPT);
      fs.copyFileSync(script, copy); // run from the temporary folder, so the sandbox needn't open the app's own folder
      profile = profileFor({ home, tmp, modelDir: place.dir, python: k.python });
      // A fixed list: the profile, the Python, its flags, the script, where the model is, the language, the voice
      // to warm up with, and MLX's two memory limits in MB (feature 24). -I: no user site, no script folder on the
      // path, no PYTHON* variables.
      child = spawnImpl(sandboxExec, ['-p', profile, k.python, '-I', '-u', copy, place.name, place.dir, k.lang, k.voice, String(k.cacheMB), String(k.memoryMB)],
        { cwd: tmp, env: helperEnv({ home, tmp, hub: place.hub }), stdio: ['pipe', 'pipe', 'ignore'], shell: false, detached: false });
    } catch (e) { return down(`it couldn't be started (${e.code ?? e.message})`); }
    const mine = child;
    startTimer = setTimeout(() => down('it took too long to start'), limitMs() * START_FACTOR);
    mine.on('error', (e) => { if (child === mine) down(`it couldn't be started (${e.code ?? 'error'})`); });
    mine.on('close', (code, signal) => { if (child === mine && state !== 'stopped') down(`it stopped (${code ?? signal ?? 'closed'})`); });
    mine.stdin.on('error', () => { /* it quit: the close handler reports it */ });
    mine.stdout.on('data', feed);
    log('kokoro_start', { python: k.python, model: k.model });
  }

  /** One sentence as { pcm, rate }. Rejects when the helper isn't ready (err.notReady) or has gone down. */
  function make(text, { voice, speed }) {
    lastUse = now();
    if (state !== 'ready') { const e = new Error('The natural voice isn\'t ready.'); e.notReady = state === 'starting' || state === 'off'; return Promise.reject(e); }
    return new Promise((resolve, reject) => { waiting.push({ id: ++seq, text, voice, speed, resolve, reject }); next(); });
  }

  /** At quit: its input is closed (it ends by itself), and it is killed if it is still there shortly after. */
  function stop() {
    if (state === 'stopped') return;
    const c = child, was = state;
    state = 'stopped'; clearTimeout(startTimer);
    const err = new Error('The natural voice stopped.');
    if (current) { clearTimeout(current.timer); current.reject(err); current = null; }
    for (const w of waiting.splice(0)) w.reject(err);
    settle(false);
    if (!c || was === 'down') return clean();
    try { c.stdin.end(); } catch { /* already closed */ }
    const t = setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* gone */ } }, QUIT_KILL_MS);
    t.unref?.();
    c.once('close', () => { clearTimeout(t); clean(); });
    child = null;
  }

  /** Feature 24: started again if it is asleep (why: what woke it, for the log). Otherwise its quiet time starts
   *  again. → whether it was asleep. */
  function wake(why) {
    lastUse = now();
    if (state !== 'asleep') return false;
    state = 'off';
    log('kokoro_wake', { why: String(why ?? '') });
    start();
    return true;
  }

  /** The owner, 2026-11-28: → true once the helper is ready, false if it goes down or stops, or after ms. At once when
   *  it isn't loading. */
  function whenReady(ms) {
    if (state === 'ready') return Promise.resolve(true);
    if (state !== 'starting' || !(ms > 0)) return Promise.resolve(false);
    return new Promise((resolve) => {
      const done = (ok) => { readyWaiters.delete(done); clearTimeout(t); resolve(ok); };
      const t = setTimeout(() => done(state === 'ready'), ms);
      readyWaiters.add(done);
    });
  }

  return {
    start, make, stop, wake, whenReady,
    /** Loading for the first time this session (at start; a wake from sleep doesn't count). */
    get loadingAtStart() { return state === 'starting' && loads === 1; },
    /** A reply's voice in this helper's voice is open: it doesn't sleep until it is let go (release). */
    hold() { holds++; return true; },
    release() { holds = Math.max(0, holds - 1); lastUse = now(); },
    get state() { return state; },
    get asleep() { return state === 'asleep'; },
    get usable() { return state === 'starting' || state === 'ready'; },
    get ready() { return state === 'ready'; },
    get why() { return why; },
    get pid() { return child?.pid ?? null; },
    get profile() { return profile; },
  };
}

/** A reply's voice that speaks through the helper. Same shape as LocalVoice, which it falls back to, sentence by
 *  sentence, whenever the helper has no audio to give. `voice` is the look's macOS voice, for that fallback. */
export class KokoroVoice extends LocalVoice {
  constructor({ engine, settings, ...rest }) {
    super(rest);
    this.engine = engine; this.settings = settings;
    this.holding = !!engine.hold?.(); // feature 24: the helper doesn't sleep while this reply is open
    // The owner, 2026-11-28: a reply ready while the helper is still loading at start waits for it, up to
    // kokoro.waitAtStartSeconds from its first sentence; past that it is spoken by the Mac's voice to its end.
    this.waitMs = 0; this.deadline = 0; this.fellBack = false;
    if (engine.loadingAtStart) { try { this.waitMs = settings().kokoro.waitAtStartSeconds * 1000; } catch { this.waitMs = 0; } }
  }

  close() {
    if (this.holding) { this.holding = false; this.engine.release?.(); }
    super.close();
  }

  /** A long sentence is queued as several pieces, each short enough to be made (and dropped) quickly. */
  say(text) {
    if (this.state !== 'open') return;
    const s = spoken(text);
    if (!s) return;
    let max = 120;
    try { max = this.settings().limits.kokoroSentenceChars; } catch { /* the default */ }
    for (const piece of this.engine.usable ? splitLong(s, max) : [s]) super.say(piece);
  }

  async make(text) {
    if (!this.engine.ready && !this.fellBack && this.waitMs > 0) {
      this.deadline ||= Date.now() + this.waitMs;
      const ok = await this.engine.whenReady(this.deadline - Date.now());
      if (this.state === 'done') throw new Error('The reply ended.');
      if (!ok) this.fellBack = true;
    }
    if (this.engine.ready && !this.fellBack) {
      try {
        const k = this.settings().kokoro;
        const { pcm, rate } = await this.engine.make(text, { voice: k.voice, speed: k.speed });
        this.rate = rate;
        return pcm;
      } catch (e) {
        if (this.state === 'done') throw e;
        // The helper went down (it has said so once) or the settings can't be read: this sentence is still spoken.
      }
    }
    return super.make(text);
  }
}

/** The class speaker.mjs makes a reply's voice from, tied to one helper. */
export const voiceFor = (engine, settings) => class extends KokoroVoice { constructor(o) { super({ ...o, engine, settings }); } };
