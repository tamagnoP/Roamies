// Local-only build, feature 34: masking (mask.mjs). The matching rules, with the everyday sentences that must come out
// unchanged next to the ones that must be masked (LESSONS.md); stand-ins that never change and are never reused; case
// both ways; "Person 1" against "Person 12"; round trips; the reply as it streams, split at every character; the
// list's checks; messages as sent and as kept; the web search check. Run: node test/mask.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GROUPS, LABELS, MASK_NOTE, WEB_OFF, assignNumbers, cleanMask, createMasker, everydayForms, everydayLine, isWebAsk, keyOf, listedCount, maskMessage, textKey, unmaskMessage } from '../mask.mjs';

const make = (raw, table = {}) => { const { entries, problems } = cleanMask(raw); const n = assignNumbers(entries, table); return { m: createMasker(entries, n.table), table: n.table, entries, problems }; };
const LIST = {
  people: ['Maria Silva', { name: 'João Costa', also: ['João', 'Dr Costa'] }, { name: 'Will', exactCase: true }, 'Ana', { name: 'Mark', exactCase: true }],
  organisations: ['Acme Labs', { name: 'Max Planck Institute', exactCase: true }, 'Max'],
  projects: ['Atlas', 'Halyard'],
  other: ['Zorbinite'],
};
const { m, table } = make(LIST);

// ---- the groups and the labels the owner chose (answer 6)
assert.deepEqual(GROUPS, ['people', 'organisations', 'projects', 'other']);
assert.deepEqual(LABELS, { people: 'Person', organisations: 'Organisation', projects: 'Project', other: 'Term' });
assert.equal(m.active, true); assert.equal(m.size, 11); assert.equal(m.note, MASK_NOTE);

// ---- what must be masked
const outs = [
  ['Maria Silva said hi', 'Person 1 said hi'],
  ['ask maria silva', 'ask person 1'],
  ['MARIA SILVA', 'PERSON 1'],
  ['Maria\nSilva and Maria  Silva and Maria-Silva', 'Person 1 and Person 1 and Person 1'],
  ['Jose and José and JOSÉ? no: João, Joao and Dr Costa', 'Jose and José and JOSÉ? no: Person 2, Person 2 and Person 2'],
  ['Ana, AnaNotes, ana_notes, ana2026, 2026ana, myAna, ana.txt, ~/ana/', 'Person 4, Person 4Notes, person 4_notes, person 4#2026, 2026person 4, myPerson 4, person 4.txt, ~/person 4/'],
  ["Ana's, Ana’s, Anas, the Atlases, the Silvas' house", "Person 4's, Person 4’s, Person 4s, the Project 1es, the Silvas' house"],
  ['Acme Labs, acme-labs, ACME LABS, acme labs.', 'Organisation 1, organisation 1, ORGANISATION 1, organisation 1.'],
  ['the Max Planck Institute and max planck institute', 'the Organisation 2 and organisation 3 planck institute'],
  ['Will is here. mark it, will you?', 'Person 3 is here. mark it, will you?'],
  ['Mark it.', 'Person 5 it.'], // the limit said plainly: an exact-case word at the start of a sentence is still as written
  ['~/Projects/atlas-pipeline/run.py and Halyard_v2', '~/Projects/project 1-pipeline/run.py and Project 2_v2'],
  ['zorbinite crystals', 'term 1 crystals'],
];
for (const [t, want] of outs) assert.equal(m.out(t), want, t);
// text in decomposed form (as macOS gives file names): the accents are marks of their own, and still don't count
assert.equal(m.out('~/Docs/Joa\u0303o/notes and Jose\u0301'), '~/Docs/Person 2/notes and Jose\u0301');
assert.equal(m.back(m.out('Joa\u0303o said')), 'Joa\u0303o said', 'and come back as they went');

// ---- what must come out unchanged (LESSONS.md: the everyday sentences next to the rule)
for (const t of ['banana', 'analysis', 'Canada and Anaheim', 'ANALYSIS', 'mark it as done', 'will you call me?', 'the market', 'maximum', 'Maxwell', 'atlassian', 'acmethesis', 'a project', 'my project 7 plan has no number in use', 'Termite', 'personal', 'organisational']) {
  assert.equal(m.out(t), t, t);
}
assert.equal(m.out(''), ''); assert.equal(m.out(null), null); assert.equal(m.out(42), 42);
// text that already looks like a stand-in in use is sent spelled out; one that isn't in use goes as it is
assert.equal(m.out('Term 1 starts in January; Person 9 is not in use; Project 2.'), 'Term one starts in January; Person 9 is not in use; Project two.');
assert.equal(m.back(m.out('Term 1 starts')), 'Term one starts', 'and stays spelled out, never turned into a word');

// ---- back: whole stand-ins only, in any case, "#" allowed; "Person 12" is not "Person 1"
const fresh = make(LIST).m; // one that has sent nothing yet: the main form, in the stand-in's case
assert.equal(fresh.back('Person 1, person 1, PERSON 1, Person #1, Person1'), 'Maria Silva, maria silva, MARIA SILVA, Maria Silva, Maria Silva');
assert.equal(fresh.back('Person 12 and Person 10 and Persons 1'), 'Person 12 and Person 10 and Persons 1');
assert.equal(fresh.back('Organization 1 (spelled the American way)'), 'Acme Labs (spelled the American way)');
assert.equal(fresh.back('Person 1\'s file, Project 1es'), 'Maria Silva\'s file, Atlases');
assert.equal(fresh.back('XPerson 1, myPerson 1 and Person 1x'), 'XPerson 1, myMaria Silva and Maria Silvax', 'a letter before is no edge unless lower to upper; after, a suffix stays');
// coming back, a stand-in is the form last sent for it (a folder name round-trips as written)
assert.equal(m.back(m.out('~/Projects/atlas-pipeline/ and Dr Costa')), '~/Projects/atlas-pipeline/ and Dr Costa');
const u = {}; assert.equal(m.back('Ask Person 2 about Project 1.', u), 'Ask Dr Costa about Atlas.'); assert.deepEqual(u, { swapsBack: 2 });
// round trips over mixed texts
for (const t of ['Maria Silva met João Costa at Acme Labs about Atlas.', "ANA'S notes on ~/Projects/Halyard_v2/ana2026.csv", 'Will said: zorbinite, ZORBINITE, Zorbinite.', 'the Max Planck Institute (MPI) and Max']) {
  const k = make(LIST).m;
  assert.equal(k.back(k.out(t)), t, t);
}
// counting
const c = {}; m.out('Maria Silva and Ana and banana', c); assert.deepEqual(c, { swaps: 2 });
assert.equal(m.count('Maria Silva, Ana, Atlas, banana'), 3); assert.equal(m.standIns('Person 1 and Person 9 and Project 1'), 2);
assert.equal(m.leftovers('Person 7 and Person One said'), 2, 'shaped like a stand-in, matching none');
assert.equal(listedCount('Ask Zorbina Quell about the Halyard data and halyard notes', cleanMask({ people: ['Zorbina Quell'], projects: ['Halyard'] }).entries), 3);
assert.equal(listedCount('anything', []), 0);

// ---- the reply as it streams: split at every position, the same as all at once
{
  const reply = 'Tell Person 1 and Project 1es about Organisation 1, person 12, PERSON 2 and project 2#3 (Project two). Person';
  const whole = make(LIST).m.back(reply);
  for (let i = 0; i <= reply.length; i++) for (const j of [i, Math.min(reply.length, i + 3)]) {
    const k = make(LIST).m, s = k.stream({});
    const got = s.push(reply.slice(0, i)) + s.push(reply.slice(i, j)) + s.push(reply.slice(j)) + s.flush();
    assert.equal(got, whole, `split at ${i}, ${j}`);
  }
  const k = make(LIST).m, s = k.stream({}); let got = '';
  for (const ch of reply) got += s.push(ch);
  assert.equal(got + s.flush(), whole, 'one character at a time');
  assert.equal(whole, 'Tell Maria Silva and Atlases about Acme Labs, person 12, JOÃO COSTA and halyard3 (Project two). Person');
  const held = make(LIST).m.stream({}); assert.equal(held.push('Ask Pers'), 'Ask '); assert.equal(held.push('on 1 now'), 'Maria Silva now');
  const use = {}; const s2 = make(LIST).m.stream(use); s2.push('Person 1 and Person 2'); s2.flush(); assert.equal(use.swapsBack, 2);
}

// ---- stand-ins never change and are never reused (state.json "masks")
{
  const a = assignNumbers(cleanMask({ people: ['Ana', 'Bea'], projects: ['Atlas'] }).entries, {});
  assert.deepEqual(a.table, { people: { ana: 1, bea: 2 }, organisations: {}, projects: { atlas: 1 }, other: {} }); assert.equal(a.changed, true);
  const same = assignNumbers(cleanMask({ people: ['Bea', 'Ana'], projects: ['Atlas'] }).entries, a.table);
  assert.equal(same.changed, false, 'reordered: nothing new'); assert.deepEqual(same.table, a.table);
  const removed = assignNumbers(cleanMask({ people: ['Bea'] }).entries, a.table);
  assert.equal(removed.table.people.ana, 1, 'removed: the number stays the word\'s');
  const added = assignNumbers(cleanMask({ people: ['Bea', 'Cai'] }).entries, removed.table);
  assert.equal(added.table.people.cai, 3, 'a new word never gets a number another word had');
  const back = assignNumbers(cleanMask({ people: ['Ana', 'Cai'] }).entries, added.table);
  assert.equal(back.table.people.ana, 1, 'listed again: its old number');
  const moved = assignNumbers(cleanMask({ organisations: ['Ana'] }).entries, back.table);
  assert.equal(moved.table.organisations.ana, 1, 'moved: a stand-in from its new group'); assert.equal(moved.table.people.ana, 1);
  const fixed = assignNumbers(cleanMask({ people: ['Anna'] }).entries, back.table);
  assert.equal(fixed.table.people.anna, 4, 'a spelling fix is a new word');
  const mk = createMasker(cleanMask({ people: ['Bea', 'Cai'] }).entries, added.table);
  assert.equal(mk.out('Bea and Cai'), 'Person 2 and Person 3'); assert.equal(mk.back('Person 1'), 'Person 1', 'a number no longer listed is left alone');
  assert.notEqual(mk.sig, createMasker(cleanMask({ people: ['Bea'] }).entries, added.table).sig, 'a changed list changes the signature');
  assert.equal(mk.sig, createMasker(cleanMask({ people: ['Cai', 'Bea'] }).entries, added.table).sig, 'reordering does not');
  assert.equal(keyOf('  José   Costa '), 'jose costa');
}

// ---- off, or empty: nothing is swapped
{
  const off = createMasker(cleanMask(LIST).entries, table, { on: false });
  assert.equal(off.active, false); assert.equal(off.sig, ''); assert.equal(off.out('Maria Silva'), 'Maria Silva'); assert.equal(off.back('Person 1'), 'Person 1'); assert.equal(off.note, '');
  const none = createMasker(); assert.equal(none.active, false); assert.equal(none.stream({}).push('Person 1'), 'Person 1');
}

// ---- the list's checks (the start-up bubble names what can't be used)
{
  const r = cleanMask({ people: ['A', 'Ana', 'ana', 42, '  ', 'Say "hi"', 'Project', 'Person 3', '2026', { name: 'Bea', also: ['B', 'Ana', 'Beatriz'], exactCase: 'yes' }], teams: ['X'], projects: 'Atlas', other: [{ name: 'Lyra', also: 'Ly' }] });
  assert.deepEqual(r.entries.map((e) => [e.group, e.name, e.forms, e.exactCase]), [['people', 'Ana', ['Ana'], false], ['people', 'Bea', ['Bea', 'Beatriz'], false], ['other', 'Lyra', ['Lyra'], false]]);
  const p = r.problems.join('\n');
  for (const w of ['group I don\'t know, "teams"', '"A" is under 2 characters', '"ana" is already listed', 'an entry isn\'t text', 'has no letter', 'a quotation mark', '"Project" is a stand-in\'s own word', '"Person 3" is a stand-in\'s own word', '"exactCase" of "Bea" should be true or false', '"B" (also of "Bea") is under 2 characters', '"Ana" (also of "Bea") is already listed', 'mask.projects should be a list', '"also" of "Lyra" should be a list']) assert.ok(p.includes(w), w);
  assert.deepEqual(cleanMask(undefined), { entries: [], problems: [] });
  assert.match(cleanMask(['Ana']).problems[0], /should be an object/);
  const many = cleanMask({ people: Array.from({ length: 7 }, (_, i) => `Name${String.fromCharCode(97 + i)}`) }, { maxEntries: 5 });
  assert.equal(many.entries.length, 5); assert.match(many.problems.at(-1), /more than 5 entries \(limits\.maskEntries\); the first 5 are used/);
  assert.match(cleanMask({ people: ['Ana'], organisations: ['ana'] }).problems[0], /"ana" is already listed under people; the first is used/);
}

// ---- everyday words (macOS's word list): single words, exactCase off, in the list as a lower-case word
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mask-words-')), file = path.join(dir, 'words');
  fs.writeFileSync(file, 'Mark\nmark\nwill\natlas\nMaria\nrose\n');
  const { entries } = cleanMask({ people: ['Maria', { name: 'Mark' }, { name: 'Will', exactCase: true }, 'Rose Tyler'], projects: ['Atlas'] });
  assert.deepEqual(everydayForms(entries, file), ['Mark', 'Atlas']);
  assert.deepEqual(everydayForms(entries, path.join(dir, 'none')), [], 'no word list (Windows, Linux without one): no warning');
  assert.equal(everydayLine(['Mark', 'Atlas']), 'On your masking list, "Mark", "Atlas" are also everyday words, so they are swapped in any case wherever they appear. To match one only as written, give it "exactCase": true.');
  assert.equal(everydayLine([]), '');
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---- messages: as the provider gets them, and as they are kept on the Mac
{
  const k = make(LIST).m, use = {};
  const user = { role: 'user', content: [{ type: 'text', text: '[Fri] Ask Maria Silva' }, { type: 'image', mediaType: 'image/png', data: 'Maria Silva' }] };
  const sent = maskMessage(user, k, { use });
  assert.deepEqual(sent.content, [{ type: 'text', text: '[Fri] Ask Person 1' }, { type: 'image', mediaType: 'image/png', data: 'Maria Silva' }], 'pictures pass as they are');
  assert.equal(use.swaps, 1);
  const asst = { role: 'assistant', content: [{ type: 'thinking', text: 'Person 1 …', signature: 'sig' }, { type: 'text', text: 'Noting Atlas.' }, { type: 'tool_call', id: 't1', name: 'write_note', args: { title: 'Atlas and Ana', tags: ['Ana'] } }] };
  const ma = maskMessage(asst, k);
  assert.deepEqual(ma.content, [{ type: 'thinking', text: 'Person 1 …', signature: 'sig' }, { type: 'text', text: 'Noting Project 1.' }, { type: 'tool_call', id: 't1', name: 'write_note', args: { title: 'Project 1 and Person 4', tags: ['Person 4'] } }]);
  assert.deepEqual(maskMessage(asst, k, { dropThinking: true }).content.map((p) => p.type), ['text', 'tool_call'], 'reasoning made under another list is dropped');
  const tool = { role: 'tool', content: [{ type: 'tool_result', toolCallId: 't1', content: 'Saved "Atlas and Ana".' }, { type: 'tool_result', toolCallId: 't2', content: [{ type: 'text', text: 'Ana' }, { type: 'image', data: 'x', mediaType: 'image/png' }] }] };
  assert.deepEqual(maskMessage(tool, k).content, [{ type: 'tool_result', toolCallId: 't1', content: 'Saved "Project 1 and Person 4".' }, { type: 'tool_result', toolCallId: 't2', content: [{ type: 'text', text: 'Person 4' }, { type: 'image', data: 'x', mediaType: 'image/png' }] }]);
  // kept: his own message as he made it (by its masked text); the rest with the words back; reasoning as it came
  const plain = new Map([[textKey(sent.content), user.content]]);
  assert.deepEqual(unmaskMessage(sent, k, plain), user);
  assert.deepEqual(unmaskMessage(ma, k), asst);
  assert.deepEqual(unmaskMessage(maskMessage(tool, k), k), tool);
  assert.deepEqual(unmaskMessage({ role: 'user', content: 'Person 1 typed this' }, k), { role: 'user', content: 'Maria Silva typed this' }, 'one not on record: the words back');
  const off = createMasker();
  assert.equal(maskMessage(user, off), user); assert.equal(unmaskMessage(user, off), user);
}

// ---- web search asked for (answer 3): the everyday sentences that must not count
for (const t of ['search the web for the Zorbinite paper', 'Look it up online', 'look up the weather online', 'google the train times', 'Please google it', 'find a recipe on the internet', 'do a web search for cheap flights', 'Search online for Atlas', 'check on Google whether it opens today']) assert.ok(isWebAsk(t), t);
for (const t of ['search my notes for web design', 'find the file budget', "what's on the web page in front?", 'open the web app', 'search the files for internet', 'is the internet down?', 'find the form on the web page', 'look up Ana in my notes', 'I was online all day', 'check the web version of the doc']) assert.ok(!isWebAsk(t), t);
assert.match(WEB_OFF, /^Web search is off while your masking list has words in it, so nothing was searched or sent\.$/);

// ---- what it costs: a long conversation, masked and back
{
  const k = make(LIST).m, chunk = 'Maria Silva asked about the Atlas pipeline at Acme Labs; the analysis of banana data is in ~/Projects/atlas-pipeline/ana2026.csv. ';
  const text = chunk.repeat(Math.ceil(480_000 / chunk.length));
  const t0 = process.hrtime.bigint(); const o = k.out(text); const t1 = process.hrtime.bigint(); const b = k.back(o); const t2 = process.hrtime.bigint();
  assert.equal(b, text);
  const ms = (a, z) => Number(z - a) / 1e6;
  assert.ok(ms(t0, t1) < 2000 && ms(t1, t2) < 2000, `masking ${text.length} characters took ${ms(t0, t1)} ms out and ${ms(t1, t2)} ms back`);
}

console.log('masking tests passed');
