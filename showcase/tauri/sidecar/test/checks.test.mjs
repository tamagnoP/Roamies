// Local-only build, feature 23: the checks on a request (checks.mjs), with no model: what he said, the calls and the
// results.
import assert from 'node:assert/strict';
import {
  ACTION_OF, DECIDED, NOTHING_CHANGED, ONE_AT_A_TIME, PLACES, changeQuestion, createRequestCheck, decideAction, grouped, kindFor, lengthSaid, matchTitle,
  oneChange, placeTimes, promised, readTimes, reminderByCode, reminderLine, startSaid, timesIn, titleIn, unconfirmed, updateLine, whenLine, whenSaid,
} from '../checks.mjs';

const NOW = new Date(2026, 10, 25, 14, 5).getTime(); // a Wednesday
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();

// ---- his sentence: every time, day and length in it, found by the tools' parsers
const book = 'Book an hour for the literature search on Monday at 2.';
const T = (s) => timesIn(s, { now: NOW }).map((x) => `${x.kind}:${x.text}${x.minutes ? `=${x.minutes}` : ''}`);
assert.deepEqual(T(book), ['length:an hour=60', 'day:monday', 'clock:2']);
assert.deepEqual(T('Block tomorrow from 2 to half past three for the poster draft.'), ['day:tomorrow', 'clock:2', 'clock:half past three']);
assert.deepEqual(T('Remind me in 20 minutes to call Anna.'), ['rel:in 20 minutes'], 'a time from now is one, not a length');
assert.deepEqual(T('Note down that the reviewer wants more controls in figure 3.'), [], 'a bare number is a time only after "at", "from", "to" and the like');
assert.deepEqual(T('New task: order antibodies, due next Monday.'), ['day:next monday']);
assert.deepEqual(T('Move the lab meeting from Tuesday at 3 to Thursday at 4 for two hours'), ['day:tuesday', 'clock:3', 'day:thursday', 'clock:4', 'length:two hours=120']);
assert.deepEqual(T('Remind me the day after tomorrow at noon'), ['day:day after tomorrow', 'clock:noon']);
assert.deepEqual(T('read the second chapter by the 3rd of December at 4 pm'), ['day:3rd of december', 'clock:4 pm']);
assert.deepEqual(T('Move tomorrow\'s poster session to Friday\'s slot'), ['day:tomorrow', 'day:friday'], 'a day\'s, as a day');
assert.deepEqual(T('I sat with Bo in the sun on Monday'), ['day:monday'], 'no short day names: "sat" and "sun" are words');
assert.deepEqual(T('Remind me in an hour, and book 90 minutes at quarter to five'), ['rel:in an hour', 'length:90 minutes=90', 'clock:quarter to five']);
assert.equal(lengthSaid('an hour and a half'), 90); assert.equal(lengthSaid('for 45 minutes'), 45); assert.equal(lengthSaid('half an hour'), 30); assert.equal(lengthSaid('two'), null);

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

// ---- written forms, and the words about time no parser read (stray: they stop a save)
const R = (s) => { const r = readTimes(s, { now: NOW }); return [r.times.map((x) => `${x.kind}:${x.text}`), r.stray]; };
assert.deepEqual(R('Move it to Friday at 3pm'), [['day:friday', 'clock:3 pm'], []]);
assert.deepEqual(R('at 8 p.m.'), [['clock:8 pm'], []]);
assert.deepEqual(R('at 9.30 for 1.5 hours'), [['clock:9:30', 'length:90 minutes'], []]);
assert.deepEqual(R('at ten past 3'), [['clock:3:10'], []], 'not "ten"');
assert.deepEqual(R('at twenty past four'), [['clock:4:20'], []]);
assert.deepEqual(R('at five to six'), [['clock:5:55'], []]);
assert.deepEqual(R('from 10 to 11'), [['clock:10', 'clock:11'], []], '"from 2 to 4" is two times');
assert.deepEqual(R('from ten to eleven'), [['clock:ten', 'clock:eleven'], []]);
assert.deepEqual(R('at half 3'), [['clock:3:30'], []]);
assert.deepEqual(R('on Monday week'), [['day:monday'], ['week']]);
assert.deepEqual(R('tomorrow morning'), [['day:tomorrow'], ['morning']]);
assert.deepEqual(R('at midnight'), [[], ['midnight']]);
assert.deepEqual(R('on Dec 5'), [[], ['dec']]);
assert.deepEqual(R('for a couple of hours'), [[], ['hours']]);
assert.deepEqual(R('prepare the Friday seminar slides'), [[], ['friday']], 'a weekday after "the" is a name, not read as a day');
assert.deepEqual(R('tomorrow at 3 o\'clock'), [['day:tomorrow', 'clock:3'], []]);
assert.deepEqual(R('write up the meeting minutes, chapter 2, figure 3'), [[], []], 'not about time');
assert.deepEqual(R('I may be late'), [[], []]);

// ---- the groups: after "from"/"between" the from group, after "to"/"until"/"till" (or "and" after "between") the to group
const G = (s) => grouped(timesIn(s, { now: NOW })).map((x) => `${x.group}:${x.text}`);
assert.deepEqual(G('Move it from Thursday at 2 to Friday at quarter to five'), ['from:thursday', 'from:2', 'to:friday', 'to:quarter to five']);
assert.deepEqual(G('Put it on Friday between 1 and 3'), ['none:friday', 'from:1', 'to:3']);
assert.deepEqual(G('Push the budget review to Thursday at 9.'), ['to:thursday', 'to:9']);
assert.deepEqual(G('Book an hour on Monday at 2.'), ['none:an hour', 'none:monday', 'none:2']);

// ---- the table: one row per action, each rule tested
const P = (action, said, o = {}) => placeTimes(action, said, { now: NOW, ...o });
const due = (ms, dayOnly = false) => ({ due: { ms, dayOnly } });
assert.deepEqual(Object.keys(PLACES), ['remind', 'todo', 'due', 'mark', 'book', 'move', 'unbook', 'show', 'find', 'none']);
// remind: a day, a clock time or a time from now; one is needed
assert.deepEqual(P('remind', 'Remind me in half an hour to check the incubator.'), { places: due(NOW + 30 * 60_000) });
assert.deepEqual(P('remind', 'Remind me at half past four to pick up the parcel.'), { places: due(at(25, 16, 30)) }, 'a time alone: today');
assert.deepEqual(P('remind', 'Remind me tomorrow at 9 to send the invoice.'), { places: due(at(26, 9)) });
assert.deepEqual(P('remind', 'Remind me on Friday to renew the permit.'), { places: due(at(27, 0), true) });
assert.deepEqual(P('remind', 'Remind me to call Anna.'), { ask: 'When should I remind you? Nothing was changed.' });
assert.deepEqual(P('remind', 'Remind me at 4 to stretch for 10 minutes.'), { ask: 'I couldn\'t place "10 minutes" for that. Nothing was changed: could you say it again?' });
assert.deepEqual(P('remind', 'Remind me in 20 minutes or at 5.'), { ask: 'I couldn\'t place "in 20 minutes" and "5" for that. Nothing was changed: could you say it again?' });
// todo: "by DAY" is a due time; none is no due
assert.deepEqual(P('todo', 'Add a to-do: finish the slides by Friday.'), { places: due(at(27, 0), true) });
assert.deepEqual(P('todo', 'Add a to-do: submit the ethics amendment by the 4th of December.'), { places: due(new Date(2026, 11, 4).getTime(), true) });
assert.deepEqual(P('todo', 'Add a to-do: call the plumber.'), { places: { due: null } });
assert.deepEqual(P('todo', 'New task: order antibodies, due next Monday.'), { ask: 'Monday the 30th or Monday the 7th? Nothing was changed yet.' }, 'which Monday is asked, not guessed');
assert.deepEqual(P('todo', 'Add a to-do: read two chapters by Friday and Monday.'), { ask: 'I couldn\'t place "friday" and "monday" for that. Nothing was changed: could you say it again?' });
// due: a new time is needed; "from DAY to DAY", the first is where it is now
assert.deepEqual(P('due', 'The grant report draft is now due Monday.'), { places: due(at(30, 0), true) });
assert.deepEqual(P('due', 'Move the slides from Friday to Monday.'), { places: { ...due(at(30, 0), true), from: { ms: at(27, 0), dayOnly: true } } });
assert.deepEqual(P('due', 'Change the grant report draft.'), { ask: 'By when? Nothing was changed.' });
assert.deepEqual(P('remind', 'Remind me tomorrow morning to buy milk.'), { ask: 'I couldn\'t place "morning" for that. Nothing was changed: could you say it again?' }, 'a word about time code can\'t read stops the save');
assert.deepEqual(P('remind', 'Remind me at 8 tonight to call home.'), { places: due(at(25, 20)) });
assert.deepEqual(P('todo', 'Add a to-do: prepare the Friday seminar slides.'), { ask: 'I couldn\'t place "friday" for that. Nothing was changed: could you say it again?' });
// mark: no time
assert.deepEqual(P('mark', 'Drop the budget review, I won\'t do it.'), { places: {} });
assert.deepEqual(P('mark', 'I\'m done with the budget review for today.'), { ask: 'I couldn\'t place "today" for that. Nothing was changed: could you say it again?' });
assert.deepEqual(P('mark', 'Mark the Monday meeting prep done.', { title: 'Monday meeting prep' }), { places: {} }, 'a to-do\'s title is not a time');
// book: "from X to Y" start and end, "at X for N" start and length; a day, a start and an end or length are needed
assert.deepEqual(P('book', 'Block tomorrow from 2 to half past three for the poster draft.'), { places: { date: 'tomorrow', start: '14:00', end: '15:30' } });
assert.deepEqual(P('book', 'Book an hour for the literature search on Monday at 2.'), { places: { date: 'monday', start: '14:00', minutes: 60 } });
assert.deepEqual(P('book', 'Put it on Friday between 1 and 3.'), { places: { date: 'friday', start: '13:00', end: '15:00' } });
assert.deepEqual(P('book', 'Book it at 9 until 10:30 on the 3rd of December.'), { places: { date: '2026-12-03', start: '09:00', end: '10:30' } });
assert.deepEqual(P('book', 'Book the poster for Friday.'), { ask: 'What time? For how long? Nothing was changed.' });
assert.deepEqual(P('book', 'Book two hours for the thesis at 3.'), { ask: 'Which day? Nothing was changed.' }, 'a missing day is asked as a day');
assert.deepEqual(P('book', 'Book two hours for the thesis on Friday.'), { ask: 'What time? Nothing was changed.' });
assert.deepEqual(P('book', 'Book it on Friday at 2 until 4 for an hour.'), { ask: 'I couldn\'t place "4" and "an hour" for that. Nothing was changed: could you say it again?' }, 'an end and a length: neither');
assert.deepEqual(P('book', 'Book it on Friday or Monday at 2 for an hour.'), { ask: 'I couldn\'t place "friday" and "monday" for that. Nothing was changed: could you say it again?' });
assert.deepEqual(P('book', 'Book it in 20 minutes for an hour today.'), { ask: 'I couldn\'t place "in 20 minutes" for that. Nothing was changed: could you say it again?' });
assert.deepEqual(P('book', 'Book it next Friday at 2 for an hour.'), { ask: 'Friday the 27th or Friday the 4th? Nothing was changed yet.' });
// move: "from X to Y" the block at X to start at Y; "to DAY at X" the new day and start; something new is needed
assert.deepEqual(P('move', 'Move the grant report draft from 3 to half past four.'), { places: { start: '16:30', from: { date: 'today', clock: '15:00' } } });
assert.deepEqual(P('move', 'Push the budget review to Thursday at 9.'), { places: { date: 'thursday', start: '09:00' } });
assert.deepEqual(P('move', 'Move the grant report draft to 16:30.'), { places: { start: '16:30' } });
assert.deepEqual(P('move', 'Move the poster from Thursday at 2 to Friday at quarter to five.'), { places: { date: 'friday', start: '16:45', from: { date: 'thursday', clock: '14:00' } } });
assert.deepEqual(P('move', 'Move the poster from 2 to 4 tomorrow.'), { places: { date: 'tomorrow', start: '16:00', from: { date: 'tomorrow', clock: '14:00' } } }, 'one day for both');
assert.deepEqual(P('move', 'Move the poster to Friday.'), { places: { date: 'friday' } }, 'a day alone: the same time');
assert.deepEqual(P('move', 'Move the poster to 3 until 5.'), { places: { start: '15:00', end: '17:00' } });
assert.deepEqual(P('move', 'Make the budget review two hours.'), { places: { minutes: 120 } });
assert.deepEqual(P('move', 'Move the budget review.'), { ask: 'To when? Nothing was changed.' });
assert.deepEqual(P('move', 'Move the poster to 3 or 4.'), { ask: 'I couldn\'t place "3" and "4" for that. Nothing was changed: could you say it again?' });
assert.deepEqual(P('move', 'Move the poster to Friday at 3pm.'), { places: { date: 'friday', start: '15:00' } });
assert.deepEqual(P('move', 'Move the poster to Monday week.'), { ask: 'I couldn\'t place "week" for that. Nothing was changed: could you say it again?' });
// unbook: no time; show: one day, today when none; find: one day, "this week", "overdue"
assert.deepEqual(P('unbook', 'Take the grant report draft off the calendar.'), { places: {} });
assert.deepEqual(P('unbook', 'Take Friday\'s block off.'), { ask: 'I couldn\'t place "friday" for that. Nothing was changed: could you say it again?' });
assert.deepEqual(P('show', 'What have I got on Friday?'), { places: { date: 'friday' } });
assert.deepEqual(P('show', 'What is on my calendar?'), { places: { date: 'today' } });
assert.deepEqual(P('show', 'What is on Friday at 3?'), { ask: 'I couldn\'t place "3" for that. Nothing was changed: could you say it again?' });
assert.deepEqual(P('find', 'Do I have any to-dos due tomorrow?'), { places: { due: 'tomorrow' } });
assert.deepEqual(P('find', 'What is due this week?'), { places: { due: 'this week' } });
assert.deepEqual(P('find', 'What is due next week?'), { ask: 'I couldn\'t place "week" for that. Nothing was changed: could you say it again?' }, '"this week" only');
assert.deepEqual(P('find', 'Which to-dos do I have about the thesis?'), { places: { due: undefined } });
// none: notes, the daily note, open: no time is set, times stay in the text
assert.deepEqual(P('none', 'Note: the seminar is on Friday at 3 for an hour.'), { places: {} });
// which action a call is
assert.equal(ACTION_OF('remember_commitment', {}, 'Remind me at 4'), 'remind');
assert.equal(ACTION_OF('remember_commitment', {}, 'Add a to-do'), 'todo');
assert.equal(ACTION_OF('update_commitment', { status: 'done' }, ''), 'mark');
assert.equal(ACTION_OF('update_commitment', {}, ''), 'due');
assert.equal(ACTION_OF('write_note', {}, ''), 'none');

// ---- the to-do by its title
const ITEMS = [{ id: 'k3f9', title: 'Budget review' }, { id: 'p2x7', title: 'Grant report draft' }, { id: 't5', title: 'Thesis chapter 2' }, { id: 'r1', title: 'Annual report' }];
assert.equal(matchTitle('the budget review', ITEMS).id, 'k3f9');
assert.equal(matchTitle('grant report', ITEMS).id, 'p2x7');
assert.equal(matchTitle('thesis', ITEMS).id, 't5', 'one word: a title\'s first word');
assert.deepEqual(matchTitle('review', ITEMS), { none: true }, 'one word inside a title is not enough');
assert.equal(matchTitle('grant report draft for the funder', ITEMS).id, 'p2x7', 'his words hold the whole title');
assert.equal(matchTitle('k3f9', ITEMS).id, 'k3f9');
assert.deepEqual(matchTitle('report', ITEMS), { none: true });
assert.deepEqual(matchTitle('the report', [...ITEMS, { id: 'r2', title: 'Report' }]), { id: 'r2', title: 'Report' }, 'an exact title first');
assert.deepEqual(matchTitle('annual', [...ITEMS, { id: 'r3', title: 'Annual leave' }]), { ask: 'Which one: "Annual report" or "Annual leave"? Nothing was changed.' });
assert.deepEqual(matchTitle('poster draft', ITEMS), { none: true });

// ---- one change per request
assert.equal(oneChange(['update_commitment', 'remember_commitment']), ONE_AT_A_TIME);
assert.equal(oneChange(['show_day', 'open']), '', 'a read and a change are one change');
assert.equal(oneChange(['show_day', 'search_notes']), '');

// ---- one request's checks: the calls, the results, the reply; nothing about a model
{
  const c = createRequestCheck({ said: 'Push the budget review to Thursday at 9.', now: NOW });
  assert.deepEqual(c.place('move_block', { todo: 'budget review', start: '10:00' }), { action: 'move', places: { date: 'thursday', start: '09:00' } }, 'the model\'s own time is not read');
  assert.equal(c.turn(['move_block']), '');
  assert.equal(c.result('move_block', { ok: true, text: 'for the model', say: '"Budget review" is moved to Thursday, 09:00.' }), '"Budget review" is moved to Thursday, 09:00.');
  assert.equal(c.turn(['update_commitment']), ONE_AT_A_TIME, 'after a change, no second one');
  assert.deepEqual(c.finish(''), { reply: '"Budget review" is moved to Thursday, 09:00.', by: 'model', replaced: 0 }, 'after a change, the code-worded line');
}
{
  const c = createRequestCheck({ said: 'Book the poster on Friday.', now: NOW });
  assert.deepEqual(c.place('schedule_block', { todo: 'poster' }), { action: 'book', ask: 'What time? For how long? Nothing was changed.' });
}
{
  const c = createRequestCheck({ said: 'Mark the budget review done.', now: NOW });
  assert.deepEqual(c.finish('I have marked the budget review as done.'), { reply: NOTHING_CHANGED, by: 'replaced', replaced: 1 }, 'a claim with no result behind it');
  const d = createRequestCheck({ said: 'What is on Thursday?', now: NOW });
  assert.equal(d.result('show_day', { ok: true, text: 'Thursday: lab meeting' }), '', 'a read is no change');
  assert.deepEqual(d.finish('You have the lab meeting at 9.'), { reply: 'You have the lab meeting at 9.', by: 'model', replaced: 0 });
  const e = createRequestCheck({ said: 'Open Zotero.', now: NOW });
  assert.equal(e.result('open', { ok: false, text: 'No app Zotero.' }), '');
  assert.equal(e.finish('I opened Zotero.').by, 'replaced', 'a failed tool confirms nothing');
  const f = createRequestCheck({ said: 'Save a note.', now: NOW });
  f.result('write_note', { ok: true, text: 'Saved the note "x".' });
  assert.equal(f.finish('Zotero is open now, and I opened it.').reply, 'Saved the note "x". Nothing was changed.', 'the line after the change stays; the unconfirmed claim goes');
}
{
  // other tools: the caller's own mapping to actions
  const c = createRequestCheck({ said: 'Remind me on Friday.', now: NOW, actionOf: (n) => (n === 'remind' ? 'remind' : 'none') });
  assert.deepEqual(c.place('remind', {}), { action: 'remind', places: due(at(27, 0), true) });
}

// ---- actions decided by code, from fixed words in his sentence: the table, row by row
{
  const OPEN = [{ id: 'k3f9', title: 'Budget review' }, { id: 'p2x7', title: 'Grant report draft' }, { id: 't5', title: 'Thesis chapter 2' }];
  const D = (s) => { const d = decideAction(s, { items: OPEN, now: NOW }); return d ? `${d.action}${d.status ? `:${d.status}` : ''}${d.title ? `@${d.title.id}` : ''}` : null; };
  assert.deepEqual(DECIDED.map((r) => r.action), ['remind', 'todo', 'due', 'mark', 'unbook', 'note', 'open', 'show']);
  for (const [said, want] of [
    // remind: the sentence starts with "remind me" (polite words aside)
    ['Remind me at half past four to pick up the parcel.', 'remind'], ['Can you remind me tomorrow to call Bo?', 'remind'], ['Remind me by Friday to read the budget review.', 'remind@k3f9'],
    ['Remind me to make a note about the seminar', 'remind'], ['Remind me at 5 to call home and mark the budget review done', 'remind@k3f9'],
    // a new to-do: the whole sentence, one request; its due time from "by" or "due"
    ['Add a to-do: finish the slides by Friday.', 'todo'], ['New task: order antibodies, due next Monday.', 'todo'], ['To-do: call the bank', 'todo'], ['Add a task to review the budget review notes', 'todo@k3f9'],
    ['Please add a to-do to book the venue, thanks', 'todo'],
    ['Add a to-do: book the venue, then email Bo.', null], ['Add a to-do and open Zotero', null], ['Could you add a task to call the clinic and also move the budget review', null], ['I need to add a to-do for the poster', null],
    // a due time for an open to-do named in his sentence (the owner's row, unchanged)
    ['The grant report draft is due on Tuesday.', 'due@p2x7'], ['The budget review is now due tomorrow at 10.', 'due@k3f9'], ['Grant report draft due by Monday', 'due@p2x7'],
    ['The deadline for the thesis chapter 2 is the 4th of December.', 'due@t5'], ['Finish the budget review by Friday.', 'due@k3f9'], ['Get the grant report draft done by 5.', 'due@p2x7'],
    ['Read chapter 2 by Monday.', null], ['The poster is due on Friday.', null], ['The grant report draft is due.', 'due@p2x7'],
    // marked done: the whole sentence, with the whole title
    ['I\'m done with the budget review.', 'mark:done@k3f9'], ['Mark the grant report draft as done', 'mark:done@p2x7'], ['The budget review is done.', 'mark:done@k3f9'], ['I\'ve finished the thesis chapter 2', 'mark:done@t5'],
    ['Tick off the budget review, please', 'mark:done@k3f9'], ['OK, I am done with my grant report draft', 'mark:done@p2x7'],
    ['I\'ve finished the thesis chapter', null], ['I\'m done with the poster.', null], ['Let me know when the budget review is done', null], ['The budget review is done, and book the poster', null],
    ['Mark the budget review done and remind me at 5 to call home.', null], ['I\'m done with the budget review for today', null],
    // off the calendar: the whole sentence, with the whole title (or the block for it)
    ['Take the grant report draft off the calendar.', 'unbook@p2x7'], ['Take the block for the budget review off my calendar', 'unbook@k3f9'], ['Remove the thesis chapter 2 from my calendar', 'unbook@t5'],
    ['Get the poster off my calendar', null], ['Take the grant report off the calendar', null], ['Take the grant report draft off the calendar and add the poster', null],
    // a note: the whole sentence, one request
    ['Note down that the reviewer wants more controls in figure 3.', 'note'], ['Make a note about the seminar: bring the HDMI adapter.', 'note'], ['Jot down the room number', 'note'],
    ['Make a note of the room number, then open Zotero', null], ['Can I make a note here?', null],
    // open an app: the whole sentence, the app named directly
    ['Open Zotero.', 'open'], ['Please open Mail', 'open'], ['Open Visual Studio Code', 'open'], ['Open the Zotero app', null],
    ['Can you open the window?', null], ['Open Zotero and move the budget review', null], ['Open it', null], ['Mark the budget review done and open Zotero', null],
    // looking up a day: the whole sentence, a day and nothing else (a read)
    ['What have I got on Friday?', 'show'], ['What\'s on tomorrow?', 'show'], ['Show me next Monday', 'show'], ['What is on my calendar for Friday?', 'show'],
    ['What do I have on the 4th of December?', 'show'], ['What\'s on today?', 'show'], ['Show me my calendar for Thursday, please', 'show'],
    ['What\'s on TV tonight?', null], ['What have I got on Friday at 3?', null], ['What do I have to do on Thursday?', null], ['Show me the budget review', null], ['What\'s on this week?', null],
    // no row: the model's choice, shown for a yes
    ['Move the budget review to Friday at 3.', null], ['Push the grant report draft to Thursday.', null], ['Drop the budget review, I won\'t do it.', null], ['Book an hour for the literature search on Monday at 2.', null],
    ['Schedule 45 minutes for the grant report draft tomorrow at 11.', null],
  ]) assert.equal(D(said), want, said);
  assert.equal(decideAction('Open Visual Studio Code, please', { items: OPEN, now: NOW }).app, 'Visual Studio Code', 'the app in his words');
  assert.equal(titleIn('Move the thesis chapter', OPEN), null, 'part of a title is not a title in his sentence');
  assert.equal(titleIn('the budget review and the grant report draft', OPEN), null, 'two titles: neither');
  assert.equal(titleIn('THE BUDGET REVIEW, please', OPEN).id, 'k3f9');

  // a reminder code can make alone: a time it places and a text, in his own words
  const RB = (s) => { const r = reminderByCode(s, { items: OPEN, now: NOW }); return r && [r.text, new Date(r.due.ms).toString().slice(0, 21)]; };
  assert.deepEqual(RB('Remind me at half past four to pick up the parcel.'), ['pick up the parcel', 'Wed Nov 25 2026 16:30']);
  assert.deepEqual(RB('Remind me in 20 minutes to call Anna.'), ['call Anna', 'Wed Nov 25 2026 14:25']);
  assert.deepEqual(RB('Remind me tomorrow at 9 to send the invoice.'), ['send the invoice', 'Thu Nov 26 2026 09:00']);
  assert.deepEqual(RB('Please remind me to call Anna at ten past 3.'), ['call Anna', 'Wed Nov 25 2026 15:10']);
  assert.deepEqual(RB('Could you remind me on Monday at 11:30 to email Bo, thanks'), ['email Bo', 'Mon Nov 30 2026 11:30']);
  assert.deepEqual(RB('Hey, remind me in half an hour to check the incubator!'), ['check the incubator', 'Wed Nov 25 2026 14:35']);
  assert.equal(RB('Remind me tomorrow to buy milk.'), null, 'a day without a time: the model');
  assert.equal(RB('Remind me to buy milk.'), null, 'no time');
  assert.equal(RB('Remind me about the seminar at 4.'), null, '"about": the model');
  assert.equal(RB('Remind me at 4 that the seminar is at 5.'), null);
  assert.equal(RB('Remind me tomorrow morning to buy milk.'), null, 'a time word code can\'t place');
  assert.equal(RB('Remind me next Monday at 9 to call Bo.'), null, 'which Monday is asked');
  assert.equal(RB('Tell Anna to remind me at 4 to call.'), null, 'only polite words before "remind me"');
  assert.equal(RB('Mark the budget review done and remind me at 5 to call home.'), null, 'two actions');

  // what a change the model chose would save, said back by code
  const Q = (tool, args, title) => changeQuestion({ tool, args, title, now: NOW });
  assert.equal(Q('move_block', { todo: 'p2x7', date: 'tuesday', start: '09:00' }, 'Grant report draft'), 'Move the block for "Grant report draft" to Tuesday 1 December at 09:00?');
  assert.equal(Q('move_block', { todo: 'p2x7', start: '16:30' }, 'Grant report draft'), 'Move the block for "Grant report draft" to 16:30?');
  assert.equal(Q('move_block', { todo: 'k3f9', date: 'tomorrow', start: '10:00' }, 'Budget review'), 'Move the block for "Budget review" to tomorrow at 10:00?');
  assert.equal(Q('move_block', { todo: 'k3f9', minutes: 90 }, 'Budget review'), 'Move the block for "Budget review" for 1 hour 30 minutes?');
  assert.equal(Q('schedule_block', { title: 'poster draft', date: 'tomorrow', start: '14:00', end: '15:30' }), 'Book "poster draft" tomorrow from 14:00 to 15:30?');
  assert.equal(Q('schedule_block', { todo: 't5', date: 'friday', start: '13:00', minutes: 120 }, 'Thesis chapter 2'), 'Book "Thesis chapter 2" on Friday 27 November at 13:00 for 2 hours?');
  assert.equal(Q('schedule_block', { title: 'lit search', date: '2026-12-04', start: '09:00', minutes: 45 }), 'Book "lit search" on Friday 4 December at 09:00 for 45 minutes?');
  assert.equal(Q('remember_commitment', { text: 'finish the slides', due: '2026-11-27', kind: 'commitment' }), 'Add the to-do "finish the slides", due on Friday 27 November?');
  assert.equal(Q('remember_commitment', { text: 'call home', kind: 'commitment' }), 'Add the to-do "call home"?');
  assert.equal(Q('remember_commitment', { text: 'call Anna', due: '2026-11-25T14:25:00', kind: 'reminder' }), 'Remind you to call Anna at 14:25?');
  assert.equal(Q('update_commitment', { id: 'p2x7', due: '2026-12-01' }, 'Grant report draft'), 'Make "Grant report draft" due on Tuesday 1 December?');
  assert.equal(Q('update_commitment', { id: 'k3f9', due: '2026-11-26T10:00:00' }, 'Budget review'), 'Make "Budget review" due tomorrow at 10:00?');
  assert.equal(Q('update_commitment', { id: 'k3f9', status: 'dropped' }, 'Budget review'), 'Mark "Budget review" as dropped?');
  assert.equal(Q('unschedule_block', { todo: 'p2x7' }, 'Grant report draft'), 'Take the block for "Grant report draft" off the calendar?');
  assert.equal(Q('write_note', { title: 'Seminar', content: 'Bring the HDMI adapter.' }), 'Save the note "Seminar": "Bring the HDMI adapter."?');
  assert.equal(Q('open', { target: 'Zotero' }), 'Open Zotero?');

  // with no tool called, a reply may not promise or report an action
  assert.deepEqual(promised('I will remember to pick up the parcel at half past four.'), ['I will remember to pick up the parcel at half past four.']);
  assert.deepEqual(promised('Noted!'), ['Noted!']);
  assert.deepEqual(promised('Sure. I\'ll book it.'), ['I\'ll book it.']);
  assert.deepEqual(promised('I have added it.'), ['I have added it.']);
  assert.deepEqual(promised('I cannot send emails for you.'), []);
  assert.deepEqual(promised('I have no way to do that here.'), [], 'a negative sentence promises nothing');
  assert.deepEqual(promised('Shall I put it on the calendar?'), []);
  const c = createRequestCheck({ said: 'Remind me at half past four to pick up the parcel.', now: NOW });
  assert.deepEqual(c.finish('I will remember to pick up the parcel at half past four.'), { reply: NOTHING_CHANGED, by: 'replaced', replaced: 1 });
  const r = createRequestCheck({ said: 'What is on today?', now: NOW });
  r.result('show_day', { ok: true, text: 'Today: lab meeting' });
  assert.deepEqual(r.finish('You have the lab meeting; I\'ll keep an eye on it.').by, 'model', 'after a read, a promise is not checked: only claims are');
  assert.equal(createRequestCheck({ said: 'Open Zotero.', now: NOW, items: OPEN }).decided.action, 'open');
  // the persona's name may come before the request, with "please", "can you" or "could you" (2026-11-26); elsewhere
  // it is a word like any other
  const RN = (t) => { const r = reminderByCode(t, { items: OPEN, now: NOW, name: 'Jarvis' }); return r && r.text; };
  for (const t of ['Jarvis, remind me at 5 to call home.', 'Please, Jarvis, remind me at 5 to call home', 'Jarvis could you remind me at 5 to call home please', 'Can you, Jarvis, remind me at 5 to call home?', 'Hey Jarvis, remind me at 5 to call home']) {
    assert.equal(decideAction(t, { items: OPEN, now: NOW, name: 'Jarvis' })?.action, 'remind', t); assert.equal(RN(t), 'call home', t);
  }
  assert.equal(decideAction('Jarvis, remind me at 5 to call home.', { items: OPEN, now: NOW })?.action, undefined, 'another name: not polite words');
  assert.equal(decideAction('Tell Jarvis to remind me at 5 to call home', { items: OPEN, now: NOW, name: 'Jarvis' }), null);
  assert.equal(createRequestCheck({ said: 'Jarvis, open Zotero.', now: NOW, items: OPEN, name: 'Jarvis' }).decided.app, 'Zotero');
}
console.log('checks tests passed');
