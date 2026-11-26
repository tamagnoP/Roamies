// Local-only build, feature 23 (stage 6): Roamies starts the local model server itself, like the natural voice.
//
//   - Only when local.start.python is a full path and local.address is http://127.0.0.1:<local.start.port>/v1. Any
//     other address is the owner's own server or tunnel, and is never started or stopped here.
//   - Before it starts: the checks of localserver.mjs (the tested version, the pinned model files, the drafter's).
//     A problem is said once in a notice, and the local model is not used.
//   - The Python by its full path, started directly (no shell) under sandbox-exec, with the fixed arguments of
//     serverCommand and the offline variables. The sandbox denies every kind of network except listening on
//     127.0.0.1 at its port; it may write only in its own temporary folder; in the home folder it may read only the
//     pinned models' files (and its Python, if that lives there); it starts no other program.
//   - Started on first need (a request to the local model), stopped after local.start.sleepAfterMinutes without one
//     (0: never), and at quit. Its output is thrown away.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OFFLINE, SANDBOX_EXEC } from './kokorovoice.mjs';
import { localAddress, probe } from './local.mjs';
import { DRAFTS, MODELS, serverCommand, snapshotDir, startProblems } from './localserver.mjs';

export const START_SECONDS = 180; // how long the server may take to load the model and answer
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const inside = (p, dir) => p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
/** Every file a pinned repository's snapshot holds: each link on the way (the cache links a snapshot's file to a
 *  blob, which may link again to a shared store) and the file it ends at, by real paths. */
function snapshotFiles(dir) {
  const out = new Set();
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  for (const f of names) {
    let p = path.join(dir, f);
    try {
      for (let k = 0; k < 8 && fs.lstatSync(p).isSymbolicLink(); k++) { out.add(path.join(real(path.dirname(p)), path.basename(p))); p = path.resolve(path.dirname(p), fs.readlinkSync(p)); }
      const r = fs.realpathSync(p);
      if (fs.statSync(r).isFile()) out.add(r);
    } catch { /* a link to nothing */ }
  }
  return [...out];
}

/** The sandbox profile the server runs under. A later rule wins over an earlier one. */
export function serverProfile({ home, tmp, python, port, models }) {
  const q = (p) => { if (/[\0\n\r"\\]/.test(p)) throw new Error('a path with a quote or line break in it'); return `"${p}"`; };
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('no port');
  const h = real(home), t = real(tmp), py = real(python);
  const dirs = models.map(real), files = models.flatMap(snapshotFiles).filter((f) => !dirs.some((d) => inside(f, d)));
  const envs = [...new Set([path.dirname(path.dirname(path.resolve(python))), path.dirname(path.dirname(py))])].filter((p) => inside(p, h) && p !== h);
  const above = new Set();
  for (const p of [...dirs, ...files, ...envs]) for (let up = path.dirname(p); inside(up, h); up = path.dirname(up)) { above.add(up); if (up === h) break; }
  const lit = (list) => list.map((p) => `(literal ${q(p)})`).join(' ');
  const sub = (list) => list.map((p) => `(subpath ${q(p)})`).join(' ');
  return `${[
    '(version 1)',
    '(allow default)',
    ';; no network, except listening on 127.0.0.1 at its port',
    '(deny network*)',
    `(allow network-bind network-inbound (local ip "localhost:${port}"))`,
    ';; writing: only its own temporary folder',
    '(deny file-write* (subpath "/"))',
    `(allow file-write* (subpath ${q(t)}) (literal "/dev/null"))`,
    ';; reading in the home folder: only the pinned models\' files' + (envs.length ? ' and its Python' : ''),
    `(deny file-read* (subpath ${q(h)}))`,
    ...(above.size ? [`(allow file-read-metadata ${lit([...above])})`] : []),
    `(allow file-read* ${sub([...dirs, ...envs])})`,
    ...(files.length ? [`(allow file-read* ${lit(files)})`] : []),
    ';; it starts no other program',
    '(deny process-exec*)',
    `(allow process-exec* ${lit([...new Set([path.resolve(python), py])])})`,
  ].join('\n')}\n`;
}

/** settings() → loadSettings's; onNotice(line): a start-up problem, said once; log(kind, data). */
export function createModelServer({ settings, home = os.homedir(), spawnImpl = spawn, sandboxExec = SANDBOX_EXEC, onNotice = () => {}, log = () => {}, now = () => Date.now(), tmpRoot = os.tmpdir(), probeImpl = probe, startSeconds = START_SECONDS, every = (fn, ms) => { const t = setInterval(fn, ms); t.unref?.(); return t; } } = {}) {
  let child = null, tmp = null, starting = null, lastUse = 0, told = '', starts = 0;
  const mine = () => { const s = settings().local; const a = localAddress(s.address); return s.start.python && a === `http://127.0.0.1:${s.start.port}/v1` ? s : null; };
  function stop(why = 'stopped') {
    const c = child; child = null; starting = null;
    if (c) { try { c.kill('SIGINT'); } catch { /* gone */ } setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* gone */ } }, 3000).unref?.(); log('model_server_stop', { why }); }
    if (tmp) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* left */ } tmp = null; }
  }
  /** Started if it is Roamies' to start and isn't running. → '' (ready, or not Roamies' to start) or a problem line. */
  async function ensure() {
    lastUse = now();
    const s = mine();
    if (!s) return '';
    if (child && !starting) return '';
    if (starting) return starting;
    starting = (async () => {
      const { problems, notes, draft } = startProblems({ python: s.start.python, home, model: s.start.model, draft: s.start.draft });
      for (const n of notes) log('model_server_note', { note: n.slice(0, 160) });
      if (problems.length) { const line = `The local model can't be started: ${problems.join(' ')}`; if (told !== line) { told = line; onNotice(line); } log('model_server_problem', { problems: problems.length }); return line; }
      // Something already answers there (started before, or by hand): used as it is.
      // (The server lists no model until it has loaded one: an empty list is not ready.)
      if ((await probeImpl(localAddress(s.address), { ms: 800 }))?.length) { log('model_server_found', {}); return ''; }
      try {
        tmp = fs.realpathSync(fs.mkdtempSync(path.join(tmpRoot, 'roamies-model-')));
        const cmd = serverCommand({ python: s.start.python, home, model: s.start.model, draft, port: s.start.port });
        const models = [snapshotDir(home, MODELS[s.start.model]), ...(draft ? [snapshotDir(home, DRAFTS[s.start.model])] : [])];
        const profile = serverProfile({ home, tmp, python: s.start.python, port: s.start.port, models });
        child = spawnImpl(sandboxExec, ['-p', profile, cmd.cmd, ...cmd.args], { cwd: tmp, env: { ...cmd.env, ...OFFLINE, TMPDIR: tmp, HF_HOME: path.join(tmp, 'hf'), XDG_CACHE_HOME: tmp }, stdio: ['ignore', 'ignore', 'ignore'], shell: false, detached: false });
      } catch (e) { stop('failed'); return `The local model server couldn't be started (${e.code ?? e.message}).`; }
      const c = child;
      c.on('error', () => { if (child === c) stop('error'); });
      c.on('exit', (code, signal) => { if (child === c) { child = null; log('model_server_exit', { code, signal }); } });
      starts++;
      log('model_server_start', { model: s.start.model, draft, port: s.start.port });
      const t0 = now();
      while (now() - t0 < startSeconds * 1000) {
        if (child !== c) return 'The local model server stopped while it was starting.';
        if ((await probeImpl(localAddress(s.address), { ms: 1000 }))?.length) { log('model_server_ready', { ms: now() - t0 }); return ''; }
        await new Promise((r) => setTimeout(r, 1000));
      }
      stop('slow');
      return 'The local model server took too long to start.';
    })();
    const out = await starting;
    starting = null;
    return out;
  }
  every(() => {
    const s = mine();
    if (!child || starting || !s) return;
    if (s.start.sleepAfterMinutes > 0 && now() - lastUse > s.start.sleepAfterMinutes * 60_000) stop('idle');
  }, 60_000);
  return { ensure, stop, touch: () => { lastUse = now(); }, get pid() { return child?.pid ?? null; }, get running() { return !!child; }, get starts() { return starts; } };
}
