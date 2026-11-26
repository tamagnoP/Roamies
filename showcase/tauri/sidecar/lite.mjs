// Local-only build (feature 23): the lite request for the local model.
//
// The opening (the prompt and the tools) is fixed byte for byte for a given name, so the server can reuse it: no
// time, no state, nothing that changes is in it. What changes goes in the newest message, labelled as coming from the
// app. The model chooses the action and the to-do, by its title; its tools have no time, day or length fields. Code
// reads those from his sentence and places them by the action (checks.mjs), with the other checks: one change per
// request, no unconfirmed claims, code-worded lines after a change. What code decided from his words (checks.mjs's
// DECIDED) is saved at once; a change the model chose is shown first as a code-worded question for a yes
// (`local.confirmChanges`); a reminder code can read whole is made with no model call. Here are the prompt, the
// tools, the runner that turns a call and the placed times into the real tools' arguments, and the request loop.
import { NOT_SAVED, changeQuestion, createRequestCheck, kindFor, matchTitle, reminderByCode, reminderLine, updateLine } from './checks.mjs';
import { ymd } from './daily.mjs';

export const LITE_MAX_TOKENS = 200;

/** The fixed prompt. `name` is the owner's name from the settings. */
export function liteSystem(name) {
  return `You are ${name}'s companion on his Mac, answering on the Mac itself while the main assistant is not in use. Answers are spoken: one or two short plain sentences, no lists, no markdown.
You can only: keep his to-dos and reminders, put to-dos on his calendar and say what is on it, keep notes in his notes vault, read today's daily note when he asks for it, and open an app he names. Call a tool for each of these; never say something is done unless a tool's result says so.
Choose the tool for what he asks and name the to-do by its title, in his words. Never give a time, a day or a length: the app reads them from what he said.
For anything else (files, coding, the web, the screen, drawing, clicking in apps) say in one sentence that you can't do that here, and do nothing.`;
}

const fn = (name, description, properties, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
const S = { type: 'string' };
const TODO = { type: 'string', description: 'the to-do\'s title, in his words' };
/** The fixed tool set: names are the real names, bare; no time, day or length fields. */
export const LITE_TOOLS = [
  fn('remember_commitment', 'Save a to-do or a reminder ("remind me", "add a to-do", "new task", something due). text: what to do, in his words.', { text: S }, ['text']),
  fn('update_commitment', 'For a to-do or reminder: mark it done or dropped (status), or, without status, change when it is due.', { todo: TODO, status: { type: 'string', enum: ['done', 'dropped'] } }, ['todo']),
  fn('list_commitments', 'Find his to-dos: words from a title, or those due on a day he names. Without words: by that day, or how many are open.', { words: S }),
  fn('schedule_block', 'Put something on the calendar as a block of time, when he asks to book, block or schedule time or to put it on the calendar.', { todo: { type: 'string', description: 'the to-do\'s title, or what the time is for, in his words' } }, ['todo']),
  fn('move_block', 'Move a block that is on the calendar to another day or time, or change its length.', { todo: TODO }, ['todo']),
  fn('unschedule_block', 'Take a to-do\'s block off the calendar.', { todo: TODO }, ['todo']),
  fn('show_day', 'What is on the calendar on the day he names, or today.', {}),
  fn('write_note', 'Save a note. title: a few plain words. content: his words, tidied.', { title: S, content: S, append: { type: 'boolean' } }, ['title', 'content']),
  fn('search_notes', 'Search his notes by words.', { query: S }, ['query']),
  fn('read_note', 'Read one note by its title.', { title: S }, ['title']),
  fn('read_daily', 'Read today\'s daily note (its plan and log), only when he asks for it.', {}),
  fn('open', 'Open the app he names. app: its name.', { app: S }, ['app']),
];
export const LITE_NAMES = LITE_TOOLS.map((t) => t.function.name);

const pad = (n) => String(n).padStart(2, '0');
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The newest message's state line, labelled as the app's: the time, the to-do counts and today's blocks.
 *  facts: { open, today, week, overdue, none, plan: [{ title, todo, start, minutes }] } */
export function liteState({ name, now = Date.now(), facts = null }) {
  const d = new Date(now);
  const when = `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const parts = [`Now: ${when}.`];
  if (facts) {
    parts.push(`To-dos: ${facts.open} open, ${facts.today} due today, ${facts.week} this week, ${facts.overdue} overdue, ${facts.none} without a date.`);
    const hm = (ms) => { const x = new Date(ms); return `${pad(x.getHours())}:${pad(x.getMinutes())}`; };
    parts.push(facts.plan?.length ? `Today's blocks: ${facts.plan.map((b) => `"${b.title}" ${hm(b.start)} to ${hm(b.start + b.minutes * 60_000)}`).join('; ')}.` : 'Nothing is on the calendar today.');
  }
  return `(From the app, not said by ${name}. ${parts.join(' ')})`;
}
/** Runs a lite call through the real tools, with his times as code placed them. tool(name) → the tool object
 *  ({ execute }); blocks: { schedule_block, move_block } → (args, signal) → { text, say } (the calendar's own line for
 *  him); todos() → the open to-dos [{ id, title }]; readDaily() → today's daily note as text; planOf(day, as the
 *  calendar tools take it) → that day's blocks [{ todo, title, start (ms), minutes }]; dueOf(id) → { ms, dayOnly } or
 *  null. Called as run(name, args, place, signal, { confirm }), place(name, args, { title }) → { places } or { ask }
 *  (the request's check); confirm({ tool, args, question }) → true (yes), false (no) or null (no answer), asked
 *  before a change is saved, when given. → { ok, text, say } (say: the line for him, for a tool that changes
 *  something), { ask } (a code-worded line), or { declined: 'no' | 'none', tool, args, question } (shown, not saved). */
export function createLiteRunner({ tool, blocks = {}, todos = async () => [], readDaily, now = () => Date.now(), said = () => '', planOf = async () => [], dueOf = async () => null }) {
  const fail = (e) => ({ ok: false, text: String(e?.message ?? e).slice(0, 600) });
  const run = async (name, args, signal) => {
    const t = tool(name);
    if (!t) return { ok: false, text: `No tool ${name}.` };
    try { return { ok: true, text: String(await t.execute(args, { signal }) ?? '') }; } catch (e) { return fail(e); }
  };
  const isoAt = (ms) => { const d = new Date(ms); return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const dueArg = (due) => (due ? (due.dayOnly ? ymd(new Date(due.ms)) : isoAt(due.ms)) : undefined);
  const hm = (ms) => { const x = new Date(ms); return `${pad(x.getHours())}:${pad(x.getMinutes())}`; };
  const sameDue = (a, b) => !!a && !!b && ymd(new Date(a.ms)) === ymd(new Date(b.ms)) && (a.dayOnly || (!b.dayOnly && hm(a.ms) === hm(b.ms)));
  const which = { ask: 'Which to-do do you mean? Nothing was changed.' };
  const find = async (given) => matchTitle(given, [...await todos(), ...(await planOf('today')).map((b) => ({ id: b.todo, title: b.title }))].filter((x) => x.id && x.title));
  const changed = (r) => (r.ok ? { ...r, say: r.say ?? r.text } : r);
  return async function liteRun(name, a = {}, place = () => ({ places: {} }), signal, { confirm = null } = {}) {
    // A change, shown first when confirm is given: nothing is saved without a yes.
    const commit = async (tool, args, title, exec) => {
      if (confirm) {
        const question = changeQuestion({ tool, args, title, now: now() });
        let yes = null;
        try { yes = await confirm({ tool, args, question }); } catch { yes = null; }
        if (yes !== true) return { declined: yes === false ? 'no' : 'none', tool, args, question };
      }
      return exec();
    };
    const titled = ['update_commitment', 'schedule_block', 'move_block', 'unschedule_block'].includes(name);
    const found = titled ? await find(a.todo) : null;
    if (found?.ask) return found;
    const p = place(name, a, { title: found?.title ?? (titled ? String(a.todo ?? '') : '') });
    if (p.ask) return { ask: p.ask };
    const pl = p.places ?? {};
    switch (name) {
      case 'remember_commitment': {
        const kind = kindFor(said()), text = String(a.text ?? '').trim(), args = { text, ...(pl.due ? { due: dueArg(pl.due) } : {}), kind };
        return commit(name, args, text, async () => {
          const r = await run(name, args, signal);
          return r.ok ? { ...r, say: reminderLine({ text, kind, ms: pl.due?.ms ?? null, dayOnly: !!pl.due?.dayOnly, now: now() }) } : r;
        });
      }
      case 'update_commitment': {
        if (found.none) return which;
        if (pl.from && !sameDue(pl.from, await dueOf(found.id))) return which;
        const args = { id: found.id, ...(a.status ? { status: a.status } : {}), ...(pl.due ? { due: dueArg(pl.due) } : {}) };
        return commit(name, args, found.title, async () => {
          const r = await run(name, args, signal);
          return r.ok ? { ...r, say: updateLine({ title: found.title, status: a.status ?? '', ms: pl.due?.ms ?? null, dayOnly: !!pl.due?.dayOnly, now: now() }) } : r;
        });
      }
      case 'list_commitments': return run(name, { ...(a.words ? { words: String(a.words) } : {}), ...(pl.due ? { due: pl.due } : {}) }, signal);
      case 'schedule_block': case 'move_block': {
        let id = found.none ? '' : found.id;
        if (name === 'move_block' && pl.from) {
          const at = (await planOf(pl.from.date)).filter((b) => !pl.from.clock || hm(b.start) === pl.from.clock);
          if (id ? !at.some((b) => b.todo === id) : at.length !== 1) return { ask: 'Which block do you mean? Nothing was changed.' };
          id ||= at[0].todo;
        }
        if (name === 'move_block' && !id) return which;
        const args = { ...(id ? { todo: id } : { title: String(a.todo ?? '').trim() }), ...(pl.date ? { date: pl.date } : {}), ...(pl.start ? { start: pl.start } : {}), ...(pl.end ? { end: pl.end } : {}), ...(pl.minutes ? { minutes: pl.minutes } : {}) };
        return commit(name, args, found.none ? '' : found.title, async () => {
          if (blocks[name]) { try { const r = await blocks[name](args, signal); return { ok: true, text: String(r?.text ?? ''), say: String(r?.say ?? r?.text ?? '') }; } catch (err) { return fail(err); } }
          return changed(await run(name, args, signal));
        });
      }
      case 'unschedule_block': return found.none ? which : commit(name, { todo: found.id }, found.title, async () => changed(await run(name, { todo: found.id }, signal)));
      case 'show_day': return run(name, { date: pl.date ?? 'today' }, signal);
      case 'write_note': { const args = { title: String(a.title ?? ''), content: String(a.content ?? ''), ...(a.append === true ? { append: true } : {}) }; return commit(name, args, args.title, async () => changed(await run(name, args, signal))); }
      case 'search_notes': return run(name, { query: String(a.query ?? '') }, signal);
      case 'read_note': return run(name, { title: String(a.title ?? '') }, signal);
      case 'read_daily': try { return { ok: true, text: String(await readDaily() ?? '') || 'Today\'s daily note is empty.' }; } catch (e) { return fail(e); }
      case 'open': { const args = { target: String(a.app ?? '') }; return commit(name, args, args.target, async () => changed(await run(name, args, signal))); }
      default: return { ok: false, text: `No tool ${name}.` };
    }
  };
}

/** The fixed arguments of every lite request. */
/** Gemma 4 opens its thinking channel by itself after a refused call, even with thinking off, and spends the reply on
 *  it: for a Gemma 4 model the channel's opening token (100) is barred. */
export const NO_THINKING = (model) => (/gemma-4/i.test(String(model ?? '')) ? { logit_bias: { 100: -100 } } : {});
export const liteBody = (model, messages, extra = {}) => ({ ...(model ? { model } : {}), temperature: 0, max_tokens: LITE_MAX_TOKENS, enable_thinking: false, ...NO_THINKING(model), tools: LITE_TOOLS, messages, ...extra });
/** The fixed opening alone, for the warm-up: the server keeps it, so the first real request doesn't read it. */
export const warmBody = (model, name) => ({ ...liteBody(model, [{ role: 'system', content: liteSystem(name) }], { transient_context: `(From the app, not said by ${name}. A warm-up: answer with one word.)` }), max_tokens: 1 });

/** His newest message: the earlier local exchanges (as text, so the opening before it never changes), the app's
 *  state, and what he said. */
export function liteMessage({ name, said, state, history = [] }) {
  const earlier = history.length ? `Earlier in this conversation:\n${history.map((h) => `${name}: ${h.said}\nYou: ${h.reply}`).join('\n')}\n\n` : '';
  return `${earlier}${state}\n\n${name}: ${said}`;
}
const plainResult = (t) => String(t ?? '').replace(/\s*\[[A-Za-z0-9_-]{2,}\]/g, '').trim();

/** What a call runs when code decided the action (checks.mjs's DECIDED): code's tool, with the to-do code found in
 *  his sentence (else the model's title) and the model's text. */
function decidedCall(d, name, a) {
  const todo = d.title?.title ?? a.todo ?? a.text ?? '';
  switch (d.tool) {
    case 'remember_commitment': return { text: a.text ?? a.content ?? a.todo ?? '' };
    case 'update_commitment': return { todo, ...(d.status ? { status: d.status } : {}) };
    case 'unschedule_block': return { todo };
    case 'write_note': return name === 'write_note' ? a : { title: a.title ?? a.todo ?? 'Note', content: a.content ?? a.text ?? '' };
    case 'open': return { app: a.app ?? a.target ?? a.todo ?? '' };
    default: return a;
  }
}

/** One request to the local model, with the checks of checks.mjs. chat(body) → { content, toolCalls, usage, firstMs,
 *  noStreamRetries }; run(name, args, place, signal, { confirm }) → { ok, text, say }, { ask } or { declined }
 *  (createLiteRunner). history: [{ said, reply }], oldest first. items: the open to-dos [{ id, title }] (a title in
 *  his sentence, for the actions code decides). confirm({ tool, args, question }) → true, false or null: asks him
 *  about a change the model chose (the yes/no bubble, its answer window, never kept); confirmChanges false saves
 *  those at once. The first call sends the opening as messages and his newest message as the server's transient
 *  context, so the server reuses the opening; later calls of the same request carry it as an ordinary message.
 *  → { reply, by ('code' | 'model' | 'tools' | 'ask' | 'one' | 'declined' | 'unanswered' | 'replaced' | 'steps' |
 *  'empty'), calls: [{ name, args, ok, asked, by: 'code' | 'model', shown }], shown: { tool, args, question } (the
 *  change shown for a yes), noStreamRetries, usage: [per model call], firstMs } */
export async function liteRequest({ chat, run, name, model, said, state, history = [], maxSteps = 4, now = Date.now(), hours = { dayStart: 540, dayEnd: 1080 }, items = [], confirm = async () => null, confirmChanges = true }) {
  const system = { role: 'system', content: liteSystem(name) }, newest = liteMessage({ name, said, state, history });
  const messages = [system, { role: 'user', content: newest }];
  const out = { reply: '', by: 'model', calls: [], noStreamRetries: 0, usage: [], firstMs: null };
  const check = createRequestCheck({ said, now, hours, items });
  const place = (n, a, o) => check.place(n, a, o);
  // A reminder code can read whole: made by code, with no model call.
  const mine = reminderByCode(said, { items, now, ...hours });
  if (mine) {
    const res = await run('remember_commitment', { text: mine.text }, () => ({ action: 'remind', places: { due: mine.due } }));
    out.calls.push({ name: 'remember_commitment', args: { text: mine.text }, ok: !!res.ok, by: 'code' });
    if (res.ok) { check.result('remember_commitment', res); out.by = 'code'; out.reply = check.lines.join(' '); return out; }
    out.by = 'code'; out.reply = `That didn't work: ${res.text || 'the reminder was not saved'}. ${NOT_SAVED}`; return out;
  }
  let lastRead = '';
  const done = (by, reply) => { out.by = by; out.reply = reply; return out; };
  for (let step = 0; step <= maxSteps; step++) {
    const r = await chat(step === 0 ? liteBody(model, [system], { transient_context: newest }) : liteBody(model, messages));
    out.usage.push(r.usage ?? null); out.noStreamRetries += r.noStreamRetries ?? 0;
    if (out.firstMs == null) out.firstMs = r.firstMs ?? null;
    if (!r.toolCalls?.length) { out.reply = String(r.content ?? '').trim(); break; }
    if (step === maxSteps) return done('steps', 'That needed more steps than I can take here. Nothing more was changed.');
    const one = check.turn(r.toolCalls.map((c) => c.name));
    if (one) { out.calls.push(...r.toolCalls.map((c) => ({ name: c.name, args: c.args, ok: false, notRun: true }))); return done('one', [...check.lines, one].join(' ')); }
    messages.push({ role: 'assistant', content: r.content || null, tool_calls: r.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })) });
    let stop = null, again = false;
    for (const c of r.toolCalls) {
      let args = {};
      try { args = JSON.parse(c.args || '{}'); } catch { args = null; }
      if (stop) { messages.push({ role: 'tool', tool_call_id: c.id, content: 'Not run.' }); continue; }
      if (!LITE_NAMES.includes(c.name) || !args || typeof args !== 'object' || Array.isArray(args)) {
        out.calls.push({ name: c.name, args: args ?? {}, ok: false });
        messages.push({ role: 'tool', tool_call_id: c.id, content: `Refused: ${LITE_NAMES.includes(c.name) ? 'the arguments are not valid JSON' : `there is no tool ${c.name}`}. Nothing was changed.` });
        again = true;
        continue;
      }
      // Code decided the action from his words: code's tool runs and is saved at once. Else a change the model chose
      // is shown first.
      const d = check.changes(c.name) ? check.decided : null;
      const callName = d ? d.tool : c.name, callArgs = d ? decidedCall(d, c.name, args) : args, by = d ? 'code' : 'model';
      const ask = !d && check.changes(callName) && confirmChanges ? confirm : null;
      const res = await run(callName, callArgs, place, undefined, { confirm: ask });
      if (res.ask) { out.calls.push({ name: callName, args: callArgs, ok: false, asked: true, by }); stop = { by: 'ask', reply: res.ask }; messages.push({ role: 'tool', tool_call_id: c.id, content: 'Asked him.' }); continue; }
      if (res.declined) {
        out.calls.push({ name: callName, args: callArgs, ok: false, by, shown: true, answer: res.declined });
        out.shown = { tool: res.tool, args: res.args, question: res.question };
        check.called();
        stop = { by: res.declined === 'no' ? 'declined' : 'unanswered', reply: NOT_SAVED };
        messages.push({ role: 'tool', tool_call_id: c.id, content: 'Not saved.' });
        continue;
      }
      out.calls.push({ name: callName, args: callArgs, ok: !!res.ok, by, ...(d ? { model: { name: c.name, args } } : {}), ...(ask ? { shown: true, answer: 'yes' } : {}) });
      check.result(callName, res);
      if (!(res.ok && check.changes(callName))) { again = true; if (res.ok) lastRead = res.text; }
      messages.push({ role: 'tool', tool_call_id: c.id, content: res.text || (res.ok ? 'Done.' : 'Failed.') });
    }
    if (stop) return done(stop.by, [...check.lines, stop.reply].join(' '));
    if (!again) return done('tools', check.lines.join(' '));
  }
  // An empty answer after a read: the result itself, without its ids.
  const empty = !out.reply && lastRead;
  const f = check.finish(empty ? plainResult(lastRead) : out.reply);
  if (f.replaced) out.replaced = f.replaced;
  return done(f.by === 'model' && empty ? 'empty' : f.by, f.reply);
}
