// Local-only build (feature 23): the local model server, as it was tested, and the checks before it is used.
//
//   - The models and the drafter are pinned: a repository, a revision, and the hash of the weights file. Their files
//     are looked for in the Hugging Face cache under that revision only. Roamies never downloads a model: when the
//     files are missing or are not the pinned ones, it says so (`filesProblem`).
//   - The server is the one tested: its version is read from its installed files, never by running anything
//     (`versionProblem`).
//   - How it is started is fixed here (`serverCommand`): 127.0.0.1 only, offline, the prefix cache in memory only and
//     with room for 6 checkpoints, the pinned files by path.
//   - Before use, the warm-up doubles as a live check (`liveCheck`): the prefix cache is on and not on disk, the
//     opening is kept apart from the request by `transient_context`, and it is still reused after a request with a
//     tool round (at the server's default of 2 checkpoints it is not).
// Any problem is a code-worded line for a notice, and the local model is not used.
import fs from 'node:fs';
import path from 'node:path';
import { liteBody, liteSystem, warmBody } from './lite.mjs';
import { guardedFetch, localAddress } from './local.mjs';

/** What was tested (2026-11-25 and 26): mlx-vlm and mlx in the `localai` env. */
export const TESTED = Object.freeze({ mlx_vlm: '0.8.0', mlx: '0.32.4' });

/** The models, pinned. Both are mlx-community's conversions of Google's Gemma 4 instruction-tuned models (4-bit). */
export const MODELS = Object.freeze({
  e4b: Object.freeze({ repo: 'mlx-community/gemma-4-e4b-it-4bit', revision: '475b9088d29754a3379866cf5aeb6b41acd313c2', weights: '932b8271fc3fe65adcc78b96c10c6268bbfb13e8f67d1358727c0d6ee97e1eff', files: ['config.json', 'model.safetensors', 'tokenizer.json', 'tokenizer_config.json', 'chat_template.jinja', 'processor_config.json'] }),
  e2b: Object.freeze({ repo: 'mlx-community/gemma-4-e2b-it-4bit', revision: '238767527555cb75a05732a84dff5d6ba0dd6809', weights: '038e39a37a7667373d2c3991375446b10c96ae1d717a68674870343db376b76e', files: ['config.json', 'model.safetensors', 'tokenizer.json', 'tokenizer_config.json', 'chat_template.jinja', 'processor_config.json'] }),
});
/** The MTP drafters, pinned, by model. mlx-community's conversion (mlx-vlm 0.4.5) of Google's
 *  google/gemma-4-E4B-it-assistant. Block size 4, as measured. None was tested for E2B. */
export const DRAFTS = Object.freeze({
  e4b: Object.freeze({ repo: 'mlx-community/gemma-4-E4B-it-assistant-bf16', revision: '844e008e06ef5562bdb89428d851d0634d119dcd', weights: '12875062fc25c51e8fa9b62abd2de7ad48b7d63f8559d5d604fbd5a3d6bcff16', files: ['config.json', 'model.safetensors', 'tokenizer.json', 'tokenizer_config.json'], blockSize: 4 }),
});
/** The server's environment that was tested: offline, the prefix cache in memory only, 6 checkpoints. */
export const SERVER_ENV = Object.freeze({ HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', APC_ENABLED: '1', APC_DISK_ENABLED: '0', APC_CHECKPOINT_ENTRIES: '6' });

/** Where a pinned repository's files are: its revision's folder in the Hugging Face cache. */
export const snapshotDir = (home, pin) => path.join(home, '.cache', 'huggingface', 'hub', `models--${pin.repo.replace('/', '--')}`, 'snapshots', pin.revision);

/** Why a pinned repository can't be used, or '' when its files are all there and the weights are the pinned ones.
 *  Nothing is downloaded. */
export function filesProblem(home, pin) {
  const dir = snapshotDir(home, pin), short = pin.revision.slice(0, 7);
  for (const f of pin.files) {
    try { if (!fs.statSync(path.join(dir, f)).isFile()) throw new Error(); } catch { return `${pin.repo} at revision ${short} is not on this Mac (${f} is missing). Roamies doesn't download models.`; }
  }
  let blob = '';
  try { blob = path.basename(fs.readlinkSync(path.join(dir, 'model.safetensors'))); } catch { /* not a link */ }
  if (blob !== pin.weights) return `The weights of ${pin.repo} on this Mac are not the pinned ones (revision ${short}).`;
  return '';
}

/** The version of an installed Python package, read from its files in the env of `python`. → string or null */
export function installedVersion(python, pkg) {
  const env = path.dirname(path.dirname(String(python ?? '')));
  let libs = [];
  try { libs = fs.readdirSync(path.join(env, 'lib')).filter((d) => /^python3\.\d+$/.test(d)); } catch { return null; }
  for (const lib of libs) {
    const site = path.join(env, 'lib', lib, 'site-packages');
    let dirs = [];
    try { dirs = fs.readdirSync(site); } catch { continue; }
    const name = pkg.replace(/_/g, '[-_]');
    const info = dirs.find((d) => new RegExp(`^${name}-[^-]+\\.dist-info$`, 'i').test(d));
    if (!info) continue;
    try {
      const m = /^Version:\s*(\S+)/m.exec(fs.readFileSync(path.join(site, info, 'METADATA'), 'utf8'));
      if (m) return m[1];
    } catch { /* unreadable */ }
  }
  return null;
}
/** Why the server's installed version is not the one tested, or ''. */
export function versionProblem(python) {
  for (const [pkg, want] of Object.entries(TESTED)) {
    const got = installedVersion(python, pkg);
    if (got !== want) return `The local model server is not the version tested: ${pkg.replace('_', '-')} ${got ?? 'not found'}, tested with ${want}.`;
  }
  return '';
}

/** How the server is started: the program, its fixed arguments and its whole environment. draft: use the drafter
 *  (when there is one for the model). */
export function serverCommand({ python, home, model = 'e4b', draft = true, port }) {
  const m = MODELS[model], d = draft ? DRAFTS[model] : null;
  if (!m) throw new Error(`No model ${model}.`);
  return {
    cmd: python,
    args: ['-m', 'mlx_vlm.server', '--host', '127.0.0.1', '--port', String(port), '--model', snapshotDir(home, m), '--log-level', 'WARNING',
      ...(d ? ['--draft-model', snapshotDir(home, d), '--draft-kind', 'mtp', '--draft-block-size', String(d.blockSize)] : [])],
    env: { HOME: home, PATH: '/usr/bin:/bin', ...SERVER_ENV },
  };
}

/** Everything to check before the server is started. → { problems: [lines that stop it], notes: [lines that don't],
 *  draft: whether the drafter is used } */
export function startProblems({ python, home, model = 'e4b', draft = true }) {
  const problems = [], notes = [];
  if (!MODELS[model]) return { problems: [`There is no local model "${model}".`], notes, draft: false };
  const v = versionProblem(python); if (v) problems.push(v);
  const f = filesProblem(home, MODELS[model]); if (f) problems.push(f);
  let useDraft = !!draft;
  if (draft && !DRAFTS[model]) { notes.push(`No drafter was tested with ${model.toUpperCase()}: the local model runs without one.`); useDraft = false; }
  else if (draft) { const p = filesProblem(home, DRAFTS[model]); if (p) { notes.push(`${p} The local model runs without the drafter.`); useDraft = false; } }
  return { problems, notes, draft: useDraft };
}

// The live check's tool round: a fixed request with a call and its result, as a request of the app's would have.
const ROUND = (name) => [
  { role: 'system', content: liteSystem(name) },
  { role: 'user', content: `(From the app, not said by ${name}. A check of the server.)\n\n${name}: What is on my calendar today?` },
  { role: 'assistant', content: null, tool_calls: [{ id: 'check1', type: 'function', function: { name: 'show_day', arguments: '{}' } }] },
  { role: 'tool', tool_call_id: 'check1', content: 'today:\n09:00 to 10:00 (60 min): Check' },
];
/** The opening is reused when at least this share of the warm-up's prompt is found in the cache. */
export const REUSED_SHARE = 0.8;
const ROUND_TOKENS = 24;

/** The warm-up, as a live check of what the server was tested with. post(body) → the server's JSON reply;
 *  stats() → the prefix cache's statistics. → { problem: '' or a line, ms, cached: [first, after the round] } */
export async function liveCheck({ post, stats, model, name, clock = () => performance.now() }) {
  const t0 = clock();
  const s = await stats();
  if (!s?.enabled) return { problem: 'The local model server\'s prefix cache is off, which was not tested.', ms: 0 };
  if ('disk_bytes' in s || 'disk_files' in s) return { problem: 'The local model server keeps its prefix cache on disk, which was not tested.', ms: 0 };
  const cachedOf = (r) => r?.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const promptOf = (r) => r?.usage?.prompt_tokens ?? 0;
  const first = await post(warmBody(model, name));
  const again = await post({ ...warmBody(model, name), transient_context: `(From the app, not said by ${name}. A second warm-up, to check that the server reads this part: answer with one word.)` });
  // a request as the app makes one: the opening with the request in transient_context, then the tool round, each
  // with a reply generated (with max_tokens 1 the opening survived even at 2 checkpoints; a real request didn't)
  await post({ ...liteBody(model, [ROUND(name)[0]], { transient_context: ROUND(name)[1].content }), max_tokens: ROUND_TOKENS });
  await post({ ...liteBody(model, ROUND(name)), max_tokens: ROUND_TOKENS });
  const after = await post({ ...warmBody(model, name), transient_context: `(From the app, not said by ${name}. A third warm-up: answer with one word.)` });
  const ms = Math.round(clock() - t0), cached = [cachedOf(again), cachedOf(after)];
  if (!promptOf(first) || promptOf(again) <= promptOf(first) || cachedOf(again) < REUSED_SHARE * promptOf(again)) return { problem: 'The local model server doesn\'t keep the opening apart from the request (transient_context), which was tested.', ms, cached };
  if (cachedOf(after) < REUSED_SHARE * promptOf(after)) return { problem: 'The local model server lost the opening after a request with a tool round: it isn\'t keeping 6 checkpoints (APC_CHECKPOINT_ENTRIES), which was tested.', ms, cached };
  return { problem: '', ms, cached };
}
/** liveCheck's two calls, at the local address only. */
export function liveCalls(address, fetchImpl) {
  const base = localAddress(address), f = guardedFetch(address, fetchImpl);
  const json = async (r) => { if (!r.ok) throw new Error(`local: HTTP ${r.status}`); return r.json(); };
  return {
    post: async (body) => json(await f(`${base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, stream: false }) })),
    stats: async () => json(await f(`${base}/cache/stats`)),
  };
}
