// Local-only build, feature 23: the pinned models and drafter, the server's version, how it is started, and the
// live check before use (localserver.mjs). No server and no model: a fake cache folder, a fake env, a fake server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DRAFTS, MODELS, REUSED_SHARE, SERVER_ENV, TESTED, filesProblem, installedVersion, liveCheck, serverCommand, snapshotDir, startProblems, versionProblem } from '../localserver.mjs';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'localserver-home-')));
const put = (pin, { skip = '', weights = pin.weights } = {}) => {
  const repo = path.join(home, '.cache', 'huggingface', 'hub', `models--${pin.repo.replace('/', '--')}`);
  fs.mkdirSync(path.join(repo, 'blobs'), { recursive: true });
  fs.rmSync(path.join(repo, 'snapshots'), { recursive: true, force: true });
  fs.mkdirSync(snapshotDir(home, pin), { recursive: true });
  for (const f of pin.files) {
    if (f === skip) continue;
    const blob = f === 'model.safetensors' ? weights : `b-${f}`;
    fs.writeFileSync(path.join(repo, 'blobs', blob), 'x');
    fs.symlinkSync(`../../blobs/${blob}`, path.join(snapshotDir(home, pin), f));
  }
};

// ---- pinned: repository, revision, weights; the drafter is mlx-community's conversion of Google's
assert.equal(DRAFTS.e4b.repo, 'mlx-community/gemma-4-E4B-it-assistant-bf16');
assert.match(DRAFTS.e4b.revision, /^[0-9a-f]{40}$/); assert.match(MODELS.e4b.revision, /^[0-9a-f]{40}$/); assert.match(MODELS.e2b.revision, /^[0-9a-f]{40}$/);
assert.equal(DRAFTS.e2b, undefined, 'none tested for E2B');
assert.ok(snapshotDir(home, MODELS.e4b).endsWith(`/models--mlx-community--gemma-4-e4b-it-4bit/snapshots/${MODELS.e4b.revision}`));
assert.match(filesProblem(home, MODELS.e4b), /^mlx-community\/gemma-4-e4b-it-4bit at revision 475b908 is not on this Mac \(config\.json is missing\)\. Roamies doesn't download models\.$/);
put(MODELS.e4b);
assert.equal(filesProblem(home, MODELS.e4b), '');
put(MODELS.e4b, { skip: 'tokenizer.json' });
assert.match(filesProblem(home, MODELS.e4b), /tokenizer\.json is missing/);
put(MODELS.e4b, { weights: 'f'.repeat(64) });
assert.match(filesProblem(home, MODELS.e4b), /^The weights of mlx-community\/gemma-4-e4b-it-4bit on this Mac are not the pinned ones/);
put(MODELS.e4b);

// ---- the server's version, read from its installed files
const env = path.join(home, 'env'), site = path.join(env, 'lib', 'python3.10', 'site-packages'), python = path.join(env, 'bin', 'python');
const pkg = (name, v) => { fs.mkdirSync(path.join(site, `${name}-${v}.dist-info`), { recursive: true }); fs.writeFileSync(path.join(site, `${name}-${v}.dist-info`, 'METADATA'), `Metadata-Version: 2.1\nName: ${name}\nVersion: ${v}\n`); };
assert.equal(installedVersion(python, 'mlx_vlm'), null);
assert.match(versionProblem(python), /^The local model server is not the version tested: mlx-vlm not found, tested with 0\.8\.0\.$/);
pkg('mlx_vlm', '0.8.0'); pkg('mlx', '0.32.4'); pkg('mlx_metal', '0.32.4');
assert.equal(installedVersion(python, 'mlx_vlm'), TESTED.mlx_vlm); assert.equal(installedVersion(python, 'mlx'), '0.32.4', 'mlx, not mlx_metal');
assert.equal(versionProblem(python), '');
fs.rmSync(path.join(site, 'mlx_vlm-0.8.0.dist-info'), { recursive: true }); pkg('mlx_vlm', '0.8.1');
assert.match(versionProblem(python), /mlx-vlm 0\.8\.1, tested with 0\.8\.0/);
fs.rmSync(path.join(site, 'mlx_vlm-0.8.1.dist-info'), { recursive: true }); pkg('mlx_vlm', '0.8.0');

// ---- before the start: problems stop it; a missing drafter is said, and the model runs without it
assert.deepEqual(startProblems({ python, home }), { problems: [], notes: [`${filesProblem(home, DRAFTS.e4b)} The local model runs without the drafter.`], draft: false });
put(DRAFTS.e4b);
assert.deepEqual(startProblems({ python, home }), { problems: [], notes: [], draft: true });
assert.deepEqual(startProblems({ python, home, draft: false }), { problems: [], notes: [], draft: false });
assert.deepEqual(startProblems({ python, home, model: 'e2b' }).notes, ['No drafter was tested with E2B: the local model runs without one.']);
assert.match(startProblems({ python, home, model: 'e2b' }).problems[0], /gemma-4-e2b-it-4bit at revision 2387675 is not on this Mac/);
assert.deepEqual(startProblems({ python: '/nowhere/bin/python', home }).problems.length, 1);

// ---- how it is started: fixed, 127.0.0.1, offline, the cache in memory with 6 checkpoints, the files by path
const c = serverCommand({ python, home, port: 8099 });
assert.equal(c.cmd, python);
assert.deepEqual(c.args, ['-m', 'mlx_vlm.server', '--host', '127.0.0.1', '--port', '8099', '--model', snapshotDir(home, MODELS.e4b), '--log-level', 'WARNING', '--draft-model', snapshotDir(home, DRAFTS.e4b), '--draft-kind', 'mtp', '--draft-block-size', '4']);
assert.deepEqual(c.env, { HOME: home, PATH: '/usr/bin:/bin', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', APC_ENABLED: '1', APC_DISK_ENABLED: '0', APC_CHECKPOINT_ENTRIES: '6' });
assert.equal(SERVER_ENV.APC_CHECKPOINT_ENTRIES, '6');
assert.ok(!serverCommand({ python, home, port: 8099, draft: false }).args.includes('--draft-model'));
assert.ok(!serverCommand({ python, home, port: 8099, model: 'e2b' }).args.includes('--draft-model'), 'no drafter for E2B');

// ---- the live check, against a fake server: [prompt, cached] for each of the five requests
const fake = (rows, s = { enabled: true }) => {
  const bodies = [];
  return { bodies, stats: async () => s, post: async (b) => { bodies.push(b); const [p, k] = rows[bodies.length - 1]; return { usage: { prompt_tokens: p, prompt_tokens_details: { cached_tokens: k } } }; } };
};
const good = [[1204, 0], [1212, 1176], [1210, 1190], [1258, 1209], [1205, 1190]];
let f = fake(good);
let r = await liveCheck({ ...f, model: 'gemma-4-e4b', name: 'Office' });
assert.equal(r.problem, ''); assert.deepEqual(r.cached, [1176, 1190]);
assert.equal(f.bodies.length, 5);
assert.equal(JSON.stringify(f.bodies[0].messages), JSON.stringify(f.bodies[4].messages), 'the same opening each time');
assert.ok(f.bodies[2].transient_context && f.bodies[3].messages.some((m) => m.role === 'tool'), 'a request as the app makes one, then its tool round');
r = await liveCheck({ ...fake([[1204, 0], [1212, 1176], [1210, 1190], [1258, 1209], [1205, 0]]), model: 'm', name: 'Office' });
assert.match(r.problem, /lost the opening after a request with a tool round: it isn't keeping 6 checkpoints \(APC_CHECKPOINT_ENTRIES\)/);
r = await liveCheck({ ...fake([[1150, 0], [1150, 1150], [1150, 1150], [1200, 1150], [1150, 1150]]), model: 'm', name: 'Office' });
assert.match(r.problem, /doesn't keep the opening apart from the request \(transient_context\)/, 'a longer transient part that changes nothing: it was not read');
r = await liveCheck({ ...fake([[1204, 0], [1212, 0], [1210, 0], [1258, 0], [1205, 0]]), model: 'm', name: 'Office' });
assert.match(r.problem, /transient_context/);
assert.match((await liveCheck({ ...fake(good, { enabled: false }), model: 'm', name: 'O' })).problem, /prefix cache is off/);
assert.match((await liveCheck({ ...fake(good, { enabled: true, disk_bytes: 0 }), model: 'm', name: 'O' })).problem, /on disk/);
assert.ok(REUSED_SHARE > 0.5);
fs.rmSync(home, { recursive: true, force: true });
console.log('localserver tests passed');
