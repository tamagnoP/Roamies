// Local-only build, feature 23 stage 4, the owner's answer 4: the private mark (privacy.mjs) and the places that
// respect it outside sidekick.mjs: the notes (notes.mjs) and the to-do list's store (store.mjs). list_commitments is
// tested in calendar.test.mjs; the live state, the tool results and the private requests in local-run.test.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-home-')));
process.env.ROAMIES_DATA_DIR = path.join(home, 'data');
const { PRIVATE_WORD, liftAsk, liftQuestion, privateCount, privateNote, redact, redactResult, unmarkNote } = await import('../privacy.mjs');
const { addCommitment, setCommitmentPrivate, setPrivateContext, openCommitments } = await import('../store.mjs');
const { createNotes } = await import('../notes.mjs');

// ---- redaction: whole words, any case, longest first; ids too
const words = ['Call the clinic', 'clinic', 'c1x9', 'ab'];
assert.equal(redact('Planned: 10:00 "Call the clinic" [c1x9]; the clinic opens at 9.', words), `Planned: 10:00 "${PRIVATE_WORD}" [${PRIVATE_WORD}]; the ${PRIVATE_WORD} opens at 9.`);
assert.equal(redact('CALL THE CLINIC now', words), `${PRIVATE_WORD} now`);
assert.equal(redact('clinical trial, about', words), 'clinical trial, about', 'only whole words; under 3 characters left alone');
assert.equal(redact('nothing here', []), 'nothing here');
assert.deepEqual(redactResult({ content: [{ type: 'text', text: 'the clinic' }, { type: 'image', data: 'x' }] }, words), { content: [{ type: 'text', text: `the ${PRIVATE_WORD}` }, { type: 'image', data: 'x' }] });
assert.equal(privateCount(0, 0), '');
assert.equal(privateCount(2, 1), `- Private: 2 to-dos or reminders and 1 note made in private mode; you never see their titles or text (shown as ${PRIVATE_WORD}).`);

// ---- lifting the mark: said, matched by code, then a yes
assert.deepEqual(liftAsk('Lift the private mark from the clinic call.'), { title: 'clinic call' });
assert.deepEqual(liftAsk('Make Call the clinic not private'), { title: 'call the clinic' });
assert.deepEqual(liftAsk('The clinic call is no longer private.'), { title: 'clinic call' });
assert.equal(liftAsk('Is the clinic call private?'), null);
assert.equal(liftQuestion('Call the clinic'), 'Lift the private mark from "Call the clinic"? Claude will see it from then on.');
assert.ok(privateNote('---\ncreated: 2026-11-26 10:00\nprivate: true\n---\n\nx\n'));
assert.ok(!privateNote('---\ncreated: x\n---\n\nprivate: true\n'), 'only in the front matter');
assert.equal(unmarkNote('---\ncreated: x\nprivate: true\n---\n\nbody private: true\n'), '---\ncreated: x\nprivate: false\n---\n\nbody private: true\n');

// ---- store.mjs: what is made while a private request runs carries the mark; it can be lifted
let priv = false;
setPrivateContext(() => priv);
const open = await addCommitment('Buy milk', null);
priv = true; const hidden = await addCommitment('Call the clinic', null, 'reminder'); priv = false;
assert.equal(open.private, undefined); assert.equal(hidden.private, true);
assert.equal(openCommitments().find((c) => c.id === hidden.id).private, true, 'kept in memory.json');
await setCommitmentPrivate(hidden.id, false);
assert.equal(openCommitments().find((c) => c.id === hidden.id).private, undefined, 'lifted');

// ---- notes.mjs: a note made in private mode carries the mark; Claude's calls never see it
const vault = path.join(home, 'Documents', 'roamies-vault');
let privNow = false; const made = [];
const notes = createNotes({ home, userName: 'Tiago', privateNow: () => privNow, onPrivate: (t) => made.push(t) });
const tool = (n) => notes.tools.find((t) => t.name === n);
await tool('write_note').execute({ title: 'Seminar', content: 'Bring the HDMI adapter.' });
privNow = true;
assert.equal(await tool('write_note').execute({ title: 'Clinic', content: 'Ask about the results.' }, { seePrivate: true }), 'Saved the note "Clinic" in the vault.');
assert.match(fs.readFileSync(path.join(vault, 'Clinic.md'), 'utf8'), /^---\ncreated: [^\n]+\nprivate: true\n---\n/); assert.deepEqual(made, ['Clinic']);
await assert.rejects(tool('write_note').execute({ title: 'Seminar', content: 'private words', append: true }, { seePrivate: true }), /isn't private: in private mode, save this as a new note/, 'private text never goes into a note Claude can read');
privNow = false;
// Claude's calls (no seePrivate): left out, with a count, or refused
assert.equal(await tool('search_notes').execute({ query: 'results' }), 'No note mentions "results".\n(1 private note not searched: made in private mode.)');
assert.match(await tool('search_notes').execute({ query: '' }), /^1 note\. Most recently changed:\n- Seminar \([^)]+\)\n\(1 private note not searched/);
await assert.rejects(tool('read_note').execute({ title: 'Clinic' }), /There's no note called "Clinic"/);
await assert.rejects(tool('write_note').execute({ title: 'Clinic', content: 'x', append: true }), /can't be added to from here/);
// the local route's calls see it
assert.match(await tool('search_notes').execute({ query: 'results' }, { seePrivate: true }), /- Clinic/);
assert.match(await tool('read_note').execute({ title: 'Clinic' }, { seePrivate: true }), /Ask about the results/);
// lifted: Claude sees it
fs.writeFileSync(path.join(vault, 'Clinic.md'), unmarkNote(fs.readFileSync(path.join(vault, 'Clinic.md'), 'utf8')));
assert.match(await tool('search_notes').execute({ query: 'results' }), /^- Clinic/);
// a daily note's lines from private exchanges (%%private%%): not there for Claude, there for the local route
fs.mkdirSync(path.join(vault, 'Daily'), { recursive: true });
fs.writeFileSync(path.join(vault, 'Daily', '2026-11-26.md'), '# Thursday\n### Private, summarised by the local model\n- Asked about the oncology results. %%private%%\n### Log\n- Met Bo about results.\n');
const found = await tool('search_notes').execute({ query: 'results' });
assert.doesNotMatch(found, /oncology/); assert.match(found, /Met Bo about results/);
assert.doesNotMatch(await tool('read_note').execute({ title: '2026-11-26' }), /oncology/);
assert.match(await tool('read_note').execute({ title: '2026-11-26' }, { seePrivate: true }), /oncology/);
fs.rmSync(home, { recursive: true, force: true });
console.log('privacy tests passed');
