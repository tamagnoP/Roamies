// Feature 23: the tool-call sets for the local model. Each task: [what is said, check(r, out)], where r is the first
// call that reached the real tools ({ n: the tool, a: its arguments, as code made them }) and out is liteRequest's
// result. The tools are stand-ins: nothing is saved.
//
// A and B: tuned against (stage 0, 2026-11-25). C: held out, never tuned against; copied unchanged from stage 0
// (written after A and B were tuned). D: written on 2026-11-26 after the code check was in, before any run, and never
// tuned against. E: written on 2026-11-26 after the completeness check was in and the prompt and tools were frozen
// again (A and B rerun), before any run, never tuned against. F: written on 2026-11-26 after the model's time
// arguments were taken away and the prompt and tools frozen again (A and B rerun), committed before any run, never
// tuned against. Do not change C, D, E or F, and do not change the prompt or the tools because of what they show.
//
// The checks were rewritten on 2026-11-26, before any run, when the tools lost their time fields: they now judge
// what reached the real tools (the date, start, end, length, due time, kind and id code worked out) instead of the
// model's arguments. The sentences are unchanged. Now: Wednesday 25 November 2026, 14:05. To-dos: Budget review
// (k3f9, due today, on the calendar today 10:00 to 11:00), Grant report draft (p2x7, due Friday, on the calendar
// today 15:00 to 16:00), Thesis chapter 2 (t5, no date).

const is = (r, n) => r?.n === n;
const none = (r, out) => !r && out.calls.length === 0 && out.reply.length > 0;

export const A = [
  ['Add a to-do: finish the slides by Friday.', (r) => is(r, 'remember_commitment') && /slides/i.test(r.a.text) && r.a.due === '2026-11-27' && r.a.kind === 'commitment'],
  ['Remind me in 20 minutes to call Anna.', (r) => is(r, 'remember_commitment') && /anna/i.test(r.a.text) && r.a.due === '2026-11-25T14:25:00' && r.a.kind === 'reminder'],
  ['Put the ethics form on my calendar tomorrow from 10 to 11.', (r) => is(r, 'schedule_block') && /ethics/i.test(r.a.title ?? '') && r.a.date === 'tomorrow' && r.a.start === '10:00' && (r.a.end === '11:00' || r.a.minutes === 60)],
  ['What\'s on my calendar on Thursday?', (r) => is(r, 'show_day') && r.a.date === 'thursday'],
  ['Note down that the reviewer wants more controls in figure 3.', (r) => is(r, 'write_note') && /control/i.test(r.a.content) && r.a.title.length < 60],
  ['I\'m done with the budget review.', (r) => is(r, 'update_commitment') && r.a.id === 'k3f9' && r.a.status === 'done' && !r.a.due],
];

export const B = [
  ['Remind me tomorrow at 9 to send the invoice.', (r) => is(r, 'remember_commitment') && /invoice/i.test(r.a.text) && r.a.due === '2026-11-26T09:00:00' && r.a.kind === 'reminder'],
  ['New task: order antibodies, due next Monday.', (r) => is(r, 'remember_commitment') && /antibod/i.test(r.a.text) && r.a.due === '2026-11-30' && r.a.kind === 'commitment'],
  ['Move the grant report draft to 16:30.', (r) => is(r, 'move_block') && r.a.todo === 'p2x7' && r.a.start === '16:30' && !r.a.date],
  ['What do my notes say about the confocal?', (r) => is(r, 'search_notes') && /confocal/i.test(r.a.query)],
  ['Open Zotero.', (r) => is(r, 'open') && /zotero/i.test(r.a.target)],
  ['What did I plan for today in my daily note?', (r) => is(r, 'read_daily')],
];

// Held out (stage 0's FRESH set, unchanged).
export const C = [
  ['Remind me at half past four to pick up the parcel.', (r) => is(r, 'remember_commitment') && /parcel/i.test(r.a.text) && r.a.due === '2026-11-25T16:30:00' && r.a.kind === 'reminder'],
  ['Book an hour for the literature search on Monday at 2.', (r) => is(r, 'schedule_block') && /literature/i.test(r.a.title ?? '') && r.a.date === 'monday' && r.a.start === '14:00' && (r.a.minutes === 60 || r.a.end === '15:00')],
  ['Drop the budget review, I won\'t do it.', (r) => is(r, 'update_commitment') && r.a.id === 'k3f9' && r.a.status === 'dropped' && !r.a.due],
  ['Read me my note called Lab meeting.', (r) => is(r, 'read_note') && /lab meeting/i.test(r.a.title)],
  ['Which to-dos do I have about the thesis?', (r) => is(r, 'list_commitments') && /thesis/i.test(r.a.words ?? '')],
  ['Take the grant report draft off the calendar.', (r) => is(r, 'unschedule_block') && r.a.todo === 'p2x7'],
];

// New, untuned (2026-11-26). The last task is one the local model can't do: right is no call and a reply.
export const D = [
  ['Remind me on Friday at 11 to renew the parking permit.', (r) => is(r, 'remember_commitment') && /parking/i.test(r.a.text) && r.a.due === '2026-11-27T11:00:00' && r.a.kind === 'reminder'],
  ['Block tomorrow from 2 to half past three for the poster draft.', (r) => is(r, 'schedule_block') && /poster/i.test(r.a.title ?? '') && r.a.date === 'tomorrow' && r.a.start === '14:00' && (r.a.end === '15:30' || r.a.minutes === 90)],
  ['Push the budget review to Thursday at 9.', (r) => is(r, 'move_block') && r.a.todo === 'k3f9' && r.a.date === 'thursday' && r.a.start === '09:00'],
  ['Make a note about the seminar: bring the HDMI adapter.', (r) => is(r, 'write_note') && /hdmi/i.test(r.a.content ?? '') && /seminar/i.test(`${r.a.title ?? ''} ${r.a.content ?? ''}`)],
  ['Do I have any to-dos due tomorrow?', (r) => is(r, 'list_commitments') && r.a.due === 'tomorrow'],
  ['Send an email to Marco saying I\'m running late.', none],
];

// New, untuned (2026-11-26, after the completeness check).
export const E = [
  ['Remind me in half an hour to check the incubator.', (r) => is(r, 'remember_commitment') && /incubator/i.test(r.a.text ?? '') && r.a.due === '2026-11-25T14:35:00' && r.a.kind === 'reminder'],
  ['Schedule 45 minutes for the grant report draft tomorrow at 11.', (r) => is(r, 'schedule_block') && (r.a.todo === 'p2x7' || /grant report/i.test(r.a.title ?? '')) && r.a.date === 'tomorrow' && r.a.start === '11:00' && r.a.minutes === 45],
  ['Move the grant report draft from 3 to half past four.', (r) => is(r, 'move_block') && r.a.todo === 'p2x7' && r.a.start === '16:30' && (!r.a.date || r.a.date === 'today')],
  ['Add a to-do: submit the ethics amendment by the 4th of December.', (r) => is(r, 'remember_commitment') && /ethics/i.test(r.a.text ?? '') && r.a.due === '2026-12-04' && r.a.kind === 'commitment'],
  ['What have I got on Friday?', (r) => is(r, 'show_day') && r.a.date === 'friday'],
  ['Change the budget review to tomorrow at 10.', (r) => is(r, 'move_block') && r.a.todo === 'k3f9' && r.a.date === 'tomorrow' && r.a.start === '10:00'],
];

// New, untuned (2026-11-26, after the model's time arguments were taken away; committed before any run). Tasks 5 and
// 6 can't be done as said: right for them is a code-worded question (ASK below), with nothing saved.
export const F = [
  ['Remind me on Monday at quarter past ten to call the facilities office.', (r) => is(r, 'remember_commitment') && /facilities/i.test(r.a.text ?? '') && r.a.due === '2026-11-30T10:15:00' && r.a.kind === 'reminder'],
  ['Put the thesis chapter on my calendar on Friday from 1 to 3.', (r) => is(r, 'schedule_block') && r.a.todo === 't5' && r.a.date === 'friday' && r.a.start === '13:00' && (r.a.end === '15:00' || r.a.minutes === 120)],
  ['Move the budget review from 10 to quarter to twelve.', (r) => is(r, 'move_block') && r.a.todo === 'k3f9' && r.a.start === '11:45' && (!r.a.date || r.a.date === 'today')],
  ['The grant report draft is now due on Tuesday.', (r) => is(r, 'update_commitment') && r.a.id === 'p2x7' && r.a.due === '2026-12-01' && !r.a.status],
  ['Mark the budget review done and remind me at 5 to call home.', () => false],
  ['Book two hours for the grant report draft on Thursday.', () => false],
];

export const SETS = { A, B, C, D, E, F };
// The tasks whose right outcome is a code-worded question (by set, the task's index, the line expected). Any other
// question counts as asked although the request was complete. B's second task: which Monday is asked by the app's
// rule for "next <day>" (calendar.mjs, nextDays), not by the model.
export const ASK = { B: { 1: /^Monday the 30th or Monday the 7th\?/ }, F: { 4: /^One change at a time|^I couldn't place/, 5: /^What time\?/ } };
