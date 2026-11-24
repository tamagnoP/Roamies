// Local-only build (feature 24, the owner's plan of 2026-11-24): what pi's commands leave running is ended when pi
// stops. pi runs each bash command as the leader of a process group of its own (detached), and what the command
// starts in the background stays in that group after the shell has gone, out of reach of pi's own group.
//
//   - For a hand-off that can edit (only those have bash), Roamies makes a folder for it in the temporary folder:
//     an extension for pi and an empty record. pi is started with -e <extension>.
//   - The extension replaces pi's bash tool by the same tool (pi's own createBashTool, with pi's shell settings) whose
//     spawnHook puts one line in front of every command: the shell appends its pid ($$) and the time to the record.
//     The model is not told: the tool's name, description and results, and the command pi records, are unchanged.
//   - The sandbox lets pi write that one file and nothing else in the folder; the file is append-only (chflags
//     uappnd), which the sandbox does not let pi undo. Without the sandbox only the flag holds.
//   - When pi stops (finish, stop_pi, the time limit, quit, the watcher), every recorded group still there is asked
//     to end (TERM), then killed after 2 s. Before that /bin/ps lists the owner's processes (pid, group, elapsed
//     time; never their environment): a recorded pid that now belongs to a process started at another time was
//     reused, and that group is left alone. The list is used here and dropped: never logged or kept.
//   - If pi can't load the extension, or its bash tool has no spawnHook, the hand-off runs all the same and a notice
//     says that what its commands leave running can't be ended.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const PS = '/bin/ps';
export const PS_ARGS = ['-x', '-o', 'pid=,pgid=,etime='];
export const CHFLAGS = '/usr/bin/chflags';
export const RECORD = 'record', EXTENSION = 'roamies-leftovers.ts';
export const READY = 'ready';
// A recorded shell and the process now under its pid are the same one when the process started between `before`
// seconds before the time the shell wrote and `after` seconds after it (ps gives whole seconds of elapsed time).
export const START_SLACK = { before: 5, after: 2 };
export const KILL_AFTER_MS = 2000;

/** The line put in front of every command: one line appended to the record, and nothing said if it can't be. */
export const recordLine = (record) => `{ printf '%s %s\\n' "$$" "$(/bin/date +%s)" >> '${record}'; } 2>/dev/null; `;

/** The extension pi is started with, for this record. */
export function extensionSource(record) {
  return `// Roamies (feature 24): made for one hand-off and removed after it. Every bash command first appends its shell's
// pid and the time to a record only Roamies reads, so that what the command leaves running can be ended when pi stops.
import { appendFileSync } from "node:fs";
import { createBashTool, SettingsManager } from "@earendil-works/pi-coding-agent";
const RECORD = ${JSON.stringify(record)};
const LINE = ${JSON.stringify(recordLine(record))};
export default async function (pi: any) {
  const cwd = process.cwd();
  // Whether this pi hands commands to spawnHook: asked of a stand-in that runs nothing.
  let hooked = false;
  const probe = createBashTool(cwd, { spawnHook: (c: any) => { hooked = true; return c; }, operations: { exec: async () => ({ exitCode: 0 }) } } as any);
  try { await probe.execute("roamies-probe", { command: ":" } as any); } catch { /* no spawnHook */ }
  if (!hooked) return;
  const settings = SettingsManager.create(cwd);
  const bash = createBashTool(cwd, { shellPath: settings.getShellPath(), commandPrefix: settings.getShellCommandPrefix(), spawnHook: (c: any) => ({ ...c, command: LINE + c.command }) } as any);
  pi.registerTool({ ...bash, execute: (id: any, params: any, signal: any, onUpdate: any, ctx: any) => bash.execute(id, params, signal, onUpdate, ctx) });
  appendFileSync(RECORD, ${JSON.stringify(`${READY}\n`)});
}
`;
}

/** "[[dd-]hh:]mm:ss" → seconds, or null. */
export function etimeSeconds(t) {
  const m = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(String(t).trim());
  return m ? (+(m[1] ?? 0)) * 86400 + (+(m[2] ?? 0)) * 3600 + (+m[3]) * 60 + (+m[4]) : null;
}
/** ps's output → [{ pid, pgid, start }], start in seconds since 1970. */
export function parsePs(text, nowSec) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const [pid, pgid, etime] = line.trim().split(/\s+/);
    const s = etimeSeconds(etime ?? '');
    if (/^\d+$/.test(pid ?? '') && /^\d+$/.test(pgid ?? '') && s !== null) out.push({ pid: +pid, pgid: +pgid, start: nowSec - s });
  }
  return out;
}
/** The record → { ready, shells: [{ pid, t }] }. Lines it doesn't know are skipped. */
export function parseRecord(text) {
  const shells = [];
  let ready = false;
  for (const line of String(text).split('\n')) {
    if (line === READY) ready = true;
    const m = /^(\d+) (\d+)$/.exec(line);
    if (m && +m[1] > 1) shells.push({ pid: +m[1], t: +m[2] });
  }
  return { ready, shells };
}
/** Which recorded groups to end: Map(group → how many processes are in it). A group with nothing left is skipped;
 *  so is one whose pid now belongs to a process that started at another time (the number was reused), and the
 *  groups in `keep` (Roamies' own). */
export function endable({ shells, procs, keep = [] }) {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const members = new Map();
  for (const p of procs) members.set(p.pgid, (members.get(p.pgid) ?? 0) + 1);
  const own = new Set(keep.map((pid) => byPid.get(pid)?.pgid).filter(Boolean));
  const out = new Map();
  for (const { pid, t } of shells) {
    if (!members.has(pid) || own.has(pid) || out.has(pid)) continue;
    const p = byPid.get(pid);
    if (p && (p.start < t - START_SLACK.before || p.start > t + START_SLACK.after)) continue;
    out.set(pid, members.get(pid));
  }
  return out;
}

const groupAlive = (g) => { try { process.kill(-g, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const signal = (g, sig) => { try { process.kill(-g, sig); } catch { /* gone */ } };

/** The folder for one hand-off, or null when it can't be made (then pi runs without the extension). */
export function prepareLeftovers({ tmpdir = os.tmpdir(), spawnSyncImpl = spawnSync, now = () => Date.now(), log = () => {}, killAfterMs = KILL_AFTER_MS } = {}) {
  let dir = null;
  const unflag = (record) => { try { spawnSyncImpl(CHFLAGS, ['nouappnd', record], { stdio: 'ignore', timeout: 5000 }); } catch { /* already gone */ } };
  try {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir, 'roamies-pi-')));
    const record = path.join(dir, RECORD), extension = path.join(dir, EXTENSION);
    if (/['"\\\n\r\0]/.test(record)) throw new Error('a temporary folder with a quote or line break in its name');
    fs.writeFileSync(record, '', { mode: 0o600 });
    fs.writeFileSync(extension, extensionSource(record), { mode: 0o600 });
    const f = spawnSyncImpl(CHFLAGS, ['uappnd', record], { stdio: 'ignore', timeout: 5000 });
    if (f.status !== 0) throw new Error('chflags');
    const handled = new Set(); // groups already asked to end, so a process is counted once
    const read = () => { try { return parseRecord(fs.readFileSync(record, 'utf8')); } catch { return { ready: false, shells: [] }; } };
    /** One look: the groups to end now, and how many processes in them were not counted before. */
    const look = () => {
      const { shells } = read();
      if (!shells.length) return { groups: [], count: 0 };
      const r = spawnSyncImpl(PS, PS_ARGS, { encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024 * 1024 });
      if (r.status !== 0 || typeof r.stdout !== 'string') return { groups: [], count: 0 };
      const found = endable({ shells, procs: parsePs(r.stdout, Math.floor(now() / 1000)), keep: [process.pid, process.ppid] });
      let count = 0;
      for (const [g, n] of found) if (!handled.has(g)) { handled.add(g); count += n; }
      return { groups: [...found.keys()], count };
    };
    let removed = false;
    return {
      dir, record, extension,
      /** The sandbox rules for the folder: nothing written in it but the record. */
      rules: () => [`(deny file-write* (subpath "${dir}"))`, `(allow file-write-data (literal "${record}"))`],
      ready: () => read().ready,
      /** TERM to every recorded group still there, KILL after killAfterMs to what is left. → { count, done }. */
      end(when) {
        const { groups, count } = look();
        log('pi_leftovers', { ended: count, when });
        for (const g of groups) signal(g, 'SIGTERM');
        const done = !groups.length ? Promise.resolve() : new Promise((resolve) => {
          const t0 = Date.now();
          const tick = setInterval(() => {
            const left = groups.filter(groupAlive);
            if (left.length && Date.now() - t0 < killAfterMs) return;
            clearInterval(tick);
            for (const g of left) signal(g, 'SIGKILL');
            resolve();
          }, 50);
        });
        return { count, done };
      },
      /** As this process ends: no waiting is possible, so the groups are killed outright. */
      endNow() { try { for (const g of look().groups) signal(g, 'SIGKILL'); } catch { /* best effort */ } },
      remove() {
        if (removed) return;
        removed = true;
        unflag(record);
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
      },
    };
  } catch {
    if (dir) { unflag(path.join(dir, RECORD)); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
    return null;
  }
}

/** What is said when some were ended. */
export const endedNotice = (n) => `Pi's commands had left ${n} process${n === 1 ? '' : 'es'} running. I ended ${n === 1 ? 'it' : 'them'}.`;
/** What is said when pi ran without the extension. */
export const offNotice = 'Pi ran without the extension that lets me end what its commands leave running, so anything they left running may still be running.';
