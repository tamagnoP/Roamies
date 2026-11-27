// Feature 24: what pi's commands leave running is ended when pi stops (leftovers.mjs). The pieces, then the real
// createPi inside the real sandbox with a stand-in for pi that runs a command the way pi's bash tool does (detached:
// a session and process group of its own, the shell its leader) with the extension's line in front when it was
// given the extension. The real pi with this extension: pi-extension.test.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { CHFLAGS, PS, PS_ARGS, START_SLACK, endable, endedNotice, etimeSeconds, extensionSource, offNotice, parsePs, parseRecord, prepareLeftovers, recordLine } from '../leftovers.mjs';
import { WATCH_SCRIPT, createPi, tellResult } from '../pi.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the pieces
assert.equal(etimeSeconds('00:05'), 5); assert.equal(etimeSeconds('12:34:48'), 45288); assert.equal(etimeSeconds('01-12:34:48'), 131688); assert.equal(etimeSeconds('x'), null);
assert.deepEqual(parsePs('  573   573 01-12:34:48\n 9 8 00:10\nbad line\n', 200000), [{ pid: 573, pgid: 573, start: 200000 - 131688 }, { pid: 9, pgid: 8, start: 199990 }]);
assert.deepEqual(parseRecord('ready\n100 5000\n1 5000\nrm -rf /\n200 5001\n'), { ready: true, shells: [{ pid: 100, t: 5000 }, { pid: 200, t: 5001 }] }, 'unknown lines and pid 1 are skipped');
{
  const procs = [
    { pid: 101, pgid: 100, start: 5000 }, { pid: 102, pgid: 100, start: 5001 }, // shell 100 gone, its background job left
    { pid: 200, pgid: 200, start: 5000 }, // shell 200 still running
    { pid: 300, pgid: 300, start: 9000 }, { pid: 301, pgid: 300, start: 9000 }, // 300 is now another program's: reused
    { pid: 50, pgid: 50, start: 1 }, { pid: 51, pgid: 50, start: 1 }, // Roamies itself
  ];
  const shells = [{ pid: 100, t: 5000 }, { pid: 200, t: 5001 }, { pid: 300, t: 5000 }, { pid: 400, t: 5000 }, { pid: 50, t: 1 }, { pid: 200, t: 5001 }];
  assert.deepEqual([...endable({ shells, procs, keep: [51] })], [[100, 2], [200, 1]], 'a reused number, a group with nothing left and Roamies\' own are left alone; each group once');
  assert.deepEqual([...endable({ shells: [{ pid: 200, t: 5000 + START_SLACK.before }], procs })], [[200, 1]]);
  assert.deepEqual([...endable({ shells: [{ pid: 200, t: 5000 + START_SLACK.before + 1 }], procs })], [], 'started too long before it wrote: not the same process');
  assert.deepEqual([...endable({ shells: [{ pid: 200, t: 5000 - START_SLACK.after - 1 }], procs })], [], 'started after it wrote: not the same process');
}
assert.equal(endedNotice(1), "Pi's commands had left 1 process running. I ended it.");
assert.equal(endedNotice(3), "Pi's commands had left 3 processes running. I ended them.");
assert.equal(recordLine('/t/r'), `{ printf '%s %s\\n' "$$" "$(/bin/date +%s)" >> '/t/r'; } 2>/dev/null; `);
assert.deepEqual(PS_ARGS, ['-x', '-o', 'pid=,pgid=,etime='], 'ps: the process list only, never the environment');
{
  const src = extensionSource('/t/r');
  assert.match(src, /createBashTool\(cwd, \{ shellPath: settings\.getShellPath\(\), commandPrefix: settings\.getShellCommandPrefix\(\), spawnHook: \(c: any\) => \(\{ \.\.\.c, command: LINE \+ c\.command \}\) \} as any\)/, 'pi\'s own bash tool, with pi\'s shell settings, the line in front');
  assert.match(src, /if \(!hooked\) return;/, 'no spawnHook: pi\'s bash tool is left as it is');
  assert.ok(src.indexOf('pi.registerTool') < src.indexOf('appendFileSync(RECORD'), 'ready only once the tool is in place');
}

if (process.platform !== 'darwin') { console.log('leftovers tests: the pieces passed; the rest is macOS only'); process.exit(0); }

// ---- the folder: made, append-only, removed; only chflags and ps are run, with fixed arguments
{
  const calls = [];
  const spy = (c, a, o) => { calls.push([c, a]); return spawnSync(c, a, o); };
  const lf = prepareLeftovers({ spawnSyncImpl: spy });
  assert.ok(lf && fs.statSync(lf.dir).mode % 0o1000 === 0o700, 'a folder of its own, private');
  assert.equal(lf.extension, path.join(lf.dir, 'roamies-leftovers.ts')); assert.equal(fs.readFileSync(lf.extension, 'utf8'), extensionSource(lf.record));
  assert.throws(() => fs.writeFileSync(lf.record, 'x'), /EPERM/, 'the record can only be added to');
  fs.appendFileSync(lf.record, 'ready\n'); assert.equal(lf.ready(), true);
  const r = lf.end('test'); assert.equal(r.count, 0); await r.done;
  lf.remove(); assert.ok(!fs.existsSync(lf.dir), 'removed, flag and all');
  for (const [c, a] of calls) assert.ok((c === CHFLAGS && a.length === 2 && ['uappnd', 'nouappnd'].includes(a[0])) || (c === PS && a === PS_ARGS), `${c} ${a.join(' ')}`);
  assert.equal(prepareLeftovers({ spawnSyncImpl: () => ({ status: 1 }) }), null, 'chflags failing: no extension (and nothing left)');
}

// ---- the real createPi in the real sandbox, with a stand-in for pi
const h = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pi-left-')));
const proj = path.join(h, 'Documents', 'proj'), d = path.join(h, 'Documents', 'roamies-pi'), bin = path.join(h, 'mytools');
for (const x of [proj, d, bin]) fs.mkdirSync(x, { recursive: true });
const fake = path.join(bin, 'pi');
fs.writeFileSync(fake, `#!/usr/bin/env node
// the last argument is the prompt: what to do. With -e, the extension as pi loads it: "ready" in its record, then each
// command run as pi's bash tool runs it, the extension's line in front.
const fs = require('node:fs'), { spawn, spawnSync } = require('node:child_process');
const args = process.argv.slice(2), p = args[args.length - 1], at = args.indexOf('-e');
const ext = at >= 0 ? fs.readFileSync(args[at + 1], 'utf8') : null;
const RECORD = ext && JSON.parse(/const RECORD = (".*?");/.exec(ext)[1]), LINE = ext && JSON.parse(/const LINE = (".*?");/.exec(ext)[1]);
fs.writeFileSync(process.cwd() + '/pi.pid', String(process.pid));
fs.appendFileSync(process.cwd() + '/calls.log', JSON.stringify(args) + '\\n');
if (ext && p.includes('badext')) { process.stderr.write('Error: Failed to load extension "' + args[at + 1] + '": boom\\nHint: Start without extensions using "pi -ne".\\n'); process.exit(1); }
if (ext && !p.includes('nohook')) fs.appendFileSync(RECORD, 'ready\\n');
const bash = (command) => { const c = spawn('/bin/bash', ['-c', (ext && !p.includes('nohook') ? LINE : '') + command], { detached: true, stdio: 'ignore' }); return new Promise((r) => c.on('exit', r)); };
const reply = (text) => process.stdout.write(JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' } }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'session', id: 's1' }) + '\\n');
(async () => {
  if (p.includes('tamper') && RECORD) {
    const dir = require('node:path').dirname(RECORD), got = {};
    const t = (name, cmd) => { got[name] = spawnSync('/bin/bash', ['-c', cmd]).status === 0 ? 'ok' : 'refused'; };
    t('append', "echo '1 1' >> '" + RECORD + "'"); t('truncate', "echo x > '" + RECORD + "'"); t('delete', "rm -f '" + RECORD + "'");
    t('unflag', "chflags nouappnd '" + RECORD + "'"); t('extension', "echo x >> '" + dir + "/roamies-leftovers.ts'"); t('new file', "touch '" + dir + "/other'");
    reply(JSON.stringify(got)); process.exit(0);
  }
  if (p.includes('bash')) await bash('/bin/sleep 300 & echo $! > "$PWD/child.pid"; /usr/bin/perl -e \\'use POSIX; setsid(); exec "/bin/sleep", "301"\\' & echo $! > "$PWD/escaped.pid"'); await new Promise((r) => setTimeout(r, 300)); // the shell has gone; the second one has left the group
  reply('ok');
  if (p.includes('finish')) process.exit(0);
  if (p.includes('deaf')) process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
})();
`, { mode: 0o755 });
process.env.PATH = `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const num = (f) => { try { return Number(fs.readFileSync(path.join(proj, f), 'utf8')); } catch { return 0; } };
const calls = () => fs.readFileSync(path.join(proj, 'calls.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pi-left-tmp-')));
process.on('exit', () => { for (const x of [h, tmp]) fs.rmSync(x, { recursive: true, force: true }); });
async function run(prompt, { mode = 'edit', maxMinutes = 60, act = async () => {} } = {}) {
  for (const f of ['pi.pid', 'child.pid', 'escaped.pid', 'calls.log']) fs.rmSync(path.join(proj, f), { force: true });
  fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify({ project: proj, projects: [proj], toolFolders: [bin], pi: fake, autoSendReadOnly: 0, maxMinutes }));
  const done = [], logs = [];
  const pi = createPi({ home: h, userName: 'T', shell: '/bin/sh', onDone: (r) => done.push(r), ask: async () => 'yes', log: (kind, data) => logs.push([kind, data]), leftoversTmp: tmp });
  await pi.tools.find((t) => t.name === 'ask_pi').execute({ prompt, mode }, {});
  for (let i = 0; i < 500 && !num('pi.pid'); i++) await sleep(10);
  if (prompt.includes('bash')) for (let i = 0; i < 500 && !num('escaped.pid'); i++) await sleep(10);
  await sleep(300);
  const ids = { child: num('child.pid'), escaped: num('escaped.pid') };
  if (ids.child && !prompt.includes('finish')) assert.ok(alive(ids.child), 'the background job outlived its command');
  await act(pi);
  for (let i = 0; i < 800 && !done.length; i++) await sleep(10);
  await sleep(KILL + 300);
  return { r: done[0], logs, ids, pi, gone: (pid) => !pid || !alive(pid) };
}
// How a hand-off that ended done or error is told (sidekick.mjs): with spoken replies on, the gist in Roamies' own
// turn, then the full text on screen, then, once the gist has finished playing, the notice said by code.
{
  const told = async (r, voiceOn) => {
    const seen = []; let release;
    const playing = new Promise((resolve) => { release = resolve; });
    const p = tellResult(r, { voiceOn, summarise: async () => { seen.push(['gist']); }, show: (t) => seen.push(['show', t]), speak: (t) => seen.push(['speak', t]), played: () => { seen.push(['wait']); return playing; } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const before = seen.length;
    release(); await p;
    return { seen, before };
  };
  const r = { status: 'done', reply: 'ok', shown: `Here's what pi came back with:\n\nok\n\n${endedNotice(1)}`, notice: endedNotice(1) };
  let o = await told(r, true);
  assert.deepEqual(o.seen.map(([k]) => k), ['gist', 'show', 'wait', 'speak'], 'gist, the bubble, then the notice once the gist has played');
  assert.equal(o.before, 3, 'not said before the gist has finished playing');
  assert.deepEqual(o.seen[3], ['speak', endedNotice(1)], 'the notice alone, as worded by code');
  o = await told({ ...r, status: 'error', notice: offNotice }, true);
  assert.deepEqual(o.seen.at(-1), ['speak', offNotice], 'after an error, and for the extension not loaded');
  o = await told({ ...r, notice: '' }, true);
  assert.deepEqual(o.seen.map(([k]) => k), ['gist', 'show'], 'no notice: nothing more said');
  o = await told(r, false);
  assert.deepEqual(o.seen.map(([k]) => k), ['show'], 'replies not spoken: shown only');
  // The gist's request to the model (sidekick.mjs) is made from pi's reply in the live state: it uses neither the
  // notice nor the text on screen.
  const side = fs.readFileSync(new URL('../sidekick.mjs', import.meta.url), 'utf8');
  const gist = side.slice(side.indexOf('summarise: async () => {'), side.indexOf('show: (text) => sayAsIs('));
  assert.ok(gist.includes('piWords(') && !/notice|shown/.test(gist), 'the model is not given the notice (feature 41: code\'s digest, one small request)');
  assert.ok(/speak: \(text\) => voiceLine\(text\)/.test(side) && /played: quietAgain/.test(side), 'said by code, after the gist');
}

const KILL = 2000;
const left = () => fs.readdirSync(tmp);
const cleanup = (ids) => { for (const x of Object.values(ids)) if (x) try { process.kill(x, 'SIGKILL'); } catch { /* gone */ } };

let t = await run('bash finish');
assert.equal(t.r.status, 'done');
assert.ok(t.gone(t.ids.child), 'a hand-off that finishes: its command\'s background job is ended');
assert.equal(t.r.shown, "Here's what pi came back with:\n\nok\n\nPi's commands had left 1 process running. I ended it.");
assert.deepEqual(t.logs.filter(([k]) => /^pi_leftovers/.test(k)), [['pi_leftovers', { ended: 1, when: 'pi_end' }]], 'the count only');
assert.equal(t.r.notice, endedNotice(1), 'the notice is passed on by itself, to be said');
assert.ok(!t.pi.live().includes('I ended it') && !t.pi.live().includes('left 1 process'), 'the model is not told: the live state has pi\'s reply only');
assert.ok(alive(t.ids.escaped), 'a process that moved itself to a new session is not caught (as documented)');
assert.deepEqual(left(), [], 'the folder is removed');
assert.equal(calls()[0][2], '-e', 'pi was given the extension');
cleanup(t.ids);

t = await run('bash hang', { act: async (p) => { await p.tools.find((x) => x.name === 'stop_pi').execute({}, {}); } });
assert.equal(t.r.status, 'stopped'); assert.ok(t.gone(t.ids.child), 'stop_pi');
assert.equal(t.r.shown, "Stopped pi.\n\nPi's commands had left 1 process running. I ended it.");
cleanup(t.ids);

t = await run('bash hang', { maxMinutes: 0.03 });
assert.equal(t.r.status, 'error'); assert.ok(t.gone(t.ids.child), 'the time limit');
cleanup(t.ids);

t = await run('bash deaf', { act: async (p) => { const t0 = Date.now(); await p.stopAll(); assert.ok(Date.now() - t0 < KILL + 600, 'quit waits no longer than the kill'); } });
assert.ok(t.gone(t.ids.child), 'quit');
assert.deepEqual(t.logs.find(([k]) => k === 'pi_leftovers'), ['pi_leftovers', { ended: 1, when: 'quit' }]);
cleanup(t.ids);

t = await run('bash hang', { act: async (p) => { p.killNow(); } });
assert.ok(t.gone(t.ids.child), 'as the sidecar ends: killed outright'); assert.deepEqual(left(), []);
cleanup(t.ids);

t = await run('finish');
assert.equal(t.r.shown, "Here's what pi came back with:\n\nok", 'nothing left running: no notice');
assert.equal(t.r.notice, '');
assert.deepEqual(t.logs.filter(([k]) => /^pi_leftovers/.test(k)), [['pi_leftovers', { ended: 0, when: 'pi_end' }]]);

t = await run('bash finish nohook');
assert.equal(t.r.shown, `Here's what pi came back with:\n\nok\n\n${offNotice}`, 'a pi without spawnHook: said');
assert.equal(t.r.notice, offNotice);
assert.ok(!t.pi.live().includes(offNotice));
assert.ok(t.logs.some(([k, v]) => k === 'pi_leftovers_off' && v.why === 'hook'));
assert.ok(alive(t.ids.child), 'and indeed not ended');
cleanup(t.ids);

t = await run('bash finish badext');
assert.equal(t.r.status, 'done', 'a pi that can\'t load the extension: the hand-off runs all the same');
assert.equal(t.r.shown, `Here's what pi came back with:\n\nok\n\n${offNotice}`);
assert.deepEqual(calls().map((a) => a.includes('-e')), [true, false], 'started again without it');
assert.ok(t.logs.some(([k, v]) => k === 'pi_leftovers_off' && v.why === 'load'));
assert.deepEqual(left(), []);
cleanup(t.ids);

t = await run('finish', { mode: 'read' });
assert.ok(!calls()[0].includes('-e'), 'read only: no extension'); assert.deepEqual(left(), []);
assert.ok(!t.logs.some(([k]) => /^pi_leftovers/.test(k)));

t = await run('tamper finish');
assert.deepEqual(JSON.parse(t.r.reply), { append: 'ok', truncate: 'refused', delete: 'refused', unflag: 'refused', extension: 'refused', 'new file': 'refused' }, 'under the sandbox pi can only add to the record');

// ---- the watcher: the sidecar dies; the recorded group is ended, a reused number is left alone, the folder goes
{
  const lf = prepareLeftovers({ tmpdir: tmp });
  const job = spawn('/bin/bash', ['-c', `${recordLine(lf.record)}/bin/sleep 302 & echo $!`], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const jobPid = Number(await new Promise((r) => job.stdout.once('data', (b) => r(String(b).trim()))));
  const other = spawn('/bin/sleep', ['303'], { detached: true, stdio: 'ignore' }); other.unref();
  fs.appendFileSync(lf.record, `${other.pid} ${Math.floor(Date.now() / 1000) - 100}\n`); // its number, with another start time
  const side = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const pig = spawn('/bin/sleep', ['304'], { detached: true, stdio: 'ignore' }); // pi's own group
  const w = spawn('/bin/sh', ['-c', WATCH_SCRIPT, 'sh', String(side.pid), String(pig.pid), lf.dir], { stdio: 'ignore', detached: true, env: { PATH: '/usr/bin:/bin' } });
  await sleep(1200);
  assert.ok(alive(jobPid) && alive(pig.pid), 'while the sidecar runs, the watcher waits');
  side.kill('SIGKILL');
  for (let i = 0; i < 80 && (alive(jobPid) || alive(w.pid)); i++) await sleep(100);
  assert.ok(!alive(jobPid), 'the recorded group is ended'); assert.ok(!alive(pig.pid), 'and pi\'s');
  assert.ok(alive(other.pid), 'a reused number is left alone');
  assert.ok(!fs.existsSync(lf.dir), 'the folder is removed');
  for (const x of [jobPid, other.pid, pig.pid]) try { process.kill(x, 'SIGKILL'); } catch { /* gone */ }
}

fs.rmSync(h, { recursive: true, force: true }); fs.rmSync(tmp, { recursive: true, force: true });
console.log('leftovers tests: passed');
