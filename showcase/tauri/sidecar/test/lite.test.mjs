// Local-only build, feature 23: the lite request for the local model and the code check on its calls (lite.mjs).
import assert from 'node:assert/strict';
import {
  LITE_NAMES, LITE_TOOLS, NOTHING_CHANGED, askMissingLine, askTimeLine, createLiteRunner, dayAndClock, isSaid, kindFor, lengthSaid, liteBody,
  liteRequest, liteState, liteSystem, missingHint, missingTimes, refusedHint, startSaid, timeWordsIn, timesIn, unconfirmed, unsaid, warmBody,
  whenSaid, whenLine,
} from '../lite.mjs';

const NOW = new Date(2026, 10, 25, 14, 5).getTime(); // a Wednesday
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();

// ---- the opening is fixed: no time, no state; the tool set is exactly the lite set, by their real names
assert.equal(liteSystem('Office'), liteSystem('Office'));
assert.doesNotMatch(liteSystem('Office'), /2026|November|14:05/);
assert.deepEqual(LITE_NAMES, ['remember_commitment', 'update_commitment', 'list_commitments', 'schedule_block', 'move_block', 'unschedule_block', 'show_day', 'write_note', 'search_notes', 'read_note', 'read_daily', 'open']);
assert.ok(!LITE_NAMES.some((n) => /^mcp__/.test(n)), 'bare names, the real ones');
assert.match(liteState({ name: 'Office', now: NOW }), /^\(From the app, not said by Office\. Now: Wednesday 25 November 2026, 14:05\.\)$/, 'the state is labelled as the app\'s');
assert.match(liteState({ name: 'Office', now: NOW, facts: { open: 2, today: 1, week: 1, overdue: 0, none: 1, plan: [{ title: 'Budget review', todo: 'k3f9', start: at(25, 10), minutes: 60 }] } }), /To-dos: 2 open.*"Budget review" 10:00 to 11:00, id k3f9/);
assert.equal(liteBody('gemma-4-e4b', []).temperature, 0);
assert.deepEqual(liteBody('mlx-community/gemma-4-e4b-it-4bit', []).logit_bias, { 100: -100 }, 'Gemma 4\'s thinking channel is barred');
assert.equal(liteBody('qwen', []).logit_bias, undefined, 'only for a Gemma 4 model');
assert.equal(warmBody('m', 'Office').max_tokens, 1);
assert.deepEqual(warmBody('m', 'Office').messages, [{ role: 'system', content: liteSystem('Office') }], 'the warm-up sends the opening alone');

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

// ---- the runner: his words become what the real tools take
{
  const seen = [];
  const tool = (n) => ({ execute: async (a) => { seen.push([n, a]); return `ok ${n}`; } });
  let said = 'Remind me in 20 minutes to call Anna.';
  const run = createLiteRunner({ tool, titleOf: (id) => (id === 'k3f9' ? 'Budget review' : ''), readDaily: async () => '## Plan', now: () => NOW, said: () => said });
  let r = await run('remember_commitment', { text: 'call Anna', when: 'in 20 minutes' });
  assert.deepEqual(seen.pop(), ['remember_commitment', { text: 'call Anna', due: '2026-11-25T14:25:00', kind: 'reminder' }]);
  assert.equal(r.say, 'I\'ll remind you to call Anna at 14:25.');
  said = 'Add a to-do: finish the slides by Friday.';
  r = await run('remember_commitment', { text: 'finish the slides', when: 'Friday' });
  assert.deepEqual(seen.pop(), ['remember_commitment', { text: 'finish the slides', due: '2026-11-27', kind: 'commitment' }]);
  assert.equal(r.say, 'Saved "finish the slides", due on Friday 27 November.');
  r = await run('remember_commitment', { text: 'order antibodies', when: 'next Monday' });
  assert.deepEqual(r, { ask: 'Monday the 30th or Monday the 7th? Nothing was changed yet.' }); assert.equal(seen.length, 0, 'nothing saved before he says which');
  r = await run('update_commitment', { id: 'k3f9', status: 'done' });
  assert.equal(r.say, '"Budget review" is done.');
  await run('schedule_block', { title: 'ethics form', day: 'tomorrow', start: '10', end: '11' });
  assert.deepEqual(seen.pop(), ['schedule_block', { title: 'ethics form', date: 'tomorrow', start: '10:00', end: '11:00' }]);
  await run('move_block', { todo: 'p2x7', start: '16:30', end: '16:30' });
  assert.deepEqual(seen.pop(), ['move_block', { todo: 'p2x7', start: '16:30' }], 'an end that is the start is no end');
  await run('schedule_block', { title: 'x', day: 'next friday', start: '2', minutes: 60 });
  assert.deepEqual(seen.pop(), ['schedule_block', { title: 'x', date: 'next friday', start: '14:00', minutes: 60 }], 'the calendar asks which Friday itself');
  assert.deepEqual(await run('schedule_block', { title: 'x', start: '2' }), { ask: 'Which day do you mean? Nothing was changed.' });
  await run('show_day', { day: 'on Thursday' }); assert.deepEqual(seen.pop(), ['show_day', { date: 'thursday' }]);
  await run('list_commitments', { day: 'tomorrow' }); assert.deepEqual(seen.pop(), ['list_commitments', { due: 'tomorrow' }]);
  await run('open', { app: 'Zotero' }); assert.deepEqual(seen.pop(), ['open', { target: 'Zotero' }]);
  assert.deepEqual(await run('read_daily', {}), { ok: true, text: '## Plan' });
  const blocks = { schedule_block: async (a) => ({ text: 'for the model', say: `"${a.title}" is on the calendar.` }) };
  r = await createLiteRunner({ tool, blocks, now: () => NOW })('schedule_block', { title: 'Poster', day: 'tomorrow', start: '2' });
  assert.equal(r.say, '"Poster" is on the calendar.', 'the calendar\'s own line for him');
  r = await createLiteRunner({ tool: () => ({ execute: async () => { throw new Error('No commitment with id x9.'); } }), now: () => NOW })('update_commitment', { id: 'x9', status: 'done' });
  assert.deepEqual(r, { ok: false, text: 'No commitment with id x9.' });
  // where it is now (`from`), checked against the calendar and the to-do's due time
  seen.length = 0;
  const plan = [{ todo: 'k3f9', start: at(25, 10), minutes: 60 }, { todo: 'p2x7', start: at(25, 15), minutes: 60 }];
  const withPlan = createLiteRunner({ tool, now: () => NOW, planOf: async (d) => (d === 'today' ? plan : []), dueOf: async (id) => (id === 'c4' ? { ms: at(27, 0), dayOnly: true } : null) });
  await withPlan('move_block', { from: '3', start: '5' }); assert.deepEqual(seen.pop(), ['move_block', { todo: 'p2x7', start: '17:00' }], 'the block at that time');
  await withPlan('move_block', { todo: 'p2x7', from: 'at 3', start: '5' }); assert.deepEqual(seen.pop(), ['move_block', { todo: 'p2x7', start: '17:00' }]);
  assert.deepEqual(await withPlan('move_block', { todo: 'k3f9', from: '3', start: '5' }), { ask: 'Which block do you mean? Nothing was changed.' }, 'the id and the time disagree');
  assert.deepEqual(await withPlan('move_block', { from: '4', start: '5' }), { ask: 'Which block do you mean? Nothing was changed.' }, 'nothing there');
  assert.deepEqual(await withPlan('move_block', { from: 'thursday', start: '5' }), { ask: 'Which block do you mean? Nothing was changed.' });
  assert.deepEqual(await run('move_block', { todo: 'p2x7', from: '3', start: '5' }), { ask: 'Which block do you mean? Nothing was changed.' }, 'no calendar to check it against: asked');
  await withPlan('update_commitment', { id: 'c4', from: 'friday', when: 'monday' }); assert.deepEqual(seen.pop(), ['update_commitment', { id: 'c4', due: '2026-11-30' }]);
  assert.deepEqual(await withPlan('update_commitment', { id: 'c4', from: 'thursday', when: 'monday' }), { ask: 'Which to-do do you mean? Nothing was changed.' });
  assert.deepEqual(await withPlan('update_commitment', { id: 'c4', from: 'friday at 3', when: 'monday' }), { ask: 'Which to-do do you mean? Nothing was changed.' }, 'it has no time');
  assert.equal(seen.length, 0);
}

// ---- the request: a fake server answers in turn
const fake = (answers) => {
  const bodies = [];
  return { bodies, chat: async (body) => { bodies.push(JSON.parse(JSON.stringify(body))); const a = answers.shift() ?? { content: '' }; return { content: a.content ?? '', toolCalls: (a.calls ?? []).map((c, i) => ({ id: `c${bodies.length}_${i}`, name: c[0], args: JSON.stringify(c[1]) })), usage: { prompt_tokens: 10 }, firstMs: 5, noStreamRetries: a.retried ?? 0 }; } };
};
const okRun = async (name, args) => ({ ok: true, text: `ran ${name}`, ...(['remember_commitment', 'schedule_block', 'move_block', 'update_commitment', 'unschedule_block', 'write_note', 'open'].includes(name) ? { say: `${name} line` } : {}) });
const state1 = liteState({ name: 'Office', now: NOW }), state2 = liteState({ name: 'Office', now: NOW + 3600_000 });
{
  // a write tool: the line for him is code's, and the model is not asked again
  const f = fake([{ calls: [['update_commitment', { id: 'k3f9', status: 'done' }]] }]);
  const out = await liteRequest({ chat: f.chat, run: okRun, name: 'Office', model: 'm', said: 'I\'m done with the budget review.', state: state1 });
  assert.equal(out.by, 'tools'); assert.equal(out.reply, 'update_commitment line'); assert.equal(f.bodies.length, 1);
  assert.equal(f.bodies[0].transient_context.endsWith('Office: I\'m done with the budget review.'), true, 'his newest message is the transient part');
  // the opening is the same, byte for byte, at another time and with another state
  const g = fake([{ content: 'Hello.' }]);
  await liteRequest({ chat: g.chat, run: okRun, name: 'Office', model: 'm', said: 'Hi.', state: state2, history: [{ said: 'a', reply: 'b' }] });
  assert.equal(JSON.stringify(g.bodies[0].messages), JSON.stringify(f.bodies[0].messages));
  assert.equal(JSON.stringify(g.bodies[0].tools), JSON.stringify(LITE_TOOLS));
  assert.match(g.bodies[0].transient_context, /^Earlier in this conversation:\nOffice: a\nYou: b\n\n\(From the app/);
}
{
  // refused once, then made again with his words
  const f = fake([{ calls: [['schedule_block', { day: 'Monday', start: '14:00', title: 'literature search', minutes: 60 }]] }, { calls: [['schedule_block', { day: 'Monday', start: '2', title: 'literature search', minutes: 60 }]] }]);
  const ran = [];
  const out = await liteRequest({ chat: f.chat, run: async (n, a) => { ran.push(a); return okRun(n, a); }, name: 'Office', model: 'm', said: book, state: state1 });
  assert.equal(out.refusals, 1); assert.equal(ran.length, 1); assert.equal(ran[0].start, '2'); assert.equal(out.by, 'tools');
  const hint = f.bodies[1].messages.at(-1);
  assert.equal(hint.role, 'tool'); assert.match(hint.content, /^Refused, nothing was changed: start "14:00"/);
  assert.equal(f.bodies[1].messages[1].content, f.bodies[0].transient_context, 'later calls carry his message as an ordinary one');
}
{
  // a call that leaves out words he said: refused with the missing words named, then made whole
  const said = 'Push the budget review to Thursday at 9.';
  const f = fake([{ calls: [['move_block', { todo: 'k3f9', start: '9' }]] }, { calls: [['move_block', { todo: 'k3f9', day: 'Thursday', start: '9' }]] }]);
  const ran = [];
  const out = await liteRequest({ chat: f.chat, run: async (n, a) => { ran.push(a); return okRun(n, a); }, name: 'Office', model: 'm', said, state: state1, now: NOW });
  assert.deepEqual([out.refusals, ran.length, ran[0].day, out.by], [1, 1, 'Thursday', 'tools']);
  assert.deepEqual(out.calls[0].missing, ['thursday']);
  assert.match(f.bodies[1].messages.at(-1).content, /^Refused, nothing was changed: the call leaves out "thursday" \(day\)/);
  // left out twice: nothing is run, and a code-worded line asks him
  const g = fake([{ calls: [['move_block', { todo: 'k3f9', start: '9' }]] }, { calls: [['move_block', { todo: 'k3f9', start: 'at 9' }]] }]);
  let n = 0;
  const out2 = await liteRequest({ chat: g.chat, run: async () => { n++; return { ok: true, text: '' }; }, name: 'Office', model: 'm', said, state: state1, now: NOW });
  assert.deepEqual([out2.by, n], ['refused', 0]);
  assert.equal(out2.reply, 'Nothing was changed: I couldn\'t use "thursday". Could you say it again?');
  // one time unsaid and one left out: both in the hint; the second refusal for either check asks
  const h = fake([{ calls: [['schedule_block', { day: 'Monday', start: '14:00', title: 'x' }]] }, { content: 'Done.' }]);
  const out3 = await liteRequest({ chat: h.chat, run: okRun, name: 'Office', model: 'm', said: book, state: state1, now: NOW });
  assert.match(h.bodies[1].messages.at(-1).content, /start "14:00" is not Office's words.*leaves out "an hour"/);
  assert.deepEqual([out3.by, out3.reply], ['refused', 'What time do you mean? Nothing was changed.']);
}
{
  // refused twice: a code-worded line asks him, and nothing is run
  const f = fake([{ calls: [['remember_commitment', { text: 'parcel', when: '16:30' }]] }, { calls: [['remember_commitment', { text: 'parcel', when: '4:30 pm' }]] }]);
  let ran = 0;
  const out = await liteRequest({ chat: f.chat, run: async () => { ran++; return { ok: true, text: '' }; }, name: 'Office', model: 'm', said: 'Remind me at half past four to pick up the parcel.', state: state1 });
  assert.deepEqual([out.by, out.reply, ran, out.refusals], ['refused', 'What time do you mean? Nothing was changed.', 0, 2]);
}
{
  // refused, and then a reply of the model's own instead of a call: the code-worded line, not its words
  const f = fake([{ calls: [['schedule_block', { day: 'tomorrow', start: '10 am', title: 'x' }]] }, { content: 'Please tell me the time in your own words.' }]);
  const out = await liteRequest({ chat: f.chat, run: okRun, name: 'Office', model: 'm', said: 'Put x on my calendar tomorrow from 10 to 11.', state: state1 });
  assert.deepEqual([out.by, out.reply], ['refused', 'What time do you mean? Nothing was changed.']);
}
{
  // a claim with no tool result behind it is replaced
  const f = fake([{ content: 'I have marked the budget review as done.' }]);
  const out = await liteRequest({ chat: f.chat, run: okRun, name: 'Office', model: 'm', said: 'Mark the budget review done.', state: state1 });
  assert.deepEqual([out.by, out.reply], ['replaced', NOTHING_CHANGED]);
  // a read, then the model's answer, which may stand
  const g = fake([{ calls: [['show_day', { day: 'Thursday' }]] }, { content: 'You have the lab meeting at 9.' }]);
  const out2 = await liteRequest({ chat: g.chat, run: okRun, name: 'Office', model: 'm', said: 'What\'s on Thursday?', state: state1 });
  assert.deepEqual([out2.by, out2.reply, g.bodies.length], ['model', 'You have the lab meeting at 9.', 2]);
  // an empty answer after a read: the result itself, without its ids
  const h = fake([{ calls: [['show_day', { day: 'Thursday' }]] }, { content: '' }]);
  const out3 = await liteRequest({ chat: h.chat, run: async () => ({ ok: true, text: 'Thursday:\n09:00 to 10:00 (60 min): Lab meeting [m1]' }), name: 'Office', model: 'm', said: 'What\'s on Thursday?', state: state1 });
  assert.equal(out3.reply, 'Thursday:\n09:00 to 10:00 (60 min): Lab meeting');
}
{
  // a tool that isn't in the lite set, and arguments that aren't JSON, are refused
  const f = fake([{ calls: [['run_command', { cmd: 'ls' }]] }, { content: 'I can\'t do that here.' }]);
  const out = await liteRequest({ chat: f.chat, run: okRun, name: 'Office', model: 'm', said: 'List my files.', state: state1 });
  assert.equal(out.calls[0].refused, true); assert.equal(out.reply, 'I can\'t do that here.');
  // which of two days: the code-worded question, and nothing run
  const g = fake([{ calls: [['remember_commitment', { text: 'order antibodies', when: 'next Monday' }]] }]);
  const run = createLiteRunner({ tool: () => ({ execute: async () => assert.fail('nothing is saved') }), now: () => NOW });
  const out2 = await liteRequest({ chat: g.chat, run, name: 'Office', model: 'm', said: 'New task: order antibodies, due next Monday.', state: state1 });
  assert.deepEqual([out2.by, out2.reply], ['ask', 'Monday the 30th or Monday the 7th? Nothing was changed yet.']);
  // steps run out
  const h = fake(Array.from({ length: 9 }, () => ({ calls: [['show_day', { day: 'today' }]] })));
  const out3 = await liteRequest({ chat: h.chat, run: okRun, name: 'Office', model: 'm', said: 'What is on today?', state: state1, maxSteps: 2 });
  assert.equal(out3.by, 'steps'); assert.equal(h.bodies.length, 3);
  // the no-stream retries are counted
  const k = fake([{ retried: 1, calls: [['open', { app: 'Zotero' }]] }]);
  assert.equal((await liteRequest({ chat: k.chat, run: okRun, name: 'Office', model: 'm', said: 'Open Zotero.', state: state1 })).noStreamRetries, 1);
}
console.log('lite tests passed');
