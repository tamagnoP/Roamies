// How large each request to the AI provider is over a long conversation, and how much of it is the same as the
// request before (what the provider can reuse). The real sidecar in a throwaway home folder, the stand-in model,
// no page and no speech; requests go in one after another as fast as they are answered.
//   node tokens.mjs <exchanges> [name]     REPLY_CHARS=<n> longer answers; SET='{"limits":{"historyTokens":40000}}'
//   settings to change; AT=1,10,40 the exchanges to print (default: every tenth)
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { startModel } from './fake-model.mjs';
import { ASKS } from './script.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), SIDECAR = path.join(here, '..');
const N = Number(process.argv[2] || 40), name = process.argv[3] || 'tokens';
const OUT = '/tmp/lean/out'; fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const requests = [];
const model = await startModel({ onRequest: (r) => requests.push(r) });
const home = `/tmp/lean/home-${name}`;
fs.rmSync(home, { recursive: true, force: true });
fs.mkdirSync(path.join(home, '.gg'), { recursive: true });
fs.mkdirSync(path.join(home, 'Documents', 'roamies-pi'), { recursive: true });
const env = { HOME: home, PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: 'en_US.UTF-8', ROAMIES_VERSION: '0.1.34' };
execFileSync(process.execPath, ['--input-type=module', '-e', `
  import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
  import { AuthStorage } from '@kenkaiiii/gg-core';
  import { settingsDefaults } from './pi.mjs';
  const a = new AuthStorage();
  await a.setCredentials('anthropic', { accessToken: 'measure', refreshToken: '', expiresAt: Date.now() + 864e8, baseUrl: 'http://127.0.0.1:${model.port}' });
  const d = JSON.parse(JSON.stringify(settingsDefaults(os.homedir())));
  d.voiceEngine = 'system';
  const more = JSON.parse(process.env.SET || '{}');
  for (const [k, v] of Object.entries(more)) d[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...d[k], ...v } : v;
  fs.writeFileSync(path.join(os.homedir(), 'Documents', 'roamies-pi', 'settings.json'), JSON.stringify(d, null, 2));
`], { cwd: SIDECAR, env: { ...env, SET: process.env.SET || '{}' }, stdio: ['ignore', 'inherit', 'inherit'] });
fs.writeFileSync(path.join(home, '.gg', 'sidekick.json'), JSON.stringify({ provider: 'anthropic', model: 'claude-haiku-5-5', sound: false, allowActions: false, voice: false, onboarded: true, onboardStep: 0, filesAsked: true, muteWhileTalking: true, autoListen: false, setupVersion: 2, size: 'default', look: 'jarvis', introDone: true, replies: 'text' }));

const sidecar = spawn(process.execPath, ['sidekick.mjs'], { cwd: SIDECAR, env, stdio: ['pipe', 'pipe', 'ignore'] });
let ends = 0, errors = 0;
readline.createInterface({ input: sidecar.stdout }).on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.type === 'ui' && m.msg?.kind === 'agent' && (m.msg.e?.type === 'done' || m.msg.e?.type === 'error')) { ends++; if (m.msg.e.type === 'error') errors++; }
});
sidecar.stdin.write(`${JSON.stringify({ type: 'ui_ready' })}\n`);
await sleep(4000);
const rows = [];
for (let i = 0; i < N; i++) {
  const before = ends, from = requests.length;
  sidecar.stdin.write(`${JSON.stringify({ type: 'voice', text: ASKS[i % ASKS.length] })}\n`);
  const until = Date.now() + 60000;
  while (ends === before && Date.now() < until) await sleep(20);
  if (ends === before) { console.error('no reply to request', i + 1); break; }
  await sleep(Number(process.env.WAIT || 150)); // a fold, if one is due, is asked for after the reply
  const mine = requests.slice(from).filter((r) => !r.fold), first = mine[0];
  rows.push({ exchange: i + 1, tokens: first?.tokens ?? 0, reused: first?.reused ?? 0, fresh: first?.fresh ?? 0, liveCopies: first?.liveCopies ?? 0, liveTokens: first?.liveTokens ?? 0, messages: first?.messages ?? 0, calls: mine.length, folds: requests.slice(from).filter((r) => r.fold).length });
}
sidecar.stdin.end(); await sleep(1500); try { sidecar.kill('SIGKILL'); } catch { /* gone */ }
model.close();
fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ name, N, set: process.env.SET || '', replyChars: Number(process.env.REPLY_CHARS || 0), errors, first: requests.find((r) => !r.fold), rows }, null, 1));
const at = process.env.AT ? process.env.AT.split(',').map(Number) : rows.map((r) => r.exchange).filter((e) => e === 1 || e % 10 === 0);
console.log('exchange | tokens sent | same as the request before | new | copies of the live state | their tokens | folds so far');
let folds = 0; const foldsAt = new Map(); for (const r of rows) { folds += r.folds; foldsAt.set(r.exchange, folds); }
for (const r of rows) if (at.includes(r.exchange)) console.log(`${String(r.exchange).padStart(8)} | ${String(r.tokens).padStart(11)} | ${String(r.reused).padStart(25)} | ${String(r.fresh).padStart(5)} | ${String(r.liveCopies).padStart(24)} | ${String(r.liveTokens).padStart(12)} | ${foldsAt.get(r.exchange)}`);
console.log(`highest ${Math.max(...rows.map((r) => r.tokens))} tokens; sum sent ${rows.reduce((n, r) => n + r.tokens, 0)}, of it new ${rows.reduce((n, r) => n + r.fresh, 0)}; folds ${folds}; errors ${errors}`);
process.exit(0);
