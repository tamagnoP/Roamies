// Local-only build, feature 23 stage 6: the local model server Roamies starts itself (modelserver.mjs): only when it
// is Roamies' to start, after the start-up checks, under sandbox-exec with the network denied except listening on
// its port, and asleep after local.start.sleepAfterMinutes. With a stand-in for the process and the server.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NO_START, createModelServer, serverProfile } from '../modelserver.mjs';
import { DRAFTS, MODELS, TESTED, snapshotDir } from '../localserver.mjs';
import { settingsDefaults } from '../pi.mjs';

// A home folder with the pinned models as the Hugging Face cache keeps them (a snapshot's file → a blob → the shared
// store), and a Python env with the tested versions.
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'modelserver-home-')));
for (const pin of [MODELS.e4b, DRAFTS.e4b]) {
  const snap = snapshotDir(home, pin), repo = path.dirname(path.dirname(snap)), store = path.join(home, '.cache', 'huggingface', 'hub', 'blobs', 'aa');
  fs.mkdirSync(snap, { recursive: true }); fs.mkdirSync(path.join(repo, 'blobs'), { recursive: true }); fs.mkdirSync(store, { recursive: true });
  for (const f of pin.files) {
    const blob = f === 'model.safetensors' ? pin.weights : `b-${f}`;
    fs.writeFileSync(path.join(store, `${pin.revision}-${f}`), 'x');
    fs.symlinkSync(path.join(store, `${pin.revision}-${f}`), path.join(repo, 'blobs', blob));
    fs.symlinkSync(`../../blobs/${blob}`, path.join(snap, f));
  }
}
const env = path.join(home, 'env'), python = path.join(env, 'bin', 'python');
fs.mkdirSync(path.dirname(python), { recursive: true }); fs.writeFileSync(python, '');
for (const [pkg, v] of Object.entries(TESTED)) { const d = path.join(env, 'lib', 'python3.10', 'site-packages', `${pkg}-${v}.dist-info`); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'METADATA'), `Name: ${pkg}\nVersion: ${v}\n`); }

// ---- the profile
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'roamies-model-')));
const profile = serverProfile({ home, tmp, python, port: 8080, models: [snapshotDir(home, MODELS.e4b)] });
assert.match(profile, /\(deny network\*\)\n\(allow network-bind network-inbound \(local ip "localhost:8080"\)\)/, 'no network but listening at its port');
assert.match(profile, /\(deny file-write\* \(subpath "\/"\)\)\n\(allow file-write\* \(subpath "[^"]*roamies-model-[^"]*"\) \(literal "\/dev\/null"\)\)/, 'writes only in its own folder');
assert.match(profile, new RegExp(`\\(deny file-read\\* \\(subpath "${home}"\\)\\)`), 'reads nothing else in the home folder');
assert.ok(profile.includes(`(literal "${path.join(path.dirname(path.dirname(snapshotDir(home, MODELS.e4b))), 'blobs', MODELS.e4b.weights)}")`), 'the blob link on the way is readable');
assert.ok(profile.includes(`${MODELS.e4b.revision}-model.safetensors")`), 'and the file it ends at');
assert.match(profile, /\(deny process-exec\*\)\n\(allow process-exec\* \(literal "[^"]*\/env\/bin\/python"\)\)/, 'it starts no other program');
assert.throws(() => serverProfile({ home, tmp, python, port: 80, models: [] }), /no port/);
assert.throws(() => serverProfile({ home, tmp, python: '/x"y', port: 8080, models: [] }), /quote/);

// ---- when it is Roamies' to start, and what it does
const d = settingsDefaults(home);
let local = { ...d.local, address: 'http://127.0.0.1:8080/v1', start: { ...d.local.start, python } };
const settings = () => ({ ...d, local });
const spawned = [], notices = [], logs = [];
let answering = false, loading = false, clock = 0, tick = null;
const spawnImpl = (cmd, args, opts) => { const c = new EventEmitter(); c.pid = 4242; c.killed = []; c.kill = (sig) => { c.killed.push(sig); }; spawned.push({ cmd, args, opts, c }); setTimeout(() => { answering = true; }, 10); return c; };
const server = createModelServer({ settings, home, spawnImpl, sandboxExec: '/usr/bin/sandbox-exec', onNotice: (t) => notices.push(t), log: (k, x) => logs.push([k, x]), now: () => clock, probeImpl: async () => (loading ? [] : answering ? ['m'] : null), startSeconds: 5, every: (fn) => { tick = fn; } });
loading = true; setTimeout(() => { loading = false; }, 1500);
const t0 = Date.now(); assert.equal(await server.ensure(), '');
assert.ok(Date.now() - t0 >= 1000, 'an empty list of models (still loading) is not ready');
assert.equal(spawned.length, 1); const s0 = spawned[0];
assert.equal(s0.cmd, '/usr/bin/sandbox-exec'); assert.equal(s0.args[0], '-p'); assert.equal(s0.args[2], python);
assert.deepEqual(s0.args.slice(3, 9), ['-m', 'mlx_vlm.server', '--host', '127.0.0.1', '--port', '8080']);
assert.ok(s0.args.includes('--draft-model'), 'the drafter, its files being here');
assert.equal(s0.opts.shell, false); assert.equal(s0.opts.env.HF_HUB_OFFLINE, '1'); assert.equal(s0.opts.env.APC_CHECKPOINT_ENTRIES, '6'); assert.equal(s0.opts.env.PATH, '/usr/bin:/bin');
assert.deepEqual([server.running, server.pid, server.starts], [true, 4242, 1]);
assert.equal(await server.ensure(), ''); assert.equal(spawned.length, 1, 'running: not started again');
// asleep after local.start.sleepAfterMinutes without a request
clock += 9 * 60_000; tick(); assert.equal(server.running, true);
clock += 2 * 60_000; tick(); assert.equal(server.running, false); assert.deepEqual(s0.c.killed, ['SIGINT']);
assert.ok(logs.some(([k, x]) => k === 'model_server_stop' && x.why === 'idle'));
// woken by the next request
answering = false; assert.equal(await server.ensure(), ''); assert.equal(spawned.length, 2); assert.equal(server.starts, 2);
server.stop('quit'); answering = false;
// something already answering at the address: used as it is, not started
answering = true; local = { ...local }; assert.equal(await server.ensure(), ''); assert.equal(spawned.length, 2);
answering = false;
// not Roamies' to start: another port (the owner's own server or tunnel), or no Python
local = { ...local, address: 'http://127.0.0.1:9000/v1' }; assert.equal(await server.ensure(), ''); assert.equal(spawned.length, 2);
local = { ...local, address: 'http://127.0.0.1:8080/v1', start: { ...local.start, python: '' } }; assert.equal(await server.ensure(), ''); assert.equal(spawned.length, 2);
// a start-up problem: said once in a notice, and not started
local = { ...local, start: { ...local.start, python: '/nowhere/bin/python' } };
assert.equal(await server.ensure(), NO_START, 'the request is told only that it could not start');
assert.match(notices[0], /^The local model can't be started: The local model server is not the version tested: mlx-vlm not found, tested with 0\.8\.0\./, 'the reason is the notice\'s');
await server.ensure(); assert.equal(notices.length, 1, 'said once'); assert.equal(spawned.length, 2);
// a drafter missing: a note, and it runs without one
fs.rmSync(snapshotDir(home, DRAFTS.e4b), { recursive: true, force: true });
local = { ...local, start: { ...local.start, python } };
assert.equal(await server.ensure(), ''); assert.ok(!spawned[2].args.includes('--draft-model'));
assert.ok(logs.some(([k]) => k === 'model_server_note'));
server.stop('quit');
// it never starts: after local.start.waitSeconds (45 by default) only what is true, and it is stopped
assert.equal(NO_START, 'The local model could not start, so nothing was sent.');
assert.equal(d.local.start.waitSeconds, 45);
let clock2 = 0, probes = 0;
const slow = createModelServer({ settings, home, spawnImpl: (cmd, args, opts) => { const c = new EventEmitter(); c.pid = 1; c.kill = () => {}; return c; }, probeImpl: async () => { probes++; return null; }, now: () => (clock2 += 10_000), every: () => {} });
assert.equal(await slow.ensure(), NO_START); assert.equal(slow.running, false);
assert.ok(probes >= 3 && probes <= 5, `waited the setting's 45 s, not longer (${probes} checks, about 10 s apart)`);
probes = 0; clock2 = 0; local = { ...local, start: { ...local.start, waitSeconds: 10 } };
assert.equal(await slow.ensure(), NO_START); assert.ok(probes <= 1, `local.start.waitSeconds is read (${probes} checks)`);
// it stops while starting, or can't be started at all: the same line
const dies = createModelServer({ settings, home, spawnImpl: () => { const c = new EventEmitter(); c.pid = 2; c.kill = () => {}; setTimeout(() => c.emit('exit', 1, null), 5); return c; }, probeImpl: async () => null, startSeconds: 5, every: () => {} });
assert.equal(await dies.ensure(), NO_START);
const fails = createModelServer({ settings, home, spawnImpl: () => { throw Object.assign(new Error('no'), { code: 'ENOENT' }); }, probeImpl: async () => null, startSeconds: 5, every: () => {} });
assert.equal(await fails.ensure(), NO_START);
fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(tmp, { recursive: true, force: true });
console.log('model server tests passed');
