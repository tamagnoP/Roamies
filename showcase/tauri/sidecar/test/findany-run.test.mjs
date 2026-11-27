// Feature 40, find a file anywhere and show its folder: the real sidecar, in a throwaway home folder, with a stand-in
// for the hands helper (fake-find-hands.mjs), one for the provider (bench/fake-model.mjs) and one for the local model
// server (fakelocal.mjs), and the shell and the page on its input. Run: npm run test:all. Nothing leaves the Mac. The
// clock-driven settings are off or far away (LESSONS.md).
//   - "Find the file budget" typed: the card (Library, Trash, Roamies' folder and a network drive left out), the line
//     with the count and the first two names; no request to either model; his words go to the helper on stdin.
//   - A click on the card's second row: that file shown in Finder (reveal with its path only).
//   - "Where is budget.xlsx?" said: the question is said with the count and the first two names, "the second one"
//     shows it; nothing else is said about it.
//   - Offline, "Which folder is the poster in?": the same by code, the local model not asked; a file that has gone.
//   - "Where is zzz.pdf?": nothing found, the limits said. "Where is my lab meeting?" goes the usual way.
//   - The next request takes the card down. The log has counts only; no name reached either model.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { startModel } from '../bench/fake-model.mjs';
import { startFakeLocal } from './fakelocal.mjs';

const SIDECAR = new URL('..', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Midnight would turn the day mid-run: a run that would cross it waits.
{ const d = new Date(), left = (24 * 60 - (d.getHours() * 60 + d.getMinutes())) * 60_000 - d.getSeconds() * 1000; if (left < 4 * 60_000) await sleep(left + 30_000); }
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'findany-run-')));
const record = path.join(home, 'hands-record.jsonl'), itemsFile = path.join(home, 'hands-items.json');
process.env.DUMP_BODY = '1';
const provider = []; const model = await startModel({ onRequest: (r) => provider.push(r), answer: (t) => (/lab meeting/.test(t) ? 'It is in room 2.' : null) });
const local = await startFakeLocal();
const env = { HOME: home, PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: 'en_US.UTF-8', ROAMIES_VERSION: '0.0.0', ROAMIES_HANDS: path.join(SIDECAR, 'test', 'fake-find-hands.mjs'), FIND_RECORD: record, FIND_ITEMS: itemsFile };
const file = (rel, text = 'x') => { const p = path.join(home, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return p; };
fs.mkdirSync(path.join(home, '.gg', 'sidekick'), { recursive: true });
const finance = file('Documents/Finance/budget.xlsx'), desk = file('Desktop/budget-2026.xlsx');
const poster = path.join(home, 'Desktop', 'Poster'); fs.mkdirSync(poster, { recursive: true });
const gone = path.join(home, 'Old', 'Poster drafts', 'poster-v1.pdf');
fs.writeFileSync(itemsFile, JSON.stringify({ drives: [], items: [
  { path: finance, kind: 'file', changed: 2 }, { path: desk, kind: 'file', changed: 1 },
  { path: file('Library/CloudStorage/Dropbox/budget.xlsx'), kind: 'file', changed: 9 }, { path: file('.Trash/budget.xlsx'), kind: 'file', changed: 9 },
  { path: file('Documents/roamies-pi/budget-notes.txt'), kind: 'file', changed: 9 }, { path: '/Volumes/Office/budget.xlsx', kind: 'file', changed: 9 },
  { path: poster, kind: 'folder', changed: 5 }, { path: gone, kind: 'file', changed: 1 },
] }));
execFileSync(process.execPath, ['--input-type=module', '-e', `
  import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
  import { AuthStorage } from '@kenkaiiii/gg-core';
  import { settingsDefaults } from './pi.mjs';
  await new AuthStorage().setCredentials('anthropic', { accessToken: 'test', refreshToken: '', expiresAt: Date.now() + 864e8, baseUrl: 'http://127.0.0.1:${model.port}' });
  const d = JSON.parse(JSON.stringify(settingsDefaults(os.homedir())));
  d.voiceEngine = 'system'; d.calendar.syncSeconds = 3600; d.calendar.reviewAt = ''; d.briefings = {}; d.local.address = '${local.address}';
  fs.writeFileSync(path.join(os.homedir(), 'Documents', 'roamies-pi', 'settings.json'), JSON.stringify(d, null, 2));
`], { cwd: SIDECAR, env, stdio: ['ignore', 'inherit', 'inherit'] });
fs.writeFileSync(path.join(home, 'Documents', 'roamies-pi', 'state.json'), JSON.stringify({ calendar: { started: true, adopt: true } }));
fs.writeFileSync(path.join(home, '.gg', 'sidekick.json'), JSON.stringify({ provider: 'anthropic', model: 'claude-haiku-5-5', sound: false, allowActions: false, voice: false, onboarded: true, onboardStep: 0, filesAsked: true, autoListen: false, setupVersion: 2, privacyAccepted: true }));

const out = [];
let side = null, net = true;
const tell = (m) => side.stdin.write(`${JSON.stringify(m)}\n`);
side = spawn(process.execPath, ['sidekick.mjs'], { cwd: SIDECAR, env, stdio: ['pipe', 'pipe', 'ignore'] });
readline.createInterface({ input: side.stdout }).on('line', (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  out.push({ at: Date.now(), m });
  if (m.type === 'ui' && m.msg?.kind === 'speech' && m.msg.mark) tell({ type: 'speech_mark', mark: m.msg.mark });
});
const beat = () => tell({ type: 'presence', idle: 1, mic: false, net });
const page = (from = 0) => out.slice(from).filter((o) => o.m.type === 'ui').map((o) => o.m.msg);
const logText = () => { const d = path.join(home, '.gg', 'sidekick', 'logs'); return fs.existsSync(d) ? fs.readdirSync(d).map((f) => fs.readFileSync(path.join(d, f), 'utf8')).join('') : ''; };
const lastKinds = () => logText().trim().split('\n').slice(-12).map((l) => l.split(' ').slice(0, 2).join(' ')).join(' | ');
const waitFor = async (ok, ms, what) => { const t0 = Date.now(); while (!ok() && Date.now() - t0 < ms) await sleep(100); assert.ok(ok(), `${what} (the log: ${lastKinds()})`); };
const calls = () => (fs.existsSync(record) ? fs.readFileSync(record, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []);
const ledger = () => { try { return fs.readFileSync(path.join(home, '.gg', 'sidekick', 'ledger.jsonl'), 'utf8').trim().split('\n').filter(Boolean); } catch { return []; } };
async function typed(text) {
  const from = out.length;
  tell({ type: 'menu', id: 'ask' });
  await waitFor(() => page(from).some((m) => m.kind === 'ask' && m.bar), 3000, 'the ask field');
  tell({ type: 'answer', id: page(from).find((m) => m.kind === 'ask' && m.bar).id, text });
}
const spoken = (text) => { tell({ type: 'voice_state', state: 'listening' }); tell({ type: 'voice_state', state: 'processing' }); tell({ type: 'voice', text }); tell({ type: 'voice_state', state: 'idle' }); };
const said = (from, re) => page(from).find((m) => m.kind === 'say' && re.test(m.text));
const card = (from) => page(from).find((m) => m.kind === 'found' && !m.close);
let timer = null;
try {
  timer = setInterval(beat, 1000);
  await sleep(2500); tell({ type: 'ui_ready' }); beat(); await sleep(500);
  const asked = () => provider.length + local.requests.length;
  const before = asked();

  // typed: the card, the line, nothing to either model; his words on the helper's stdin, never in its arguments
  let from = out.length;
  await typed('Find the file budget');
  await waitFor(() => card(from), 10_000, 'the card');
  let c = card(from);
  assert.deepEqual(c.rows.map((r) => [r.n, r.name, r.folder, r.where]), [[1, 'budget.xlsx', false, '~/Documents/Finance'], [2, 'budget-2026.xlsx', false, '~/Desktop']], 'Library, the Trash, Roamies\' folder and a network drive left out');
  assert.deepEqual([c.total, c.more, c.said], [2, 0, 'budget']); assert.ok(!JSON.stringify(c).includes(home), 'the page gets no full path');
  await waitFor(() => said(from, /^I found 2/), 5000, 'the line');
  assert.match(said(from, /^I found 2/).text, /^I found 2: budget\.xlsx and budget-2026\.xlsx\. Click one to show it in Finder(, sir)?\.$/); // the form of address is the persona's (feature 21a)
  assert.deepEqual(calls()[0].args, ['find']); assert.deepEqual(JSON.parse(calls()[0].input), { words: ['budget'], seconds: 3, max: 1000, drives: true });
  // a click on the second row: that file shown in Finder, by its path only
  from = out.length;
  tell({ type: 'found_pick', id: c.id, n: 2 });
  await waitFor(() => said(from, /^Showing/), 5000, 'the pick');
  assert.match(said(from, /^Showing/).text, /^Showing budget-2026\.xlsx in Finder(, sir)?\.$/);
  assert.deepEqual([calls()[1].args, JSON.parse(calls()[1].input)], [['reveal'], { path: desk }]);
  tell({ type: 'found_pick', id: c.id + 99, n: 1 }); await sleep(600); assert.equal(calls().length, 2, 'a click on an old card does nothing');

  // said: the question carries the count and the first two names; "the second one" shows it
  from = out.length;
  spoken('Where is budget.xlsx?');
  await waitFor(() => page(from).some((m) => m.kind === 'ask' && !m.bar), 10_000, 'the question');
  const q = page(from).find((m) => m.kind === 'ask' && !m.bar);
  assert.match(q.placeholder, /^I found 2: budget\.xlsx and budget-2026\.xlsx\. Which one should I show\?/);
  assert.deepEqual(q.choices, ['Show the first', 'None']);
  assert.ok(card(from), 'and the card');
  spoken('the second one');
  await waitFor(() => calls().length === 4, 5000, 'the reveal after "the second one"');
  assert.deepEqual(JSON.parse(calls()[3].input), { path: desk });
  await waitFor(() => said(from, /^Showing/), 5000, 'the pick\'s line');
  spoken('thanks'); await sleep(800); // the exchange ends: what follows is typed, not said

  // offline: decided by code all the same; the local model isn't asked. A file that has gone since says so.
  net = false; beat(); await sleep(1500);
  from = out.length;
  await typed('Which folder is the poster in?');
  await waitFor(() => card(from), 10_000, 'the offline card');
  c = card(from);
  assert.deepEqual(c.rows.map((r) => [r.name, r.folder, r.where]), [['Poster', true, '~/Desktop'], ['poster-v1.pdf', false, '~/Old/Poster drafts']]);
  await waitFor(() => said(from, /^I found 2/), 5000, 'the offline line');
  assert.match(said(from, /^I found 2/).text, /^I found 2: Poster folder and poster-v1\.pdf\. Click one to show it in Finder(, sir)?\.$/);
  from = out.length;
  tell({ type: 'found_pick', id: c.id, n: 2 });
  await waitFor(() => said(from, /isn't there any more/), 5000, 'gone');
  assert.match(said(from, /isn't there any more/).text, /^poster-v1\.pdf isn't there any more(, sir)?\.$/);
  net = true; beat(); await sleep(1500);

  // nothing found: the limits, plainly
  from = out.length;
  await typed('Where is zzz.pdf?');
  await waitFor(() => said(from, /^I found no/), 10_000, 'nothing found');
  assert.match(said(from, /^I found no/).text, /^I found no file called "zzz\.pdf"\. I look by name with Spotlight in your home folder and on your drives; hidden folders, ~\/Library and the folders you excluded from Spotlight/);
  assert.ok(page(from).some((m) => m.kind === 'found' && m.close), 'the card from before went with this request');
  assert.equal(asked(), before, 'no request to either model for any of it');
  assert.equal(ledger().length, 0, 'and no ledger line');

  // anything else goes the usual way
  from = out.length;
  await typed('Where is my lab meeting?');
  await waitFor(() => provider.length > 0, 20_000, 'the provider asked');
  assert.equal(calls().filter((x) => x.args[0] === 'find').length, 4, 'no search for it');

  // nothing of the searches reached the provider; the log has counts only
  assert.doesNotMatch(JSON.stringify(provider), /budget|poster|zzz|Finance/i);
  assert.doesNotMatch(logText(), /budget|poster|zzz|Finance|Desktop|Old/i);
  assert.match(logText(), / find_file \{"found":2,"shown":2,"leftOut":4,"otherKind":0,"ms":\d+,"drives":0,"timedOut":false\}/);
  assert.match(logText(), / find_pick \{"row":2,"by":"click"\}/); assert.match(logText(), / find_pick \{"row":2,"by":"voice"\}/);
  assert.match(logText(), / find_file \{"found":0,"shown":0,/);
  console.log('find a file anywhere, the sidecar run: passed');
} finally {
  clearInterval(timer);
  try { side?.kill('SIGKILL'); } catch { /* gone */ }
  model.close(); local.close();
  fs.rmSync(home, { recursive: true, force: true });
}
process.exit(0);
