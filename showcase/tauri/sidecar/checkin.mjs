// Local-only build, feature 25: check-ins, and (feature 31) deadlines at risk. Worded, read and acted on here, in code;
// nothing of it reaches the model.
//
// A check-in asks whether a to-do is done:
//   - when its block today ends ("Your block for <title> has ended. Is it done?"), or, with no block today, when its
//     due time today passes ("<title> was due at <time>. Is it done?"). It takes the due-time nudge's place for to-dos
//     (the owner, 2026-11-25); reminders keep theirs.
//   - once for each time the to-do had; at most "limits.checkInsPerDay" a day; none after the day's review.
//   - none in the middle of a block (the owner, 2026-11-25): a block's own check-in comes at its end even when the next
//     block starts then; one for a due time, and one asked again, waits until a block has ended or none is running.
//   - answered by a button (Done, Still on it, Not yet) or by voice, judged here (parseCheckIn):
//       done: the to-do is marked done (its Done line follows in the daily note), and a block it still had to come is
//         taken off the calendar;
//       not yet, with a time ("not yet, Friday at 10"): read as the answers to "When will you do it?" are (daily.mjs);
//         "not yet" alone asks that question;
//       still on it: asked again "limits.checkInAgainMinutes" later, at most CHECK_AGAIN_TIMES times; at the review it
//         is still open, not missed, and the next morning it needs a new time like any other (the owner, 2026-11-25);
//       no answer: nothing changes. It is not kept as a pending question.
//     Each answer has its line in the daily note's Log; one answered here is not asked about again at the review.
//   - it goes through the speaking budget (quiet.mjs, kind "checkIn"); in the queue it goes out of date when the to-do
//     is done or moved, when the review has run, or when the day turns.
//
// A deadline at risk: an open to-do due within "limits.atRiskHours" that has no block ending before its due time.
// Said once for each due time it has ("<title> is due tomorrow at 10:00 and has no time planned before then."), kind
// "deadlineAtRisk"; in the queue it goes out of date when the to-do is done, gets such a block, or its time passes.
import os from 'node:os';
import { only, plainNum, unfilled } from './answers.mjs';
import { parseWhen, timeOn } from './daily.mjs';
import { loadSettings, readState, writeState } from './pi.mjs';

export const CHECK_AGAIN_TIMES = 2; // after "still on it", asked again at most this many times
// The answers, said alone (small words around them are fine). The buttons are the same three.
export const DONE_WORDS = ['done', 'its done', 'it is done', 'yes', 'yes done', 'yes its done', 'all done', 'finished', 'its finished', 'i finished it', 'i did it', 'did it', 'completed', 'complete', 'yep', 'yeah', 'yes i did'];
export const STILL_WORDS = ['still on it', 'still working on it', 'working on it', 'im on it', 'im still on it', 'still going', 'in progress', 'still doing it', 'almost done', 'nearly done', 'almost', 'nearly'];
// "Not yet", alone or followed by a time read as parseWhen reads one ("not yet, tomorrow at 10").
export const NOT_YET_WORDS = ['not yet', 'no', 'nope', 'not done', 'not done yet', 'no not yet', 'not really', 'i didnt', 'didnt do it', 'i didnt do it', 'not finished'];
const LEAD_INS = ['ill do it', 'i will do it', 'ill do that', 'ill get to it', 'do it', 'move it to', 'move it', 'make it', 'put it at', 'by'];
export const CHECK_HINT = '"done", "still on it", or "not yet" with a day and a time';
const DONE = only(DONE_WORDS, plainNum), STILL = only(STILL_WORDS, plainNum);
const longest = (list) => list.map(plainNum).sort((a, b) => b.length - a.length);
const NOT_YET = longest(NOT_YET_WORDS), LEADS = longest(LEAD_INS);
const after = (p, list) => { for (const w of list) if (p === w || p.startsWith(`${w} `)) return p.slice(w.length).trim(); return null; };

/** What was said, as the answer to a check-in: { kind: 'done' } | { kind: 'still' } | { kind: 'notyet', when? }
 *  (when: parseWhen's answer: a time, a day, leave or drop), or null when it is none of them. */
export function parseCheckIn(text, opts = {}) {
  const p = unfilled(text, plainNum);
  if (!p) return null;
  if (DONE.test(p)) return { kind: 'done' };
  if (STILL.test(p)) return { kind: 'still' };
  const rest = after(p, NOT_YET);
  const when = (t) => (t ? parseWhen(after(t, LEADS) ?? t, opts) : null);
  if (rest !== null) { if (!rest) return { kind: 'notyet' }; const w = when(rest); return w ? { kind: 'notyet', when: w } : null; }
  const w = when(p);
  return w && (w.kind === 'at' || w.kind === 'day') ? { kind: 'notyet', when: w } : null;
}

const pad = (n) => String(n).padStart(2, '0');
const hm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const oneLine = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
/** "today at 17:00", "tomorrow at 10:00", "Friday at 09:30". */
export function dueWords(ms, now = Date.now()) {
  const d = new Date(ms), n = new Date(now), days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / 864e5);
  return `${days === 0 ? 'today' : days === 1 ? 'tomorrow' : WEEKDAY[d.getDay()]} at ${hm(ms)}`;
}
/** The check-in's question. how: 'block' | 'due' | 'again'. */
export const checkQuestion = (how, title, at) => (how === 'block' ? `Your block for ${title} has ended. Is it done?` : how === 'due' ? `${title} was due at ${hm(at)}. Is it done?` : `Is ${title} done now?`);

/**
 * daily: the daily note (daily.mjs): today(), state(), editDay(), logLines(), whenOpts(), answerWhen().
 * todos(): the to-dos and reminders ([{ id, text, kind, status, due }]); blocks(): { id: { start, minutes, kept } }.
 */
export function createCheckIns({ home = os.homedir(), settings = () => loadSettings(home), daily, todos = () => [], blocks = () => ({}), log = () => {}, now = () => Date.now() } = {}) {
  const open = () => (Array.isArray(todos()) ? todos() : []).filter((t) => t && t.kind === 'commitment' && t.status === 'open');
  /** When a to-do's check-in comes today: { at, how: 'block' | 'due' } or null. */
  function moment(t, b, w) {
    const x = timeOn(t, b, w);
    return x ? { at: x.block ? x.end : x.at, how: x.block ? 'block' : 'due' } : null;
  }
  /** The blocks of the day, as the calendar has them now and as the daily note last saw them (a finished to-do loses
   *  its block on the calendar side). */
  function spans(t0, day) {
    const out = [];
    for (const b of Object.values(blocks())) if (b && Number.isFinite(b.start)) out.push([b.start, b.start + Math.max(b.minutes ?? 0, 0) * 60_000]);
    for (const p of Object.values(day.planned ?? {})) if (p?.block && Number.isFinite(p.at)) out.push([p.at, p.end]);
    return out.filter(([a]) => a >= t0.w.from && a < t0.w.until);
  }

  /** The check-ins due now, soonest first: [{ id, title, at, how, question }]. */
  function due() {
    const t0 = daily.today(), day = daily.state().days[t0.key] ?? {};
    if (day.review) return [];
    const checks = day.checks ?? {}, asked = Object.values(checks).reduce((n, c) => n + (c?.asks ?? 0), 0);
    if (asked >= t0.s.limits.checkInsPerDay) return [];
    const b = blocks(), t = now(), all = spans(t0, day);
    const running = all.some(([a, e]) => a <= t && t < e);
    const between = (since) => !running || all.some(([, e]) => e > since && e <= t); // not in the middle of a block
    const out = [];
    for (const td of open()) {
      const x = moment(td, b[td.id], t0.w);
      if (!x || x.at > t || x.at < t0.w.from) continue;
      const c = checks[td.id], title = oneLine(td.text);
      if (c && c.at === x.at) {
        if (c.answer !== 'still' || (c.again ?? 0) >= CHECK_AGAIN_TIMES || !(Number.isFinite(c.next) && t >= c.next) || !between(c.next)) continue;
        out.push({ id: td.id, title, at: x.at, how: 'again', question: checkQuestion('again', title, x.at) });
      } else if (x.how === 'block' || between(x.at)) out.push({ id: td.id, title, at: x.at, how: x.how, question: checkQuestion(x.how, title, x.at) });
    }
    return out.sort((a, c) => a.at - c.at).slice(0, Math.max(0, t0.s.limits.checkInsPerDay - asked));
  }
  /** A check-in is on its way (given now or queued): counted, and not due again for this time. → the queue item. */
  function mark(c) {
    const t0 = daily.today();
    daily.editDay(t0.key, (d) => {
      const was = d.checks?.[c.id]?.at === c.at ? d.checks[c.id] : null;
      d.checks = { ...(d.checks ?? {}), [c.id]: { at: c.at, asks: (was?.asks ?? 0) + 1, again: (was?.again ?? 0) + (c.how === 'again' ? 1 : 0), answer: was?.answer ?? null, next: null } };
    });
    return { kind: 'checkIn', data: { key: t0.key, id: c.id, at: c.at, how: c.how, title: c.title, question: c.question }, until: t0.w.until };
  }
  /** Whether a queued check-in has gone out of date: the to-do done or gone, moved, the review run, the day turned. */
  function stale(item) {
    const t0 = daily.today(), day = daily.state().days[t0.key] ?? {}, d = item.data ?? {};
    if (d.key !== t0.key || day.review) return true;
    const td = open().find((x) => x.id === d.id);
    if (!td) return true;
    const x = moment(td, blocks()[td.id], t0.w);
    return !x || x.at !== d.at;
  }
  // The last answer is kept (the review reads "still"); no answer to a check-in asked again leaves "still" as it was.
  const record = (id, answer, extra = {}) => { const t0 = daily.today(); daily.editDay(t0.key, (d) => { const c = d.checks?.[id]; if (c) d.checks = { ...d.checks, [id]: { ...c, answer: answer === 'none' && c.answer === 'still' ? 'still' : answer, ...extra } }; }); };
  /** Asks it. io: { ask(opts), say(text), done(id), reschedule(id, when) }. → the answer's kind, or 'none'. */
  async function ask(item, io) {
    const d = item.data, s = settings();
    const parse = (text) => parseCheckIn(text, { now: now(), dayStart: s.calendar.dayStart, dayEnd: s.calendar.dayEnd });
    const opts = { placeholder: d.question, spoken: d.question, choices: ['Done', 'Still on it', 'Not yet'], clicks: [{ kind: 'done' }, { kind: 'still' }, { kind: 'notyet' }], hint: CHECK_HINT, parse };
    let a = null;
    try { a = await io.ask(opts); } catch (e) { if (e?.name !== 'Unanswered') throw e; }
    const q = { id: d.id, title: d.title };
    if (!a) {
      record(d.id, 'none');
      daily.logLines([`- ${hm(now())} Check-in: ${d.title}: no answer`]);
      log('checkin', { how: d.how, answer: 'none' });
      return 'none';
    }
    if (a.kind === 'done') {
      record(d.id, 'done');
      await io.done(d.id);
      log('checkin', { how: d.how, answer: 'done' });
      await io.say(`${d.title}: marked done.`);
      return 'done';
    }
    if (a.kind === 'still') {
      record(d.id, 'still', { next: now() + s.limits.checkInAgainMinutes * 60_000 });
      daily.logLines([`- ${hm(now())} Check-in: ${d.title}: still on it`]);
      log('checkin', { how: d.how, answer: 'still' });
      return 'still';
    }
    record(d.id, 'notyet');
    let when = a.when ?? null;
    if (!when) {
      try { when = await io.ask(daily.whenOpts(`When will you do ${d.title}?`)); } catch (e) { if (e?.name !== 'Unanswered') throw e; }
    }
    const how = when ? await daily.answerWhen(q, when, io) : 'none';
    if (!when) daily.logLines([`- ${hm(now())} Check-in: ${d.title}: not yet`]);
    log('checkin', { how: d.how, answer: 'notyet', then: how });
    return 'notyet';
  }

  // ---- deadlines at risk, said once for each due time (state.json: checkIns.warned { id: due })
  const warned = () => { try { const w = readState(settings().dir).checkIns?.warned; return w && typeof w === 'object' ? w : {}; } catch { return {}; } };
  const safe = (td, b, due) => !!b && Number.isFinite(b.start) && b.start + Math.max(b.minutes ?? 0, 0) * 60_000 <= due;
  /** The to-dos at risk now, not said yet for their due time. Marked as said. → a queue item, or null. */
  function atRisk() {
    const s = settings(), t = now(), until = t + s.limits.atRiskHours * 3600_000, b = blocks(), was = warned();
    const lines = open().filter((td) => typeof td.due === 'number' && td.due > t && td.due <= until && !safe(td, b[td.id], td.due) && was[td.id] !== td.due).sort((a, c) => a.due - c.due)
      .map((td) => ({ id: td.id, due: td.due, until: td.due, text: `${oneLine(td.text)} is due ${dueWords(td.due, t)} and has no time planned before then.` }));
    if (!lines.length) return null;
    const ids = new Set(open().map((x) => x.id)), next = Object.fromEntries(Object.entries(was).filter(([id]) => ids.has(id)));
    for (const l of lines) next[l.id] = l.due;
    try { const dir = s.dir; writeState(dir, { ...readState(dir), checkIns: { ...(readState(dir).checkIns ?? {}), warned: next } }); } catch (e) { console.error('check-ins', e); }
    log('deadline_at_risk', { todos: lines.length });
    return { kind: 'deadlineAtRisk', lines };
  }
  /** Whether a line about a deadline at risk has gone out of date: done or gone, a new due time, or a block now. */
  function riskStale(line) {
    const td = open().find((x) => x.id === line.id);
    return !td || td.due !== line.due || safe(td, blocks()[td.id], td.due);
  }
  return { due, mark, stale, ask, atRisk, riskStale };
}
