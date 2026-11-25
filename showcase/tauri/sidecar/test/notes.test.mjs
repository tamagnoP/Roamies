// Local-only build: notes in an Obsidian vault (notes.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NOTE_TOOLS, VaultRefused, createNotes, createVault, noteName } from '../notes.mjs';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'notes-home-')));
const vault = path.join(home, 'Documents', 'roamies-vault');
let clock = new Date(2026, 10, 11, 9, 5).getTime();
const notes = createNotes({ home, userName: 'Tiago', now: () => clock });
const tool = (n) => notes.tools.find((t) => t.name === n);
const read = (name) => fs.readFileSync(path.join(vault, name), 'utf8');

// A title is only ever a file name inside the vault.
assert.equal(noteName('  Cell   segmentation ideas.md '), 'Cell segmentation ideas');
assert.equal(noteName('../../.ssh/authorized_keys'), 'ssh authorized_keys');
assert.equal(noteName('a/b\\c:d*e?f"g<h>i|j#k^l[m]n'), 'a b c d e f g h i j k l m n');
assert.equal(noteName('...'), ''); assert.equal(noteName('x'.repeat(300)).length, 100);

assert.match(notes.live(), /^- Notes vault: ~\/Documents\/roamies-vault \(0 notes\)\.$/);
assert.equal(await tool('search_notes').execute({ query: 'anything' }), 'The vault has no notes yet.');

// A new note: front matter with the date, the text as given, nothing outside the vault.
assert.equal(await tool('write_note').execute({ title: 'Cellpose thresholds', content: 'Try flow threshold 0.6 on the dense images. See [[Random forest features]].' }), 'Saved the note "Cellpose thresholds" in the vault.');
assert.equal(read('Cellpose thresholds.md'), '---\ncreated: 2026-11-11 09:05\n---\n\nTry flow threshold 0.6 on the dense images. See [[Random forest features]].\n');
await tool('write_note').execute({ title: '../../escape', content: 'still inside' });
assert.ok(fs.existsSync(path.join(vault, 'escape.md')) && !fs.existsSync(path.join(home, 'escape.md')) && !fs.existsSync(path.join(home, 'Documents', 'escape.md')));

// An existing note is never written over: only added to, and only when asked.
await assert.rejects(tool('write_note').execute({ title: 'cellpose THRESHOLDS', content: 'x' }), /already exists.*append true/);
clock = new Date(2026, 10, 12, 14, 30).getTime();
assert.equal(await tool('write_note').execute({ title: 'cellpose thresholds', content: '0.6 worked.', append: true }), 'Added to the note "Cellpose thresholds".');
assert.ok(read('Cellpose thresholds.md').endsWith('See [[Random forest features]].\n\n## 2026-11-12 14:30\n\n0.6 worked.\n'));
assert.equal(await tool('write_note').execute({ title: 'Random forest features', content: 'Area, eccentricity, mean intensity.', append: true }), 'Saved the note "Random forest features" in the vault.', 'append to a note that is not there makes it');
await assert.rejects(tool('write_note').execute({ title: '  ', content: 'x' }), /needs a title/);
await assert.rejects(tool('write_note').execute({ title: 'a', content: '  ' }), /empty/);
await assert.rejects(tool('write_note').execute({ title: 'a', content: 'x'.repeat(20_001) }), /over 20000/);

// Notes made in Obsidian (in folders too) are found; Obsidian's own folders are not.
fs.mkdirSync(path.join(vault, 'Papers')); fs.writeFileSync(path.join(vault, 'Papers', 'Stringer 2021.md'), 'Cellpose: a generalist algorithm for cell segmentation.\nThresholds matter.\n');
fs.mkdirSync(path.join(vault, '.obsidian')); fs.writeFileSync(path.join(vault, '.obsidian', 'secret.md'), 'thresholds');
const hits = await tool('search_notes').execute({ query: 'threshold cellpose' });
assert.match(hits, /^- Cellpose thresholds \(\d{4}-\d\d-\d\d\)\n {2}Try flow threshold 0\.6/);
assert.match(hits, /- Stringer 2021 \(in Papers\)/);
assert.ok(!hits.includes('secret'));
assert.match(await tool('search_notes').execute({ query: 'eccentricity zebra' }), /^No note has all of those words; these have some:\n- Random forest features/);
assert.equal(await tool('search_notes').execute({ query: 'zebra' }), 'No note mentions "zebra".');
assert.match(await tool('search_notes').execute({ query: '' }), /^4 notes\. Most recently changed:\n- /);

// Reading: by title in any case, or the one note that contains it.
assert.match(await tool('read_note').execute({ title: 'stringer' }), /^# Stringer 2021\n\nCellpose: a generalist/);
assert.match(await tool('read_note').execute({ title: 'RANDOM FOREST FEATURES' }), /Area, eccentricity/);
await assert.rejects(tool('read_note').execute({ title: 'e' }), /Several notes match/);
await assert.rejects(tool('read_note').execute({ title: 'nope' }), /no note called "nope"/);
await assert.rejects(tool('read_note').execute({ title: '../../../etc/passwd' }), /no note called/);

// A note that is really a link out of the vault is left alone.
fs.writeFileSync(path.join(home, 'outside.txt'), 'private');
fs.symlinkSync(path.join(home, 'outside.txt'), path.join(vault, 'Linked.md'));
await assert.rejects(tool('write_note').execute({ title: 'Linked', content: 'x', append: true }), /already in the vault/);
assert.equal(fs.readFileSync(path.join(home, 'outside.txt'), 'utf8'), 'private');

// Feature 18: the one writer of the vault. It makes a file or adds to its end, and nothing else.
const box = createVault({ home, userName: 'Tiago' });
assert.equal(box.create('Daily/2026-11-26.md', '# Thursday\n'), true, 'its folder is made');
assert.equal(box.create('Daily/2026-11-26.md', 'over it'), false, 'a file that is there is never written over');
assert.equal(read('Daily/2026-11-26.md'), '# Thursday\n');
assert.equal(box.append('Daily/2026-11-26.md', '- 10:00 Done: x\n'), true);
fs.appendFileSync(path.join(vault, 'Daily', '2026-11-26.md'), 'typed by hand, no newline');
assert.equal(box.append('Daily/2026-11-26.md', '- 11:00 Done: y\n'), true);
assert.equal(read('Daily/2026-11-26.md'), '# Thursday\n- 10:00 Done: x\ntyped by hand, no newline\n- 11:00 Done: y\n', 'what was typed by hand stays, and an added line starts on a line of its own');
assert.equal(box.append('Daily/missing.md', 'x'), false, 'adding to a file that is not there makes nothing');
assert.ok(!fs.existsSync(path.join(vault, 'Daily', 'missing.md')));
assert.equal(box.read('Daily/2026-11-26.md').startsWith('# Thursday'), true); assert.equal(box.read('Daily/none.md'), null);
for (const bad of ['../escape.md', 'Daily/../../escape.md', '.obsidian/x.md', 'Daily/.hidden.md', '/etc/x.md', 'Daily//x.md', 'Daily/x.txt', 'a\\b.md']) {
  assert.throws(() => box.create(bad, 'x'), VaultRefused, bad);
}
assert.ok(!fs.existsSync(path.join(home, 'escape.md')) && !fs.existsSync(path.join(home, 'Documents', 'escape.md')));
// A folder or a file that is a link is never followed.
fs.mkdirSync(path.join(home, 'elsewhere'));
fs.symlinkSync(path.join(home, 'elsewhere'), path.join(vault, 'Tasks'));
assert.throws(() => box.create('Tasks/A.md', 'x'), VaultRefused); assert.deepEqual(fs.readdirSync(path.join(home, 'elsewhere')), []);
assert.equal(box.read('Tasks/A.md'), null);
fs.writeFileSync(path.join(home, 'elsewhere', 'B.md'), 'private');
fs.symlinkSync(path.join(home, 'elsewhere', 'B.md'), path.join(vault, 'Daily', 'B.md'));
assert.throws(() => box.append('Daily/B.md', 'x'), VaultRefused); assert.equal(box.create('Daily/B.md', 'x'), false);
assert.equal(fs.readFileSync(path.join(home, 'elsewhere', 'B.md'), 'utf8'), 'private'); assert.equal(box.read('Daily/B.md'), null);
fs.writeFileSync(path.join(vault, 'Plain'), 'a file, not a folder');
assert.throws(() => box.create('Plain/x.md', 'x'), VaultRefused);
// write_note goes through it: a note in a linked folder is not added to.
fs.mkdirSync(path.join(home, 'elsewhere', 'Sub')); fs.writeFileSync(path.join(home, 'elsewhere', 'Sub', 'Far.md'), 'far');
fs.symlinkSync(path.join(home, 'elsewhere', 'Sub'), path.join(vault, 'Sub'));
assert.equal(await tool('write_note').execute({ title: 'Far', content: 'x', append: true }), 'Saved the note "Far" in the vault.', 'a linked folder is not looked in: a note of its own is made');
assert.ok(fs.existsSync(path.join(vault, 'Far.md')));
assert.equal(fs.readFileSync(path.join(home, 'elsewhere', 'Sub', 'Far.md'), 'utf8'), 'far');
fs.mkdirSync(path.join(vault, 'Papers', 'Deep'), { recursive: true }); fs.writeFileSync(path.join(vault, 'Papers', 'Deep', 'Inner.md'), 'inner');
assert.equal(await tool('write_note').execute({ title: 'Inner', content: 'more', append: true }), 'Added to the note "Inner".', 'a note in a real folder is added to');
assert.ok(read('Papers/Deep/Inner.md').endsWith('inner\n\n## 2026-11-12 14:30\n\nmore\n'));

// Feature 18: each note made or added to is told to the daily note, by its title.
const told = [];
const notes2 = createNotes({ home, userName: 'Tiago', now: () => clock, onNote: (t) => told.push(t) });
await notes2.tools.find((t) => t.name === 'write_note').execute({ title: 'Told once', content: 'x' });
await notes2.tools.find((t) => t.name === 'write_note').execute({ title: 'told once', content: 'y', append: true });
await assert.rejects(notes2.tools.find((t) => t.name === 'write_note').execute({ title: 'Told once', content: 'z' }));
assert.deepEqual(told, ['Told once', 'Told once'], 'made and added to; a refused one is not told');

// ---- Feature 18: task pages, "Tasks/<title>.md", made when the first note is linked
{
  const todos = [{ id: 'c1', text: 'Send slides', kind: 'commitment', status: 'open' }, { id: 'c2', text: 'Send  slides', kind: 'commitment', status: 'open' }, { id: 'r1', text: 'Stretch', kind: 'reminder', status: 'open' }];
  const logs = [];
  const n3 = createNotes({ home, userName: 'Tiago', now: () => clock, todos: () => todos, log: (k, d) => logs.push([k, d]) });
  const t3 = (n) => n3.tools.find((t) => t.name === n);
  const pagesState = () => JSON.parse(fs.readFileSync(path.join(home, 'Documents', 'roamies-pi', 'state.json'), 'utf8')).taskPages;
  assert.deepEqual(n3.tools.map((t) => t.name), NOTE_TOOLS);
  assert.equal(await t3('notes_for').execute({ task: 'c1' }), 'No note is linked to that to-do yet.');
  // "Tasks" is a link (above): no page is made through it, and the note isn't written either.
  await assert.rejects(t3('write_note').execute({ title: 'Slide ideas', content: 'x', task: 'c1' }), VaultRefused);
  assert.ok(!fs.existsSync(path.join(vault, 'Slide ideas.md'))); assert.deepEqual(fs.readdirSync(path.join(home, 'elsewhere')).filter((f) => f.endsWith('.md')), ['B.md']);
  fs.unlinkSync(path.join(vault, 'Tasks'));
  await assert.rejects(t3('write_note').execute({ title: 'Slide ideas', content: 'x', task: 'nope' }), /no to-do with the id "nope"/);
  await assert.rejects(t3('write_note').execute({ title: 'Slide ideas', content: 'x', task: 'r1' }), /only to-dos have a page/);
  assert.ok(!fs.existsSync(path.join(vault, 'Slide ideas.md')) && !fs.existsSync(path.join(vault, 'Tasks')), 'checked before anything is written');
  assert.equal(await t3('write_note').execute({ title: 'Slide ideas', content: 'Open with the result.', task: 'c1' }), 'Saved the note "Slide ideas" in the vault, linked to its to-do\'s page.');
  assert.equal(read('Slide ideas.md'), '---\ncreated: 2026-11-12 14:30\ntask: "[[Tasks/Send slides]]"\n---\n\nOpen with the result.\n');
  assert.equal(read('Tasks/Send slides.md'), '---\ntodo: c1\ncreated: 2026-11-12 14:30\n---\n\n# Send slides\n\nThe notes about this to-do. Roamies adds a line for each note linked to it; links added by hand count too.\n\n## Notes\n- [[Slide ideas]] (2026-11-12 14:30)\n');
  assert.deepEqual(pagesState(), { c1: 'Send slides' });
  // Another to-do with the same title: "(2)". A note already there is linked by its page alone: the note is unchanged.
  const before = read('Papers/Stringer 2021.md');
  assert.equal(await t3('link_note').execute({ title: 'stringer', task: 'c2' }), 'Linked the note "Stringer 2021" to the to-do\'s page.');
  assert.equal(read('Papers/Stringer 2021.md'), before);
  assert.ok(read('Tasks/Send slides (2).md').startsWith('---\ntodo: c2\n'));
  assert.deepEqual(pagesState(), { c1: 'Send slides', c2: 'Send slides (2)' });
  assert.equal(await t3('link_note').execute({ title: 'Stringer 2021', task: 'c2' }), '"Stringer 2021" is already linked to that to-do.');
  assert.equal(await t3('write_note').execute({ title: 'cellpose thresholds', content: 'For the slides.', append: true, task: 'c2' }), 'Added to the note "Cellpose thresholds", linked to its to-do\'s page.');
  await assert.rejects(t3('link_note').execute({ title: 'Send slides', task: 'c1' }), /no note called/, 'a page is not one of the notes');
  // notes_for: the page's links, and the notes that link to the page, by hand too. Daily notes don't count.
  fs.writeFileSync(path.join(vault, 'By hand.md'), 'See [[Send slides (2)|the slides]].\n');
  fs.writeFileSync(path.join(vault, 'Other.md'), 'See [[Tasks/Send slides]] and [[Send slides]].\n');
  fs.writeFileSync(path.join(vault, 'Daily', '2026-11-12.md'), '- Done: [[Tasks/Send slides|Send slides]]\n');
  fs.appendFileSync(path.join(vault, 'Tasks', 'Send slides.md'), '- [[Random forest features]]\n- [[Not there]]\n');
  const for1 = await t3('notes_for').execute({ task: 'c1' }), for2 = await t3('notes_for').execute({ task: 'c2' });
  assert.match(for1, /^3 notes about that to-do:\n/); for (const t of ['Slide ideas', 'Other', 'Random forest features']) assert.ok(for1.includes(`- ${t}\n`) || for1.endsWith(`- ${t}`), t);
  assert.ok(!for1.includes('2026-11-12'), 'a daily note is not one of the notes');
  assert.match(for2, /^3 notes about that to-do:\n/); for (const t of ['By hand', 'Cellpose thresholds', 'Stringer 2021 (in Papers)']) assert.ok(for2.includes(`- ${t}`), t);
  // A page deleted by hand is made again at the next link.
  fs.rmSync(path.join(vault, 'Tasks', 'Send slides.md'));
  assert.equal(await t3('notes_for').execute({ task: 'c1' }), 'No note is linked to that to-do yet.');
  await t3('link_note').execute({ title: 'Other', task: 'c1' });
  assert.ok(read('Tasks/Send slides.md').endsWith('## Notes\n- [[Other]] (2026-11-12 14:30)\n'));
  assert.equal(n3.pages.link('c1', 'Send slides'), '[[Tasks/Send slides|Send slides]]'); assert.equal(n3.pages.link('r1', 'Stretch'), 'Stretch');
  for (const [k, d] of logs) assert.ok(!/slide|stringer|other|cellpose/i.test(JSON.stringify(d)), `${k}: counts only`);
}

// A vault set outside the home folder is refused.
fs.writeFileSync(path.join(home, 'Documents', 'roamies-pi', 'settings.json'), JSON.stringify({ vault: '/tmp' }));
await assert.rejects(tool('write_note').execute({ title: 'a', content: 'b' }), /inside the home folder/);
assert.match(notes.live(), /not usable/);
fs.writeFileSync(path.join(home, 'Documents', 'roamies-pi', 'settings.json'), JSON.stringify({ vault: '~/Notes/Lab' }));
await tool('write_note').execute({ title: 'Moved', content: 'here' });
assert.ok(fs.existsSync(path.join(home, 'Notes', 'Lab', 'Moved.md')));

fs.rmSync(home, { recursive: true, force: true });
console.log('notes tests: passed');
