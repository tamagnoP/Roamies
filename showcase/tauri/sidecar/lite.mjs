// Local-only build (feature 23): the lite request for the local model, and the code check on every call it makes.
//
// The opening (the prompt and the tools) is fixed byte for byte for a given name, so the server can reuse it: no
// time, no state, nothing that changes is in it. What changes goes in the newest message, labelled as coming from the
// app. The model is used for understanding the request; code does the rest:
//   - A time or day argument must be words the owner said in that request (case, spacing and punctuation aside).
//     Code parses them; the model never works out a date or a clock time. A call with a time he didn't say is refused
//     with a code-worded hint and may be made again once; refused again, a code-worded line asks him for the time.
//   - "Remind me" makes a reminder and anything else a to-do: decided here, not by the model.
//   - A reply that says something was done, moved, booked or saved without a tool result in that request confirming
//     it is replaced by a code-worded line saying nothing was changed.
import { nextDays, dayChoice } from './calendar.mjs';
import { clockSaid, parseWhen, ymd } from './daily.mjs';

export const LITE_MAX_TOKENS = 200;

/** The fixed prompt. `name` is the owner's name from the settings. */
export function liteSystem(name) {
  return `You are ${name}'s companion on his Mac, answering on the Mac itself while the main assistant is not in use. Answers are spoken: one or two short plain sentences, no lists, no markdown.
You can only: keep his to-dos and reminders, put to-dos on his calendar and say what is on it, keep notes in his notes vault, read today's daily note when he asks for it, and open an app he names. Call a tool for each of these; never say something is done unless a tool's result says so.
Give times and days exactly as he said them, copied from his words ("friday", "tomorrow at 10", "in 20 minutes", "half past four", "2"); the app works out dates and clock times. Use ids only from his message or a tool's result.
For anything else (files, coding, the web, the screen, drawing, clicking in apps) say in one sentence that you can't do that here, and do nothing.`;
}

const fn = (name, description, properties, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
const S = { type: 'string' };
/** The fixed tool set: names are the real names, bare. */
export const LITE_TOOLS = [
  fn('remember_commitment', 'Save a to-do or a reminder, also when it has a deadline ("by friday", "due monday"). text: what to do. when: the time or deadline in his words, if any.', { text: S, when: S }, ['text']),
  fn('update_commitment', 'Mark a to-do or reminder done or dropped, or change its time (when: in his words).', { id: S, status: { type: 'string', enum: ['done', 'dropped'] }, when: S }, ['id']),
  fn('list_commitments', 'Find to-dos: words from a title, or a day in his words. Without either: how many are open.', { words: S, day: S }),
  fn('schedule_block', 'Put a to-do on the calendar as a block of time, only when he asks to put it on the calendar, book or schedule it. todo: its id if it has one; otherwise title, in his words. day and start: in his words. "from 10 to 11" is start "10" and end "11"; or give minutes.', { todo: S, title: S, day: S, start: S, end: { type: 'string', description: 'the end in his words, when he gave one ("from 10 to 11": end "11")' }, minutes: { type: 'integer' } }, ['day', 'start']),
  fn('move_block', 'Move a block on the calendar. todo: the block\'s id. day: in his words, only if the day changes. start: the new start, in his words.', { todo: S, day: S, start: S, end: S, minutes: { type: 'integer' } }, ['todo']),
  fn('unschedule_block', 'Take a to-do\'s block off the calendar.', { todo: S }, ['todo']),
  fn('show_day', 'What is on the calendar on a day (in his words).', { day: S }, ['day']),
  fn('write_note', 'Save a note. title: a few plain words. content: his words, tidied.', { title: S, content: S, append: { type: 'boolean' } }, ['title', 'content']),
  fn('search_notes', 'Search his notes by words.', { query: S }, ['query']),
  fn('read_note', 'Read one note by its title.', { title: S }, ['title']),
  fn('read_daily', 'Read today\'s daily note (its plan and log), only when he asks for it.', {}),
  fn('open', 'Open the app he names. app: its name.', { app: S }, ['app']),
];
export const LITE_NAMES = LITE_TOOLS.map((t) => t.function.name);

/** The fields that hold a time or a day, per tool. */
export const TIME_FIELDS = { remember_commitment: ['when'], update_commitment: ['when'], list_commitments: ['day'], schedule_block: ['day', 'start', 'end'], move_block: ['day', 'start', 'end'], show_day: ['day'] };
const DAY_FIELDS = new Set(['day']);

/** Words as they are compared: lower case, spacing and punctuation aside (a colon between digits stays: "16:30"). */
export const normal = (t) => String(t ?? '').toLowerCase().replace(/[’‘`]/g, '\'').replace(/(\d):(\d)/g, '$1\u0000$2').replace(/[^\p{L}\p{N}'\u0000]+/gu, ' ').replace(/\u0000/g, ':').replace(/\s+/g, ' ').trim();
/** Whether `value` is words of `said`, whole words in a row. */
export function isSaid(value, said) {
  const v = normal(value);
  if (!v) return false;
  return ` ${normal(said)} `.includes(` ${v} `);
}
/** The time and day arguments of a call that are not words he said. → [{ field, value }] */
export function unsaid(name, args, said) {
  return (TIME_FIELDS[name] ?? []).filter((f) => args?.[f] != null && String(args[f]).trim() !== '' && !isSaid(args[f], said)).map((f) => ({ field: f, value: String(args[f]) }));
}

// Words that say a time or a day, to name in the hint the ones he used.
const NUM = '(?:\\d{1,2}(?::\\d{2})?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|an?|half an?)';
const TIME_WORDS = new RegExp([
  `\\bin ${NUM}(?: \\w+)? (?:minutes?|mins?|hours?|days?|weeks?)\\b`,
  '\\b(?:next |this )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\\b',
  '\\b(?:today|tonight|tomorrow|noon|midday)\\b',
  '\\b(?:half past|quarter past|quarter to) (?:\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\\b',
  '\\b\\d{1,2}(?::\\d{2})?(?: ?(?:am|pm|o\'clock))?\\b',
].join('|'), 'g');
/** The time and day words in what he said, in order, as they would be copied. */
export const timeWordsIn = (said) => [...new Set(normal(said).match(TIME_WORDS) ?? [])];

/** The code-worded hint for a refused call, given to the model as the tool's result. */
export function refusedHint(bad, said, name, tool = '') {
  const words = timeWordsIn(said);
  const list = bad.map((b) => `${b.field} "${b.value}"`).join(' and ');
  return `Refused, nothing was changed: ${list} ${bad.length === 1 ? 'is' : 'are'} not ${name}'s words. Call ${tool || 'the tool'} again now, with times and days copied exactly from his words${words.length ? `: ${words.map((w) => `"${w}"`).join(', ')}` : ''}. The app works out dates and clock times. Leave out a field he gave no words for.`;
}
/** The code-worded line that asks him for the time, after a second refusal. */
export function askTimeLine(bad) {
  return bad.every((b) => DAY_FIELDS.has(b.field)) ? 'Which day do you mean? Nothing was changed.' : 'What time do you mean? Nothing was changed.';
}
/** "Remind me" makes a reminder; anything else a to-do. */
export const kindFor = (said) => (/\bremind me\b/.test(normal(said)) ? 'reminder' : 'commitment');

// ---- the reply check ----
// What a sentence claims, and the tools whose result in that request confirms it.
const CLAIMS = [
  [/\b(marked|finished|completed|ticked)\b/, ['update_commitment']],
  [/\bdone\b/, ['update_commitment', 'remember_commitment', 'schedule_block', 'move_block', 'unschedule_block', 'write_note', 'open']],
  [/\b(dropped|removed|deleted|cancell?ed|cleared|taken (?:it )?off|took (?:it )?off)\b/, ['update_commitment', 'unschedule_block']],
  [/\b(moved|pushed|rescheduled|changed|updated|shifted)\b/, ['move_block', 'update_commitment', 'schedule_block']],
  [/\b(booked|scheduled|blocked|put (?:it |that )?(?:on|in))\b/, ['schedule_block', 'move_block']],
  [/\b(saved|added|noted|created|written|wrote|set|stored|remembered|logged)\b|\b(?:i'll|i will|will) remind\b/, ['remember_commitment', 'write_note', 'update_commitment', 'schedule_block']],
  [/\b(opened|opening)\b/, ['open']],
];
const NOT_A_CLAIM = /\?\s*$|\b(not|no|nothing|never|cannot|can't|couldn't|won't|wasn't|isn't|didn't|unable|shall i|should i|do you want|would you like|want me to|if you)\b|n't\b/;
/** The sentences of a reply that claim something no tool result in the request confirms. `confirmed`: the names of
 *  the tools that succeeded. → the claiming sentences ([] when the reply may stand). */
export function unconfirmed(reply, confirmed) {
  const out = [];
  for (const s of String(reply ?? '').split(/(?<=[.!?])\s+|\n+/)) {
    const t = normal(s) + (/\?\s*$/.test(s) ? '?' : '');
    if (!t || NOT_A_CLAIM.test(t)) continue;
    for (const [re, tools] of CLAIMS) if (re.test(t) && !tools.some((n) => confirmed.has(n))) { out.push(s.trim()); break; }
  }
  return out;
}
export const NOTHING_CHANGED = 'Nothing was changed.';

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
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

// ---- said words, read by code ----
const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty five': 45, fifty: 50, ninety: 90 };
const UNIT_MS = { minute: 60_000, min: 60_000, hour: 3_600_000, hr: 3_600_000, day: 86_400_000, week: 604_800_000 };
/** A time or deadline as said, read by code. → { at } (ms, a day and a time), { day } (a Date at 00:00), { ask } (a
 *  code-worded question: which of two days), or null when code can't read it. */
export function whenSaid(text, { now = Date.now(), dayStart = 540, dayEnd = 1080 } = {}) {
  let t = normal(text).replace(/^(?:by|due|on|before|for|at)\s+/, '').trim();
  if (!t) return null;
  if (/^in half an? hour$/.test(t)) return { at: now + 30 * 60_000 };
  const rel = /^in (\d+|[a-z]+(?: five)?) (minute|min|hour|hr|day|week)s?$/.exec(t);
  if (rel) { const n = /^\d+$/.test(rel[1]) ? +rel[1] : NUMBER_WORDS[rel[1]]; return n ? { at: now + n * UNIT_MS[rel[2]] } : null; }
  const two = nextDays(t, now);
  if (two) return { ask: dayChoice(two).question };
  const w = parseWhen(t, { now, dayStart, dayEnd });
  if (w?.kind === 'at') return { at: w.start };
  if (w?.kind === 'day') return { day: w.day };
  return null;
}
const isoAt = (ms) => { const d = new Date(ms); return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
/** A day as said, as the calendar tools take it: the words they read themselves ("today", "tomorrow", a weekday,
 *  "next friday"), else a date worked out here. → { date } or { ask } or null */
export function daySaid(text, { now = Date.now() } = {}) {
  const t = normal(text).replace(/^(?:on|this)\s+/, '').trim();
  if (/^(today|tomorrow|(?:next )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun))$/.test(t)) return { date: t };
  const w = parseWhen(t, { now });
  if (w?.kind === 'day') return { date: ymd(w.day) };
  return null;
}
/** A clock time as said, as HH:MM. → string or null */
export function startSaid(text, opts = {}) {
  const m = clockSaid(normal(text).replace(/^(?:at|from)\s+/, ''), opts);
  return m === null ? null : hhmm(m);
}

/** When a time falls, said back by code: "at 14:25", "tomorrow at 09:00", "on Friday 27 November", "on Friday 27
 *  November at 11:00". */
export function whenLine(ms, dayOnly, now = Date.now()) {
  const d = new Date(ms), n = new Date(now);
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / 864e5);
  const day = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `on ${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  if (dayOnly) return day;
  const at = `at ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return days === 0 ? at : `${day} ${at}`;
}
/** The tools that change something: after one of them succeeds, what he is told is worded by code from its result,
 *  and the model is not asked again. */
export const WRITE_TOOLS = new Set(['remember_commitment', 'update_commitment', 'schedule_block', 'move_block', 'unschedule_block', 'write_note', 'open']);

/** Runs a lite call through the real tools, turning his words into what they take. tool(name) → the tool object
 *  ({ execute }); blocks: { schedule_block, move_block } → (args, signal) → { text, say } (the calendar's own line for
 *  him); titleOf(id) → a to-do's title; readDaily() → today's daily note as text.
 *  → { ok, text, say } (say: the line for him, for a tool that changes something) or { ask } (a code-worded line). */
export function createLiteRunner({ tool, blocks = {}, titleOf = () => '', readDaily, now = () => Date.now(), hours = () => ({ dayStart: 540, dayEnd: 1080 }), said = () => '' }) {
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
  const quoted = (t) => `"${String(t).trim().replace(/^"|"$/g, '')}"`;
  return async function liteRun(name, a = {}, signal) {
    switch (name) {
      case 'remember_commitment': {
        const d = due(a.when); if (d.ask) return d;
        const kind = kindFor(said()), text = String(a.text ?? '').trim();
        const r = await run(name, { text, ...(d.due ? { due: d.due } : {}), kind }, signal);
        if (!r.ok) return r;
        const when = d.due ? whenLine(d.ms, d.dayOnly, now()) : '';
        return { ...r, say: kind === 'reminder' && d.due && !d.dayOnly ? `I'll remind you to ${text.replace(/[.!]+$/, '')} ${when}.` : `Saved ${quoted(text)}${when ? `, due ${when}` : ''}.` };
      }
      case 'update_commitment': {
        const d = due(a.when); if (d.ask) return d;
        const id = String(a.id ?? '');
        const r = await run(name, { id, ...(a.status ? { status: a.status } : {}), ...(d.due ? { due: d.due } : {}) }, signal);
        if (!r.ok) return r;
        const t = titleOf(id), what = t ? quoted(t) : 'It';
        return { ...r, say: [a.status ? `${what} is ${a.status}.` : '', d.due ? `${a.status ? 'It' : what} is now due ${whenLine(d.ms, d.dayOnly, now())}.` : ''].filter(Boolean).join(' ') || `${what} is updated.` };
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
        const args = { ...(a.todo ? { todo: String(a.todo) } : {}), ...(a.title ? { title: String(a.title) } : {}), ...(d.date ? { date: d.date } : {}), ...(s.v ? { start: s.v } : {}), ...(e.v ? { end: e.v } : {}), ...(Number.isInteger(a.minutes) && !e.v ? { minutes: a.minutes } : {}) };
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
export async function liteRequest({ chat, run, name, model, said, state, history = [], maxSteps = 4 }) {
  const system = { role: 'system', content: liteSystem(name) }, newest = liteMessage({ name, said, state, history });
  const messages = [system, { role: 'user', content: newest }];
  const out = { reply: '', by: 'model', calls: [], refusals: 0, noStreamRetries: 0, usage: [], firstMs: null };
  const confirmed = new Set();
  let lastRead = '';
  for (let step = 0; step <= maxSteps; step++) {
    const r = await chat(step === 0 ? liteBody(model, [system], { transient_context: newest }) : liteBody(model, messages));
    out.usage.push(r.usage ?? null); out.noStreamRetries += r.noStreamRetries ?? 0;
    if (out.firstMs == null) out.firstMs = r.firstMs ?? null;
    if (!r.toolCalls?.length) { out.reply = String(r.content ?? '').trim(); break; }
    if (step === maxSteps) { out.by = 'steps'; out.reply = 'That needed more steps than I can take here. Nothing more was changed.'; return out; }
    messages.push({ role: 'assistant', content: r.content || null, tool_calls: r.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })) });
    let stop = null, again = false;
    const lines = [];
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
      const bad = unsaid(c.name, args, said);
      if (bad.length) {
        out.refusals++;
        out.calls.push({ name: c.name, args, refused: true, ok: false, unsaid: bad.map((b) => b.field) });
        out.lastBad = bad;
        if (out.refusals >= 2) { stop = { by: 'refused', reply: askTimeLine(bad) }; messages.push({ role: 'tool', tool_call_id: c.id, content: 'Refused.' }); continue; }
        messages.push({ role: 'tool', tool_call_id: c.id, content: refusedHint(bad, said, name, c.name) });
        again = true;
        continue;
      }
      const res = await run(c.name, args);
      if (res.ask) { out.calls.push({ name: c.name, args, refused: false, ok: false, asked: true }); stop = { by: 'ask', reply: res.ask }; messages.push({ role: 'tool', tool_call_id: c.id, content: 'Asked him.' }); continue; }
      out.calls.push({ name: c.name, args, refused: false, ok: !!res.ok });
      if (res.ok) confirmed.add(c.name);
      if (res.ok && WRITE_TOOLS.has(c.name)) lines.push(res.say || res.text);
      else { again = true; if (res.ok) lastRead = res.text; }
      messages.push({ role: 'tool', tool_call_id: c.id, content: res.text || (res.ok ? 'Done.' : 'Failed.') });
    }
    if (stop) { out.by = stop.by; out.reply = [...lines, stop.reply].join(' '); return out; }
    if (!again) { out.by = 'tools'; out.reply = lines.join(' '); return out; }
    if (lines.length) out.done = [...(out.done ?? []), ...lines];
  }
  // Refused, and then no call he said the words for: a code-worded line asks him, not the model's own words.
  if (out.lastBad && !out.calls.some((c) => !c.refused)) { out.by = 'refused'; out.reply = askTimeLine(out.lastBad); return out; }
  if (!out.reply && lastRead) { out.by = 'empty'; out.reply = plainResult(lastRead); }
  const claims = unconfirmed(out.reply, confirmed);
  if (claims.length) { out.by = 'replaced'; out.replaced = claims.length; out.reply = NOTHING_CHANGED; }
  if (out.done?.length) out.reply = [...out.done, out.reply].filter(Boolean).join(' ');
  return out;
}
