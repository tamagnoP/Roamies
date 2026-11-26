// Local-only build (feature 23): the lite request for the local model.
//
// The opening (the prompt and the tools) is fixed byte for byte for a given name, so the server can reuse it: no
// time, no state, nothing that changes is in it. What changes goes in the newest message, labelled as coming from the
// app. The model is used for understanding the request. Every call it makes and its reply go through the checks in
// checks.mjs (time words are his, nothing about time left out, "remind me", no unconfirmed claims, code-worded lines
// after a change); here are only the prompt, the tools, the runner that turns his words into the real tools'
// arguments, and the request loop.
import { createRequestCheck, dayAndClock, daySaid, kindFor, normal, reminderLine, startSaid, updateLine, whenSaid } from './checks.mjs';
import { ymd } from './daily.mjs';

export const LITE_MAX_TOKENS = 200;

/** The fixed prompt. `name` is the owner's name from the settings. */
export function liteSystem(name) {
  return `You are ${name}'s companion on his Mac, answering on the Mac itself while the main assistant is not in use. Answers are spoken: one or two short plain sentences, no lists, no markdown.
You can only: keep his to-dos and reminders, put to-dos on his calendar and say what is on it, keep notes in his notes vault, read today's daily note when he asks for it, and open an app he names. Call a tool for each of these; never say something is done unless a tool's result says so.
Give times and days exactly as he said them, copied from his words ("friday", "tomorrow at 10", "in 20 minutes", "half past four", "2"), and leave none of them out; the app works out dates and clock times. Use ids only from his message or a tool's result.
For anything else (files, coding, the web, the screen, drawing, clicking in apps) say in one sentence that you can't do that here, and do nothing.`;
}

const fn = (name, description, properties, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
const S = { type: 'string' };
/** The fixed tool set: names are the real names, bare. */
export const LITE_TOOLS = [
  fn('remember_commitment', 'Save a to-do or a reminder, also when it has a deadline ("by friday", "due monday"). text: what to do. when: the time or deadline in his words, if any.', { text: S, when: S }, ['text']),
  fn('update_commitment', 'Mark a to-do or reminder done or dropped, or change its time (when: the new time, in his words; from: only when he says the old one).', { id: S, status: { type: 'string', enum: ['done', 'dropped'] }, when: S, from: S }, ['id']),
  fn('list_commitments', 'Find to-dos: words from a title, or a day in his words. Without either: how many are open.', { words: S, day: S }),
  fn('schedule_block', 'Put a to-do on the calendar as a block of time, only when he asks to put it on the calendar, book or schedule it. todo: its id if it has one; otherwise title, in his words. day and start: in his words. "from 10 to 11" is start "10" and end "11"; or give minutes.', { todo: S, title: S, day: S, start: S, end: { type: 'string', description: 'the end in his words, when he gave one ("from 10 to 11": end "11")' }, minutes: { type: 'integer' } }, ['day', 'start']),
  fn('move_block', 'Move a block on the calendar. todo: the block\'s id. day: in his words, only if the day changes. start: the new start, in his words. from: only when he says where it is now, in his words ("from 3 to 5": from "3", start "5"); otherwise leave it out.', { todo: S, day: S, start: S, end: S, minutes: { type: 'integer' }, from: S }, ['todo']),
  fn('unschedule_block', 'Take a to-do\'s block off the calendar.', { todo: S }, ['todo']),
  fn('show_day', 'What is on the calendar on a day (in his words).', { day: S }, ['day']),
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
    parts.push(facts.plan?.length ? `Today's blocks: ${facts.plan.map((b) => `"${b.title}" ${hm(b.start)} to ${hm(b.start + b.minutes * 60_000)}, id ${b.todo}`).join('; ')}.` : 'Nothing is on the calendar today.');
  }
  return `(From the app, not said by ${name}. ${parts.join(' ')})`;
}
const isoAt = (ms) => { const d = new Date(ms); return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };

/** Runs a lite call through the real tools, turning his words into what they take. tool(name) → the tool object
 *  ({ execute }); blocks: { schedule_block, move_block } → (args, signal) → { text, say } (the calendar's own line for
 *  him); titleOf(id) → a to-do's title; readDaily() → today's daily note as text; planOf(day, in the words the
 *  calendar tools take) → that day's blocks [{ todo, start (ms), minutes }]; dueOf(id) → { ms, dayOnly } or null.
 *  A `from` (where it is now) is checked against planOf or dueOf: without them, or when it doesn't match, he is asked.
 *  → { ok, text, say } (say: the line for him, for a tool that changes something) or { ask } (a code-worded line). */
export function createLiteRunner({ tool, blocks = {}, titleOf = () => '', readDaily, now = () => Date.now(), hours = () => ({ dayStart: 540, dayEnd: 1080 }), said = () => '', planOf = null, dueOf = null }) {
  const fail = (e) => ({ ok: false, text: String(e?.message ?? e).slice(0, 600) });
  const run = async (name, args, signal) => {
    const t = tool(name);
    if (!t) return { ok: false, text: `No tool ${name}.` };
    try { return { ok: true, text: String(await t.execute(args, { signal }) ?? '') }; } catch (e) { return fail(e); }
  };
  const due = (when) => {
    if (when == null || String(when).trim() === '') return { due: undefined };
    const w = whenSaid(when, { now: now(), ...hours() });
    if (!w) return { ask: 'When should that be? Nothing was changed.' };
    if (w.ask) return { ask: `${w.ask} Nothing was changed yet.` };
    return w.at != null ? { due: isoAt(w.at), ms: w.at, dayOnly: false } : { due: ymd(w.day), ms: w.day.getTime(), dayOnly: true };
  };
  const day = (text) => {
    if (text == null || String(text).trim() === '') return { date: undefined };
    return daySaid(text, { now: now() }) ?? { ask: 'Which day do you mean? Nothing was changed.' };
  };
  const clock = (text, field) => {
    if (text == null || String(text).trim() === '') return { v: undefined };
    const v = startSaid(text, hours());
    return v ? { v } : { ask: `What ${field === 'end' ? 'end ' : ''}time do you mean? Nothing was changed.` };
  };
  const given = (v) => v != null && String(v).trim() !== '';
  const hm = (ms) => { const x = new Date(ms); return `${pad(x.getHours())}:${pad(x.getMinutes())}`; };
  return async function liteRun(name, a = {}, signal) {
    switch (name) {
      case 'remember_commitment': {
        const d = due(a.when); if (d.ask) return d;
        const kind = kindFor(said()), text = String(a.text ?? '').trim();
        const r = await run(name, { text, ...(d.due ? { due: d.due } : {}), kind }, signal);
        if (!r.ok) return r;
        return { ...r, say: reminderLine({ text, kind, ms: d.due ? d.ms : null, dayOnly: d.dayOnly, now: now() }) };
      }
      case 'update_commitment': {
        const d = due(a.when); if (d.ask) return d;
        const id = String(a.id ?? '');
        if (given(a.from)) {
          const f = dayAndClock(a.from, { now: now(), ...hours() }), was = f && dueOf ? await dueOf(id) : null;
          const day = f?.date ? whenSaid(f.date, { now: now(), ...hours() }) : null;
          const same = was && f && (!f.date || (day?.day && ymd(day.day) === ymd(new Date(was.ms)))) && (!f.clock || (!was.dayOnly && hm(was.ms) === f.clock));
          if (!same) return { ask: 'Which to-do do you mean? Nothing was changed.' };
        }
        const r = await run(name, { id, ...(a.status ? { status: a.status } : {}), ...(d.due ? { due: d.due } : {}) }, signal);
        if (!r.ok) return r;
        return { ...r, say: updateLine({ title: titleOf(id), status: a.status ?? '', ms: d.due ? d.ms : null, dayOnly: d.dayOnly, now: now() }) };
      }
      case 'list_commitments': {
        const d = a.day ? (/^(this week|overdue)$/.test(normal(a.day)) ? { date: normal(a.day) } : day(a.day)) : { date: undefined };
        if (d.ask) return d;
        return run(name, { ...(a.words ? { words: String(a.words) } : {}), ...(d.date ? { due: d.date } : {}) }, signal);
      }
      case 'schedule_block': case 'move_block': {
        const d = day(a.day); if (d.ask) return d;
        const s = clock(a.start, 'start'); if (s.ask) return s;
        const e = normal(a.end) && normal(a.end) === normal(a.start) ? { v: undefined } : clock(a.end, 'end'); if (e.ask) return e; // an end that is the start is no end
        let todo = a.todo ? String(a.todo) : '';
        if (name === 'move_block' && given(a.from)) {
          const f = dayAndClock(a.from, { now: now(), ...hours() });
          const at = f && planOf ? (await planOf(f.date ?? 'today')).filter((b) => !f.clock || hm(b.start) === f.clock) : [];
          if (todo ? !at.some((b) => b.todo === todo) : at.length !== 1) return { ask: 'Which block do you mean? Nothing was changed.' };
          todo ||= at[0].todo;
        }
        const args = { ...(todo ? { todo } : {}), ...(a.title ? { title: String(a.title) } : {}), ...(d.date ? { date: d.date } : {}), ...(s.v ? { start: s.v } : {}), ...(e.v ? { end: e.v } : {}), ...(Number.isInteger(a.minutes) && !e.v ? { minutes: a.minutes } : {}) };
        if (name === 'schedule_block' && !args.date) return { ask: 'Which day do you mean? Nothing was changed.' };
        if (blocks[name]) { try { const r = await blocks[name](args, signal); return { ok: true, text: String(r?.text ?? ''), say: String(r?.say ?? r?.text ?? '') }; } catch (err) { return fail(err); } }
        const r = await run(name, args, signal);
        return r.ok ? { ...r, say: r.text } : r;
      }
      case 'unschedule_block': { const r = await run(name, { todo: String(a.todo ?? '') }, signal); return r.ok ? { ...r, say: r.text } : r; }
      case 'show_day': { const d = day(a.day); if (d.ask) return d; return run(name, { date: d.date ?? 'today' }, signal); }
      case 'write_note': { const r = await run(name, { title: String(a.title ?? ''), content: String(a.content ?? ''), ...(a.append === true ? { append: true } : {}) }, signal); return r.ok ? { ...r, say: r.text } : r; }
      case 'search_notes': return run(name, { query: String(a.query ?? '') }, signal);
      case 'read_note': return run(name, { title: String(a.title ?? '') }, signal);
      case 'read_daily': try { return { ok: true, text: String(await readDaily() ?? '') || 'Today\'s daily note is empty.' }; } catch (e) { return fail(e); }
      case 'open': { const r = await run(name, { target: String(a.app ?? '') }, signal); return r.ok ? { ...r, say: r.text } : r; }
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

/** One request to the local model, with the code check on every call. chat(body) → { content, toolCalls, usage,
 *  firstMs, noStreamRetries }; run(name, args) → { ok, text, say } or { ask }. history: [{ said, reply }], oldest first.
 *  The first call sends the opening as messages and his newest message as the server's transient context, so the
 *  server reuses the opening; later calls of the same request carry it as an ordinary message.
 *  → { reply, by ('model' | 'tools' | 'ask' | 'refused' | 'replaced' | 'steps' | 'empty'), calls: [{ name, args,
 *  refused, ok }], refusals, noStreamRetries, usage: [per model call], firstMs } */
export async function liteRequest({ chat, run, name, model, said, state, history = [], maxSteps = 4, now = Date.now(), hours = { dayStart: 540, dayEnd: 1080 } }) {
  const system = { role: 'system', content: liteSystem(name) }, newest = liteMessage({ name, said, state, history });
  const messages = [system, { role: 'user', content: newest }];
  const out = { reply: '', by: 'model', calls: [], refusals: 0, noStreamRetries: 0, usage: [], firstMs: null };
  const check = createRequestCheck({ said, userName: name, now, hours });
  let lastRead = '';
  const done = (by, reply) => { out.by = by; out.reply = reply; out.refusals = check.refusals; return out; };
  for (let step = 0; step <= maxSteps; step++) {
    const r = await chat(step === 0 ? liteBody(model, [system], { transient_context: newest }) : liteBody(model, messages));
    out.usage.push(r.usage ?? null); out.noStreamRetries += r.noStreamRetries ?? 0;
    if (out.firstMs == null) out.firstMs = r.firstMs ?? null;
    if (!r.toolCalls?.length) { out.reply = String(r.content ?? '').trim(); break; }
    if (step === maxSteps) return done('steps', 'That needed more steps than I can take here. Nothing more was changed.');
    messages.push({ role: 'assistant', content: r.content || null, tool_calls: r.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })) });
    let stop = null, again = false;
    for (const c of r.toolCalls) {
      let args = {};
      try { args = JSON.parse(c.args || '{}'); } catch { args = null; }
      if (stop) { messages.push({ role: 'tool', tool_call_id: c.id, content: 'Not run.' }); continue; }
      if (!LITE_NAMES.includes(c.name) || !args || typeof args !== 'object' || Array.isArray(args)) {
        out.calls.push({ name: c.name, args: args ?? {}, refused: true, ok: false });
        messages.push({ role: 'tool', tool_call_id: c.id, content: `Refused: ${LITE_NAMES.includes(c.name) ? 'the arguments are not valid JSON' : `there is no tool ${c.name}`}. Nothing was changed.` });
        again = true;
        continue;
      }
      const v = check.call(c.name, args);
      if (!v.run) {
        out.calls.push({ name: c.name, args, refused: true, ok: false, ...(v.unsaid ? { unsaid: v.unsaid } : {}), ...(v.missing ? { missing: v.missing } : {}) });
        if (v.ask) { stop = { by: 'refused', reply: v.ask }; messages.push({ role: 'tool', tool_call_id: c.id, content: 'Refused.' }); continue; }
        messages.push({ role: 'tool', tool_call_id: c.id, content: v.refuse });
        again = true;
        continue;
      }
      const res = await run(c.name, args);
      if (res.ask) { out.calls.push({ name: c.name, args, refused: false, ok: false, asked: true }); stop = { by: 'ask', reply: res.ask }; messages.push({ role: 'tool', tool_call_id: c.id, content: 'Asked him.' }); continue; }
      out.calls.push({ name: c.name, args, refused: false, ok: !!res.ok });
      check.result(c.name, res);
      if (!(res.ok && check.changes(c.name))) { again = true; if (res.ok) lastRead = res.text; }
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
