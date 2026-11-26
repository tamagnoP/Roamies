// Feature 23 stage 4, which model answers: the real sidecar, in a throwaway home folder, with a stand-in for the
// provider (bench/fake-model.mjs) and one for the local model server (fakelocal.mjs), both on 127.0.0.1, and the
// shell and the page on its input. Run: npm run test:all. Nothing leaves the Mac.
//   - With a network: the provider answers; the local model is not asked.
//   - The shell says there is no network: the request goes to the local model, the reply starts with the switch line
//     and carries the "local" tag; the provider gets nothing. Back online: "Claude is answering again." first.
//   - "Keep this private." alone: the mode, its mark; private requests go to the local model only, and the ledger
//     marks them private and "this Mac"; the provider gets nothing, online as it is.
//   - Private, and the local model not answering: a code-worded line, and nothing is sent anywhere (no fallback).
//   - Private mode is kept across a restart; "back to Claude" ends it.
//   - "What left the Mac today?" is answered by code from the ledger: no request to either model.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { startModel } from '../bench/fake-model.mjs';
import { startFakeLocal } from './fakelocal.mjs';

const SIDECAR = new URL('..', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'local-run-')));
const env = { HOME: home, PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: 'en_US.UTF-8', ROAMIES_VERSION: '0.0.0' };
process.env.DUMP_BODY = '1'; // the stand-in keeps what each request held, to check no private word is in it
const provider = []; const model = await startModel({ onRequest: (r) => provider.push(r) });
const local = await startFakeLocal();
fs.mkdirSync(path.join(home, '.gg', 'sidekick'), { recursive: true });
fs.mkdirSync(path.join(home, 'Documents', 'roamies-pi'), { recursive: true });
execFileSync(process.execPath, ['--input-type=module', '-e', `
  import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
  import { AuthStorage } from '@kenkaiiii/gg-core';
  import { settingsDefaults } from './pi.mjs';
  await new AuthStorage().setCredentials('anthropic', { accessToken: 'test', refreshToken: '', expiresAt: Date.now() + 864e8, baseUrl: 'http://127.0.0.1:${model.port}' });
  const d = JSON.parse(JSON.stringify(settingsDefaults(os.homedir())));
  d.voiceEngine = 'system'; d.calendar.syncSeconds = 3600; d.calendar.reviewAt = ''; d.local.address = '${local.address}';
  fs.writeFileSync(path.join(os.homedir(), 'Documents', 'roamies-pi', 'settings.json'), JSON.stringify(d, null, 2));
`], { cwd: SIDECAR, env, stdio: ['ignore', 'inherit', 'inherit'] });
fs.writeFileSync(path.join(home, 'Documents', 'roamies-pi', 'state.json'), JSON.stringify({ calendar: { started: true, adopt: true } }));
fs.writeFileSync(path.join(home, '.gg', 'sidekick.json'), JSON.stringify({ provider: 'anthropic', model: 'claude-haiku-5-5', sound: false, allowActions: false, voice: false, onboarded: true, onboardStep: 0, filesAsked: true, autoListen: false, setupVersion: 2, size: 'default', look: 'jarvis', introDone: true, replies: 'text' }));

const out = [];
let side = null, net = true;
const tell = (m) => side.stdin.write(`${JSON.stringify(m)}\n`);
function start() {
  side = spawn(process.execPath, ['sidekick.mjs'], { cwd: SIDECAR, env, stdio: ['pipe', 'pipe', 'ignore'] });
  readline.createInterface({ input: side.stdout }).on('line', (l) => {
    let m; try { m = JSON.parse(l); } catch { return; }
    out.push({ at: Date.now(), m });
    if (m.type === 'ui' && m.msg?.kind === 'speech' && m.msg.mark) tell({ type: 'speech_mark', mark: m.msg.mark });
  });
}
const beat = () => tell({ type: 'presence', idle: 1, mic: false, net });
const page = (from = 0) => out.slice(from).filter((o) => o.m.type === 'ui').map((o) => o.m.msg);
const logText = () => { const d = path.join(home, '.gg', 'sidekick', 'logs'); return fs.existsSync(d) ? fs.readdirSync(d).map((f) => fs.readFileSync(path.join(d, f), 'utf8')).join('') : ''; };
const lastKinds = () => logText().trim().split('\n').slice(-12).map((l) => l.split(' ').slice(0, 2).join(' ')).join(' | ');
const waitFor = async (ok, ms, what) => { const t0 = Date.now(); while (!ok() && Date.now() - t0 < ms) await sleep(100); assert.ok(ok(), `${what} (the log: ${lastKinds()})`); };
const ledger = () => { try { return fs.readFileSync(path.join(home, '.gg', 'sidekick', 'ledger.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };
async function typed(text) {
  const from = out.length;
  tell({ type: 'menu', id: 'ask' });
  await waitFor(() => page(from).some((m) => m.kind === 'ask' && m.bar), 3000, 'the ask field');
  tell({ type: 'answer', id: page(from).find((m) => m.kind === 'ask' && m.bar).id, text });
}
const said = (from, re) => page(from).find((m) => m.kind === 'say' && re.test(m.text));
const replied = (from) => page(from).some((m) => m.kind === 'agent' && m.e?.type === 'done');
let timer = null;
try {
  start(); timer = setInterval(beat, 1000);
  await sleep(2500); tell({ type: 'ui_ready' }); beat(); await sleep(300);

  // online: the provider answers, the local model isn't asked
  let from = out.length;
  await typed('Hello there.');
  await waitFor(() => replied(from), 20_000, 'the provider\'s reply');
  assert.equal(provider.filter((r) => !r.fold).length, 1); assert.equal(local.requests.length, 0);

  // no network: the local model answers, said so first, tagged "local"; the provider gets nothing
  net = false; beat(); await sleep(300);
  from = out.length; const sent = provider.length;
  local.answers.push({ calls: [['show_day', {}]] }, { content: 'Nothing is on today.' });
  await typed('What is on my calendar today?');
  await waitFor(() => said(from, /local model/), 20_000, 'the local reply');
  const r1 = said(from, /local model/);
  assert.match(r1.text, /^Claude can't be reached, so the local model on this Mac is answering\. /); assert.equal(r1.tag, 'local');
  assert.equal(provider.length, sent, 'nothing to the provider');
  assert.ok(ledger().some((l) => l.kind === 'warmup' && l.where === 'mac') && ledger().some((l) => l.kind === 'request' && l.where === 'mac' && !l.private));
  // a second local reply: no switch line again
  from = out.length; local.answers.push({ content: 'You are welcome.' });
  await typed('Thanks for that, and one more thing: say hi.');
  await waitFor(() => said(from, /welcome/), 20_000, 'the second local reply');
  assert.doesNotMatch(said(from, /welcome/).text, /can't be reached/); assert.equal(said(from, /welcome/).tag, 'local');
  // what it can't do: refused by code, nothing sent
  from = out.length; const asks = local.requests.length;
  await typed('Ask pi to fix the failing tests.');
  await waitFor(() => said(from, /That needs Claude/), 10_000, 'the refusal');
  assert.equal(local.requests.length, asks); assert.equal(provider.length, sent);

  // back online: "Claude is answering again." first
  net = true; beat(); await sleep(300);
  from = out.length;
  await typed('Hello again.');
  await waitFor(() => replied(from), 20_000, 'the provider again');
  assert.ok(said(from, /^Claude is answering again\./), 'said first');

  // private mode: the mark; requests go local only, private in the ledger; the provider gets nothing
  from = out.length;
  await typed('Keep this private.');
  await waitFor(() => said(from, /^Private mode is on/), 10_000, 'private mode on');
  assert.ok(page(from).some((m) => m.kind === 'private' && m.on === true), 'the mark');
  const before = provider.length;
  from = out.length; local.answers.push({ content: 'Here is a private answer.' });
  await typed('What should I say to the doctor?');
  await waitFor(() => said(from, /private answer/), 20_000, 'the private reply');
  assert.equal(said(from, /private answer/).tag, 'local · private');
  assert.ok(ledger().some((l) => l.kind === 'request' && l.where === 'mac' && l.private === true));
  assert.equal(provider.length, before, 'online, and still nothing to the provider');
  // a reminder made in private mode carries the mark (made by code, no model call)
  from = out.length;
  await typed('Remind me in 2 hours to call the clinic.');
  await waitFor(() => said(from, /remind you to call the clinic/), 10_000, 'the private reminder');
  const mem = JSON.parse(fs.readFileSync(path.join(home, '.gg', 'sidekick', 'memory.json'), 'utf8'));
  assert.equal(mem.commitments.find((c) => /clinic/.test(c.text)).private, true, 'the private mark, in memory.json');

  // a restart keeps the mode
  clearInterval(timer); side.kill('SIGKILL'); await sleep(500);
  start(); timer = setInterval(beat, 1000);
  await sleep(2500); from = out.length; tell({ type: 'ui_ready' }); beat(); await sleep(500);
  assert.ok(page(from).some((m) => m.kind === 'private' && m.on === true), 'still private after a restart');

  // private, and the local model not answering: a line, and nothing sent anywhere
  await local.close();
  from = out.length;
  await typed('Remind me about the doctor.');
  await waitFor(() => said(from, /isn't answering; nothing was sent/), 20_000, 'the line');
  assert.equal(provider.length, before, 'no fallback to the provider');

  // "what left the Mac today?": by code, no model
  from = out.length;
  await typed('What left the Mac today?');
  await waitFor(() => said(from, /^Sent to anthropic today/), 10_000, 'the answer');
  assert.match(said(from, /^Sent to anthropic today/).text, /request(s)? stayed on this Mac/);
  assert.equal(provider.length, before);

  // back to Claude
  from = out.length;
  await typed('Back to Claude.');
  await waitFor(() => said(from, /Private mode is off\. Claude is answering again\./), 10_000, 'the mode ends');
  assert.ok(page(from).some((m) => m.kind === 'private' && m.on === false));
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'Documents', 'roamies-pi', 'state.json'), 'utf8')).privateMode, false);
  // Claude's next request: the private reminder only as a count, never its words
  from = out.length; const n0 = provider.length;
  await typed('What is open today?');
  await waitFor(() => replied(from), 20_000, 'the provider\'s reply');
  const body = JSON.stringify(provider.slice(n0).map((r) => r.body));
  assert.doesNotMatch(body, /clinic|doctor/i, 'no private word reaches Claude');
  assert.match(body, /Private: 1 to-do or reminder made in private mode/);
  // nothing private in the log or the ledger
  assert.doesNotMatch(logText() + JSON.stringify(ledger()), /doctor|clinic/);
  console.log('which model answers, the sidecar run: passed');
} finally {
  clearInterval(timer);
  try { side?.kill('SIGKILL'); } catch { /* gone */ }
  model.close();
  fs.rmSync(home, { recursive: true, force: true });
}
process.exit(0);
