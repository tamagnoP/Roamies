// Local-only build: ~/Documents/roamies-pi/settings.json belongs to the owner. Roamies makes it once, with defaults,
// when it doesn't exist, and never writes it again. Every way node:fs can change a file is watched here while each
// part of pi.mjs, notes.mjs and guard.mjs that reads the settings is run; any touch of settings.json after its
// creation fails the test. The source is also checked for a write aimed at the settings file.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'settings-home-')));
const dir = path.join(home, 'Documents', 'roamies-pi'), file = path.join(dir, 'settings.json');

// ---- the watch: every fs call that can create, change, move or remove a file, sync, callback and promise
const touched = [];
const isSettings = (p) => { try { return typeof p === 'string' || p instanceof URL || Buffer.isBuffer(p) ? path.resolve(String(p instanceof URL ? p.pathname : p)) === file : false; } catch { return false; } };
const writes = (flags) => typeof flags === 'number' ? (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND)) !== 0 : /[wa+]/.test(String(flags ?? 'r'));
const WATCH = { writeFile: [0], appendFile: [0], rename: [0, 1], copyFile: [1], cp: [1], rm: [0], unlink: [0], truncate: [0], symlink: [1], link: [1], chmod: [0], lchmod: [0], chown: [0], lchown: [0], utimes: [0], lutimes: [0], open: [0], createWriteStream: [0], mkdir: [0], rmdir: [0] };
const wrap = (obj, name, label) => {
  const real = obj[name];
  if (typeof real !== 'function') return;
  obj[name] = function (...args) {
    const hit = WATCH[name.replace(/Sync$/, '')].some((i) => isSettings(args[i]));
    const open = name.replace(/Sync$/, '') === 'open';
    if (hit && (!open || writes(args[1]))) touched.push(`${label}${name}`);
    return real.apply(this, args);
  };
};
for (const name of Object.keys(WATCH)) { wrap(fs, name, 'fs.'); wrap(fs, `${name}Sync`, 'fs.'); wrap(fs.promises, name, 'fs.promises.'); }

// the watch itself works: each way of changing the file is noticed, a plain read is not
fs.mkdirSync(dir, { recursive: true });
const noticed = async (what, fn) => { touched.length = 0; await fn(); assert.ok(touched.length > 0, `${what} is noticed`); };
await noticed('writeFileSync', () => fs.writeFileSync(file, 'x'));
await noticed('appendFileSync', () => fs.appendFileSync(file, 'y'));
await noticed('openSync for appending', () => fs.closeSync(fs.openSync(file, 'a')));
await noticed('renameSync away', () => fs.renameSync(file, `${file}.b`));
await noticed('renameSync onto', () => fs.renameSync(`${file}.b`, file));
await noticed('copyFileSync onto', () => { fs.writeFileSync(`${file}.c`, 'c'); fs.copyFileSync(`${file}.c`, file); fs.rmSync(`${file}.c`); });
await noticed('promises.writeFile', () => fs.promises.writeFile(file, 'z'));
await noticed('writeFile with a callback', () => new Promise((r) => fs.writeFile(file, 'w', r)));
touched.length = 0; fs.closeSync(fs.openSync(file, 'r')); fs.readFileSync(file, 'utf8'); fs.statSync(file);
assert.deepEqual(touched, [], 'reading is not a write');
await noticed('rmSync', () => fs.rmSync(file));
touched.length = 0;

const { createPi, loadSettings, voiceFor, gateTools } = await import('../pi.mjs');
const { createNotes } = await import('../notes.mjs');
const guard = await import('../guard.mjs');

// ---- first-time creation: the one write there is
loadSettings(home);
assert.deepEqual(touched, ['fs.writeFileSync'], 'made once, with defaults, when it does not exist');
assert.ok(fs.existsSync(file));
touched.length = 0;
loadSettings(home); loadSettings(home);
assert.deepEqual(touched, [], 'never again once it exists');

// ---- the owner's file, as the owner wrote it (odd spacing and an unknown key included)
const bin = path.join(home, 'bin'); fs.mkdirSync(bin);
const fakePi = path.join(bin, 'pi');
fs.writeFileSync(fakePi, `#!/usr/bin/env node
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
out({ type: 'session', version: 3, id: 'sess-1', cwd: process.cwd() });
out({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Which one?' }], stopReason: 'stop' } });
`, { mode: 0o755 });
process.env.PATH = `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`;
const cells = path.join(home, 'Documents', 'cells'); fs.mkdirSync(cells);
const owners = `{\n\n   "project":"~/Documents/roamies-pi/workspace",  "projects": ["~/Documents/roamies-pi/workspace","~/Documents/cells"],\n "pi": ${JSON.stringify(fakePi)}, "autoSendReadOnly": 0, "progressSeconds": 0.02,\n "briefings": { "morning": "09:00", "evening": "18:30" }, "mine": [1,  2]\n}`;
touched.length = 0; // the test standing in for the owner
fs.writeFileSync(file, owners);
const stat0 = fs.statSync(file);
touched.length = 0;

// ---- everything that reads the settings, run
let reply = 'yes';
const pi = createPi({ home, userName: 'Tiago', shell: '/bin/sh', ask: async () => reply });
const tool = (n) => pi.tools.find((t) => t.name === n);
const settled = async () => { for (let i = 0; i < 400 && pi.busy(); i++) await new Promise((r) => setTimeout(r, 10)); assert.ok(!pi.busy(), 'pi finished'); };

await tool('ask_pi').execute({ prompt: 'read something', mode: 'read' }, {}); await settled();
await tool('ask_pi').execute({ prompt: 'change something', mode: 'edit' }, {}); await settled();
await tool('ask_pi').execute({ prompt: 'the second one', mode: 'edit', follow_up: true }, {}); await settled();
await tool('ask_pi').execute({ prompt: 'x'.repeat(900), mode: 'read' }, {}); await settled(); // the long-prompt path (pending.txt)
reply = null;
await assert.rejects(tool('ask_pi').execute({ prompt: 'declined', mode: 'edit' }, {}), /didn't say send/);
await assert.rejects(tool('switch_project').execute({ name: 'cells' }, {}), /said no/);
reply = 'yes';
assert.match(await tool('switch_project').execute({ name: 'cells' }, {}), /pi now works in cells/);
assert.equal(loadSettings(home).project, cells, 'the switch took');
await tool('ask_pi').execute({ prompt: 'in the other project', mode: 'read' }, {}); await settled();
assert.match(await tool('switch_project').execute({ name: 'workspace' }, {}), /pi now works in workspace/);
await assert.rejects(tool('switch_project').execute({ name: 'nowhere' }, {}), /No project called/);
await tool('stop_pi').execute({});
pi.live(); pi.state(); pi.tasksOn(new Date()); pi.stop();
pi.briefing(new Date(2026, 10, 12, 9, 0)); pi.briefing.done('morning'); pi.briefing.done('evening'); pi.briefing(new Date(2026, 10, 12, 19, 0));
voiceFor('jarvis', home); voiceFor('classic', home);
for (const t of gateTools([{ name: 'show_list', execute: async () => 'list' }], pi)) if (t.name === 'show_list') await t.execute({});
// the notes vault and the never-look list read the same file
const notes = createNotes({ home, userName: 'Tiago' }), note = (n) => notes.tools.find((t) => t.name === n);
await note('write_note').execute({ title: 'A note', content: 'hello' }, {}); await note('search_notes').execute({ query: 'hello' }, {}); await note('read_note').execute({ title: 'A note' }, {});
const watch = guard.createGuard({ home, windows: async () => [{ id: 1, app: 'Safari', title: 'x', frontApp: true }] });
await watch.wrap([{ name: 'take_screenshot', execute: async () => 'shot' }])[0].execute({}); watch.front('In front: Safari');

assert.deepEqual(touched, [], `settings.json was written after its creation, by: ${touched.join(', ')}`);
assert.equal(fs.readFileSync(file, 'utf8'), owners, 'byte for byte as the owner left it');
const stat1 = fs.statSync(file);
assert.equal(stat1.mtimeMs, stat0.mtimeMs); assert.equal(stat1.ino, stat0.ino, 'not replaced by a new file either');
assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).project, '~/Documents/roamies-pi/workspace', 'the chosen project is in state.json');

// ---- a broken or missing-key file is reported or defaulted, not repaired
touched.length = 0;
fs.writeFileSync(file, '{ broken'); touched.length = 0;
assert.throws(() => loadSettings(home), /isn't valid JSON/);
await assert.rejects(tool('ask_pi').execute({ prompt: 'hello', mode: 'read' }, {}), /isn't valid JSON/);
pi.live(); voiceFor('jarvis', home);
fs.writeFileSync(file, '{}'); touched.length = 0;
loadSettings(home); pi.live();
assert.deepEqual(touched, []); assert.equal(fs.readFileSync(file, 'utf8'), '{}');

// ---- the source: nothing in the sidecar aims a write at the settings file, and pi.mjs, which holds its path, writes
// to that path in one place only, the guarded first-time creation
const src = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const aimed = [];
for (const f of fs.readdirSync(src).filter((n) => n.endsWith('.mjs'))) {
  fs.readFileSync(path.join(src, f), 'utf8').split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    if (/\b(writeFile|appendFile|rename|copyFile|cp|rm|unlink|truncate|createWriteStream|open)(Sync)?\s*\([^)]*(settings\.file|\bs\.file|roamies-pi[^)]*settings\.json)/.test(line)) aimed.push(`${f}:${i + 1}`);
  });
}
assert.deepEqual(aimed, [], `writes aimed at settings.json: ${aimed.join(', ')}`);
const piSrc = fs.readFileSync(path.join(src, 'pi.mjs'), 'utf8');
const body = piSrc.slice(piSrc.indexOf('export function loadSettings('), piSrc.indexOf('export function voiceFor('));
assert.deepEqual([...body.matchAll(/(fs\.\w+)\(file\b/g)].map((m) => m[1]), ['fs.existsSync', 'fs.writeFileSync', 'fs.readFileSync'], 'loadSettings: checks, creates, reads; nothing else');
assert.ok(body.includes('if (!fs.existsSync(file)) fs.writeFileSync(file,'), 'the one write is the guarded first-time creation');

fs.rmSync(home, { recursive: true, force: true });
console.log('settings ownership tests: passed');
