// Local-only build, feature 18: the handover and the fresh conversation each day (handover.mjs, daily.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HANDOVER_HEAD, HANDOVER_WORDS, PART_TWO_LINES, createHandover, handoverInput, handoverMessage, handoverPrompt, isHandover, oneMoment, parsePartTwo, sameItem, saysDone } from '../handover.mjs';
import { Unanswered } from '../answers.mjs';
import { createDaily } from '../daily.mjs';
import { createTaskPages } from '../notes.mjs';
import { codeReference, readState } from '../pi.mjs';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'handover-home-')));
const vault = path.join(home, 'Documents', 'roamies-vault');
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
const words = (t) => t.split(/\s+/).filter(Boolean).length;

// ---- part two as the model writes it: three fixed headings, at most 8 lines, nothing else kept
const known = (id) => id === 'c7';
assert.deepEqual(parsePartTwo('Decided:\n- Submit the abstract on Friday.\nLeft open:\n- Ask Bo about the reagents [c7]\n- Pick a venue [c99]\nWorth remembering:\n- (none)', { known }), {
  decided: ['Submit the abstract on Friday.'], open: [{ text: 'Ask Bo about the reagents', todo: 'c7' }, { text: 'Pick a venue', todo: null }], remember: [],
}, 'a to-do id is kept only when it is one; an unknown one is taken off the line');
assert.deepEqual(parsePartTwo('Sure! Here it is.\n## **Decided:**\n* One.\n**Left open**\n1. [ ] Two.\n### Worth remembering:\n- Three.\nThat is all.'), { decided: ['One.'], open: [{ text: 'Two.', todo: null }], remember: ['Three.'] }, 'headings in Markdown, other list marks; text outside the lines is dropped');
const many = `Decided:\n${Array.from({ length: 6 }, (_, i) => `- D${i}`).join('\n')}\nLeft open:\n- O1\n- O2\n- O3\nWorth remembering:\n- W1`;
const p = parsePartTwo(many);
assert.equal(p.decided.length + p.open.length + p.remember.length, PART_TWO_LINES); assert.deepEqual(p.open.map((o) => o.text), ['O1', 'O2']); assert.deepEqual(p.remember, []);
assert.deepEqual(parsePartTwo('Decided:\n- The password is hunter2.\n- Card 4111 1111 1111 1111.\n- Fine.').decided, ['Fine.'], 'never a secret');
assert.equal(parsePartTwo(`Left open:\n- ${'x'.repeat(300)}`).open[0].text.length, 200);
assert.throws(() => parsePartTwo('Nothing to hand over today.'), /no headings/);

// ---- a new "Left open" line that is an open item already makes nothing
assert.ok(sameItem('Ask Bo about the reagents', 'ask Bo about reagents'));
assert.ok(sameItem('Decide on the venue for the retreat', 'Decide the retreat venue'));
assert.ok(sameItem('Email the committee', 'Email the committee about the extension'), 'all of one\'s words in the other');
assert.ok(!sameItem('Ask Bo about the reagents', 'Order the reagents'));
assert.ok(!sameItem('Book the room', 'Book the flights'));
assert.ok(!sameItem('Send Ana the signed travel form today', 'Send Ana the signed travel form tomorrow'), 'most words shared is not enough: kept as a new item');

// ---- the prompt and what goes with it: the ending conversation and the open items' text, nothing else
assert.match(handoverPrompt('Tiago'), /^You write the end-of-day handover for a conversation between Tiago/);
assert.match(handoverPrompt('Tiago'), /Decided:\nLeft open:\nWorth remembering:\n/); assert.match(handoverPrompt('Tiago'), /At most 8 lines/); assert.match(handoverPrompt('Tiago'), /Only new ones: leave out anything in the list of items already open/);
assert.equal(handoverInput({ turns: 'Tiago: hi', items: [{ text: 'Pick a venue' }] }), 'Items already open (don\'t repeat them):\n- Pick a venue\n\nConversation, oldest first:\nTiago: hi\n\nWrite the handover now.');
assert.match(handoverInput({ turns: 'x' }), /^Items already open \(don't repeat them\):\n\(none\)\n/);

// ---- the new conversation's first message: background, at most 300 words
assert.equal(handoverMessage({}), '', 'nothing to hand over: no message');
const msg = handoverMessage({ day: '2026-11-26', decided: ['Submit on Friday.'], remember: ['Bo is away next week.'], items: [{ id: 'oi-aaa111', text: 'Pick a venue', day: '2026-11-24' }] });
assert.equal(msg, `${HANDOVER_HEAD}\nFrom the conversation of Thursday 26 November.\nDecided:\n- Submit on Friday.\nWorth remembering:\n- Bo is away next week.\nStill open, oldest first (the id, then the item; item_dealt_with closes one):\n- oi-aaa111: Pick a venue (since Tuesday 24 November)`);
assert.ok(isHandover({ role: 'user', content: msg }) && !isHandover({ role: 'user', content: 'hello' }));
const long = handoverMessage({ day: '2026-11-26', decided: ['Short.'], items: Array.from({ length: 60 }, (_, i) => ({ id: `oi-${i}`, text: `Item number ${i} with a few more words in it`, day: '2026-11-20' })) });
assert.ok(words(long.slice(HANDOVER_HEAD.length)) <= HANDOVER_WORDS, `${words(long)} words`); assert.match(long, /\n- …and \d+ more, in the daily note\.$/); assert.match(long, /- oi-0: Item number 0/, 'oldest first');

// ---- "one moment", worded by code
assert.equal(oneMoment('2026-11-26', '2026-11-27'), 'One moment: I\'m wrapping up yesterday.');
assert.equal(oneMoment('2026-11-23', '2026-11-27'), 'One moment: I\'m wrapping up Monday 23 November.');

// ---- when the day turns: which conversation is handed over
let clock = at(26, 10);
const logs = [];
let n = 0;
const ho = createHandover({ home, now: () => clock, log: (k, d) => logs.push([k, d]), newId: () => `oi-t${++n}` });
const talk = (last, started = last) => ({ id: 's1', startedAt: started, lastActiveAt: last, messages: [{ role: 'user', content: 'hi' }] });
assert.equal(ho.needed(talk(at(26, 9))), null, 'the same day: nothing');
clock = at(27, 3, 30); assert.equal(ho.needed(talk(at(26, 22))), null, 'before calendar.dayTurnsAt (04:00) it is still the same day');
clock = at(27, 4, 5); assert.deepEqual(ho.needed(talk(at(26, 22))), { kind: 'talk', key: '2026-11-26', today: '2026-11-27' });
assert.deepEqual(ho.needed(talk(at(23, 15))), { kind: 'talk', key: '2026-11-23', today: '2026-11-27' }, 'after a gap of days: its last day');
assert.equal(ho.needed({ id: 's0', startedAt: at(26, 9), lastActiveAt: at(26, 9), messages: [] }), null, 'no conversation, nothing handed over yet: no request, no message');
assert.equal(ho.needed(null), null);
// part two has come: new open items, one that matches an open item makes nothing
const first = ho.finish('2026-11-26', { decided: ['Submit on Friday.'], open: [{ text: 'Pick a venue', todo: null }, { text: 'Ask Bo about the reagents', todo: 'c7' }, { text: 'pick the venue', todo: null }], remember: [] });
assert.deepEqual(ho.openItems(), [{ id: 'oi-t1', text: 'Pick a venue', day: '2026-11-26', todo: null, askedAt: null }, { id: 'oi-t2', text: 'Ask Bo about the reagents', day: '2026-11-26', todo: 'c7', askedAt: null }]);
assert.match(first, /\n- oi-t1: Pick a venue \(since Thursday 26 November\)\n- oi-t2: Ask Bo about the reagents/);
clock = at(28, 9);
ho.finish('2026-11-27', { decided: [], open: [{ text: 'Ask Bo about reagents', todo: null }, { text: 'Renew the parking permit', todo: null }], remember: ['Bo is away.'] });
assert.deepEqual(ho.openItems().map((i) => [i.id, i.day]), [['oi-t1', '2026-11-26'], ['oi-t2', '2026-11-26'], ['oi-t3', '2026-11-27']], 'carried by code, oldest first');
assert.deepEqual(logs.filter(([k]) => k === 'handover_items').map(([, d]) => d), [{ new: 2, matched: 1, open: 2 }, { new: 1, matched: 1, open: 3 }]);
// an empty conversation from an earlier day: a new one with the most recent handover, once a day
assert.equal(ho.needed({ id: 's2', startedAt: at(27, 22), lastActiveAt: at(27, 22), messages: [] }), null, 'given today already');
clock = at(29, 9);
assert.deepEqual(ho.needed({ id: 's2', startedAt: at(27, 22), lastActiveAt: at(27, 22), messages: [] }), { kind: 'quiet', today: '2026-11-29' });
assert.deepEqual(ho.needed({ id: 's3', startedAt: at(29, 8), lastActiveAt: at(29, 8), messages: [] }), null, 'started today (New conversation): left alone');
assert.match(ho.message(), /From the conversation of Friday 27 November\.\nWorth remembering:\n- Bo is away\.\nStill open.*\n- oi-t1: .*\n- oi-t2: .*\n- oi-t3: Renew the parking permit/s);
ho.given(); assert.equal(ho.needed({ id: 's2', startedAt: at(27, 22), lastActiveAt: at(27, 22), messages: [] }), null);
assert.deepEqual(ho.needed({ id: 's4', startedAt: at(28, 9), lastActiveAt: at(28, 9), messages: [{ role: 'user', content: msg }] }), null, 'only the handover message: no conversation');
// part one is written once per conversation and day
assert.equal(ho.partOneDone('s1', '2026-11-26'), false); ho.markPartOne('s1', '2026-11-26'); assert.equal(ho.partOneDone('s1', '2026-11-26'), true);
for (const [k, d] of logs) assert.ok(!/venue|reagents|parking|Bo/i.test(JSON.stringify(d)), `${k}: counts only`);

// ---- the two parts in the daily note (daily.mjs)
{
  let now2 = at(26, 8);
  const todos = [
    { id: 'c1', text: 'Send slides', kind: 'commitment', status: 'open', due: at(26, 17), doneAt: null, createdAt: at(20, 9) },
    { id: 'c2', text: 'Call Ana', kind: 'commitment', status: 'open', due: null, doneAt: null, createdAt: at(20, 9) },
    { id: 'c3', text: 'Old idea', kind: 'commitment', status: 'open', due: null, doneAt: null, createdAt: at(20, 9) },
    { id: 'r1', text: 'Stretch', kind: 'reminder', status: 'open', due: at(26, 11), doneAt: null, createdAt: at(20, 9) },
  ];
  const d = createDaily({ home, todos: () => todos.map((t) => ({ ...t })), now: () => now2 });
  const pages = createTaskPages({ home, todos: () => todos, now: () => now2 });
  d.tick(); // the list as it is: nothing has happened yet
  now2 = at(26, 10);
  todos.push({ id: 'c4', text: 'Book bench', kind: 'commitment', status: 'open', due: at(28, 9), doneAt: null, createdAt: at(26, 9, 30) });
  todos.push({ id: 'r2', text: 'Drink water', kind: 'reminder', status: 'open', due: at(26, 15), doneAt: null, createdAt: at(26, 9, 40) });
  todos[0].due = at(27, 12); // Send slides moved
  Object.assign(todos[1], { status: 'done', doneAt: at(26, 9, 50) });
  todos.splice(2, 1); // Old idea dropped
  d.tick();
  pages.make('c4'); // Book bench has a page
  now2 = at(27, 9, 12);
  assert.equal(d.handoverPartOne('2026-11-26', { pending: [{ kind: 'plan', brief: 'Put the plan for Friday on the calendar?', at: '2026-11-26T15:00:00.000Z' }], kept: [{ brief: 'Put "Book bench" on the calendar Saturday 28 November, 09:00 to 10:00' }], link: pages.link }), true);
  const note26 = fs.readFileSync(path.join(vault, 'Daily', '2026-11-26.md'), 'utf8');
  assert.ok(note26.includes('## Log\n- 09:50 Done: Call Ana\n'), 'done line');
  assert.equal(note26.slice(note26.indexOf('\n## Handover')), `\n## Handover (written Friday 27 November, 09:12)
### To-dos and reminders
- Changed: Send slides (due Friday 27 November, 12:00)
- Done: Call Ana
- Made: [[Tasks/Book bench|Book bench]] (due Saturday 28 November, 09:00)
- Made (reminder): Drink water (due Thursday 26 November, 15:00)
- Dropped: Old idea
### Questions still waiting
- Put the plan for Friday on the calendar? (asked 2026-11-26)
### Kept until Super Productivity is open
- Put "Book bench" on the calendar Saturday 28 November, 09:00 to 10:00
`, 'to-dos link to their task page when they have one');
  d.handoverPartTwo('2026-11-26', { decided: ['Submit on Friday.'], items: [{ id: 'oi-t1', text: 'Pick a venue', day: '2026-11-24' }, { id: 'oi-t9', text: 'Ask Bo', day: '2026-11-26' }], remember: [] });
  assert.ok(fs.readFileSync(path.join(vault, 'Daily', '2026-11-26.md'), 'utf8').endsWith(`- Put "Book bench" on the calendar Saturday 28 November, 09:00 to 10:00

### Decided
- Submit on Friday.
### Left open
- [ ] Pick a venue (since Tuesday 24 November) ^oi-t1
- [ ] Ask Bo (since Thursday 26 November) ^oi-t9
### Worth remembering
- Nothing.
`), fs.readFileSync(path.join(vault, 'Daily', '2026-11-26.md'), 'utf8').slice(-400));
  // a quiet day: one line
  d.handoverPartOne('2026-11-25', {});
  assert.equal(fs.readFileSync(path.join(vault, 'Daily', '2026-11-25.md'), 'utf8'), '---\ndate: 2026-11-25\n---\n\n# Wednesday 25 November 2026\n\n← [[2026-11-24]] · [[2026-11-26]] →\n\n## Handover (written Friday 27 November, 09:12)\n- Nothing changed on the list, no question is waiting, and no block is kept.\n', 'a day with no note yet gets one, without a Plan');
  assert.ok(!('snap' in (readState(path.join(home, 'Documents', 'roamies-pi')).daily.days['2026-11-26'] ?? {})), 'the list at the last check is kept once, not per day');
}

// ---- closing open items
for (const [said, want] of [
  ['I\'ve dealt with the venue', true], ['the venue is sorted', true], ['that\'s done', true], ['Done with the slides, thanks', true], ['the permit is no longer needed', true], ['close it', true],
  ['not done yet', false], ['I haven\'t finished it', false], ['is it done?', false], ['remind me tomorrow', false], ['we never sorted that out', false], ['', false],
]) assert.equal(saysDone(said), want, said);
{
  const home2 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'handover-items-')));
  const v2 = path.join(home2, 'Documents', 'roamies-vault', 'Daily');
  let now2 = at(20, 10), words2 = '', answer = null, k = 0;
  const lines = [], said = [], asked = [], logs2 = [];
  const h2 = createHandover({
    home: home2, userName: 'Tiago', now: () => now2, newId: () => `oi-x${++k}`, log: (kk, d) => logs2.push([kk, d]), note: (l) => lines.push(...l), heard: () => words2,
    ask: async (o) => { asked.push(o); if (answer === 'nobody') throw new Unanswered(); return answer; }, say: async (t) => { said.push(t); },
  });
  h2.finish('2026-11-19', { decided: [], remember: [], open: [{ text: 'Pick a venue', todo: null }, { text: 'Ask Bo about the reagents', todo: 'c7' }, { text: 'Renew the parking permit', todo: null }, { text: 'Read the review', todo: null }] });
  // its to-do is done
  assert.equal(h2.checkDone([{ id: 'c7', status: 'open' }]), 0);
  assert.equal(h2.checkDone([{ id: 'c7', status: 'done' }]), 1);
  assert.deepEqual(lines, ['- [x] 10:00 Closed: Ask Bo about the reagents (its to-do is done)']);
  assert.equal(h2.checkDone([{ id: 'c7', status: 'done' }]), 0, 'logged once');
  // ticked in a daily note in Obsidian; read every 5 minutes at most
  fs.mkdirSync(v2, { recursive: true });
  fs.writeFileSync(path.join(v2, '2026-11-19.md'), '### Left open\n- [x] Pick a venue (since Thursday 19 November) ^oi-x1\n- [ ] Renew the parking permit (since Thursday 19 November) ^oi-x3\n- [x] Something else ^oi-zzz\n');
  assert.equal(h2.checkTicks(), 1); assert.equal(lines.at(-1), '- [x] 10:00 Closed: Pick a venue (ticked in the note)');
  fs.writeFileSync(path.join(v2, '2026-11-20.md'), '- [X] Renew the parking permit (since Thursday 19 November) ^oi-x3\n');
  now2 = at(20, 10, 4); assert.equal(h2.checkTicks(), 0, 'not read again within 5 minutes');
  now2 = at(20, 10, 5); assert.equal(h2.checkTicks(), 1); assert.deepEqual(h2.openItems().map((i) => i.id), ['oi-x4']);
  h2.finish('2026-11-20', { decided: [], remember: [], open: [{ text: 'Book the train', todo: null }, { text: 'Call the bank', todo: null }] });
  // item_dealt_with: at once on the owner's own words, else a yes or no first; the app says which item it closed
  const tool = h2.tools[0];
  assert.equal(tool.name, 'item_dealt_with');
  await assert.rejects(tool.execute({ item: 'oi-nope' }), /There's no open item "oi-nope"/);
  words2 = 'I booked it, that\'s sorted';
  assert.equal(await tool.execute({ item: 'oi-x5' }), 'Closed "Book the train". The app has told Tiago which item it closed: don\'t repeat it.');
  assert.deepEqual(asked, [], 'their own words said so: no question'); assert.deepEqual(said, ['Closed: Book the train.']); assert.equal(lines.at(-1), '- [x] 10:05 Closed: Book the train (you said so)');
  words2 = 'what is still open?'; answer = null;
  assert.equal(await tool.execute({ item: 'oi-x6' }), 'They said to keep "Call the bank" open.'); assert.equal(asked.at(-1).placeholder, 'Close the open item "Call the bank"?'); assert.deepEqual(asked.at(-1).choices, ['Close it', 'Keep it']);
  answer = 'nobody';
  assert.equal(await tool.execute({ item: 'oi-x6' }), 'They gave no answer, so "Call the bank" stays open. Don\'t ask about it again now.');
  answer = 'yes';
  assert.equal(await tool.execute({ item: 'oi-x6' }), 'Closed "Call the bank". The app has told Tiago which item it closed: don\'t repeat it.'); assert.equal(lines.at(-1), '- [x] 10:05 Closed: Call the bank (you said yes)');
  assert.deepEqual(h2.openItems().map((i) => i.id), ['oi-x4']);
  // after limits.openItemAskDays (7), the evening review asks: keep it, or let it go
  h2.finish('2026-11-25', { decided: [], remember: [], open: [{ text: 'Write to Ana', todo: null }, { text: 'Sort the freezer', todo: null }] });
  now2 = at(25, 18, 30); assert.deepEqual(h2.stale(), [], 'six days: not yet');
  now2 = at(26, 18, 30); assert.deepEqual(h2.stale().map((i) => i.id), ['oi-x4']);
  const io = { ask: async (o) => { asked.push(o); const a = script.shift(); if (a === 'nobody') throw new Unanswered(); return typeof a === 'string' ? o.parse(a) : a ?? null; }, say: async (t) => { said.push(t); } };
  let script = ['keep it'];
  assert.deepEqual(await h2.askStale(io), { asked: 1, left: 0 });
  assert.equal(asked.at(-1).placeholder, '"Read the review" has been open since Thursday 19 November. Keep it open?'); assert.deepEqual(asked.at(-1).choices, ['Keep it', 'Let it go']);
  assert.deepEqual(h2.stale(), [], 'kept: not asked again for 7 days');
  now2 = at(33, 18, 30); script = ['banana', 'nobody'];
  assert.deepEqual(h2.stale().map((i) => i.id), ['oi-x4', 'oi-x7', 'oi-x8']);
  assert.equal(asked.at(-1).parse('banana'), null);
  script = ['nobody'];
  assert.deepEqual(await h2.askStale(io), { asked: 1, left: 2 }, 'no answer ends the round, and changes nothing');
  script = [{ kind: 'go' }, 'let it go', 'keep'];
  const before = said.length;
  assert.deepEqual(await h2.askStale(io), { asked: 3, left: 0 });
  assert.deepEqual(said.slice(before), ['I\'ve let go of "Read the review".', 'I\'ve let go of "Write to Ana".']);
  assert.deepEqual(lines.slice(-2), ['- [x] 18:30 Let go: Read the review', '- [x] 18:30 Let go: Write to Ana']);
  assert.deepEqual(h2.openItems().map((i) => i.id), ['oi-x8']);
  for (const [kk, d] of logs2) assert.ok(!/venue|reagents|parking|train|bank|review|ana|freezer/i.test(JSON.stringify(d)), `${kk}: counts only`);
  fs.rmSync(home2, { recursive: true, force: true });
}

// ---- the wiring (sidekick.mjs)
const side = fs.readFileSync(new URL('../sidekick.mjs', import.meta.url), 'utf8');
assert.match(side, /if \(!intro && !text\.startsWith\('\('\)\) dailyDo\('plan', \(\) => daily\.ensure\(\)\);/, 'the first request of the day, typed or spoken, writes the Plan');
assert.match(side, /let problem = await readyAgent\(\);\n\s*if \(!problem && !intro && await dayTurn\(byVoice\)\) problem = await readyAgent\(\);/, 'every request first checks whether the day has turned');
assert.match(side, /text: handoverInput\(\{ turns: transcript\(old\.messages\.filter\(\(m\) => !isHandover\(m\)\), userName, stripNote\), items: handover\.openItems\(\) \}\)/, 'part two is given the ending conversation and the open items\' text, nothing else');
assert.match(side, /signal: AbortSignal\.timeout\(PART_TWO_SECONDS \* 1000\)/);
assert.match(side, /logLine\('handover_failed'[^\n]*\n\s*return false;/, 'part two failed: the old conversation carries on');
assert.match(side, /freshSession\('day'\);\n\s*if \(msg\) session\.messages = \[\{ role: 'user', content: msg \}\];/, 'the new conversation starts with the handover; the old one gets the memory pass');
assert.match(side, /!isSummary\(m\) && !isHandover\(m\)/, 'the memory pass skips the handover message');
assert.ok(!/handoverPartOne[^\n]*session\.messages|content: [^\n]*handoverPartOne/.test(side), 'part one never goes into the conversation');
assert.match(side, /\.\.\.flow\.tools, \.\.\.handover\.tools\]/, 'item_dealt_with is one of the tools');
for (const n of ['item_dealt_with', 'link_note', 'notes_for']) assert.ok(codeReference().tools.allowedWhilePiWorks.includes(n), `${n} works while pi is busy, like the notes`);
assert.match(side, /ownWords = intro \|\| text\.startsWith\('\('\) \? '' : text;/, 'the owner\'s own words: never a note from the app');
assert.match(side, /handover\.checkDone\(todoItems\(\)\); handover\.checkTicks\(\); notes\.pages\.renames\(\);/);
assert.match(side, /await dailyAsk\('review'\);\n\s*await inSeries\('items', \(\) => handover\.askStale\(dailyIO\)\);/, 'the evening review asks about the old open items after the missed to-dos');

fs.rmSync(home, { recursive: true, force: true });
console.log('handover tests: passed');
