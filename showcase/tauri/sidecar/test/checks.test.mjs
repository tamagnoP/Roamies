// Local-only build, feature 23: the checks on a request's tool calls and reply (checks.mjs), with no model: what he
// said, the calls and the results.
import assert from 'node:assert/strict';
import {
  NOTHING_CHANGED, TAKES, TIME_FIELDS, askMissingLine, askTimeLine, createRequestCheck, dayAndClock, isSaid, kindFor, lengthSaid, missingHint,
  missingTimes, refusedHint, reminderLine, startSaid, timeWordsIn, timesIn, unconfirmed, unsaid, updateLine, whenLine, whenSaid,
} from '../checks.mjs';

const NOW = new Date(2026, 10, 25, 14, 5).getTime(); // a Wednesday
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();

// ---- a time or day argument must be words he said, case, spacing and punctuation aside
const book = 'Book an hour for the literature search on Monday at 2.';
assert.deepEqual(unsaid('schedule_block', { day: 'Monday', start: '14:00', title: 'x' }, book), [{ field: 'start', value: '14:00' }]);
assert.deepEqual(unsaid('schedule_block', { day: '  MONDAY ', start: '2' }, book), []);
assert.ok(isSaid('half past four', 'Remind me at half   past FOUR to pick up the parcel.'));
assert.ok(!isSaid('2', 'Remind me in 20 minutes'), 'whole words: "2" is not in "20"');
assert.ok(isSaid('16:30', 'Move it to 16:30.'));
assert.ok(!isSaid('Friday 27 November', 'by Friday'), 'a date worked out by the model is refused');
assert.deepEqual(unsaid('write_note', { title: '3 pm', content: 'x' }, 'note'), [], 'only time and day fields are checked');
assert.deepEqual(timeWordsIn(book), ['monday', '2']);
assert.match(refusedHint([{ field: 'start', value: '14:00' }], book, 'Office', 'schedule_block'), /^Refused, nothing was changed: start "14:00" is not Office's words\. Call schedule_block again now.*"monday", "2"/);
assert.equal(askTimeLine([{ field: 'day', value: 'x' }]), 'Which day do you mean? Nothing was changed.');
assert.equal(askTimeLine([{ field: 'start', value: 'x' }]), 'What time do you mean? Nothing was changed.');

// ---- the completeness check: every time, day and length he said, found by code
const T = (s) => timesIn(s, { now: NOW }).map((x) => `${x.kind}:${x.text}${x.minutes ? `=${x.minutes}` : ''}`);
assert.deepEqual(T(book), ['length:an hour=60', 'day:monday', 'clock:2']);
assert.deepEqual(T('Block tomorrow from 2 to half past three for the poster draft.'), ['day:tomorrow', 'clock:2', 'clock:half past three']);
assert.deepEqual(T('Remind me in 20 minutes to call Anna.'), ['rel:in 20 minutes'], 'a time from now is one, not a length');
assert.deepEqual(T('Note down that the reviewer wants more controls in figure 3.'), [], 'a bare number is a time only after "at", "from", "to" and the like');
assert.deepEqual(T('New task: order antibodies, due next Monday.'), ['day:next monday']);
assert.deepEqual(T('Move the lab meeting from Tuesday at 3 to Thursday at 4 for two hours'), ['day:tuesday', 'clock:3', 'day:thursday', 'clock:4', 'length:two hours=120']);
assert.deepEqual(T('Remind me the day after tomorrow at noon'), ['day:day after tomorrow', 'clock:noon']);
assert.deepEqual(T('read the second chapter by the 3rd of December at 4 pm'), ['day:3rd of december', 'clock:4 pm']);
assert.deepEqual(T('I sat with Bo in the sun on Monday'), ['day:monday'], 'no short day names: "sat" and "sun" are words');
assert.deepEqual(T('Remind me in an hour, and book 90 minutes at quarter to five'), ['rel:in an hour', 'length:90 minutes=90', 'clock:quarter to five']);
assert.equal(lengthSaid('an hour and a half'), 90); assert.equal(lengthSaid('for 45 minutes'), 45); assert.equal(lengthSaid('half an hour'), 30); assert.equal(lengthSaid('two'), null);
assert.deepEqual(missingTimes('schedule_block', { day: 'Monday', start: '2', title: 'x' }, book, { now: NOW }).map((x) => x.text), ['an hour']);
assert.deepEqual(missingTimes('schedule_block', { day: 'Monday', start: '2', minutes: 60 }, book, { now: NOW }), [], 'a length is used by minutes equal to code\'s reading of it');
assert.deepEqual(missingTimes('schedule_block', { day: 'Monday', start: '2', minutes: 30 }, book, { now: NOW }).map((x) => x.text), ['an hour']);
assert.deepEqual(missingTimes('move_block', { todo: 'k3f9', start: '9' }, 'Push the budget review to Thursday at 9.', { now: NOW }).map((x) => x.text), ['thursday']);
assert.deepEqual(missingTimes('move_block', { todo: 'p2x7', start: '5' }, 'Move the grant report draft from 3 to 5.', { now: NOW }).map((x) => x.text), ['3'], 'a move uses both times');
assert.deepEqual(missingTimes('move_block', { todo: 'p2x7', from: '3', start: '5' }, 'Move the grant report draft from 3 to 5.', { now: NOW }), []);
assert.deepEqual(missingTimes('remember_commitment', { text: 'x', when: 'monday' }, 'New task: x, due next Monday.', { now: NOW }).map((x) => x.text), ['next monday']);
assert.deepEqual(missingTimes('show_day', { day: 'thursday' }, 'What is on Thursday at 9?', { now: NOW }), [], 'only what the tool can take');
assert.deepEqual(missingTimes('write_note', { title: 't', content: 'c' }, 'Note: the meeting is on Friday at 3.', { now: NOW }), [], 'a tool with no time fields is not checked');
assert.equal(missingHint([{ kind: 'length', text: 'an hour' }], 'Office', 'schedule_block'), 'Refused, nothing was changed: the call leaves out "an hour" (minutes, as a number) from Office\'s words. Call schedule_block again now with every time, day and length he said, copied exactly.');
assert.equal(askMissingLine([{ text: 'thursday' }, { text: '9' }]), 'Nothing was changed: I couldn\'t use "thursday" and "9". Could you say it again?');
assert.deepEqual(dayAndClock('thursday at 3'), { date: 'thursday', clock: '15:00' });
assert.deepEqual(dayAndClock('3'), { date: undefined, clock: '15:00' });
assert.equal(dayAndClock('the slides'), null);

// ---- "remind me" decides the kind, in code
assert.equal(kindFor('Remind me at 4 to call Anna'), 'reminder');
assert.equal(kindFor('Add a to-do: finish the slides by Friday'), 'commitment');
assert.equal(kindFor('REMIND ME tomorrow'), 'reminder');

// ---- his words, read by code
assert.deepEqual(whenSaid('half past four', { now: NOW }), { at: at(25, 16, 30) });
assert.deepEqual(whenSaid('in 20 minutes', { now: NOW }), { at: NOW + 20 * 60_000 });
assert.deepEqual(whenSaid('in an hour', { now: NOW }), { at: NOW + 3600_000 });
assert.deepEqual(whenSaid('by Friday', { now: NOW }), { day: new Date(2026, 10, 27) });
assert.deepEqual(whenSaid('tomorrow at 9', { now: NOW }), { at: at(26, 9) });
assert.deepEqual(whenSaid('next Monday', { now: NOW }), { ask: 'Monday the 30th or Monday the 7th?' }, 'which Monday is asked, not guessed');
assert.equal(whenSaid('an hour', { now: NOW }), null);
assert.equal(startSaid('2'), '14:00');
assert.equal(startSaid('half past three'), '15:30');
assert.equal(startSaid('at 9'), '09:00');
assert.equal(whenLine(at(25, 14, 25), false, NOW), 'at 14:25');
assert.equal(whenLine(at(26, 9), false, NOW), 'tomorrow at 09:00');
assert.equal(whenLine(new Date(2026, 10, 27).getTime(), true, NOW), 'on Friday 27 November');

// ---- a reply may not claim what no tool result in the request confirms
assert.deepEqual(unconfirmed('I have marked the budget review as done.', new Set()), ['I have marked the budget review as done.']);
assert.deepEqual(unconfirmed('I have marked the budget review as done.', new Set(['update_commitment'])), []);
assert.deepEqual(unconfirmed('It\'s moved to Thursday.', new Set(['remember_commitment'])), ['It\'s moved to Thursday.'], 'the right tool has to confirm it');
assert.deepEqual(unconfirmed('I can\'t send emails here.', new Set()), []);
assert.deepEqual(unconfirmed('Nothing is booked on Thursday.', new Set()), [], 'a negation claims nothing');
assert.deepEqual(unconfirmed('Should I put it on the calendar?', new Set()), [], 'a question claims nothing');
assert.deepEqual(unconfirmed('You have a lab meeting at 9.', new Set()), []);
assert.deepEqual(unconfirmed('Saved. I\'ll remind you at four.', new Set()).length, 2);


// ---- the code-worded lines after a change
assert.equal(reminderLine({ text: 'call Anna.', kind: 'reminder', ms: at(25, 14, 25), now: NOW }), 'I\'ll remind you to call Anna at 14:25.');
assert.equal(reminderLine({ text: 'finish the slides', kind: 'commitment', ms: new Date(2026, 10, 27).getTime(), dayOnly: true, now: NOW }), 'Saved "finish the slides", due on Friday 27 November.');
assert.equal(reminderLine({ text: 'buy milk', kind: 'reminder', now: NOW }), 'Saved "buy milk".', 'a reminder with no time is saved, not promised');
assert.equal(updateLine({ title: 'Budget review', status: 'done' }), '"Budget review" is done.');
assert.equal(updateLine({ title: 'Budget review', ms: at(30, 0), dayOnly: true, now: NOW }), '"Budget review" is now due on Monday 30 November.');
assert.equal(updateLine({ status: 'dropped', ms: at(26, 9), now: NOW }), 'It is dropped. It is now due tomorrow at 09:00.');
assert.equal(updateLine({}), 'It is updated.');

// ---- one request's checks: the calls, the results, the reply; nothing about a model
{
  const said = 'Push the budget review to Thursday at 9.';
  const c = createRequestCheck({ said, userName: 'Office', now: NOW });
  let v = c.call('move_block', { todo: 'k3f9', start: '9:00' });
  assert.deepEqual([v.run, v.unsaid, v.missing], [undefined, ['start'], ['thursday', '9']]);
  assert.match(v.refuse, /^Refused, nothing was changed: start "9:00" is not Office's words\. Call move_block again now.* the call leaves out "thursday" \(day\), "9" \(start, end or from\)/);
  v = c.call('move_block', { todo: 'k3f9', day: 'Thursday', start: '9' });
  assert.deepEqual(v, { run: true }); assert.equal(c.refusals, 1);
  assert.equal(c.result('move_block', { ok: true, text: 'for the model', say: '"Budget review" is moved to Thursday, 09:00.' }), '"Budget review" is moved to Thursday, 09:00.');
  assert.deepEqual(c.finish(''), { reply: '"Budget review" is moved to Thursday, 09:00.', by: 'model', replaced: 0 }, 'after a change, the code-worded line');
}
{
  const c = createRequestCheck({ said: 'Remind me at half past four to pick up the parcel.', userName: 'Office', now: NOW });
  assert.ok(c.call('remember_commitment', { text: 'parcel', when: '16:30' }).refuse);
  assert.deepEqual(c.call('remember_commitment', { text: 'parcel', when: '4:30 pm' }), { ask: 'What time do you mean? Nothing was changed.', unsaid: ['when'], missing: ['half past four'] }, 'the second refusal asks');
  assert.deepEqual(c.finish('I have set a reminder.'), { reply: 'What time do you mean? Nothing was changed.', by: 'refused', replaced: 0 }, 'refused with nothing let through: the ask, never the model\'s words');
}
{
  const c = createRequestCheck({ said: 'Push the budget review to Thursday at 9.', userName: 'Office', now: NOW });
  c.call('move_block', { todo: 'k3f9', start: '9' });
  assert.equal(c.call('move_block', { todo: 'k3f9', start: '9' }).ask, 'Nothing was changed: I couldn\'t use "thursday". Could you say it again?');
}
{
  const c = createRequestCheck({ said: 'Mark the budget review done.', userName: 'Office', now: NOW });
  assert.deepEqual(c.finish('I have marked the budget review as done.'), { reply: NOTHING_CHANGED, by: 'replaced', replaced: 1 }, 'a claim with no result behind it');
  const d = createRequestCheck({ said: 'What is on Thursday?', userName: 'Office', now: NOW });
  assert.deepEqual(d.call('show_day', { day: 'Thursday' }), { run: true });
  assert.equal(d.result('show_day', { ok: true, text: 'Thursday: lab meeting' }), '', 'a read is no change');
  assert.deepEqual(d.finish('You have the lab meeting at 9.'), { reply: 'You have the lab meeting at 9.', by: 'model', replaced: 0 });
  const e = createRequestCheck({ said: 'Open Zotero.', userName: 'Office', now: NOW });
  assert.equal(e.result('open', { ok: false, text: 'No app Zotero.' }), '');
  assert.equal(e.finish('I opened Zotero.').by, 'replaced', 'a failed tool confirms nothing');
  const f = createRequestCheck({ said: 'Save a note and open Zotero.', userName: 'Office', now: NOW });
  f.result('write_note', { ok: true, text: 'Saved the note "x".' });
  assert.equal(f.finish('Zotero is open now, and I opened it.').reply, 'Saved the note "x". Nothing was changed.', 'the line after the change stays; the unconfirmed claim goes');
}
{
  // other tool shapes: the caller's own table of time fields
  const c = createRequestCheck({ said: 'Remind me on Friday.', userName: 'Office', now: NOW, fields: { remind: ['at'] }, takes: { remind: ['day'] } });
  assert.deepEqual(c.call('remind', { at: 'friday' }), { run: true });
  assert.deepEqual(c.call('remember_commitment', { when: 'monday' }), { run: true }, 'a tool not in the table is not checked');
  assert.ok(TIME_FIELDS.move_block.includes('from') && TAKES.show_day.length === 1);
}
console.log('checks tests passed');
