// The word decides the kind: "to-do" or "task" makes a commitment, "remind me" a reminder, and "make that a to-do"
// turns a reminder into a commitment. The rule is in the two tools' descriptions (KIND_RULE, calendar.mjs); the
// conversion is code. Real store and real tools against a throwaway HOME, Super Productivity closed. Run: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'roamies-kind-test-'));
process.env.HOME = TMP; process.env.USERPROFILE = TMP; delete process.env.ROAMIES_DATA_DIR;
process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));
const S = await import('../store.mjs');
assert.ok(S.DIR.startsWith(TMP), 'store must live under the test HOME: ' + S.DIR);
const { resolveToolSchema } = await import('@kenkaiiii/gg-ai');
const { createTools } = await import('../tools.mjs');
const { createCalendar, KIND_RULE } = await import('../calendar.mjs');

const noop = async () => {};
const all = () => S.openCommitments().map((c) => ({ id: c.id, text: c.text, due: c.due ?? null, status: 'open', kind: c.kind ?? 'commitment' }));
const todos = { all, update: async (id, ch) => { await S.updateCommitment(id, ch); }, rename: async (id, text) => { await S.renameCommitment(id, text); }, add: async (text) => S.addCommitment(text, null, 'commitment'), commit: async (id) => { await S.makeCommitment(id); } };
const cal = createCalendar({ home: TMP, todos, port: 1, tokenFile: path.join(TMP, 'no-token') });
const changed = [];
const { tools: raw } = createTools({ allowActions: false, ui: () => {}, ask: async () => false, openUrl: noop, onCommitments: (c) => changed.push(c.id), showList: noop, fmtWhen: (ms) => new Date(ms).toISOString(), commitmentsText: () => '', userName: 'Test' });
const tools = cal.wrap(raw), T = (n) => tools.find((t) => t.name === n);
const remember = T('remember_commitment'), update = T('update_commitment');
const saved = () => JSON.parse(fs.readFileSync(path.join(S.DIR, 'memory.json'), 'utf8')).commitments; // what is on disk
const stored = (id) => saved().find((c) => c.id === id);
const idOf = (said) => /^Saved as (c\w+)/.exec(said)[1];

// the rule is what the model reads
assert.equal(remember.description, KIND_RULE.remember); assert.equal(update.description, KIND_RULE.update);
assert.match(remember.description, /The word they use decides the kind, and nothing else does\./);
assert.match(remember.description, /"To-do" or "task" .* is kind 'commitment', even when its time is only minutes away\./);
assert.match(remember.description, /"Remind me" is kind 'reminder'\./);
assert.match(remember.description, /Never choose the kind by how soon it is due\./);
assert.match(update.description, /"make that a to-do" or "make that a task" about a reminder, call this with its id and kind 'commitment'/);
assert.match(update.description, /Never save it a second time with remember_commitment/);
assert.doesNotMatch(raw.find((t) => t.name === 'remember_commitment').description, /The word they use/, 'tools.mjs is as upstream wrote it');

// the schema: update_commitment takes kind, and only "commitment"
assert.deepEqual(resolveToolSchema(update).properties.kind.enum, ['commitment']);
assert.equal(update.parameters.safeParse({ id: 'c1', kind: 'commitment' }).success, true);
assert.equal(update.parameters.safeParse({ id: 'c1', kind: 'reminder' }).success, false, 'a to-do is not turned back into a reminder');
assert.equal(update.parameters.safeParse({ id: 'c1', status: 'done' }).success, true);

// a task with a time minutes away is kept as the kind it was given: the time changes nothing
const soon = idOf(await remember.execute({ text: 'Send the abstract', due: 'in 5m', kind: 'commitment' }));
assert.equal(stored(soon).kind, 'commitment'); assert.ok(stored(soon).due > Date.now());
const rem = idOf(await remember.execute({ text: 'Call Ana', due: 'in 5m', kind: 'reminder' }));
assert.equal(stored(rem).kind, 'reminder');
const due = stored(rem).due, count = saved().length;

// an update without kind leaves a reminder a reminder
assert.doesNotMatch(await update.execute({ id: rem, due: 'in 6m' }), /to-do now/);
assert.equal(stored(rem).kind, 'reminder'); const due2 = stored(rem).due; assert.ok(due2 > due);

// "make that a to-do": the same entry, with its text and its time, of kind commitment
changed.length = 0;
const said = await update.execute({ id: rem, kind: 'commitment' });
assert.match(said, new RegExp(`^${rem} is now open, due .*\\. It is a to-do now, not a reminder: it stays open until they say it is done\\.$`));
assert.equal(saved().length, count, 'no second entry');
assert.deepEqual({ ...stored(rem) }, { ...stored(rem), id: rem, text: 'Call Ana', due: due2, status: 'open', kind: 'commitment', remindedAt: null });
assert.deepEqual(changed, [rem], 'the list and the calendar are told, so Super Productivity gets its task');
assert.equal(all().find((t) => t.id === rem).kind, 'commitment');

// it is nudged at its time and then stays open; a reminder is done once it has fired
const plain = idOf(await remember.execute({ text: 'Stretch', due: 'in 5m', kind: 'reminder' }));
const fired = await S.takeDueReminders(Math.max(due2, stored(plain).due) + 1000);
assert.deepEqual(fired.map((c) => c.id).sort(), [soon, rem, plain].sort());
assert.equal(stored(rem).status, 'open'); assert.equal(stored(soon).status, 'open'); assert.equal(stored(plain).status, 'done');

// with a time or a status in the same call
const both = idOf(await remember.execute({ text: 'Water the plants', due: 'in 10m', kind: 'reminder' }));
assert.match(await update.execute({ id: both, kind: 'commitment', due: 'none' }), new RegExp(`^${both} is now open\\. It is a to-do now`));
assert.equal(stored(both).kind, 'commitment'); assert.equal(stored(both).due, null);

// already a to-do: said, and nothing changes; an id that isn't there is upstream's error
assert.match(await update.execute({ id: soon, kind: 'commitment' }), /It already was a to-do\.$/);
assert.equal(stored(soon).kind, 'commitment');
await assert.rejects(update.execute({ id: 'c-none', kind: 'commitment' }), /No commitment with id c-none/);

console.log('kind tests: passed');
