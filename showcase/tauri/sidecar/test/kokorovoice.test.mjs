// Local-only build (feature 16): the natural voice (kokorovoice.mjs, kokoro_server.py).
// The helper is stood in for by a Node script that speaks the same pipe format, so no Python is needed here. The
// macOS voice it falls back to is stood in for the way localvoice.test.mjs does it.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KokoroVoice, OFFLINE, QUIT_KILL_MS, SANDBOX_EXEC, WAKE_BEFORE_BRIEFING_MINUTES, createKokoro, helperEnv, kokoroProfile, modelPlace, pythonProblem, splitLong, voiceFor } from '../kokorovoice.mjs';
import { createSpeaker } from '../speaker.mjs';
import { LocalVoice } from '../localvoice.mjs';
import { KOKORO, LIMITS, VOICE_ENGINES, loadSettings, settingsDefaults } from '../pi.mjs';
import { settingsReference } from '../reference.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kv-test-')));
const home = path.join(dir, 'home'); fs.mkdirSync(home);
process.setMaxListeners(50); // each engine watches for the end of the process
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (ok, ms = 4000) => { for (const t0 = Date.now(); !ok();) { if (Date.now() - t0 > ms) throw new Error('waited too long'); await sleep(5); } };

// ---- stand-ins
// The helper: one sample per character said (the character's code), at 24 kHz. What it is asked decides how it fails.
const standin = path.join(dir, 'helper.js');
fs.writeFileSync(standin, `
const mode = process.argv[2] || '';
const send = (h, pcm = Buffer.alloc(0)) => { const head = Buffer.from(JSON.stringify(h)); const n = Buffer.alloc(4); n.writeUInt32BE(head.length); process.stdout.write(Buffer.concat([n, head, pcm])); };
if (mode === 'nostart') process.exit(7);
if (mode === 'noload') { send({ ready: false, error: 'FileNotFoundError: no model' }); process.exit(1); }
if (mode.startsWith('slow:')) setTimeout(() => send({ ready: true, rate: 24000, voices: 2 }), Number(mode.slice(5)));
else if (mode !== 'silent') send({ ready: true, rate: 24000, voices: 2 });
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  for (let at; (at = buf.indexOf('\\n')) >= 0;) {
    const req = JSON.parse(buf.slice(0, at)); buf = buf.slice(at + 1);
    const t = req.text;
    if (t.startsWith('DIE')) process.exit(3);
    if (t.startsWith('BAD')) { process.stdout.write(Buffer.from([0xff, 0xff, 0xff, 0xff, 1, 2, 3])); continue; }
    if (t.startsWith('SLOW')) continue;
    if (t.startsWith('ERR')) { send({ id: req.id, error: 'ValueError' }); continue; }
    if (t.startsWith('LEAK')) { send({ id: req.id, error: t }); continue; }
    if (req.voice === 'zz_nobody') { send({ id: req.id, error: 'UnknownVoice' }); continue; }
    const pcm = Buffer.alloc(t.length * 2);
    for (let i = 0; i < t.length; i++) pcm.writeInt16LE(t.charCodeAt(i), i * 2);
    setTimeout(() => send({ id: req.id, rate: 24000, bytes: pcm.length }, pcm), 15);
  }
});
process.stdin.on('end', () => { if (mode !== 'deaf') process.exit(0); });
if (mode === 'deaf') setInterval(() => {}, 1000);
`);
// The macOS voice: as in localvoice.test.mjs, a WAV with one sample per character.
const fakeSay = path.join(dir, 'say');
fs.writeFileSync(fakeSay, `#!/usr/bin/env node
const fs = require('node:fs');
const out = process.argv[process.argv.indexOf('-o') + 1];
let text = '';
process.stdin.on('data', (d) => { text += d; }).on('end', () => {
  text = text.trim();
  const data = Buffer.alloc(text.length * 2);
  for (let i = 0; i < text.length; i++) data.writeInt16LE(text.charCodeAt(i), i * 2);
  const fmt = Buffer.alloc(24); fmt.write('fmt '); fmt.writeUInt32LE(16, 4); fmt.writeUInt16LE(1, 8); fmt.writeUInt16LE(1, 10); fmt.writeUInt32LE(44100, 12); fmt.writeUInt32LE(88200, 16); fmt.writeUInt16LE(2, 20); fmt.writeUInt16LE(16, 22);
  const head = Buffer.alloc(8); head.write('data'); head.writeUInt32LE(data.length, 4);
  const body = Buffer.concat([Buffer.from('WAVE'), fmt, head, data]);
  const riff = Buffer.alloc(8); riff.write('RIFF'); riff.writeUInt32LE(body.length, 4);
  fs.writeFileSync(out, Buffer.concat([riff, body]));
});
`, { mode: 0o755 });
const heard = (chunks) => { const b = Buffer.concat(chunks.map((c) => Buffer.from(c))); let s = ''; for (let i = 0; i < b.length; i += 2) s += String.fromCharCode(b.readInt16LE(i)); return s; };

// A "python" that exists and can be run, and a model folder, in the stand-in home.
const python = path.join(dir, 'env', 'bin', 'python');
fs.mkdirSync(path.dirname(python), { recursive: true }); fs.writeFileSync(python, '#!/bin/sh\n', { mode: 0o755 });
const modelDir = path.join(home, '.cache', 'huggingface', 'hub', 'models--mlx-community--Kokoro-82M-bf16');
fs.mkdirSync(path.join(modelDir, 'snapshots', 'abc', 'voices'), { recursive: true });
fs.mkdirSync(path.join(home, '.cache', 'huggingface', 'hub', 'blobs', 'aa'), { recursive: true });
fs.writeFileSync(path.join(home, '.cache', 'huggingface', 'hub', 'blobs', 'aa', 'weights'), 'w');
fs.symlinkSync(path.join(home, '.cache', 'huggingface', 'hub', 'blobs', 'aa', 'weights'), path.join(modelDir, 'snapshots', 'abc', 'voices', 'bm_george.safetensors'));
fs.writeFileSync(path.join(home, 'secret.txt'), 'private');

const base = () => ({ kokoro: { python, model: 'mlx-community/Kokoro-82M-bf16', voice: 'bm_george', lang: 'b', speed: 1.05, cacheMB: 0, memoryMB: 400, waitAtStartSeconds: 8 }, limits: { kokoroTimeoutSeconds: 2, kokoroSentenceChars: 120 } });
/** An engine on the stand-in helper. spawns: every start, as it was asked for; events: what was asked and what came back, in order. */
function engine(mode = '', change = (s) => s, extra = {}) {
  const spawns = [], events = [], downs = [], logs = [];
  let ready = 0;
  const st = change(base());
  const k = createKokoro({
    ...extra,
    settings: () => st, home, tmpRoot: dir,
    log: (kind, data) => logs.push([kind, data]),
    onDown: (why) => { downs.push(why); events.push('down'); },
    onReady: () => { ready++; },
    spawnImpl: (cmd, args, opts) => {
      spawns.push({ cmd, args, opts });
      const c = spawn(process.execPath, [standin, mode], { stdio: opts.stdio });
      const write = c.stdin.write.bind(c.stdin);
      c.stdin.write = (line, ...rest) => { events.push(`ask:${JSON.parse(line).text}`); return write(line, ...rest); };
      return c;
    },
  });
  return { k, spawns, events, downs, logs, st, ready: () => ready };
}
/** A reply's voice on that engine. → what it handed over, and in which order. */
function voice(e, extra = {}) {
  const got = [], rates = [];
  let end, ended = false, err = null;
  const done = new Promise((r) => { end = r; });
  const v = new (voiceFor(e.k, () => e.st))({
    sayBin: fakeSay, platform: 'darwin',
    onAudio: (pcm) => { got.push(pcm); rates.push(v.rate); e.events.push(`audio:${heard([pcm])}`); },
    onEnd: () => { ended = true; end(); }, onError: (x) => { err = x; end(); }, ...extra,
  }).open();
  return { v, got, rates, done, get ended() { return ended; }, get err() { return err; } };
}

// ---- b. the Python: only a full path to a program that exists
assert.equal(pythonProblem(python), '');
assert.match(pythonProblem('python'), /not a full path/);
assert.match(pythonProblem('bin/python'), /not a full path/);
assert.match(pythonProblem('~/env/bin/python'), /not a full path/, 'a path with ~ is not a full path');
assert.match(pythonProblem(path.join(dir, 'nothing', 'python')), /not a program that exists/);
assert.match(pythonProblem(path.dirname(python)), /not a program/, 'a folder is not a program');
{ const plain = path.join(dir, 'plain'); fs.writeFileSync(plain, 'x', { mode: 0o644 }); assert.match(pythonProblem(plain), /not a program that exists/, 'a file that cannot be run'); }
assert.match(pythonProblem(''), /empty/); assert.match(pythonProblem(undefined), /empty/);
for (const bad of ['python', path.join(dir, 'nothing', 'python')]) { // anything else: said once, nothing started, the macOS voice speaks
  const e = engine('', (s) => { s.kokoro.python = bad; return s; });
  e.k.start();
  assert.equal(e.spawns.length, 0, 'nothing is started');
  assert.equal(e.downs.length, 1); assert.match(e.downs[0], /kokoro\.python/);
  assert.equal(e.k.usable, false);
  const r = voice(e); r.v.say('Hello there.'); r.v.end(); await r.done;
  assert.equal(heard(r.got), 'Hello there.', 'spoken by the macOS voice');
  assert.deepEqual(r.rates, [44100]);
}

// ---- 1.1, 1.2, 1.3, b. how it is started
{
  process.env.HTTPS_PROXY = 'http://proxy.example:8080'; process.env.HF_TOKEN = 'secret-token'; process.env.PYTHONPATH = '/elsewhere';
  const e = engine();
  e.k.start(); e.k.start();
  await until(() => e.k.ready);
  assert.equal(e.spawns.length, 1, 'started once');
  const { cmd, args, opts } = e.spawns[0];
  assert.equal(cmd, SANDBOX_EXEC, 'inside the sandbox');
  assert.equal(args[0], '-p'); assert.equal(args[2], python, 'the Python from the settings, by its full path');
  assert.deepEqual(args.slice(3, 5), ['-I', '-u']);
  assert.equal(path.basename(args[5]), 'kokoro_server.py');
  assert.ok(args[5].startsWith(dir) && fs.existsSync(args[5]), 'the script is run from the private temporary folder');
  assert.equal(fs.readFileSync(args[5], 'utf8'), fs.readFileSync(path.join(here, '..', 'kokoro_server.py'), 'utf8'), 'and is the one shipped with the app');
  assert.deepEqual(args.slice(6), ['mlx-community/Kokoro-82M-bf16', modelDir, 'b', 'bm_george', '0', '400'], "a fixed list: the model, where it is, the language, the voice, MLX's cache and memory limits in MB");
  assert.equal(args.length, 12);
  assert.equal(opts.shell, false, 'never through a shell'); assert.equal(opts.detached, false);
  assert.deepEqual(opts.stdio, ['pipe', 'pipe', 'ignore'], 'its own pipes; its error stream goes nowhere');
  assert.ok(!args.some((a) => /--port|--host|:\d{2,5}$|localhost|127\.0\.0\.1/.test(a) && !a.startsWith('(version 1)')), 'no port and no address');
  // the environment: only what is listed, with the offline switches; nothing of Roamies' own
  assert.deepEqual(Object.keys(opts.env).sort(), ['DO_NOT_TRACK', 'HF_DATASETS_OFFLINE', 'HF_HUB_CACHE', 'HF_HUB_DISABLE_IMPLICIT_TOKEN', 'HF_HUB_DISABLE_TELEMETRY', 'HF_HUB_OFFLINE', 'HOME', 'LANG', 'NO_PROXY', 'PATH', 'PYTHONDONTWRITEBYTECODE', 'PYTHONNOUSERSITE', 'TMPDIR', 'TRANSFORMERS_OFFLINE']);
  for (const k of ['HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE', 'HF_DATASETS_OFFLINE', 'HF_HUB_DISABLE_TELEMETRY']) { assert.equal(opts.env[k], '1'); assert.equal(OFFLINE[k], '1'); }
  assert.ok(!Object.keys(opts.env).some((k) => /proxy/i.test(k) && k !== 'NO_PROXY'), 'no proxy setting is passed on');
  assert.ok(!JSON.stringify(opts.env).includes('secret-token') && !('PYTHONPATH' in opts.env));
  assert.equal(opts.cwd, opts.env.TMPDIR); assert.ok(opts.cwd.startsWith(dir));
  assert.equal(fs.statSync(opts.cwd).mode & 0o777, 0o700, 'the temporary folder is the owner\'s alone');
  // two replies, one process
  const a = voice(e); a.v.say('One.'); a.v.end(); await a.done;
  const b = voice(e); b.v.say('Two.'); b.v.end(); await b.done;
  assert.equal(heard(a.got) + heard(b.got), 'One.Two.');
  assert.deepEqual([...a.rates, ...b.rates], [24000, 24000], 'the audio carries the helper\'s rate');
  assert.equal(e.spawns.length, 1, 'the same process speaks both');
  // a. what was said is in no argument, no log line and no file of the temporary folder
  assert.ok(!e.spawns[0].args.join(' ').includes('One.'), 'the text is never an argument');
  assert.ok(!JSON.stringify(e.logs).includes('One.') && !JSON.stringify(e.logs).includes('Two.'), 'nor in a log line');
  for (const f of fs.readdirSync(opts.cwd)) assert.ok(!fs.readFileSync(path.join(opts.cwd, f), 'utf8').includes('Two.'), 'nor in a file');
  // 1.6: at quit its input is closed and it ends; the temporary folder goes with it
  const tmp = opts.cwd;
  e.k.stop();
  await until(() => !fs.existsSync(tmp));
  assert.equal(e.downs.length, 0, 'quitting is not a failure');
  delete process.env.HTTPS_PROXY; delete process.env.HF_TOKEN; delete process.env.PYTHONPATH;
}

// ---- 1.3, d. the sandbox profile
{
  const tmp = path.join(dir, 'ptmp'); fs.mkdirSync(tmp);
  const profile = kokoroProfile({ home, tmp, modelDir, python });
  const lines = profile.trim().split('\n');
  assert.equal(lines[0], '(version 1)');
  const at = (re) => lines.findIndex((l) => re.test(l));
  assert.ok(at(/^\(deny network\*\)$/) > at(/^\(allow default\)$/), 'every kind of network is denied');
  assert.ok(!lines.some((l) => /allow[^)]*network/.test(l)), 'and nothing opens it again');
  assert.ok(at(/^\(deny file-write\* \(subpath "\/"\)\)$/) > 0, 'no writing anywhere');
  const writes = lines.filter((l) => l.startsWith('(allow file-write*'));
  assert.deepEqual(writes, [`(allow file-write* (subpath "${tmp}") (literal "/dev/null"))`], 'but in its temporary folder');
  assert.ok(at(new RegExp(`^\\(deny file-read\\* \\(subpath "${home}"\\)\\)$`)) > 0, 'no reading in the home folder');
  const reads = lines.filter((l) => l.startsWith('(allow file-read* ')).join(' ');
  assert.ok(reads.includes(`(subpath "${modelDir}")`), 'but the model\'s folder');
  assert.ok(reads.includes(`(literal "${path.join(home, '.cache', 'huggingface', 'hub', 'blobs', 'aa', 'weights')}")`), 'and the model\'s own files in the shared store, one by one');
  assert.ok(!reads.includes(`(subpath "${path.join(home, '.cache', 'huggingface', 'hub', 'blobs')}")`) && !reads.includes(`(subpath "${home}")`), 'not the store, not the home folder');
  assert.ok(!reads.includes(path.dirname(python)), 'a Python outside the home folder needs no rule');
  const inHome = path.join(home, 'envs', 'x', 'bin', 'python'); fs.mkdirSync(path.dirname(inHome), { recursive: true }); fs.writeFileSync(inHome, '', { mode: 0o755 });
  assert.ok(kokoroProfile({ home, tmp, modelDir, python: inHome }).includes(`(subpath "${path.join(home, 'envs', 'x')}")`), 'a Python inside the home folder: its own folder is readable');
  assert.ok(at(/^\(deny process-exec\*\)$/) > 0, 'it starts no other program');
  assert.throws(() => kokoroProfile({ home, tmp: `${tmp}\n(allow network*)`, modelDir, python }), /line break/);
  assert.deepEqual(modelPlace('mlx-community/Kokoro-82M-bf16', home), { hub: path.join(home, '.cache', 'huggingface', 'hub'), dir: modelDir, name: 'mlx-community/Kokoro-82M-bf16' });
  assert.equal(modelPlace('/models/kokoro', home).dir, '/models/kokoro');
  assert.equal(helperEnv({ home, tmp, hub: 'h' }).TMPDIR, tmp);

  // On a Mac the profile is applied for real: a program under it can't connect, can't write outside the temporary
  // folder, and can't read the home folder, but can read the model.
  if (process.platform === 'darwin' && fs.existsSync(SANDBOX_EXEC)) {
    const server = net.createServer((s) => s.end('hello')); await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const node = fs.realpathSync(process.execPath);
    const real = kokoroProfile({ home, tmp, modelDir, python: node });
    const probe = `
      const fs = require('node:fs'), net = require('node:net');
      const out = {};
      const t = (name, fn) => { try { fn(); out[name] = 'ok'; } catch (e) { out[name] = e.code || 'failed'; } };
      t('writeTmp', () => fs.writeFileSync(${JSON.stringify(path.join(tmp, 'a.txt'))}, 'x'));
      t('writeElsewhere', () => fs.writeFileSync(${JSON.stringify(path.join(dir, 'outside.txt'))}, 'x'));
      t('writeHome', () => fs.writeFileSync(${JSON.stringify(path.join(home, 'new.txt'))}, 'x'));
      t('readHome', () => fs.readFileSync(${JSON.stringify(path.join(home, 'secret.txt'))}));
      t('listHome', () => fs.readdirSync(${JSON.stringify(home)}));
      t('readModel', () => fs.readFileSync(${JSON.stringify(path.join(modelDir, 'snapshots', 'abc', 'voices', 'bm_george.safetensors'))}));
      t('run', () => require('node:child_process').execFileSync('/bin/echo', ['hi']));
      const s = net.connect(${server.address().port}, '127.0.0.1');
      s.on('connect', () => { out.connect = 'ok'; console.log(JSON.stringify(out)); process.exit(0); });
      s.on('error', (e) => { out.connect = e.code; console.log(JSON.stringify(out)); process.exit(0); });`;
    const r = spawnSync(SANDBOX_EXEC, ['-p', real, node, '-e', probe], { encoding: 'utf8', timeout: 20_000, cwd: tmp });
    server.close();
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim().split('\n').at(-1));
    assert.equal(out.writeTmp, 'ok'); assert.equal(out.readModel, 'ok');
    assert.notEqual(out.connect, 'ok', 'a connection is refused by the sandbox, even to this Mac');
    for (const k of ['writeElsewhere', 'writeHome', 'readHome', 'listHome', 'run']) assert.notEqual(out[k], 'ok', `${k} is refused`);
    assert.ok(!fs.existsSync(path.join(dir, 'outside.txt')) && !fs.existsSync(path.join(home, 'new.txt')));
  }
}

// ---- 1.4. sentence by sentence, and a mark still means "everything before it has been handed over"
{
  const e = engine(); e.k.start(); await until(() => e.k.ready);
  const r = voice(e);
  r.v.say('One.'); r.v.say('Two.'); r.v.say('Three.');
  r.v.mark(() => e.events.push('mark'));
  r.v.say('Four.');
  r.v.mark(() => e.events.push('mark2'));
  r.v.end(); await r.done;
  assert.deepEqual(e.events, ['ask:One.', 'audio:One.', 'ask:Two.', 'audio:Two.', 'ask:Three.', 'audio:Three.', 'mark', 'ask:Four.', 'audio:Four.', 'mark2'],
    'each sentence is handed over before the next is asked for, and a mark comes after the audio of everything before it');
  assert.ok(r.ended);
  // through speaker.mjs: the overlay is sent the mark only after the last sentence's audio
  const out = [];
  const sp = createSpeaker({ emit: (m) => out.push(m), pickVoice: () => class extends voiceFor(e.k, () => e.st) { constructor(o) { super({ ...o, sayBin: fakeSay, platform: 'darwin' }); } }, beatPhrases: [] });
  sp.setKey('local');
  const reply = sp.start(); reply.say('Alpha.'); reply.say('Beta.'); const name = reply.mark(); reply.end();
  await until(() => out.some((m) => m.end));
  const kinds = out.filter((m) => m.kind === 'speech' && !m.stop).map((m) => (m.pcm ? `pcm@${m.rate}` : m.mark ? 'mark' : 'end'));
  assert.deepEqual(kinds, ['pcm@24000', 'pcm@24000', 'mark', 'end']);
  assert.equal(out.find((m) => m.mark).mark, name);
  // cutting (they started talking while a bubble was open): what waits is dropped, its marks are called at once
  e.events.length = 0;
  const c = voice(e);
  c.v.say('First.'); c.v.say('Second.'); c.v.mark(() => e.events.push('mark'));
  c.v.cut();
  assert.ok(e.events.includes('mark'), 'the mark is not left waiting');
  c.v.say('After.'); c.v.end(); await c.done;
  assert.equal(heard(c.got), 'After.', 'the sentence being made when they spoke is thrown away; the voice stays usable');
  // stopping (they started talking): nothing more is handed over, and the helper is still there for the next reply
  const s = voice(e); s.v.say('Dropped.'); s.v.abort(); await sleep(60);
  assert.equal(heard(s.got), '');
  const n = voice(e); n.v.say('Next.'); n.v.end(); await n.done;
  assert.equal(heard(n.got), 'Next.'); assert.equal(e.downs.length, 0); assert.equal(e.spawns.length, 1);
  e.k.stop();
}

// ---- 1.5. never silence: every failure is said once and the sentence in hand is still spoken
for (const [mode, text, why] of [['', 'DIE now.', /it stopped \(3\)/], ['', 'BAD block.', /isn't audio/], ['', 'SLOW one.', /took too long/], ['', 'ERR here.', /failed on a sentence \(ValueError\)/]]) {
  const e = engine(mode); e.k.start(); await until(() => e.k.ready);
  const r = voice(e);
  r.v.say('Fine.'); r.v.say(text); r.v.mark(() => e.events.push('mark')); r.v.say('Then this.'); r.v.end(); await r.done;
  assert.equal(heard(r.got), `Fine.${text}Then this.`, `${text} nothing is lost`);
  assert.deepEqual(r.rates, [24000, 44100, 44100], 'the macOS voice takes over from the sentence that failed');
  assert.equal(e.downs.length, 1, 'said once'); assert.match(e.downs[0], why);
  assert.ok(e.events.indexOf('mark') > e.events.indexOf(`audio:${text}`) && e.events.indexOf('mark') < e.events.indexOf('audio:Then this.'), 'the order of sentences and marks holds through the fallback');
  assert.ok(!e.downs[0].includes(text) && !JSON.stringify(e.logs).includes(text.slice(0, 6)), 'a. the failure message does not carry the sentence');
  const next = voice(e); next.v.say('Later.'); next.v.end(); await next.done;
  assert.equal(heard(next.got), 'Later.'); assert.deepEqual(next.rates, [44100], 'the rest of the session is the macOS voice');
  assert.equal(e.spawns.length, 1, 'it is not started again'); assert.equal(e.downs.length, 1);
  assert.equal(e.k.usable, false);
  e.k.start(); assert.equal(e.spawns.length, 1, 'not even when asked');
}
{ // a. a helper that put the sentence in its failure message: the message is not passed on
  const e = engine(); e.k.start(); await until(() => e.k.ready);
  const r = voice(e); r.v.say('LEAK my hidden phrase.'); r.v.end(); await r.done;
  assert.equal(e.downs.length, 1);
  assert.ok(!/hidden|LEAK/.test(e.downs[0]) && !/hidden|LEAK/.test(JSON.stringify(e.logs)), 'only a one-word kind of failure is ever taken from the helper');
  assert.match(e.downs[0], /\(Error\)/);
}
for (const [mode, why] of [['nostart', /it stopped \(7\)/], ['noload', /couldn't load the model \(FileNotFoundError: no model\)/], ['silent', /took too long to start/]]) { // it can't start
  const e = engine(mode, (s) => { s.limits.kokoroTimeoutSeconds = 0.05; return s; });
  e.k.start();
  // while it is still starting, a sentence does not wait for it
  const early = voice(e); early.v.say('Early.'); early.v.end(); await early.done;
  assert.equal(heard(early.got), 'Early.'); assert.deepEqual(early.rates, [44100]);
  await until(() => e.downs.length === 1);
  assert.match(e.downs[0], why);
  const r = voice(e); r.v.say('Hello.'); r.v.end(); await r.done;
  assert.equal(heard(r.got), 'Hello.'); assert.equal(e.downs.length, 1);
}
{ // the sandbox program itself is missing, or the model isn't on this Mac
  const downs = [];
  const k = createKokoro({ settings: base, home, tmpRoot: dir, sandboxExec: path.join(dir, 'no-sandbox-exec'), onDown: (w) => downs.push(w) });
  k.start(); await until(() => downs.length === 1);
  assert.match(downs[0], /couldn't be started \(ENOENT\)/);
  const e = engine('', (s) => { s.kokoro.model = 'someone/other-model'; return s; });
  e.k.start();
  assert.equal(e.spawns.length, 0); assert.match(e.downs[0], /the model is not on this Mac/);
}
{ // 1.7: a voice the model doesn't have
  const e = engine('', (s) => { s.kokoro.voice = 'zz_nobody'; return s; }); e.k.start(); await until(() => e.k.ready);
  const r = voice(e); r.v.say('Hello.'); r.v.end(); await r.done;
  assert.equal(heard(r.got), 'Hello.'); assert.match(e.downs[0], /no voice named zz_nobody/);
}

// ---- 1.6. no orphans
{
  const e = engine('deaf'); e.k.start(); await until(() => e.k.ready);
  const pid = e.k.pid;
  const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
  assert.ok(alive());
  const t0 = Date.now();
  e.k.stop();
  await until(() => !alive(), QUIT_KILL_MS + 3000);
  assert.ok(Date.now() - t0 >= QUIT_KILL_MS - 100, 'a helper that ignores its input closing is killed');
  assert.equal(e.downs.length, 0);
}

// ---- the script itself (1.2, 1.6, 1.7, a)
{
  const py = fs.readFileSync(path.join(here, '..', 'kokoro_server.py'), 'utf8');
  const code = py.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  assert.ok(!/\bimport socket|\bsocket\.|\blisten\(|\bbind\(|http\.server|socketserver|uvicorn|flask|asyncio\.start_server/.test(code), 'it opens no socket and listens on nothing');
  assert.ok(!/subprocess|os\.system|os\.popen|os\.exec|os\.spawn|Popen|multiprocessing/.test(code), 'it starts no other process');
  assert.ok(!/\bprint\(|logging|traceback|sys\.stderr|\.write\(|(?<![.\w])open\(/.test(code.replace('out.write(struct.pack', 'OUT(')), 'it never prints, logs or writes to a file');
  assert.equal((code.match(/out\.write\(/g) ?? []).length, 1, 'one place writes, and it writes audio blocks');
  const loop = code.slice(code.indexOf('for line in sys.stdin'));
  assert.ok(loop.length > 100 && !/str\(e\)|repr\(|req\[['"]text['"]\]\s*[,)}]|format\(|f"/.test(loop.replace('text=req["text"]', 'TEXT')), 'after a sentence has been given, a failure names its kind only');
  assert.match(loop, /send\(\{"id": rid, "error": type\(e\)\.__name__\}\)/);
  assert.match(code, /if os\.getppid\(\) != PARENT:\s*os\._exit\(0\)/, 'it ends when its parent is gone');
  assert.match(code, /for line in sys\.stdin:/, 'and when its input closes');
  assert.match(code, /VOICE_NAME = re\.compile\(r"\^\[a-z\]\{2\}_\[a-z0-9\]\{1,32\}\$"\)/);
  assert.match(code, /not VOICE_NAME\.match\(voice\) or voice not in voices/, 'a voice is used only if it ships with the model');
  assert.ok(!/ref_audio|ref_text|clone|\.wav|speaker_wav/.test(code), 'nothing takes a recording of a voice');
  assert.match(code, /os\.dup2\(2, 1\)/, 'what a library prints cannot land among the audio');
  // Feature 24: the limits are MLX's before the model is loaded. The script itself, run with stand-ins for its
  // libraries: the stand-in model loads only if both limits were already set to what the settings say, and its
  // working memory is what MLX would hold under them; the helper says how much it reached.
  assert.ok(code.indexOf('mx.set_cache_limit(int(sys.argv[5]) * 1024 * 1024)') > 0 && code.indexOf('mx.set_memory_limit(int(sys.argv[6]) * 1024 * 1024)') > 0, 'both limits come from the arguments, in MB');
  assert.ok(code.indexOf('mx.set_memory_limit') < code.indexOf('load(model_name)'), 'and are set before the model is loaded');
  const py3 = ['/usr/bin/python3', '/opt/homebrew/bin/python3', '/usr/local/bin/python3'].find((f) => fs.existsSync(f));
  if (process.platform === 'darwin') assert.ok(py3, 'a Python to run the helper script with stand-in libraries');
  if (py3) {
    const lib = fs.mkdtempSync(path.join(dir, 'standin-'));
    fs.mkdirSync(path.join(lib, 'mlx')); fs.mkdirSync(path.join(lib, 'mlx_audio', 'tts'), { recursive: true });
    fs.writeFileSync(path.join(lib, 'numpy.py'), '');
    fs.writeFileSync(path.join(lib, 'mlx', '__init__.py'), '');
    fs.writeFileSync(path.join(lib, 'mlx', 'core.py'), 'cache = None\nmemory = None\ndef set_cache_limit(n):\n    global cache\n    cache = n\ndef set_memory_limit(n):\n    global memory\n    memory = n\n');
    fs.writeFileSync(path.join(lib, 'mlx_audio', '__init__.py'), ''); fs.writeFileSync(path.join(lib, 'mlx_audio', 'tts', '__init__.py'), '');
    // A sentence at the length limit: 1,570 MB of working memory, less what the memory limit holds back, plus
    // as much again in the cache unless the cache limit stops it (the measured shape, bench/kokoromem.py).
    fs.writeFileSync(path.join(lib, 'mlx_audio', 'tts', 'utils.py'), [
      'import mlx.core as mx', 'MB = 1024 * 1024',
      'class Model:', '    sample_rate = 24000', '    def generate(self, **kw):', '        return []',
      'def load(name):',
      '    if mx.cache is None or mx.memory is None:', '        raise RuntimeError("limits not set before the model was loaded")',
      '    work = min(1570, max(600, mx.memory // MB))', '    highest = 390 + 313 + work + min(work, mx.cache // MB)',
      '    if highest > 1500:', '        raise RuntimeError("highest %d MB" % highest)',
      '    return Model()', ''].join('\n'));
    const modelDir2 = path.join(lib, 'model'); fs.mkdirSync(path.join(modelDir2, 'voices'), { recursive: true }); fs.writeFileSync(path.join(modelDir2, 'voices', 'bm_george.safetensors'), '');
    const start = (limits) => {
      const r = spawnSync(py3, ['-u', path.join(here, '..', 'kokoro_server.py'), 'm', modelDir2, 'b', 'bm_george', ...limits], { env: { PYTHONPATH: lib, PATH: '/usr/bin:/bin' }, input: '', timeout: 20_000 });
      const n = r.stdout.readUInt32BE(0); return JSON.parse(r.stdout.subarray(4, 4 + n).toString('utf8'));
    };
    assert.deepEqual(start(['0', '400']), { ready: true, rate: 24000, voices: 1 }, 'with the defaults a sentence at the length limit stays under 1.5 GB');
    assert.match(start(['16384', '16384']).error, /highest 3843 MB/, 'the limits are what bounds it: without them, 3.8 GB');
    assert.match(start(['0', '16384']).error, /highest 2273 MB/, 'the cache limit alone is not enough');
    assert.equal(start([]).ready, false, 'no limits given: it does not start');
  }
  // bundle.sh ships it
  assert.match(fs.readFileSync(path.join(here, '..', 'bundle.sh'), 'utf8'), /cp kokoro_server\.py dist\//);
}

// ---- c. a long sentence is split at a clause, so one piece is quick to make and to drop
assert.deepEqual(splitLong('Short one.', 40), ['Short one.']);
assert.deepEqual(splitLong('The block is on Friday at ten, and Super Productivity is open; I have booked the slot.', 50), ['The block is on Friday at ten,', 'and Super Productivity is open;', 'I have booked the slot.']);
assert.deepEqual(splitLong('one two three four five six seven eight nine ten', 20), ['one two three four', 'five six seven eight', 'nine ten'], 'no clause: between words');
assert.deepEqual(splitLong('x'.repeat(50), 20), ['x'.repeat(20), 'x'.repeat(20), 'x'.repeat(10)], 'no words: by length');
for (const max of [40, 60, 120]) for (const p of splitLong(`${'Alpha beta gamma, delta epsilon; '.repeat(12)}end.`, max)) assert.ok(p.length <= max && p.length > 0);
assert.equal(splitLong('Well, it is done and I will say no more about it at all today.', 40)[0], 'Well, it is done and I will say no more', 'a comma in the first few words is not where it is cut');
{
  const e = engine('', (s) => { s.limits.kokoroSentenceChars = 40; return s; }); e.k.start(); await until(() => e.k.ready);
  const r = voice(e);
  r.v.say('The block is on Friday at ten, and Super Productivity is open, so it is booked.'); r.v.end(); await r.done;
  const asked = e.events.filter((x) => x.startsWith('ask:')).map((x) => x.slice(4));
  assert.deepEqual(asked, ['The block is on Friday at ten,', 'and Super Productivity is open,', 'so it is booked.']);
  assert.ok(asked.every((p) => p.length <= 40));
  e.k.stop();
}

// ---- feature 24: the helper sleeps when quiet, wakes when asked, and a reply keeps one voice
{
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  let t = 0;
  const ticks = [];
  const e = engine('', (st) => ({ ...st, kokoro: { ...st.kokoro, sleepAfterMinutes: 5 } }), { now: () => t, every: (fn, ms) => ticks.push([fn, ms]) });
  assert.deepEqual(ticks.map(([, ms]) => ms), [30_000], 'its quiet time is looked at every 30 s');
  const tick = (ms) => { for (const end = t + ms; t < end;) { t = Math.min(end, t + 30_000); for (const [fn] of ticks) fn(); } };
  e.k.start(); await until(() => e.k.ready);
  const first = e.k.pid;
  const a = voice(e); a.v.say('One.'); a.v.end(); await a.done;
  tick(4.5 * 60_000); assert.equal(e.k.state, 'ready', 'not before five quiet minutes');
  tick(30_000); assert.equal(e.k.state, 'asleep', 'asleep after five');
  assert.equal(e.k.ready, false); assert.equal(e.k.usable, false); assert.equal(e.k.pid, null);
  await until(() => !alive(first));
  assert.deepEqual(e.downs, [], 'no bubble: sleeping is not a failure');
  assert.deepEqual(e.logs.filter(([k]) => k === 'kokoro_sleep'), [['kokoro_sleep', { quietMinutes: 5 }]]);
  tick(60 * 60_000); assert.equal(e.spawns.length, 1, 'asleep, it stays asleep until woken');
  // a sentence asked for while asleep is refused as not ready (the macOS voice speaks it) and doesn't wake it
  await assert.rejects(e.k.make('Asleep.', { voice: 'bm_george', speed: 1 }), (x) => x.notReady === false);
  assert.equal(e.k.state, 'asleep');

  // woken: started again, ready, its beats made again, and it speaks in its own voice
  assert.equal(e.k.wake('talk key'), true);
  assert.equal(e.spawns.length, 2); assert.deepEqual(e.logs.find(([k]) => k === 'kokoro_wake'), ['kokoro_wake', { why: 'talk key' }]);
  await until(() => e.k.ready);
  assert.equal(e.ready(), 2, 'ready again: the beats are made again in its voice');
  assert.notEqual(e.k.pid, first);
  const b = voice(e); b.v.say('Two.'); b.v.end(); await b.done;
  assert.equal(heard(b.got), 'Two.'); assert.deepEqual([...new Set(b.rates)], [24000]);
  assert.equal(e.k.wake('spoken request'), false, 'awake: nothing to start');
  assert.equal(e.spawns.length, 2);

  // never while a reply in its voice is open, however long
  const c = voice(e); c.v.say('Three.'); await until(() => c.got.length);
  tick(60 * 60_000); assert.equal(e.k.state, 'ready', 'a reply in its voice is open: it stays awake');
  c.v.end(); await c.done;
  tick(4.5 * 60_000); assert.equal(e.k.state, 'ready', 'quiet counts from the end of that reply');
  // woken while awake: its quiet time starts again
  e.k.wake('answer window'); tick(4.5 * 60_000); assert.equal(e.k.state, 'ready', 'a wake while awake puts sleep off');
  tick(30_000); assert.equal(e.k.state, 'asleep');

  // a whole reply in one voice. Started while it is asleep: the macOS voice, to the end, even though the helper is
  // woken and ready before the reply's second sentence. Its marks still come after its audio.
  const out = [];
  const Mac = class extends LocalVoice { constructor(o) { super({ ...o, sayBin: fakeSay, platform: 'darwin' }); } };
  const Natural = class extends voiceFor(e.k, () => e.st) { constructor(o) { super({ ...o, sayBin: fakeSay, platform: 'darwin' }); } };
  const sp = createSpeaker({ emit: (m) => out.push(m), FishVoiceImpl: Mac, pickVoice: () => (e.k.ready ? Natural : null), beatPhrases: ['Right away.'] });
  sp.setKey('local');
  const kinds = (from) => out.slice(from).filter((m) => m.kind === 'speech' && !m.stop).map((m) => (m.pcm ? `pcm@${m.rate}` : m.mark ? 'mark' : 'end'));
  await until(() => sp.ready === 1); // the beat, kept in the macOS voice while it is asleep
  let from = out.length;
  const r1 = sp.start(); r1.say('Alpha.');
  e.k.wake('spoken request'); await until(() => e.k.ready);
  r1.say('Beta.'); r1.mark(); r1.end();
  await until(() => out.slice(from).some((m) => m.end));
  assert.deepEqual(kinds(from), ['pcm@44100', 'pcm@44100', 'mark', 'end'], 'started asleep: the macOS voice throughout, the mark after its audio');
  // the beats are made again in its voice; a reply started now is in its voice throughout, beat included
  sp.setBeats(['Right away.'], true); await until(() => sp.ready === 1); await sleep(50);
  from = out.length;
  const r2 = sp.start(); assert.equal(r2.beat(), true); r2.say('Gamma.'); r2.mark(); r2.end();
  await until(() => out.slice(from).some((m) => m.end));
  assert.deepEqual(kinds(from), ['pcm@24000', 'pcm@24000', 'mark', 'end'], 'started ready: its voice throughout');
  // asleep again: a beat kept in its voice is not played in a macOS reply; it is said in the macOS voice
  tick(5 * 60_000); assert.equal(e.k.state, 'asleep');
  from = out.length;
  const r3 = sp.start(); assert.equal(r3.beat(), true); r3.say('Delta.'); r3.end();
  await until(() => out.slice(from).some((m) => m.end));
  assert.deepEqual(kinds(from), ['pcm@44100', 'pcm@44100', 'end'], 'asleep: the beat in the macOS voice, then the reply in it');
  // quit while asleep: nothing to end
  e.k.stop(); assert.equal(e.k.state, 'stopped');

  // 0 (the default): never
  let t0 = 0; const ticks0 = [];
  const z = engine('', (st) => ({ ...st, kokoro: { ...st.kokoro, sleepAfterMinutes: 0 } }), { now: () => t0, every: (fn) => ticks0.push(fn) });
  z.k.start(); await until(() => z.k.ready);
  for (let i = 0; i < 48 * 120; i++) { t0 += 30_000; for (const fn of ticks0) fn(); }
  assert.equal(z.k.state, 'ready', '0: awake after two days of quiet'); z.k.stop();

  // the wiring: what wakes it, and the voice a reply is given
  const side = fs.readFileSync(path.join(here, '..', 'sidekick.mjs'), 'utf8');
  assert.match(side, /if \(m\.type === 'voice_state' && m\.state === 'listening'\) kokoro\.wake\(m\.window != null \? 'answer window' : 'talk key'\);/, 'the talk key, and the answer window\'s listening');
  assert.match(side, /else if \(m\.type === 'voice' && m\.text\?\.trim\(\)\) (?:\{ )?kokoro\.wake\('spoken request'\);/, 'a spoken request');
  assert.match(side, /kokoro\.wake\('answer window'\); send\(\{ type: 'listen', seconds, window, again \}\);/, 'an answer window, as it opens');
  assert.match(side, /if \(!stood\?\.on\(\) && pi\.briefing\(new Date\(Date\.now\(\) \+ WAKE_BEFORE_BRIEFING_MINUTES \* 60_000\)\)\) kokoro\.wake\('briefing'\);/, 'shortly before a briefing');
  assert.equal(WAKE_BEFORE_BRIEFING_MINUTES, 2);
  assert.equal((side.match(/kokoro\.wake\(/g) ?? []).length, 4, 'and nothing else');
}

// ---- 1.8. the settings
{
  const h = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kv-home-')));
  const file = path.join(h, 'Documents', 'roamies-pi', 'settings.json');
  const d = settingsDefaults(h);
  assert.equal(d.voiceEngine, 'kokoro'); assert.deepEqual(VOICE_ENGINES, ['kokoro', 'system']);
  assert.deepEqual(d.kokoro, { python: '/opt/homebrew/anaconda3/envs/localai/bin/python', model: 'mlx-community/Kokoro-82M-bf16', voice: 'bm_george', lang: 'b', speed: 1.05, cacheMB: 0, memoryMB: 400, sleepAfterMinutes: 0, waitAtStartSeconds: 8 });
  assert.deepEqual([KOKORO.cacheMB.min, KOKORO.cacheMB.max, KOKORO.memoryMB.min, KOKORO.memoryMB.max], [0, 16384, 100, 16384]);
  assert.equal(d.limits.kokoroTimeoutSeconds, 20); assert.equal(d.limits.kokoroSentenceChars, 120);
  const ref = settingsReference(h);
  assert.deepEqual(ref.kokoro, d.kokoro); assert.equal(ref.voiceEngine, 'kokoro');
  assert.ok(ref.limits.kokoroTimeoutSeconds && ref.limits.kokoroSentenceChars && ref.reference.limitRanges.kokoroSentenceChars && ref.reference.kokoroRanges && ref.reference.voiceEngines, 'every new setting is in settings.default.json');
  assert.deepEqual(ref.reference.kokoroRanges.sleepAfterMinutes, { min: 0, max: 1440, wholeNumber: true, zero: 'it never sleeps', wakes: 'on the talk key, an answer window, a spoken request, and 2 minutes before a briefing; meanwhile the Mac\'s voice speaks' });
  assert.deepEqual(ref.reference.kokoroRanges.cacheMB, { min: 0, max: 16384, wholeNumber: true, zero: 'MLX keeps no freed memory for reuse' }); assert.deepEqual(ref.reference.kokoroRanges.memoryMB, { min: 100, max: 16384, wholeNumber: true });
  let s = loadSettings(h);
  assert.deepEqual(s.kokoro, d.kokoro); assert.equal(s.voiceEngine, 'kokoro'); assert.deepEqual(s.invalid, []);
  const write = (o) => fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(JSON.stringify(d)), ...o }));
  write({ voiceEngine: 'system', kokoro: { ...d.kokoro, voice: 'af_heart', speed: 0.9 } });
  s = loadSettings(h);
  assert.equal(s.voiceEngine, 'system'); assert.equal(s.kokoro.voice, 'af_heart'); assert.equal(s.kokoro.speed, 0.9); assert.deepEqual(s.invalid, []);
  write({ voiceEngine: 'cloud', kokoro: { python: 'python', model: 'x', voice: '../../my-voice.wav', lang: 'english', speed: 9, cacheMB: -1, memoryMB: 50, sleepAfterMinutes: 2.5 }, limits: { ...d.limits, kokoroSentenceChars: 5 } });
  s = loadSettings(h);
  assert.equal(s.voiceEngine, 'kokoro');
  assert.equal(s.kokoro.python, 'python', 'kept as written: it is refused when the voice is started, and said');
  assert.equal(s.kokoro.model, KOKORO.model.default); assert.equal(s.kokoro.voice, 'bm_george', 'a path is not a voice'); assert.equal(s.kokoro.lang, 'b'); assert.equal(s.kokoro.speed, 1.05); assert.equal(s.kokoro.cacheMB, 0); assert.equal(s.kokoro.memoryMB, 400);
  assert.equal(s.limits.kokoroSentenceChars, LIMITS.kokoroSentenceChars.default);
  assert.equal(s.kokoro.sleepAfterMinutes, 0, 'whole minutes only');
  assert.deepEqual(s.invalid.map((i) => i.name).sort(), ['kokoro.cacheMB', 'kokoro.lang', 'kokoro.memoryMB', 'kokoro.model', 'kokoro.sleepAfterMinutes', 'kokoro.speed', 'kokoro.voice', 'limits.kokoroSentenceChars', 'voiceEngine']);
  write({ kokoro: { ...d.kokoro, sleepAfterMinutes: 20 } }); assert.equal(loadSettings(h).kokoro.sleepAfterMinutes, 20); assert.deepEqual(loadSettings(h).invalid, []);
  write({ kokoro: { python: d.kokoro.python } });
  assert.deepEqual(loadSettings(h).missing, ['kokoro.model', 'kokoro.voice', 'kokoro.lang', 'kokoro.speed', 'kokoro.cacheMB', 'kokoro.memoryMB', 'kokoro.sleepAfterMinutes', 'kokoro.waitAtStartSeconds']);
  fs.rmSync(h, { recursive: true, force: true });
  // "system" starts nothing; anything else than a Mac starts nothing
  const side = fs.readFileSync(path.join(here, '..', 'sidekick.mjs'), 'utf8');
  assert.match(side, /function startKokoro\(\) \{ if \(MAC\) \{ try \{ if \(settingsNow\(\)\.voiceEngine === 'kokoro'\) kokoro\.start\(\); \}/);
  assert.match(side, /^startKokoro\(\);$/m, 'at start-up'); assert.ok(!/startWith/.test(side), 'the owner, 14:09: kokoro.startWith taken out again; the helper always starts with Roamies');
  assert.equal((side.match(/kokoro\.start\(\)/g) ?? []).length, 1, 'the one place the helper is started');
  assert.match(side, /else if \(id === 'quit'\) \{ pi\.stopAll\(\); kokoro\.stop\(\);/, 'it is stopped when Roamies quits');
  assert.match(side, /pickVoice: \(o\) => replyVoice\(o\),/);
  assert.match(side, /function replyVoice\(o\) \{\n\s*if \(trouble\(\)\) return null;\n\s*return kokoro\.ready \|\| \(o\?\.reply && kokoro\.loadingAtStart\) \? KokoroReplyVoice : null;/, 'feature 24 and 2026-11-28: the natural voice for a reply if its helper is ready, or loading at start (it waits)');
  const sp = fs.readFileSync(path.join(here, '..', 'speaker.mjs'), 'utf8');
  assert.match(sp, /Impl = voiceImpl\(\{ reply: true \}\);/, 'a reply asks as a reply; the short lines made ahead don\'t start or wait for it');
  assert.equal((sp.match(/voiceImpl\(/g) ?? []).length, 2, 'asked once per reply, once per short line');
}

// ---- the owner, 2026-11-28: a reply ready while the helper is still loading at start waits for it
{
  // ready within the wait: the whole reply in the natural voice
  const e = engine('slow:600');
  e.k.start();
  assert.equal(e.k.loadingAtStart, true);
  const t0 = Date.now();
  const r = voice(e); r.v.say('Good morning.'); r.v.say('Ten o\'clock.'); r.v.end(); await r.done;
  assert.equal(heard(r.got), 'Good morning.Ten o\'clock.');
  assert.deepEqual(r.rates, [24000, 24000], 'every sentence in the natural voice');
  assert.ok(Date.now() - t0 >= 500, 'it waited for the helper');
  assert.equal(e.k.loadingAtStart, false);
  e.k.stop();
}
{
  // not ready within kokoro.waitAtStartSeconds: the Mac's voice, to the reply's end, even once the helper is ready
  const e = engine('slow:1500', (s) => { s.kokoro.waitAtStartSeconds = 0.4; return s; });
  e.k.start();
  const t0 = Date.now();
  const r = voice(e); r.v.say('Good morning.'); await sleep(1600); r.v.say('Ten o\'clock.'); r.v.end(); await r.done;
  assert.ok(e.k.ready, 'ready meanwhile');
  assert.deepEqual(r.rates, [44100, 44100], 'the Mac\'s voice for the whole reply');
  assert.ok(Date.now() - t0 < 4000);
  // the next reply: the natural voice
  const r2 = voice(e); r2.v.say('Hello.'); r2.v.end(); await r2.done;
  assert.deepEqual(r2.rates, [24000]);
  e.k.stop();
}
{
  // 0: no wait; down while waiting: the Mac's voice at once; a wake from sleep is not "at start"
  const e = engine('slow:3000', (s) => { s.kokoro.waitAtStartSeconds = 0; return s; });
  e.k.start();
  const t0 = Date.now(); const r = voice(e); r.v.say('Now.'); r.v.end(); await r.done;
  assert.deepEqual(r.rates, [44100]); assert.ok(Date.now() - t0 < 1500, 'no wait with 0');
  e.k.stop();
  const d = engine('silent', (s) => { s.limits.kokoroTimeoutSeconds = 0.05; return s; });
  d.k.start();
  const t1 = Date.now(); const rd = voice(d); rd.v.say('Now.'); rd.v.end(); await rd.done;
  assert.deepEqual(rd.rates, [44100]); assert.ok(Date.now() - t1 < 2000, 'down while it waited: at once');
  assert.equal(d.downs.length, 1);
  let t = 1_000_000; const ticks = [];
  const w = engine('', (s) => ({ ...s, kokoro: { ...s.kokoro, sleepAfterMinutes: 5 } }), { now: () => t, every: (fn, ms) => ticks.push([fn, ms]) });
  w.k.start(); await until(() => w.k.ready);
  t += 6 * 60_000; for (const [fn] of ticks) fn();
  assert.equal(w.k.state, 'asleep');
  w.k.wake('test'); assert.equal(w.k.state, 'starting'); assert.equal(w.k.loadingAtStart, false, 'a wake is not at start');
  await until(() => w.k.ready); w.k.stop();
  // the setting: waitAtStartSeconds 0 to 30 (startWith was taken out again, the owner 14:09; a file that still has it
  // is not refused and nothing reads it)
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'kokoro-start-'));
  loadSettings(h);
  const f = path.join(h, 'Documents', 'roamies-pi', 'settings.json'), d0 = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal('startWith' in d0.kokoro, false); assert.equal(d0.kokoro.waitAtStartSeconds, 8);
  fs.writeFileSync(f, JSON.stringify({ ...d0, kokoro: { ...d0.kokoro, startWith: 'firstReply', waitAtStartSeconds: 30 } }));
  assert.equal(loadSettings(h).kokoro.waitAtStartSeconds, 30); assert.equal(loadSettings(h).problem ?? null, null); assert.deepEqual(loadSettings(h).invalid, []);
  fs.writeFileSync(f, JSON.stringify({ ...d0, kokoro: { ...d0.kokoro, waitAtStartSeconds: 31 } }));
  assert.deepEqual(loadSettings(h).invalid.map((i) => i.name), ['kokoro.waitAtStartSeconds']);
  assert.equal(loadSettings(h).kokoro.waitAtStartSeconds, 8, 'its default, with a notice');
  fs.rmSync(h, { recursive: true, force: true });
}

fs.rmSync(dir, { recursive: true, force: true });
console.log('natural voice tests: passed');
