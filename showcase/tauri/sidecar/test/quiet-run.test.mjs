// Features 25 and 31, check-ins and the quiet queue: the real sidecar, in a throwaway home folder, with a stand-in for
// the shell and the page on its input. Run: npm run test:all (about two and a half minutes; not in npm test). No model
// is signed in and nothing leaves the Mac. With "speaking.perHour" at 1:
//   - the deadlines at risk are said (the hour's one);
//   - a to-do's due time passes: its check-in waits in the queue (budget): nothing said or shown, a count of 1;
//   - "anything waiting?" typed: the check-in is asked, and a spoken "done" marks the to-do done;
//   - away (the shell's idle seconds) and on a call (another app on the microphone), the next check-ins wait, each
//     with its reason in the log;
//   - a typed request: after its reply the queue is given, soonest first; "still on it" is said, and the other is
//     clicked done; the daily note has its lines, and the log no titles.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const SIDECAR = new URL('..', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'quiet-run-')));
const env = { HOME: home, PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: 'en_US.UTF-8', ROAMIES_VERSION: '0.0.0' };
const dir = path.join(home, 'Documents', 'roamies-pi');
fs.mkdirSync(path.join(home, '.gg', 'sidekick'), { recursive: true });
fs.mkdirSync(dir, { recursive: true });
execFileSync(process.execPath, ['--input-type=module', '-e', `
  import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
  import { settingsDefaults } from './pi.mjs';
  const d = JSON.parse(JSON.stringify(settingsDefaults(os.homedir())));
  d.voiceEngine = 'system'; d.calendar.syncSeconds = 3600; d.calendar.reviewAt = ''; d.speaking.perHour = 1;
  fs.writeFileSync(path.join(os.homedir(), 'Documents', 'roamies-pi', 'settings.json'), JSON.stringify(d, null, 2));
`], { cwd: SIDECAR, env, stdio: ['ignore', 'inherit', 'inherit'] });
fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ calendar: { started: true, adopt: true } }));
const T = Date.now();
const todo = (id, text, due) => ({ id, text, due, createdAt: T, status: 'open', remindedAt: null, kind: 'commitment' });
fs.writeFileSync(path.join(home, '.gg', 'sidekick', 'memory.json'), JSON.stringify({ version: 1, commitments: [todo('c1', 'Call the dentist', T + 40_000), todo('c3', 'Book the lab', T + 70_000), todo('c4', 'Send the forms', T + 100_000)], facts: [] }));
fs.writeFileSync(path.join(home, '.gg', 'sidekick.json'), JSON.stringify({ sound: false, allowActions: false, voice: false, onboarded: true, onboardStep: 0, filesAsked: true, autoListen: false, setupVersion: 2, size: 'default', look: 'jarvis', introDone: true }));

const out = [];
let side = null, presence = { idle: 1, mic: false };
const tell = (m) => side.stdin.write(`${JSON.stringify(m)}\n`);
side = spawn(process.execPath, ['sidekick.mjs'], { cwd: SIDECAR, env, stdio: ['pipe', 'pipe', 'ignore'] });
readline.createInterface({ input: side.stdout }).on('line', (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  out.push({ at: Date.now(), m });
  if (m.type === 'ui' && m.msg?.kind === 'speech' && m.msg.mark) tell({ type: 'speech_mark', mark: m.msg.mark }); // the page has played it
});
const shellBeat = setInterval(() => tell({ type: 'presence', ...presence }), 3000); // as presence.rs sends it
const logText = () => { const d = path.join(home, '.gg', 'sidekick', 'logs'); return fs.existsSync(d) ? fs.readdirSync(d).map((f) => fs.readFileSync(path.join(d, f), 'utf8')).join('') : ''; };
const lastKinds = () => logText().trim().split('\n').slice(-15).map((l) => l.split(' ').slice(0, 2).join(' ')).join(' | ');
const page = (from = 0) => out.slice(from).filter((o) => o.m.type === 'ui').map((o) => o.m.msg);
const todoNow = (id) => JSON.parse(fs.readFileSync(path.join(home, '.gg', 'sidekick', 'memory.json'), 'utf8')).commitments.find((c) => c.id === id);
const count = () => page().filter((m) => m.kind === 'queue').at(-1)?.n;
const waitFor = async (ok, ms, what) => { const t0 = Date.now(); while (!ok() && Date.now() - t0 < ms) await sleep(200); assert.ok(ok(), `${what} (the log: ${lastKinds()})`); };
const asked = (from, start) => page(from).find((m) => m.kind === 'ask' && String(m.placeholder ?? '').startsWith(start));
const say = (text) => { tell({ type: 'voice_state', state: 'listening' }); tell({ type: 'voice_state', state: 'processing' }); tell({ type: 'voice', text }); tell({ type: 'voice_state', state: 'idle' }); };
const hm = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
async function typed(text) {
  const from = out.length;
  tell({ type: 'menu', id: 'ask' });
  await waitFor(() => page(from).some((m) => m.kind === 'ask' && m.bar), 3000, 'the ask field');
  tell({ type: 'answer', id: page(from).find((m) => m.kind === 'ask' && m.bar).id, text });
}
try {
  await sleep(2500);
  tell({ type: 'ui_ready' });

  // the deadlines at risk: the hour's one thing said unasked
  await waitFor(() => / deadline_at_risk_said /.test(logText()), 45_000, 'the deadlines at risk are said');
  const risk = page().find((m) => m.kind === 'say' && /has no time planned/.test(m.text));
  assert.equal(risk.text.replace(', sir.', '.'), ['Call the dentist', 'Book the lab', 'Send the forms'].map((t, i) => `${t} is due today at ${hm(T + [40, 70, 100][i] * 1000)} and has no time planned before then.`).join('\n'));
  assert.doesNotMatch(logText(), / quiet_queued /);

  // the dentist's due time passes: its check-in waits (budget), nothing said or shown, a count of 1
  let from = out.length;
  await waitFor(() => / quiet_queued \{"kind":"checkIn","why":"budget"\}\n/.test(logText()), 45_000, 'the check-in waits');
  await sleep(500);
  assert.equal(count(), 1, 'the count on the character');
  assert.ok(!page(from).some((m) => ['say', 'ask'].includes(m.kind)), 'nothing said or shown');
  assert.match(logText(), / checkin_due \{"how":"due"\}\n/);

  // "anything waiting?", typed: the app gives it; the check-in is asked, and a spoken "done" answers it
  from = out.length;
  await typed('anything waiting?');
  await waitFor(() => asked(from, 'Call the dentist was due at'), 10_000, 'the check-in is asked');
  const q = asked(from, 'Call the dentist was due at');
  assert.equal(q.placeholder.split('\n')[0], `Call the dentist was due at ${hm(T + 40_000)}. Is it done?`);
  assert.deepEqual([q.choices, q.second, q.third], [['Done', 'Still on it', 'Not yet'], 'second', 'third']);
  assert.match(logText(), / queue_asked \{"items":1\}\n/); assert.match(logText(), / quiet_given \{"by":"asked","items":1,"left":0,"stale":0\}\n/);
  say('done');
  await waitFor(() => todoNow('c1').status === 'done', 10_000, 'marked done');
  assert.match(logText(), / checkin \{"how":"due","answer":"done"\}\n/);
  assert.equal(count(), 0);
  assert.ok(!/ nudge /.test(logText()), 'a to-do gets a check-in, not the due-time nudge');

  // marking it done syncs with Super Productivity, which isn't there: the line that leaves is given first (the budget
  // allows nothing more, so it waits as "budget"), before the owner goes away
  { const t0 = Date.now(); while (!/ quiet_queued \{"kind":"calendarLine"/.test(logText()) && Date.now() - t0 < 10_000) await sleep(200); }
  const lineWaits = / quiet_queued \{"kind":"calendarLine","why":"budget"\}\n/.test(logText());
  // away: the next one waits, "away"
  presence = { idle: 9999, mic: false }; tell({ type: 'presence', ...presence });
  await waitFor(() => / quiet_queued \{"kind":"checkIn","why":"away"\}\n/.test(logText()), 45_000, 'away: it waits');
  assert.match(logText(), / presence \{"away":true,"call":false\}\n/);
  // on a call: the next one waits, "call"
  presence = { idle: 0, mic: true }; tell({ type: 'presence', ...presence });
  await waitFor(() => / quiet_queued \{"kind":"checkIn","why":"call"\}\n/.test(logText()), 45_000, 'on a call: it waits');
  assert.match(logText(), / presence \{"away":false,"call":true\}\n/);
  presence = { idle: 0, mic: false }; tell({ type: 'presence', ...presence });
  await sleep(500);
  assert.equal(count(), lineWaits ? 3 : 2, `two wait, and the calendar's line if it left one (${logText().split('\n').filter((l) => / quiet_queued /.test(l)).map((l) => l.split(' ').slice(1).join(' ')).join(' | ')})`);

  // a typed request (no model is signed in: its reply is the app's own); after it, the queue is given, soonest first
  from = out.length;
  await typed('what is on my list');
  await waitFor(() => asked(from, 'Book the lab was due at'), 20_000, 'the first one after the reply');
  assert.ok(!asked(from, 'Send the forms'), 'one at a time');
  say('still on it');
  await waitFor(() => asked(from, 'Send the forms was due at'), 10_000, 'then the next');
  tell({ type: 'answer', id: asked(from, 'Send the forms was due at').id, text: 'yes' }); // the Done button
  await waitFor(() => todoNow('c4').status === 'done', 10_000, 'clicked done');
  assert.equal(todoNow('c3').status, 'open', 'still on it: nothing changes');
  assert.match(logText(), lineWaits ? / quiet_given \{"by":"exchange","items":3,"left":0,"stale":0\}\n/ : / quiet_given \{"by":"exchange","items":2,"left":0,"stale":0\}\n/);
  assert.match(logText(), / checkin \{"how":"due","answer":"still"\}\n/);
  await waitFor(() => count() === 0, 5000, 'the count is gone');
  const key = (() => { const d = new Date(); if (d.getHours() < 4) d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const note = fs.readFileSync(path.join(home, 'Documents', 'roamies-vault', 'Daily', `${key}.md`), 'utf8');
  assert.match(note, /- \d\d:\d\d Check-in: Book the lab: still on it\n/);
  await waitFor(() => /Done: Call the dentist/.test(fs.readFileSync(path.join(home, 'Documents', 'roamies-vault', 'Daily', `${key}.md`), 'utf8')), 35_000, 'the Done line');
  assert.doesNotMatch(logText(), /dentist|Book the lab|Send the forms|anything waiting|still on it/i, 'no titles or words in the log');
} finally {
  clearInterval(shellBeat);
  side.stdin.end(); await sleep(800); try { side.kill('SIGKILL'); } catch { /* gone */ }
  fs.rmSync(home, { recursive: true, force: true });
}
console.log('check-ins and the quiet queue, the sidecar run: passed');
