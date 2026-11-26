// Local-only build (feature 23): the checks on a request's tool calls and on the reply, worked out by code. They take
// what he said, the tool calls and the tool results, and know nothing of which model made the calls: the local model
// uses them now (lite.mjs), the Claude route is to use them in a later feature.
//   - A time or day argument must be words he said in that request (case, spacing and punctuation aside). Code parses
//     them; the model never works out a date or a clock time.
//   - Every time, day and length he said that the tool can take has to be in the call (the completeness check), found
//     by the same parsers that read the arguments. A move from one time to another uses both.
//   - A call that fails either check is refused with a code-worded hint and may be made once more; refused again,
//     nothing is run and a code-worded line asks him.
//   - "Remind me" makes a reminder and anything else a to-do.
//   - A reply that says something was done, moved, booked or saved without a tool result in that request confirming
//     it is replaced by a code-worded line saying nothing was changed.
//   - After a tool that changes something, what he is told is a code-worded line from its result.
// Which argument fields hold times is a table (`TIME_FIELDS`, `TAKES`: the tools that take his words); a caller with
// other tool shapes passes its own.
import { nextDays, dayChoice } from './calendar.mjs';
import { clockSaid, parseWhen, ymd } from './daily.mjs';

/** The fields that hold a time or a day, per tool. */
export const TIME_FIELDS = { remember_commitment: ['when'], update_commitment: ['when', 'from'], list_commitments: ['day'], schedule_block: ['day', 'start', 'end'], move_block: ['day', 'start', 'end', 'from'], show_day: ['day'] };
/** What each tool can take of what he said: a day, a clock time, a time from now ("in 20 minutes"), a length. */
export const TAKES = { remember_commitment: ['day', 'clock', 'rel'], update_commitment: ['day', 'clock', 'rel'], list_commitments: ['day'], show_day: ['day'], schedule_block: ['day', 'clock', 'length'], move_block: ['day', 'clock', 'length'] };
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
export function unsaid(name, args, said, fields = TIME_FIELDS) {
  return (fields[name] ?? []).filter((f) => args?.[f] != null && String(args[f]).trim() !== '' && !isSaid(args[f], said)).map((f) => ({ field: f, value: String(args[f]) }));
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
// ---- the completeness check: every time, day and length he said ----
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
const BEFORE_A_TIME = new Set(['at', 'from', 'to', 'until', 'till', 'by', 'around', 'before', 'after', 'about', 'between', 'and']);
// A span never starts with these: the words around a time are not part of it.
const LEAD = new Set(['at', 'from', 'to', 'until', 'till', 'by', 'around', 'before', 'after', 'about', 'between', 'and', 'on', 'this', 'due', 'for', 'the', 'of', 'past', 'o', 'clock', 'am', 'pm']);
/** The times, days and lengths in what he said, read by the parsers the tools use, in order.
 *  → [{ kind: 'day' | 'clock' | 'rel' | 'length', text (his words), minutes (a length) }] */
export function timesIn(said, { now = Date.now(), dayStart = 540, dayEnd = 1080 } = {}) {
  const w = normal(said).split(' ').filter(Boolean), out = [];
  for (let i = 0; i < w.length;) {
    let found = null;
    for (let n = Math.min(6, w.length - i); n >= 1 && !found; n--) {
      const part = w.slice(i, i + n), span = part.join(' '), prev = w[i - 1] ?? '';
      if (w[i] === 'in' && n > 1 && /^in /.test(span) && !/^in the /.test(span) && whenSaid(span, { now, dayStart, dayEnd })?.at != null) { found = { kind: 'rel', text: span, n }; break; }
      if (LEAD.has(w[i]) && !(w[i] === 'the' && /^\d/.test(w[i + 1] ?? ''))) continue;
      const len = prev === 'in' ? null : lengthSaid(span);
      if (len) { found = { kind: 'length', text: span, minutes: len, n }; break; }
      if (part.every(isDayWord) && !part.every((x) => /^\d+$/.test(x)) && (nextDays(span, now) || daySaid(span, { now }))) { found = { kind: 'day', text: span.replace(/^the (?=\d)/, ''), n }; break; }
      if (part.every((x) => CLOCK_VOCAB.has(x) || isNum(x)) && startSaid(span, { dayStart, dayEnd })) {
        const bare = n === 1 && (/^\d{1,2}$/.test(span) || HOUR_NAMES.includes(span));
        if (!bare || BEFORE_A_TIME.has(prev)) found = { kind: 'clock', text: span, n };
        break;
      }
    }
    if (found) { out.push(found); i += found.n; delete found.n; } else i++;
  }
  return out;
}
/** What a call leaves out of what he said: each time, day and length its tool can take has to be in one of its time
 *  fields (a length: `minutes` equal to code's reading of his words). → [{ kind, text, minutes }] */
export function missingTimes(name, args, said, opts = {}, { fields = TIME_FIELDS, takes: table = TAKES } = {}) {
  const takes = table[name];
  if (!takes) return [];
  const values = (fields[name] ?? []).map((f) => args?.[f]).filter((v) => v != null && String(v).trim() !== '').map(String);
  return timesIn(said, opts).filter((x) => takes.includes(x.kind) && !values.some((v) => isSaid(x.text, v)) && !(x.kind === 'length' && args?.minutes === x.minutes));
}
const WHERE = {
  remember_commitment: () => 'when', update_commitment: () => 'when',
  list_commitments: () => 'day', show_day: () => 'day',
  schedule_block: (k) => ({ day: 'day', clock: 'start or end', length: 'minutes, as a number' }[k]),
  move_block: (k) => ({ day: 'day', clock: 'start, end or from', length: 'minutes, as a number' }[k]),
};
/** The code-worded hint for a call that leaves out words he said. */
export function missingHint(miss, name, tool) {
  const list = miss.map((x) => `"${x.text}" (${WHERE[tool]?.(x.kind) ?? 'its time fields'})`).join(', ');
  return `Refused, nothing was changed: the call leaves out ${list} from ${name}'s words. Call ${tool} again now with every time, day and length he said, copied exactly.`;
}
const quoteList = (xs) => xs.map((x) => `"${x}"`).join(xs.length === 2 ? ' and ' : ', ');
/** The code-worded line that asks him, after a second refusal for words left out. */
export const askMissingLine = (miss) => `Nothing was changed: I couldn't use ${quoteList([...new Set(miss.map((x) => x.text))])}. Could you say it again?`;

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
/** A clock time as said, as HH:MM. → string or null */
export function startSaid(text, opts = {}) {
  const m = clockSaid(normal(text).replace(/^(?:at|from)\s+/, ''), opts);
  return m === null ? null : hhmm(m);
}

/** A day, a time or both as said ("thursday at 3", "3", "friday"). → { date (as daySaid gives it), clock (HH:MM) },
 *  either may be missing, or null when it is neither. */
export function dayAndClock(text, opts = {}) {
  const w = normal(text).replace(/^(?:from|at|on)\s+/, '').split(' ').filter(Boolean);
  for (let k = 0; k <= w.length; k++) {
    const l = w.slice(0, k).join(' '), r = w.slice(k).join(' ');
    for (const [ds, cs] of [[l, r], [r, l]]) {
      const d = ds ? daySaid(ds, opts) : null, c = cs ? startSaid(cs, opts) : null;
      if ((ds && !d) || (cs && !c) || (!d && !c)) continue;
      return { date: d?.date, clock: c };
    }
  }
  return null;
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

/** The checks for one request. said: what he said; userName: his name, for the hints.
 *  call(name, args) → { run: true } | { refuse: the hint for the model } | { ask: the line for him } (the second
 *    refusal), with `unsaid` (fields) and `missing` (his words) when refused;
 *  result(name, { ok, text, say }) → the code-worded line for him after a change, or '';
 *  finish(reply) → { reply, by: 'model' | 'refused' | 'replaced', replaced }: the reply he gets, the lines after
 *    changes first; a reply with a claim nothing confirmed is replaced; refused with nothing let through, the ask. */
export function createRequestCheck({ said, userName, now = Date.now(), hours = { dayStart: 540, dayEnd: 1080 }, fields = TIME_FIELDS, takes = TAKES, changes = WRITE_TOOLS }) {
  let refusals = 0, through = 0, lastAsk = '';
  const confirmed = new Set(), lines = [];
  return {
    get refusals() { return refusals; },
    get lines() { return [...lines]; },
    changes: (name) => changes.has(name),
    call(name, args) {
      const bad = unsaid(name, args, said, fields), miss = missingTimes(name, args, said, { now, ...hours }, { fields, takes });
      if (!bad.length && !miss.length) { through++; return { run: true }; }
      refusals++;
      lastAsk = bad.length ? askTimeLine(bad) : askMissingLine(miss);
      const why = { ...(bad.length ? { unsaid: bad.map((b) => b.field) } : {}), ...(miss.length ? { missing: miss.map((x) => x.text) } : {}) };
      if (refusals >= 2) return { ask: lastAsk, ...why };
      return { refuse: [bad.length ? refusedHint(bad, said, userName, name) : '', miss.length ? missingHint(miss, userName, name) : ''].filter(Boolean).join(' '), ...why };
    },
    result(name, res) {
      if (!res?.ok) return '';
      confirmed.add(name);
      if (!changes.has(name)) return '';
      const line = String(res.say || res.text || '');
      lines.push(line);
      return line;
    },
    finish(reply) {
      if (lastAsk && !through) return { reply: lastAsk, by: 'refused', replaced: 0 };
      const claims = unconfirmed(reply, confirmed);
      return { reply: [...lines, claims.length ? NOTHING_CHANGED : String(reply ?? '').trim()].filter(Boolean).join(' '), by: claims.length ? 'replaced' : 'model', replaced: claims.length };
    },
  };
}
