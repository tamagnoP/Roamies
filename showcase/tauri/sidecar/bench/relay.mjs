// Runs in the sidecar's place inside the real app (the shell starts it through ROAMIES_NODE): it starts the real,
// bundled sidecar in a throwaway home folder with the stand-in model, passes everything between it and the shell
// unchanged, makes the scripted requests, and measures. Settings come in MEASURE_* variables.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { startModel } from './fake-model.mjs';
import { ASKS } from './script.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_SIDECAR = path.join(here, '..');
const script = process.argv[2]; // the bundled sidekick.mjs
const mode = process.env.MEASURE_MODE || 'system', N = Number(process.env.MEASURE_N || 40), QUIET = Number(process.env.MEASURE_QUIET || 300);
const name = process.env.MEASURE_NAME || `real-${mode}`, NODE = process.env.MEASURE_NODE || process.execPath;
const before = new Set((process.env.MEASURE_BEFORE || '').split(',').filter(Boolean).map(Number));
const OUT = '/tmp/lean/out';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now(), secs = () => Math.round((Date.now() - t0) / 100) / 10;
const logFile = fs.createWriteStream(path.join(OUT, `${name}.log`));
const log = (...a) => logFile.write(`[${secs()}s] ${a.join(' ')}\n`);

const requests = [];
const model = await startModel({ onRequest: (r) => requests.push({ t: secs(), ...r }) });
const home = os.homedir(); // the throwaway one: the app was started with HOME set to it
if (!home.startsWith('/tmp/lean/') && !home.startsWith('/private/tmp/lean/')) { log('not a throwaway home'); process.exit(1); }
fs.mkdirSync(path.join(home, '.gg'), { recursive: true });
fs.mkdirSync(path.join(home, 'Documents', 'roamies-pi'), { recursive: true });
const env = { HOME: home, PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: 'en_US.UTF-8', ROAMIES_VERSION: process.env.ROAMIES_VERSION, ROAMIES_HANDS: '' };
execFileSync('/opt/homebrew/bin/node', ['--input-type=module', '-e', `
  import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
  import { AuthStorage } from '@kenkaiiii/gg-core';
  import { settingsDefaults } from './pi.mjs';
  const a = new AuthStorage();
  await a.setCredentials('anthropic', { accessToken: 'measure', refreshToken: '', expiresAt: Date.now() + 864e8, baseUrl: 'http://127.0.0.1:${model.port}' });
  const d = JSON.parse(JSON.stringify(settingsDefaults(os.homedir())));
  d.voiceEngine = '${mode === 'kokoro' ? 'kokoro' : 'system'}';
  d.kokoro.model = '/tmp/lean/Kokoro-82M-bf16';
  if (${Number(process.env.MEASURE_PAGE_REBUILD_MINUTES ?? -1)} >= 0) d.limits.pageRebuildQuietMinutes = ${Number(process.env.MEASURE_PAGE_REBUILD_MINUTES ?? -1)};
  fs.writeFileSync(path.join(os.homedir(), 'Documents', 'roamies-pi', 'settings.json'), JSON.stringify(d, null, 2));
`], { cwd: REPO_SIDECAR, env, stdio: 'ignore' });
fs.writeFileSync(path.join(home, '.gg', 'sidekick.json'), JSON.stringify({ provider: 'anthropic', model: 'claude-haiku-5-5', sound: true, allowActions: false, voice: true, onboarded: true, onboardStep: 0, filesAsked: true, muteWhileTalking: true, autoListen: false, setupVersion: 2, size: 'default', look: process.env.MEASURE_LOOK || 'jarvis', introDone: true, replies: mode === 'kokoro' || mode === 'system' ? 'voice' : 'text' }));

const sidecar = spawn(NODE, [script], { cwd: path.dirname(script), env, stdio: ['pipe', 'pipe', 'ignore'] });
const sent = []; const kinds = {}; let audio = 0, replyEnds = 0;
const tape = fs.createWriteStream(path.join(OUT, `${name}.tape.jsonl`));
// Feature 24, fix 6: the page rebuilds the sidecar asks for (MEASURE_PAGE_REBUILD_MINUTES sets the setting), and when
// the new page reported ready.
const pageRebuilds = [];
readline.createInterface({ input: process.stdin }).on('line', (line) => { // the shell (and through it the page) → the sidecar
  try { const m = JSON.parse(line); sent.push({ t: secs(), type: m.type }); const r = pageRebuilds.at(-1); if (m.type === 'ui_ready' && r && r.readyMs == null) { r.readyMs = Date.now() - r.at; log('page rebuilt: new page ready after', r.readyMs, 'ms'); } } catch { /* passed on all the same */ }
  sidecar.stdin.write(`${line}\n`);
}).on('close', () => { log('the shell closed the pipe'); sidecar.stdin.end(); setTimeout(() => process.exit(0), 3500); });
readline.createInterface({ input: sidecar.stdout }).on('line', (line) => { // the sidecar → the shell
  process.stdout.write(`${line}\n`);
  let m; try { m = JSON.parse(line); } catch { return; }
  kinds[m.type] = (kinds[m.type] ?? 0) + 1;
  if (m.type === 'rebuild_overlays') { pageRebuilds.push({ t: secs(), at: Date.now(), readyMs: null }); log('page rebuild asked for'); }
  if (m.type !== 'ui') return;
  const msg = m.msg;
  tape.write(`${JSON.stringify({ t: secs(), msg })}\n`);
  if (msg.kind === 'speech' && msg.pcm) audio += (msg.pcm.length * 3 / 4) / 2 / (msg.rate || 44100);
  if (msg.kind === 'agent' && (msg.e?.type === 'done' || msg.e?.type === 'error')) replyEnds++;
});
sidecar.on('exit', (code, sig) => log('sidecar exited', code, sig));

const pgrep = (...a) => { try { return execFileSync('/usr/bin/pgrep', a, { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map(Number); } catch { return []; } };
const tree = (pid) => { const out = []; const walk = (p) => { for (const k of pgrep('-P', String(p))) { out.push(k); walk(k); } }; walk(pid); return out; };
const nameOf = (pid) => { try { return execFileSync('/bin/ps', ['-o', 'comm=', '-p', String(pid)], { encoding: 'utf8' }).trim().split('/').pop(); } catch { return ''; } };
const fp = (pids) => { const o = {}; if (!pids.length) return o; for (const l of execFileSync(path.join(here, 'fp'), pids.map(String), { encoding: 'utf8' }).trim().split('\n')) { const [p, b] = l.split(' '); o[p] = Math.round(Number(b) / 1048576 * 10) / 10; } return o; };
const shell = process.ppid;
const samples = [];
function sample(label) {
  const web = pgrep('-f', 'com.apple.WebKit.WebContent').filter((p) => !before.has(p)), gpu = pgrep('-f', 'com.apple.WebKit.GPU').filter((p) => !before.has(p)), net = pgrep('-f', 'com.apple.WebKit.Networking').filter((p) => !before.has(p));
  const kids = tree(sidecar.pid);
  const m = fp([...web, ...gpu, ...net, shell, sidecar.pid, ...kids]);
  const s = { label, t: secs(), web: Object.fromEntries(web.map((p) => [p, m[p]])), gpu: Object.fromEntries(gpu.map((p) => [p, m[p]])), net: Object.fromEntries(net.map((p) => [p, m[p]])), shell: m[shell], sidecar: m[sidecar.pid], children: Object.fromEntries(kids.map((k) => [`${nameOf(k)}:${k}`, m[k]])), audio: Math.round(audio * 10) / 10, requests: requests.length, tokens: requests.at(-1)?.tokens ?? 0 };
  samples.push(s);
  log(label, JSON.stringify(s));
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ name, mode, N, kinds, sent: sent.reduce((o, x) => { o[x.type] = (o[x.type] ?? 0) + 1; return o; }, {}), samples, requests }, null, 1));
}

await sleep(mode === 'kokoro' ? 30000 : 12000);
sample('start');
for (let i = 0; i < N; i++) {
  if (mode === 'bubbles') {
    process.stdout.write(`${JSON.stringify({ type: 'ui', msg: { kind: 'say', text: `Note ${i + 1}: the report block ends at half past three.`, mood: 'happy' } })}\n`);
    await sleep(8000);
  } else {
    const was = replyEnds, asked = secs();
    sidecar.stdin.write(`${JSON.stringify({ type: 'voice', text: ASKS[i % ASKS.length] })}\n`);
    const until = Date.now() + 60000;
    while (replyEnds === was && Date.now() < until) await sleep(100);
    if (replyEnds === was) { log('no reply to request', i + 1); break; }
    const doneAt = secs();
    while (!sent.some((x) => x.type === 'speech_mark' && x.t >= Math.max(asked, doneAt - 0.5)) && Date.now() < until + 60000) await sleep(100);
    await sleep(mode === 'text' ? 6000 : 3000);
  }
  sample(`reply ${i + 1}`);
}
for (let q = 30; q <= QUIET; q += 30) { await sleep(30000); sample(`quiet ${q}s`); }
if (QUIET) { try { execFileSync('/usr/bin/notifyutil', ['-p', 'org.WebKit.lowMemory']); } catch { /* not there */ } await sleep(10000); sample('released +10s'); await sleep(50000); sample('released +60s'); }
// MEASURE_REBUILD=<n>: the overlay page is rebuilt n times the way the shell does it itself (a changed list of
// characters makes it destroy the overlay window and make a new one), and the time until the new page reports
// ready is taken, with the page's size before and after.
const REBUILD = Number(process.env.MEASURE_REBUILD || 0), rebuilds = [];
for (let i = 0; i < REBUILD; i++) {
  sample(`before rebuild ${i + 1}`);
  const from = sent.length, t = Date.now();
  process.stdout.write(`${JSON.stringify({ type: 'overlays', ids: i % 2 ? ['sidekick'] : ['sidekick', 'none'] })}\n`);
  while (!sent.slice(from).some((x) => x.type === 'ui_ready') && Date.now() - t < 20000) await sleep(5);
  const ready = Date.now() - t;
  await sleep(3000);
  const s = sample(`after rebuild ${i + 1}`);
  rebuilds.push({ readyMs: ready, sentAfter: sent.slice(from).map((x) => x.type) });
  log('rebuild', i + 1, 'ready after', ready, 'ms');
  await sleep(4000);
}
if (REBUILD) fs.writeFileSync(path.join(OUT, `${name}.rebuild.json`), JSON.stringify({ rebuilds, samples: samples.filter((x) => /rebuild/.test(x.label)) }, null, 1));
if (pageRebuilds.length) fs.writeFileSync(path.join(OUT, `${name}.pagerebuild.json`), JSON.stringify({ pageRebuilds, samples }, null, 1));
// MEASURE_QUIT_AT=speaking: one more request, and the quit is asked for while its reply is being spoken (once the
// first of its audio has gone to the page).
if (process.env.MEASURE_QUIT_AT === 'speaking') {
  const was = audio;
  sidecar.stdin.write(`${JSON.stringify({ type: 'voice', text: ASKS[N % ASKS.length] })}\n`);
  const until = Date.now() + 60000;
  while (audio === was && Date.now() < until) await sleep(20);
  await sleep(300);
  log('speaking: the quit can be asked for', `audio so far ${Math.round((audio - was) * 10) / 10} s`);
}
fs.writeFileSync(path.join(OUT, `${name}.done`), JSON.stringify({ shell, sidecar: sidecar.pid, kids: tree(sidecar.pid).map((k) => [k, nameOf(k)]), relay: process.pid }));
log('finished: waiting for the app to be quit');
