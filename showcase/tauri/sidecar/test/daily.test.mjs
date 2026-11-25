// Local-only build, feature 18: the daily note (daily.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDaily, dayWindow, isReviewAsk, noteDay, timeOn } from '../daily.mjs';
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
`));
assert.equal(daily.reviewDue(), false, 'once a day by the clock');
// A Log line after the review starts a Log of its own.
clock = at(26, 19); finish('c', at(26, 19)); daily.tick();
assert.ok(note().endsWith('1 note taken.\n\n## Log\n- 19:00 Done: Call Ana\n'));
// A second review adds only what changed.
clock = at(26, 21, 10);
assert.equal(daily.review({ by: 'asked' }).line, 'Day review: 2 of 3 planned to-dos done, 1 missed. It\'s in today\'s note.');
assert.ok(note().endsWith('- 19:00 Done: Call Ana\n\n## Review update (21:10)\n- Done: Call Ana\n\n2 of 3 planned to-dos done, 1 missed. 1 more to-do done that wasn\'t planned, and 1 note taken.\n'));
clock = at(26, 21, 20); daily.review({ by: 'asked' });
assert.ok(note().endsWith('## Review update (21:20)\n- Nothing has changed since 18:30.\n\n2 of 3 planned to-dos done, 1 missed. 1 more to-do done that wasn\'t planned, and 1 note taken.\n'));
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

// ---- "review my day", said alone, is the app's
for (const yes of ['review my day', 'Review my day.', 'um, review my day please', 'day review', 'how did today go?']) assert.ok(isReviewAsk(yes), yes);
for (const no of ['review my day and book a call', 'review the slides', 'what is my day like', '']) assert.ok(!isReviewAsk(no), no);

// ---- wiring: the evening briefing no longer writes a "Daily log" note; the daily note never reaches the model
const side = fs.readFileSync(new URL('../sidekick.mjs', import.meta.url), 'utf8');
assert.match(side, /if \(b\.kind === 'morning'\) dailyDo\('plan', \(\) => daily\.ensure\(\)\);/, 'the morning briefing writes the Plan');
assert.match(side, /if \(!area\?\.file && isReviewAsk\(text\)\) \{ ui\(\{ kind: 'heard' \}\); flow\.start\(\);[^\n]*dayReview\('asked'\)[^\n]*return; \}/, 'asked for by voice: answered by the app, never sent to the model');
assert.match(side, /daily\.reviewDue\(\) && calQuiet\(\)/, 'by the clock, when nothing else is going on');
assert.ok(!/enqueue\([^\n]*daily\./.test(side), 'nothing of the daily note is sent as a request');
const src = fs.readFileSync(new URL('../daily.mjs', import.meta.url), 'utf8');
assert.ok(!/oneShot|enqueue|fetch\(|http/.test(src), 'daily.mjs makes no request');

fs.rmSync(home, { recursive: true, force: true });
console.log('daily note tests: passed');
