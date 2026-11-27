// Feature 34, masking, on the API route: the real sidecar in a throwaway home folder, a stand-in for the provider that
// keeps every request body whole and answers with stand-ins only (mask-script.mjs), and one for the local model
// (fakelocal.mjs). Run: npm run test:all. Nothing leaves the Mac. The clock-driven settings are off or far away
// (LESSONS.md), but the evening briefing, which is due all day here, and a conversation from two days ago, so the
// first request hands it over. The masking list holds the owner's own name and the words below; they appear in:
// the conversation handed over, the instructions, a memory fact (the live state), a typed request (write_note), a
// spoken one (read_note), a file read (read_file), a fold, the handover's part two and the briefing.
//   - no listed word, in any case and with accents folded, is anywhere in what the provider got; nor in the log or the
//     ledger; the stand-ins are there; web search isn't offered; the instructions carry the masking sentence
//   - what is shown has the words and no stand-in; the note written, the daily note's handover, the facts and the
//     saved conversation have the words
//   - "search the web for …" gets the app's line and nothing is sent; the local model gets the words as they are
//   - after a word is added, the next request is masked with the new list, the earlier conversation with it
//   - "What left the Mac today?" says the swaps, counted
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { startFakeLocal } from './fakelocal.mjs';
import { answerFor } from './mask-script.mjs';
import { MASK_NOTE, WEB_OFF } from '../mask.mjs';

const SIDECAR = new URL('..', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
{ const d = new Date(), left = (24 * 60 - (d.getHours() * 60 + d.getMinutes())) * 60_000 - d.getSeconds() * 1000; if (left < 5 * 60_000) await sleep(left + 30_000); }
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mask-run-')));
const env = { HOME: home, PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: 'en_US.UTF-8', ROAMIES_VERSION: '0.0.0', ROAMIES_COMPACT_AT: '40' };
let me = os.userInfo().username; try { me = String(execFileSync('id', ['-F'])).trim().split(/\s+/)[0] || me; } catch { /* not macOS */ }
const WORDS = [me, 'Zorbina Quell', 'Fennick Labs', 'Halyard', 'Quellium'];
const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const listed = [{ from: 0, words: [...WORDS] }]; // the list as it was from each request on
const leaks = (text, words = WORDS) => words.filter((w) => fold(text).includes(fold(w)));

// ---- the stand-in provider: Anthropic's messages API, streamed; every body kept
const bodies = [];
let folded = false; // after the one fold, requests report few tokens, so there is no other
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => { raw += d; }).on('end', () => {
    bodies.push({ at: Date.now(), raw });
    let j = {}; try { j = JSON.parse(raw); } catch { /* not JSON */ }
    const system = JSON.stringify(j.system ?? ''), msgs = j.messages ?? [], last = msgs.at(-1);
    const parts = Array.isArray(last?.content) ? last.content : [{ type: 'text', text: String(last?.content ?? '') }];
    const result = parts.find((p) => p.type === 'tool_result');
    let afterTool = null;
    if (result) { for (const m of msgs) for (const p of Array.isArray(m.content) ? m.content : []) if (p.type === 'tool_use' && p.id === result.tool_use_id) afterTool = p.name; }
    const a = answerFor({ system, last: parts.filter((p) => p.type === 'text').map((p) => p.text).at(-1) ?? '', afterTool });
    if (/You compress the older part/.test(system)) folded = true;
    const usage = { input_tokens: folded ? 10 : Math.round(raw.length / 3.6), output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    const id = `msg_${bodies.length}`;
    ev('message_start', { message: { id, type: 'message', role: 'assistant', model: j.model, content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } } });
    if (a.tool) {
      ev('content_block_start', { index: 0, content_block: { type: 'tool_use', id: `toolu_${bodies.length}`, name: a.tool[0], input: {} } });
      ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(a.tool[1]) } });
      ev('content_block_stop', { index: 0 });
      ev('message_delta', { delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } });
      ev('message_stop', {});
      return res.end();
    }
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    const words = a.text.match(/\S+\s*/g) ?? [a.text]; // a stand-in split between pieces ("Person " | "2 ")
    let i = 0;
    const t = setInterval(() => {
      if (i < words.length) return ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: words[i++] } });
      clearInterval(t);
      ev('content_block_stop', { index: 0 });
      ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } });
      ev('message_stop', {});
      res.end();
    }, 15);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const local = await startFakeLocal({ answers: [{ content: 'She wants the figures by Friday.' }] });

// ---- the throwaway home
const dir = path.join(home, 'Documents', 'roamies-pi'), vault = path.join(home, 'Documents', 'roamies-vault');
fs.mkdirSync(path.join(home, '.gg', 'sidekick', 'sessions'), { recursive: true });
fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(vault, { recursive: true });
fs.mkdirSync(path.join(home, 'Projects', 'halyard'), { recursive: true });
fs.writeFileSync(path.join(home, 'Projects', 'halyard', 'notes.txt'), 'Fennick Labs owns the Halyard quellium data (file-marker-7).\n');
fs.writeFileSync(path.join(vault, 'Halyard plan.md'), 'ZORBINA QUELL at Fennick Labs leads Halyard; quellium samples (note-marker-9).\n');
execFileSync(process.execPath, ['--input-type=module', '-e', `
  import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
  import { AuthStorage } from '@kenkaiiii/gg-core';
  import { settingsDefaults } from './pi.mjs';
  import { newSession } from './store.mjs';
  await new AuthStorage().setCredentials('anthropic', { accessToken: 'test', refreshToken: '', expiresAt: Date.now() + 864e8, baseUrl: 'http://127.0.0.1:${port}' });
  const d = JSON.parse(JSON.stringify(settingsDefaults(os.homedir())));
  d.voiceEngine = 'system'; d.calendar.syncSeconds = 3600; d.calendar.reviewAt = ''; d.local.address = '${local.address}';
  d.project = '~/Projects/halyard'; d.projects = ['~/Projects/halyard']; d.briefings = { evening: '00:00' };
  d.mask = { people: [${JSON.stringify(me)}, { name: 'Zorbina Quell', also: ['Zorbina'] }], organisations: ['Fennick Labs'], projects: ['Halyard'], other: ['Quellium'] };
  fs.writeFileSync(path.join(os.homedir(), 'Documents', 'roamies-pi', 'settings.json'), JSON.stringify(d, null, 2));
  const s = newSession('anthropic', 'claude-haiku-5-5'), old = Date.now() - 2 * 864e5;
  s.startedAt = old; s.lastActiveAt = old;
  s.messages = [{ role: 'user', content: '[two days ago] Zorbina said the Halyard samples are late.' }, { role: 'assistant', content: [{ type: 'text', text: 'I will remember that Zorbina Quell is waiting on Fennick Labs.' }] }];
  fs.writeFileSync(path.join(os.homedir(), '.gg', 'sidekick', 'sessions', s.id + '.json'), JSON.stringify(s));
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
const ledgerText = () => { try { return fs.readFileSync(path.join(home, '.gg', 'sidekick', 'ledger.jsonl'), 'utf8'); } catch { return ''; } };
const ledger = () => ledgerText().trim().split('\n').filter(Boolean).map(JSON.parse);
const replied = (from) => page(from).some((m) => m.kind === 'agent' && m.e?.type === 'done');
const firstText = (from) => out.slice(from).find((o) => o.m.type === 'ui' && o.m.msg?.kind === 'agent' && o.m.msg.e?.type === 'text')?.at;
async function typed(text) {
  const from = out.length;
  tell({ type: 'menu', id: 'ask' });
  await waitFor(() => page(from).some((m) => m.kind === 'ask' && m.bar), 3000, 'the ask field');
  tell({ type: 'answer', id: page(from).find((m) => m.kind === 'ask' && m.bar).id, text });
  return Date.now();
}
const said = (text) => { tell({ type: 'voice_state', state: 'listening' }); tell({ type: 'voice_state', state: 'processing' }); tell({ type: 'voice', text }); tell({ type: 'voice_state', state: 'idle' }); };
const sessionsText = () => fs.readdirSync(path.join(home, '.gg', 'sidekick', 'sessions')).filter((f) => f.endsWith('.json') || f.endsWith('.folded.jsonl')).map((f) => fs.readFileSync(path.join(home, '.gg', 'sidekick', 'sessions', f), 'utf8')).join('\n');
let timer = null;
try {
  await sleep(2500); tell({ type: 'ui_ready' }); beat(); timer = setInterval(beat, 1000);

  // the briefing (a request the app makes) hands over the conversation from two days ago first: part two by the
  // provider, masked; the daily note gets it in his words; the new conversation starts with it
  await waitFor(() => / briefing \{"kind":"evening"\}/.test(logText()), 70_000, 'the evening briefing');
  await waitFor(() => / request_done /.test(logText()), 30_000, 'the briefing\'s reply');
  assert.match(logText(), / handover \{/, 'the handover was written');
  const handoverBody = bodies.find((b) => /end-of-day handover/.test(b.raw));
  assert.ok(handoverBody && /Person 2/.test(handoverBody.raw) && /Project 1/.test(handoverBody.raw), 'part two was asked with stand-ins');
  const daily = fs.readdirSync(path.join(vault, 'Daily')).map((f) => fs.readFileSync(path.join(vault, 'Daily', f), 'utf8')).join('\n');
  assert.match(daily, /Send Zorbina Quell the Halyard draft/); assert.match(daily, /Fennick Labs meets on Friday/); assert.doesNotMatch(daily, /Person 2|Project 1|Organisation 1/);

  // typed: a note written with the words back in its arguments; the reply shown in his words
  let from = out.length;
  await typed('Note that Zorbina Quell from Fennick Labs wants the Halyard quellium figures by Friday.');
  await waitFor(() => replied(from), 20_000, 'the reply after the note');
  const note = fs.readFileSync(path.join(vault, 'Zorbina Quell figures.md'), 'utf8');
  assert.match(note, /Zorbina Quell from Fennick Labs wants the Halyard quellium figures by Friday\./); assert.doesNotMatch(note, /Person|Organisation 1|Project 1|Term 1/);
  assert.match(shown(from), /Noted: Zorbina Quell wants the Halyard figures from Fennick Labs\./); assert.doesNotMatch(shown(from), /Person 2|Project 1|Organisation 1/);
  assert.ok(page(from).some((m) => m.kind === 'agent' && m.e?.type === 'tool'), 'the tool tag');
  const noteLine = ledger().filter((l) => l.kind === 'request').at(-1);
  assert.ok(noteLine.swaps >= 4 && noteLine.swapsBack >= 7, `the ledger counts the swaps (${noteLine.swaps}, ${noteLine.swapsBack})`);

  // spoken: a note read; its text goes masked; the reply in his words
  from = out.length;
  said('What does the Halyard plan say?');
  await waitFor(() => replied(from), 20_000, 'the reply after the read');
  const readBody = bodies.findLast((b) => /note-marker-9/.test(b.raw));
  assert.ok(readBody && /PERSON 2 at Organisation 1 leads Project 1; term 1 samples/.test(readBody.raw), 'the note\'s text went masked, case kept');
  assert.match(shown(from), /It says Zorbina Quell leads Halyard at Fennick Labs\./);

  // typed: a file read; its path and text go masked
  from = out.length;
  await typed('Read notes.txt');
  await waitFor(() => replied(from), 20_000, 'the reply after the file');
  const fileBody = bodies.findLast((b) => /file-marker-7/.test(b.raw));
  assert.ok(fileBody && /~\/Projects\/project 1\/notes\.txt/.test(fileBody.raw) && /Organisation 1 owns the Project 1 term 1 data/.test(fileBody.raw), 'the file\'s path and text went masked');
  assert.match(shown(from), /The file says Fennick Labs owns the Halyard data\./);

  // the fold (ROAMIES_COMPACT_AT is tiny here): asked masked; its summary and facts kept in his words
  await waitFor(() => / compacted \{/.test(logText()), 30_000, 'the fold');
  assert.ok(bodies.some((b) => /You compress the older part/.test(b.raw) && /Person 2/.test(b.raw)), 'the fold was asked with stand-ins');
  const facts = fs.readFileSync(path.join(home, '.gg', 'sidekick', 'memory.json'), 'utf8');
  assert.match(facts, new RegExp(`${me} works with Zorbina Quell on Halyard\\.`)); assert.doesNotMatch(facts, /Person \d|Project 1/);
  assert.match(sessionsText(), /Zorbina Quell asked .* about Halyard at Fennick Labs, and it was noted\./);

  // web search asked for: the app's line, nothing sent
  from = out.length;
  let n = bodies.length;
  await typed('search the web for Fennick Labs');
  await waitFor(() => page(from).some((m) => m.kind === 'say' && m.text.startsWith(WEB_OFF.slice(0, 40))), 10_000, 'the web search line');
  await sleep(800); assert.equal(bodies.length, n, 'nothing went to the provider');

  // private: the local model, with his words as they are; nothing to the provider
  from = out.length; n = bodies.length;
  await typed('privately, what does Zorbina Quell want?');
  await waitFor(() => page(from).some((m) => m.kind === 'say' && /figures by Friday/.test(m.text)), 20_000, 'the local reply');
  assert.ok(local.requests.some((r) => JSON.stringify(r).includes('Zorbina Quell')), 'the local model got the words as they are');
  await sleep(500); assert.equal(bodies.length, n, 'nothing went to the provider');

  // the list changes: a word added; the next request, and the earlier conversation in it, masked with the new list.
  // Measured: the time to the first text and how much of each request is the same from the start as the one before
  // (in the order the provider caches: tools, instructions, messages), for a request with no change, then after a
  // word that isn't in the conversation is added, then after one that is.
  const cacheOrder = (raw) => { const j = JSON.parse(raw), plain = (v) => JSON.stringify(v ?? null, (k, x) => (k === 'cache_control' ? undefined : x)); return plain(j.tools) + plain(j.system) + plain(j.messages); };
  const mainBodies = () => bodies.filter((b) => JSON.parse(b.raw).tools?.length);
  const prefix = (a, b) => { let i = 0; while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++; return i; };
  const step = async (text) => { const f = out.length, k = mainBodies().length, t0 = await typed(text); await waitFor(() => replied(f), 20_000, `the reply to "${text}"`); const prev = cacheOrder(mainBodies()[k - 1].raw), now = cacheOrder(mainBodies()[k].raw); return { from: f, ms: firstText(f) - t0, same: prefix(prev, now), of: now.length, raw: mainBodies()[k].raw }; };
  await step('What comes next?');
  const plainStep = await step('And after that?');
  const settingsFile = path.join(dir, 'settings.json'), set = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  set.mask.other.push('Gorvane'); fs.writeFileSync(settingsFile, JSON.stringify(set, null, 2)); listed.push({ from: bodies.length, words: [...WORDS, 'Gorvane'] });
  const added = await step('Tell me about Gorvane, the Halyard and quellium.');
  assert.match(added.raw, /Tell me about Term 2, the Project 1 and term 1\./); assert.match(added.raw, /PERSON 2 at Organisation 1 leads Project 1; term 1 samples/, 'the earlier conversation is in it, masked');
  assert.match(shown(added.from), /Gorvane is noted, with Zorbina Quell and Fennick Labs\./);
  assert.match(logText(), / mask_list \{"entries":6,"ignored":0\}/); assert.match(logText(), / mask_changed \{"transcriptDeleted":false\}/);
  set.mask.other.push('samples'); fs.writeFileSync(settingsFile, JSON.stringify(set, null, 2)); listed.push({ from: bodies.length, words: [...WORDS, 'Gorvane', 'samples'] });
  const inside = await step('And the samples?');
  assert.match(inside.raw, /And the term 3\?/); assert.match(inside.raw, /leads Project 1; term 1 term 3 \(note-marker-9\)/, 'the earlier conversation, masked with the new word');
  for (const [what, r] of [['no change', plainStep], ['a word added that is not in the conversation', added], ['a word added that is in it', inside]]) console.log(`  measured, API route, ${what}: ${r.ms} ms to the first text; ${r.same} of ${r.of} characters the same from the start as the request before`);
  assert.ok(added.same > added.of * 0.9, 'a word not in the conversation: the cache keeps nearly all of it');
  assert.ok(inside.same < plainStep.same, 'a word in it: the cache misses from the first message that holds it');
  WORDS.push('samples', 'Gorvane');

  // what left the Mac: the swaps, counted
  from = out.length;
  await typed('What left the Mac today?');
  await waitFor(() => page(from).some((m) => m.kind === 'say' && /^Sent to anthropic today/.test(m.text)), 10_000, 'the app\'s answer');
  assert.match(page(from).find((m) => m.kind === 'say' && /^Sent to anthropic today/.test(m.text)).text, /Private words swapped for stand-ins: \d[\d,]* times in \d+ requests \(\d[\d,]* swapped back\)\./);

  // everything the provider got: no listed word anywhere; the instructions masked, with the sentence; no web search
  assert.ok(bodies.length >= 8, `requests made: ${bodies.length}`);
  bodies.forEach((b, i) => assert.deepEqual(leaks(b.raw, listed.findLast((l) => l.from <= i).words), [], `a request body held a word listed when it was sent: ${b.raw.slice(0, 200)}`));
  const main = bodies.map((b) => JSON.parse(b.raw)).filter((j) => j.tools?.length);
  assert.ok(main.length >= 6);
  for (const j of main) {
    const sys = JSON.stringify(j.system);
    assert.ok(sys.includes(JSON.stringify(MASK_NOTE).slice(1, -1)), 'the masking sentence'); assert.match(sys, /Person 1/, 'his own name, masked');
    assert.ok(!JSON.stringify(j.tools).includes('web_search'), 'no web search while the list has words');
  }
  // what is kept on the Mac: in his words; the log and the ledger: no word
  assert.match(sessionsText(), /Note that Zorbina Quell from Fennick Labs wants the Halyard quellium figures by Friday\./);
  assert.match(sessionsText(), /The file says Fennick Labs owns the Halyard data\./);
  assert.deepEqual(leaks(logText()), [], 'the log'); assert.deepEqual(leaks(ledgerText()), [], 'the ledger');
  assert.doesNotMatch(logText(), /Person \d|Organisation \d|Project \d|Term \d/, 'nor a stand-in');
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  assert.deepEqual(state.masks.numbers.other, { quellium: 1, gorvane: 2, samples: 3 });
  console.log('masking, the API route, the sidecar run: passed');
} finally {
  clearInterval(timer);
  try { side?.kill('SIGKILL'); } catch { /* gone */ }
  server.close(); await local.close();
  fs.rmSync(home, { recursive: true, force: true });
}
process.exit(0);
