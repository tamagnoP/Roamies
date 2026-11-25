// Feature 33, stand down: the real sidecar, in a throwaway home folder, with a stand-in for the shell and the page on
// its input. Run: npm run test:all (about a minute; not in npm test). No model is signed in and nothing leaves the Mac.
//   - the shell's stand_down (the shortcut): the page is cleared, the microphone closed, one log line;
//   - a reminder that comes due meanwhile is not nudged, nothing is shown, and the state is in state.json;
//   - a new page, and a restart of the sidecar, keep it (the stood-down look, no greeting);
//   - a spoken request ends it: one log line, the look back, the late nudge, and the line worded by the app for what
//     happened meanwhile (a calendar line whose block ended went by), from the quiet queue (feature 31).
//   - the phrase said alone, when it reaches the sidecar as words, stands it down too;
//   - it ends by itself at the day turn, with nothing said or shown; its line waits for the owner's first exchange
//     after (here a typed request) and comes once it has ended.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const SIDECAR = new URL('..', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'standdown-run-')));
const env = { HOME: home, PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: 'en_US.UTF-8', ROAMIES_VERSION: '0.0.0' };
const dir = path.join(home, 'Documents', 'roamies-pi');
fs.mkdirSync(path.join(home, '.gg', 'sidekick'), { recursive: true });
fs.mkdirSync(dir, { recursive: true });
execFileSync(process.execPath, ['--input-type=module', '-e', `
  import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
  import { settingsDefaults } from './pi.mjs';
  const d = JSON.parse(JSON.stringify(settingsDefaults(os.homedir())));
  d.voiceEngine = 'system'; d.calendar.syncSeconds = 3600; d.calendar.reviewAt = '';
  fs.writeFileSync(path.join(os.homedir(), 'Documents', 'roamies-pi', 'settings.json'), JSON.stringify(d, null, 2));
`], { cwd: SIDECAR, env, stdio: ['ignore', 'inherit', 'inherit'] });
// the calendar side as after its first start, so it asks nothing of Super Productivity during the run
fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ calendar: { started: true, adopt: true } }));
const dueAt = Date.now() + 25_000;
fs.writeFileSync(path.join(home, '.gg', 'sidekick', 'memory.json'), JSON.stringify({ version: 1, commitments: [{ id: 'c1', text: 'Call the dentist', due: dueAt, createdAt: Date.now(), status: 'open', remindedAt: null, kind: 'reminder' }], facts: [] }));
fs.writeFileSync(path.join(home, '.gg', 'sidekick.json'), JSON.stringify({ sound: false, allowActions: false, voice: false, onboarded: true, onboardStep: 0, filesAsked: true, autoListen: false, setupVersion: 2, size: 'default', look: 'jarvis', introDone: true, replies: 'text' }));

const out = [];
let side = null;
const tell = (m) => side.stdin.write(`${JSON.stringify(m)}\n`);
function start() {
  side = spawn(process.execPath, ['sidekick.mjs'], { cwd: SIDECAR, env, stdio: ['pipe', 'pipe', 'ignore'] });
  readline.createInterface({ input: side.stdout }).on('line', (l) => {
    let m; try { m = JSON.parse(l); } catch { return; }
    out.push({ at: Date.now(), m });
    if (m.type === 'ui' && m.msg?.kind === 'speech' && m.msg.mark) tell({ type: 'speech_mark', mark: m.msg.mark }); // the page has played it
  });
}
async function stop() { side.stdin.end(); await sleep(800); try { side.kill('SIGKILL'); } catch { /* gone */ } }
const logText = () => { const d = path.join(home, '.gg', 'sidekick', 'logs'); return fs.existsSync(d) ? fs.readdirSync(d).map((f) => fs.readFileSync(path.join(d, f), 'utf8')).join('') : ''; };
const state = () => JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
const page = (from) => out.slice(from).filter((o) => o.m.type === 'ui').map((o) => o.m.msg);
const shell = (from) => out.slice(from).map((o) => o.m);
const reminded = () => JSON.parse(fs.readFileSync(path.join(home, '.gg', 'sidekick', 'memory.json'), 'utf8')).commitments[0].remindedAt;
// When it doesn't come: the activity log's last kinds and times, never their text, say what happened instead.
const lastKinds = () => logText().trim().split('\n').slice(-15).map((l) => l.split(' ').slice(0, 2).join(' ')).join(' | ');
const waitFor = async (ok, ms, what) => { const t0 = Date.now(); while (!ok() && Date.now() - t0 < ms) await sleep(200); assert.ok(ok(), `${what} (the log: ${lastKinds()})`); };
try {
  start(); await sleep(3000);
  tell({ type: 'ui_ready' }); await sleep(1500);

  // the shortcut, as the shell reports it: the page is cleared (the shell told it already; the sidecar again), the
  // microphone closed, one log line with true/false only
  let from = out.length;
  tell({ type: 'stand_down', by: 'key' }); await sleep(800);
  assert.ok(page(from).some((m) => m.kind === 'stand' && m.on === true && m.clear === true), 'the page is told');
  assert.ok(shell(from).some((m) => m.type === 'listen_cancel'), 'the microphone is closed');
  assert.match(logText(), / stand_down \{"by":"key","speech":(true|false),"request":false,"pi":false,"window":false,"bubbles":false\}\n/);
  assert.equal(state().standDown.on, true, 'kept in state.json');
  tell({ type: 'stand_down', by: 'key' }); await sleep(300);
  assert.equal(logText().match(/ stand_down \{/g).length, 1, 'said again: one line still');

  // a calendar line about a block that ends while it lasts (put in as a sync would have left it)
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ ...state(), calendar: { ...state().calendar, held: [{ text: 'A placed block, now over.', until: Date.now() + 2000 }] } }));
  // the reminder comes due meanwhile (feature 25: a to-do would get a check-in): nothing is said or shown, and it is
  // not marked reminded
  from = out.length;
  await sleep(Math.max(0, dueAt - Date.now()) + 6000);
  assert.deepEqual(page(from).filter((m) => !['stand', 'queue'].includes(m.kind)).map((m) => m.kind), [], 'nothing went to the page');
  assert.ok(page(from).filter((m) => m.kind === 'queue').every((m) => m.n === 0), 'the quiet queue\'s count is hidden while stood down (feature 31)');
  assert.equal(reminded(), null, 'the nudge waits');
  assert.doesNotMatch(logText(), / nudge /);

  // a new page: the stood-down look, no greeting
  from = out.length;
  tell({ type: 'ui_ready' }); await sleep(1200);
  let kinds = page(from).map((m) => m.kind);
  assert.ok(kinds.includes('stand') && !kinds.includes('greet'), `a new page keeps it (${kinds.join(', ')})`);

  // a restart of the sidecar: still stood down
  await stop(); start(); await sleep(3000);
  from = out.length;
  tell({ type: 'ui_ready' }); await sleep(3000);
  kinds = page(from).map((m) => m.kind);
  assert.ok(page(from).some((m) => m.kind === 'stand' && m.on === true) && !kinds.includes('greet'), `a restart keeps it (${kinds.join(', ')})`);
  assert.equal(reminded(), null, 'and the nudge still waits');

  // a spoken request ends it: one line, the look back, the request answered (here: no model signed in), then the nudge
  from = out.length;
  tell({ type: 'voice_state', state: 'listening' }); tell({ type: 'voice_state', state: 'processing' });
  tell({ type: 'voice', text: 'what is on my list' }); tell({ type: 'voice_state', state: 'idle' });
  await waitFor(() => / stand_down_end /.test(logText()), 5000, 'it ends');
  assert.match(logText(), / stand_down_end \{"by":"voice","minutes":\d+,"held":1\}\n/, 'the late nudge is what was held');
  assert.ok(page(from).some((m) => m.kind === 'stand' && m.on === false), 'the look is back');
  assert.equal(state().standDown, undefined, 'ended: what it stopped is in the quiet queue');
  await waitFor(() => reminded() !== null, 30_000, 'the nudge is given late');
  // the line about what happened meanwhile, worded by the app: the calendar line went by, and its text never showed
  // feature 31: from the quiet queue, at the end of the exchange (limits.exchangeEndSeconds after the reply)
  await waitFor(() => / stand_down_said /.test(logText()), 45_000, 'the line is said');
  assert.match(logText(), / quiet_queued \{"kind":"calendarLine","why":"stood"\}\n/, 'it waited in the quiet queue');
  assert.match(logText(), / quiet_stale \{"kind":"calendarLine","n":1\}\n/);
  assert.ok(page(from).some((m) => m.kind === 'say' && m.text === 'While I stood down: 1 calendar line went by, its block over.'), 'the line');
  assert.ok(!page(from).some((m) => m.kind === 'say' && /now over/.test(m.text)), 'the dropped line itself is not shown');
  await waitFor(() => state().quiet.stood === null, 10_000, 'given: forgotten');
  assert.match(logText(), / nudge \{"todos":1,/);
  assert.ok(page(from).some((m) => m.kind === 'list'), 'with the list');

  // the phrase said alone, reaching the sidecar as words (the shell acts on it first; this is in case it does not)
  from = out.length;
  tell({ type: 'voice', text: 'Jarvis, stand down, please' }); await sleep(800);
  assert.match(logText(), / stand_down \{"by":"phrase",/);
  assert.ok(page(from).some((m) => m.kind === 'stand' && m.on === true));
  assert.doesNotMatch(logText(), /dentist|Jarvis, stand down/i, 'no words in the log');

  // the day turn (calendar.dayTurnsAt, 04:00): stood down since yesterday evening, with two calendar lines gone by
  const saidLines = () => (logText().match(/ stand_down_said /g) ?? []).length, saidBefore = saidLines();
  await stop();
  const since = new Date(); since.setDate(since.getDate() - 1); since.setHours(22, 0, 0, 0);
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ ...state(), standDown: { ...state().standDown, since: since.toISOString(), counts: { lines: 2 } } }));
  start(); await sleep(3000);
  tell({ type: 'ui_ready' }); await sleep(1500);
  from = out.length;
  await waitFor(() => / stand_down_end \{"by":"day",/.test(logText()), 40_000, 'it ends at the day turn');
  assert.ok(page(from).some((m) => m.kind === 'stand' && m.on === false), 'the look is back');
  // its line is not given then, nor while nothing is asked
  await sleep(8000);
  assert.equal(saidLines(), saidBefore, 'not at the day turn');
  assert.ok(!page(from).some((m) => ['say', 'speech'].includes(m.kind)), `nothing shown or said (${page(from).map((m) => m.kind).join(', ')})`);
  assert.equal(state().standDown, undefined); assert.deepEqual([state().quiet.due, state().quiet.stood], [false, { lines: 2 }], 'it waits, in state.json');
  // a typed request (no model is signed in: its reply is the app's own): once it is over, the line comes
  from = out.length;
  tell({ type: 'menu', id: 'ask' });
  await waitFor(() => page(from).some((m) => m.kind === 'ask' && m.bar), 3000, 'the ask field');
  tell({ type: 'answer', id: page(from).find((m) => m.kind === 'ask' && m.bar).id, text: 'what is on my list' });
  await waitFor(() => saidLines() > saidBefore, 15_000, 'the line after the exchange');
  const said = page(from).filter((m) => m.kind === 'say').map((m) => m.text);
  assert.ok(said.indexOf('While I stood down: 2 calendar lines went by, their blocks over.') > 0, `after the reply (${said.join(' | ')})`);
  assert.match(logText().split('\n').filter((l) => / stand_down_said /.test(l)).at(-1), / stand_down_said \{"chars":64,"caught":0,"said":(true|false),"review":false\}$/);
  await waitFor(() => state().quiet.stood === null, 10_000, 'given: forgotten');
} finally {
  await stop();
  fs.rmSync(home, { recursive: true, force: true });
}
console.log('stand down, the sidecar run: passed');
