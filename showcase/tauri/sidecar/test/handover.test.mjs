// Local-only build, feature 18: the handover and the fresh conversation each day (handover.mjs, daily.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HANDOVER_HEAD, HANDOVER_WORDS, PART_TWO_LINES, createHandover, handoverInput, handoverMessage, handoverPrompt, isHandover, oneMoment, parsePartTwo, sameItem } from '../handover.mjs';
import { createDaily } from '../daily.mjs';
import { createTaskPages } from '../notes.mjs';
import { readState } from '../pi.mjs';

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

fs.rmSync(home, { recursive: true, force: true });
console.log('handover tests: passed');
