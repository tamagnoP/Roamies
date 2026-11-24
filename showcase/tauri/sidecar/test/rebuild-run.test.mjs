// Feature 24, fix 6: the real sidecar, in a throwaway home folder, with "limits.pageRebuildQuietMinutes" at 1 and a
// stand-in for the page on its input. Run: npm run test:all (about two and a half minutes; not in npm test). No model
// is signed in and nothing leaves the Mac: the sidecar is only told what a page would tell it.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const SIDECAR = new URL('..', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rebuild-run-')));
const env = { HOME: home, PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: 'en_US.UTF-8', ROAMIES_VERSION: '0.0.0' };
fs.mkdirSync(path.join(home, '.gg'), { recursive: true });
fs.mkdirSync(path.join(home, 'Documents', 'roamies-pi'), { recursive: true });
execFileSync(process.execPath, ['--input-type=module', '-e', `
  import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
  import { settingsDefaults } from './pi.mjs';
  const d = JSON.parse(JSON.stringify(settingsDefaults(os.homedir())));
  d.voiceEngine = 'system'; d.limits.pageRebuildQuietMinutes = 1;
  fs.writeFileSync(path.join(os.homedir(), 'Documents', 'roamies-pi', 'settings.json'), JSON.stringify(d, null, 2));
`], { cwd: SIDECAR, env, stdio: ['ignore', 'inherit', 'inherit'] });
fs.writeFileSync(path.join(home, '.gg', 'sidekick.json'), JSON.stringify({ sound: false, allowActions: false, voice: false, onboarded: true, onboardStep: 0, filesAsked: true, autoListen: false, setupVersion: 2, size: 'default', look: 'jarvis', introDone: true, replies: 'text' }));

const side = spawn(process.execPath, ['sidekick.mjs'], { cwd: SIDECAR, env, stdio: ['pipe', 'pipe', 'ignore'] });
const out = [];
readline.createInterface({ input: side.stdout }).on('line', (l) => { try { out.push({ at: Date.now(), m: JSON.parse(l) }); } catch { /* not ours */ } });
const tell = (m) => side.stdin.write(`${JSON.stringify(m)}\n`);
const page = (from) => out.slice(from).filter((o) => o.m.type === 'ui').map((o) => o.m.msg);
const asked = (from) => out.slice(from).find((o) => o.m.type === 'rebuild_overlays');
try {
  await sleep(3000);
  // an ordinary start: the page is greeted
  let from = out.length;
  tell({ type: 'ui_ready' }); await sleep(1500);
  assert.deepEqual(page(from).map((m) => m.kind).filter((k) => ['sound', 'size', 'home', 'look', 'greet', 'settle'].includes(k)), ['sound', 'size', 'home', 'look', 'greet'], 'an ordinary start is greeted');

  // the list shown, the page busy and then at rest again: a rebuild one quiet minute later, checked every 15 s
  tell({ type: 'show_list' }); await sleep(500);
  assert.ok(page(from).some((m) => m.kind === 'list'), 'something was shown');
  tell({ type: 'page_rest', on: false }); await sleep(300);
  from = out.length;
  const restAt = Date.now();
  tell({ type: 'page_rest', on: true, keep: { spin: 2.75 } });
  while (!asked(from) && Date.now() - restAt < 100_000) await sleep(200);
  const ask = asked(from);
  assert.ok(ask, 'the rebuild is asked for');
  const after = (ask.at - restAt) / 1000;
  assert.ok(after >= 59 && after <= 77, `one quiet minute, give or take a check (${after.toFixed(1)} s)`);

  // the new page reports ready: its settings, then settle with the globe as it was, and no greeting
  from = out.length;
  tell({ type: 'ui_ready' }); await sleep(1500);
  const sent = page(from).filter((m) => ['sound', 'size', 'home', 'look', 'greet', 'settle'].includes(m.kind));
  assert.deepEqual(sent.map((m) => m.kind), ['sound', 'size', 'home', 'look', 'settle'], 'a rebuilt page is not greeted');
  assert.equal(sent.at(-1).spin, 2.75);
  const log = fs.readFileSync(path.join(home, '.gg', 'sidekick', 'logs', fs.readdirSync(path.join(home, '.gg', 'sidekick', 'logs'))[0]), 'utf8');
  assert.match(log, / page_rebuild \{"quietMinutes":1\}\n/); assert.match(log, / page_rebuilt \{"ms":\d+\}\n/);

  // the new page at rest, nothing shown since (its settings and settle do not count): no second rebuild
  from = out.length;
  tell({ type: 'page_rest', on: true, keep: { spin: 2.75 } }); await sleep(78_000);
  assert.equal(asked(from), undefined, 'nothing shown since the last rebuild');
} finally {
  side.stdin.end(); await sleep(1000); try { side.kill('SIGKILL'); } catch { /* gone */ }
  fs.rmSync(home, { recursive: true, force: true });
}
console.log('page rebuild, the sidecar run: passed');
