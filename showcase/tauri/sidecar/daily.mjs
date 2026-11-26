// Local-only build, feature 18: the daily note. One note per day in the vault, "<dailyFolder>/YYYY-MM-DD.md", built
// by code and only ever added to (through the vault's one writer, notes.mjs).
//
//   - Plan: the to-dos planned for the day (a block on it, or due on it), the ones that need a new time (every time
//     they had has passed), and the deadlines coming up in the next COMING_DAYS days. Written by the morning
//     briefing, or by the first thing written in the note that day.
//   - Log: a line when a to-do is finished (seen at each check, whether it was ticked in Roamies or in Super
//     Productivity) and when a note is taken. A Log line that comes after another section starts a new "## Log".
//   - Review: each planned to-do as done, missed or still open today, the missed ones again under "Needs a new
//     time", and two sentences worded here. Written at "calendar.reviewAt", by the evening briefing when that comes
//     first, or when the owner asks for it. A second review adds "## Review update (HH:MM)" with only what changed.
//   - The morning briefing writes the Plan, and its note for the model counts the to-dos that need a new time
//     (morningNote), without naming them.
//   - Questions: after the review, each missed to-do is asked about ("When will you do it?"), and in the morning each
//     one that needs a new time: after the morning briefing, or at the end of the first exchange of the day when
//     there is no briefing. "limits.reviewQuestions" at most each time, oldest first; one line says how many are
//     left. The answer is judged here, in code (parseWhen): a day and a time, a day, "leave it" or "drop it". Roamies
//     never picks a time. A time moves the to-do's block there, or sets its due time when it has no block; a day
//     sets its due time; "leave it" changes nothing (it is asked again the next morning); "drop it" stops the
//     questions about that to-do and logs "Let go", leaving the to-do exactly as it is. No answer changes nothing.
//     These questions are not kept as pending questions: they come back the next morning.
//
//   - Handover: when the day turns, part one is written here by code in the last day of the conversation that
//     ends (handoverPartOne): the to-dos and reminders made, changed, done or dropped that day, the questions still
//     waiting, and the blocks kept until Super Productivity is open. Part two (handover.mjs) follows under fixed
//     headings: Decided, Left open (every open item, oldest first, as a checkbox with its block id ^oi-…), Worth
//     remembering.
//
//   - Feature 25 (check-ins, checkin.mjs): every line of the Plan's three lists is a checkbox carrying the to-do's id
//     (^td-<id>). A box ticked in Obsidian marks that to-do done (readTicks, at most every TICKS_MINUTES; an untick
//     does nothing, and the note is never ticked by code after it is written). A to-do last answered "still on it" in
//     a check-in is still open at the review, not missed; one answered in a check-in is not asked about again at the
//     review that day.
//
// Only to-dos count in the Plan, the Log and the Review (kind "commitment"); reminders and timers appear only in
// the handover's part one. pi's work is not in it (it stays in the records folder). Nothing here makes a request
// to the model, and nothing of the note goes to it.
// A day starts at "calendar.dayTurnsAt": before that time, it is still the day before.
import os from 'node:os';
import { only, unfilled } from './answers.mjs';
import { createVault } from './notes.mjs';
import { loadSettings, readState, writeState } from './pi.mjs';

export const COMING_DAYS = 14; // "Coming up": the deadlines in this many days after today
export const KEEP_DAYS = 14; // what is kept in state.json about each day
export const TICKS_MINUTES = 5; // the recent daily notes are read for ticked boxes at most this often
// Said alone (filler words around it are fine), these ask for the day's review. Checked here, never by the model.
export const REVIEW_PHRASES = ['review my day', 'review the day', 'review today', 'day review', 'daily review', 'evening review', 'end of day review', 'do my review', 'do the review', 'run the review', 'run my review', 'my day review', 'how did my day go', 'how did today go'];
const REVIEW = only(REVIEW_PHRASES);
export const isReviewAsk = (text) => REVIEW.test(unfilled(text));
// The answers to "When will you do it?" that aren't a time, said alone. The buttons are the same two.
export const LEAVE_WORDS = ['leave it', 'leave it for now', 'leave it there', 'leave', 'skip it', 'skip', 'not now', 'ask me later', 'ask me tomorrow'];
export const DROP_WORDS = ['drop it', 'drop', 'let it go', 'let go', 'forget it', 'forget about it', 'stop asking', 'stop asking about it'];
export const WHEN_HINT = 'a day and a time, a day, "leave it" or "drop it"';
const LEAVE = only(LEAVE_WORDS), DROP = only(DROP_WORDS);

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dayLong = (d) => `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const oneLine = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

/** The day a moment belongs to, as the note has it: before `turn` (minutes after midnight) it is still the day
 *  before. → a Date at 00:00. */
export function noteDay(ms, turn = 0) {
  const d = new Date(ms);
  if (d.getHours() * 60 + d.getMinutes() < turn) d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d;
}
// ---- the answer to "When will you do it?", judged in code
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTH_NAMES = MONTH.map((m) => m.toLowerCase());
const HOUR_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const ORDINAL_WORDS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth', 'twenty first', 'twenty second', 'twenty third', 'twenty fourth', 'twenty fifth', 'twenty sixth', 'twenty seventh', 'twenty eighth', 'twenty ninth', 'thirtieth', 'thirty first'];
const MINUTE_WORDS = { 'oh five': 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, 'forty five': 45, 'o clock': 0, oclock: 0 };
const words = (t) => String(t ?? '').toLowerCase().replace(/['’`]/g, '').replace(/\b([ap])\.?\s?m\b\.?/g, '$1m').replace(/(\d)([a-z])/g, '$1 $2').replace(/[^a-z0-9:]+/g, ' ').trim();
const alt = (list) => list.slice().sort((a, b) => b.length - a.length).join('|');
const ORD_RE = new RegExp(`^(?:the )?(?:(\\d{1,2})(?: (?:st|nd|rd|th))?|(${alt(ORDINAL_WORDS)}))(?: of)?(?: (${alt(MONTH_NAMES)}))?$`);
const MONTH_FIRST_RE = new RegExp(`^(${alt(MONTH_NAMES)}) (?:the )?(?:(\\d{1,2})(?: (?:st|nd|rd|th))?|(${alt(ORDINAL_WORDS)}))$`);
const LATER = '(?: (in the morning|in the afternoon|in the evening|at night|tonight))?';
const DIGIT_TIME = new RegExp(`^(\\d{1,2})(?::(\\d{2})| (\\d{2}))?(?: (am|pm|o clock|oclock))?${LATER}$`);
const WORD_TIME = new RegExp(`^(${alt(HOUR_WORDS)})(?: (${alt(Object.keys(MINUTE_WORDS))}))?(?: (am|pm))?${LATER}$`);
const PAST_TIME = new RegExp(`^(half past|quarter past|quarter to) (\\d{1,2}|${alt(HOUR_WORDS)})(?: (am|pm))?${LATER}$`);

/** A day as said: → { day (00:00), weekday, pm } or null. "Next friday" is not taken (which one is not guessed). */
function dayPart(str, today) {
  const t = str.replace(/^(?:on|this) /, '');
  const plus = (n) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + n);
  if (t === 'today') return { day: plus(0) };
  if (t === 'tonight') return { day: plus(0), pm: true };
  if (t === 'tomorrow') return { day: plus(1) };
  if (t === 'day after tomorrow' || t === 'the day after tomorrow') return { day: plus(2) };
  const w = DAY_NAMES.findIndex((n) => n === t || (t.length === 3 && n.startsWith(t)));
  if (w >= 0) return { day: plus((w - today.getDay() + 7) % 7), weekday: true };
  let n = null, month = null, m;
  if ((m = ORD_RE.exec(t)) && (m[1] || m[2]) && (t.startsWith('the ') || m[2] || m[3] || /\d (?:st|nd|rd|th)/.test(t))) { n = m[1] ? +m[1] : ORDINAL_WORDS.indexOf(m[2]) + 1; month = m[3] ? MONTH_NAMES.indexOf(m[3]) : null; }
  else if ((m = MONTH_FIRST_RE.exec(t))) { month = MONTH_NAMES.indexOf(m[1]); n = m[2] ? +m[2] : ORDINAL_WORDS.indexOf(m[3]) + 1; }
  if (n === null || n < 1 || n > 31) return null;
  for (let ahead = 0; ahead < 13; ahead++) {
    const y = today.getFullYear(), mo = month === null ? today.getMonth() + ahead : month, d = new Date(month === null ? y : y + ahead, mo, n);
    if (d.getDate() !== n) { if (month !== null) return null; continue; }
    if (d >= today) return { day: d };
    if (month !== null && ahead > 0) return null;
  }
  return null;
}
/** A time as said: → { h, m, mer, pm } or null. */
function timePart(str) {
  const t = str.replace(/^at /, '');
  if (t === 'noon' || t === 'midday') return { h: 12, m: 0, mer: 'pm' };
  const later = (x) => (x === 'in the morning' ? 'am' : x ? 'pm' : null);
  let m;
  if ((m = DIGIT_TIME.exec(t))) { const mer = m[4] === 'am' || m[4] === 'pm' ? m[4] : null; return { h: +m[1], m: m[2] ? +m[2] : m[3] ? +m[3] : 0, mer: mer ?? later(m[5]) }; }
  if ((m = WORD_TIME.exec(t))) return { h: HOUR_WORDS.indexOf(m[1]) + 1, m: m[2] ? MINUTE_WORDS[m[2]] : 0, mer: m[3] ?? later(m[4]) };
  if ((m = PAST_TIME.exec(t))) {
    const h = /^\d/.test(m[2]) ? +m[2] : HOUR_WORDS.indexOf(m[2]) + 1, mer = m[3] ?? later(m[4]);
    return m[1] === 'quarter to' ? { h: h - 1 || 12, m: 45, mer } : { h, m: m[1] === 'half past' ? 30 : 15, mer };
  }
  return null;
}
/** The minutes after midnight a time means. Without am or pm, an hour from 1 to 12 is the one inside the working day
 *  (dayStart to dayEnd); when neither is, before 7 means the afternoon. */
function minutesOf({ h, m, mer }, pm, dayStart, dayEnd) {
  if (h > 23 || m > 59) return null;
  if (mer) { if (h < 1 || h > 12) return null; return ((h % 12) + (mer === 'pm' ? 12 : 0)) * 60 + m; }
  if (h === 0 || h > 12) return h * 60 + m;
  if (h === 12) return 12 * 60 + m;
  const am = h * 60 + m, later = (h + 12) * 60 + m;
  if (pm) return later;
  if (am >= dayStart && am < dayEnd) return am;
  if (later >= dayStart && later < dayEnd) return later;
  return h < 7 ? later : am;
}
/** Feature 23: a clock time as said ("2", "16:30", "half past four", "at 9 am"), read as parseWhen reads one.
 *  → minutes after midnight, or null when it is not a time alone. */
export function clockSaid(text, { dayStart = 540, dayEnd = 1080 } = {}) {
  const t = timePart(words(text));
  return t ? minutesOf(t, false, dayStart, dayEnd) : null;
}
/** What was said, as the answer to "When will you do it?": { kind: 'at', start } (a day and a time; a time alone is
 *  the next one to come), { kind: 'day', day } (a day alone: 00:00), { kind: 'leave' }, { kind: 'drop' }, or null
 *  when it is none of them (a time that has passed, "next friday", anything else). */
export function parseWhen(text, { now = Date.now(), dayStart = 540, dayEnd = 1080 } = {}) {
  const p = unfilled(text, words), raw = words(text);
  if (!p) return null;
  if (LEAVE.test(p) || LEAVE.test(raw)) return { kind: 'leave' };
  if (DROP.test(p) || DROP.test(raw)) return { kind: 'drop' };
  const n = new Date(now), today = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  const tokens = p.split(' ');
  for (let k = 0; k <= tokens.length; k++) {
    const left = tokens.slice(0, k).join(' '), right = tokens.slice(k).join(' ');
    for (const [ds, ts] of [[left, right], [right, left]]) {
      const d = ds ? dayPart(ds, today) : null, t = ts ? timePart(ts) : null;
      if ((ds && !d) || (ts && !t) || (!d && !t)) continue;
      if (d && !t) {
        const due = d.day.getTime() + dayEnd * 60_000;
        if (due > now) return { kind: 'day', day: d.day };
        if (d.weekday) return { kind: 'day', day: new Date(d.day.getFullYear(), d.day.getMonth(), d.day.getDate() + 7) };
        return null;
      }
      const mins = minutesOf(t, !!d?.pm, dayStart, dayEnd);
      if (mins === null) return null;
      const on = d ? d.day : today;
      let start = new Date(on.getFullYear(), on.getMonth(), on.getDate(), 0, mins).getTime();
      if (start <= now) {
        if (!d) start = new Date(on.getFullYear(), on.getMonth(), on.getDate() + 1, 0, mins).getTime();
        else if (d.weekday) start = new Date(on.getFullYear(), on.getMonth(), on.getDate() + 7, 0, mins).getTime();
        else return null;
      }
      return { kind: 'at', start };
    }
  }
  return null;
}

/** The ids whose box is ticked ("- [x] … ^<prefix><id>") in the daily notes of the last KEEP_DAYS days. Feature 25:
 *  shared by the open items (^oi-, handover.mjs) and the Plan's to-dos (^td-). → a Set of what follows the prefix. */
export function readTicks({ vault, settings, now = Date.now(), prefix }) {
  const ticked = new Set(), re = new RegExp(`^[ \\t]*[-*+][ \\t]+\\[[xX]\\][^\\n]*\\^${prefix}([A-Za-z0-9-]+)[ \\t]*$`, 'gm');
  for (let k = 0; k < KEEP_DAYS; k++) {
    const d = noteDay(now, settings.calendar.dayTurnsAt); d.setDate(d.getDate() - k);
    const text = vault.read(`${settings.dailyFolder}/${ymd(d)}.md`);
    if (text) for (const m of text.matchAll(re)) ticked.add(m[1]);
  }
  return ticked;
}

/** A note day's stretch of time: from its turn to the next one. */
export function dayWindow(day, turn = 0) {
  return { from: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, turn).getTime(), until: new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, 0, turn).getTime() };
}
/** A time of the day (minutes) on a note day: one before the turn is after midnight, on the next date. */
const onDay = (day, mins, turn) => new Date(day.getFullYear(), day.getMonth(), day.getDate() + (mins < turn ? 1 : 0), 0, mins).getTime();

/** A to-do's time on a day: its block when the block is on that day, else its due time when that is.
 *  → { at, end, block } or null. */
export function timeOn(t, b, w) {
  if (b && b.start >= w.from && b.start < w.until) return { at: b.start, end: b.start + Math.max(b.minutes ?? 0, 0) * 60_000, block: b };
  if (typeof t.due === 'number' && t.due >= w.from && t.due < w.until) return { at: t.due, end: t.due, block: null };
  return null;
}
/** The latest of a to-do's times (its block's start, its due time), or null when it has none. */
export const latestTime = (t, b) => { const all = [b?.start, t.due].filter((x) => typeof x === 'number'); return all.length ? Math.max(...all) : null; };
const span = (x) => (x.block ? `${hm(x.at)} to ${hm(x.end)}` : `due ${hm(x.at)}`);

/**
 * todos(): every to-do and reminder that is open or was finished today: [{ id, text, kind, status, due, doneAt }].
 * blocks(): { to-do id: { start, minutes, kept } } (calendar.mjs).
 * The questions (ask) are given their means by the caller: io.ask(opts) is the bubble (answers.mjs, with parse),
 * io.reschedule(id, { start } | { day }) gives the to-do its new time (calendar.mjs) → { ok, line }, io.say(text)
 * says a line and resolves when it has been said.
 */
export function createDaily({ home = os.homedir(), userName = 'the user', todos = () => [], blocks = () => ({}), log = () => {}, now = () => Date.now(), pages = null } = {}) {
  // pages: the task pages (notes.mjs): link(id, title) for a to-do's title linked to its page, day(id, what, key)
  // for a line on its page when it is planned or finished that day.
  const onPage = (id, what, key) => { try { pages?.day(id, what, key); } catch (e) { log('daily_page_failed', { kind: e?.constructor?.name ?? 'Error' }); } };
  const vault = createVault({ home, userName });
  const settings = () => loadSettings(home);

  // ---- what is kept in state.json, under "daily": { days: { "YYYY-MM-DD": { plan, done, noted, planned, review } } }
  //   plan: when the Plan was written; done: { to-do id: { title, at } } for the Done lines written; noted: notes
  //   logged; planned: { to-do id: { title, at, end, block } }, each planned to-do as it was last seen (a finished
  //   one loses its block on the calendar side); review: { at, status: { id: 'done' | 'missed' | 'open' } };
  //   answered: { to-do id: 'moved' | 'left' | 'dropped' } for the questions answered that day; morning: when the
  //   morning's questions were asked. letGo: { to-do id: the latest time it had when it was let go }: no question
  //   about it while that is still its latest time.
  //   changes: { id: { title, kind, due, made, changed, done, dropped } }, what happened to the to-dos and
  //   reminders that day, for the handover. snap: { id: { t, d, s, k } }, the list at the last check.
  const blank = () => ({ days: {}, letGo: {} });
  function get() {
    const d = readState(settings().dir).daily;
    return d && typeof d === 'object' && !Array.isArray(d) ? { ...blank(), ...d, days: d.days && typeof d.days === 'object' ? d.days : {}, letGo: d.letGo && typeof d.letGo === 'object' ? d.letGo : {} } : blank();
  }
  function edit(fn) {
    const dir = settings().dir, d = get();
    const out = fn(d);
    const keys = Object.keys(d.days).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete d.days[k];
    writeState(dir, { ...readState(dir), daily: d });
    return out;
  }
  const editDay = (key, fn) => edit((d) => { d.days[key] = d.days[key] && typeof d.days[key] === 'object' ? d.days[key] : {}; return fn(d.days[key], d); });

  /** The day now, its stretch of time, its key and the note's place in the vault. */
  function today(ms = now()) {
    const s = settings(), turn = s.calendar.dayTurnsAt, day = noteDay(ms, turn), key = ymd(day);
    return { s, turn, day, key, w: dayWindow(day, turn), rel: `${s.dailyFolder}/${key}.md` };
  }
  const list = () => { const all = todos(); return Array.isArray(all) ? all.filter((t) => t && t.kind === 'commitment') : []; };

  /** What the Plan holds for a day, worked out now. */
  function planFor(t0) {
    const all = list(), b = blocks(), open = all.filter((t) => t.status === 'open');
    const planned = all.map((t) => ({ t, x: timeOn(t, b[t.id], t0.w) })).filter((p) => p.x);
    // A to-do finished earlier in the day has lost its block on the calendar side: it is planned as it was last seen.
    const seen = get().days[t0.key]?.planned ?? {};
    for (const t of all) if (t.status === 'done' && seen[t.id] && !planned.some((p) => p.t.id === t.id)) planned.push({ t, x: { at: seen[t.id].at, end: seen[t.id].end, block: seen[t.id].block ? { kept: false } : null } });
    planned.sort((a, c) => a.x.at - c.x.at);
    const gone = get().letGo;
    const needs = open.map((t) => ({ t, last: latestTime(t, b[t.id]) })).filter((p) => p.last !== null && p.last < t0.w.from && gone[p.t.id] !== p.last).sort((a, c) => a.last - c.last);
    const soon = t0.w.until + COMING_DAYS * 864e5;
    const coming = open.filter((t) => typeof t.due === 'number' && t.due >= t0.w.until && t.due < soon).sort((a, c) => a.due - c.due);
    return { planned, needs, coming };
  }
  // Feature 25: each line a checkbox with the to-do's id; one finished before the Plan is written is ticked.
  const box = (t, text) => `- [${t.status === 'done' ? 'x' : ' '}] ${text} ^td-${t.id}`;
  function planText(t0, p) {
    const lines = ['## Plan'];
    if (p.planned.length) for (const { t, x } of p.planned) lines.push(box(t, `${x.block ? `${span(x)} ${oneLine(t.text)}${x.block.kept && t.status !== 'done' ? ' (slot kept, not booked yet)' : ''}` : `${oneLine(t.text)} (${span(x)})`}${t.status === 'done' ? ' (done)' : ''}`));
    else lines.push('- Nothing is planned.');
    if (p.needs.length) lines.push('', '### Needs a new time', ...p.needs.map(({ t, last }) => box(t, `${oneLine(t.text)} (was ${dayLong(new Date(last))}, ${hm(last)})`)));
    if (p.coming.length) lines.push('', '### Coming up', ...p.coming.map((t) => box(t, `${dayLong(new Date(t.due))}: ${oneLine(t.text)} (due ${hm(t.due)})`)));
    return `${lines.join('\n')}\n`;
  }
  /** The note's top: the date, and links to the days before and after. */
  function head(t0) {
    const prev = new Date(t0.day); prev.setDate(prev.getDate() - 1);
    const next = new Date(t0.day); next.setDate(next.getDate() + 1);
    return `---\ndate: ${t0.key}\n---\n\n# ${dayLong(t0.day)} ${t0.day.getFullYear()}\n\n← [[${ymd(prev)}]] · [[${ymd(next)}]] →\n\n`;
  }

  /** Makes sure today's note has its Plan: written once a day, the first time anything is written in the note (or
   *  by the morning briefing). A note that is already there (made in Obsidian) is added to. → the day. */
  function ensure(t0 = today()) {
    if (get().days[t0.key]?.plan) return t0;
    const p = planFor(t0), text = planText(t0, p);
    if (!vault.create(t0.rel, head(t0) + text)) vault.append(t0.rel, `\n${text}`);
    editDay(t0.key, (d) => { d.plan = hm(now()); remember(d, p.planned); });
    for (const { t } of p.planned) if (t.status === 'open') onPage(t.id, 'planned', t0.key);
    log('daily_plan', { planned: p.planned.length, needs: p.needs.length, coming: p.coming.length });
    return t0;
  }
  const remember = (d, planned) => { d.planned = d.planned && typeof d.planned === 'object' ? d.planned : {}; for (const { t, x } of planned) d.planned[t.id] = { title: oneLine(t.text), at: x.at, end: x.end, block: !!x.block }; };

  /** Lines under the Log: a new "## Log" when the note's last heading is another one. */
  function logLines(t0, lines) {
    if (!lines.length) return;
    ensure(t0);
    const heads = (vault.read(t0.rel) ?? '').split('\n').filter((l) => /^#{1,6} /.test(l));
    vault.append(t0.rel, `${heads.at(-1)?.trim() === '## Log' ? '' : '\n## Log\n'}${lines.join('\n')}\n`);
  }

  /** What happened to the to-dos and reminders since the last check, kept for the handover: made (that day),
   *  changed (title or time), done, dropped (gone from the list while open). */
  function track(t0) {
    const all = (Array.isArray(todos()) ? todos() : []).filter((t) => t && (t.kind === 'commitment' || t.kind === 'reminder'));
    const inDay = (ms) => typeof ms === 'number' && ms >= t0.w.from && ms < t0.w.until;
    edit((d) => {
      const snap = d.snap && typeof d.snap === 'object' && !Array.isArray(d.snap) ? d.snap : null;
      const day = d.days[t0.key] = d.days[t0.key] && typeof d.days[t0.key] === 'object' ? d.days[t0.key] : {};
      const changes = day.changes = { ...(day.changes ?? {}) };
      const mark = (id, c, how) => { changes[id] = { ...(changes[id] ?? {}), ...c, [how]: true }; };
      const seen = {};
      for (const t of all) {
        const now_ = { t: oneLine(t.text), d: typeof t.due === 'number' ? t.due : null, s: t.status, k: t.kind }, c = { title: now_.t, kind: t.kind, due: now_.d };
        seen[t.id] = now_;
        const was = snap?.[t.id];
        if (!was && inDay(t.createdAt)) mark(t.id, c, 'made');
        else if (was && (was.t !== now_.t || was.d !== now_.d)) mark(t.id, c, 'changed');
        if (t.status === 'done' && inDay(t.doneAt) && !changes[t.id]?.done) mark(t.id, c, 'done');
      }
      if (snap) for (const [id, was] of Object.entries(snap)) if (!seen[id] && was?.s === 'open') mark(id, { title: was.t, kind: was.k, due: was.d }, 'dropped');
      d.snap = seen;
    });
  }

  /** The regular check: to-dos finished since the last one get a Done line, and what is planned is noted. */
  function tick() {
    track(today());
    const t0 = today(), day = get().days[t0.key] ?? {}, logged = day.done ?? {};
    const fresh = list().filter((t) => t.status === 'done' && typeof t.doneAt === 'number' && t.doneAt >= t0.w.from && t.doneAt < t0.w.until && !logged[t.id]).sort((a, b) => a.doneAt - b.doneAt);
    const p = planFor(t0);
    if (fresh.length) {
      logLines(t0, fresh.map((t) => `- ${hm(t.doneAt)} Done: ${oneLine(t.text)}`));
      for (const t of fresh) onPage(t.id, 'done', t0.key);
      log('daily_log', { what: 'done', lines: fresh.length });
    }
    editDay(t0.key, (d) => { d.done = { ...(d.done ?? {}) }; for (const t of fresh) d.done[t.id] = { title: oneLine(t.text), at: t.doneAt }; remember(d, p.planned.filter(({ t }) => t.status === 'open')); });
    return fresh.length;
  }

  /** A note was taken: its line in the Log, linked, and filed under its to-do when it is about one. */
  function noted(title, task = null) {
    const t0 = today(), t = task ? (todos() ?? []).find((x) => x?.id === task) : null;
    logLines(t0, [`- ${hm(now())} Note: [[${oneLine(title)}]]${t ? ` (for ${pages ? pages.link(t.id, t.text) : oneLine(t.text)})` : ''}`]);
    editDay(t0.key, (d) => { d.noted = (d.noted ?? 0) + 1; });
    log('daily_log', { what: 'note', lines: 1 });
  }

  /** Each planned to-do as it stands now: done, missed (its time is over) or still open today. */
  function standing(t0) {
    tick();
    const day = get().days[t0.key] ?? {}, b = blocks(), all = new Map(list().map((t) => [t.id, t]));
    const out = [];
    for (const [id, was] of Object.entries(day.planned ?? {})) {
      const t = all.get(id), doneHere = day.done?.[id];
      if (doneHere || t?.status === 'done') { out.push({ id, title: t ? oneLine(t.text) : was.title, status: 'done', x: was }); continue; }
      if (!t || t.status !== 'open') continue; // dropped, or gone: not part of the day any more
      const x = timeOn(t, b[id], t0.w);
      if (!x) continue; // moved to another day
      // Feature 25: last answered "still on it" in a check-in: still open today, not missed (the owner, 2026-11-25).
      out.push({ id, title: oneLine(t.text), status: x.end <= now() && day.checks?.[id]?.answer !== 'still' ? 'missed' : 'open', x: { at: x.at, end: x.end, block: !!x.block } });
    }
    return out.sort((a, c) => a.x.at - c.x.at);
  }
  const WORD = { done: 'Done', missed: 'Missed', open: 'Still open today' };
  const reviewLine = (r) => `- ${WORD[r.status]}: ${r.title}${r.status === 'done' ? '' : ` (${r.x.block ? `${hm(r.x.at)} to ${hm(r.x.end)}` : `due ${hm(r.x.at)}`})`}`;
  /** The two sentences under the review, worded here. */
  function summary(rows, extra, notes) {
    const n = rows.length, count = (s) => rows.filter((r) => r.status === s).length, missed = count('missed'), open = count('open');
    const first = n ? `${count('done')} of ${plural(n, 'planned to-do')} done${missed ? `, ${missed} missed` : ''}${open ? `, ${open} still open today` : ''}.` : 'Nothing was planned for today.';
    const second = `${extra ? `${plural(extra, 'more to-do')} done that ${extra === 1 ? 'wasn\'t' : 'weren\'t'} planned` : 'No other to-do was done'}, and ${plural(notes, 'note')} taken.`;
    return `${first} ${second}`;
  }

  /** The review: written in today's note. A second one adds only what changed. → { rows, missed, line } where line
   *  is what is said (counts only), or null when the note can't be written. */
  function review({ by = 'time' } = {}) {
    const t0 = ensure(today());
    const rows = standing(t0), day = get().days[t0.key] ?? {}, at = hm(now());
    const extra = Object.keys(day.done ?? {}).filter((id) => !day.planned?.[id]).length;
    const before = day.review?.status ?? null;
    const gone = get().letGo, b = blocks(), all = new Map(list().map((t) => [t.id, t]));
    const needs = rows.filter((r) => r.status === 'missed' && gone[r.id] !== latestTime(all.get(r.id) ?? {}, b[r.id]));
    const needsText = needs.length ? `\n### Needs a new time\n${needs.map((r) => `- ${r.title} (${r.x.block ? `${hm(r.x.at)} to ${hm(r.x.end)}` : `due ${hm(r.x.at)}`})`).join('\n')}\n` : '';
    let text;
    if (!before) text = `\n## Review (${at})\n${rows.length ? rows.map(reviewLine).join('\n') : '- Nothing was planned.'}\n\n${summary(rows, extra, day.noted ?? 0)}\n${needsText}`;
    else {
      const changed = rows.filter((r) => before[r.id] !== r.status);
      text = `\n## Review update (${at})\n${changed.length ? changed.map(reviewLine).join('\n') : `- Nothing has changed since ${day.review.at}.`}\n\n${summary(rows, extra, day.noted ?? 0)}\n${needsText}`;
    }
    vault.append(t0.rel, text);
    editDay(t0.key, (d) => { d.review = { at: before ? d.review.at : at, status: Object.fromEntries(rows.map((r) => [r.id, r.status])) }; });
    const count = (s) => rows.filter((r) => r.status === s).length;
    log('daily_review', { by, update: !!before, planned: rows.length, done: count('done'), missed: count('missed'), open: count('open') });
    const line = rows.length ? `Day review: ${count('done')} of ${plural(rows.length, 'planned to-do')} done${count('missed') ? `, ${count('missed')} missed` : ''}${count('open') ? `, ${count('open')} still open` : ''}. It's in today's note.` : 'Day review: nothing was planned for today. It\'s in today\'s note.';
    return { rows, missed: rows.filter((r) => r.status === 'missed'), line };
  }

  // ---- the questions
  /** Of these to-dos, the ones that may be asked about: not let go at the time they have, and not answered today. */
  function askable(t0, rows) {
    const d = get(), answered = d.days[t0.key]?.answered ?? {}, b = blocks(), all = new Map(list().map((t) => [t.id, t]));
    return rows.filter((r) => { const t = all.get(r.id); return t && t.status === 'open' && !answered[r.id] && d.letGo[r.id] !== latestTime(t, b[r.id]); });
  }
  /** What is asked: after the review, the missed to-dos; in the morning, the ones that need a new time. Oldest first. */
  function questions(kind, t0 = today()) {
    if (kind === 'review') return askable(t0, standing(t0).filter((r) => r.status === 'missed')).map((r) => ({ id: r.id, title: r.title, question: `${r.title} ${r.x.block ? `was planned for ${hm(r.x.at)} to ${hm(r.x.end)}` : `was due at ${hm(r.x.at)}`} and isn't done. When will you do it?` }));
    return askable(t0, planFor(t0).needs.map(({ t, last }) => ({ id: t.id, title: oneLine(t.text), last }))).map((r) => ({ id: r.id, title: r.title, question: `${r.title} needs a new time: it was ${dayLong(new Date(r.last))}, ${hm(r.last)}. When will you do it?` }));
  }
  /** Whether the morning's questions are to be asked at the end of this exchange: not asked yet today, a morning
   *  briefing isn't still to come (it asks them itself), and there is something to ask. */
  function morningDue() {
    try {
      const t0 = today();
      if (get().days[t0.key]?.morning) return false;
      const b = t0.s.briefings.morning, n = new Date(now()), mins = n.getHours() * 60 + n.getMinutes();
      const given = readState(t0.s.dir).briefings?.morning === ymd(n);
      if (b !== null && !given && mins < b + t0.s.limits.morningBriefingWindowHours * 60) return false;
      return questions('morning', t0).length > 0;
    } catch { return false; }
  }
  /** The bubble for "When will you do it?": two buttons, and a spoken answer judged by parseWhen. */
  function whenOpts(question) {
    const s = settings();
    return { placeholder: question, spoken: question, choices: ['Leave it', 'Drop it'], clicks: [{ kind: 'leave' }, { kind: 'drop' }], hint: WHEN_HINT, parse: (text) => parseWhen(text, { now: now(), dayStart: s.calendar.dayStart, dayEnd: s.calendar.dayEnd }) };
  }
  /** What an answer to "When will you do it?" does (q: { id, title }; a: parseWhen's answer), with its Log line, and
   *  marked as answered today. Feature 25: a check-in's "not yet" ends here too. → 'left' | 'dropped' | 'moved' | 'failed'. */
  async function answerWhen(q, a, io) {
    const mark = (how) => editDay(today().key, (d) => { d.answered = { ...(d.answered ?? {}), [q.id]: how }; });
    if (a.kind === 'leave') { mark('left'); return 'left'; }
    if (a.kind === 'drop') {
      const t = list().find((x) => x.id === q.id), b = blocks()[q.id];
      edit((d) => { d.letGo = { ...d.letGo, [q.id]: t ? latestTime(t, b) : null }; const open = new Set(list().filter((x) => x.status === 'open').map((x) => x.id)); for (const id of Object.keys(d.letGo)) if (!open.has(id)) delete d.letGo[id]; });
      mark('dropped');
      logLines(today(), [`- ${hm(now())} Let go: ${q.title}`]);
      await io.say(`I'll stop asking about ${q.title}.`);
      return 'dropped';
    }
    const r = await io.reschedule(q.id, a.kind === 'at' ? { start: a.start } : { day: a.day });
    if (r.ok) {
      mark('moved');
      logLines(today(), [`- ${hm(now())} Rescheduled: ${q.title} → ${a.kind === 'at' ? `${dayLong(new Date(a.start))}, ${hm(a.start)}` : `due ${dayLong(a.day)}`}`]);
    }
    if (r.line) await io.say(r.line);
    return r.ok ? 'moved' : 'failed';
  }
  /** Asks about each to-do (kind: 'review' | 'morning'), at most limits.reviewQuestions of them, oldest first, one
   *  at a time; the first left unanswered ends the round. → { asked, left }. */
  async function ask(kind, io) {
    const t0 = ensure(today()), most = t0.s.limits.reviewQuestions, all = questions(kind, t0);
    if (kind === 'morning') editDay(t0.key, (d) => { d.morning = hm(now()); });
    const counts = { moved: 0, leave: 0, dropped: 0, failed: 0 };
    let asked = 0, ended = '';
    for (const q of all.slice(0, most)) {
      let a;
      try { a = await io.ask(whenOpts(q.question)); } catch (e) { if (e?.name !== 'Unanswered') throw e; ended = 'unanswered'; asked++; break; }
      asked++;
      if (!a) { ended = 'closed'; break; }
      const how = await answerWhen(q, a, io);
      counts[{ left: 'leave', dropped: 'dropped', moved: 'moved', failed: 'failed' }[how]]++;
    }
    const left = all.length - asked;
    if (left > 0) await io.say(`${left} more ${left === 1 ? 'needs' : 'need'} a new time: ${left === 1 ? 'it\'s' : 'they\'re'} in today's note under Needs a new time.`);
    log('daily_questions', { kind, total: all.length, asked, left, ...counts, ...(ended ? { ended } : {}) });
    return { asked, left };
  }

  /** Whether the review is due by the clock: "calendar.reviewAt" has come today and today has no review yet. */
  function reviewDue() {
    try {
      const t0 = today();
      if (t0.s.calendar.reviewAt === null || get().days[t0.key]?.review) return false;
      return now() >= onDay(t0.day, t0.s.calendar.reviewAt, t0.turn) && now() < t0.w.until;
    } catch { return false; }
  }

  // ---- the handover (handover.mjs words part two; this writes both parts in the note)
  /** A day's note, by its key: written to at its end, made (without a Plan) when it isn't there. */
  function section(key, text) {
    const [y, m, dd] = key.split('-').map(Number), t0 = today(new Date(y, m - 1, dd, 23, 59).getTime());
    if (!vault.create(t0.rel, head(t0) + text.replace(/^\n+/, ''))) vault.append(t0.rel, text.startsWith('\n') ? text : `\n${text}`);
  }
  /** Part one, written by code in the last day of the conversation that ends. pending: the questions still waiting
   *  ({ brief, at }), kept: the blocks kept until Super Productivity is open ({ brief }), link(id, title): a to-do's
   *  title linked to its task page. → true. */
  function handoverPartOne(key, { pending = [], kept = [], link = (id, title) => title } = {}) {
    try { if (key === today().key) track(today()); } catch { /* counted as it was */ }
    const changes = Object.entries(get().days[key]?.changes ?? {});
    const how = (c) => { const w = [c.made && 'made', c.changed && !c.made && 'changed', c.done && 'done', c.dropped && 'dropped'].filter(Boolean).join(' and '); return w.charAt(0).toUpperCase() + w.slice(1); };
    const when = (c) => (!c.done && !c.dropped && typeof c.due === 'number' ? ` (due ${dayLong(new Date(c.due))}, ${hm(c.due)})` : '');
    const lines = [`\n## Handover (written ${dayLong(new Date(now()))}, ${hm(now())})`];
    if (changes.length) lines.push('### To-dos and reminders', ...changes.map(([id, c]) => `- ${how(c)}${c.kind === 'reminder' ? ' (reminder)' : ''}: ${c.kind === 'commitment' ? link(id, c.title) : c.title}${when(c)}`));
    if (pending.length) lines.push('### Questions still waiting', ...pending.map((q) => `- ${oneLine(q.brief || q.kind)}${q.at ? ` (asked ${String(q.at).slice(0, 10)})` : ''}`));
    if (kept.length) lines.push('### Kept until Super Productivity is open', ...kept.map((a) => `- ${oneLine(a.brief)}`));
    if (lines.length === 1) lines.push('- Nothing changed on the list, no question is waiting, and no block is kept.');
    section(key, `${lines.join('\n')}\n`);
    log('daily_handover', { part: 1, changes: changes.length, pending: pending.length, kept: kept.length });
    return true;
  }
  /** Part two, under its fixed headings; Left open is every open item, oldest first, as a checkbox with its id. */
  function handoverPartTwo(key, { decided = [], items = [], remember = [] } = {}) {
    const list = (xs) => (xs.length ? xs.map((x) => `- ${oneLine(x)}`) : ['- Nothing.']);
    const since = (k) => { const [y, m, dd] = String(k).split('-').map(Number); return y ? dayLong(new Date(y, m - 1, dd)) : k; };
    section(key, `${['### Decided', ...list(decided), '### Left open', ...(items.length ? items.map((i) => `- [ ] ${oneLine(i.text)} (since ${since(i.day)}) ^${i.id}`) : ['- Nothing.']), '### Worth remembering', ...list(remember)].join('\n')}\n`);
    log('daily_handover', { part: 2, decided: decided.length, open: items.length, remember: remember.length });
    return true;
  }
  /** Lines for today's Log (feature 18: open items closed or let go). */
  const logged = (lines) => logLines(today(), lines);

  const morningAsked = () => { try { return !!get().days[today().key]?.morning; } catch { return true; } };
  /** For the morning briefing's note: how many to-dos need a new time, counted, never named (the app asks about
   *  them itself after the briefing). '' when there are none, or they were asked about already today. */
  function morningNote() {
    try {
      const t0 = today();
      if (get().days[t0.key]?.morning) return '';
      const n = questions('morning', t0).length;
      return n ? `\n${plural(n, 'to-do')} on the list ${n === 1 ? 'needs' : 'need'} a new time: every time ${n === 1 ? 'it' : 'they'} had has passed. The app asks about ${n === 1 ? 'it' : 'each one'} itself right after you speak: mention how many in one short sentence, don't name ${n === 1 ? 'it' : 'them'}, and don't ask about ${n === 1 ? 'it' : 'them'} yourself.` : '';
    } catch { return ''; }
  }
  /** Whether the evening briefing writes the review first: there is a review time ("" is only when asked) and today
   *  has no review yet. */
  function reviewWithBriefing() {
    try { const t0 = today(); return t0.s.calendar.reviewAt !== null && !get().days[t0.key]?.review; } catch { return false; }
  }
  // ---- feature 25: the Plan's boxes ticked in Obsidian
  let ticksAt = -Infinity;
  /** The open to-dos whose box is ticked in a recent daily note, each once (state.json: daily.ticked), at most every
   *  TICKS_MINUTES. done(id) marks one done. → how many. */
  async function checkTicks(done) {
    if (now() - ticksAt < TICKS_MINUTES * 60_000) return 0;
    ticksAt = now();
    const all = Array.isArray(todos()) ? todos() : [], open = new Set(all.filter((t) => t?.status === 'open' && t.kind === 'commitment').map((t) => t.id));
    const seen = get().ticked ?? {}, ticked = [...readTicks({ vault, settings: settings(), now: now(), prefix: 'td-' })].filter((id) => open.has(id) && !seen[id]);
    if (!ticked.length) return 0;
    const known = new Set(all.map((t) => t?.id));
    edit((d) => { d.ticked = Object.fromEntries([...Object.keys(d.ticked ?? {}).filter((id) => known.has(id)), ...ticked].map((id) => [id, true])); });
    for (const id of ticked) await done(id);
    log('plan_ticked', { todos: ticked.length });
    return ticked.length;
  }
  return { tick, noted, ensure, whenOpts, answerWhen, checkTicks, editDay, logLines: (lines) => logLines(today(), lines), review, reviewDue, reviewWithBriefing, questions, morningDue, morningAsked, morningNote, ask, handoverPartOne, handoverPartTwo, logged, today, planFor, state: get };
}
