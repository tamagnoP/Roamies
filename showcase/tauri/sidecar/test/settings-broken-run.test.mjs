// The owner, 2026-11-28: settings.json that can't be used, with the real sidecar in a throwaway home folder, a
// stand-in for the provider (bench/fake-model.mjs) and the shell and the page on its input. Run: npm run test:all.
// Nothing leaves the Mac. The clock-driven settings are off or far away (LESSONS.md).
//   - It starts with his fault: a stray comma. The start-up notice is the line (where, and the comma), shown and said.
//   - A typed request and a spoken one each get the line, shown and said, within 2 s, and nothing reaches the provider.
//   - A reminder due meanwhile comes at its time, shown and said, followed by the line.
//   - The timers skip, one log line each; nothing uncaught, no "error prompt", no failed calendar or daily note; the
//     process is still running.
//   - Saved again with a wrong value in a setting that protects something (sandbox): the line, naming it, once.
//   - Saved mended: "Your settings can be read again.", once, and the next typed request is answered by the provider.
//   - Saved with a wrong value in a setting that protects nothing: nothing is said; requests go on.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const SIDECAR = new URL('..', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Midnight would start a new day mid-run: a run that would cross it waits.
{ const d = new Date(), left = (24 * 60 - (d.getHours() * 60 + d.getMinutes())) * 60_000 - d.getSeconds() * 1000; if (left < 4 * 60_000) await sleep(left + 30_000); }
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'settings-broken-run-')));
const tmp = path.join(home, 'tmp'); fs.mkdirSync(tmp); // its own temporary folder: a killed sidecar's voice files stay here
const { startModel } = await import('../bench/fake-model.mjs');
const env = { HOME: home, PATH: process.env.PATH, TMPDIR: tmp, LANG: 'en_US.UTF-8', ROAMIES_VERSION: '0.0.0' };
const provider = []; const model = await startModel({ onRequest: (r) => provider.push(r) });
const dir = path.join(home, 'Documents', 'roamies-pi'), file = path.join(dir, 'settings.json');
fs.mkdirSync(path.join(home, '.gg', 'sidekick'), { recursive: true });
fs.mkdirSync(dir, { recursive: true });
execFileSync(process.execPath, ['--input-type=module', '-e', `
  import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
  import { AuthStorage } from '@kenkaiiii/gg-core';
  import { settingsDefaults } from './pi.mjs';
  await new AuthStorage().setCredentials('anthropic', { accessToken: 'test', refreshToken: '', expiresAt: Date.now() + 864e8, baseUrl: 'http://127.0.0.1:${model.port}' });
  const d = JSON.parse(JSON.stringify(settingsDefaults(os.homedir())));
  d.voiceEngine = 'system'; d.calendar.syncSeconds = 3600; d.calendar.reviewAt = '';
  fs.writeFileSync(path.join(os.homedir(), 'Documents', 'roamies-pi', 'good.json'), JSON.stringify(d, null, 2) + '\\n');
`], { cwd: SIDECAR, env, stdio: ['ignore', 'inherit', 'inherit'] });
const good = fs.readFileSync(path.join(dir, 'good.json'), 'utf8');
// his fault: a comma after the last entry of a list, so the closing bracket comes straight after it
const comma = good.replace('"Messages"\n', '"Messages",\n');
assert.notEqual(comma, good);
const commaAt = (() => { const lines = comma.split('\n'), i = lines.findIndex((l) => l.includes('"Messages",')); return { line: i + 2, column: lines[i + 1].indexOf(']') + 1 }; })();
const LINE = `Your settings file isn't valid JSON: line ${commaAt.line}, column ${commaAt.column}, in ~/Documents/roamies-pi/settings.json. There's a stray comma just before it. I won't act on requests until it's fixed.`;
fs.writeFileSync(file, comma);
fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ calendar: { started: true, adopt: true } }));
const dueAt = Date.now() + 40_000;
fs.writeFileSync(path.join(home, '.gg', 'sidekick', 'memory.json'), JSON.stringify({ version: 1, commitments: [{ id: 'c1', text: 'Call the dentist', due: dueAt, createdAt: Date.now(), status: 'open', remindedAt: null, kind: 'reminder' }], facts: [] }));
fs.writeFileSync(path.join(home, '.gg', 'sidekick.json'), JSON.stringify({ provider: 'anthropic', model: 'claude-haiku-5-5', sound: false, allowActions: false, voice: false, onboarded: true, onboardStep: 0, filesAsked: true, autoListen: false, setupVersion: 2, size: 'default', look: 'classic', replies: 'text' }));

const out = [];
let side = null;
const tell = (m) => side.stdin.write(`${JSON.stringify(m)}\n`);
side = spawn(process.execPath, ['sidekick.mjs'], { cwd: SIDECAR, env, stdio: ['pipe', 'pipe', 'ignore'] });
readline.createInterface({ input: side.stdout }).on('line', (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  out.push({ at: Date.now(), m });
  if (m.type === 'ui' && m.msg?.kind === 'speech' && m.msg.mark) tell({ type: 'speech_mark', mark: m.msg.mark });
});
const page = (from = 0) => out.slice(from).filter((o) => o.m.type === 'ui').map((o) => ({ at: o.at, ...o.m.msg }));
const said = (from) => page(from).filter((m) => m.kind === 'say').map((m) => m.text);
const logText = () => { const d = path.join(home, '.gg', 'sidekick', 'logs'); return fs.existsSync(d) ? fs.readdirSync(d).map((f) => fs.readFileSync(path.join(d, f), 'utf8')).join('') : ''; };
const lastKinds = () => logText().trim().split('\n').slice(-12).map((l) => l.split(' ').slice(0, 2).join(' ')).join(' | ');
const waitFor = async (ok, ms, what) => { const t0 = Date.now(); while (!ok() && Date.now() - t0 < ms) await sleep(100); assert.ok(ok(), `${what} (the log: ${lastKinds()})`); };
const spokenSince = (logFrom) => logText().slice(logFrom).match(/ speech_first_audio \{"id":"s\d+","voice":"mac","ms":\d+\}/g)?.length ?? 0; // heard: its first audio reached the page
const SPEAKS = process.platform === 'darwin'; // the Mac's own voice
async function typed(text) {
  const from = out.length;
  tell({ type: 'menu', id: 'ask' });
  await waitFor(() => page(from).some((m) => m.kind === 'ask' && m.bar), 3000, 'the ask field');
  const t0 = Date.now();
  tell({ type: 'answer', id: page(from).find((m) => m.kind === 'ask' && m.bar).id, text });
  return { from, t0 };
}
function spoken(text) {
  const from = out.length, t0 = Date.now();
  tell({ type: 'voice_state', state: 'listening' }); tell({ type: 'voice_state', state: 'processing' }); tell({ type: 'voice', text, ms: 300 }); tell({ type: 'voice_state', state: 'idle' });
  return { from, t0 };
}
try {
  await sleep(3000);
  assert.equal(side.exitCode, null, 'it started');
  // the start-up notice: the line, with where and the comma, shown and said
  let logFrom = logText().length;
  let from = out.length;
  tell({ type: 'ui_ready' });
  await waitFor(() => said(from).includes(LINE), 4000, 'the start-up line');
  assert.match(logText(), / settings_notice \{"chars":\d+,"refused":true\}/);
  if (SPEAKS) await waitFor(() => spokenSince(logFrom) >= 1, 4000, 'the start-up line said');

  // a typed request: the line within 2 s, and nothing else
  logFrom = logText().length;
  let r = await typed('What is on my list today?');
  await waitFor(() => said(r.from).includes(LINE), 2000, 'the line for a typed request');
  const typedMs = page(r.from).find((m) => m.kind === 'say' && m.text === LINE).at - r.t0;
  if (SPEAKS) await waitFor(() => spokenSince(logFrom) >= 1, 4000, 'said too, whatever the replies setting');
  assert.match(logText().slice(logFrom), / settings_refused \{"by":"typed","kind":"json"\}/);

  // a spoken request: the listening pill goes ("heard"), the line within 2 s
  logFrom = logText().length;
  r = spoken('Jarvis, what is on my list today?');
  await waitFor(() => said(r.from).includes(LINE), 2000, 'the line for a spoken request');
  const spokenMs = page(r.from).find((m) => m.kind === 'say' && m.text === LINE).at - r.t0;
  assert.ok(page(r.from).some((m) => m.kind === 'heard'), 'the pill by the cursor goes');
  if (SPEAKS) await waitFor(() => spokenSince(logFrom) >= 1, 4000, 'said');
  assert.match(logText().slice(logFrom), / settings_refused \{"by":"voice","kind":"json"\}/);
  assert.ok(!page(r.from).some((m) => m.kind === 'agent' && m.e?.type === 'start'), 'no reply started');

  // the reminder, at its time: shown and said, followed by the line
  logFrom = logText().length; from = out.length;
  await waitFor(() => said(from).some((t) => t.startsWith('Call the dentist') && t.endsWith(`\n${LINE}`)), Math.max(0, dueAt - Date.now()) + 6000, 'the reminder, then the line');
  const late = page(from).find((m) => m.kind === 'say' && m.text.startsWith('Call the dentist')).at - dueAt;
  assert.ok(late < 4000, `not delayed (${late} ms after its time)`);
  if (SPEAKS) await waitFor(() => spokenSince(logFrom) >= 1, 4000, 'the reminder said');
  assert.match(logText(), / settings_reminder \{"todos":1\}/);

  // the timers skipped, one line each; nothing thrown out; nothing sent
  await waitFor(() => ['quiet queue', 'daily', 'page rebuild', 'calendar'].every((f) => logText().includes(` settings_unreadable {"from":"${f}"}`)), 40_000, 'the timers skipped');
  for (const f of ['quiet queue', 'daily', 'calendar']) assert.equal(logText().split(` settings_unreadable {"from":"${f}"}`).length - 1, 1, `${f}: logged once`);
  assert.equal(provider.length, 0, 'nothing reached the provider');

  // saved with a wrong value in a setting that protects something: the line, naming it, once, within a few seconds
  from = out.length;
  const t1 = Date.now();
  fs.writeFileSync(file, good.replace('"sandbox": true', '"sandbox": "no"'));
  const SANDBOX = 'Your settings file has a wrong value, in ~/Documents/roamies-pi/settings.json: sandbox should be true or false. I won\'t act on requests until it\'s fixed.';
  await waitFor(() => said(from).includes(SANDBOX), 5000, 'the line after the save');
  const watchMs = page(from).find((m) => m.kind === 'say' && m.text === SANDBOX).at - t1;
  await sleep(4000);
  assert.equal(said(from).filter((t) => t === SANDBOX).length, 1, 'once');
  r = await typed('And now?');
  await waitFor(() => said(r.from).includes(SANDBOX), 2000, 'refused for the wrong value too');
  assert.match(logText(), / settings_refused \{"by":"typed","kind":"value"\}/);

  // mended: said once; then a request is answered by the provider
  from = out.length;
  fs.writeFileSync(file, good);
  await waitFor(() => said(from).includes('Your settings can be read again.'), 5000, 'mended, said');
  await sleep(3000);
  assert.equal(said(from).filter((t) => t === 'Your settings can be read again.').length, 1, 'once');
  r = await typed('What is on my list today?');
  await waitFor(() => provider.length >= 1, 15_000, 'the request reached the provider');
  await waitFor(() => page(r.from).some((m) => m.kind === 'agent' && m.e?.type === 'done'), 20_000, 'answered');
  assert.ok(!said(r.from).includes('Your settings can be read again.'), 'not said a second time with the request');

  // a wrong value in a setting that protects nothing: nothing said, and requests go on
  from = out.length;
  fs.writeFileSync(file, good.replace('"closingReply": "Any time."', '"closingReply": ""'));
  await sleep(5000);
  assert.deepEqual(said(from), [], 'a save that leaves it usable says nothing');
  const before = provider.length;
  r = await typed('Thanks, and one more thing: what time is it?');
  await waitFor(() => provider.length > before, 15_000, 'still answered');

  // nothing uncaught, nothing failed because of it, and the process never ended
  const log = logText();
  for (const bad of [' uncaught', 'unhandled rejection', ' error prompt', ' error calendar', ' daily_failed ', ' calendar_error ', 'settings_unreadable {"from":"uncaught"}', 'settings_unreadable {"from":"unhandled"}', 'settings_unreadable {"from":"message']) assert.ok(!log.includes(bad), `no "${bad.trim()}" in the log`);
  assert.equal(side.exitCode, null, 'still running');
  assert.doesNotMatch(log, /dentist/, 'the reminder\'s words are not logged');
  if (SPEAKS) { const started = log.match(/ speech_start \{"id":"(s\d+)"/g).length, heard = log.match(/ speech_first_audio \{"id":"(s\d+)"/g).length; assert.equal(heard, started, 'every line said was heard to its first audio: none cut off by the next'); }
  console.log(`  the line: typed ${typedMs} ms, spoken ${spokenMs} ms; after a save ${watchMs} ms; the reminder ${late} ms after its time`);
} finally {
  side.stdin.end(); await sleep(800); try { side.kill('SIGKILL'); } catch { /* gone */ }
  model.close();
}
console.log('settings that can\'t be used, the sidecar run: passed');
process.exit(0);
