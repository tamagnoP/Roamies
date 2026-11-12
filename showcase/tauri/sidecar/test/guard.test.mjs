// Local-only build: the never-look list (guard.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGuard } from '../guard.mjs';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-home-')));
const settings = path.join(home, 'Documents', 'roamies-pi', 'settings.json');
let wins = [];
const guard = createGuard({ home, windows: async () => { if (wins === 'fail') throw new Error('helper not answering'); return wins; } });
const shots = [];
const tools = guard.wrap([
  { name: 'take_screenshot', execute: async (a) => { shots.push(a?.target ?? 'screen'); return 'shot'; } },
  { name: 'read_window', execute: async (a) => `read ${a?.target ?? 'front'}` },
  { name: 'act_in_app', execute: async () => 'acted' },
  { name: 'list_windows', execute: async () => wins.map((w) => `window:${w.id}  ${w.app}${w.title ? ` — ${w.title}` : ''}${w.frontApp ? '  (frontmost app)' : ''}`).join('\n') || 'No windows open.' },
  { name: 'write_note', execute: async () => 'noted' },
]);
const tool = (n) => tools.find((t) => t.name === n);

// Nothing sensitive open: everything works, and other tools are untouched.
wins = [{ id: 1, app: 'Safari', title: 'Cellpose docs', frontApp: true }, { id: 2, app: 'Zotero', title: 'My Library' }];
assert.equal(await tool('take_screenshot').execute({}), 'shot');
assert.equal(await tool('take_screenshot').execute({ target: 'front' }), 'shot');
assert.equal(await tool('read_window').execute({}), 'read front');
assert.equal(await tool('write_note').execute({}), 'noted');
assert.equal(guard.front('In front: Safari — Cellpose docs'), 'In front: Safari — Cellpose docs');

// A password manager in the background: no whole-screen picture, but single windows of other apps are fine.
wins = [{ id: 1, app: 'Safari', title: 'Bank', frontApp: true }, { id: 7, app: '1Password 8', title: 'All Items' }];
await assert.rejects(tool('take_screenshot').execute({}), /1Password 8 is open and on the never-look list/);
await assert.rejects(tool('take_screenshot').execute({ target: 'screen' }), /whole screen/);
assert.equal(await tool('take_screenshot').execute({ target: 'front' }), 'shot');
assert.equal(await tool('take_screenshot').execute({ target: 'Safari' }), 'shot');
await assert.rejects(tool('take_screenshot').execute({ target: '1password' }), /never-look list/);
await assert.rejects(tool('take_screenshot').execute({ target: 'window:7' }), /never-look list/);
await assert.rejects(tool('read_window').execute({ target: '1Password' }), /never-look list/);
assert.equal(await tool('list_windows').execute({}), 'window:1  Safari — Bank  (frontmost app)\n(1 window left out: on the never-look list.)');

// It's in front: nothing looks at it, reads it or works in it, and it isn't named in what's sent with a request.
wins = [{ id: 9, app: 'Messages', title: 'Ana', frontApp: true }, { id: 1, app: 'Safari', title: 'Messages of the day' }];
await assert.rejects(tool('take_screenshot').execute({ target: 'front' }), /Messages is on the never-look list/);
await assert.rejects(tool('read_window').execute({}), /never-look list/);
await assert.rejects(tool('act_in_app').execute({ steps: [] }), /never-look list/);
assert.equal(guard.front('In front: Messages — Ana'), 'In front: an app on the never-look list (its name and window are hidden).');
assert.match(await tool('list_windows').execute({}), /^window:1  Safari — Messages of the day\n\(1 window left out/, 'the app decides, not a word in a title');

// It fails closed.
wins = 'fail';
await assert.rejects(tool('take_screenshot').execute({ target: 'front' }), /couldn't check which apps are open/);

// The list is the user's: their own names, or none at all.
wins = [{ id: 9, app: 'Messages', title: 'Ana', frontApp: true }, { id: 3, app: 'Signal', title: 'x' }];
fs.writeFileSync(settings, JSON.stringify({ neverLook: ['Signal'] }));
assert.equal(await tool('take_screenshot').execute({ target: 'front' }), 'shot');
await assert.rejects(tool('take_screenshot').execute({ target: 'Signal' }), /never-look list/);
fs.writeFileSync(settings, JSON.stringify({ neverLook: [] }));
wins = 'fail';
assert.equal(await tool('take_screenshot').execute({}), 'shot', 'an empty list switches the check off');

fs.rmSync(home, { recursive: true, force: true });
console.log('never-look tests: passed');
