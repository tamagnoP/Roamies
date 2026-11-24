// One kind of thing shown over and over on the page, to see which of them grows it. usage: node inject.mjs <what> <times> [dist]
import './guarded.mjs'; // first: the run starts itself again under guard.sh, which puts the sound back
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const [what, times = '30', dist = '/tmp/lean/ours'] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now(), secs = () => Math.round((Date.now() - t0) / 100) / 10;
const host = spawn(path.join(here, 'host'), [dist, path.join(here, 'probe.js')], { stdio: ['pipe', 'pipe', 'inherit'] });
const toHost = (m) => host.stdin.write(`${JSON.stringify(m)}\n`);
const waits = new Map(); let seq = 0, ready;
const whenReady = new Promise((r) => { ready = r; });
readline.createInterface({ input: host.stdout }).on('line', (line) => { let m; try { m = JSON.parse(line); } catch { return; } if (m.ready) ready(); const id = m.answer ?? m.mem; if (id != null) { waits.get(id)?.(m); waits.delete(id); } });
const call = (o) => new Promise((r) => { const id = `i${++seq}`; waits.set(id, r); toHost({ ...o, [o.ask ? 'id' : 'mem']: id }); });
const samples = [];
async function sample(label) {
  const m = await call({ mem: 1 }), p = JSON.parse((await call({ ask: 'JSON.stringify(__probe.read())' })).value);
  const s = { label, t: secs(), web: Math.round(m.web / 104857.6) / 10, gpu: Math.round(m.gpu / 104857.6) / 10, canvLive: p.canvLive, canvMPx: p.canvMPx, canvMade: p.canvMade, resizes: p.resizes, resizedMPx: p.resizedMPx, gid: p.getImageData, gidMPx: p.getImageDataMPx, cid: p.createImageData, bigOps: p.bigOps, bigClear: p.bigClear, bigDrawImage: p.bigDrawImage, bigFilter: p.bigFilter, path2d: p.path2d, pathOps: p.pathOps, grads: p.grads, measure: p.measure, drawImage: p.drawImage, fillText: p.fillText, strokes: p.strokes, saves: p.saves, dom: p.dom, timeoutsLive: p.timeoutsLive, frames: p.frames };
  samples.push(s); console.log(JSON.stringify(s));
  fs.writeFileSync(`/tmp/lean/out/inject-${what}-${path.basename(dist)}.json`, JSON.stringify({ what, samples }, null, 1));
}
const send = (msg) => toHost({ host: msg });
await whenReady;
send({ kind: 'sound', on: true }); send({ kind: 'size', size: what === 'cursor' ? 'cursor' : what === 'small' ? 'small' : 'default' }); send({ kind: 'home', home: 'bottom-left' }); send({ kind: 'look', look: process.env.LOOK || 'jarvis' }); send({ kind: 'greet' });
await sleep(8000); await sample('start');
const items = Array.from({ length: 34 }, (_, i) => ({ id: `t${i}`, text: `Task number ${i + 1} of the list, with a title of ordinary length`, done: false, overdue: i % 7 === 0, when: i % 3 ? '14:00' : '' }));
const long = 'The sandbox keeps the coding assistant inside the project folder. It can read the folders you have listed and nothing else in your home folder. It cannot open other apps or run the security tool. Anything it writes stays in the project or in a temporary folder.';
const one = {
  async list(i) { send({ kind: 'list', today: items.slice(0, 12), later: items.slice(12), seconds: 6, flash: `t${i % 34}`, toggle: false }); await sleep(8000); },
  async ask(i) { send({ kind: 'ask', id: `a${i}`, placeholder: 'Send to pi?  Read only · in ~/work\n\nList the files in the project and say which changed today. Then stop.\nSay send, or click.', choices: ['Send', "Don't send"] }); await sleep(5000); send({ kind: 'cancel_ask', id: `a${i}` }); await sleep(3000); },
  async say(i) { send({ kind: 'say', text: `Note ${i + 1}: the report block ends at half past three.`, mood: 'happy' }); await sleep(8000); },
  async longsay(i) { send({ kind: 'say', text: `${i + 1}. ${long} ${long}`, mood: 'happy' }); await sleep(9000); },
  async reply(i) { send({ kind: 'agent', e: { type: 'start' } }); await sleep(400); for (const w of long.match(/\S+\s*/g)) { send({ kind: 'agent', e: { type: 'text', text: w } }); await sleep(25); } send({ kind: 'agent', e: { type: 'done' } }); await sleep(7000); },
  async summon() { send({ kind: 'summon' }); await sleep(2500); send({ kind: 'summon', show: true }); await sleep(2500); },
  async move(i) { for (let k = 0; k < 240; k++) { toHost({ eval: `window.__roamiePtr&&__roamiePtr(${(200 + 4 * k).toFixed(1)},${(200 + 2 * k).toFixed(1)},${Date.now() - t0})` }); await sleep(8); } await sleep(3000); },
  async listlong(i) { if (i === 0) send({ kind: 'list', today: items.slice(0, 12), later: items.slice(12), seconds: 600, flash: null, toggle: false }); await sleep(4000); },
  async listshown(i) { if (i === 0) { send({ kind: 'summon', show: true }); await sleep(1500); send({ kind: 'list', today: items.slice(0, 12), later: items.slice(12), seconds: 600, flash: null, toggle: false }); } if (i % 2 === 0) send({ kind: 'summon', show: true }); await sleep(4000); },
  // A card up and the character active (thinking: the globe turns, every frame is drawn). activeonly: no card.
  async active(i) { if (i === 0) { send({ kind: 'list', today: items.slice(0, 12), later: items.slice(12), seconds: 900, flash: null, toggle: false }); await sleep(4000); if (process.env.VEVAL) toHost({ eval: process.env.VEVAL }); await sleep(500); send({ kind: 'agent', e: { type: 'start' } }); } await sleep(4000); },
  // A card up while lines are said one after another (a bubble open, the character talking).
  async saycard(i) { if (i === 0) { send({ kind: 'list', today: items.slice(0, 12), later: items.slice(12), seconds: 900, flash: null, toggle: false }); await sleep(4000); } if (i % 2 === 0) send({ kind: 'say', text: `Note ${i + 1}: the report block ends at half past three, and the next one starts at four.`, mood: 'happy' }); await sleep(4000); },
  async activeonly(i) { if (i === 0) { await sleep(4000); if (process.env.VEVAL) toHost({ eval: process.env.VEVAL }); await sleep(500); send({ kind: 'agent', e: { type: 'start' } }); } await sleep(4000); },
  async idle() { await sleep(10000); },
};
one.cursor = one.move; one.small = one.say;
for (let i = 0; i < Number(times); i++) { await one[what](i); if (i % Number(process.env.EVERY || 5) === Number(process.env.EVERY || 5) - 1) await sample(`${what} ${i + 1}`); }
await sleep(20000); await sample('20 s later');
toHost({ quit: 1 }); await sleep(300); process.exit(0);
