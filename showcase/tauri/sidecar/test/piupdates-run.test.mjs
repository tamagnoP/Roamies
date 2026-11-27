// Feature 41, pi's updates in plain words: the real sidecar in a throwaway home folder, a stand-in pi that plays a
// task (it really writes, changes and deletes files in a throwaway git project, and reports a pip install, a curl, a
// push and a script that deletes a file by itself), and a stand-in for the model. Run on the API route (a stand-in
// provider that keeps every request body) and on Claude's route (fake-claude.mjs through ROAMIES_FAKE_CLAUDE, set by
// this test, which starts the sidecar itself). Run: npm run test:all. Nothing leaves the Mac; the clock-driven
// settings are off or far away (LESSONS.md).
//   - no command, command output or file text is in any request; the masked word is not either
//   - updates are given only when something changed, worded by the model, or code's own sentence when the answer
//     holds a command; each is one small request in the ledger (piUpdate)
//   - the closing summary: one small request (piSummary), not a chat turn; every event said, code's line for each the
//     model left out, the deletion done by a script found by the snapshot comparison; then pi's reply on screen
//   - the summary is in the live state of the next request; "What left the Mac today?" counts the updates
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { answerFor } from './mask-script.mjs';

const SIDECAR = new URL('..', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
{ const d = new Date(), left = (24 * 60 - (d.getHours() * 60 + d.getMinutes())) * 60_000 - d.getSeconds() * 1000; if (left < 4 * 60_000) await sleep(left + 30_000); }
const GIT = '/usr/bin/git';
const SECRETS = ['pip install', 'rm old.csv', 'curl', 'git push', 'tidy.py', 'csv-marker-3', 'cfg-marker-5', 'report-marker-8', 'https://example.com', 'Halyard', 'halyard'];

// The stand-in pi: the hand-off's prompt is its last argument. Each step really happens in the project.
const PI = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('-e')) fs.appendFileSync(JSON.parse(/const RECORD = (".*?");/.exec(fs.readFileSync(args[args.indexOf('-e') + 1], 'utf8'))[1]), 'ready\\n');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
let n = 0;
const step = (toolName, a, isError = false, act = () => {}) => { const id = 'c' + (++n); out({ type: 'tool_execution_start', toolCallId: id, toolName, args: a }); act(); out({ type: 'tool_execution_end', toolCallId: id, toolName, result: { content: [{ type: 'text', text: 'output-marker' }] }, isError }); };
const said = (text) => out({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' } });
out({ type: 'session', version: 3, id: 'sess-run', cwd: process.cwd() });
out({ type: 'agent_start' });
step('read', { path: 'results.csv' });
step('bash', { command: 'pip install pandas' });
said('I ran \`pip install pandas\` and looked at ' + process.cwd() + '/results.csv; next, the tables.');
step('edit', { path: 'config.yaml', edits: [{ oldText: 'a', newText: 'cfg-marker-5' }] }, false, () => fs.writeFileSync('config.yaml', 'cfg-marker-5\\n'));
setTimeout(() => {
  step('bash', { command: 'rm old.csv' }, false, () => fs.rmSync('old.csv'));
  step('bash', { command: 'python tidy.py' }, false, () => fs.rmSync('scratch.txt'));
  step('bash', { command: 'curl -sI https://example.com' });
  step('bash', { command: 'git push origin main' });
  step('write', { path: 'report.md', content: 'report-marker-8' }, false, () => fs.writeFileSync('report.md', 'report-marker-8\\n'));
  setTimeout(() => {
    said('The report is in report.md. I chose a bar chart over a table. Shall I also add the raw numbers?');
    out({ type: 'agent_settled', aborted: false });
    process.exit(0);
  }, 4000);
}, 4000);
`;

async function run(route) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `piupdates-run-${route}-`)));
  const record = path.join(home, 'fake-claude.jsonl');
  const tmp = path.join(home, 'tmp'); fs.mkdirSync(tmp); // the voice's audio files of a sidecar killed at the end go with the home folder
  const env = { HOME: home, PATH: process.env.PATH, TMPDIR: tmp, LANG: 'en_US.UTF-8', ROAMIES_VERSION: '0.0.0', ...(route === 'cc' ? { ROAMIES_FAKE_CLAUDE: path.join(SIDECAR, 'test', 'fake-claude.mjs'), FAKE_CLAUDE_RECORD: record } : {}) };
  // ---- the stand-in provider (API route): Anthropic's messages API, streamed; every body kept
  const bodies = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; }).on('end', () => {
      bodies.push(raw);
      let j = {}; try { j = JSON.parse(raw); } catch { /* not JSON */ }
      const msgs = j.messages ?? [], last = msgs.at(-1);
      const parts = Array.isArray(last?.content) ? last.content : [{ type: 'text', text: String(last?.content ?? '') }];
      const result = parts.find((p) => p.type === 'tool_result');
      let afterTool = null;
      if (result) for (const m of msgs) for (const p of Array.isArray(m.content) ? m.content : []) if (p.type === 'tool_use' && p.id === result.tool_use_id) afterTool = p.name;
      const a = answerFor({ system: JSON.stringify(j.system ?? ''), last: parts.filter((p) => p.type === 'text').map((p) => p.text).at(-1) ?? '', afterTool });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev('message_start', { message: { id: `msg_${bodies.length}`, type: 'message', role: 'assistant', model: j.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: Math.round(raw.length / 3.6), output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
      if (a.tool) {
        ev('content_block_start', { index: 0, content_block: { type: 'tool_use', id: `toolu_${bodies.length}`, name: a.tool[0], input: {} } });
        ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(a.tool[1]) } });
        ev('content_block_stop', { index: 0 });
        ev('message_delta', { delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } });
      } else {
        ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
        ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: a.text } });
        ev('content_block_stop', { index: 0 });
        ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } });
      }
      ev('message_stop', {});
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  // ---- the throwaway home and project (a git repository, every file committed)
  const dir = path.join(home, 'Documents', 'roamies-pi'), project = path.join(home, 'Projects', 'halyard');
  fs.mkdirSync(path.join(home, '.gg', 'sidekick'), { recursive: true }); fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(project, { recursive: true });
  for (const [f, t] of [['results.csv', 'a,b\ncsv-marker-3\n'], ['config.yaml', 'a\n'], ['old.csv', 'x\n'], ['scratch.txt', 'y\n'], ['tidy.py', 'import os\n']]) fs.writeFileSync(path.join(project, f), t);
  const git = (...a) => execFileSync(GIT, ['-c', 'user.name=T', '-c', 'user.email=t@localhost', ...a], { cwd: project, stdio: 'ignore' });
  git('init', '-q'); git('add', '.'); git('commit', '-q', '-m', 'start');
  const fakePi = path.join(home, 'bin', 'pi'); fs.mkdirSync(path.dirname(fakePi)); fs.writeFileSync(fakePi, PI, { mode: 0o755 });
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
    import { AuthStorage } from '@kenkaiiii/gg-core';
    import { settingsDefaults } from './pi.mjs';
    await new AuthStorage().setCredentials('anthropic', { accessToken: 'test', refreshToken: '', expiresAt: Date.now() + 864e8, baseUrl: 'http://127.0.0.1:${port}' });
    const d = JSON.parse(JSON.stringify(settingsDefaults(os.homedir())));
    d.voiceEngine = 'system'; d.calendar.syncSeconds = 3600; d.calendar.reviewAt = '';
    d.project = '~/Projects/halyard'; d.projects = ['~/Projects/halyard']; d.pi = ${JSON.stringify(fakePi)}; d.sandbox = false; d.progressSeconds = 1;
    d.mask.projects = ['Halyard'];
    fs.writeFileSync(path.join(os.homedir(), 'Documents', 'roamies-pi', 'settings.json'), JSON.stringify(d, null, 2));
  `], { cwd: SIDECAR, env, stdio: ['ignore', 'inherit', 'inherit'] });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ calendar: { started: true, adopt: true } }));
  fs.writeFileSync(path.join(home, '.gg', 'sidekick.json'), JSON.stringify({ provider: 'anthropic', model: 'claude-haiku-5-5', sound: false, allowActions: false, voice: false, onboarded: true, onboardStep: 0, filesAsked: true, autoListen: false, setupVersion: 2, size: 'default', look: 'jarvis', introDone: true, replies: 'voice' }));

  const out = [];
  const tell = (m) => side.stdin.write(`${JSON.stringify(m)}\n`);
  const side = spawn(process.execPath, ['sidekick.mjs'], { cwd: SIDECAR, env, stdio: ['pipe', 'pipe', 'ignore'] });
  readline.createInterface({ input: side.stdout }).on('line', (l) => {
    let m; try { m = JSON.parse(l); } catch { return; }
    out.push({ at: Date.now(), m });
    if (m.type === 'ui' && m.msg?.kind === 'speech' && m.msg.mark) tell({ type: 'speech_mark', mark: m.msg.mark });
  });
  const beat = () => tell({ type: 'presence', idle: 1, mic: false, net: true });
  const page = (from = 0) => out.slice(from).filter((o) => o.m.type === 'ui').map((o) => o.m.msg);
  const logText = () => { const d = path.join(home, '.gg', 'sidekick', 'logs'); return fs.existsSync(d) ? fs.readdirSync(d).map((f) => fs.readFileSync(path.join(d, f), 'utf8')).join('') : ''; };
  const waitFor = async (ok, ms, what) => { const t0 = Date.now(); while (!ok() && Date.now() - t0 < ms) await sleep(100); assert.ok(ok(), `${route}: ${what} (the log: ${logText().trim().split('\n').slice(-10).map((l) => l.split(' ').slice(1, 2).join(' ')).join(' | ')})`); };
  const ledger = () => { try { return fs.readFileSync(path.join(home, '.gg', 'sidekick', 'ledger.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };
  const sent = () => (route === 'cc' ? (fs.existsSync(record) ? fs.readFileSync(record, 'utf8').trim().split('\n').filter(Boolean) : []) : bodies);
  const isMain = (raw) => (route === 'cc' ? JSON.parse(raw).tools.length > 0 : (JSON.parse(raw).tools ?? []).length > 0);
  async function typed(text) {
    const from = out.length;
    tell({ type: 'menu', id: 'ask' });
    await waitFor(() => page(from).some((m) => m.kind === 'ask' && m.bar), 3000, 'the ask field');
    tell({ type: 'answer', id: page(from).find((m) => m.kind === 'ask' && m.bar).id, text });
  }
  let timer = null;
  try {
    await sleep(2500); tell({ type: 'ui_ready' }); beat(); timer = setInterval(beat, 1000);
    let from = out.length;
    await typed('Write the Halyard report from results.csv');
    await waitFor(() => page(from).some((m) => m.kind === 'ask' && /^Send to pi\?/.test(m.placeholder ?? '')), 20_000, 'the Send bubble');
    const bubble = page(from).find((m) => m.kind === 'ask' && /^Send to pi\?/.test(m.placeholder ?? ''));
    assert.match(bubble.placeholder, /Write report\.md for Halyard from results\.csv, using pandas\./, 'the prompt in his words');
    tell({ type: 'answer', id: bubble.id, text: 'Send' });
    await waitFor(() => / pi_start /.test(logText()), 10_000, 'pi started');
    const mainBefore = () => sent().filter(isMain).length;
    await waitFor(() => / pi_end /.test(logText()), 30_000, 'pi finished');
    const mainAtEnd = mainBefore();
    await waitFor(() => / pi_summary /.test(logText()), 20_000, 'the closing summary');
    await waitFor(() => page(from).some((m) => m.kind === 'say' && /^Here's what pi came back with/.test(m.text)), 10_000, 'pi\'s reply on screen');

    // updates: only when something changed; worded, then code's own sentence when the answer held a command
    const updateLines = logText().split('\n').filter((l) => / pi_update \{"ms"/.test(l)).map((l) => JSON.parse(l.slice(l.indexOf('{'))));
    assert.ok(updateLines.length >= 2 && updateLines.length <= 4, `${route}: updates given only when something changed (${updateLines.length}): ${logText().split('\n').filter((l) => /pi_update|pi_start|pi_end|pi_summary|request_done|agent_/.test(l)).map((l) => l.slice(11, 23) + l.slice(24, 140)).join(' / ')}`);
    assert.equal(updateLines[0].how, 'worded');
    assert.deepEqual([...new Set(updateLines.flatMap((u) => u.events))].sort(), ['install', 'network', 'pushed', 'removed', 'unnamed'], 'every event told while pi worked');
    assert.equal(updateLines.flatMap((u) => u.events).filter((k) => k === 'install').length, 1, 'an event is told once');
    for (const u of updateLines) assert.equal(u.added, new Set(u.events).size, `code's line for each event the model left out (${JSON.stringify(u)})`);
    const fb = updateLines.find((u) => u.how === 'fallback');
    assert.ok(fb && fb.why === 'command' && fb.events.includes('removed') && fb.events.includes('network') && fb.events.includes('pushed'), `${route}: an answer with a command gave code's own sentence (${JSON.stringify(updateLines)})`);
    assert.ok(updateLines.every((u) => u.route === 'provider'));
    assert.ok(ledger().filter((l) => l.kind === 'piUpdate').length === updateLines.length, 'each update is one request in the ledger');
    assert.ok(!/ pi_update \{"ms"[^\n]*(taking shape|pandas|config)/.test(logText()), 'the log has no sentence or name');

    // the closing summary: worded, every event said (code's lines for those left out), then pi's reply
    const summary = page(from).find((m) => m.kind === 'say' && /report is finished/.test(m.text));
    assert.ok(summary, 'the summary is on screen');
    const s = summary.text.replace(/,? sir/g, '');
    assert.equal(s, 'The Halyard report is finished, with a bar chart rather than a table. Do you want the raw numbers added too? I\'ve installed 1 package: pandas. I\'ve deleted old.csv and scratch.txt. I\'ve also changed config.yaml, which you didn\'t name. One command went online, to example.com. I\'ve pushed the main branch to origin.');
    const sl = JSON.parse(logText().split('\n').find((l) => / pi_summary /.test(l)).replace(/^\S+ pi_summary /, ''));
    assert.deepEqual([sl.how, sl.added, sl.events], ['worded', 5, ['install', 'unnamed', 'removed', 'network', 'pushed', 'removed']]);
    assert.equal(ledger().filter((l) => l.kind === 'piSummary').length, 1);
    assert.equal(mainBefore(), mainAtEnd, 'no chat turn for the summary');
    const order = page(from).filter((m) => m.kind === 'say').map((m) => m.text);
    assert.ok(order.findIndex((t) => /report is finished/.test(t)) < order.findIndex((t) => /^Here's what pi came back with/.test(t)), 'the summary, then pi\'s reply');
    assert.ok(!/compare_failed/.test(logText()));

    // nothing that went out held a command, its output, a file's text or the masked word
    const sideBodies = sent().filter((raw) => /coding agent, (is working|has stopped working) on a task/.test(raw));
    assert.equal(sideBodies.length, updateLines.length + 1);
    for (const raw of sideBodies) for (const bad of SECRETS) assert.ok(!raw.includes(bad), `${route}: a request held "${bad}": ${raw.slice(0, 300)}`);
    assert.ok(sideBodies.every((raw) => /Project 1/.test(raw)), 'the task, masked');
    assert.ok(sideBodies.some((raw) => /changed config\.yaml, which the task didn't name/.test(raw)) && sideBodies.some((raw) => /went online, to example\.com/.test(raw)));
    for (const raw of sent()) assert.ok(!/Halyard|halyard|cfg-marker-5|csv-marker-3/.test(raw), `${route}: masked and no file text anywhere`);

    // the summary is in the next request's live state; what left the Mac counts the updates
    from = out.length;
    await typed('What did pi decide?');
    await waitFor(() => page(from).some((m) => m.kind === 'agent' && m.e?.type === 'done'), 20_000, 'the reply');
    assert.ok(sent().filter(isMain).at(-1).includes('What you told') && /Project 1 report is finished/.test(sent().filter(isMain).at(-1)), 'the summary is in the live state, masked');
    from = out.length;
    await typed('What left the Mac today?');
    await waitFor(() => page(from).some((m) => m.kind === 'say' && /^Sent to /.test(m.text)), 10_000, 'what left the Mac');
    assert.match(page(from).find((m) => m.kind === 'say' && /^Sent to /.test(m.text)).text, /\d+ updates? on pi's work/);
    const sizes = (list) => list.map((raw) => raw.length).sort((x, y) => x - y);
    console.log(`  ${route}: ${updateLines.length} updates (${updateLines.map((u) => `${u.how} ${u.ms} ms`).join(', ')}), the summary ${sl.ms} ms; characters sent: updates and summary ${sizes(sideBodies).join(', ')}; a main chat request ${sizes(sent().filter(isMain)).at(-1)}`);
  } finally {
    clearInterval(timer);
    try { side.kill('SIGKILL'); } catch { /* gone */ }
    server.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
}
await run('api');
await run('cc');
console.log('pi\'s updates in plain words, the sidecar run: passed');
process.exit(0);
