// Local-only build, feature 18: the daily note. One note per day in the vault, "<dailyFolder>/YYYY-MM-DD.md", built
// by code and only ever added to (through the vault's one writer, notes.mjs).
//
//   - Plan: the to-dos planned for the day (a block on it, or due on it), the ones that need a new time (every time
//     they had has passed), and the deadlines coming up in the next COMING_DAYS days. Written by the morning
//     briefing, or by the first thing written in the note that day.
//   - Log: a line when a to-do is finished (seen at each check, whether it was ticked in Roamies or in Super
//     Productivity) and when a note is taken. A Log line that comes after another section starts a new "## Log".
//   - Review: each planned to-do as done, missed or still open today, and two sentences worded here. Written at
//     "calendar.reviewAt", or when the owner asks for it. A second review adds "## Review update (HH:MM)" with only
//     what changed.
//
// Only to-dos count (kind "commitment"); reminders and timers never appear. pi's work is not in it (it stays in the
// records folder). Nothing here makes a request to the model, and nothing of the note goes to it.
// A day starts at "calendar.dayTurnsAt": before that time, it is still the day before.
import os from 'node:os';
import { only, unfilled } from './answers.mjs';
import { createVault } from './notes.mjs';
import { loadSettings, readState, writeState } from './pi.mjs';

export const COMING_DAYS = 14; // "Coming up": the deadlines in this many days after today
export const KEEP_DAYS = 14; // what is kept in state.json about each day
// Said alone (filler words around it are fine), these ask for the day's review. Checked here, never by the model.
export const REVIEW_PHRASES = ['review my day', 'review the day', 'review today', 'day review', 'daily review', 'evening review', 'end of day review', 'do my review', 'do the review', 'run the review', 'run my review', 'my day review', 'how did my day go', 'how did today go'];
const REVIEW = only(REVIEW_PHRASES);
export const isReviewAsk = (text) => REVIEW.test(unfilled(text));

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
 */
export function createDaily({ home = os.homedir(), userName = 'the user', todos = () => [], blocks = () => ({}), log = () => {}, now = () => Date.now() } = {}) {
  const vault = createVault({ home, userName });
  const settings = () => loadSettings(home);

  // ---- what is kept in state.json, under "daily": { days: { "YYYY-MM-DD": { plan, done, noted, planned, review } } }
  //   plan: when the Plan was written; done: { to-do id: { title, at } } for the Done lines written; noted: notes
  //   logged; planned: { to-do id: { title, at, end, block } }, each planned to-do as it was last seen (a finished
  //   one loses its block on the calendar side); review: { at, status: { id: 'done' | 'missed' | 'open' } }.
  const blank = () => ({ days: {} });
  function get() {
    const d = readState(settings().dir).daily;
    return d && typeof d === 'object' && !Array.isArray(d) ? { ...blank(), ...d, days: d.days && typeof d.days === 'object' ? d.days : {} } : blank();
  }
  function edit(fn) {
    const dir = settings().dir, all = readState(dir), d = all.daily && typeof all.daily === 'object' ? { ...blank(), ...all.daily } : blank();
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
    const needs = open.map((t) => ({ t, last: latestTime(t, b[t.id]) })).filter((p) => p.last !== null && p.last < t0.w.from).sort((a, c) => a.last - c.last);
    const soon = t0.w.until + COMING_DAYS * 864e5;
    const coming = open.filter((t) => typeof t.due === 'number' && t.due >= t0.w.until && t.due < soon).sort((a, c) => a.due - c.due);
    return { planned, needs, coming };
  }
  function planText(t0, p) {
    const lines = ['## Plan'];
    if (p.planned.length) for (const { t, x } of p.planned) lines.push(`- ${x.block ? `${span(x)} ${oneLine(t.text)}${x.block.kept && t.status !== 'done' ? ' (slot kept, not booked yet)' : ''}` : `${oneLine(t.text)} (${span(x)})`}${t.status === 'done' ? ' (done)' : ''}`);
    else lines.push('- Nothing is planned.');
    if (p.needs.length) lines.push('', '### Needs a new time', ...p.needs.map(({ t, last }) => `- ${oneLine(t.text)} (was ${dayLong(new Date(last))}, ${hm(last)})`));
    if (p.coming.length) lines.push('', '### Coming up', ...p.coming.map((t) => `- ${dayLong(new Date(t.due))}: ${oneLine(t.text)} (due ${hm(t.due)})`));
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

  /** The regular check: to-dos finished since the last one get a Done line, and what is planned is noted. */
  function tick() {
    const t0 = today(), day = get().days[t0.key] ?? {}, logged = day.done ?? {};
    const fresh = list().filter((t) => t.status === 'done' && typeof t.doneAt === 'number' && t.doneAt >= t0.w.from && t.doneAt < t0.w.until && !logged[t.id]).sort((a, b) => a.doneAt - b.doneAt);
    const p = planFor(t0);
    if (fresh.length) {
      logLines(t0, fresh.map((t) => `- ${hm(t.doneAt)} Done: ${oneLine(t.text)}`));
      log('daily_log', { what: 'done', lines: fresh.length });
    }
    editDay(t0.key, (d) => { d.done = { ...(d.done ?? {}) }; for (const t of fresh) d.done[t.id] = { title: oneLine(t.text), at: t.doneAt }; remember(d, p.planned.filter(({ t }) => t.status === 'open')); });
    return fresh.length;
  }

  /** A note was taken: its line in the Log, linked. */
  function noted(title) {
    const t0 = today();
    logLines(t0, [`- ${hm(now())} Note: [[${oneLine(title)}]]`]);
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
      out.push({ id, title: oneLine(t.text), status: x.end <= now() ? 'missed' : 'open', x: { at: x.at, end: x.end, block: !!x.block } });
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
    let text;
    if (!before) text = `\n## Review (${at})\n${rows.length ? rows.map(reviewLine).join('\n') : '- Nothing was planned.'}\n\n${summary(rows, extra, day.noted ?? 0)}\n`;
    else {
      const changed = rows.filter((r) => before[r.id] !== r.status);
      text = `\n## Review update (${at})\n${changed.length ? changed.map(reviewLine).join('\n') : `- Nothing has changed since ${day.review.at}.`}\n\n${summary(rows, extra, day.noted ?? 0)}\n`;
    }
    vault.append(t0.rel, text);
    editDay(t0.key, (d) => { d.review = { at: before ? d.review.at : at, status: Object.fromEntries(rows.map((r) => [r.id, r.status])) }; });
    const count = (s) => rows.filter((r) => r.status === s).length;
    log('daily_review', { by, update: !!before, planned: rows.length, done: count('done'), missed: count('missed'), open: count('open') });
    const line = rows.length ? `Day review: ${count('done')} of ${plural(rows.length, 'planned to-do')} done${count('missed') ? `, ${count('missed')} missed` : ''}${count('open') ? `, ${count('open')} still open` : ''}. It's in today's note.` : 'Day review: nothing was planned for today. It\'s in today\'s note.';
    return { rows, missed: rows.filter((r) => r.status === 'missed'), line };
  }

  /** Whether the review is due by the clock: "calendar.reviewAt" has come today and today has no review yet. */
  function reviewDue() {
    try {
      const t0 = today();
      if (t0.s.calendar.reviewAt === null || get().days[t0.key]?.review) return false;
      return now() >= onDay(t0.day, t0.s.calendar.reviewAt, t0.turn) && now() < t0.w.until;
    } catch { return false; }
  }

  return { tick, noted, ensure, review, reviewDue, today, planFor, state: get };
}
