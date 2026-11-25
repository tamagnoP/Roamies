// Feature 24, fix 6: the real sidecar, in a throwaway home folder, with "limits.pageRebuildQuietMinutes" at 1 and a
// stand-in for the page on its input. Run: npm run test:all (about three minutes; not in npm test). No model is
// signed in and nothing leaves the Mac: the sidecar is only told what a page would tell it. A hand-off is kept in
// state.json as a pending question from the start: it does not hold the rebuild off, and it is raised after it.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const SIDECAR = new URL('..', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rebuild-run-')));
const env = { HOME: home, PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: 'en_US.UTF-8', ROAMIES_VERSION: '0.0.0' };
fs.mkdirSync(path.join(home, '.gg'), { recursive: true });
fs.mkdirSync(path.join(home, 'Documents', 'roamies-pi'), { recursive: true });
execFileSync(process.execPath, ['--input-type=module', '-e', `
  import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
  import { loadSettings, settingsDefaults } from './pi.mjs';
  const d = JSON.parse(JSON.stringify(settingsDefaults(os.homedir())));
  d.voiceEngine = 'system'; d.limits.pageRebuildQuietMinutes = 1;
  d.calendar.syncSeconds = 3600; // no sync during the run: with Super Productivity open, its failure in this home is a bubble
  d.calendar.reviewAt = ''; // the day's review only when asked: at its time (18:00 by default) its line is shown and restarts the quiet minute
  const dir = path.join(os.homedir(), 'Documents', 'roamies-pi');
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(d, null, 2));
  const { project } = loadSettings(os.homedir());
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ pending: [{ id: 'qkept1', at: new Date().toISOString(), kind: 'handoff', brief: 'For pi, read only: list the files here', data: { prompt: 'List the files here.', mode: 'read', followUp: false, project } }] }));
`], { cwd: SIDECAR, env, stdio: ['ignore', 'inherit', 'inherit'] });
fs.writeFileSync(path.join(home, '.gg', 'sidekick.json'), JSON.stringify({ sound: false, allowActions: false, voice: false, onboarded: true, onboardStep: 0, filesAsked: true, autoListen: false, setupVersion: 2, size: 'default', look: 'jarvis', introDone: true, replies: 'text' }));

const side = spawn(process.execPath, ['sidekick.mjs'], { cwd: SIDECAR, env, stdio: ['pipe', 'pipe', 'ignore'] });
const out = [];
const tell = (m) => side.stdin.write(`${JSON.stringify(m)}\n`);
readline.createInterface({ input: side.stdout }).on('line', (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  out.push({ at: Date.now(), m });
  if (m.type === 'ui' && m.msg?.kind === 'speech' && m.msg.mark) tell({ type: 'speech_mark', mark: m.msg.mark }); // the page has played it
});
const logText = () => { const d = path.join(home, '.gg', 'sidekick', 'logs'); return fs.readdirSync(d).map((f) => fs.readFileSync(path.join(d, f), 'utf8')).join(''); };
const keptQuestions = () => JSON.parse(fs.readFileSync(path.join(home, 'Documents', 'roamies-pi', 'state.json'), 'utf8')).pending ?? [];
const page = (from) => out.slice(from).filter((o) => o.m.type === 'ui').map((o) => o.m.msg);
const asked = (from) => out.slice(from).find((o) => o.m.type === 'rebuild_overlays');
try {
  await sleep(3000);
  // an ordinary start: the page is greeted
  let from = out.length;
  tell({ type: 'ui_ready' }); await sleep(1500);
  assert.deepEqual(page(from).map((m) => m.kind).filter((k) => ['sound', 'size', 'home', 'look', 'greet', 'settle'].includes(k)), ['sound', 'size', 'home', 'look', 'greet'], 'an ordinary start is greeted');

  // the list shown, the page busy and then at rest again: a rebuild one quiet minute later, checked every 15 s
  tell({ type: 'show_list' }); await sleep(500);
  assert.ok(page(from).some((m) => m.kind === 'list'), 'something was shown');
  tell({ type: 'page_rest', on: false }); await sleep(300);
  from = out.length;
  const restAt = Date.now();
  tell({ type: 'page_rest', on: true, keep: { spin: 2.75 } });
  while (!asked(from) && Date.now() - restAt < 100_000) await sleep(200);
  const ask = asked(from);
  // Not asked for: what the activity log says happened meanwhile (its kinds and times), to see what broke the quiet.
  if (!ask) console.error(`rebuild-run: no rebuild ${((Date.now() - restAt) / 1000).toFixed(0)} s after rest. The log:\n${logText().split('\n').filter(Boolean).map((l) => l.split(' ').slice(0, 2).join(' ')).join('\n')}`);
  assert.ok(ask, 'the rebuild is asked for');
  const after = (ask.at - restAt) / 1000;
  assert.ok(after >= 59 && after <= 77, `one quiet minute, give or take a check (${after.toFixed(1)} s)`);

  // the new page reports ready: its settings, then settle with the globe as it was, and no greeting
  from = out.length;
  tell({ type: 'ui_ready' }); await sleep(1500);
  const sent = page(from).filter((m) => ['sound', 'size', 'home', 'look', 'greet', 'settle'].includes(m.kind));
  assert.deepEqual(sent.map((m) => m.kind), ['sound', 'size', 'home', 'look', 'settle'], 'a rebuilt page is not greeted');
  assert.equal(sent.at(-1).spin, 2.75);
  const log = logText();
  assert.match(log, / page_rebuild \{"quietMinutes":1\}\n/); assert.match(log, / page_rebuilt \{"ms":\d+\}\n/);
  assert.deepEqual(keptQuestions().map((q) => q.id), ['qkept1'], 'the kept question did not hold the rebuild off, and is still kept');
  assert.doesNotMatch(log, / pending_raised /, 'nor was it raised by the rebuild');

  // the new page at rest, nothing shown since (its settings and settle do not count): no second rebuild
  from = out.length;
  tell({ type: 'page_rest', on: true, keep: { spin: 2.75 } }); await sleep(78_000);
  assert.equal(asked(from), undefined, 'nothing shown since the last rebuild');

  // the next exchange ends on the new page (a closing phrase, which the app answers itself): the kept question is
  // raised as before, its Send bubble on the new page
  from = out.length;
  tell({ type: 'page_rest', on: false });
  tell({ type: 'voice', text: 'thanks' });
  const t0 = Date.now();
  while (!/ pending_raised \{"kind":"handoff"\}/.test(logText()) && Date.now() - t0 < 30_000) await sleep(200);
  assert.match(logText(), / exchange_end \{"by":"phrase"\}/, 'the exchange ended');
  assert.match(logText(), / pending_raised \{"kind":"handoff"\}/, 'the kept question is raised after the rebuild');
  await sleep(500);
  assert.ok(page(from).some((m) => m.kind === 'ask' && /List the files here\./.test(m.placeholder ?? '')), 'its Send bubble is on the new page');
} finally {
  side.stdin.end(); await sleep(1000); try { side.kill('SIGKILL'); } catch { /* gone */ }
  fs.rmSync(home, { recursive: true, force: true });
}
console.log('page rebuild, the sidecar run: passed');
