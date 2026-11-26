// Local-only build (feature 23): the checks on a request, worked out by code. They take what he said, the tool calls
// and the tool results, and know nothing of which model made the calls: the local model uses them now (lite.mjs), the
// Claude route is to use them in a later feature.
//   - Times are not the model's: code reads every time, day and length from his own sentence with the parsers the
//     tools use (`timesIn`) and places them by the action's rules (`PLACES`). What can't be placed, or a time the
//     action needs and he didn't say: nothing is saved, and a code-worded question names what is missing.
//   - One change per request: a request that asks for two gets a code-worded line asking for one at a time.
//   - The to-do is named by its title; code finds it (`matchTitle`), or asks which.
//   - Actions decided by code from fixed words in his sentence (`DECIDED`): "remind me" is a reminder, "is due",
//     "deadline", "by <day>" a due time, and a few more whose words leave no doubt. What code decided is saved at once;
//     a change the model chose is first shown to him as a code-worded question (`changeQuestion`) for a yes. A
//     reminder whose time and text code can read is made by code alone (`reminderByCode`).
//   - A reply that says something was done, moved, booked or saved without a tool result in that request confirming
//     it is replaced by a code-worded line saying nothing was changed; with no tool called at all, so is one that
//     promises an action ("I'll", "I will", "noted", "I have").
//   - After a tool that changes something, what he is told is a code-worded line from its result.
import { dayChoice, dayFrom, nextDays } from './calendar.mjs';
import { clockSaid, parseWhen, writtenTimes as written, ymd } from './daily.mjs';

/** Words as they are compared: lower case, spacing and punctuation aside (a colon between digits stays: "16:30"). */
export const normal = (t) => String(t ?? '').toLowerCase().replace(/[’‘`]/g, '\'').replace(/(\d):(\d)/g, '$1\u0000$2').replace(/[^\p{L}\p{N}'\u0000]+/gu, ' ').replace(/\u0000/g, ':').replace(/\s+/g, ' ').trim();
// ---- his sentence: the times, days and lengths in it ----
const LEN_NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty five': 45, fifty: 50, sixty: 60, ninety: 90 };
const LEN_UNIT = { minute: 1, minutes: 1, min: 1, mins: 1, hour: 60, hours: 60, hr: 60, hrs: 60 };
/** A length as said ("an hour", "90 minutes", "half an hour", "an hour and a half", "for two hours"). → minutes, or
 *  null when it is not a length alone. */
export function lengthSaid(text) {
  const t = normal(text).replace(/^for /, '');
  if (/^half an? hour$/.test(t)) return 30;
  if (/^(?:a )?quarter of an hour$/.test(t)) return 15;
  let m = /^(an?|one|two|three|four|\d{1,2}) hours? and a half$/.exec(t) ?? /^(one|two|three|four|\d{1,2}) and a half hours?$/.exec(t);
  if (m) { const n = /^\d+$/.test(m[1]) ? +m[1] : LEN_NUM[m[1]]; return n ? n * 60 + 30 : null; }
  m = /^(\d{1,3}|[a-z]+(?: five)?) (minutes?|mins?|hours?|hrs?)$/.exec(t);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? +m[1] : LEN_NUM[m[1]];
  return n ? n * LEN_UNIT[m[2]] : null;
}
const HOUR_NAMES = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const FULL_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const MONTH_WORDS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DAY_VOCAB = new Set(['today', 'tonight', 'tomorrow', 'next', 'the', 'of', 'day', 'after', 'st', 'nd', 'rd', 'th', ...FULL_DAYS, ...MONTH_WORDS]);
const CLOCK_VOCAB = new Set(['half', 'past', 'quarter', 'to', 'am', 'pm', 'o', 'clock', 'oclock', 'noon', 'midday', 'in', 'the', 'morning', 'afternoon', 'evening', 'at', 'night', 'oh', 'fifteen', 'twenty', 'thirty', 'forty', ...HOUR_NAMES]);
const isNum = (w) => /^\d{1,2}(?::\d{2})?$/.test(w);
const isDayWord = (w) => DAY_VOCAB.has(w) || /^\d{1,2}(?:st|nd|rd|th)?$/.test(w);
// A bare number ("2", "four") is a time only after one of these: "figure 3" is not a time.
const BEFORE_A_TIME = new Set(['at', 'from', 'to', 'until', 'till', 'by', 'around', 'before', 'after', 'about', 'between', 'and', 'or']);
// A span never starts with these: the words around a time are not part of it.
const LEAD = new Set(['at', 'from', 'to', 'until', 'till', 'by', 'around', 'before', 'after', 'about', 'between', 'and', 'on', 'this', 'due', 'for', 'the', 'of', 'past', 'o', 'clock', 'am', 'pm']);
// Words that say something about time: one of them left over, not placed, means a time code couldn't read.
const ALWAYS_TIME = new Set([...FULL_DAYS, ...MONTH_WORDS.filter((m) => m !== 'may'), 'today', 'tonight', 'tomorrow', 'yesterday', 'noon', 'midday', 'midnight', 'morning', 'afternoon', 'evening', 'night', 'tonight', 'weekend', 'week', 'weeks', 'fortnight', 'month', 'months', 'am', 'pm', 'oclock', 'o\'clock', 'lunchtime', 'eod', 'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec']);
const UNIT_WORDS = new Set(['minute', 'minutes', 'min', 'mins', 'hour', 'hours', 'hr', 'hrs', 'day', 'days']);
const COUNT_WORDS = new Set(['a', 'an', 'half', 'couple', 'few', 'several', ...Object.keys(LEN_NUM)]);
const isCount = (x) => /^\d+(?:[.:]\d+)?$/.test(x) || COUNT_WORDS.has(x) || HOUR_NAMES.includes(x);
function strayAt(w, j) {
  const x = w[j], prev = w[j - 1] ?? '', next = w[j + 1] ?? '';
  if (ALWAYS_TIME.has(x)) return true;
  if (x === 'may' && (isCount(prev) || isCount(next))) return true;
  if (UNIT_WORDS.has(x)) return isCount(prev) || isCount(w[j - 2] ?? '');
  if (x === 'half' || x === 'quarter') return isCount(next) || ['past', 'to', 'an', 'hour'].includes(next);
  if (/^\d{1,2}:\d{2}$/.test(x) || /^\d{1,2}(?:st|nd|rd|th)$/.test(x)) return true;
  return (/^\d{1,2}$/.test(x) || HOUR_NAMES.includes(x)) && BEFORE_A_TIME.has(prev);
}
const NAME_BEFORE = new Set(['the', 'a', 'my', 'our', 'your', 'his', 'her']);
/** The times, days and lengths in what he said, read by the parsers the tools use, in order, and the words about
 *  time that none of them read (`stray`). A weekday after "the", "a", "my" ("the Friday seminar") is a name, not a
 *  day: it is not read, and is stray.
 *  → { times: [{ kind: 'day' | 'clock' | 'rel' | 'length', text (his words), before (the word before it), minutes (a
 *  length) }], stray: [words], words: [his words as read], used: Set of the indices of the words in a time } */
export function readTimes(said, { now = Date.now(), dayStart = 540, dayEnd = 1080 } = {}) {
  const w = normal(written(said)).split(' ').filter(Boolean).map((x) => x.replace(/^(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)'s$/, '$1')), out = [];
  const used = new Set();
  for (let i = 0; i < w.length;) {
    let found = null;
    for (let n = Math.min(6, w.length - i); n >= 1 && !found; n--) {
      const part = w.slice(i, i + n), span = part.join(' '), prev = w[i - 1] ?? '';
      if (w[i] === 'in' && n > 1 && /^in /.test(span) && !/^in the /.test(span) && whenSaid(span, { now, dayStart, dayEnd })?.at != null) { found = { kind: 'rel', text: span, n }; break; }
      if (LEAD.has(w[i]) && !(w[i] === 'the' && /^\d/.test(w[i + 1] ?? ''))) continue;
      const len = prev === 'in' ? null : lengthSaid(span);
      if (len) { found = { kind: 'length', text: span, minutes: len, n }; break; }
      if (n === 1 && FULL_DAYS.includes(span) && NAME_BEFORE.has(prev)) break;
      if (part.every(isDayWord) && !part.every((x) => /^\d+$/.test(x)) && (nextDays(span, now) || daySaid(span, { now }))) { found = { kind: 'day', text: span.replace(/^the (?=\d)/, ''), n }; break; }
      if (part.every((x) => CLOCK_VOCAB.has(x) || isNum(x)) && startSaid(span, { dayStart, dayEnd })) {
        const bare = n === 1 && (/^\d{1,2}$/.test(span) || HOUR_NAMES.includes(span));
        if (!bare || BEFORE_A_TIME.has(prev)) found = { kind: 'clock', text: span, n };
        break;
      }
    }
    if (found) { found.before = w[i - 1] ?? ''; out.push(found); for (let k = i; k < i + found.n; k++) used.add(k); i += found.n; delete found.n; } else i++;
  }
  // "o'clock", "am" and "pm" after a time read, and "the"/"of" inside a date, are part of it.
  const stray = w.filter((x, j) => !used.has(j) && strayAt(w, j) && !(['oclock', 'o\'clock', 'am', 'pm'].includes(x) && used.has(j - 1)));
  return { times: out, stray, words: w, used };
}
/** The times, days and lengths in what he said (readTimes without the stray words). */
export const timesIn = (said, opts) => readTimes(said, opts).times;
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
// With no tool called, a sentence that promises or reports an action is a claim too.
const PROMISE = /\b(i'll|i will|i've|i have|i'm going to|i am going to|i shall|noted|will remember|will remind|got it|all set|on it)\b/;
/** The sentences of a reply given with no tool called that promise or report an action ("I will remember …",
 *  "I'll …", "Noted.", "I have …"). A negative sentence or a question is none. → the sentences ([] when none). */
export function promised(reply) {
  const out = [];
  for (const s of String(reply ?? '').split(/(?<=[.!?])\s+|\n+/)) {
    const t = normal(s) + (/\?\s*$/.test(s) ? '?' : '');
    if (t && !NOT_A_CLAIM.test(t) && PROMISE.test(t)) out.push(s.trim());
  }
  return out;
}

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

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
/** A day as said, as the calendar tools take it: the words they read themselves ("today", "tomorrow", a weekday,
 *  "next friday"), else a date worked out here. → { date } or { ask } or null */
export function daySaid(text, { now = Date.now() } = {}) {
  const t = normal(text).replace(/^(?:on|this)\s+/, '').trim();
  if (/^(today|tomorrow|(?:next )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun))$/.test(t)) return { date: t };
  const w = parseWhen(t, { now });
  if (w?.kind === 'day') return { date: ymd(w.day) };
  return null;
}
/** A clock time as said, as HH:MM, from his sentence after writtenTimes (readTimes). → string or null */
export function startSaid(text, opts = {}) {
  const m = clockSaid(normal(text).replace(/^(?:at|from)\s+/, ''), { ...opts, asWritten: false });
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

const quoted = (t) => `"${String(t).trim().replace(/^"|"$/g, '')}"`;
/** The line he is told after a to-do or reminder is saved. ms/dayOnly: its due time as code read it, if any. */
export function reminderLine({ text, kind, ms = null, dayOnly = false, now = Date.now() }) {
  const t = String(text ?? '').trim(), when = ms != null ? whenLine(ms, dayOnly, now) : '';
  return kind === 'reminder' && ms != null && !dayOnly ? `I'll remind you to ${t.replace(/[.!]+$/, '')} ${when}.` : `Saved ${quoted(t)}${when ? `, due ${when}` : ''}.`;
}
/** The line he is told after a to-do is marked or given a new time. */
export function updateLine({ title = '', status = '', ms = null, dayOnly = false, now = Date.now() }) {
  const what = title ? quoted(title) : 'It';
  return [status ? `${what} is ${status}.` : '', ms != null ? `${status ? 'It' : what} is now due ${whenLine(ms, dayOnly, now)}.` : ''].filter(Boolean).join(' ') || `${what} is updated.`;
}

// ---- placing his times by the action ----
const FROM_WORDS = new Set(['from', 'between']);
const TO_WORDS = new Set(['to', 'until', 'till']);
const END_WORDS = new Set(['until', 'till']);
/** His times in groups: after "from" or "between" the *from* group, after "to", "until", "till" (or "and" after
 *  "between ...") the *to* group; a time with no such word before it stays in the group before it ('none' at first). */
export function grouped(times) {
  let g = 'none';
  return times.map((t) => {
    if (FROM_WORDS.has(t.before)) g = 'from';
    else if (TO_WORDS.has(t.before) || (t.before === 'and' && g === 'from')) g = 'to';
    return { ...t, group: g };
  });
}
const ofKind = (xs, kind) => xs.filter((x) => x.kind === kind);
/** One of a kind at most: → the one, null, or false when there are more. */
const one = (xs, kind) => { const k = ofKind(xs, kind); return k.length > 1 ? false : k[0] ?? null; };
const has = (xs, kind) => xs.some((x) => x.kind === kind);

/** A due time from a group of his times: a time from now alone, or a day and a clock time, either. → { due: { ms,
 *  dayOnly } | null, used: [the times used], ask } */
function dueFrom(xs, opts) {
  const rel = one(xs, 'rel'), day = one(xs, 'day'), clock = one(xs, 'clock');
  if (rel === false || day === false || clock === false || (rel && (day || clock))) return { due: null, used: [] };
  if (rel) return { due: { ms: whenSaid(rel.text, opts).at, dayOnly: false }, used: [rel] };
  if (!day && !clock) return { due: null, used: [] };
  const w = whenSaid([day?.text, clock ? `at ${clock.text}` : ''].filter(Boolean).join(' '), opts);
  if (w?.ask) return { due: null, used: [day, clock].filter(Boolean), ask: w.ask };
  if (!w) return { due: null, used: [] };
  return { due: w.at != null ? { ms: w.at, dayOnly: false } : { ms: w.day.getTime(), dayOnly: true }, used: [day, clock].filter(Boolean) };
}
/** A day for the calendar tools ("tomorrow", "thursday", "2026-12-04"). → { date } | { ask } | null */
function calendarDay(x, opts) {
  if (!x) return null;
  const two = nextDays(x.text, opts.now);
  if (two) return { ask: dayChoice(two).question };
  return daySaid(x.text, opts);
}
/** Where an old and a new group are: with a *to* group, the times before it are where the thing is now. */
const oldNew = (g) => (g.some((x) => x.group === 'to') ? [g.filter((x) => x.group !== 'to'), g.filter((x) => x.group === 'to')] : [g.filter((x) => x.group === 'from'), g.filter((x) => x.group !== 'from')]);

/** The rules, one row per action: what it takes of his times, what it needs, and how they are placed. Each place()
 *  gets his times in groups and returns { places, used (the times placed), missing (what it needs and lacks), ask }.
 *  Times he said that are not in `used` can't be placed: nothing is saved. */
export const PLACES = {
  // "remind me ...": a day, a clock time or a time from now; one is needed.
  remind: { takes: 'day, clock, from now', needs: 'when', place: (g, o) => { const d = dueFrom(g, o); return { places: { due: d.due }, used: d.used, ask: d.ask, missing: d.due || d.ask ? [] : ['when'] }; } },
  // a to-do: "by DAY", "due DAY", "on DAY at X" is its due time; none is a to-do without a date.
  todo: { takes: 'day, clock, from now', needs: '', place: (g, o) => { const d = dueFrom(g, o); return { places: { due: d.due }, used: d.used, ask: d.ask, missing: [] }; } },
  // a new due time; "from DAY to DAY": the first is where it is now (code checks it).
  due: { takes: 'day, clock, from now; from', needs: 'by when', place: (g, o) => {
    const [was, next] = oldNew(g), d = dueFrom(next, o), f = was.length ? dueFrom(was, o) : null;
    return { places: { due: d.due, ...(f?.due ? { from: f.due } : {}) }, used: [...d.used, ...(f?.used ?? [])], ask: d.ask ?? f?.ask, missing: d.due || d.ask ? [] : ['due'] };
  } },
  // marked done or dropped: no time.
  mark: { takes: '', needs: '', place: () => ({ places: {}, used: [], missing: [] }) },
  // booked: one day; "from X to Y" is start and end, "at X for N" start and length, "X until Y" start and end.
  book: { takes: 'day, clock, clock, length', needs: 'day, start, length', place: (g, o) => {
    const day = one(g, 'day'), starts = g.filter((x) => x.kind === 'clock' && x.group !== 'to'), ends = g.filter((x) => x.kind === 'clock' && x.group === 'to'), len = one(g, 'length');
    const d = day ? calendarDay(day, o) : null, start = starts.length === 1 ? startSaid(starts[0].text, o) : null, end = ends.length === 1 ? startSaid(ends[0].text, o) : null;
    const used = [...(d && !d.ask ? [day] : []), ...(start ? starts : []), ...(end && !len ? ends : []), ...(len && !ends.length ? [len] : [])];
    const missing = [...(day === null ? ['day'] : []), ...(!starts.length ? ['start'] : []), ...(!ends.length && !len ? ['length'] : [])];
    return { places: { date: d?.date, start, ...(used.includes(ends[0]) ? { end } : {}), ...(len && used.includes(len) ? { minutes: len.minutes } : {}) }, used, ask: d?.ask, missing };
  } },
  // moved: "from X to Y" is the block at X starting at Y; "to DAY at X" the new day and start; "until Y" a new end;
  // a length a new length; the *from* group is where the block is now (code checks it against the calendar).
  move: { takes: 'from: day, clock; to: day, clock, end or length', needs: 'something new', place: (g, o) => {
    const [was, next] = oldNew(g);
    const wd = one(was, 'day'), wc = one(was, 'clock');
    const nd = one(next, 'day'), ns = next.filter((x) => x.kind === 'clock' && !END_WORDS.has(x.before)), ne = next.filter((x) => x.kind === 'clock' && END_WORDS.has(x.before)), nl = one(next, 'length');
    const d = nd ? calendarDay(nd, o) : null, fd = wd ? calendarDay(wd, o) : null;
    const start = ns.length === 1 ? startSaid(ns[0].text, o) : null, end = ne.length === 1 ? startSaid(ne[0].text, o) : null, from = wc ? startSaid(wc.text, o) : null;
    const places = { ...(d?.date ? { date: d.date } : {}), ...(start ? { start } : {}), ...(end && !nl ? { end } : {}), ...(nl && !end ? { minutes: nl.minutes } : {}) };
    if (wd || wc) places.from = { date: fd?.date ?? d?.date ?? 'today', ...(from ? { clock: from } : {}) };
    const used = [...(d?.date ? [nd] : []), ...(start ? ns : []), ...(places.end ? ne : []), ...(places.minutes ? [nl] : []), ...(fd?.date ? [wd] : []), ...(from ? [wc] : [])];
    return { places, used, ask: d?.ask ?? fd?.ask, missing: next.length ? [] : ['new'] };
  } },
  // taken off the calendar: no time.
  unbook: { takes: '', needs: '', place: () => ({ places: {}, used: [], missing: [] }) },
  // what is on a day: one day, today when none is said.
  show: { takes: 'day', needs: '', place: (g, o) => { const day = one(g, 'day'), d = day ? calendarDay(day, o) : null; return { places: { date: d?.date ?? (day ? undefined : 'today') }, used: d?.date ? [day] : [], ask: d?.ask, missing: [] }; } },
  // to-dos found by a day he names, "this week" or "overdue".
  find: { takes: 'day', needs: '', words: (said) => (/\bthis week\b/.test(normal(said)) ? ['week'] : []), place: (g, o, said) => {
    const day = one(g, 'day'), d = day ? calendarDay(day, o) : null, word = /\bthis week\b/.test(normal(said)) ? 'this week' : /\boverdue\b/.test(normal(said)) ? 'overdue' : '';
    return { places: { due: d?.date ?? (word || undefined) }, used: d?.date ? [day] : [], ask: d?.ask, missing: [] };
  } },
  // notes, the daily note, opening an app: no time is set; times he said stay in his words in the text.
  none: { takes: 'none (times stay in the text)', needs: '', place: (g) => ({ places: {}, used: g, missing: [] }) },
};
/** The action of a call of the lite tools. */
export const ACTION_OF = (name, args, said) => ({
  remember_commitment: kindFor(said) === 'reminder' ? 'remind' : 'todo',
  update_commitment: args?.status ? 'mark' : 'due',
  schedule_block: 'book', move_block: 'move', unschedule_block: 'unbook', show_day: 'show', list_commitments: 'find',
}[name] ?? 'none');

const QUESTIONS = { day: 'Which day?', start: 'What time?', length: 'For how long?', when: 'When should I remind you?', due: 'By when?', new: 'To when?' };
const quoteList = (xs, word = 'and') => xs.map((x) => `"${x}"`).join(xs.length === 2 ? ` ${word} ` : ', ');
/** Places his times for an action. title: a to-do's title to leave out of his sentence (its words are not times).
 *  → { places } or { ask: a code-worded line, nothing to be saved } */
export function placeTimes(action, said, { now = Date.now(), dayStart = 540, dayEnd = 1080, title = '' } = {}) {
  const o = { now, dayStart, dayEnd };
  const t = title ? normal(title) : '';
  const text = t && ` ${normal(said)} `.includes(` ${t} `) ? ` ${normal(said)} `.replace(` ${t} `, ' it ').trim() : said;
  const read = readTimes(text, o), g = grouped(read.times), rule = PLACES[action] ?? PLACES.none;
  const r = rule.place(g, o, said);
  if (r.ask) return { ask: `${r.ask} Nothing was changed yet.` };
  const stray = action === 'none' ? [] : read.stray.filter((x) => !(rule.words?.(said) ?? []).includes(x));
  const left = [...g.filter((x) => !r.used.includes(x)).map((x) => x.text), ...stray];
  if (left.length) return { ask: `I couldn't place ${quoteList([...new Set(left)])} for that. Nothing was changed: could you say it again?` };
  if (r.missing.length) return { ask: `${r.missing.map((m) => QUESTIONS[m]).join(' ')} Nothing was changed.` };
  return { places: r.places };
}

/** A to-do named by its title, among items [{ id, title }]: an id, an exact title, or the one title that holds his
 *  words (one word only as a title's first word: "thesis" is "Thesis chapter 2", "review" is not "Budget review"),
 *  or whose words he used in full. → the item, { none: true }, or { ask } when more than one fits. */
export function matchTitle(given, items) {
  const bare = (x) => normal(x).replace(/^(?:the|my|a|an)\s+/, '').replace(/\s+(?:block|to do|todo|task|one)$/, '');
  const g = bare(given);
  if (!g) return { none: true };
  const byId = items.find((i) => i.id === String(given).trim());
  if (byId) return byId;
  const uniq = (xs) => [...new Map(xs.map((x) => [x.id, x])).values()];
  const exact = uniq(items.filter((i) => bare(i.title) === g));
  if (exact.length === 1) return exact[0];
  const part = exact.length ? exact : uniq(items.filter((i) => { const t = bare(i.title); return (g.includes(' ') ? ` ${t} `.includes(` ${g} `) : t.split(' ')[0] === g) || (t.includes(' ') && ` ${g} `.includes(` ${t} `)); }));
  if (part.length === 1) return part[0];
  if (part.length > 1) return { ask: `Which one: ${quoteList(part.slice(0, 3).map((x) => x.title), 'or')}? Nothing was changed.` };
  return { none: true };
}

// ---- actions decided by code, from fixed words in his sentence
const ADD_WORDS = /\b(?:add|new|make|create|put down)(?: a| an| another)? (?:to ?do|todo|task)\b|^(?:to ?do|todo|task)\b/;
const REMIND_WORDS = /\bremind me\b/;
/** The rows: the action, the real tool it runs, the words that decide it (test(said, ctx) on his words as normal()
 *  gives them; ctx: { times: readTimes's times, title: the one open to-do whose title is in his sentence, or null }),
 *  and what the call gets (status). Two rows that match decide nothing: the model's choice is then shown for a yes.
 *  "Drop", "move", "push", "book" and "schedule" are not here: they also name other actions ("drop the block", "push
 *  the deadline", a block for a to-do or a new one). */
export const DECIDED = [
  { action: 'remind', tool: 'remember_commitment', words: '"remind me"', test: (t) => REMIND_WORDS.test(t) },
  { action: 'todo', tool: 'remember_commitment', words: '"add a to-do", "new to-do", "new task", "add a task", "to-do:"', test: (t) => ADD_WORDS.test(t) },
  { action: 'due', tool: 'update_commitment', words: '"is due", "is now due", "due on", "due by", "deadline", "by <day or time>", with an open to-do\'s title in his sentence and no "remind me" or "add a to-do"',
    test: (t, c) => !!c.title && !REMIND_WORDS.test(t) && !ADD_WORDS.test(t) && (/\b(?:is|are) (?:now )?due\b|\bdue (?:on|by)\b|\bdeadline\b/.test(t) || c.times.some((x) => x.before === 'by' && x.kind !== 'length')) },
  { action: 'mark', tool: 'update_commitment', status: 'done', words: '"mark … done", "mark … as done", "I\'m done with", "… is done", "I\'ve finished"',
    test: (t) => /\bmark .+? (?:as )?(?:done|finished|complete|completed)\b|\bi'?m done with\b|\bi am done with\b|\b(?:is|are) (?:now )?done\b|\bi(?:'ve| have) (?:finished|completed)\b/.test(t) },
  { action: 'unbook', tool: 'unschedule_block', words: '"off the calendar", "off my calendar"', test: (t) => /\boff (?:my|the) calendar\b/.test(t) },
  { action: 'note', tool: 'write_note', words: '"note down", "make a note", "take a note", "write a note", "add a note", "jot down"', test: (t) => /\b(?:note down|make a note|take a note|write a note|add a note|jot down)\b/.test(t) },
  { action: 'open', tool: 'open', words: '"open <app>" at the start, or after "and", "then", "also"', test: (t) => /(?:^|\b(?:and|then|also) )(?:please )?open \w/.test(t) },
];
/** The open to-do whose whole title is in his sentence (a leading "the" aside), when exactly one is. → the item or
 *  null. items: [{ id, title }] */
export function titleIn(said, items = []) {
  const t = ` ${normal(said)} `, bare = (x) => normal(x).replace(/^(?:the|my|a|an)\s+/, '');
  const hit = [...new Map(items.filter((i) => i.id && bare(i.title) && t.includes(` ${bare(i.title)} `)).map((i) => [i.id, i])).values()];
  return hit.length === 1 ? hit[0] : null;
}
/** The action code decides from his words. items: the open to-dos [{ id, title }]. → { action, tool, status, title }
 *  (title: the one open to-do named in his sentence, or null), or null when no row matches or more than one does. */
export function decideAction(said, { items = [], now = Date.now(), dayStart = 540, dayEnd = 1080 } = {}) {
  const t = normal(said), title = titleIn(said, items), times = readTimes(said, { now, dayStart, dayEnd }).times;
  const rows = DECIDED.filter((r) => r.test(t, { times, title }));
  if (rows.length !== 1) return null;
  const r = rows[0];
  return { action: r.action, tool: r.tool, ...(r.status ? { status: r.status } : {}), title };
}
const POLITE = /^(?:(?:please|can you|could you|would you|will you|hey|ok|okay|oh|and)\s+)*$/;
const BEFORE_TIME = new Set(['at', 'on', 'by', 'this', 'for', 'around', 'about']);
/** A reminder code can make alone: "remind me" (only polite words before it), a time code places, and a text: what
 *  is left once the time words, the word before each ("at", "on"), "remind me to" and a closing "please" or "thanks" are taken out, in his
 *  own words and capitals. → { text, due: { ms, dayOnly } } or null (the request then goes to the model). */
export function reminderByCode(said, { items = [], now = Date.now(), dayStart = 540, dayEnd = 1080 } = {}) {
  const d = decideAction(said, { items, now, dayStart, dayEnd });
  if (d?.action !== 'remind') return null;
  const p = placeTimes('remind', said, { now, dayStart, dayEnd });
  if (!p.places?.due || p.places.due.dayOnly) return null;
  const r = readTimes(said, { now, dayStart, dayEnd });
  // His own tokens, each with the indices of the words normal() makes of it.
  const tokens = written(said).split(/\s+/).filter(Boolean), of = [];
  let k = 0;
  for (const tok of tokens) { const n = normal(tok.replace(/^(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)['’]s$/i, '$1')).split(' ').filter(Boolean).length; of.push([...Array(n).keys()].map((x) => x + k)); k += n; }
  if (k !== r.words.length) return null;
  const drop = new Set(r.used);
  for (const j of r.used) if (!r.used.has(j - 1) && BEFORE_TIME.has(r.words[j - 1])) drop.add(j - 1);
  const keep = tokens.filter((_, i) => of[i].length > 0 && of[i].every((j) => !drop.has(j)));
  const words = keep.join(' ').replace(/[\s,;:.!?]+$/, '').replace(/^[\s,]+/, '');
  const m = /^(.*?)\bremind me\s+to\s+(.+)$/i.exec(words.replace(/(?:[\s,]+(?:please|thanks|thank you|cheers))+$/i, ''));
  if (!m || !POLITE.test(normal(m[1]) ? `${normal(m[1])} ` : '')) return null;
  const text = m[2].replace(/[\s,]+$/, '').trim();
  if (!text || readTimes(text, { now, dayStart, dayEnd }).times.length) return null;
  return { text, due: p.places.due };
}

// ---- the question that shows a change the model chose, before anything is saved
const dayWords = (date, now) => { const d = dayFrom(date, now); return d ? whenLine(d.getTime(), true, now) : String(date ?? ''); };
const lengthWords = (m) => (m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'}` : m > 60 ? `${Math.floor(m / 60)} hour${m < 120 ? '' : 's'} ${m % 60} minutes` : `${m} minutes`);
const whenOf = (due, now) => { const ms = typeof due === 'number' ? due : dueMs(due); return ms == null ? '' : whenLine(ms, /^\d{4}-\d{2}-\d{2}$/.test(String(due)), now); };
const dueMs = (due) => { const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(due ?? '')); return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0)).getTime() : null; };
/** What would be saved, said back by code from the real tool's arguments, as a question for a yes: the to-do's
 *  title, the action and the times as code read them. tool: the real tool; args: its arguments; title: the to-do's
 *  title (for a call by id). → the question. */
export function changeQuestion({ tool, args = {}, title = '', now = Date.now() }) {
  const name = quoted(title || args.title || args.text || args.todo || '');
  const at = (a) => [a.date ? dayWords(a.date, now).replace(/^on /, '') : '', a.start ? `${a.date ? 'at ' : ''}${a.start}` : ''].filter(Boolean).join(' ');
  switch (tool) {
    case 'remember_commitment': {
      const when = args.due ? whenOf(args.due, now) : '';
      return args.kind === 'reminder' && when && !/^\d{4}-\d{2}-\d{2}$/.test(args.due) ? `Remind you to ${String(args.text).replace(/[.!]+$/, '')} ${when}?` : `Add the to-do ${quoted(args.text)}${when ? `, due ${when}` : ''}?`;
    }
    case 'update_commitment': return args.status ? `Mark ${name} as ${args.status}?` : args.due ? `Make ${name} due ${whenOf(args.due, now)}?` : `Change ${name}?`;
    case 'schedule_block': {
      const day = args.date ? dayWords(args.date, now) : 'today';
      const span = args.end ? `from ${args.start} to ${args.end}` : args.minutes ? `at ${args.start} for ${lengthWords(args.minutes)}` : args.start ? `at ${args.start}` : '';
      return `Book ${name} ${day}${span ? ` ${span}` : ''}?`;
    }
    case 'move_block': {
      const to = at(args), more = [args.end ? `until ${args.end}` : '', args.minutes ? `for ${lengthWords(args.minutes)}` : ''].filter(Boolean).join(' ');
      return `Move the block for ${name}${to ? ` to ${to}` : ''}${more ? ` ${more}` : ''}?`;
    }
    case 'unschedule_block': return `Take the block for ${name} off the calendar?`;
    case 'write_note': { const c = String(args.content ?? '').replace(/\s+/g, ' ').trim(); return `${args.append ? 'Add to' : 'Save'} the note ${quoted(args.title ?? '')}: "${c.length > 140 ? `${c.slice(0, 139)}…` : c}"?`; }
    case 'open': return `Open ${String(args.target ?? '').trim()}?`;
    default: return `Run ${tool}?`;
  }
}
export const NOT_SAVED = 'Nothing was changed.';

export const ONE_AT_A_TIME = 'One change at a time, please. Nothing was changed: say the first one again.';
/** One change per request: → the line asking for one at a time, when the calls change more than one thing. */
export const oneChange = (names, changes = WRITE_TOOLS) => (names.filter((n) => changes.has(n)).length > 1 ? ONE_AT_A_TIME : '');

/** The checks for one request. said: what he said.
 *  turn(names) → the line asking for one change at a time, or '' (a model turn's calls, before any runs);
 *  place(name, args, { title }) → { action, places } or { ask }: his times placed for that call's action;
 *  result(name, { ok, text, say }) → the code-worded line for him after a change, or '';
 *  finish(reply) → { reply, by: 'model' | 'replaced', replaced }: the lines after changes first; a reply with a claim
 *    nothing confirmed is replaced, and with no tool called (result() or called() never), one that promises an action.
 *  decided: the action code decided from his words (items: the open to-dos, for a title in his sentence). */
export function createRequestCheck({ said, now = Date.now(), hours = { dayStart: 540, dayEnd: 1080 }, actionOf = ACTION_OF, changes = WRITE_TOOLS, items = [] }) {
  const confirmed = new Set(), lines = [];
  let changed = 0, called = 0;
  const decided = decideAction(said, { items, now, ...hours });
  return {
    /** The action code decided from his words (decideAction), or null: the model's choice is shown for a yes. */
    decided,
    get lines() { return [...lines]; },
    changes: (name) => changes.has(name),
    turn: (names) => (changed && names.some((n) => changes.has(n)) ? ONE_AT_A_TIME : oneChange(names, changes)),
    place(name, args, { title = '' } = {}) {
      const action = actionOf(name, args, said), p = placeTimes(action, said, { now, ...hours, title });
      return p.ask ? { action, ask: p.ask } : { action, places: p.places };
    },
    result(name, res) {
      called++;
      if (!res?.ok) return '';
      confirmed.add(name);
      if (!changes.has(name)) return '';
      changed++;
      const line = String(res.say || res.text || '');
      lines.push(line);
      return line;
    },
    called: () => { called++; },
    finish(reply) {
      const claims = [...new Set([...unconfirmed(reply, confirmed), ...(called ? [] : promised(reply))])];
      return { reply: [...lines, claims.length ? NOTHING_CHANGED : String(reply ?? '').trim()].filter(Boolean).join(' '), by: claims.length ? 'replaced' : 'model', replaced: claims.length };
    },
  };
}
