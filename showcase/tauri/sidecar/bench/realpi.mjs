// One hand-off to the real pi, which sends requests to pi's own AI provider: only with the owner's yes. It asks pi
// to start `sleep 600` in the background, and reports what pi started and what is left of it after the hand-off ends.
// usage: node realpi.mjs <empty folder> [finish | stop | timeout | quit] [pi command]
//   finish   pi replies "done" and finishes
//   stop     pi also runs `sleep 120` in the foreground; stop_pi is used once the background sleep is seen
//   timeout  the same, with "maxMinutes" at 0.5: the time limit stops it
//   quit     the same; the app quitting (stopAll) once the background sleep is seen
// The folder stands in for Roamies' home folder (its settings, records and pi's project go inside it); it is left
// for the caller to remove. pi itself runs with the real home folder, so it finds its own settings and sign-in in
// ~/.pi as it always does. Without the sandbox: the project is not inside the real home's settings, and sandbox-exec
// only execs the shell, so the processes and their groups are the same with it.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createPi } from '../pi.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const home = fs.realpathSync(process.argv[2]);
const how = process.argv[3] || 'finish';
const PI = process.argv[4] || '/opt/homebrew/bin/pi';
if (!['finish', 'stop', 'timeout', 'quit'].includes(how)) { console.error(`unknown: ${how}`); process.exit(2); }
if (fs.readdirSync(home).length) { console.error(`${home} is not empty`); process.exit(2); }
const proj = path.join(home, 'project'), dir = path.join(home, 'Documents', 'roamies-pi');
for (const d of [proj, dir]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ project: proj, projects: [proj], pi: PI, sandbox: false, autoSendReadOnly: 0, maxMinutes: how === 'timeout' ? 0.5 : 10, progressSeconds: 0 }));
const PROMPT = how === 'finish'
  ? 'Run this shell command once, with your bash tool, exactly as written: sleep 600 > /dev/null 2>&1 &\nThen reply with the single word: done'
  : 'Run this shell command once, with your bash tool, exactly as written: sleep 600 > /dev/null 2>&1 &\nThen run this one, with your bash tool, exactly as written, and wait for it: sleep 120\nThen reply with the single word: done';

/** Every process: pid, parent, group, command (this bench's own look; Roamies itself never reads commands). */
const table = () => execFileSync('/bin/ps', ['-A', '-o', 'pid=,ppid=,pgid=,command='], { encoding: 'utf8' }).trim().split('\n').map((l) => { const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l); return m && { pid: +m[1], ppid: +m[2], pgid: +m[3], command: m[4] }; }).filter(Boolean);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const done = [];
const pi = createPi({ home, userName: 'T', onDone: (r) => done.push(r), ask: async () => 'yes', log: (k, d) => console.log('log', k, JSON.stringify(d)) });
const t0 = Date.now();
await pi.tools.find((t) => t.name === 'ask_pi').execute({ prompt: PROMPT, mode: 'edit' }, {});
let leader = null, sleeper = null, fore = null, acted = false;
for (let i = 0; i < 1800 && !done.length; i++) {
  const all = table();
  leader ??= all.find((p) => p.pgid === p.pid && /pi-coding-agent|\/pi\b/.test(p.command) && p.command.includes('--mode json'))?.pid ?? null;
  const s = all.find((p) => /(^|\/)sleep 600$/.test(p.command.trim()));
  if (s && !sleeper) { sleeper = s; console.log(`after ${Date.now() - t0} ms: the background sleep: pid ${s.pid}, parent ${s.ppid}, group ${s.pgid}; pi's group ${leader}`); }
  const f = all.find((p) => /(^|\/)sleep 120$/.test(p.command.trim()));
  if (f && !fore) { fore = f; console.log(`after ${Date.now() - t0} ms: the foreground sleep: pid ${f.pid}, parent ${f.ppid}, group ${f.pgid}`); }
  if (sleeper && fore && !acted && (how === 'stop' || how === 'quit')) {
    acted = true; await sleep(1000);
    const ta = Date.now();
    if (how === 'stop') console.log('stop_pi:', await pi.tools.find((t) => t.name === 'stop_pi').execute({}, {}));
    else { await pi.stopAll(); console.log(`stopAll resolved after ${Date.now() - ta} ms`); }
  }
  await sleep(100);
}
console.log('status', done[0]?.status ?? 'still running', `after ${Date.now() - t0} ms`, 'reply:', JSON.stringify(String(done[0]?.reply ?? '').slice(0, 40)));
console.log('shown:', JSON.stringify(done[0]?.shown ?? ''));
await sleep(2500);
const state = (p) => (!p ? 'never seen' : alive(p.pid) ? 'ALIVE' : 'gone');
console.log(`2.5 s after: pi ${leader && alive(leader) ? 'ALIVE' : 'gone'}, the background sleep ${state(sleeper)}, the foreground sleep ${state(fore)}`);
const left = fs.readdirSync((await import('node:os')).tmpdir()).filter((f) => f.startsWith('roamies-pi-'));
console.log(`hand-off folders left: ${left.length}`);
fs.writeFileSync('/tmp/realpi.json', JSON.stringify({ how, leader, sleeper, fore, status: done[0]?.status ?? null, leftAlive: !!(sleeper && alive(sleeper.pid)) || !!(fore && alive(fore.pid)), folders: left.length }));
for (const p of [sleeper, fore]) if (p && alive(p.pid)) try { process.kill(p.pid, 'SIGKILL'); } catch { /* gone */ }
await pi.stopAll?.();
process.exit(0);
