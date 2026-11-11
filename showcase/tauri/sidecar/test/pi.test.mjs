// Local-only build: handing file work to pi (pi.mjs). pi is stood in for by a script that speaks its JSON event
// stream; the shell is /bin/sh.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPi, describeStep, forVoice, gateTools, isAppName, isSend, loadSettings, messageText, projectProblem, REMOVED } from '../pi.mjs';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pi-home-')));
const dir = path.join(home, 'Documents', 'roamies-pi');
const bin = path.join(home, 'bin'); fs.mkdirSync(bin);
// The stand-in: records how it was called, then plays a run. The prompt decides what happens.
const fakePi = path.join(bin, 'pi');
fs.writeFileSync(fakePi, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2), prompt = args[args.length - 1];
fs.appendFileSync(${JSON.stringify(path.join(home, 'calls.log'))}, JSON.stringify({ args, cwd: process.cwd() }) + '\\n');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
out({ type: 'session', version: 3, id: 'sess-1', cwd: process.cwd() });
out({ type: 'agent_start' });
if (prompt.includes('HANG')) { setInterval(() => {}, 1000); return; }
if (prompt.includes('BOOM')) { process.stderr.write('auth: token expired\\n'); process.exit(3); }
out({ type: 'tool_execution_start', toolCallId: 'c1', toolName: 'read', args: { path: 'src/segment.py' } });
out({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'x' } });
out({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'read', result: {}, isError: false });
const reply = prompt.includes('ASK') ? 'Which column holds the labels?' : 'It has **3** functions.\\n\`\`\`py\\nprint(1)\\n\`\`\`';
out({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: reply }], stopReason: 'stop' } });
out({ type: 'agent_settled', aborted: false });
`, { mode: 0o755 });
process.env.PATH = `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`;

// ---- small pieces
assert.ok(isSend('send') && isSend('Send it.') && isSend('yes') && !isSend("don't send") && !isSend('wait, change it') && !isSend(null));
assert.equal(describeStep('read', { path: '/a/b/notes.md' }), 'reading notes.md');
assert.equal(describeStep('bash', { command: 'ls   -la\n' }), 'running ls -la');
assert.equal(messageText({ content: [{ type: 'thinking', thinking: 'hm' }, { type: 'text', text: ' hi ' }] }), 'hi');
assert.equal(forVoice('# Title\n- **one** `two`\n```js\nx\n```\n[link](http://x)'), 'Title one two (code, shown on screen) link');
for (const n of ['read_file', 'write_file', 'run_command', 'search_files', 'list_files', 'fetch_url']) assert.ok(REMOVED.has(n));

// ---- settings: made on first use, with the roamies-pi folder as the project
const s0 = loadSettings(home);
assert.equal(s0.project, dir); assert.deepEqual(s0.projects, [{ name: 'roamies-pi', dir }]);
assert.ok(fs.existsSync(path.join(dir, 'settings.json')) && fs.existsSync(path.join(dir, 'log')));
assert.equal(projectProblem(dir, home), '');
assert.match(projectProblem(home, home), /whole home folder/);
assert.match(projectProblem('/etc', home), /outside the home folder/);
assert.match(projectProblem(path.join(home, 'nope'), home), /doesn't exist/);
const cells = path.join(home, 'Documents', 'cells'); fs.mkdirSync(cells);
fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ project: '~/Documents/roamies-pi', projects: ['~/Documents/roamies-pi', '~/Documents/cells'], pi: fakePi }));

// ---- a pi with a scripted user
const said = [], told = [], asked = [];
let answer = 'yes'; // what the Send bubble gets: 'yes' (Send), null (Don't send), or a function for by-voice
const pi = createPi({
  home, userName: 'Tiago', shell: '/bin/sh',
  say: (t) => said.push(t), tell: (t, v) => told.push({ t, v }),
  ask: (q, signal) => new Promise((resolve) => {
    asked.push(q);
    if (typeof answer === 'function') { signal?.addEventListener('abort', () => resolve(null)); setTimeout(answer, 10); } else setTimeout(() => resolve(answer), 5);
  }),
});
const tool = (n) => pi.tools.find((t) => t.name === n);
const settled = async () => { for (let i = 0; i < 400 && pi.busy(); i++) await new Promise((r) => setTimeout(r, 10)); assert.ok(!pi.busy(), 'pi finished'); };
const calls = () => fs.readFileSync(path.join(home, 'calls.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const records = () => fs.readdirSync(path.join(dir, 'log')).sort().map((f) => fs.readFileSync(path.join(dir, 'log', f), 'utf8').trim().split('\n').map((l) => JSON.parse(l)));

{ // Don't send: nothing runs
  answer = null;
  await assert.rejects(tool('ask_pi').execute({ prompt: 'Count the functions in segment.py', mode: 'read' }, {}), /didn't say send/);
  assert.ok(!fs.existsSync(path.join(home, 'calls.log')), 'pi was never started');
  assert.equal(records().length, 0);
  assert.match(asked[0].placeholder, /^Send to pi\?  Read only · in ~\/Documents\/roamies-pi\n\nCount the functions in segment\.py$/);
  assert.deepEqual(asked[0].choices, ['Send', "Don't send"]);
  assert.match(told[0].v, /^For pi, read only\. Count the functions in segment\.py Say send to send it\.$/);
  assert.equal(told[0].t, null, 'the prompt is read out; the bubble is the Send bubble');
}
{ // Send: read only, in the project folder, the prompt passed as one argument; steps and the reply come from the app
  answer = 'yes'; told.length = 0;
  const r = await tool('ask_pi').execute({ prompt: 'Count the functions in "segment.py"; $(touch pwned) `x`', mode: 'read' }, {});
  assert.match(r, /^Sent to pi \(read only, in ~\/Documents\/roamies-pi\)/);
  assert.ok(pi.busy());
  await assert.rejects(tool('ask_pi').execute({ prompt: 'another', mode: 'read' }, {}), /still working/);
  await settled();
  const c = calls()[0];
  assert.deepEqual(c.args, ['--mode', 'json', '--tools', 'read,grep,find,ls', '--', 'Count the functions in "segment.py"; $(touch pwned) `x`']);
  assert.equal(c.cwd, dir);
  assert.ok(!fs.existsSync(path.join(dir, 'pwned')), 'the prompt is never run as shell text');
  assert.deepEqual(said, ['pi · reading segment.py']);
  const last = told.at(-1);
  assert.equal(last.t, '**pi says:**\nIt has **3** functions.\n```py\nprint(1)\n```');
  assert.equal(last.v, 'pi says: It has 3 functions. (code, shown on screen)');
  const rec = records()[0];
  assert.equal(rec[0].type, 'roamies_handoff'); assert.equal(rec[0].approved_by, 'click'); assert.equal(rec[0].mode, 'read');
  assert.ok(rec.some((e) => e.type === 'tool_execution_start') && !rec.some((e) => e.type === 'message_update'), 'events kept, streaming deltas left out');
  assert.equal(rec.at(-1).type, 'roamies_result'); assert.equal(rec.at(-1).status, 'done');
  assert.match(pi.live(), /Last pi task \(done; read only\).*<<<It has \*\*3\*\* functions/s);
}
{ // approved by voice; pi asks back; the answer continues the same pi session, with editing allowed
  answer = () => assert.ok(pi.heard('send it'));
  await tool('ask_pi').execute({ prompt: 'ASK about the labels', mode: 'read' }, {});
  await settled();
  assert.equal(records().at(-1)[0].approved_by, 'voice');
  assert.equal(told.at(-1).t, '**pi says:**\nWhich column holds the labels?');
  assert.match(pi.live(), /ended with a question.*follow_up true/);
  answer = 'yes';
  await tool('ask_pi').execute({ prompt: 'The column is called label', mode: 'edit', follow_up: true }, {});
  await settled();
  assert.match(asked.at(-1).placeholder, /^Send to pi\?  CAN EDIT files and run commands · in ~\/Documents\/roamies-pi · continues the last pi task\n/);
  assert.deepEqual(calls().at(-1).args, ['--mode', 'json', '--session', 'sess-1', '--', 'The column is called label']);
  assert.equal(pi.heard('send'), false, 'no bubble open: speech is not an answer');
}
{ // said something else while the Send bubble was open: not sent
  answer = () => pi.heard('no wait, read the other file');
  await assert.rejects(tool('ask_pi').execute({ prompt: 'x', mode: 'read' }, {}), /didn't say send/);
}
{ // a long prompt: the bubble holds the start, the whole of it is in pending.txt until answered
  let pendingSeen = '';
  answer = () => { pendingSeen = fs.readFileSync(path.join(dir, 'pending.txt'), 'utf8'); assert.ok(pi.heard('no')); };
  const long = 'word '.repeat(400).trim();
  await assert.rejects(tool('ask_pi').execute({ prompt: long, mode: 'read' }, {}), /didn't say send/);
  assert.ok(pendingSeen.includes(long));
  assert.match(asked.at(-1).placeholder, /… \(the whole text is in ~\/Documents\/roamies-pi\/pending\.txt\)$/);
  assert.ok(!fs.existsSync(path.join(dir, 'pending.txt')));
  await assert.rejects(tool('ask_pi').execute({ prompt: 'x'.repeat(8001), mode: 'read' }, {}), /over 8000/);
  await assert.rejects(tool('ask_pi').execute({ prompt: '  ', mode: 'read' }, {}), /empty/);
}
{ // pi fails: said plainly, with what it printed
  answer = 'yes';
  await tool('ask_pi').execute({ prompt: 'BOOM', mode: 'read' }, {});
  await settled();
  assert.match(told.at(-1).t, /^pi ran into a problem: auth: token expired/);
  assert.equal(records().at(-1).at(-1).status, 'error');
}
{ // stop: the task ends, and the other tools are refused only while pi works
  const others = [{ name: 'take_screenshot', execute: async () => 'shot' }, { name: 'show_list', execute: async () => 'list' }, { name: 'read_file', execute: async () => 'x' }];
  const gated = gateTools(others, pi);
  assert.deepEqual(gated.map((t) => t.name), ['take_screenshot', 'show_list', 'ask_pi', 'stop_pi', 'switch_project']);
  const g = (n) => gated.find((t) => t.name === n);
  assert.equal(await g('take_screenshot').execute({}), 'shot');
  await g('ask_pi').execute({ prompt: 'HANG', mode: 'read' }, {});
  await new Promise((r) => setTimeout(r, 150));
  await assert.rejects(g('take_screenshot').execute({}), /pi is working/);
  assert.equal(await g('show_list').execute({}), 'list', 'the to-do list still works');
  await assert.rejects(g('switch_project').execute({ name: 'cells' }, {}), /pi is working/);
  assert.match(pi.live(), /pi is WORKING now \(read only\) on: "HANG"/);
  assert.equal(await g('stop_pi').execute({}), 'Stopping pi.');
  await settled();
  assert.equal(told.at(-1).t, 'Stopped pi.');
  assert.equal(await g('stop_pi').execute({}), "pi isn't working on anything.");
  assert.equal(await g('take_screenshot').execute({}), 'shot');
}
{ // projects: only ones the user listed, only after a yes
  answer = 'yes';
  await assert.rejects(tool('switch_project').execute({ name: 'secrets' }, {}), /No project called "secrets"\. The list: roamies-pi, cells/);
  answer = null;
  await assert.rejects(tool('switch_project').execute({ name: 'cells' }, {}), /said no/);
  assert.equal(loadSettings(home).project, dir);
  answer = 'yes';
  assert.match(await tool('switch_project').execute({ name: 'Cells' }, {}), /pi now works in cells \(~\/Documents\/cells\)/);
  const s = loadSettings(home);
  assert.equal(s.project, cells); assert.equal(s.pi, fakePi, 'the rest of the file is kept');
  assert.match(pi.live(), /pi works in: ~\/Documents\/cells\. Other projects Tiago listed: roamies-pi\./);
  await tool('ask_pi').execute({ prompt: 'hello', mode: 'read', follow_up: true }, {});
  await settled();
  assert.equal(calls().at(-1).cwd, cells);
  assert.ok(!calls().at(-1).args.includes('--session'), 'a new project starts a new pi session');
}
{ // pi not installed where the settings say
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ project: '~/Documents/cells', pi: 'no-such-pi-anywhere' }));
  await tool('ask_pi').execute({ prompt: 'hello', mode: 'read' }, {});
  await settled();
  assert.match(told.at(-1).t, /couldn't start pi \("no-such-pi-anywhere" wasn't found\).*which pi/);
  fs.writeFileSync(path.join(dir, 'settings.json'), '{ not json');
  await assert.rejects(tool('ask_pi').execute({ prompt: 'hello', mode: 'read' }, {}), /isn't valid JSON/);
}
{ // the app tools are narrowed at the gate: apps by name only, the front app only, no links from drawings
  for (const t of ['Zotero', 'Inkscape', 'Visual Studio Code', 'Notes.app']) assert.ok(isAppName(t), t);
  for (const t of ['https://example.com', 'example.com', 'www.bbc.co.uk/news', 'mailto:a@b.c', '~/Documents', '/etc/hosts', './x', 'file:///etc/passwd', 'a/b', '', 'C:\\Users']) assert.ok(!isAppName(t), t);
  const seen = [];
  const raw = [
    { name: 'open', execute: async (a) => { seen.push(['open', a]); return 'ok'; } },
    { name: 'act_in_app', execute: async (a) => { seen.push(['act', a.target]); return 'ok'; } },
    { name: 'draw', execute: async () => 'drawn' },
  ];
  const g = (n) => gateTools(raw, pi).find((t) => t.name === n);
  await g('open').execute({ target: ' Zotero ', app: 'Safari' });
  assert.deepEqual(seen.at(-1), ['open', { target: 'Zotero' }], 'the app argument (open a link in an app) is dropped');
  await assert.rejects(g('open').execute({ target: 'https://example.com' }), /only opens apps by name/);
  await assert.rejects(g('open').execute({ target: '~/Documents' }), /only opens apps by name/);
  await g('act_in_app').execute({ target: 'Mail', steps: [{ do: 'key', key: 'return' }] });
  assert.deepEqual(seen.at(-1), ['act', 'front']);
  await assert.rejects(g('draw').execute({ beats: [{ say: 'x', marks: [{ kind: 'open', url: 'https://example.com' }] }] }), /doesn't open links/);
  assert.equal(await g('draw').execute({ beats: [{ say: 'x', marks: [{ kind: 'ring' }] }] }), 'drawn');
}
fs.rmSync(home, { recursive: true, force: true });
console.log('pi hand-off tests: passed');
