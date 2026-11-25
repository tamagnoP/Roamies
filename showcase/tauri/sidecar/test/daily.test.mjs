// Local-only build, feature 18: the daily note (daily.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WHEN_HINT, createDaily, dayWindow, isReviewAsk, noteDay, parseWhen, timeOn } from '../daily.mjs';
import { SECOND, createAnswers } from '../answers.mjs';
import { createFlow } from '../flow.mjs';
import { loadSettings, readState } from '../pi.mjs';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'daily-home-')));
const dir = path.join(home, 'Documents', 'roamies-pi'), settingsFile = path.join(dir, 'settings.json');
const vault = path.join(home, 'Documents', 'roamies-vault');
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
let clock = at(26, 8);
const todos = [
  { id: 'a', text: 'Write methods', kind: 'commitment', status: 'open', due: null, doneAt: null },
  { id: 'b', text: 'Send slides', kind: 'commitment', status: 'open', due: at(26, 17), doneAt: null },
  { id: 'c', text: 'Call Ana', kind: 'commitment', status: 'open', due: at(26, 20), doneAt: null },
  { id: 'd', text: 'Book room D', kind: 'commitment', status: 'open', due: null, doneAt: null },
  { id: 'e', text: 'Grant report', kind: 'commitment', status: 'open', due: at(28, 18), doneAt: null },
  { id: 'r', text: 'Stretch', kind: 'reminder', status: 'open', due: at(26, 11), doneAt: null },
  { id: 'f', text: 'Old done', kind: 'commitment', status: 'done', due: at(25, 9), doneAt: at(25, 9) },
  { id: 'g', text: 'Someday', kind: 'commitment', status: 'open', due: null, doneAt: null },
  { id: 'h', text: 'Far deadline', kind: 'commitment', status: 'open', due: at(26, 9) + 20 * 864e5, doneAt: null },
];
const blocks = { a: { start: at(26, 9), minutes: 60, kept: false }, d: { start: at(24, 14), minutes: 30, kept: false } };
const logs = [];
const daily = createDaily({ home, userName: 'Tiago', todos: () => todos.map((t) => ({ ...t })), blocks: () => ({ ...blocks }), log: (k, d) => logs.push([k, d]), now: () => clock });
const note = (key = '2026-11-26') => fs.readFileSync(path.join(vault, 'Daily', `${key}.md`), 'utf8');
const finish = (id, when) => { const t = todos.find((x) => x.id === id); t.status = 'done'; t.doneAt = when; if (blocks[id]) delete blocks[id]; }; // a finished to-do loses its block on the calendar side

// ---- the day turns at calendar.dayTurnsAt (04:00 by default), not at midnight
const s0 = loadSettings(home);
assert.equal(s0.calendar.dayTurnsAt, 240); assert.equal(s0.calendar.reviewAt, 1080); assert.equal(s0.dailyFolder, 'Daily');
assert.equal(noteDay(at(27, 3, 59), 240).getDate(), 26, 'before the turn it is still the day before');
assert.equal(noteDay(at(27, 4), 240).getDate(), 27);
assert.deepEqual(dayWindow(new Date(2026, 10, 26), 240), { from: at(26, 4), until: at(27, 4) });
assert.deepEqual(timeOn({ due: null }, { start: at(26, 9), minutes: 30 }, dayWindow(new Date(2026, 10, 26), 240)), { at: at(26, 9), end: at(26, 9, 30), block: { start: at(26, 9), minutes: 30 } });

// ---- nothing is written before something has to be
assert.equal(daily.tick(), 0);
assert.ok(!fs.existsSync(path.join(vault, 'Daily', '2026-11-26.md')), 'a check with nothing to log writes nothing');
daily.ensure(); // the morning briefing
const plan = `---
date: 2026-11-26
---

# Thursday 26 November 2026

← [[2026-11-25]] · [[2026-11-27]] →

## Plan
- 09:00 to 10:00 Write methods
- Send slides (due 17:00)
- Call Ana (due 20:00)

### Needs a new time
- Book room D (was Tuesday 24 November, 14:00)

### Coming up
- Saturday 28 November: Grant report (due 18:00)
`;
assert.equal(note(), plan);
assert.ok(!note().includes('Stretch') && !note().includes('Someday') && !note().includes('Old done') && !note().includes('Far deadline'), 'reminders, to-dos with no time, earlier days and far deadlines are not in it');
daily.ensure(); daily.tick();
assert.equal(note(), plan, 'written once a day');
assert.deepEqual(logs.filter(([k]) => k === 'daily_plan'), [['daily_plan', { planned: 3, needs: 1, coming: 1 }]]);

// ---- the Log: Done lines, whoever finished it, and Note lines
clock = at(26, 10, 5); finish('a', at(26, 10, 2));
assert.equal(daily.tick(), 1);
assert.ok(note().endsWith('### Coming up\n- Saturday 28 November: Grant report (due 18:00)\n\n## Log\n- 10:02 Done: Write methods\n'));
assert.equal(daily.tick(), 0, 'one line for each');
clock = at(26, 11, 5); daily.noted('Cellpose thresholds');
assert.ok(note().endsWith('## Log\n- 10:02 Done: Write methods\n- 11:05 Note: [[Cellpose thresholds]]\n'), 'under the same Log heading');
finish('r', at(26, 11)); assert.equal(daily.tick(), 0, 'a reminder never gets a line');
// What is typed in Obsidian stays; the next line starts on a line of its own.
fs.appendFileSync(path.join(vault, 'Daily', '2026-11-26.md'), 'typed in Obsidian');
clock = at(26, 12); finish('g', at(26, 11, 59)); daily.tick();
assert.ok(note().endsWith('- 11:05 Note: [[Cellpose thresholds]]\ntyped in Obsidian\n- 11:59 Done: Someday\n'));
assert.ok(note().startsWith(plan), 'nothing above is ever changed');

// ---- the review: by the clock at calendar.reviewAt, or when asked
clock = at(26, 17, 59); assert.equal(daily.reviewDue(), false);
clock = at(26, 18); assert.equal(daily.reviewDue(), true);
clock = at(26, 18, 30);
const r = daily.review({ by: 'time' });
assert.equal(r.line, 'Day review: 1 of 3 planned to-dos done, 1 missed, 1 still open. It\'s in today\'s note.');
assert.deepEqual(r.missed.map((m) => m.id), ['b']);
assert.ok(note().endsWith(`- 11:59 Done: Someday

## Review (18:30)
- Done: Write methods
- Missed: Send slides (due 17:00)
- Still open today: Call Ana (due 20:00)

1 of 3 planned to-dos done, 1 missed, 1 still open today. 1 more to-do done that wasn't planned, and 1 note taken.

### Needs a new time
- Send slides (due 17:00)
`));
assert.equal(daily.reviewDue(), false, 'once a day by the clock');
// A Log line after the review starts a Log of its own.
clock = at(26, 19); finish('c', at(26, 19)); daily.tick();
assert.ok(note().endsWith('- Send slides (due 17:00)\n\n## Log\n- 19:00 Done: Call Ana\n'));
// A second review adds only what changed.
clock = at(26, 21, 10);
assert.equal(daily.review({ by: 'asked' }).line, 'Day review: 2 of 3 planned to-dos done, 1 missed. It\'s in today\'s note.');
assert.ok(note().endsWith('- 19:00 Done: Call Ana\n\n## Review update (21:10)\n- Done: Call Ana\n\n2 of 3 planned to-dos done, 1 missed. 1 more to-do done that wasn\'t planned, and 1 note taken.\n\n### Needs a new time\n- Send slides (due 17:00)\n'));
clock = at(26, 21, 20); daily.review({ by: 'asked' });
assert.ok(note().endsWith('## Review update (21:20)\n- Nothing has changed since 18:30.\n\n2 of 3 planned to-dos done, 1 missed. 1 more to-do done that wasn\'t planned, and 1 note taken.\n\n### Needs a new time\n- Send slides (due 17:00)\n'));
assert.ok(note().startsWith(plan));
// Still the 26th at 03:00 the next morning; the 27th from 04:00, with its own note.
clock = at(27, 3); assert.equal(daily.today().key, '2026-11-26');
// With no briefing, the first thing written that day writes the Plan first. A to-do finished before that is in it as
// it was last seen (its block is gone on the calendar side by then).
todos.push({ id: 'k', text: 'Review chapter', kind: 'commitment', status: 'open', due: null, doneAt: null }); blocks.k = { start: at(27, 8), minutes: 30, kept: true };
clock = at(27, 7); daily.tick(); assert.ok(!fs.existsSync(path.join(vault, 'Daily', '2026-11-27.md')));
clock = at(27, 9); finish('k', at(27, 8, 40)); daily.tick();
assert.equal(note('2026-11-27'), `---
date: 2026-11-27
---

# Friday 27 November 2026

← [[2026-11-26]] · [[2026-11-28]] →

## Plan
- 08:00 to 08:30 Review chapter (done)

### Needs a new time
- Book room D (was Tuesday 24 November, 14:00)
- Send slides (was Thursday 26 November, 17:00)

### Coming up
- Saturday 28 November: Grant report (due 18:00)

## Log
- 08:40 Done: Review chapter
`);
// A note already there (made in Obsidian) is added to, never written over.
fs.mkdirSync(path.join(vault, 'Daily'), { recursive: true }); fs.writeFileSync(path.join(vault, 'Daily', '2026-11-28.md'), 'my own start\n');
clock = at(28, 9); daily.ensure();
assert.ok(note('2026-11-28').startsWith('my own start\n\n## Plan\n'));
// The review's log carries counts only.
for (const [k, d] of logs) assert.ok(!/Write|Send|Ana|Book|Grant|Cellpose/.test(JSON.stringify(d)), `${k}: no title in the log`);
// Nothing of the note is kept in state.json beyond the days it covers.
assert.deepEqual(Object.keys(readState(dir).daily.days).sort(), ['2026-11-26', '2026-11-27', '2026-11-28']);

// ---- the settings
const file0 = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
const withCal = (cal, more = {}) => { fs.writeFileSync(settingsFile, JSON.stringify({ ...file0, ...more, calendar: cal })); return loadSettings(home); };
let s = withCal({ ...file0.calendar, reviewAt: '' }); assert.equal(s.calendar.reviewAt, null, '"" : only when asked'); assert.deepEqual(s.invalid, []);
clock = at(29, 23); assert.equal(daily.reviewDue(), false, 'never by the clock then');
const { reviewAt: _r, ...noReview } = file0.calendar;
s = withCal({ ...noReview, dayEnd: '17:00' }); assert.equal(s.calendar.reviewAt, 17 * 60, 'missing: dayEnd\'s value'); assert.ok(s.missing.includes('calendar.reviewAt'));
s = withCal({ ...file0.calendar, reviewAt: '25:00' }); assert.deepEqual(s.invalid.map((i) => i.name), ['calendar.reviewAt']); assert.equal(s.calendar.reviewAt, 1080);
s = withCal({ ...file0.calendar, dayTurnsAt: '10:00' }); assert.deepEqual(s.invalid, [{ name: 'calendar.dayTurnsAt', using: '04:00' }], 'not after dayStart'); assert.equal(s.calendar.dayTurnsAt, 240);
s = withCal({ ...file0.calendar, dayStart: '03:00', dayTurnsAt: '05:00' }); assert.equal(s.calendar.dayTurnsAt, 0, 'with a day that starts before 04:00, midnight');
s = withCal({ ...file0.calendar, dayTurnsAt: '02:30' }); assert.equal(s.calendar.dayTurnsAt, 150); assert.deepEqual(s.invalid, []);
for (const bad of ['', 'Daily/Sub', '.hidden', ' Daily', 'a:b', 42]) { s = withCal(file0.calendar, { dailyFolder: bad }); assert.equal(s.dailyFolder, 'Daily', String(bad)); assert.deepEqual(s.invalid.map((i) => i.name), ['dailyFolder'], String(bad)); }
s = withCal(file0.calendar, { dailyFolder: 'Journal' }); assert.equal(s.dailyFolder, 'Journal');
clock = at(30, 9); daily.ensure(); assert.ok(fs.existsSync(path.join(vault, 'Journal', '2026-11-30.md')));
fs.writeFileSync(settingsFile, JSON.stringify(file0));

// ---- the answer to "When will you do it?", judged in code (Thursday 26 November, 18:30; working day 09:00 to 18:00)
const t1830 = at(26, 18, 30), when = (text) => { const r = parseWhen(text, { now: t1830, dayStart: 540, dayEnd: 1080 }); return r && (r.kind === 'at' ? new Date(r.start).toString().slice(0, 21) : r.kind === 'day' ? `day ${r.day.toDateString()}` : r.kind); };
for (const [said, want] of [
  ['tomorrow at 10', 'Fri Nov 27 2026 10:00'], ['Friday 14:30', 'Fri Nov 27 2026 14:30'], ['friday at 2:30 pm', 'Fri Nov 27 2026 14:30'],
  ['at 2', 'Fri Nov 27 2026 14:00'], ['at 9', 'Fri Nov 27 2026 09:00'], ['at 6', 'Fri Nov 27 2026 18:00'], ['3pm', 'Fri Nov 27 2026 15:00'],
  ['10 a.m. tomorrow', 'Fri Nov 27 2026 10:00'], ['tomorrow 10am', 'Fri Nov 27 2026 10:00'], ['noon tomorrow', 'Fri Nov 27 2026 12:00'],
  ['um, tomorrow at ten thirty please', 'Fri Nov 27 2026 10:30'], ['half past three on monday', 'Mon Nov 30 2026 15:30'], ['quarter to nine tomorrow', 'Fri Nov 27 2026 08:45'],
  ['tonight at 8', 'Thu Nov 26 2026 20:00'], ['28 November at 9', 'Sat Nov 28 2026 09:00'], ['on the 30th at 11', 'Mon Nov 30 2026 11:00'],
  ['tomorrow', 'day Fri Nov 27 2026'], ['monday', 'day Mon Nov 30 2026'], ['the 28th', 'day Sat Nov 28 2026'], ['december 1st', 'day Tue Dec 01 2026'],
  ['thursday', 'day Thu Dec 03 2026'], ['the day after tomorrow', 'day Sat Nov 28 2026'],
  ['leave it', 'leave'], ['Not now.', 'leave'], ['drop it', 'drop'], ['let it go', 'drop'],
  ['today at 9', null], ['next friday', null], ['next week', null], ['banana', null], ['tomorrow at 25', null], ['', null], ['delete it', null], ['mark it done', null],
]) assert.equal(when(said), want, said);

// ---- the bubble: a click answers by position, what is said by parse()
{
  const shown = [], texts = []; let click;
  const ans = createAnswers({ ask: (o) => { shown.push(o); return new Promise((r) => { click = r; }); }, retext: (t) => texts.push(t) });
  const opts = () => ({ placeholder: 'Q?', choices: ['Leave it', 'Drop it'], clicks: [{ kind: 'leave' }, { kind: 'drop' }], hint: WHEN_HINT, parse: (t) => parseWhen(t, { now: t1830 }) });
  let p = ans.ask(opts());
  assert.equal(shown[0].second, SECOND); assert.equal(shown[0].placeholder, 'Q?\nSay a day and a time, a day, "leave it" or "drop it", or click.');
  assert.equal(ans.heard('banana', { handsFree: true }), true); assert.equal(texts.at(-1), 'Q?\nHeard "banana". Say a day and a time, a day, "leave it" or "drop it".'); assert.ok(ans.open(), 'not an answer: it stays open');
  assert.equal(ans.heard('yes'), true); assert.ok(ans.open(), 'a yes is not an answer to it');
  ans.heard('tomorrow at 10', { handsFree: true }); assert.deepEqual(await p, { kind: 'at', start: at(27, 10) });
  p = ans.ask(opts()); click(SECOND); assert.deepEqual(await p, { kind: 'drop' });
  p = ans.ask(opts()); click('yes'); assert.deepEqual(await p, { kind: 'leave' });
  p = ans.ask(opts()); click(null); assert.equal(await p, null, 'Esc: no answer');
}

// ---- the questions: after the review (missed to-dos) and in the morning (the ones that need a new time)
{
  const home2 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'daily-ask-')));
  const v2 = path.join(home2, 'Documents', 'roamies-vault', 'Daily');
  let now2 = at(26, 18, 30);
  const T2 = [
    { id: 'm1', text: 'Draft abstract', kind: 'commitment', status: 'open', due: null, doneAt: null },
    { id: 'm2', text: 'Email Bo', kind: 'commitment', status: 'open', due: at(26, 11), doneAt: null },
    { id: 'm3', text: 'Order reagents', kind: 'commitment', status: 'open', due: at(26, 12), doneAt: null },
    { id: 'm4', text: 'Book bench', kind: 'commitment', status: 'open', due: at(26, 13), doneAt: null },
    { id: 'o1', text: 'Call Ana', kind: 'commitment', status: 'open', due: at(26, 20), doneAt: null },
    { id: 'n1', text: 'Old thing', kind: 'commitment', status: 'open', due: at(24, 10), doneAt: null },
    { id: 'r1', text: 'Stretch', kind: 'reminder', status: 'open', due: at(26, 10), doneAt: null },
  ];
  const B2 = { m1: { start: at(26, 9), minutes: 60, kept: false } };
  const logs2 = [];
  const d2 = createDaily({ home: home2, todos: () => T2.map((t) => ({ ...t })), blocks: () => ({ ...B2 }), now: () => now2, log: (k, d) => logs2.push([k, d]) });
  const asked = [], said = [], moved = []; let script = [];
  const io = {
    ask: async (o) => { asked.push(o); const a = script.shift(); if (a === 'nobody') throw Object.assign(new Error('no answer'), { name: 'Unanswered' }); return typeof a === 'string' ? o.parse(a) : a ?? null; },
    reschedule: async (id, w) => { moved.push([id, w]); const t = T2.find((x) => x.id === id); if (B2[id] && w.start) B2[id] = { ...B2[id], start: w.start }; else t.due = w.start ?? w.day.getTime() + 18 * 3600_000; return { ok: true, line: `Moved ${id}.` }; },
    say: async (t) => { said.push(t); },
  };
  const note2 = (k = '2026-11-26') => fs.readFileSync(path.join(v2, `${k}.md`), 'utf8');
  d2.review();
  assert.ok(note2().includes('### Needs a new time\n- Draft abstract (09:00 to 10:00)\n- Email Bo (due 11:00)\n- Order reagents (due 12:00)\n- Book bench (due 13:00)\n'));
  script = ['tomorrow at 10', 'drop it', 'leave it'];
  assert.deepEqual(await d2.ask('review', io), { asked: 3, left: 1 }, 'limits.reviewQuestions (3) at most, oldest first');
  assert.deepEqual(asked.map((o) => o.placeholder), ['Draft abstract was planned for 09:00 to 10:00 and isn\'t done. When will you do it?', 'Email Bo was due at 11:00 and isn\'t done. When will you do it?', 'Order reagents was due at 12:00 and isn\'t done. When will you do it?']);
  assert.deepEqual(asked[0].choices, ['Leave it', 'Drop it']); assert.equal(asked[0].spoken, asked[0].placeholder);
  assert.deepEqual(moved, [['m1', { start: at(27, 10) }]], 'only an answer with a time moves anything; Roamies never picks one');
  assert.deepEqual(said, ['Moved m1.', 'I\'ll stop asking about Email Bo.', '1 more needs a new time: it\'s in today\'s note under Needs a new time.']);
  assert.ok(note2().endsWith('## Log\n- 18:30 Rescheduled: Draft abstract → Friday 27 November, 10:00\n- 18:30 Let go: Email Bo\n'));
  assert.deepEqual(T2.find((t) => t.id === 'm2'), { id: 'm2', text: 'Email Bo', kind: 'commitment', status: 'open', due: at(26, 11), doneAt: null }, 'let go: the to-do itself is left exactly as it is');
  assert.equal(T2.find((t) => t.id === 'm3').due, at(26, 12), '"leave it" changes nothing');
  // Asked again the same evening: only what wasn't answered. No answer ends the round and changes nothing.
  now2 = at(26, 21); asked.length = 0; said.length = 0; moved.length = 0; script = ['nobody'];
  d2.review({ by: 'asked' });
  assert.deepEqual(await d2.ask('review', io), { asked: 1, left: 1 }, 'Call Ana (due 20:00) is missed by now too');
  assert.deepEqual(asked.map((o) => o.placeholder.split(' was')[0]), ['Book bench']); assert.deepEqual(moved, []);
  assert.deepEqual(said, ['1 more needs a new time: it\'s in today\'s note under Needs a new time.']);
  // The next morning, no briefing set: asked at the end of the first exchange. The Plan lists what needs a new time,
  // without the one let go.
  now2 = at(27, 9);
  assert.equal(d2.morningDue(), true);
  d2.ensure();
  assert.ok(note2('2026-11-27').includes('## Plan\n- 10:00 to 11:00 Draft abstract\n\n### Needs a new time\n- Old thing (was Tuesday 24 November, 10:00)\n- Order reagents (was Thursday 26 November, 12:00)\n- Book bench (was Thursday 26 November, 13:00)\n- Call Ana (was Thursday 26 November, 20:00)\n'));
  asked.length = 0; said.length = 0; script = ['the 30th', { kind: 'leave' }];
  assert.deepEqual(await d2.ask('morning', io), { asked: 3, left: 1 });
  assert.deepEqual(asked.map((o) => o.placeholder), ['Old thing needs a new time: it was Tuesday 24 November, 10:00. When will you do it?', 'Order reagents needs a new time: it was Thursday 26 November, 12:00. When will you do it?', 'Book bench needs a new time: it was Thursday 26 November, 13:00. When will you do it?']);
  assert.deepEqual(moved.at(-1), ['n1', { day: new Date(2026, 10, 30) }]);
  assert.ok(note2('2026-11-27').endsWith('## Log\n- 09:00 Rescheduled: Old thing → due Monday 30 November\n'));
  assert.equal(d2.morningDue(), false, 'once a day'); assert.equal(d2.morningAsked(), true);
  // With a morning briefing set, the briefing asks: the end of an exchange doesn't, until its window has passed.
  const f2 = path.join(home2, 'Documents', 'roamies-pi', 'settings.json'), set2 = JSON.parse(fs.readFileSync(f2, 'utf8'));
  fs.writeFileSync(f2, JSON.stringify({ ...set2, briefings: { morning: '10:00' } }));
  now2 = at(28, 8); assert.equal(d2.morningDue(), false, 'the briefing is still to come');
  now2 = at(28, 14, 30); assert.equal(d2.morningDue(), true, 'its window (4 hours) has passed without it');
  // At most limits.reviewQuestions: a setting.
  fs.writeFileSync(f2, JSON.stringify({ ...set2, limits: { ...set2.limits, reviewQuestions: 1 } }));
  asked.length = 0; said.length = 0; script = ['leave it'];
  assert.deepEqual(await d2.ask('morning', io), { asked: 1, left: 3 }, 'Draft abstract\'s new time (the 27th, 10:00) has passed too');
  assert.deepEqual(said, ['3 more need a new time: they\'re in today\'s note under Needs a new time.']);
  for (const [k, d] of logs2) assert.ok(!/Draft|Email|Order|Bench|Old thing|Ana/i.test(JSON.stringify(d)), `${k}: counts only`);
  assert.deepEqual(logs2.filter(([k]) => k === 'daily_questions').map(([, d]) => d), [
    { kind: 'review', total: 4, asked: 3, left: 1, moved: 1, leave: 1, dropped: 1, failed: 0 },
    { kind: 'review', total: 2, asked: 1, left: 1, moved: 0, leave: 0, dropped: 0, failed: 0, ended: 'unanswered' },
    { kind: 'morning', total: 4, asked: 3, left: 1, moved: 1, leave: 1, dropped: 0, failed: 0, ended: 'closed' },
    { kind: 'morning', total: 4, asked: 1, left: 3, moved: 0, leave: 1, dropped: 0, failed: 0 },
  ]);
  fs.rmSync(home2, { recursive: true, force: true });
}

// ---- flow.mjs: the questions as a series, and the end of an exchange
{
  const home3 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'daily-flow-')));
  loadSettings(home3);
  let idle = true, ran = 0, spokenInside = null, due = true;
  const flow = createFlow({ home: home3, idle: () => idle, afterExchange: { due: () => due, run: async () => { ran++; spokenInside = flow.spoken(); } }, timers: { set: (fn) => { fn(); return 0; }, clear: () => {} } });
  assert.equal(await flow.series(async () => { spokenInside = flow.spoken(); }), true); assert.equal(spokenInside, true, 'each question is said and gets its window');
  idle = false; assert.equal(await flow.series(async () => {}), false, 'not while something else is going on'); idle = true;
  flow.start(); flow.closing('thanks'); await new Promise((r) => setTimeout(r, 20));
  assert.equal(ran, 1, 'the end of an exchange asks them'); assert.equal(spokenInside, true);
  due = false; flow.start(); flow.closing('thanks'); await new Promise((r) => setTimeout(r, 20));
  assert.equal(ran, 1, 'only when they are due');
  fs.rmSync(home3, { recursive: true, force: true });
}

// ---- "review my day", said alone, is the app's
for (const yes of ['review my day', 'Review my day.', 'um, review my day please', 'day review', 'how did today go?']) assert.ok(isReviewAsk(yes), yes);
for (const no of ['review my day and book a call', 'review the slides', 'what is my day like', '']) assert.ok(!isReviewAsk(no), no);

// ---- wiring: the evening briefing no longer writes a "Daily log" note; the daily note never reaches the model
const side = fs.readFileSync(new URL('../sidekick.mjs', import.meta.url), 'utf8');
assert.match(side, /if \(b\.kind === 'morning'\) dailyDo\('plan', \(\) => daily\.ensure\(\)\);/, 'the morning briefing writes the Plan');
assert.match(side, /if \(!area\?\.file && isReviewAsk\(text\)\) \{ ui\(\{ kind: 'heard' \}\); flow\.start\(\);[^\n]*dayReview\('asked'\)[^\n]*return; \}/, 'asked for by voice: answered by the app, never sent to the model');
assert.match(side, /daily\.reviewDue\(\) && calQuiet\(\)/, 'by the clock, when nothing else is going on');
assert.match(side, /afterExchange: \{ due: \(\) => daily\.morningDue\(\), run: \(\) => daily\.ask\('morning', dailyIO\) \}/, 'no morning briefing: the end of the first exchange asks');
assert.match(side, /\.then\(\(\) => \(b\.kind === 'morning' && !daily\.morningAsked\(\) \? dailyAsk\('morning'\) : null\)\)/, 'after the morning briefing');
assert.match(side, /say\(r\.line, 'happy'\); await lineDone\(forVoice\(r\.line\)\);\n\s*await dailyAsk\('review'\);/, 'after the review');
assert.match(side, /reschedule: \(id, when\) => cal\.reschedule\(id, when\)/);
assert.ok(!/enqueue\(`[^`]*daily\./.test(side) && !/enqueue\([^`)]*daily\./.test(side), 'nothing of the daily note is sent as a request');
const src = fs.readFileSync(new URL('../daily.mjs', import.meta.url), 'utf8');
assert.ok(!/oneShot|enqueue|fetch\(|http/.test(src), 'daily.mjs makes no request');

fs.rmSync(home, { recursive: true, force: true });
console.log('daily note tests: passed');
