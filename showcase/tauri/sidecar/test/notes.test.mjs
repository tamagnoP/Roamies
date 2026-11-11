// Local-only build: notes in an Obsidian vault (notes.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNotes, noteName } from '../notes.mjs';

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

// A vault set outside the home folder is refused.
fs.writeFileSync(path.join(home, 'Documents', 'roamies-pi', 'settings.json'), JSON.stringify({ vault: '/tmp' }));
await assert.rejects(tool('write_note').execute({ title: 'a', content: 'b' }), /inside the home folder/);
assert.match(notes.live(), /not usable/);
fs.writeFileSync(path.join(home, 'Documents', 'roamies-pi', 'settings.json'), JSON.stringify({ vault: '~/Notes/Lab' }));
await tool('write_note').execute({ title: 'Moved', content: 'here' });
assert.ok(fs.existsSync(path.join(home, 'Notes', 'Lab', 'Moved.md')));

fs.rmSync(home, { recursive: true, force: true });
console.log('notes tests: passed');
