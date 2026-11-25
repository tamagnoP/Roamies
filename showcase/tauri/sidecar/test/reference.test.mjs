// Local-only build: no setting has a value the owner can't see (reference.mjs, and the settings part of pi.mjs).
//   1. settings.default.json holds every setting loadSettings reads, with its default, and what stays in code.
//   2. A setting settings.json lacks, or has a value for that can't be used, is named in the start-up notice, and
//      the default is used. Safety settings fall back to the safe side.
//   3. settings.json is never written, and settings.default.json is never read.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'reference-home-')));
const dir = path.join(home, 'Documents', 'roamies-pi'), file = path.join(dir, 'settings.json'), refFile = path.join(dir, 'settings.default.json');
const src = path.join(path.dirname(new URL(import.meta.url).pathname), '..');

// ---- the watch: every write aimed at settings.json and every read aimed at settings.default.json, from here on
const wrote = [], read = [];
const is = (p, target) => { try { return (typeof p === 'string' || p instanceof URL || Buffer.isBuffer(p)) && path.resolve(String(p instanceof URL ? p.pathname : p)) === target; } catch { return false; } };
const writing = (flags) => (typeof flags === 'number' ? (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND)) !== 0 : /[wa+]/.test(String(flags ?? 'r')));
const reading = (flags) => (typeof flags === 'number' ? (flags & fs.constants.O_WRONLY) === 0 : /r|\+/.test(String(flags ?? 'r')));
const WRITES = { writeFile: [0], appendFile: [0], rename: [0, 1], copyFile: [1], cp: [1], rm: [0], unlink: [0], truncate: [0], symlink: [1], link: [1], chmod: [0], chown: [0], utimes: [0], createWriteStream: [0] };
const READS = { readFile: [0], createReadStream: [0], copyFile: [0], cp: [0], rename: [0], link: [0], readlink: [0] };
const wrap = (obj, name, label) => {
  const real = obj[name], plain = name.replace(/Sync$/, '');
  if (typeof real !== 'function') return;
  obj[name] = function (...args) {
    if (WRITES[plain]?.some((i) => is(args[i], file)) || (plain === 'open' && is(args[0], file) && writing(args[1]))) wrote.push(`${label}${name}`);
    if (READS[plain]?.some((i) => is(args[i], refFile)) || (plain === 'open' && is(args[0], refFile) && reading(args[1]))) read.push(`${label}${name}`);
    return real.apply(this, args);
  };
};
for (const name of new Set([...Object.keys(WRITES), ...Object.keys(READS), 'open'])) { wrap(fs, name, 'fs.'); wrap(fs, `${name}Sync`, 'fs.'); wrap(fs.promises, name, 'fs.promises.'); }
// the watch works (the test's own look at the reference file goes through peek, which switches it off)
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(refFile, 'x'); fs.readFileSync(refFile, 'utf8'); fs.closeSync(fs.openSync(refFile, 'r')); fs.writeFileSync(file, 'x'); fs.rmSync(file);
assert.deepEqual(read, ['fs.readFileSync', 'fs.openSync']); assert.deepEqual(wrote, ['fs.writeFileSync', 'fs.rmSync']);
fs.writeFileSync(refFile, 'y'); fs.closeSync(fs.openSync(refFile, 'w')); fs.rmSync(refFile);
assert.equal(read.length, 2, 'writing the reference file is not reading it');
const peek = () => { const n = read.length; const text = fs.readFileSync(refFile, 'utf8'); read.length = n; return text; };
wrote.length = 0; read.length = 0;

const { LIMITS, codeReference, createPi, limitsFor, loadSettings, sandboxProfile, settingsDefaults, TOOL_FOLDERS, NEVER_LOOK } = await import('../pi.mjs');
const { heldNotice, settingsNotice, settingsReference, startupSettings, writeReference } = await import('../reference.mjs');
const { createNotes } = await import('../notes.mjs');
const { createGuard } = await import('../guard.mjs');

// ---- 1. the reference file
assert.equal(startupSettings(home), '', 'a first start: settings.json is made with every setting, so there is nothing to say');
assert.deepEqual(wrote, ['fs.writeFileSync'], 'settings.json: made once, when it does not exist');
wrote.length = 0;
const made = JSON.parse(fs.readFileSync(file, 'utf8')), ref = JSON.parse(peek());
assert.equal(fs.statSync(refFile).mode & 0o777, 0o600, 'for the owner only');
assert.deepEqual(ref, JSON.parse(JSON.stringify(settingsReference(home))), 'it is what settingsReference gives');
const { reference, ...refSettings } = ref;
assert.deepEqual(refSettings, made, 'every setting with its default, as a new settings.json has them');
assert.deepEqual(refSettings, settingsDefaults(home));
// every setting loadSettings reads is in it: its source takes settings from `set` (filled from the defaults' names) and
// reads nothing off the raw file by name
const piSrc = fs.readFileSync(path.join(src, 'pi.mjs'), 'utf8');
const body = piSrc.slice(piSrc.indexOf('export function loadSettings('), piSrc.indexOf('export function homeFor('));
const readNames = [...new Set([...body.matchAll(/\bset\.(\w+)/g)].map((m) => m[1]))].sort();
assert.deepEqual(readNames, Object.keys(refSettings).sort(), 'loadSettings reads exactly the settings the reference file holds');
assert.deepEqual([...body.matchAll(/\braw\.(\w+)/g)].map((m) => m[1]), [], 'and none straight from the file, past the checks');
assert.ok(body.includes('for (const name of Object.keys(defaults))') && body.includes('CLEAN[name](raw[name], defaults[name])'), 'each goes through its check');
// the limits: all of them, each a default inside its range; every one is used somewhere, and nothing uses another
assert.deepEqual(Object.keys(ref.limits), Object.keys(LIMITS)); assert.equal(Object.keys(LIMITS).length, 26); // 16, feature 22's five, feature 16's two, feature 24's fold point and page rebuild, and feature 18's questions
// a limit starts above 0, unless 0 is a value of its own, said in the reference file (pageRebuildQuietMinutes: never)
assert.deepEqual(Object.keys(LIMITS).filter((n) => LIMITS[n].min === 0), ['pageRebuildQuietMinutes']); assert.equal(reference.limitRanges.pageRebuildQuietMinutes.zero, 'never');
for (const [name, l] of Object.entries(LIMITS)) { assert.equal(ref.limits[name], l.default); assert.ok(l.min <= l.default && l.default <= l.max && (l.min > 0 || !!l.zero), `${name}: a positive range around its default`); assert.deepEqual(reference.limitRanges[name], { min: l.min, max: l.max, ...(l.whole ? { wholeNumber: true } : {}), ...(l.zero ? { zero: l.zero } : {}) }); }
const used = new Set();
for (const f of ['pi.mjs', 'notes.mjs', 'sidekick.mjs', 'calendar.mjs', 'flow.mjs', 'kokorovoice.mjs', 'daily.mjs']) for (const m of fs.readFileSync(path.join(src, f), 'utf8').matchAll(/\b(?:limits|limitsFor\(\w*\))\.(\w+)/g)) used.add(m[1]);
assert.deepEqual([...used].sort(), Object.keys(LIMITS).sort(), 'the limits the code uses are the limits there are');
// what stays in code is there, built from the constants: the sandbox's lists as the profile really has them
assert.match(reference.about, /never reads this file/i);
assert.deepEqual(reference.sandbox.builtInToolFolders, TOOL_FOLDERS);
const s0 = loadSettings(home);
fs.mkdirSync(path.join(home, 'Documents', 'cells'), { recursive: true });
const tildeOut = (p) => (p.startsWith('~') ? path.join(home, p.slice(1)) : p), real = (p) => (fs.existsSync(p) ? fs.realpathSync(p) : p);
const profileFor = (docker) => sandboxProfile({ home, project: path.join(home, 'Documents', 'cells'), settings: { ...s0, docker: docker ? [path.join(home, 'Documents', 'cells')] : [] } }).profile;
const profile = profileFor(false), last = profile.trim().split('\n').at(-1);
const inLast = [...last.matchAll(/\((subpath|literal) "([^"]+)"\)/g)].map((m) => [m[1], m[2]]);
assert.deepEqual(inLast.filter(([k]) => k === 'subpath').map(([, p]) => p), reference.sandbox.blockedFolders.map(tildeOut), 'the blocked folders are the profile\'s, all of them');
assert.deepEqual(inLast.filter(([k]) => k === 'literal').map(([, p]) => p), reference.sandbox.blockedFiles.map(tildeOut), 'and the blocked files');
assert.ok(reference.sandbox.blockedFiles.includes('~/Documents/roamies-pi/settings.default.json') && reference.sandbox.blockedFiles.includes('~/Documents/roamies-pi/settings.json'), 'pi can read neither settings file');
for (const p of reference.sandbox.startupFilesReadable) assert.ok(profile.includes(`(subpath "${tildeOut(p)}")`), `start-up file: ${p}`);
for (const p of reference.sandbox.piMayWriteInItsOwnFolder) assert.ok(profile.includes(`(${p.endsWith('/') ? 'subpath' : 'literal'} "${tildeOut(p.replace(/\/$/, ''))}")`), `pi may write: ${p}`);
for (const p of reference.sandbox.programsPiCannotRun) assert.ok(profile.includes(`(literal "${p}")`), `cannot run: ${p}`);
assert.ok(profile.includes(`(deny file-read* (subpath "${real(reference.sandbox.externalDrives)}"))`));
for (const p of reference.sandbox.dockerSocketsClosedOtherwise) assert.ok(profile.split('\n').find((l) => l.startsWith('(deny network-outbound')).includes(`"${tildeOut(p)}")`), `socket closed: ${p}`);
for (const p of reference.sandbox.dockerReadableWhenAllowed) { assert.ok(profileFor(true).includes(`(subpath "${tildeOut(p)}")`), `docker reads: ${p}`); }
assert.ok(!profileFor(true).includes('(deny network-outbound'));
assert.ok(profile.includes(`(subpath "${tildeOut(reference.sandbox.alwaysReadable[0])}")`));
for (const p of reference.sandbox.alwaysWritable.filter((x) => x.startsWith('/'))) assert.ok(profile.split('\n').find((l) => l.startsWith('(allow file-write* (subpath "/dev")')).includes(`(subpath "${p}")`), `always writable: ${p}`);
// the guards and fixed facts
const { REMOVED, isSend } = await import('../pi.mjs');
assert.deepEqual(reference.tools.removed, [...REMOVED]); assert.deepEqual(reference.tools.piReadOnly, ['read', 'grep', 'find', 'ls']);
assert.ok(reference.tools.allowedWhilePiWorks.includes('stop_pi'));
for (const w of reference.sendWords) assert.ok(isSend(w) && isSend(`  ${w.toUpperCase()}, please`), `"${w}" counts as send`);
for (const w of ['no', 'sender', 'don\'t send', 'gone', '']) assert.ok(!isSend(w), `"${w}" does not`);
const window = {}; vm.runInNewContext(fs.readFileSync(path.join(src, '..', '..', 'roamies', 'home.js'), 'utf8'), { window, Math, Number });
assert.deepEqual(reference.home.corners, [...window.Roamie.homeFacts.corners], 'the corner names are the overlay\'s');
assert.deepEqual(reference.home.cornerMargins, { ...window.Roamie.homeFacts.corner }); assert.deepEqual(reference.home.pointMargins, { ...window.Roamie.homeFacts.edge });
assert.deepEqual(reference.paths, { folder: '~/Documents/roamies-pi', settings: 'settings.json', reference: 'settings.default.json', state: 'state.json', records: 'log/', defaultProject: 'workspace/', longPrompt: 'pending.txt' });
const voice = await import('../localvoice.mjs');
assert.deepEqual(reference.voice, { program: voice.SAY, sampleRate: voice.RATE, fallbackVoiceVariable: 'ROAMIES_SAY_VOICE' });
assert.deepEqual(Object.keys(codeReference()).sort(), Object.keys(reference).filter((k) => k !== 'about' && k !== 'voice').sort());
// written afresh each start, whatever was there, owner-only, and never read on the way
fs.writeFileSync(refFile, '{"maxMinutes": 1, "sandbox": false}\n', { mode: 0o644 }); fs.chmodSync(refFile, 0o644);
writeReference(home);
assert.equal(fs.statSync(refFile).mode & 0o777, 0o600); assert.deepEqual(JSON.parse(peek()), ref);

// ---- 2. a setting that is missing or can't be used
const put = (o) => fs.writeFileSync(file, typeof o === 'string' ? o : JSON.stringify(o));
const quiet = (s) => { const { raw, missing, invalid, ...rest } = s; return rest; };
const whole = quiet(loadSettings(home));
for (const name of Object.keys(made)) {
  const { [name]: gone, ...rest } = made;
  put(rest);
  const s = loadSettings(home);
  assert.deepEqual(s.missing, [name], `${name}: missing, and only it`); assert.deepEqual(s.invalid, []);
  assert.deepEqual(quiet(s), whole, `${name}: its reference value is used`);
  assert.equal(settingsNotice(home), `settings.json doesn't have: ${name}. I'm using the values in settings.default.json until you add them.`);
  put({ ...made, [name]: null });
  const t = loadSettings(home);
  assert.deepEqual(t.missing, []); assert.deepEqual(t.invalid.map((i) => i.name), [name], `${name}: null can't be used`);
  assert.deepEqual(quiet(t), whole, `${name}: its default is used instead`);
  assert.match(settingsNotice(home), new RegExp(`^settings\\.json has a value I can't use for: ${name}\\. `));
}
// several at once: one line for what's missing, then one line for each value that can't be used
put({ project: '~/Documents/roamies-pi/workspace', maxMinutes: 0, keepLogsDays: 'soon', pi: '' });
assert.deepEqual(settingsNotice(home).split('\n'), [
  `settings.json doesn't have: ${Object.keys(made).filter((k) => !['project', 'maxMinutes', 'keepLogsDays', 'pi'].includes(k)).join(', ')}. I'm using the values in settings.default.json until you add them.`,
  'settings.json has a value I can\'t use for: pi. I\'m using "pi".',
  'settings.json has a value I can\'t use for: maxMinutes. I\'m using 60.',
  'settings.json has a value I can\'t use for: keepLogsDays. I\'m using 30.',
]);
assert.ok(loadSettings(home).missing.includes('limits') && !loadSettings(home).missing.some((n) => n.startsWith('limits.')), 'no "limits" at all is one missing setting, not fifteen');
assert.equal(loadSettings(home).maxMinutes, 60);
// the safety settings fall back to the safe side, and the notice says so
for (const v of ['false', 'off', 0, null, [], {}]) { put({ ...made, sandbox: v }); assert.equal(loadSettings(home).sandbox, true, 'the sandbox is on'); assert.equal(settingsNotice(home), 'settings.json has a value I can\'t use for: sandbox. The sandbox stays on.'); }
put({ ...made, sandbox: false }); assert.equal(loadSettings(home).sandbox, false); assert.equal(settingsNotice(home), '', 'a plain false is the owner\'s choice');
for (const v of ['Signal', ['Signal', 7], [''], {}, null, 5]) { put({ ...made, neverLook: v }); assert.deepEqual(loadSettings(home).neverLook, NEVER_LOOK, 'the built-in list'); assert.equal(settingsNotice(home), 'settings.json has a value I can\'t use for: neverLook. I\'m using the built-in list.'); }
{ // and the guard really uses it
  put({ ...made, neverLook: 'none' });
  const guard = createGuard({ home, windows: async () => [{ id: 1, app: 'Messages', title: 'Ana', frontApp: true }] });
  await assert.rejects(guard.check('front'), /never-look list/);
}
put({ ...made, neverLook: [] }); assert.deepEqual(loadSettings(home).neverLook, []); assert.equal(settingsNotice(home), '', 'an empty list is the owner\'s choice');
// a list with an entry that can't be used: the rest is kept, and the setting is named with what is used
put({ ...made, readOnly: ['~/Documents/cells', 7, ''], docker: 'everywhere', home: 'middle', voices: { jarvis: 'Daniel', anime: 3 } });
{
  const s = loadSettings(home);
  assert.deepEqual(s.readOnly, [path.join(home, 'Documents', 'cells')]); assert.deepEqual(s.docker, []); assert.equal(s.home, 'bottom-left'); assert.deepEqual(s.voices, { jarvis: 'Daniel' });
  assert.deepEqual(settingsNotice(home).split('\n'), [
    'settings.json has a value I can\'t use for: voices. I\'m using {"jarvis":"Daniel"}.',
    'settings.json has a value I can\'t use for: readOnly. I\'m using ["~/Documents/cells"].',
    'settings.json has a value I can\'t use for: docker. I\'m using [].',
    'settings.json has a value I can\'t use for: home. I\'m using "bottom-left".',
  ]);
}
// limits: each on its own, by name
for (const [name, l] of Object.entries(LIMITS)) {
  const { [name]: gone, ...others } = made.limits;
  put({ ...made, limits: others });
  assert.deepEqual(loadSettings(home).missing, [`limits.${name}`]); assert.equal(loadSettings(home).limits[name], l.default);
  for (const bad of [...(l.min > 0 ? [0] : []), -1, l.min - (l.whole ? 1 : l.min / 2), l.max + 1, String(l.default), null, NaN, true, ...(l.whole ? [l.min + 0.5] : [])]) {
    put(JSON.stringify({ ...made, limits: { ...made.limits, [name]: bad } }));
    const s = loadSettings(home);
    assert.deepEqual(s.invalid, [{ name: `limits.${name}`, using: l.default }], `limits.${name}: ${bad} is out`); assert.equal(s.limits[name], l.default);
    assert.equal(settingsNotice(home), `settings.json has a value I can't use for: limits.${name}. I'm using ${l.default}.`);
  }
  for (const good of [l.min, l.max]) { put({ ...made, limits: { ...made.limits, [name]: good } }); const s = loadSettings(home); assert.equal(s.limits[name], good, `limits.${name}: ${good} is in`); assert.deepEqual([s.missing, s.invalid], [[], []]); }
}
put({ ...made, limits: [600] }); assert.deepEqual(loadSettings(home).limits, made.limits); assert.equal(settingsNotice(home).split('\n').length, 1);
// and they are what the code goes by
put({ ...made, routines: { one: ['a'], two: ['b'], three: 'c' }, limits: { ...made.limits, promptChars: 500, noteMaxChars: 1000, routinesShown: 2, approvalBubbleChars: 200, frontLookupMs: 450 } });
{
  const asked = [];
  const pi = createPi({ home, userName: 'Tiago', ask: async (q) => { asked.push(q.placeholder); return null; } });
  await assert.rejects(pi.tools.find((t) => t.name === 'ask_pi').execute({ prompt: 'x'.repeat(501), mode: 'read' }, {}), /over 500 characters/);
  await assert.rejects(pi.tools.find((t) => t.name === 'ask_pi').execute({ prompt: 'y'.repeat(300), mode: 'read' }, {}), /didn't say send/);
  assert.ok(asked[0].includes(`${'y'.repeat(100)}… (the whole text is in`) && !asked[0].includes('y'.repeat(101)), 'the Send bubble holds what approvalBubbleChars says');
  assert.equal(pi.live().split('\n').filter((l) => l.startsWith('- Routine')).length, 2, 'routinesShown');
  const notes = createNotes({ home, userName: 'Tiago' });
  await assert.rejects(notes.tools.find((t) => t.name === 'write_note').execute({ title: 'Long', content: 'z'.repeat(1001) }, {}), /over 1000 characters/);
  assert.equal(limitsFor(home).frontLookupMs, 450);
}
// a file that can't be read at all: the notice is what's wrong with it, the limits are the defaults, the reference file is still written
put('{ broken'); fs.rmSync(refFile);
assert.match(startupSettings(home), /isn't valid JSON/); assert.deepEqual(limitsFor(home), made.limits); assert.deepEqual(JSON.parse(peek()), ref);

// ---- the bubble is held until it can be shown, shown once, and never dropped
{
  const shown = [];
  const offer = heldNotice('settings.json doesn\'t have: home.', (t) => shown.push(t));
  assert.equal(offer(false), false); assert.equal(offer(false), false); assert.deepEqual(shown, [], 'held while the overlay can\'t show it');
  assert.equal(offer(true), true); assert.deepEqual(shown, ['settings.json doesn\'t have: home.']);
  assert.equal(offer(true), false); assert.equal(shown.length, 1, 'once per start-up');
  const none = heldNotice('', (t) => shown.push(t)); assert.equal(none(true), false); assert.equal(shown.length, 1, 'nothing to say, nothing shown');
  // sidekick.mjs offers it when the overlay is up and when the setup guide closes, and works it out once, at start-up
  const side = fs.readFileSync(path.join(src, 'sidekick.mjs'), 'utf8');
  assert.equal(side.match(/startupSettings\(/g).length, 1); assert.equal(side.match(/offerSettingsNotice\(\)/g).length, 2, 'offered at ui_ready and at ob_closed');
  assert.ok(side.includes('settingsNotice(uiReady && !onboarding && (!!config.onboarded || guideClosed))'));
}

// ---- 3. settings.json was never written, and settings.default.json never read
put(made); wrote.length = 0;
const before = fs.readFileSync(file, 'utf8'), stat0 = fs.statSync(file);
startupSettings(home); settingsNotice(home); writeReference(home); loadSettings(home); limitsFor(home);
{
  const pi = createPi({ home, userName: 'Tiago', ask: async () => null });
  pi.live(); pi.briefing(new Date(2026, 10, 12, 9, 0)); pi.tasksOn(new Date());
  await assert.rejects(pi.tools.find((t) => t.name === 'ask_pi').execute({ prompt: 'hello', mode: 'read' }, {}), /didn't say send/);
  const notes = createNotes({ home, userName: 'Tiago' });
  await notes.tools.find((t) => t.name === 'write_note').execute({ title: 'A note', content: 'hello' }, {}); await notes.tools.find((t) => t.name === 'search_notes').execute({ query: 'hello' }, {});
  const guard = createGuard({ home, windows: async () => [{ id: 1, app: 'Safari', title: 'x', frontApp: true }] });
  await guard.check('front'); guard.front('In front: Safari', 'Safari');
}
assert.deepEqual(wrote, [], `settings.json was written by: ${wrote.join(', ')}`);
assert.equal(fs.readFileSync(file, 'utf8'), before); assert.equal(fs.statSync(file).mtimeMs, stat0.mtimeMs); assert.equal(fs.statSync(file).ino, stat0.ino);
assert.deepEqual(read, [], `settings.default.json was read by: ${read.join(', ')}`);
// a reference file that says otherwise changes nothing: it is not read as settings
put({ ...made, maxMinutes: 45 }); const mine = quiet(loadSettings(home));
fs.writeFileSync(refFile, JSON.stringify({ ...made, maxMinutes: 1, sandbox: false, neverLook: [], limits: { ...made.limits, promptChars: 1 } }));
assert.deepEqual(quiet(loadSettings(home)), mine); assert.equal(loadSettings(home).maxMinutes, 45);
{ const { maxMinutes, sandbox, neverLook, ...rest } = made; put(rest); const s = loadSettings(home); assert.deepEqual([s.maxMinutes, s.sandbox, s.neverLook], [60, true, NEVER_LOOK], 'missing settings take the values in code, not the file\'s'); }
assert.deepEqual(read, []);
// the source (comments aside): the file's name and path are used to block it and to write it, and by nothing that reads
const mentions = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (['node_modules', 'dist', 'target', 'test', '.git'].includes(e.name) || e.name.startsWith('.sbx-')) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(mjs|js|rs|swift|html|sh)$/.test(e.name)) fs.readFileSync(p, 'utf8').split('\n').map((l) => l.replace(/\s\/\/ .*$/, '')).forEach((line, i) => { if (/settings\.default|PATHS\.reference|referenceFile\(/.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)) mentions.push([path.relative(path.join(src, '..', '..'), p), i + 1, line.trim()]); }); } };
walk(path.join(src, '..', '..'));
assert.deepEqual([...new Set(mentions.map(([f]) => f))].sort(), ['tauri/sidecar/pi.mjs', 'tauri/sidecar/reference.mjs'], 'only these two files know of it');
for (const [f, n, line] of mentions) assert.ok(!/\b(read\w*|open\w*|createReadStream|copyFile\w*|cp\w*|access\w*|exists\w*|stat\w*|import|require)\s*\(/.test(line.replace(/referenceFile\(/g, '')), `${f}:${n} does not read it: ${line.slice(0, 90)}`);
const refSrc = fs.readFileSync(path.join(src, 'reference.mjs'), 'utf8');
const writer = refSrc.slice(refSrc.indexOf('export function writeReference('), refSrc.indexOf('const shown ='));
assert.deepEqual([...writer.matchAll(/fs\.(\w+)\(/g)].map((m) => m[1]), ['rmSync', 'writeFileSync'], 'writeReference removes and writes; nothing else');
assert.deepEqual([...refSrc.matchAll(/fs\.(\w+)\(/g)].map((m) => m[1]), ['rmSync', 'writeFileSync'], 'and reference.mjs touches no other file');
assert.equal(refSrc.match(/referenceFile\(/g).length, 1); assert.equal(piSrc.match(/referenceFile\b/g).length, 1, 'the path is handed to the writer alone');

fs.rmSync(home, { recursive: true, force: true });
console.log('settings reference tests: passed');
