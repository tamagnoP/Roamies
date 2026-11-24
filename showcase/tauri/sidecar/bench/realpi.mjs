// One hand-off to the real pi, which sends requests to pi's own AI provider: only with the owner's yes. It asks pi
// to start `sleep 600` in the background and reply "done", and reports what pi started and what is left of it after
// pi has finished. usage: node realpi.mjs <empty folder> [pi command]
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
const PI = process.argv[3] || '/opt/homebrew/bin/pi';
if (fs.readdirSync(home).length) { console.error(`${home} is not empty`); process.exit(2); }
const proj = path.join(home, 'project'), dir = path.join(home, 'Documents', 'roamies-pi');
for (const d of [proj, dir]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ project: proj, projects: [proj], pi: PI, sandbox: false, autoSendReadOnly: 0, maxMinutes: 10, progressSeconds: 0 }));
const PROMPT = 'Run this shell command once, with your bash tool, exactly as written: sleep 600 > /dev/null 2>&1 &\nThen reply with the single word: done';

/** Every process of this user: pid, parent, group, session leader's pid is not shown by ps on macOS; the group is. */
const table = () => execFileSync('/bin/ps', ['-A', '-o', 'pid=,ppid=,pgid=,command='], { encoding: 'utf8' }).trim().split('\n').map((l) => { const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l); return m && { pid: +m[1], ppid: +m[2], pgid: +m[3], command: m[4] }; }).filter(Boolean);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const done = [];
const pi = createPi({ home, userName: 'T', onDone: (r) => done.push(r), ask: async () => 'yes', log: (k, d) => console.log('log', k, JSON.stringify(d)) });
const t0 = Date.now();
await pi.tools.find((t) => t.name === 'ask_pi').execute({ prompt: PROMPT, mode: 'edit' }, {});
// pi's process: the leader of the group Roamies made for it
let leader = null, sleeper = null, seen = [];
for (let i = 0; i < 1200 && !done.length; i++) {
  const all = table();
  leader ??= all.find((p) => p.pgid === p.pid && /pi-coding-agent|\/pi\b/.test(p.command) && p.command.includes('--mode json'))?.pid ?? null;
  const s = all.find((p) => /^sleep 600$/.test(p.command.trim()) || /\/sleep 600$/.test(p.command.trim()));
  if (s && !sleeper) { sleeper = s; seen = all.filter((p) => p.pgid === leader || p.pid === s.pid || p.pid === s.ppid); console.log(`after ${Date.now() - t0} ms: the sleep pi started: pid ${s.pid}, parent ${s.ppid}, group ${s.pgid}; pi's group ${leader}`); }
  await sleep(100);
}
console.log('status', done[0]?.status ?? 'still running', `after ${Date.now() - t0} ms`, 'reply:', JSON.stringify(String(done[0]?.reply ?? '').slice(0, 40)));
console.log('processes at that moment:', JSON.stringify(seen.map(({ pid, ppid, pgid, command }) => ({ pid, ppid, pgid, command: command.slice(0, 80) }))));
await sleep(2000);
console.log(`2 s after pi finished: pi ${leader && alive(leader) ? 'ALIVE' : 'gone'}, the sleep ${sleeper && alive(sleeper.pid) ? 'ALIVE' : sleeper ? 'gone' : 'never seen'}`);
if (sleeper && alive(sleeper.pid)) { const now = table().find((p) => p.pid === sleeper.pid); console.log('the sleep now:', JSON.stringify(now)); }
fs.writeFileSync('/tmp/realpi.json', JSON.stringify({ leader, sleeper, status: done[0]?.status ?? null, leftAlive: !!(sleeper && alive(sleeper.pid)) }));
await pi.stopAll?.();
process.exit(0);
