// Feature 14, Roamies reads files at the owner's request: the real sidecar, in a throwaway home folder, with a
// stand-in for the provider (bench/fake-model.mjs) that answers each request by calling the next file tool in TOOLS,
// and the shell and the page on its input. Run: npm run test:all. Nothing leaves the Mac. The clock-driven settings
// are off or far away (LESSONS.md), but the evening briefing, which is due all day here.
//   - The evening briefing (a request the app makes) calls read_file: refused, nothing read, nothing counted.
//   - "Read segment.py" typed: read without a bubble (his words name it); the provider gets its text; the request's
//     ledger line counts one file text; the bubble's tag names the file.
//   - "What does the loader do?" typed: a bubble names exactly the file; a no reads nothing.
//   - The same, answered yes: read.
//   - "What left the Mac today?" says the file texts; the activity log holds no path, file name or file text.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const SIDECAR = new URL('..', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Midnight would start a new day mid-run (a second evening briefing, a day turn): a run that would cross it waits.
{ const d = new Date(), left = (24 * 60 - (d.getHours() * 60 + d.getMinutes())) * 60_000 - d.getSeconds() * 1000; if (left < 4 * 60_000) await sleep(left + 30_000); }
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'files-run-')));
const dump = fs.mkdtempSync(path.join(os.tmpdir(), 'files-run-dump-'));
process.env.DUMP = dump; process.env.DRAW = '1';
process.env.TOOLS = JSON.stringify([['read_file', { path: 'segment.py' }], ['read_file', { path: 'segment.py' }], ['read_file', { path: 'src/dataLoader.py' }], ['read_file', { path: 'src/dataLoader.py' }]]);
const { startModel } = await import('../bench/fake-model.mjs');
const env = { HOME: home, PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: 'en_US.UTF-8', ROAMIES_VERSION: '0.0.0' };
const provider = []; const model = await startModel({ onRequest: (r) => provider.push(r) });
fs.mkdirSync(path.join(home, '.gg', 'sidekick'), { recursive: true });
fs.mkdirSync(path.join(home, 'Documents', 'roamies-pi'), { recursive: true });
fs.mkdirSync(path.join(home, 'Projects', 'thesis', 'src'), { recursive: true });
fs.writeFileSync(path.join(home, 'Projects', 'thesis', 'segment.py'), 'def segment(image):\n    threshold = 0.61803\n    return image > threshold\n');
fs.writeFileSync(path.join(home, 'Projects', 'thesis', 'src', 'dataLoader.py'), 'def load(path):\n    return open(path).read()  # loader-marker-42\n');
execFileSync(process.execPath, ['--input-type=module', '-e', `
  import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
  import { AuthStorage } from '@kenkaiiii/gg-core';
  import { settingsDefaults } from './pi.mjs';
  await new AuthStorage().setCredentials('anthropic', { accessToken: 'test', refreshToken: '', expiresAt: Date.now() + 864e8, baseUrl: 'http://127.0.0.1:${model.port}' });
  const d = JSON.parse(JSON.stringify(settingsDefaults(os.homedir())));
  d.voiceEngine = 'system'; d.calendar.syncSeconds = 3600; d.calendar.reviewAt = '';
  d.project = '~/Projects/thesis'; d.projects = ['~/Projects/thesis']; d.briefings = { evening: '00:00' };
  fs.writeFileSync(path.join(os.homedir(), 'Documents', 'roamies-pi', 'settings.json'), JSON.stringify(d, null, 2));
`], { cwd: SIDECAR, env, stdio: ['ignore', 'inherit', 'inherit'] });
fs.writeFileSync(path.join(home, 'Documents', 'roamies-pi', 'state.json'), JSON.stringify({ calendar: { started: true, adopt: true } }));
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
const logText = () => { const d = path.join(home, '.gg', 'sidekick', 'logs'); return fs.existsSync(d) ? fs.readdirSync(d).map((f) => fs.readFileSync(path.join(d, f), 'utf8')).join('') : ''; };
const lastKinds = () => logText().trim().split('\n').slice(-12).map((l) => l.split(' ').slice(0, 2).join(' ')).join(' | ');
const waitFor = async (ok, ms, what) => { const t0 = Date.now(); while (!ok() && Date.now() - t0 < ms) await sleep(100); assert.ok(ok(), `${what} (the log: ${lastKinds()})`); };
const ledger = () => { try { return fs.readFileSync(path.join(home, '.gg', 'sidekick', 'ledger.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };
/** What the provider was sent as tool results, in order. */
const results = () => fs.readdirSync(dump).sort().flatMap((f) => { const m = JSON.parse(fs.readFileSync(path.join(dump, f), 'utf8')).at(-1); return Array.isArray(m?.content) ? m.content.filter((p) => p.type === 'tool_result').map((p) => (typeof p.content === 'string' ? p.content : (p.content ?? []).map((x) => x.text ?? '').join(''))) : []; });
async function typed(text) {
  const from = out.length;
  tell({ type: 'menu', id: 'ask' });
  await waitFor(() => page(from).some((m) => m.kind === 'ask' && m.bar), 3000, 'the ask field');
  tell({ type: 'answer', id: page(from).find((m) => m.kind === 'ask' && m.bar).id, text });
}
const replied = (from) => page(from).some((m) => m.kind === 'agent' && m.e?.type === 'done');
let timer = null;
try {
  await sleep(2500); tell({ type: 'ui_ready' }); beat(); timer = setInterval(beat, 1000);

  // the evening briefing: a request the app makes; its read_file is refused, nothing read or counted
  await waitFor(() => / briefing \{"kind":"evening"\}/.test(logText()), 70_000, 'the evening briefing');
  await waitFor(() => results().length >= 1, 20_000, 'the briefing\'s tool result');
  assert.match(results()[0], /only in a request they typed or spoke; this one came from the app, so nothing was read/);
  assert.doesNotMatch(results()[0], /0\.61803/);
  await waitFor(() => ledger().some((l) => l.kind === 'briefing'), 20_000, 'the briefing\'s ledger line');
  assert.equal(ledger().find((l) => l.kind === 'briefing').fileTexts, 0);
  await sleep(1500);

  // "Read segment.py": his words name it: read, no bubble; its text to the provider; one file text in the ledger
  let from = out.length;
  await typed('Read segment.py');
  await waitFor(() => replied(from), 20_000, 'the reply after the read');
  assert.match(results()[1], /^~\/Projects\/thesis\/segment\.py \(\d+ bytes\):\n\ndef segment\(image\):\n {4}threshold = 0\.61803/);
  assert.ok(!page(from).some((m) => m.kind === 'ask' && !m.bar), 'no bubble');
  assert.ok(page(from).some((m) => m.kind === 'agent' && m.e?.type === 'tool' && m.e.anim?.label === 'reading' && m.e.anim.detail === 'segment.py'), 'the bubble\'s tag names the file');
  await waitFor(() => ledger().filter((l) => l.kind === 'request').length >= 1, 5000, 'the request\'s ledger line');
  const line = ledger().filter((l) => l.kind === 'request').at(-1);
  assert.deepEqual([line.fileTexts, line.fileChars > 50, line.noteTexts], [1, true, 0]);

  // "What does the loader do?": the bubble names exactly the file; a no reads nothing
  from = out.length;
  await typed('What does the loader do?');
  await waitFor(() => page(from).some((m) => m.kind === 'ask' && /^Read this file\?/.test(m.placeholder ?? '')), 15_000, 'the bubble');
  let bubble = page(from).find((m) => m.kind === 'ask' && /^Read this file\?/.test(m.placeholder ?? ''));
  assert.match(bubble.placeholder, /^Read this file\?\n- ~\/Projects\/thesis\/src\/dataLoader\.py\n/);
  tell({ type: 'answer', id: bubble.id, text: null }); // the second button
  await waitFor(() => replied(from), 20_000, 'the reply after the no');
  assert.match(results()[2], /didn't say yes, so dataLoader\.py wasn't read/); assert.doesNotMatch(results()[2], /loader-marker-42/);
  // the same, answered yes: read
  from = out.length;
  await typed('What does the loader do?');
  await waitFor(() => page(from).some((m) => m.kind === 'ask' && /^Read this file\?/.test(m.placeholder ?? '')), 15_000, 'the bubble again');
  bubble = page(from).find((m) => m.kind === 'ask' && /^Read this file\?/.test(m.placeholder ?? ''));
  tell({ type: 'answer', id: bubble.id, text: 'yes' }); // the first button
  await waitFor(() => replied(from), 20_000, 'the reply after the yes');
  assert.match(results()[3], /loader-marker-42/);

  // what left the Mac: the file texts said; the activity log holds no path, name or text of a file
  from = out.length;
  await typed('What left the Mac today?');
  await waitFor(() => page(from).some((m) => m.kind === 'say' && /^Sent to anthropic today/.test(m.text)), 10_000, 'the app\'s answer');
  assert.match(page(from).find((m) => m.kind === 'say' && /^Sent to anthropic today/.test(m.text)).text, /File texts: 2 \(\d[\d,]* characters\)\. No note texts\./);
  assert.doesNotMatch(logText(), /segment|dataLoader|thesis|0\.61803|loader-marker/);
  assert.match(logText(), / file_tool \{"tool":"read_file","chars":\d+,"part":false\}/);
  console.log('file reading, the sidecar run: passed');
} finally {
  clearInterval(timer);
  try { side?.kill('SIGKILL'); } catch { /* gone */ }
  model.close();
  fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(dump, { recursive: true, force: true });
}
process.exit(0);
