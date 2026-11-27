// Local-only build, feature 14: changing a note the owner names (notes.mjs edit_note and undo_note_edit), in a
// throwaway home: named in his words, shown first, saved only on "save", the previous version kept outside the vault
// and never deleted, refused when the note changed since it was shown, daily notes, task pages and private notes
// left alone, the undo, the Log line, and the note texts counted for the ledger.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KEEP_NOTE_WORDS, SAVE_WORDS, VERSIONS_FOLDER, createNotes } from '../notes.mjs';
import { readState } from '../pi.mjs';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'noteedit-home-')));
const vault = path.join(home, 'Documents', 'roamies-vault'), own = path.join(home, 'Documents', 'roamies-pi');
const put = (rel, text) => { const f = path.join(vault, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
const read = (rel) => fs.readFileSync(path.join(vault, rel), 'utf8');
const LAB = '---\ncreated: 2026-11-20 09:00\n---\n\n# Lab plan\n\nthreshold 0.6\nimages: 40\nbook the confocal\n';
put('Lab plan.md', LAB);
put('Ideas/Pie chart.md', 'The pie chart is wrong.\nUse bars.\n');
put('Daily/2026-11-27.md', '## Plan\n');
put('Tasks/Send slides.md', '# Send slides\n');
put('Secret thoughts.md', '---\ncreated: 2026-11-20 09:00\nprivate: true\n---\n\nprivate text\n');
fs.symlinkSync(path.join(home, 'elsewhere.md'), path.join(vault, 'Linked.md'));
fs.writeFileSync(path.join(home, 'elsewhere.md'), 'outside\n');

let clock = new Date(2026, 10, 27, 10, 5).getTime(), words = '', reply = null;
const asked = [], edited = [], counts = [];
const notes = createNotes({
  home, userName: 'Tiago', now: () => clock, heard: () => words, persona: () => 'Jarvis', counted: (k, c) => counts.push([k, c]), onEdited: (t) => edited.push(t),
  ask: async (o) => { asked.push(o); if (typeof reply === 'function') return reply(o); if (reply === 'none') { const e = new Error('none'); e.name = 'Unanswered'; throw e; } return reply === null ? null : o.parse(reply); },
});
const tool = (n) => notes.tools.find((t) => t.name === n);
const edit = (a, ctx) => tool('edit_note').execute(a, ctx);
const undo = (a, ctx) => tool('undo_note_edit').execute(a, ctx);
const versions = () => { const out = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else out.push(path.relative(path.join(own, VERSIONS_FOLDER), f)); } }; try { walk(path.join(own, VERSIONS_FOLDER)); } catch { /* none yet */ } return out.sort(); };

// ---- the words that save, and the ones that keep: said alone, with the filler words and the persona's name
assert.deepEqual(SAVE_WORDS, ['save', 'save it']);
words = 'change Lab plan: make the threshold 0.7'; reply = (o) => {
  for (const t of ['save', 'save it', 'um, save it please', 'Jarvis, save', 'save it Jarvis', 'Save!']) assert.deepEqual(o.parse(t), { kind: 'save' }, t);
  for (const t of KEEP_NOTE_WORDS) assert.deepEqual(o.parse(t), { kind: 'keep' }, t);
  for (const t of ['yes', 'go ahead', 'yes save it', 'save it and add more', 'ok', 'saved']) assert.equal(o.parse(t), null, `"${t}" doesn't save`);
  return null;
};
assert.match(await edit({ title: 'Lab plan', changes: [{ find: 'threshold 0.6', replace: 'threshold 0.7' }] }), /No answer, so "Lab plan" wasn't changed/);

// ---- shown first, with the removed and added lines; nothing saved without "save"
const shown = asked.at(-1);
assert.equal(shown.placeholder, 'Change Lab plan?\n- threshold 0.6\n+ threshold 0.7');
assert.deepEqual([shown.spoken, shown.choices, shown.clicks], ['Change Lab plan?', ['Save it', 'Keep it as it is'], [{ kind: 'save' }, { kind: 'keep' }]]);
assert.equal(read('Lab plan.md'), LAB);
reply = 'keep it'; assert.equal(await edit({ title: 'Lab plan', changes: [{ find: 'threshold 0.6', replace: 'threshold 0.7' }] }), 'Tiago chose to keep "Lab plan" as it is; nothing was changed.');
reply = 'none'; assert.match(await edit({ title: 'Lab plan', changes: [{ find: 'threshold 0.6', replace: 'threshold 0.7' }] }), /No answer/);
assert.equal(read('Lab plan.md'), LAB); assert.deepEqual(versions(), []); assert.deepEqual(edited, []);

// ---- saved: the previous version first, outside the vault; the Log line; remembered for an undo
reply = 'save it';
assert.equal(await edit({ title: 'lab plan', changes: [{ find: 'threshold 0.6', replace: 'threshold 0.7' }, { find: 'images: 40', replace: 'images: 48' }] }), 'Saved the change to "Lab plan"; its previous version is kept.');
assert.equal(read('Lab plan.md'), LAB.replace('threshold 0.6', 'threshold 0.7').replace('images: 40', 'images: 48'));
assert.deepEqual(versions(), ['Lab plan 2026-11-27 1005.md']);
assert.equal(fs.readFileSync(path.join(own, VERSIONS_FOLDER, 'Lab plan 2026-11-27 1005.md'), 'utf8'), LAB);
assert.deepEqual(edited, ['Lab plan']);
assert.deepEqual(readState(own).noteEdits.map((e) => [e.rel, e.title, e.version]), [['Lab plan.md', 'Lab plan', 'Lab plan 2026-11-27 1005.md']]);
assert.ok(!fs.readdirSync(vault).some((f) => f.startsWith('.')), 'no temporary file left in the vault');
// a second edit in the same minute keeps its own version; a note in a folder keeps its folders
words = 'in Pie chart, say lines instead of bars';
assert.match(await edit({ title: 'Pie chart', changes: [{ find: 'Use bars.', replace: 'Use lines.' }] }), /^Saved/);
words = 'change Lab plan again: book the confocal for Monday';
assert.match(await edit({ title: 'Lab plan', changes: [{ find: 'book the confocal', replace: 'book the confocal for Monday' }] }), /^Saved/);
assert.deepEqual(versions(), ['Ideas/Pie chart 2026-11-27 1005.md', 'Lab plan 2026-11-27 1005 (2).md', 'Lab plan 2026-11-27 1005.md']);

// ---- refused before anything is shown
asked.length = 0;
words = '';
await assert.rejects(edit({ title: 'Lab plan', changes: [{ find: 'x', replace: 'y' }] }), /only when Tiago asks in a request they typed or spoke/);
words = 'change the plan';
await assert.rejects(edit({ title: 'Lab plan', changes: [{ find: 'threshold 0.7', replace: 'threshold 0.8' }] }), /only when Tiago names it in this request/);
words = 'change Lab plan';
await assert.rejects(edit({ title: 'Lab plan', changes: [{ find: 'threshold 9', replace: 'x' }] }), /isn't in the note as written/);
await assert.rejects(edit({ title: 'Lab plan', changes: [{ find: 'e', replace: 'x' }] }), /is in the note \d+ times/);
await assert.rejects(edit({ title: 'Lab plan', changes: [] }), /Give the changes/);
await assert.rejects(edit({ title: 'Lab plan', changes: [{ find: 'threshold 0.7', replace: 'threshold 0.7' }] }), /changes nothing/);
await assert.rejects(edit({ title: 'Lab plan', text: 'A new text.' }), /only when they ask for a rewrite/);
await assert.rejects(edit({ title: 'Lab plan', changes: [{ find: read('Lab plan.md'), replace: '  \n' }] }), /leave the note empty/);
words = 'change the daily note 2026-11-27'; await assert.rejects(edit({ title: '2026-11-27', changes: [{ find: 'Plan', replace: 'X' }] }), /Daily notes and task pages are kept by the app/);
words = 'change Send slides'; await assert.rejects(edit({ title: 'Send slides', changes: [{ find: 'Send', replace: 'X' }] }), /Daily notes and task pages are kept by the app/);
words = 'change Secret thoughts'; await assert.rejects(edit({ title: 'Secret thoughts', changes: [{ find: 'private text', replace: 'x' }] }), /There's no note called "Secret thoughts"/, 'a private note, on Claude\'s route');
words = 'change Linked'; await assert.rejects(edit({ title: 'Linked', changes: [{ find: 'outside', replace: 'x' }] }), /There's no note called "Linked"/, 'a link is not a note');
assert.equal(asked.length, 0, 'none of these was shown');
assert.equal(fs.readFileSync(path.join(home, 'elsewhere.md'), 'utf8'), 'outside\n');
// a rewrite, when he asks for one
words = 'rewrite Pie chart as one line: bars, not a pie'; reply = 'save';
assert.match(await edit({ title: 'Pie chart', text: 'Bars, not a pie.' }), /^Saved/);
assert.equal(read('Ideas/Pie chart.md'), 'Bars, not a pie.\n');

// ---- the note changed since it was shown: nothing saved, his own change kept
words = 'change Lab plan: images 50';
reply = (o) => { fs.appendFileSync(path.join(vault, 'Lab plan.md'), 'added in Obsidian\n'); return o.parse('save'); };
assert.equal(await edit({ title: 'Lab plan', changes: [{ find: 'images: 48', replace: 'images: 50' }] }), 'The note changed since I showed the change, so nothing was saved.');
assert.ok(read('Lab plan.md').includes('images: 48') && read('Lab plan.md').endsWith('added in Obsidian\n'));

// ---- the undo: only when he asks for it; shown and saved like an edit; the version it replaces kept too
const before = read('Ideas/Pie chart.md'), kept0 = versions().length;
words = 'what did I change?'; reply = 'save';
await assert.rejects(undo({}), /only when Tiago asks for it in this request \(undo, revert, restore or put back\)/);
words = 'undo the last note edit'; reply = 'keep';
assert.match(await undo({}), /keep "Pie chart" as it is/);
assert.equal(read('Ideas/Pie chart.md'), before);
reply = 'save it';
assert.equal(await undo({}), 'Put back "Pie chart" as it was before that edit; the version it replaced is kept too.');
assert.equal(read('Ideas/Pie chart.md'), 'The pie chart is wrong.\nUse lines.\n');
assert.equal(versions().length, kept0 + 1, 'the text it replaced is kept');
assert.match(asked.at(-1).placeholder, /^Put back Pie chart as it was before the edit at 10:05\?\n/);
words = 'put back Lab plan';
assert.match(await undo({ title: 'Lab plan' }), /^Put back "Lab plan"/);
assert.ok(read('Lab plan.md').includes('book the confocal\n') && !read('Lab plan.md').includes('for Monday'));
assert.deepEqual(edited.slice(-2), ['Pie chart', 'Lab plan']);

// ---- note texts sent to the model are counted for the ledger; nothing in the vault or the versions is deleted
counts.length = 0;
await tool('read_note').execute({ title: 'Lab plan' });
await tool('search_notes').execute({ query: 'confocal' });
assert.equal(counts.length, 2); assert.ok(counts.every(([k, c]) => k === 'note' && c > 0));
const own2 = [];
await tool('read_note').execute({ title: 'Lab plan' }, { count: (k, c) => own2.push(k) });
assert.deepEqual(own2, ['note'], 'the local route counts its own');
const src = fs.readFileSync(new URL('../notes.mjs', import.meta.url), 'utf8');
assert.ok(!/unlink|rmSync|rmdir|\.rm\(/.test(src), 'nothing in notes.mjs deletes anything');
assert.equal((src.match(/renameSync\(/g) ?? []).length, 1, 'one rename: the temporary file over the note it replaces');
console.log('note edit tests passed');
