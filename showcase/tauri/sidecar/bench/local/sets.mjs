// Feature 23: the tool-call sets for the local model. Each task: [what is said, check(call, out)], where call is the
// first call the code check let through ({ name, a: its arguments }) and out is liteRequest's result.
//
// A and B: tuned against (stage 0, 2026-11-25). C: held out, never tuned against; copied unchanged from stage 0
// (written after A and B were tuned). D: written on 2026-11-26 after the code check was in, before any run, and never
// tuned against. E: written on 2026-11-26 after the completeness check was in and the prompt and tools were frozen
// again (A and B rerun), before any run, never tuned against. Do not change C, D or E, and do not change the prompt or
// the tools because of what they show.

export const A = [
  ['Add a to-do: finish the slides by Friday.', (c) => c.name === 'remember_commitment' && /slides/i.test(c.a.text) && /fri/i.test(c.a.when ?? '')],
  ['Remind me in 20 minutes to call Anna.', (c) => c.name === 'remember_commitment' && /anna/i.test(c.a.text) && /20/.test(c.a.when ?? '')],
  ['Put the ethics form on my calendar tomorrow from 10 to 11.', (c) => c.name === 'schedule_block' && /ethics/i.test(c.a.title ?? c.a.todo ?? '') && /tomorrow/i.test(c.a.day) && /^10(:00)?$/.test(c.a.start) && (/^11(:00)?$/.test(c.a.end ?? '') || c.a.minutes === 60)],
  ['What\'s on my calendar on Thursday?', (c) => c.name === 'show_day' && /thu/i.test(c.a.day)],
  ['Note down that the reviewer wants more controls in figure 3.', (c) => c.name === 'write_note' && /control/i.test(c.a.content) && c.a.title.length < 60],
  ['I\'m done with the budget review.', (c) => c.name === 'update_commitment' && c.a.id === 'k3f9' && c.a.status === 'done'],
];

export const B = [
  ['Remind me tomorrow at 9 to send the invoice.', (c) => c.name === 'remember_commitment' && /invoice/i.test(c.a.text) && /tomorrow/i.test(c.a.when ?? '') && /9/.test(c.a.when ?? '')],
  ['New task: order antibodies, due next Monday.', (c) => c.name === 'remember_commitment' && /antibod/i.test(c.a.text) && /mon/i.test(c.a.when ?? '')],
  ['Move the grant report draft to 16:30.', (c) => c.name === 'move_block' && c.a.todo === 'p2x7' && /^16:30$/.test(c.a.start ?? '')],
  ['What do my notes say about the confocal?', (c) => c.name === 'search_notes' && /confocal/i.test(c.a.query)],
  ['Open Zotero.', (c) => c.name === 'open' && /zotero/i.test(c.a.app)],
  ['What did I plan for today in my daily note?', (c) => c.name === 'read_daily'],
];

// Held out (stage 0's FRESH set, unchanged).
export const C = [
  ['Remind me at half past four to pick up the parcel.', (c) => c.name === 'remember_commitment' && /parcel/i.test(c.a.text) && /(half past four|4:30|16:30)/i.test(c.a.when ?? '')],
  ['Book an hour for the literature search on Monday at 2.', (c) => c.name === 'schedule_block' && /literature/i.test(c.a.title ?? '') && /mon/i.test(c.a.day) && /^(14|2)(:00)?$/.test(c.a.start) && (c.a.minutes === 60 || /^(15|3)(:00)?$/.test(c.a.end ?? ''))],
  ['Drop the budget review, I won\'t do it.', (c) => c.name === 'update_commitment' && c.a.id === 'k3f9' && c.a.status === 'dropped'],
  ['Read me my note called Lab meeting.', (c) => c.name === 'read_note' && /lab meeting/i.test(c.a.title)],
  ['Which to-dos do I have about the thesis?', (c) => c.name === 'list_commitments' && /thesis/i.test(c.a.words ?? '')],
  ['Take the grant report draft off the calendar.', (c) => c.name === 'unschedule_block' && c.a.todo === 'p2x7'],
];

// New, untuned (2026-11-26). The last task is one the local model can't do: right is no call and a reply.
export const D = [
  ['Remind me on Friday at 11 to renew the parking permit.', (c) => c?.name === 'remember_commitment' && /parking/i.test(c.a.text) && /fri/i.test(c.a.when ?? '') && /11/.test(c.a.when ?? '')],
  ['Block tomorrow from 2 to half past three for the poster draft.', (c) => c?.name === 'schedule_block' && /poster/i.test(c.a.title ?? '') && /tomorrow/i.test(c.a.day ?? '') && /^(2|14)(:00)?$/.test(c.a.start ?? '') && (/^(half past three|3:30|15:30)$/i.test(c.a.end ?? '') || c.a.minutes === 90)],
  ['Push the budget review to Thursday at 9.', (c) => c?.name === 'move_block' && c.a.todo === 'k3f9' && /thu/i.test(c.a.day ?? '') && /^(at )?0?9(:00)?$/.test(c.a.start ?? '')],
  ['Make a note about the seminar: bring the HDMI adapter.', (c) => c?.name === 'write_note' && /hdmi/i.test(c.a.content ?? '') && /seminar/i.test(`${c.a.title ?? ''} ${c.a.content ?? ''}`)],
  ['Do I have any to-dos due tomorrow?', (c) => c?.name === 'list_commitments' && /tomorrow/i.test(c.a.day ?? '')],
  ['Send an email to Marco saying I\'m running late.', (c, out) => !c && out.calls.length === 0 && out.reply.length > 0],
];

// New, untuned (2026-11-26, after the completeness check). Today's blocks: Budget review 10:00 (k3f9), Grant report
// draft 15:00 (p2x7); now Wednesday 25 November 2026, 14:05.
export const E = [
  ['Remind me in half an hour to check the incubator.', (c) => c?.name === 'remember_commitment' && /incubator/i.test(c.a.text ?? '') && /in half an hour/i.test(c.a.when ?? '')],
  ['Schedule 45 minutes for the grant report draft tomorrow at 11.', (c) => c?.name === 'schedule_block' && (c.a.todo === 'p2x7' || /grant report/i.test(c.a.title ?? '')) && /tomorrow/i.test(c.a.day ?? '') && /^(at )?11(:00)?$/i.test(c.a.start ?? '') && c.a.minutes === 45],
  ['Move the grant report draft from 3 to half past four.', (c) => c?.name === 'move_block' && (c.a.todo === 'p2x7' || !c.a.todo) && /^(at )?3$/i.test(c.a.from ?? '') && /^(at )?half past four$/i.test(c.a.start ?? '')],
  ['Add a to-do: submit the ethics amendment by the 4th of December.', (c) => c?.name === 'remember_commitment' && /ethics/i.test(c.a.text ?? '') && /4th of december/i.test(c.a.when ?? '')],
  ['What have I got on Friday?', (c) => c?.name === 'show_day' && /fri/i.test(c.a.day ?? '')],
  ['Change the budget review to tomorrow at 10.', (c) => c?.name === 'move_block' && c.a.todo === 'k3f9' && /tomorrow/i.test(c.a.day ?? '') && /^(at )?10(:00)?$/i.test(c.a.start ?? '')],
];

export const SETS = { A, B, C, D, E };
// Sets whose checks expect a call: a task right only when the code check let one through.
export const NEEDS_CALL = { A: true, B: true, C: true, D: false, E: true };
