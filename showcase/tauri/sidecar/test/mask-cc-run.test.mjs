// Feature 34, masking, on Claude's route ("Sign in with Claude"): the real sidecar in a throwaway home folder, with a
// stand-in for the claude program (fake-claude.mjs, through ROAMIES_FAKE_CLAUDE) that gets what the program would:
// the instructions, our tools over the MCP bridge, each request, the earlier conversation when a session starts fresh,
// the tool results; and that keeps a transcript per session under CLAUDE_CONFIG_DIR/projects/ as the program does.
// Run: npm run test:all. Nothing leaves the Mac; the clock-driven settings are off or far away (LESSONS.md).
//   - no listed word reaches the program (instructions, tool descriptions, requests, tool results) or its transcripts
//   - a note written through the bridge is saved in his words; what is shown is in his words
//   - after a word is added, the program starts a fresh session (no resume), seeded with the conversation masked
//     with the new list, and the transcript of the session it replaces is deleted
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { MASK_NOTE } from '../mask.mjs';

const SIDECAR = new URL('..', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
{ const d = new Date(), left = (24 * 60 - (d.getHours() * 60 + d.getMinutes())) * 60_000 - d.getSeconds() * 1000; if (left < 4 * 60_000) await sleep(left + 30_000); }
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mask-cc-run-')));
const record = path.join(home, 'fake-claude.jsonl');
const env = { HOME: home, PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: 'en_US.UTF-8', ROAMIES_VERSION: '0.0.0', ROAMIES_FAKE_CLAUDE: path.join(SIDECAR, 'test', 'fake-claude.mjs'), FAKE_CLAUDE_RECORD: record };
let me = os.userInfo().username; try { me = String(execFileSync('id', ['-F'])).trim().split(/\s+/)[0] || me; } catch { /* not macOS */ }
const WORDS = [me, 'Zorbina Quell', 'Fennick Labs', 'Halyard', 'Quellium'];
const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const leaks = (text, words) => words.filter((w) => fold(text).includes(fold(w)));

const dir = path.join(home, 'Documents', 'roamies-pi'), vault = path.join(home, 'Documents', 'roamies-vault');
const transcripts = path.join(home, '.gg', 'claude-code', 'config', 'projects');
fs.mkdirSync(path.join(home, '.gg', 'sidekick'), { recursive: true });
fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(vault, { recursive: true });
fs.mkdirSync(path.join(home, 'Projects', 'halyard'), { recursive: true });
fs.writeFileSync(path.join(home, 'Projects', 'halyard', 'notes.txt'), 'Fennick Labs owns the Halyard quellium data (file-marker-7).\n');
execFileSync(process.execPath, ['--input-type=module', '-e', `
  import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
  import { AuthStorage } from '@kenkaiiii/gg-core';
  import { settingsDefaults } from './pi.mjs';
  await new AuthStorage().setCredentials('anthropic', { accessToken: 'test', refreshToken: '', expiresAt: Date.now() + 864e8, baseUrl: 'http://127.0.0.1:9' }); // never used: the route is the stand-in program
  const d = JSON.parse(JSON.stringify(settingsDefaults(os.homedir())));
  d.voiceEngine = 'system'; d.calendar.syncSeconds = 3600; d.calendar.reviewAt = '';
  d.project = '~/Projects/halyard'; d.projects = ['~/Projects/halyard'];
  d.mask = { people: [${JSON.stringify(me)}, 'Zorbina Quell'], organisations: ['Fennick Labs'], projects: ['Halyard'], other: ['Quellium'] };
  fs.writeFileSync(path.join(os.homedir(), 'Documents', 'roamies-pi', 'settings.json'), JSON.stringify(d, null, 2));
`], { cwd: SIDECAR, env, stdio: ['ignore', 'inherit', 'inherit'] });
fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ calendar: { started: true, adopt: true } }));
fs.writeFileSync(path.join(home, '.gg', 'sidekick', 'memory.json'), JSON.stringify({ version: 1, commitments: [], facts: [{ id: 'f1', text: `${me} works with Zorbina Quell at Fennick Labs.`, createdAt: Date.now() }] }));
fs.writeFileSync(path.join(home, '.gg', 'sidekick.json'), JSON.stringify({ provider: 'anthropic', model: 'claude-haiku-5-5', sound: false, allowActions: false, voice: false, onboarded: true, onboardStep: 0, filesAsked: true, autoListen: false, setupVersion: 2, size: 'default', look: 'jarvis', introDone: true }));

const out = [];
let side = null;
const tell = (m) => side.stdin.write(`${JSON.stringify(m)}\n`);
side = spawn(process.execPath, ['sidekick.mjs'], { cwd: SIDECAR, env, stdio: ['pipe', 'pipe', 'ignore'] });
readline.createInterface({ input: side.stdout }).on('line', (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  out.push({ at: Date.now(), m });
  if (m.type === 'ui' && m.msg?.kind === 'speech' && m.msg.mark) tell({ type: 'speech_mark', mark: m.msg.mark });
});
const beat = () => tell({ type: 'presence', idle: 1, mic: false, net: true });
const page = (from = 0) => out.slice(from).filter((o) => o.m.type === 'ui').map((o) => o.m.msg);
const shown = (from = 0) => page(from).map((m) => (m.kind === 'agent' && m.e?.type === 'text' ? m.e.text : m.kind === 'say' ? `\n${m.text}\n` : '')).join('');
const logText = () => { const d = path.join(home, '.gg', 'sidekick', 'logs'); return fs.existsSync(d) ? fs.readdirSync(d).map((f) => fs.readFileSync(path.join(d, f), 'utf8')).join('') : ''; };
const lastKinds = () => logText().trim().split('\n').slice(-14).map((l) => l.split(' ').slice(0, 2).join(' ')).join(' | ');
const waitFor = async (ok, ms, what) => { const t0 = Date.now(); while (!ok() && Date.now() - t0 < ms) await sleep(100); assert.ok(ok(), `${what} (the log: ${lastKinds()})`); };
const runs = () => { try { return fs.readFileSync(record, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };
const replied = (from) => page(from).some((m) => m.kind === 'agent' && m.e?.type === 'done');
const firstText = (from) => out.slice(from).find((o) => o.m.type === 'ui' && o.m.msg?.kind === 'agent' && o.m.msg.e?.type === 'text')?.at;
const kept = () => (fs.existsSync(transcripts) ? fs.readdirSync(transcripts).flatMap((d) => fs.readdirSync(path.join(transcripts, d)).map((f) => path.join(transcripts, d, f))) : []);
async function typed(text) {
  const from = out.length, k = runs().length;
  tell({ type: 'menu', id: 'ask' });
  await waitFor(() => page(from).some((m) => m.kind === 'ask' && m.bar), 3000, 'the ask field');
  const t0 = Date.now();
  tell({ type: 'answer', id: page(from).find((m) => m.kind === 'ask' && m.bar).id, text });
  await waitFor(() => replied(from), 20_000, `the reply to "${text}"`);
  await waitFor(() => runs().length > k, 5000, 'the run recorded');
  return { from, ms: firstText(from) - t0, run: runs().at(-1) };
}
let timer = null;
try {
  await sleep(2500); tell({ type: 'ui_ready' }); beat(); timer = setInterval(beat, 1000);

  // typed: a note written through the bridge, with the words back in its arguments; the reply in his words
  const noted = await typed('Note that Zorbina Quell from Fennick Labs wants the Halyard quellium figures by Friday.');
  assert.match(fs.readFileSync(path.join(vault, 'Zorbina Quell figures.md'), 'utf8'), /Zorbina Quell from Fennick Labs wants the Halyard quellium figures by Friday\./);
  assert.match(shown(noted.from), /Noted: Zorbina Quell wants the Halyard figures from Fennick Labs\./); assert.doesNotMatch(shown(noted.from), /Person 2|Project 1/);
  assert.equal(noted.run.resume, null, 'the first request: a session of its own');
  assert.match(noted.run.input.map((b) => b.text).join('\n'), /Note that Person 2 from Organisation 1 wants the Project 1 term 1 figures by Friday\./);
  assert.match(JSON.stringify(noted.run.results), /Saved the note \\"Person 2 figures\\"/, 'the tool result went back masked');
  assert.ok(noted.run.system.includes(MASK_NOTE) && /Person 1/.test(noted.run.system), 'the instructions: masked, with the sentence');
  assert.ok(noted.run.tools.length > 5, 'our tools over the bridge');

  // typed: a file read; its path and text go back masked; the session goes on (resumed)
  const read = await typed('Read notes.txt');
  assert.equal(read.run.resume, noted.run.sid, 'the same session, resumed');
  assert.match(JSON.stringify(read.run.results), /~\/Projects\/project 1\/notes\.txt[^"]*Organisation 1 owns the Project 1 term 1 data/);
  assert.match(shown(read.from), /The file says Fennick Labs owns the Halyard data\./);
  const plain = await typed('What comes next?');
  assert.equal(plain.run.resume, noted.run.sid);
  assert.equal(kept().length, 1, 'one transcript so far');
  const oldTranscript = kept()[0];

  // the list changes: a fresh session, seeded with the conversation masked with the new list; the old transcript goes
  const settingsFile = path.join(dir, 'settings.json'), set = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  set.mask.other.push('Gorvane'); fs.writeFileSync(settingsFile, JSON.stringify(set, null, 2));
  const changed = await typed('Tell me about Gorvane and the Halyard.');
  assert.equal(changed.run.resume, null, 'not resumed');
  const seed = changed.run.input.map((b) => b.text).join('\n');
  assert.match(seed, /<conversation_so_far>[\s\S]*Note that Person 2 from Organisation 1 wants the Project 1 term 1 figures[\s\S]*<\/conversation_so_far>/, 'seeded with the earlier conversation, masked');
  assert.match(seed, /Tell me about Term 2 and the Project 1\./);
  assert.match(shown(changed.from), /Gorvane is noted, with Zorbina Quell and Fennick Labs\./);
  assert.ok(!fs.existsSync(oldTranscript), 'the replaced session\'s transcript was deleted');
  assert.match(logText(), / mask_changed \{"transcriptDeleted":true\}/);
  const after = await typed('And after that?');
  assert.equal(after.run.resume, changed.run.sid, 'the fresh session goes on');
  console.log(`  measured, Claude's route: a resumed request ${plain.ms} ms to the first text, sending ${plain.run.input.map((b) => b.text).join('').length} characters; the first after a word was added ${changed.ms} ms, sending ${seed.length} characters (the conversation again)`);

  // what left the Mac: the swaps, counted
  const from = out.length;
  tell({ type: 'menu', id: 'ask' }); await waitFor(() => page(from).some((m) => m.kind === 'ask' && m.bar), 3000, 'the ask field');
  tell({ type: 'answer', id: page(from).find((m) => m.kind === 'ask' && m.bar).id, text: 'What left the Mac today?' });
  await waitFor(() => page(from).some((m) => m.kind === 'say' && /^Sent to claude-code today/.test(m.text)), 10_000, 'the app\'s answer');
  assert.match(page(from).find((m) => m.kind === 'say' && /^Sent to claude-code today/.test(m.text)).text, /Private words swapped for stand-ins: \d[\d,]* times in 3 requests \(\d[\d,]* swapped back\)\./);

  // everything the program got and kept: no word listed at the time
  const all = runs();
  assert.equal(all.length, 5);
  all.forEach((r, i) => assert.deepEqual(leaks(JSON.stringify(r), i < 3 ? WORDS : [...WORDS, 'Gorvane']), [], `run ${i + 1} held a listed word`));
  for (const f of kept()) assert.deepEqual(leaks(fs.readFileSync(f, 'utf8'), [...WORDS, 'Gorvane']), [], 'a transcript held a listed word');
  assert.deepEqual(leaks(logText(), [...WORDS, 'Gorvane']), [], 'the log');
  console.log('masking, Claude\'s route, the sidecar run: passed');
} finally {
  clearInterval(timer);
  try { side?.kill('SIGKILL'); } catch { /* gone */ }
  fs.rmSync(home, { recursive: true, force: true });
}
process.exit(0);
