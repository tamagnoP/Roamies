// Feature 33, stand down: the real sidecar, in a throwaway home folder, with a stand-in for the shell and the page on
// its input. Run: npm run test:all (about a minute; not in npm test). No model is signed in and nothing leaves the Mac.
//   - the shell's stand_down (the shortcut): the page is cleared, the microphone closed, one log line;
//   - a to-do that comes due meanwhile is not nudged, nothing is shown, and the state is in state.json;
//   - a new page, and a restart of the sidecar, keep it (the stood-down look, no greeting);
//   - a spoken request ends it: one log line, the look back, the late nudge, and the line worded by the app for what
//     happened meanwhile (a calendar line whose block ended went by).
//   - the phrase said alone, when it reaches the sidecar as words, stands it down too.
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
fs.writeFileSync(path.join(home, '.gg', 'sidekick', 'memory.json'), JSON.stringify({ version: 1, commitments: [{ id: 'c1', text: 'Call the dentist', due: dueAt, createdAt: Date.now(), status: 'open', remindedAt: null, kind: 'commitment' }], facts: [] }));
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
const waitFor = async (ok, ms, what) => { const t0 = Date.now(); while (!ok() && Date.now() - t0 < ms) await sleep(200); assert.ok(ok(), what); };
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
  // the to-do comes due meanwhile: nothing is said or shown, and it is not marked reminded
  from = out.length;
  await sleep(Math.max(0, dueAt - Date.now()) + 6000);
  assert.deepEqual(page(from).filter((m) => !['stand'].includes(m.kind)).map((m) => m.kind), [], 'nothing went to the page');
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
  assert.equal(state().standDown.on, false);
  await waitFor(() => reminded() !== null, 30_000, 'the nudge is given late');
  // the line about what happened meanwhile, worded by the app: the calendar line went by, and its text never showed
  await waitFor(() => / stand_down_said /.test(logText()), 15_000, 'the line is said');
  assert.match(logText(), / calendar_held_passed \{"lines":1\}\n/);
  assert.ok(page(from).some((m) => m.kind === 'say' && m.text === 'While I stood down: 1 calendar line went by, its block over.'), 'the line');
  assert.ok(!page(from).some((m) => m.kind === 'say' && /now over/.test(m.text)), 'the dropped line itself is not shown');
  await waitFor(() => state().standDown === undefined, 10_000, 'given: forgotten');
  assert.match(logText(), / nudge \{"todos":1,/);
  assert.ok(page(from).some((m) => m.kind === 'list'), 'with the list');

  // the phrase said alone, reaching the sidecar as words (the shell acts on it first; this is in case it does not)
  from = out.length;
  tell({ type: 'voice', text: 'Jarvis, stand down, please' }); await sleep(800);
  assert.match(logText(), / stand_down \{"by":"phrase",/);
  assert.ok(page(from).some((m) => m.kind === 'stand' && m.on === true));
  assert.doesNotMatch(logText(), /dentist|Jarvis, stand down/i, 'no words in the log');
} finally {
  await stop();
  fs.rmSync(home, { recursive: true, force: true });
}
console.log('stand down, the sidecar run: passed');
