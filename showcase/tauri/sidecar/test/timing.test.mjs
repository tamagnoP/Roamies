// Local-only build, feature 23 stage 5: measuring (timing.mjs). Off: nothing at all. On: numbers and tool names
// only, per request, and the shell's memory reading by role.
import assert from 'node:assert/strict';
import { createTiming, memoryLine } from '../timing.mjs';
import { settingsDefaults } from '../pi.mjs';

assert.equal(settingsDefaults('/tmp/x').measureRequests, false, 'off by default');
let on = false, clock = 1000, asked = 0;
const lines = [];
const t = createTiming({ on: () => on, log: (kind, data) => lines.push([kind, data]), now: () => clock, askMemory: () => asked++, roles: () => ({ 20: 'sidecar', 30: 'kokoro' }) });
// off: nothing is written, the shell is not asked
t.speechEnd(); t.heard(); t.sent(); t.firstText(); t.replied(); t.firstSound();
assert.equal(t.finish({ route: 'claude', tools: ['show_day'] }), null);
assert.equal(t.memory({ processes: [{ pid: 1, mb: 100 }] }), null);
assert.deepEqual([lines.length, asked], [0, 0]);
// on: the parts of the wait, numbers and tool names only
on = true;
t.speechEnd(); clock += 400; t.heard(); clock += 50; t.sent(); clock += 700; t.firstText(); clock += 300; t.firstSound(); clock += 900; t.replied();
const line = t.finish({ route: 'local', tools: ['show_day', 'remember_commitment'], tokens: { new: 10, out: 3 } });
assert.deepEqual(line, { route: 'local', hearing: 400, ready: 50, reading: 700, voice: 300, toFirstSound: 1450, reply: 1200, tools: ['show_day', 'remember_commitment'], tokens: { new: 10, out: 3 } });
assert.deepEqual(lines.map((l) => l[0]), ['timing']); assert.equal(asked, 1, 'the shell is asked for memory');
// done() waits for the first sound: written when it plays, or after the wait; a new request writes it first
const timers = []; const t2 = createTiming({ on: () => true, log: (kind, data) => lines.push([kind, data]), now: () => clock, timers: { set: (f) => { timers.push(f); return timers.length; }, clear: () => {} } });
const n0 = lines.length;
t2.speechEnd(); t2.heard(); t2.sent(); clock += 100; t2.firstText(); t2.replied(); t2.done({ route: 'claude' });
assert.equal(lines.length, n0, 'waiting for the sound'); clock += 250; t2.firstSound();
assert.equal(lines.at(-1)[1].voice, 250);
t2.heard(); t2.sent(); t2.firstText(); t2.replied(); t2.done({ route: 'local' });
t2.heard(); assert.equal(lines.at(-1)[1].route, 'local', 'the next request wrote it first, without a sound');
{ const count = () => lines.filter(([k]) => k === 'timing').length, before = count(); timers.at(-1)(); assert.equal(count(), before, 'its timer then writes nothing more'); }
// typed: no end of speech; a second request within a minute doesn't ask for memory again
t.heard(); clock += 10; t.sent(); clock += 500; t.firstText(); t.replied();
assert.deepEqual(t.finish({ tools: [] }), { route: 'claude', hearing: null, ready: 10, reading: 500, voice: null, toFirstSound: null, reply: 0, tools: [] });
assert.equal(asked, 1);
// the shell's reading, by role
const m = { type: 'memory', processes: [{ pid: 10, parent: null, name: 'roamies', mb: 120.5 }, { pid: 20, parent: 10, name: 'node', mb: 180 }, { pid: 25, parent: 10, name: 'roamies-voice', mb: 300 }, { pid: 30, parent: 20, name: 'python3.12', mb: 900 }, { pid: 31, parent: 20, name: 'sleep', mb: null }], webkit: [{ pid: 40, name: 'com.apple.WebKit.WebContent', mb: 140 }, { pid: 41, name: 'com.apple.WebKit.GPU', mb: 60 }], pressure: 1, swapMB: 512 };
assert.deepEqual(memoryLine(m, { 20: 'sidecar', 30: 'kokoro' }), { mb: { shell: 120.5, sidecar: 180, voice: 300, kokoro: 900, webkit: 200 }, processes: 7, pressure: 1, swapMB: 512 });
assert.deepEqual(t.memory(m).mb.kokoro, 900);
assert.ok(lines.every(([, d]) => !JSON.stringify(d).match(/[a-z]{4,} [a-z]{4,} [a-z]{4,}/)), 'no words beyond names');
console.log('timing tests passed');
