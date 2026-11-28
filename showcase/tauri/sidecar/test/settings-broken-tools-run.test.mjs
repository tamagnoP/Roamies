// The owner, 2026-11-28 (12:06): settings.json breaking while something is under way, with the real sidecar in a
// throwaway home folder, a stand-in provider that keeps every request body, a stand-in pi, and the shell and the page
// on its input. Run on the API route and on Claude's route (fake-claude.mjs through ROAMIES_FAKE_CLAUDE). Run: npm run
// test:all. Nothing leaves the Mac; the clock-driven settings are off or far away (LESSONS.md).
//   - A request already running when the file breaks: every tool call the model asked for is refused (none runs: no
//     note written, no to-do saved), the model gets no further request, and the request ends with the settings line.
//   - A conversation closed while the file is broken (New conversation): its memory pass waits, and is made once the
//     file can be read again.
//   - A save that takes out a setting that protects something (findDrives): one notice naming it and its default; no
//     refusal. One that takes out a setting that protects nothing (closingReply) says nothing.
//   - A pi task approved before the file broke finishes while it is broken: no summary or update is requested; the
//     line, then pi's reply; nothing uncaught.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const SIDECAR = new URL('..', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
{ const d = new Date(), left = (24 * 60 - (d.getHours() * 60 + d.getMinutes())) * 60_000 - d.getSeconds() * 1000; if (left < 5 * 60_000) await sleep(left + 30_000); }
const GIT = '/usr/bin/git';
const REFUSE = 'I won\'t act on requests until it\'s fixed.';
const isLine = (t) => typeof t === 'string' && t.startsWith('Your settings file isn\'t valid JSON') && t.endsWith(REFUSE);

// The stand-in pi: a few steps over about 8 s, then its reply.
const PI = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('-e')) fs.appendFileSync(JSON.parse(/const RECORD = (".*?");/.exec(fs.readFileSync(args[args.indexOf('-e') + 1], 'utf8'))[1]), 'ready\\n');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
let n = 0;
const step = (toolName, a, act = () => {}) => { const id = 'c' + (++n); out({ type: 'tool_execution_start', toolCallId: id, toolName, args: a }); act(); out({ type: 'tool_execution_end', toolCallId: id, toolName, result: { content: [{ type: 'text', text: 'ok' }] }, isError: false }); };
out({ type: 'session', version: 3, id: 'sess-run', cwd: process.cwd() });
out({ type: 'agent_start' });
step('read', { path: 'results.csv' });
setTimeout(() => {
  step('write', { path: 'report.md', content: 'r' }, () => fs.writeFileSync('report.md', 'r\\n'));
  setTimeout(() => {
    out({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'The report is in report.md.' }], stopReason: 'stop' } });
    out({ type: 'agent_settled', aborted: false });
    process.exit(0);
  }, 4000);
}, 4000);
`;

async function run(route) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `settings-tools-run-${route}-`)));
  const tmp = path.join(home, 'tmp'); fs.mkdirSync(tmp);
  const dir = path.join(home, 'Documents', 'roamies-pi'), file = path.join(dir, 'settings.json'), project = path.join(home, 'Projects', 'plates');
  const record = path.join(home, 'fake-claude.jsonl');
  const env = { HOME: home, PATH: process.env.PATH, TMPDIR: tmp, LANG: 'en_US.UTF-8', ROAMIES_VERSION: '0.0.0', ...(route === 'cc' ? { ROAMIES_FAKE_CLAUDE: path.join(SIDECAR, 'test', 'fake-claude.mjs'), FAKE_CLAUDE_RECORD: record, FAKE_CLAUDE_BREAK: file } : {}) };

  // ---- the stand-in provider: Anthropic's messages API, streamed; every body kept. The request that asks for a note
  // breaks the settings file before it answers, with two tool calls.
  const bodies = [];
  const answer = (j) => {
    const sys = JSON.stringify(j.system ?? ''), msgs = j.messages ?? [], last = msgs.at(-1);
    const parts = Array.isArray(last?.content) ? last.content : [{ type: 'text', text: String(last?.content ?? '') }];
    const text = parts.filter((p) => p.type === 'text').map((p) => p.text).at(-1) ?? '';
    if (/You compress the older part/.test(sys)) return { text: JSON.stringify({ summary: 'A short talk.', facts: [] }) };
    if (/pick out what to remember/.test(sys)) return { text: '{"facts": []}' };
    if (/coding agent, (is working|has stopped working) on a task/.test(sys)) return { text: 'Pi is working on the report.' };
    if (parts.some((p) => p.type === 'tool_result')) return { text: 'Done.' };
    if (/plate scans/.test(text)) { fs.writeFileSync(file, '{,\n'); return { tools: [['write_note', { title: 'Plate scans', content: 'The plate scans arrive Friday.' }], ['remember_commitment', { text: 'Ask the lab about the plate scans', kind: 'commitment' }]] }; }
    if (/Write the report/.test(text)) return { tools: [['ask_pi', { prompt: 'Write report.md from results.csv.', mode: 'edit' }]] };
    return { text: 'Hello.' };
  };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; }).on('end', () => {
      bodies.push(raw);
      let j = {}; try { j = JSON.parse(raw); } catch { /* not JSON */ }
      const a = answer(j);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev('message_start', { message: { id: `msg_${bodies.length}`, type: 'message', role: 'assistant', model: j.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
      if (a.tools) {
        a.tools.forEach(([name, input], index) => {
          ev('content_block_start', { index, content_block: { type: 'tool_use', id: `toolu_${bodies.length}_${index}`, name, input: {} } });
          ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } });
          ev('content_block_stop', { index });
        });
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

  // ---- the throwaway home and project
  fs.mkdirSync(path.join(home, '.gg', 'sidekick'), { recursive: true }); fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'results.csv'), 'a,b\n1,2\n');
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
    d.project = '~/Projects/plates'; d.projects = ['~/Projects/plates']; d.pi = ${JSON.stringify(fakePi)}; d.sandbox = false; d.progressSeconds = 1;
    fs.writeFileSync(path.join(os.homedir(), 'Documents', 'roamies-pi', 'good.json'), JSON.stringify(d, null, 2) + '\\n');
  `], { cwd: SIDECAR, env, stdio: ['ignore', 'inherit', 'inherit'] });
  const good = fs.readFileSync(path.join(dir, 'good.json'), 'utf8');
  const without = (name) => { const o = JSON.parse(good); delete o[name]; return `${JSON.stringify(o, null, 2)}\n`; };
  fs.writeFileSync(file, good);
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ calendar: { started: true, adopt: true } }));
  fs.writeFileSync(path.join(home, '.gg', 'sidekick.json'), JSON.stringify({ provider: 'anthropic', model: 'claude-haiku-5-5', sound: false, allowActions: false, voice: false, onboarded: true, onboardStep: 0, filesAsked: true, autoListen: false, setupVersion: 2, size: 'default', look: 'jarvis', introDone: true, replies: 'text' }));

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
  const said = (from) => page(from).filter((m) => m.kind === 'say' || m.kind === 'notice').map((m) => m.text);
  const logText = () => { const d = path.join(home, '.gg', 'sidekick', 'logs'); return fs.existsSync(d) ? fs.readdirSync(d).map((f) => fs.readFileSync(path.join(d, f), 'utf8')).join('') : ''; };
  const waitFor = async (ok, ms, what) => { const t0 = Date.now(); while (!ok() && Date.now() - t0 < ms) await sleep(100); assert.ok(ok(), `${route}: ${what} (the log: ${logText().trim().split('\n').slice(-12).map((l) => l.split(' ').slice(1, 3).join(' ').slice(0, 90)).join(' | ')})`); };
  const sent = () => (route === 'cc' ? (fs.existsSync(record) ? fs.readFileSync(record, 'utf8').trim().split('\n').filter(Boolean) : []) : bodies);
  const vaultNotes = () => { const v = path.join(home, 'Documents', 'roamies-vault'); const found = []; const walk = (d) => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/plate scans|Person 2 figures/i.test(e.name) || (/\.md$/.test(e.name) && /plate scans|Person 2/i.test(fs.readFileSync(f, 'utf8')))) found.push(f); } }; walk(v); return found; };
  const commitments = () => { try { return JSON.parse(fs.readFileSync(path.join(home, '.gg', 'sidekick', 'memory.json'), 'utf8')).commitments ?? []; } catch { return []; } };
  async function typed(text) {
    const from = out.length;
    tell({ type: 'menu', id: 'ask' });
    await waitFor(() => page(from).some((m) => m.kind === 'ask' && m.bar), 3000, 'the ask field');
    tell({ type: 'answer', id: page(from).find((m) => m.kind === 'ask' && m.bar).id, text });
    return from;
  }
  const breakFile = async () => { const from = out.length; fs.writeFileSync(file, good.replace('"Messages"\n', '"Messages",\n')); await waitFor(() => said(from).some(isLine), 6000, 'the line after the broken save'); };
  const mend = async () => { const from = out.length; fs.writeFileSync(file, good); await waitFor(() => said(from).includes('Your settings can be read again.'), 6000, 'mended'); };
  let timer = null;
  const result = {};
  try {
    await sleep(2500); tell({ type: 'ui_ready' }); beat(); timer = setInterval(beat, 1000);
    // a conversation to close
    let from = await typed('Hello there');
    await waitFor(() => page(from).some((m) => m.kind === 'agent' && m.e?.type === 'done'), 20_000, 'the first reply');

    // ---- a request running when the file breaks: every tool call refused, no further request, the line
    from = await typed('Note that the plate scans arrive Friday');
    await waitFor(() => page(from).some((m) => m.kind === 'agent' && m.e?.type === 'error' && isLine(m.e.message)), 20_000, 'the request ends with the line');
    const atEnd = sent().length;
    await sleep(3000);
    assert.equal(sent().length, atEnd, 'no further request to the model');
    const refusedTools = [...logText().matchAll(/ settings_tool_refused \{"tool":"(\w+)"\}/g)].map((m) => m[1]);
    assert.ok(refusedTools.length >= 1 && refusedTools.every((t) => ['write_note', 'remember_commitment'].includes(t)), `${route}: refused: ${refusedTools}`);
    assert.ok(!/ tool_done \{[^\n]*"name":"(write_note|remember_commitment)"/.test(logText()), 'no tool call finished');
    assert.deepEqual(vaultNotes(), [], 'no note written');
    assert.ok(!commitments().some((c) => /plate/.test(c.text)), 'no to-do saved');
    assert.match(logText(), / settings_refused \{"by":"during","kind":"json"\}/);
    if (route === 'cc') assert.ok(JSON.parse(sent().at(-1)).results.length <= 1, 'the program got the refusal for its one call');
    result.refused = refusedTools;
    await mend();

    if (route === 'api') {
      // ---- a conversation closed while broken: its memory pass waits, and is made once the file can be read
      await breakFile();
      const memBefore = bodies.filter((b) => /pick out what to remember/.test(b)).length;
      tell({ type: 'menu', id: 'new' });
      await waitFor(() => / memory_later \{"why":"new"\}/.test(logText()), 4000, 'the memory pass kept for later');
      await sleep(1500);
      assert.equal(bodies.filter((b) => /pick out what to remember/.test(b)).length, memBefore, 'not made while broken');
      await mend();
      await waitFor(() => bodies.filter((b) => /pick out what to remember/.test(b)).length === memBefore + 1, 8000, 'made once readable');
      await waitFor(() => / memory \{"why":"new"/.test(logText()), 8000, 'logged');

      // ---- a protecting setting taken out: one notice, its name and default; no refusal
      from = out.length;
      fs.writeFileSync(file, without('findDrives'));
      const NOTICE = 'findDrives was taken out of settings.json, so it now takes its default: true.';
      await waitFor(() => said(from).includes(NOTICE), 6000, 'the notice');
      assert.match(logText(), / settings_removed \{"names":\["findDrives"\]\}/);
      await sleep(3000);
      assert.equal(said(from).filter((t) => t === NOTICE).length, 1, 'once');
      assert.ok(!said(from).some(isLine) && !said(from).some((t) => /wrong value/.test(t)), 'no refusal');
      // put back, then a setting that protects nothing taken out: nothing said
      fs.writeFileSync(file, good); await sleep(3000);
      from = out.length;
      fs.writeFileSync(file, without('closingReply')); await sleep(4500);
      assert.deepEqual(said(from), [], 'nothing said for a setting that protects nothing');
      fs.writeFileSync(file, good); await sleep(3000);

      // ---- a pi task approved before the file broke finishes while it is broken
      from = await typed('Write the report from results.csv');
      await waitFor(() => page(from).some((m) => m.kind === 'ask' && /^Send to pi\?/.test(m.placeholder ?? '')), 20_000, 'the Send bubble');
      tell({ type: 'answer', id: page(from).find((m) => m.kind === 'ask' && /^Send to pi\?/.test(m.placeholder ?? '')).id, text: 'Send' });
      await waitFor(() => / pi_start /.test(logText()), 10_000, 'pi started');
      await sleep(1000);
      const sideBefore = bodies.filter((b) => /coding agent, (is working|has stopped working)/.test(b)).length;
      from = out.length;
      fs.writeFileSync(file, good.replace('"Messages"\n', '"Messages",\n'));
      await waitFor(() => / pi_end /.test(logText()), 20_000, 'pi finished');
      await waitFor(() => said(from).some((t) => /^Here's what pi came back with/.test(t)), 8000, 'pi\'s reply on screen');
      const order = said(from);
      const lineAt = order.findIndex(isLine), replyAt = order.findIndex((t) => /^Here's what pi came back with/.test(t));
      assert.ok(lineAt >= 0 && lineAt < replyAt, `${route}: the line, then pi's reply (${JSON.stringify(order)})`);
      assert.equal(bodies.filter((b) => /coding agent, (is working|has stopped working)/.test(b)).length, sideBefore, 'no update or summary requested while broken');
      assert.match(logText(), / settings_unreadable \{"from":"pi summary"\}/);
      assert.ok(fs.existsSync(path.join(project, 'report.md')), 'pi did its work');
      await mend();
      result.memory = true; result.removed = true; result.pi = true;
    }
    assert.ok(!/ uncaught| error prompt| unhandled/.test(logText()), `${route}: nothing uncaught`);
    assert.equal(side.exitCode, null, 'still running');
    console.log(`  ${route}: tool calls refused ${result.refused.join(', ')}${route === 'api' ? '; the memory pass made once readable; the removed-setting notice; pi finished while broken' : ''}`);
  } finally {
    clearInterval(timer);
    try { side.kill('SIGKILL'); } catch { /* gone */ }
    server.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
}
await run('api');
await run('cc');
console.log('settings breaking while something is under way, the sidecar run: passed');
process.exit(0);
