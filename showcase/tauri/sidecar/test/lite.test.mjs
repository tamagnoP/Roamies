// Local-only build, feature 23: the lite request for the local model (lite.mjs): the opening, the runner, the request
// loop with the checks of checks.mjs (tested on their own in checks.test.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NOTHING_CHANGED, ONE_AT_A_TIME, createRequestCheck } from '../checks.mjs';
import { LITE_NAMES, LITE_TOOLS, createLiteRunner, liteBody, liteRequest, liteState, liteSystem, warmBody } from '../lite.mjs';

const NOW = new Date(2026, 10, 25, 14, 5).getTime(); // a Wednesday
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();

// ---- the opening is fixed: no time, no state; the tool set is exactly the lite set, by their real names, and none
// of its tools takes a time, a day or a length
assert.equal(liteSystem('Office'), liteSystem('Office'));
assert.doesNotMatch(liteSystem('Office'), /2026|November|14:05/);
assert.deepEqual(LITE_NAMES, ['remember_commitment', 'update_commitment', 'list_commitments', 'schedule_block', 'move_block', 'unschedule_block', 'show_day', 'write_note', 'search_notes', 'read_note', 'read_daily', 'open']);
for (const t of LITE_TOOLS) {
  const fields = Object.keys(t.function.parameters.properties);
  assert.ok(!fields.some((f) => /^(when|day|date|start|end|minutes|from|due|time)$/.test(f)), `${t.function.name}: no time field (${fields})`);
}
assert.match(liteState({ name: 'Office', now: NOW }), /^\(From the app, not said by Office\. Now: Wednesday 25 November 2026, 14:05\.\)$/, 'the state is labelled as the app\'s');
const st = liteState({ name: 'Office', now: NOW, facts: { open: 2, today: 1, week: 1, overdue: 0, none: 1, plan: [{ title: 'Budget review', todo: 'k3f9', start: at(25, 10), minutes: 60 }] } });
assert.match(st, /To-dos: 2 open.*"Budget review" 10:00 to 11:00\.\)$/); assert.doesNotMatch(st, /k3f9/, 'no ids: the model names a to-do by its title');
assert.equal(liteBody('gemma-4-e4b', []).temperature, 0);
assert.deepEqual(liteBody('mlx-community/gemma-4-e4b-it-4bit', []).logit_bias, { 100: -100 }, 'Gemma 4\'s thinking channel is barred');
assert.equal(liteBody('qwen', []).logit_bias, undefined, 'only for a Gemma 4 model');
assert.equal(warmBody('m', 'Office').max_tokens, 1);
assert.deepEqual(warmBody('m', 'Office').messages, [{ role: 'system', content: liteSystem('Office') }], 'the warm-up sends the opening alone');

// ---- the runner: the call and his times, placed by code, become what the real tools take
const TODOS = [{ id: 'k3f9', title: 'Budget review' }, { id: 'p2x7', title: 'Grant report draft' }, { id: 't5', title: 'Thesis chapter 2' }, { id: 'c4', title: 'Slides' }];
const PLAN = [{ todo: 'k3f9', title: 'Budget review', start: at(25, 10), minutes: 60 }, { todo: 'p2x7', title: 'Grant report draft', start: at(25, 15), minutes: 60 }];
{
  const seen = [];
  const tool = (n) => ({ execute: async (a) => { seen.push([n, a]); return `ok ${n}`; } });
  let said = '';
  const run = createLiteRunner({ tool, todos: async () => TODOS, readDaily: async () => '## Plan', now: () => NOW, said: () => said, planOf: async (d) => (d === 'today' ? PLAN : []), dueOf: async (id) => (id === 'c4' ? { ms: at(27, 0), dayOnly: true } : null) });
  const go = (s, name, args) => { said = s; const c = createRequestCheck({ said: s, now: NOW }); return run(name, args, (n, a, o) => c.place(n, a, o)); };
  let r = await go('Remind me in 20 minutes to call Anna.', 'remember_commitment', { text: 'call Anna' });
  assert.deepEqual(seen.pop(), ['remember_commitment', { text: 'call Anna', due: '2026-11-25T14:25:00', kind: 'reminder' }]);
  assert.equal(r.say, 'I\'ll remind you to call Anna at 14:25.');
  r = await go('Add a to-do: finish the slides by Friday.', 'remember_commitment', { text: 'finish the slides', when: 'Monday' });
  assert.deepEqual(seen.pop(), ['remember_commitment', { text: 'finish the slides', due: '2026-11-27', kind: 'commitment' }], 'a time field the model sends anyway is not read');
  assert.equal(r.say, 'Saved "finish the slides", due on Friday 27 November.');
  assert.deepEqual(await go('New task: order antibodies, due next Monday.', 'remember_commitment', { text: 'order antibodies' }), { ask: 'Monday the 30th or Monday the 7th? Nothing was changed yet.' });
  assert.deepEqual(await go('Remind me to call Anna.', 'remember_commitment', { text: 'call Anna' }), { ask: 'When should I remind you? Nothing was changed.' });
  r = await go('I\'m done with the budget review.', 'update_commitment', { todo: 'the budget review', status: 'done' });
  assert.deepEqual(seen.pop(), ['update_commitment', { id: 'k3f9', status: 'done' }]); assert.equal(r.say, '"Budget review" is done.');
  assert.deepEqual(await go('I\'m done with the poster.', 'update_commitment', { todo: 'poster', status: 'done' }), { ask: 'Which to-do do you mean? Nothing was changed.' });
  await go('The slides are now due Monday.', 'update_commitment', { todo: 'slides' }); assert.deepEqual(seen.pop(), ['update_commitment', { id: 'c4', due: '2026-11-30' }]);
  await go('Move the slides from Friday to Monday.', 'update_commitment', { todo: 'slides' }); assert.deepEqual(seen.pop(), ['update_commitment', { id: 'c4', due: '2026-11-30' }]);
  assert.deepEqual(await go('Move the slides from Thursday to Monday.', 'update_commitment', { todo: 'slides' }), { ask: 'Which to-do do you mean? Nothing was changed.' }, 'it isn\'t due Thursday');
  await go('Put the ethics form on my calendar tomorrow from 10 to 11.', 'schedule_block', { todo: 'ethics form' });
  assert.deepEqual(seen.pop(), ['schedule_block', { title: 'ethics form', date: 'tomorrow', start: '10:00', end: '11:00' }], 'no to-do of that title: a new block');
  await go('Schedule 45 minutes for the grant report draft tomorrow at 11.', 'schedule_block', { todo: 'grant report draft' });
  assert.deepEqual(seen.pop(), ['schedule_block', { todo: 'p2x7', date: 'tomorrow', start: '11:00', minutes: 45 }]);
  assert.deepEqual(await go('Book the thesis chapter for Friday.', 'schedule_block', { todo: 'thesis chapter' }), { ask: 'What time? For how long? Nothing was changed.' });
  await go('Move the grant report draft from 3 to half past four.', 'move_block', { todo: 'grant report draft' });
  assert.deepEqual(seen.pop(), ['move_block', { todo: 'p2x7', start: '16:30' }], 'the block at 3 starts at half past four');
  await go('Move the 3 o\'clock from 3 to 5.', 'move_block', { todo: 'the 3 o\'clock' }); assert.deepEqual(seen.pop(), ['move_block', { todo: 'p2x7', start: '17:00' }], 'no title: the only block there');
  assert.deepEqual(await go('Move the budget review from 3 to 5.', 'move_block', { todo: 'budget review' }), { ask: 'Which block do you mean? Nothing was changed.' }, 'the title and the time disagree');
  assert.deepEqual(await go('Move it from 4 to 5.', 'move_block', { todo: 'it' }), { ask: 'Which block do you mean? Nothing was changed.' }, 'nothing there');
  await go('Push the budget review to Thursday at 9.', 'move_block', { todo: 'budget review' }); assert.deepEqual(seen.pop(), ['move_block', { todo: 'k3f9', date: 'thursday', start: '09:00' }]);
  assert.deepEqual(await go('Move the poster to Thursday.', 'move_block', { todo: 'poster' }), { ask: 'Which to-do do you mean? Nothing was changed.' });
  await go('Take the grant report draft off the calendar.', 'unschedule_block', { todo: 'grant report draft' }); assert.deepEqual(seen.pop(), ['unschedule_block', { todo: 'p2x7' }]);
  await go('What have I got on Thursday?', 'show_day', {}); assert.deepEqual(seen.pop(), ['show_day', { date: 'thursday' }]);
  await go('Do I have any to-dos due tomorrow?', 'list_commitments', {}); assert.deepEqual(seen.pop(), ['list_commitments', { due: 'tomorrow' }]);
  await go('Note: the seminar is on Friday at 3.', 'write_note', { title: 'Seminar', content: 'The seminar is on Friday at 3.' }); assert.deepEqual(seen.pop(), ['write_note', { title: 'Seminar', content: 'The seminar is on Friday at 3.' }], 'times in a note stay in its text');
  await go('Open Zotero.', 'open', { app: 'Zotero' }); assert.deepEqual(seen.pop(), ['open', { target: 'Zotero' }]);
  assert.deepEqual(await go('Read my daily note.', 'read_daily', {}), { ok: true, text: '## Plan' });
  assert.equal(seen.length, 0, 'nothing else ran');
  const blocks = { schedule_block: async (a) => ({ text: 'for the model', say: `"${a.title}" is on the calendar.` }) };
  said = 'Book the poster tomorrow at 2 for an hour.';
  const c = createRequestCheck({ said, now: NOW });
  r = await createLiteRunner({ tool, blocks, now: () => NOW, said: () => said })('schedule_block', { todo: 'Poster' }, (n, a, o) => c.place(n, a, o));
  assert.equal(r.say, '"Poster" is on the calendar.', 'the calendar\'s own line for him');
  const broken = createLiteRunner({ tool: () => ({ execute: async () => { throw new Error('No commitment with id k3f9.'); } }), todos: async () => TODOS, now: () => NOW });
  assert.deepEqual(await broken('update_commitment', { todo: 'budget review', status: 'done' }), { ok: false, text: 'No commitment with id k3f9.' });
}

// ---- the request: a fake server answers in turn
const fake = (answers) => {
  const bodies = [];
  return { bodies, chat: async (body) => { bodies.push(JSON.parse(JSON.stringify(body))); const a = answers.shift() ?? { content: '' }; return { content: a.content ?? '', toolCalls: (a.calls ?? []).map((c, i) => ({ id: `c${bodies.length}_${i}`, name: c[0], args: JSON.stringify(c[1]) })), usage: { prompt_tokens: 10 }, firstMs: 5, noStreamRetries: a.retried ?? 0 }; } };
};
const okRun = async (name, args, place) => { const p = place(name, args, {}); if (p.ask) return p; return { ok: true, text: `ran ${name}`, ...(['remember_commitment', 'schedule_block', 'move_block', 'update_commitment', 'unschedule_block', 'write_note', 'open'].includes(name) ? { say: `${name} line` } : {}) }; };
const state1 = liteState({ name: 'Office', now: NOW }), state2 = liteState({ name: 'Office', now: NOW + 3600_000 });
{
  // a write tool: the line for him is code's, and the model is not asked again
  const f = fake([{ calls: [['update_commitment', { todo: 'budget review', status: 'done' }]] }]);
  const out = await liteRequest({ chat: f.chat, run: okRun, name: 'Office', model: 'm', said: 'I\'m done with the budget review.', state: state1, now: NOW });
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
  // a time the action needs and he didn't say: the code-worded question, nothing run, the model not asked again
  const f = fake([{ calls: [['schedule_block', { todo: 'literature search' }]] }]);
  const out = await liteRequest({ chat: f.chat, run: okRun, name: 'Office', model: 'm', said: 'Book the literature search on Monday.', state: state1, now: NOW });
  assert.deepEqual([out.by, out.reply, f.bodies.length], ['ask', 'What time? For how long? Nothing was changed.', 1]);
  // a time that can't be placed for the action
  const g = fake([{ calls: [['update_commitment', { todo: 'budget review', status: 'done' }]] }]);
  const out2 = await liteRequest({ chat: g.chat, run: okRun, name: 'Office', model: 'm', said: 'Mark the budget review done and book the poster tomorrow at 2.', state: state1, now: NOW });
  assert.deepEqual([out2.by, out2.reply], ['ask', 'I couldn\'t place "tomorrow" and "2" for that. Nothing was changed: could you say it again?']);
}
{
  // two changes in one request: neither runs, a code-worded line asks for one at a time
  const f = fake([{ calls: [['update_commitment', { todo: 'budget review', status: 'done' }], ['remember_commitment', { text: 'call home' }]] }]);
  let ran = 0;
  const out = await liteRequest({ chat: f.chat, run: async (...a) => { ran++; return okRun(...a); }, name: 'Office', model: 'm', said: 'Mark the budget review done and add a to-do to call home.', state: state1, now: NOW });
  assert.deepEqual([out.by, out.reply, ran], ['one', ONE_AT_A_TIME, 0]);
  // a read and a change together are one change
  const g = fake([{ calls: [['show_day', {}], ['open', { app: 'Zotero' }]] }]);
  const out2 = await liteRequest({ chat: g.chat, run: okRun, name: 'Office', model: 'm', said: 'Open Zotero and tell me what is on today.', state: state1, now: NOW });
  assert.notEqual(out2.by, 'one'); assert.match(out2.reply, /^open line/);
}
{
  // a claim with no tool result behind it is replaced
  const f = fake([{ content: 'I have marked the budget review as done.' }]);
  const out = await liteRequest({ chat: f.chat, run: okRun, name: 'Office', model: 'm', said: 'Mark the budget review done.', state: state1 });
  assert.deepEqual([out.by, out.reply], ['replaced', NOTHING_CHANGED]);
  // a read the model chose, then its answer, which may stand
  const g = fake([{ calls: [['show_day', {}]] }, { content: 'You have the lab meeting at 9.' }]);
  const out2 = await liteRequest({ chat: g.chat, run: okRun, name: 'Office', model: 'm', said: 'Anything on Thursday I should know about?', state: state1 });
  assert.deepEqual([out2.by, out2.reply, g.bodies.length], ['model', 'You have the lab meeting at 9.', 2]);
  assert.equal(g.bodies[1].messages[1].content, g.bodies[0].transient_context, 'later calls carry his message as an ordinary one');
  // looking up a day, decided by code: show_day runs first, whatever the model would choose; the model only words it
  const g2 = fake([{ content: 'You have the lab meeting at 9.' }]);
  const out4 = await liteRequest({ chat: g2.chat, run: okRun, name: 'Office', model: 'm', said: 'What\'s on Thursday?', state: state1 });
  assert.deepEqual([out4.by, out4.reply, g2.bodies.length, out4.calls], ['model', 'You have the lab meeting at 9.', 1, [{ name: 'show_day', args: {}, ok: true, by: 'code' }]]);
  assert.equal(g2.bodies[0].transient_context, undefined); assert.deepEqual(g2.bodies[0].messages.slice(2).map((m) => m.role), ['assistant', 'tool']);
  assert.equal(g2.bodies[0].messages[2].tool_calls[0].function.name, 'show_day'); assert.equal(g2.bodies[0].messages[3].content, 'ran show_day');
  // an empty answer after a read: the result itself, without its ids
  const h = fake([{ content: '' }]);
  const out3 = await liteRequest({ chat: h.chat, run: async () => ({ ok: true, text: 'Thursday:\n09:00 to 10:00 (60 min): Lab meeting [m1]' }), name: 'Office', model: 'm', said: 'What\'s on Thursday?', state: state1 });
  assert.equal(out3.reply, 'Thursday:\n09:00 to 10:00 (60 min): Lab meeting');
}
{
  // a tool that isn't in the lite set is refused
  const f = fake([{ calls: [['run_command', { cmd: 'ls' }]] }, { content: 'I can\'t do that here.' }]);
  const out = await liteRequest({ chat: f.chat, run: okRun, name: 'Office', model: 'm', said: 'List my files.', state: state1 });
  assert.equal(out.calls[0].ok, false); assert.equal(out.reply, 'I can\'t do that here.');
  // steps run out
  const h = fake(Array.from({ length: 9 }, () => ({ calls: [['show_day', {}]] })));
  const out3 = await liteRequest({ chat: h.chat, run: okRun, name: 'Office', model: 'm', said: 'What is on today?', state: state1, maxSteps: 2 });
  assert.equal(out3.by, 'steps'); assert.equal(h.bodies.length, 3);
  // the no-stream retries are counted
  const k = fake([{ retried: 1, calls: [['open', { app: 'Zotero' }]] }]);
  assert.equal((await liteRequest({ chat: k.chat, run: okRun, name: 'Office', model: 'm', said: 'Open Zotero.', state: state1 })).noStreamRetries, 1);
}
{
  // what code decided is saved at once; a change the model chose is shown first, and saved only on a yes
  const seen = [], asked = [];
  const tool = (n) => ({ execute: async (a) => { seen.push([n, a]); return `ok ${n}`; } });
  let said = '';
  const run = createLiteRunner({ tool, todos: async () => TODOS, readDaily: async () => '', now: () => NOW, said: () => said, planOf: async (d) => (d === 'today' ? PLAN : []), dueOf: async () => null });
  const req = (s, answers, o = {}) => { said = s; const f = fake(answers); return liteRequest({ chat: f.chat, run, name: 'Office', model: 'm', said: s, state: state1, now: NOW, items: TODOS, ...o }).then((out) => ({ out, f })); };
  const answer = (a) => async (p) => { asked.push(p.question); return a; };

  // a reminder code reads whole: no model call
  let { out, f } = await req('Remind me at half past four to pick up the parcel.', []);
  assert.deepEqual([out.by, out.reply, f.bodies.length], ['code', 'I\'ll remind you to pick up the parcel at 16:30.', 0]);
  assert.deepEqual(seen.pop(), ['remember_commitment', { text: 'pick up the parcel', due: '2026-11-25T16:30:00', kind: 'reminder' }]);
  // the persona's name before it (localroute.mjs passes settings' persona.name)
  ({ out, f } = await req('Jarvis, please remind me at half past four to pick up the parcel.', [], { persona: 'Jarvis' }));
  assert.deepEqual([out.by, f.bodies.length], ['code', 0]); assert.equal(seen.pop()[1].text, 'pick up the parcel');
  assert.match(fs.readFileSync(new URL('../localroute.mjs', import.meta.url), 'utf8'), /persona: s\.persona\?\.name \?\? ''/);
  // one it can't read whole goes to the model, and "remind me" still decides: saved at once
  ({ out, f } = await req('Remind me tomorrow to buy milk.', [{ calls: [['remember_commitment', { text: 'buy milk' }]] }], { confirm: answer(null) }));
  assert.deepEqual([out.by, f.bodies.length, asked.length], ['tools', 1, 0]); assert.deepEqual(seen.pop(), ['remember_commitment', { text: 'buy milk', due: '2026-11-26', kind: 'reminder' }]);

  // code decided a due time; the model chose to move the block: code's action runs, at once
  ({ out } = await req('The grant report draft is now due on Tuesday.', [{ calls: [['move_block', { todo: 'Grant report draft' }]] }], { confirm: answer(null) }));
  assert.deepEqual(seen.pop(), ['update_commitment', { id: 'p2x7', due: '2026-12-01' }]);
  assert.deepEqual([out.by, out.reply, out.calls[0].by, asked.length], ['tools', '"Grant report draft" is now due on Tuesday 1 December.', 'code', 0]);

  // the model chose: shown, and with no answer nothing is saved
  ({ out } = await req('Move the budget review to tomorrow at 10.', [{ calls: [['move_block', { todo: 'Budget review' }]] }], { confirm: answer(null) }));
  assert.deepEqual([out.by, out.reply, seen.length], ['unanswered', 'Nothing was changed.', 0]);
  assert.equal(asked.pop(), 'Move the block for "Budget review" to tomorrow at 10:00?');
  assert.deepEqual(out.shown, { tool: 'move_block', args: { todo: 'k3f9', date: 'tomorrow', start: '10:00' }, question: 'Move the block for "Budget review" to tomorrow at 10:00?' });
  // a no: nothing saved
  ({ out } = await req('Move the budget review to tomorrow at 10.', [{ calls: [['move_block', { todo: 'Budget review' }]] }], { confirm: answer(false) }));
  assert.deepEqual([out.by, out.reply, seen.length], ['declined', 'Nothing was changed.', 0]);
  // a yes: saved, then code's line
  ({ out } = await req('Move the budget review to tomorrow at 10.', [{ calls: [['move_block', { todo: 'Budget review' }]] }], { confirm: answer(true) }));
  assert.deepEqual(seen.pop(), ['move_block', { todo: 'k3f9', date: 'tomorrow', start: '10:00' }]); assert.equal(out.by, 'tools'); assert.equal(out.calls[0].answer, 'yes');
  // an answer that fails (the bubble closed by an error) is no answer
  ({ out } = await req('Move the budget review to tomorrow at 10.', [{ calls: [['move_block', { todo: 'Budget review' }]] }], { confirm: async () => { throw new Error('closed'); } }));
  assert.deepEqual([out.by, seen.length], ['unanswered', 0]);
  // without a way to ask, nothing the model chose is saved
  ({ out } = await req('Move the budget review to tomorrow at 10.', [{ calls: [['move_block', { todo: 'Budget review' }]] }]));
  assert.deepEqual([out.by, seen.length], ['unanswered', 0]);
  // local.confirmChanges false: saved at once
  asked.length = 0;
  ({ out } = await req('Move the budget review to tomorrow at 10.', [{ calls: [['move_block', { todo: 'Budget review' }]] }], { confirm: answer(null), confirmChanges: false }));
  assert.deepEqual([out.by, asked.length], ['tools', 0]); assert.equal(seen.pop()[0], 'move_block');
  // a question about a time comes before any yes/no: nothing is shown
  ({ out } = await req('Book the literature search on Monday.', [{ calls: [['schedule_block', { todo: 'literature search' }]] }], { confirm: answer(true) }));
  assert.deepEqual([out.by, asked.length, seen.length], ['ask', 0, 0]);
  // reads never ask
  ({ out } = await req('What have I got on Friday?', [{ content: 'Nothing on Friday.' }], { confirm: answer(null) }));
  assert.deepEqual([out.reply, asked.length, out.calls[0].by], ['Nothing on Friday.', 0, 'code']); assert.deepEqual(seen.pop(), ['show_day', { date: 'friday' }]);
  // a change decided by code for an open to-do needs its whole title: part of it goes to the model and is shown
  ({ out } = await req('I\'ve finished the thesis chapter.', [{ calls: [['update_commitment', { todo: 'Thesis chapter 2', status: 'done' }]] }], { confirm: answer(null) }));
  assert.deepEqual([out.by, seen.length, asked.pop()], ['unanswered', 0, 'Mark "Thesis chapter 2" as done?']);
  // open: the app as he named it, not the model's
  ({ out } = await req('Open Zotero.', [{ calls: [['open', { app: 'Zotero 7' }]] }]));
  assert.deepEqual(seen.pop(), ['open', { target: 'Zotero' }]); assert.equal(out.calls[0].by, 'code');
  // with no tool called, a promise is replaced
  ({ out } = await req('Remind me about the seminar.', [{ content: 'I will remember the seminar.' }]));
  assert.deepEqual([out.by, out.reply], ['replaced', 'Nothing was changed.']);
  assert.equal(seen.length, 0, 'nothing else ran');
}
console.log('lite tests passed');
