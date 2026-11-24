// A live run: the real sidecar (in a throwaway home folder, with the stand-in model), the overlay page in host,
// this script in the shell's place between them. usage: node run.mjs <kokoro|system|text|bubbles> [replies] [quietSeconds]
import './guarded.mjs'; // first: the run starts itself again under guard.sh, which puts the sound back
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { startModel } from './fake-model.mjs';
import { ASKS } from './script.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SIDECAR = path.join(here, '..');
const [mode = 'system', nReplies = '40', quietSecs = '300'] = process.argv.slice(2);
const N = Number(nReplies), QUIET = Number(quietSecs);
const DIST = process.env.DIST || '/tmp/lean/ours', PROBE = process.env.PROBE || '';
const OUT = '/tmp/lean/out'; fs.mkdirSync(OUT, { recursive: true });
const name = process.env.NAME || `live-${mode}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now(), secs = () => Math.round((Date.now() - t0) / 100) / 10;
const log = (...a) => console.error(`[${secs()}s]`, ...a);

// ---- the stand-in model
const requests = [];
const model = await startModel({ onRequest: (r) => requests.push({ t: secs(), ...r }) });

// ---- a throwaway home folder
const home = `/tmp/lean/home-${name}`;
fs.rmSync(home, { recursive: true, force: true });
fs.mkdirSync(path.join(home, '.gg'), { recursive: true });
fs.mkdirSync(path.join(home, 'Documents', 'roamies-pi'), { recursive: true });
fs.mkdirSync(path.join(home, '.cache'), { recursive: true });
fs.symlinkSync(path.join(os.homedir(), '.cache', 'huggingface'), path.join(home, '.cache', 'huggingface'));
const env = { HOME: home, PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: 'en_US.UTF-8', ROAMIES_VERSION: '0.1.34' };
execFileSync(process.execPath, ['--input-type=module', '-e', `
  import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
  import { AuthStorage } from '@kenkaiiii/gg-core';
  import { settingsDefaults } from './pi.mjs';
  const a = new AuthStorage();
  await a.setCredentials('anthropic', { accessToken: 'measure', refreshToken: '', expiresAt: Date.now() + 864e8, baseUrl: 'http://127.0.0.1:${model.port}' });
  const d = JSON.parse(JSON.stringify(settingsDefaults(os.homedir())));
  d.voiceEngine = '${mode === 'kokoro' ? 'kokoro' : 'system'}';
  d.kokoro.model = '/tmp/lean/Kokoro-82M-bf16'; // the copy already on this Mac, by a link named for the model: the throwaway home has no download of its own
  fs.writeFileSync(path.join(os.homedir(), 'Documents', 'roamies-pi', 'settings.json'), JSON.stringify(d, null, 2));
`], { cwd: SIDECAR, env, stdio: ['ignore', 'inherit', 'inherit'] });
fs.writeFileSync(path.join(home, '.gg', 'sidekick.json'), JSON.stringify({ provider: 'anthropic', model: 'claude-haiku-5-5', sound: true, allowActions: false, voice: true, onboarded: true, onboardStep: 0, filesAsked: true, muteWhileTalking: true, autoListen: false, setupVersion: 2, size: 'default', look: 'jarvis', introDone: true, replies: mode === 'kokoro' || mode === 'system' ? 'voice' : 'text' }));

// ---- the overlay page
const host = spawn(path.join(here, 'host'), [DIST, ...(PROBE ? [PROBE] : [])], { stdio: ['pipe', 'pipe', 'inherit'] });
const toHost = (m) => host.stdin.write(`${JSON.stringify(m)}\n`);
let ready = null; const waits = new Map(); let seq = 0;
const whenReady = new Promise((r) => { ready = r; });
const sent = []; // what the page sent to the sidecar, by type
let sidecar = null;
const fromPage = [];
readline.createInterface({ input: host.stdout }).on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.ready) ready(m.ready);
  else if (m.send) { sent.push({ t: secs(), type: m.send.type }); if (sidecar) sidecar.stdin.write(`${JSON.stringify(m.send)}\n`); else fromPage.push(m.send); }
  else if (m.answer != null) { waits.get(m.answer)?.(m); waits.delete(m.answer); }
  else if (m.mem != null) { waits.get(m.mem)?.(m); waits.delete(m.mem); }
  else if (m.terminated) log('the page was terminated');
});
const askPage = (js) => new Promise((r) => { const id = `q${++seq}`; waits.set(id, (m) => { try { r(JSON.parse(m.value)); } catch { r(m.value ?? m.error); } }); toHost({ ask: js, id }); });
const info = await whenReady;
log('page ready', info);

// ---- the sidecar
const tape = fs.createWriteStream(path.join(OUT, `${name}.tape.jsonl`));
const kinds = {}; let audio = 0, replyEnds = 0, lastUi = 0;
sidecar = spawn(process.execPath, ['sidekick.mjs'], { cwd: SIDECAR, env, stdio: ['pipe', 'pipe', 'pipe'] });
let errChars = 0; sidecar.stderr.on('data', (d) => { errChars += d.length; });
for (const m of fromPage) sidecar.stdin.write(`${JSON.stringify(m)}\n`);
const ui = (msg) => {
  tape.write(`${JSON.stringify({ t: secs(), msg })}\n`);
  toHost({ host: msg });
  lastUi = Date.now();
  if (msg.kind === 'speech' && msg.pcm) audio += (msg.pcm.length * 3 / 4) / 2 / (msg.rate || 44100);
  if (msg.kind === 'agent' && (msg.e?.type === 'done' || msg.e?.type === 'error')) { replyEnds++; if (msg.e.type === 'error') log('agent error', String(msg.e.message).slice(0, 200)); }
};
readline.createInterface({ input: sidecar.stdout }).on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  kinds[m.type] = (kinds[m.type] ?? 0) + 1;
  if (m.type === 'ui') ui(m.msg);
});
sidecar.on('exit', (code, sig) => log('sidecar exited', code, sig));

// ---- measuring
const tree = (pid) => { const out = []; const walk = (p) => { let kids = []; try { kids = execFileSync('/usr/bin/pgrep', ['-P', String(p)], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map(Number); } catch { /* none */ } for (const k of kids) { out.push(k); walk(k); } }; walk(pid); return out; };
const nameOf = (pid) => { try { return execFileSync('/bin/ps', ['-o', 'comm=', '-p', String(pid)], { encoding: 'utf8' }).trim().split('/').pop(); } catch { return ''; } };
const MB = (b) => Math.round(b / 1048576 * 10) / 10;
const samples = [];
async function sample(label, extra = {}) {
  const kids = tree(sidecar.pid);
  const m = await new Promise((r) => { const id = `m${++seq}`; waits.set(id, r); toHost({ mem: id, pids: [sidecar.pid, ...kids] }); });
  const page = PROBE ? await askPage('JSON.stringify(window.__probe ? __probe.read() : null)') : null;
  const s = { label, t: secs(), web: MB(m.web), gpu: MB(m.gpu), host: MB(m.host), sidecar: MB(m.others[String(sidecar.pid)] ?? 0), children: Object.fromEntries(kids.map((k) => [`${nameOf(k)}:${k}`, MB(m.others[String(k)] ?? 0)])), audio: Math.round(audio * 10) / 10, requests: requests.length, tokens: requests.at(-1)?.tokens ?? 0, ...(page ? { page } : {}), ...extra };
  samples.push(s);
  log(label, `web ${s.web} gpu ${s.gpu} sidecar ${s.sidecar} audio ${s.audio}s tokens ${s.tokens}`, JSON.stringify(s.children), page ? JSON.stringify(page) : '');
  return s;
}
const save = (more = {}) => fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ name, mode, N, info, kinds, sent: sent.reduce((o, s) => { o[s.type] = (o[s.type] ?? 0) + 1; return o; }, {}), samples, requests, errChars, ...more }, null, 1));

await sleep(mode === 'kokoro' ? 30000 : 12000); // start-up: the page settles, the natural voice loads
await sample('start');
// EVERY=<seconds>: a reading on the clock as well as after each reply, so short jumps are seen
if (process.env.EVERY) setInterval(() => { sample('tick').catch(() => {}); }, Number(process.env.EVERY) * 1000).unref();
const playing = () => askPage('JSON.stringify(!!(window.Roamie && Roamie.voiceOut && Roamie.voiceOut.playing()))');
// CARD=<n>: the to-do list card is put on the page before every n-th exchange and stays up through it, as it does
// in the app when a list is asked for. Without it nothing is ever on the drawing layer, which is how the first
// measurements missed the growth of the page.
const CARD = Number(process.env.CARD || 0);
const cardItems = Array.from({ length: 12 }, (_, k) => ({ id: `t${k}`, text: `Task number ${k + 1} of the list, with a title of ordinary length`, done: false, overdue: k % 7 === 0, when: k % 3 ? '14:00' : '' }));
for (let i = 0; i < N; i++) {
  if (CARD && i % CARD === 0) toHost({ host: { kind: 'list', today: cardItems.slice(0, 6), later: cardItems.slice(6), seconds: 30, flash: null, toggle: false } });
  if (mode === 'bubbles') {
    ui({ kind: 'say', text: `Note ${i + 1}: the report block ends at half past three.`, mood: 'happy' });
    await sleep(8000);
  } else {
    const before = replyEnds;
    const asked = secs();
    sidecar.stdin.write(`${JSON.stringify({ type: 'voice', text: ASKS[i % ASKS.length] })}\n`);
    const until = Date.now() + 60000;
    while (replyEnds === before && Date.now() < until) await sleep(100);
    if (replyEnds === before) { log('no reply to request', i + 1); break; }
    // the page's own report that the reply has finished playing (the mark the sidecar asks for at the reply's end)
    const doneAt = secs();
    while (!sent.some((x) => x.type === 'speech_mark' && x.t >= Math.max(asked, doneAt - 0.5)) && Date.now() < until + 60000) await sleep(100);
    while (await playing()) await sleep(250);
    await sleep(mode === 'text' ? 6000 : 3000);
    // PACE=<seconds>: one exchange every so many seconds, the pace of real use (the live runs: one in about 30 s)
    const pace = Number(process.env.PACE || 0) * 1000 - (secs() - asked) * 1000;
    if (pace > 0) await sleep(pace);
  }
  await sample(`reply ${i + 1}`);
  save();
}
for (let q = 30; q <= QUIET; q += 30) { await sleep(30000); await sample(`quiet ${q}s`); save(); }
if (QUIET) {
  try { execFileSync('/usr/bin/notifyutil', ['-p', 'org.WebKit.lowMemory']); } catch (e) { log('notify failed', e.message); }
  await sleep(10000); await sample('released +10s');
  await sleep(50000); await sample('released +60s');
}
// ---- the end: the sidecar's input closes, as when the shell goes
const kidsBefore = tree(sidecar.pid).map((k) => [k, nameOf(k)]);
const sidecarPid = sidecar.pid;
sidecar.stdin.end();
await sleep(4000);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const left = [[sidecarPid, 'sidecar'], ...kidsBefore].filter(([p]) => alive(p));
log('after the sidecar\'s input closed: before', JSON.stringify(kidsBefore), 'left', JSON.stringify(left));
for (const [p] of left) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } }
save({ kidsBefore, left });
tape.end();
toHost({ quit: 1 });
model.close();
await sleep(500);
process.exit(0);
