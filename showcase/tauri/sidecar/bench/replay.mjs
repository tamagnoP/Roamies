// Replays a recorded run (a tape of the messages the sidecar sent to the overlay, with their times) into a page:
// the same messages at the same moments, so two versions of the page can be compared on exactly the same input.
// usage: node replay.mjs <tape.jsonl> <dist folder> <name> [--ptr] [--talk] [--until seconds] [--quiet seconds] [--no-speech] [--no-agent]
import './guarded.mjs'; // first: the run starts itself again under guard.sh, which puts the sound back
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [tapeFile, dist, name, ...flags] = process.argv.slice(2);
const flag = (f) => flags.includes(f), opt = (f, d) => { const i = flags.indexOf(f); return i >= 0 ? Number(flags[i + 1]) : d; };
const UNTIL = opt('--until', Infinity), QUIET = opt('--quiet', 0), PROBE = process.env.PROBE || '';
const OUT = '/tmp/lean/out'; fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now(), secs = () => Math.round((Date.now() - t0) / 100) / 10;
const log = (...a) => console.error(`[${secs()}s]`, ...a);
const tape = fs.readFileSync(tapeFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.t <= UNTIL);

const host = spawn(path.join(here, 'host'), [dist, ...(PROBE ? [PROBE] : [])], { stdio: ['pipe', 'pipe', 'inherit'] });
const toHost = (m) => host.stdin.write(`${JSON.stringify(m)}\n`);
let ready = null; const waits = new Map(); let seq = 0; const sent = {};
const whenReady = new Promise((r) => { ready = r; });
readline.createInterface({ input: host.stdout }).on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.ready) ready(m.ready);
  else if (m.send) sent[m.send.type] = (sent[m.send.type] ?? 0) + 1;
  else if (m.answer != null || m.mem != null) { const id = m.answer ?? m.mem; waits.get(id)?.(m); waits.delete(id); }
  else if (m.terminated) log('the page was terminated');
});
const askPage = (js) => new Promise((r) => { const id = `q${++seq}`; waits.set(id, (m) => { try { r(JSON.parse(m.value)); } catch { r(m.value ?? m.error); } }); toHost({ ask: js, id }); });
const info = await whenReady;
const MB = (b) => Math.round(b / 1048576 * 10) / 10;
const samples = []; let audio = 0, replies = 0, evals = 0;
async function sample(label) {
  const m = await new Promise((r) => { const id = `m${++seq}`; waits.set(id, r); toHost({ mem: id }); });
  const page = PROBE ? await askPage('JSON.stringify(window.__probe ? __probe.read() : null)') : null;
  const s = { label, t: secs(), web: MB(m.web), gpu: MB(m.gpu), audio: Math.round(audio * 10) / 10, replies, evals, ...(page ? { page } : {}) };
  samples.push(s);
  log(label, `web ${s.web} gpu ${s.gpu} audio ${s.audio}s evals ${evals}`, page ? JSON.stringify(page) : '');
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ name, tape: tapeFile, dist, flags, info, sent, samples }, null, 1));
}
const send = (msg) => { evals++; toHost({ host: msg }); };

// --ptr: the pointer moving, as the shell reports it (about 120 times a second while it moves): a slow circle.
let ptr = null;
if (flag('--ptr')) { let a = 0; ptr = setInterval(() => { a += 0.02; evals++; toHost({ eval: `window.__roamiePtr&&__roamiePtr(${(735 + 400 * Math.cos(a)).toFixed(1)},${(478 + 250 * Math.sin(a)).toFixed(1)},${(Date.now() - t0).toFixed(1)})` }); }, 8); }
// --talk: before each request, what the voice helper reports while the talk keys are held for three seconds.
async function talk() {
  send({ kind: 'voice', type: 'state', state: 'listening', mode: 'hold', wave: true });
  const words = 'what is on my calendar this afternoon and how long is it'.split(' ');
  for (let i = 0; i < 60; i++) {
    send({ kind: 'voice', type: 'level', v: Math.round((0.3 + 0.3 * Math.sin(i / 3)) * 100) / 100 });
    if (i % 6 === 5) send({ kind: 'voice', type: 'partial', text: words.slice(0, 1 + i / 6).join(' ') });
    await sleep(50);
  }
  send({ kind: 'voice', type: 'state', state: 'processing' });
  send({ kind: 'voice', type: 'final', text: words.join(' ') });
  send({ kind: 'voice', type: 'state', state: 'idle' });
}

await sleep(8000);
await sample('start');
let shift = 8; // seconds added to the tape's clock (the talking adds to it)
const first = tape.find((e) => e.msg.kind === 'agent' && e.msg.e?.type === 'start')?.t ?? 0;
const LOOK = process.env.LOOK || '', SIZE = process.env.SIZE || '';
for (const e of tape) {
  if (LOOK && e.msg.kind === 'look') e.msg.look = LOOK;
  if (SIZE && e.msg.kind === 'size') e.msg.size = SIZE;
  if (e.msg.kind === 'speech' && flag('--no-speech')) continue;
  if (e.msg.kind !== 'speech' && flag('--no-agent')) continue;
  if (flag('--talk') && e.msg.kind === 'agent' && e.msg.e?.type === 'start') { const w = (e.t + shift) * 1000 - (Date.now() - t0) - 3200; if (w > 0) await sleep(w); const a = Date.now(); await talk(); shift += Math.max(0, (Date.now() - a) / 1000 - 3.2); }
  const wait = (e.t + shift) * 1000 - (Date.now() - t0);
  if (wait > 0) await sleep(wait);
  if (e.msg.kind === 'agent' && e.msg.e?.type === 'start' && replies > 0) await sample(`reply ${replies}`); // just before the next request: the reply before it has played
  send(e.msg);
  if (e.msg.kind === 'speech' && e.msg.pcm) audio += (e.msg.pcm.length * 3 / 4) / 2 / (e.msg.rate || 44100);
  if (e.msg.kind === 'agent' && (e.msg.e?.type === 'done' || e.msg.e?.type === 'error')) replies++;
}
await sleep(12000);
await sample(`reply ${replies}`);
if (ptr) clearInterval(ptr);
for (let q = 30; q <= QUIET; q += 30) { await sleep(30000); await sample(`quiet ${q}s`); }
if (QUIET) { try { execFileSync('/usr/bin/notifyutil', ['-p', 'org.WebKit.lowMemory']); } catch { /* not there */ } await sleep(10000); await sample('released +10s'); }
toHost({ quit: 1 });
await sleep(300);
process.exit(0);
