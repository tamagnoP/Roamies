// Local-only build: handing file work to pi (pi.mjs). pi is stood in for by a script that speaks its JSON event
// stream; the shell is /bin/sh.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createPi, describeStep, forVoice, gateTools, isAppName, isSend, loadSettings, messageText, projectProblem, REMOVED, snapshot, voiceFor } from '../pi.mjs';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pi-home-')));
const dir = path.join(home, 'Documents', 'roamies-pi');
const work = path.join(dir, 'workspace'); // pi's own folder: beside the settings, not the folder that holds them
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
assert.equal(s0.project, work); assert.deepEqual(s0.projects, [{ name: 'workspace', dir: work }]);
assert.ok(fs.statSync(work).isDirectory());
assert.deepEqual(s0.neverLook.slice(0, 2), ['1Password', 'Bitwarden']); assert.equal(s0.keepLogsDays, 30);
assert.ok(fs.existsSync(path.join(dir, 'settings.json')) && fs.existsSync(path.join(dir, 'log')));
// voices: JARVIS is British out of the box; "voices" sets one per look, "voice" one for all, '' is the system voice
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).voices, { jarvis: 'Daniel' });
assert.equal(voiceFor('jarvis', home), 'Daniel'); assert.equal(voiceFor('classic', home), '');
fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ voice: 'Samantha', voices: { JARVIS: ' Jamie (Premium) ', sarah: '' } }));
assert.equal(voiceFor('jarvis', home), 'Jamie (Premium)'); assert.equal(voiceFor('sarah', home), 'Samantha'); assert.equal(voiceFor('adrian', home), 'Samantha');
fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ voices: {} }));
assert.equal(voiceFor('jarvis', home), '', 'an empty "voices" switches the JARVIS default off');
fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ project: '~/Documents/roamies-pi' }));
assert.equal(voiceFor('jarvis', home), 'Daniel', 'a settings file from before this still gets the JARVIS default');
fs.writeFileSync(path.join(dir, 'settings.json'), '{ broken');
assert.equal(voiceFor('jarvis', home), '', 'a broken file never stops the voice');
fs.rmSync(path.join(dir, 'settings.json'));
loadSettings(home);
assert.equal(projectProblem(work, home), '');
assert.match(projectProblem(dir, home), /holds Roamies' own settings/);
assert.match(projectProblem(path.join(home, 'Documents'), home), /holds Roamies' own settings/);
assert.match(projectProblem(home, home), /whole home folder/);
assert.match(projectProblem('/etc', home), /outside the home folder/);
assert.match(projectProblem(path.join(home, 'nope'), home), /doesn't exist/);
const cells = path.join(home, 'Documents', 'cells'); fs.mkdirSync(cells);
// autoSendReadOnly 0: every hand-off waits for Send, as the tests below expect (the countdown has its own test)
fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ project: '~/Documents/roamies-pi', projects: ['~/Documents/roamies-pi', '~/Documents/cells'], pi: fakePi, autoSendReadOnly: 0 }));

// ---- a pi with a scripted user
const said = [], told = [], asked = [];
let lastResolve = null; // the open Send bubble's own answer, as the overlay would give it
let answer = 'yes'; // what the Send bubble gets: 'yes' (Send), null (Don't send), or a function for by-voice
const pi = createPi({
  home, userName: 'Tiago', shell: '/bin/sh',
  say: (t) => said.push(t), tell: (t, v) => told.push({ t, v }),
  ask: (q, signal) => new Promise((resolve) => {
    asked.push(q); lastResolve = resolve;
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
  assert.match(asked[0].placeholder, /^Send to pi\?  Read only · in ~\/Documents\/roamies-pi\/workspace\n⚠ pi is started with: \S+\/bin\/pi\n\nCount the functions in segment\.py$/);
  assert.deepEqual(asked[0].choices, ['Send', "Don't send"]);
  assert.match(told[0].v, /^For pi, read only\. Count the functions in segment\.py Say send to send it\.$/);
  assert.equal(told[0].t, null, 'the prompt is read out; the bubble is the Send bubble');
}
{ // Send: read only, in the project folder, the prompt passed as one argument; steps and the reply come from the app
  answer = 'yes'; told.length = 0;
  const r = await tool('ask_pi').execute({ prompt: 'Count the functions in "segment.py"; $(touch pwned) `x`', mode: 'read' }, {});
  assert.match(r, /^Sent to pi \(read only, in ~\/Documents\/roamies-pi\/workspace\)/);
  assert.ok(pi.busy());
  await assert.rejects(tool('ask_pi').execute({ prompt: 'another', mode: 'read' }, {}), /still working/);
  await settled();
  const c = calls()[0];
  assert.deepEqual(c.args, ['--mode', 'json', '--tools', 'read,grep,find,ls', '--', 'Count the functions in "segment.py"; $(touch pwned) `x`']);
  assert.equal(c.cwd, work, 'a settings file that still names the settings folder means its workspace');
  assert.ok(!fs.existsSync(path.join(dir, 'pwned')), 'the prompt is never run as shell text');
  assert.deepEqual(said, ["Pi's reading segment.py…"]);
  const last = told.at(-1);
  assert.equal(last.t, "Here's what pi came back with:\n\nIt has **3** functions.\n```py\nprint(1)\n```");
  assert.equal(last.v, 'Pi says: It has 3 functions. (code, shown on screen)');
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
  assert.equal(told.at(-1).t, "Here's what pi came back with:\n\nWhich column holds the labels?");
  assert.match(pi.live(), /ended with a question.*follow_up true/);
  answer = 'yes';
  await tool('ask_pi').execute({ prompt: 'The column is called label', mode: 'edit', follow_up: true }, {});
  await settled();
  assert.match(asked.at(-1).placeholder, /^Send to pi\?  CAN EDIT files and run commands · in ~\/Documents\/roamies-pi\/workspace · continues the last pi task\n⚠ pi is started with: \S+\nUndo snapshot taken\.\n\nThe column/);
  assert.match(records().at(-1)[0].snapshot, /^refs\/roamies\/\d{4}-\d\d-\d\d_\d{6}$/);
  assert.match(records().at(-1)[0].undo, /restore --source=refs\/roamies\//);
  assert.match(pi.live(), /A snapshot from before pi's edits is kept as refs\/roamies\//);
  assert.deepEqual(calls().at(-1).args, ['--mode', 'json', '--session', 'sess-1', '--', 'The column is called label']);
  assert.equal(pi.heard('send'), false, 'no bubble open: speech is not an answer');
}
{ // talking while the Send bubble is open: the bubble closing is not a "no"; what's said decides
  assert.equal(pi.listening(), false, 'no bubble open: talking is just talking');
  const realAsk = answer;
  answer = () => { assert.equal(pi.listening(), true); lastResolve(null); setTimeout(() => assert.ok(pi.heard('Send it.')), 30); };
  await tool('ask_pi').execute({ prompt: 'spoken approval', mode: 'read' }, {});
  await settled();
  assert.equal(records().at(-1)[0].approved_by, 'voice');
  // ...and if nothing was heard, nothing is sent
  answer = () => { pi.listening(); setTimeout(() => assert.ok(pi.unheard()), 20); };
  await assert.rejects(tool('ask_pi').execute({ prompt: 'mumble', mode: 'read' }, {}), /didn't say send/);
  assert.equal(pi.unheard(), false);
  answer = realAsk;
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
  assert.match(told.at(-1).t, /^Pi hit a problem: auth: token expired/);
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
  await assert.rejects(tool('switch_project').execute({ name: 'secrets' }, {}), /No project called "secrets"\. The list: workspace, cells/);
  answer = null;
  await assert.rejects(tool('switch_project').execute({ name: 'cells' }, {}), /said no/);
  assert.equal(loadSettings(home).project, work);
  answer = 'yes';
  assert.match(await tool('switch_project').execute({ name: 'Cells' }, {}), /pi now works in cells \(~\/Documents\/cells\)/);
  const s = loadSettings(home);
  assert.equal(s.project, cells); assert.equal(s.pi, fakePi, 'the rest of the file is kept');
  assert.match(pi.live(), /pi works in: ~\/Documents\/cells\. Other projects Tiago listed: workspace\./);
  await tool('ask_pi').execute({ prompt: 'hello', mode: 'read', follow_up: true }, {});
  await settled();
  assert.ok(!asked.at(-1).placeholder.includes('settings.json has changed'), 'a switch made through Roamies is not a surprise');
  assert.equal(calls().at(-1).cwd, cells);
  assert.ok(!calls().at(-1).args.includes('--session'), 'a new project starts a new pi session');
}
{ // pi not installed where the settings say; and a settings file changed behind Roamies' back is pointed out
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ project: '~/Documents/cells', pi: 'no-such-pi-anywhere' }));
  await tool('ask_pi').execute({ prompt: 'hello', mode: 'read' }, {});
  await settled();
  assert.match(asked.at(-1).placeholder, /\n⚠ settings\.json has changed since the last hand-off\. Check the folder above\.\n⚠ pi is started with: no-such-pi-anywhere\n\nhello$/);
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
{ // an app that relays the result itself (onDone) gets pi's words whole, and nothing is read out behind its back
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ project: '~/Documents/cells', pi: fakePi }));
  const done = [], spoken = [];
  const pi2 = createPi({ home, userName: 'Tiago', shell: '/bin/sh', say: () => {}, tell: (t, v) => spoken.push({ t, v }), onDone: (r) => done.push(r), ask: async () => 'yes' });
  const run = async (prompt) => { await pi2.tools.find((t) => t.name === 'ask_pi').execute({ prompt, mode: 'read' }, {}); for (let i = 0; i < 400 && (pi2.busy() || !done.length); i++) await new Promise((r) => setTimeout(r, 10)); return done.pop(); };
  const ok = await run('Count things');
  assert.equal(ok.status, 'done'); assert.equal(ok.reply, 'It has **3** functions.\n```py\nprint(1)\n```');
  assert.equal(ok.shown, `Here's what pi came back with:\n\n${ok.reply}`);
  const bad = await run('BOOM');
  assert.equal(bad.status, 'error'); assert.match(bad.shown, /^Pi hit a problem: auth: token expired/);
  assert.deepEqual(spoken.filter((x) => x.t), [], 'only the Send prompt is read out by pi.mjs itself');
  // the extra tools an app adds (its notes) pass the gate and keep working while pi is busy
  const extra = [{ name: 'write_note', execute: async () => 'noted' }];
  const gated = gateTools([{ name: 'take_screenshot', execute: async () => 'shot' }], pi2, extra);
  assert.deepEqual(gated.map((t) => t.name), ['take_screenshot', 'write_note', 'ask_pi', 'stop_pi', 'switch_project']);
  await gated.find((t) => t.name === 'ask_pi').execute({ prompt: 'HANG', mode: 'read' }, {});
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(await gated.find((t) => t.name === 'write_note').execute({}), 'noted');
  await assert.rejects(gated.find((t) => t.name === 'take_screenshot').execute({}), /pi is working/);
  pi2.stop(); for (let i = 0; i < 400 && pi2.busy(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(loadSettings(home).vault, path.join(home, 'Documents', 'roamies-vault'));
}
{ // read-only tasks go by themselves after the countdown; ones that can edit never do
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ pi: fakePi, autoSendReadOnly: 0.05, progressSeconds: 0.05, routines: { 'Start a research session': ['open Zotero', 'ask pi to read TODO.md'], bad: [] }, briefings: { morning: '09:00', evening: '18:30' } }));
  const s = loadSettings(home);
  assert.equal(s.autoSendReadOnly, 0.05); assert.deepEqual(s.routines, [{ name: 'Start a research session', steps: ['open Zotero', 'ask pi to read TODO.md'] }]); assert.deepEqual(s.briefings, { morning: 540, evening: 1110 });
  assert.match(pi.live(), /- Routine "Start a research session": 1\) open Zotero {2}2\) ask pi to read TODO\.md/);
  const never = () => {}; // the bubble is left alone: nobody clicks, nobody speaks
  answer = never; told.length = 0;
  await tool('ask_pi').execute({ prompt: 'auto one', mode: 'read' }, {});
  await settled();
  assert.match(asked.at(-1).placeholder, /^Asking pi in 0\.05 s {2}Read only · in ~\/Documents\/roamies-pi\/workspace\n/);
  assert.deepEqual(asked.at(-1).choices, ['Send now', "Don't send"]);
  assert.equal(told[0].v, 'Asking pi: auto one');
  assert.equal(records().at(-1)[0].approved_by, 'auto');
  // stopped in time: by a click on Don't send, or by saying anything but send
  answer = null;
  await assert.rejects(tool('ask_pi').execute({ prompt: 'auto two', mode: 'read' }, {}), /didn't say send/);
  answer = () => { pi.listening(); setTimeout(() => pi.heard('no, stop'), 120); }; // talking pauses the countdown; the words decide
  await assert.rejects(tool('ask_pi').execute({ prompt: 'auto three', mode: 'read' }, {}), /didn't say send/);
  // one that can edit waits, however long
  let done = false; answer = never;
  const waiting = tool('ask_pi').execute({ prompt: 'edit something', mode: 'edit' }, {}).then(() => { done = true; });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(done, false); assert.match(asked.at(-1).placeholder, /^Send to pi\?  CAN EDIT/);
  lastResolve('yes'); await waiting; await settled();
  // a long task says so now and then (spoken only)
  answer = 'yes'; told.length = 0;
  await tool('ask_pi').execute({ prompt: 'HANG', mode: 'edit' }, {});
  await new Promise((r) => setTimeout(r, 260));
  const spoken = told.filter((x) => x.t === null && /still|Bear with me/i.test(x.v));
  assert.ok(spoken.length >= 2, 'progress lines were spoken'); assert.match(spoken[0].v, /^Still on it\. Pi's 0 steps in\.$/);
  pi.stop(); await settled();
  // briefings: due once a day, in their window, built from the day's records
  const at = (h, m) => new Date(2026, 10, 12, h, m);
  assert.equal(pi.briefing(at(8, 59)), null);
  const morning = pi.briefing(at(9, 0));
  assert.equal(morning.kind, 'morning'); assert.match(morning.note, /morning briefing.*What pi was asked yesterday:\n- nothing$/s);
  assert.equal(pi.briefing(at(13, 1)), null, 'four hours on, the morning one has lapsed');
  pi.briefing.done('morning', at(9, 0));
  assert.equal(pi.briefing(at(9, 5)), null, 'given once');
  const today = new Date(); const evening = pi.briefing(new Date(today.getFullYear(), today.getMonth(), today.getDate(), 19, 0));
  assert.equal(evening.kind, 'evening'); assert.match(evening.note, /Daily log \d{4}-\d\d-\d\d.*What pi was asked today:\n- \d\d:\d\d \(read only, done\): /s);
  assert.ok(pi.tasksOn(today).some((t) => t.prompt === 'auto one' && t.status === 'done'));
}
{ // the undo snapshot: everything as it was, kept as a ref, with the branch, the index and the files untouched
  const repo = path.join(home, 'Documents', 'repo'); fs.mkdirSync(repo);
  assert.deepEqual(snapshot(repo, 'x'), { why: 'not a git repository' });
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { cwd: repo, encoding: 'utf8' });
  git('init', '-q');
  fs.writeFileSync(path.join(repo, '.gitignore'), 'data/\n'); fs.writeFileSync(path.join(repo, 'a.py'), 'v1\n'); fs.writeFileSync(path.join(repo, 'gone.py'), 'here\n');
  git('add', '-A'); git('commit', '-qm', 'first');
  fs.writeFileSync(path.join(repo, 'a.py'), 'v2 (not committed)\n'); fs.writeFileSync(path.join(repo, 'new.md'), 'untracked\n');
  fs.writeFileSync(path.join(repo, 'big.tif'), Buffer.alloc(3 * 1024 * 1024)); fs.mkdirSync(path.join(repo, 'data')); fs.writeFileSync(path.join(repo, 'data', 'raw.csv'), 'ignored\n');
  const before = git('status', '--porcelain'), head = git('rev-parse', 'HEAD');
  const { ref } = snapshot(repo, '2026-11-12_101500');
  assert.equal(ref, 'refs/roamies/2026-11-12_101500');
  assert.equal(git('status', '--porcelain'), before); assert.equal(git('rev-parse', 'HEAD'), head);
  assert.deepEqual(git('ls-tree', '-r', '--name-only', ref).trim().split('\n'), ['.gitignore', 'a.py', 'gone.py', 'new.md'], 'changed and new files in; ignored and over-2-MB files out');
  assert.equal(git('show', `${ref}:a.py`), 'v2 (not committed)\n');
  // pi "edits": the undo command from the record puts the files back
  fs.writeFileSync(path.join(repo, 'a.py'), 'broken by pi\n'); fs.rmSync(path.join(repo, 'gone.py')); fs.writeFileSync(path.join(repo, 'new.md'), 'rewritten\n');
  git('restore', `--source=${ref}`, '--worktree', '--', '.');
  assert.equal(fs.readFileSync(path.join(repo, 'a.py'), 'utf8'), 'v2 (not committed)\n'); assert.equal(fs.readFileSync(path.join(repo, 'gone.py'), 'utf8'), 'here\n'); assert.equal(fs.readFileSync(path.join(repo, 'new.md'), 'utf8'), 'untracked\n');
  assert.ok(fs.readdirSync(path.join(repo, '.git')).every((f) => !f.startsWith('roamies-index')), 'no temporary index left behind');
}
{ // old hand-off records are cleared when a new one starts
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ pi: fakePi, keepLogsDays: 7 }));
  const old = path.join(dir, 'log', '2026-01-01_000000_001_read.jsonl'), recent = path.join(dir, 'log', '2026-11-10_000000_001_read.jsonl');
  fs.writeFileSync(old, '{}\n'); fs.writeFileSync(recent, '{}\n');
  const days = (n) => new Date(Date.now() - n * 864e5);
  fs.utimesSync(old, days(40), days(40)); fs.utimesSync(recent, days(2), days(2));
  answer = 'yes';
  await tool('ask_pi').execute({ prompt: 'tidy', mode: 'read' }, {});
  await settled();
  assert.ok(!fs.existsSync(old) && fs.existsSync(recent));
}
fs.rmSync(home, { recursive: true, force: true });
console.log('pi hand-off tests: passed');
