// Local-only build, feature 31: the speaking budget and the quiet queue. One gate for everything Roamies would say or
// show unasked: briefings, the day's review, check-ins, deadlines at risk, calendar lines and the app's notices.
//
//   - A kind comes only when the owner switched it on ("speaking.<kind>"), and at most "speaking.perHour" times an
//     hour (what was given unasked in the last 60 minutes is counted, kept in state.json over a restart).
//   - Anything else waits here, in the quiet queue: nothing is said, nothing is shown, and the character carries a
//     small count. It waits too while Roamies is stood down (feature 33: this queue is what stand down holds), while the
//     owner is away ("speaking.awayMinutes" without keyboard or mouse input), and while another app uses the
//     microphone ("speaking.quietInCalls"). Why each thing waited is logged as one word: stood, off, away, call, budget.
//   - The queue is given at the end of the owner's next exchange (a typed request's reply, or a spoken exchange's end),
//     most urgent first (QUEUE_ORDER), at most "limits.queueGiveMost" each time, or when the owner asks "anything
//     waiting?" (said alone, answered by the app). Giving it doesn't count against the budget.
//   - What has gone out of date meanwhile is dropped and counted (a calendar line whose block ended, a check-in whose
//     to-do was done or moved, a deadline whose time passed, a briefing whose window closed); one line worded here says
//     so, with what stand down stopped, before the rest.
//   - Reminders the owner set never come here: they always speak (after a stand down, late) and are never counted.
//     What the owner asked for (a reply, pi's result) isn't unasked either; stand down alone holds it ("caught").
//
// Nothing here goes to the model: not the items, not the count, not the question or its answer. The log has kinds,
// counts and the one-word reasons only, never text.
import os from 'node:os';
import { only, plainNum, unfilled } from './answers.mjs';
import { SPEAKING_KINDS, loadSettings, readState, writeState } from './pi.mjs';
import { STAND_CAUGHT, standSummary } from './standdown.mjs';

/** Most urgent first. "caught": lines on their way to the screen while stood down (what the owner had asked for). */
export const QUEUE_ORDER = ['caught', 'deadlineAtRisk', 'checkIn', 'review', 'calendarLine', 'briefing', 'notice'];
/** Why something waited, in the order the rules are looked at. */
export const WHY = ['stood', 'off', 'away', 'call', 'budget'];
// Said alone (small words around it are fine), these ask for the queue. Checked here, never by the model.
export const WAITING_PHRASES = ['anything waiting', 'is anything waiting', 'is there anything waiting', 'anything waiting for me', 'whats waiting', 'what is waiting', 'whats in the queue', 'what is in the queue', 'anything in the queue', 'what did i miss', 'did i miss anything'];
const WAITING = only(WAITING_PHRASES, plainNum);
export const isWaitingAsk = (text) => WAITING.test(unfilled(text, plainNum));

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const STALE_WORDS = { checkIn: ['check-in'], deadlineAtRisk: ['deadline warning'], briefing: ['briefing'], notice: ['notice'] };
/** The one line said before what the queue gives: what stand down stopped (stood: its counts), and what went out of
 *  date meanwhile (stale: { kind: count }). '' when there is nothing to say. */
export function quietSummary({ stood = null, stale = {} } = {}) {
  const lines = (stale.calendarLine ?? 0) + (stood?.lines ?? 0), review = stale.review ?? 0;
  const rest = Object.entries(STALE_WORDS).filter(([k]) => stale[k]).map(([k, [w]]) => plural(stale[k], w));
  if (stood) {
    const first = standSummary({ ...stood, lines, review: !!review });
    const second = rest.length ? `Dropped as out of date: ${rest.join(' and ')}.` : '';
    return [first, second].filter(Boolean).join(' ');
  }
  const parts = [...(lines ? [plural(lines, 'calendar line')] : []), ...(review ? ['the day\'s review line (the review is in the daily note)'] : []), ...rest];
  return parts.length ? `Dropped as out of date: ${parts.join(' and ')}.` : '';
}

/**
 * settings: → loadSettings(home). log(kind, data): the activity log. stood(): stood down now. away(), call(): the
 * owner is away, another app uses the microphone (sidekick.mjs reads the shell's numbers). stale(item, line): whether
 * an item (or one of its lines) has gone out of date, beyond its "until". onCount(n): the count changed.
 * An item: { kind, text?, mood?, say?, lines?: [{ text, say?, until?, ... }], until?, data? }.
 */
export function createQuiet({ home = os.homedir(), settings = () => loadSettings(home), log = () => {}, now = () => Date.now(), stood = () => false, away = () => false, call = () => false, stale = () => false, onCount = () => {} } = {}) {
  const blank = () => ({ items: [], hour: [], stale: {}, stood: null, due: false });
  let cur;
  try {
    const q = readState(settings().dir).quiet;
    cur = q && typeof q === 'object' && Array.isArray(q.items) ? { ...blank(), ...q, hour: Array.isArray(q.hour) ? q.hour.filter(Number.isFinite) : [], stale: q.stale && typeof q.stale === 'object' ? q.stale : {} } : blank();
  } catch { cur = blank(); }
  let shown = -1;
  const count = () => cur.items.length;
  const save = () => {
    try { const dir = settings().dir; writeState(dir, { ...readState(dir), quiet: cur }); } catch (e) { console.error('quiet queue', e); }
    if (count() !== shown) { shown = count(); try { onCount(shown); } catch (e) { console.error('quiet queue', e); } }
  };
  const lastHour = () => cur.hour.filter((t) => now() - t < 3600_000 && t <= now());
  let seq = 0;

  /** Why a kind would wait now, as one word, or null when it may be given. Reminders never ask. */
  function reason(kind) {
    if (stood()) return 'stood';
    let s; try { s = settings().speaking; } catch { return null; }
    if (SPEAKING_KINDS.includes(kind) && s[kind] === false) return 'off';
    if (away()) return 'away';
    if (call()) return 'call';
    if (lastHour().length >= s.perHour) return 'budget';
    return null;
  }
  /** Puts an item in the queue (why: one of WHY). Lines caught while stood down are kept up to STAND_CAUGHT. */
  function hold(item, why) {
    if (item.kind === 'caught' && cur.items.filter((i) => i.kind === 'caught').length >= STAND_CAUGHT) return;
    cur.items.push({ ...item, id: `w${now().toString(36)}${(++seq).toString(36)}`, at: now(), why });
    save();
    log('quiet_queued', { kind: item.kind, why });
  }
  /** Something unasked is ready to be given: → true when it is to be given now (one from the hour's budget is spent),
   *  false when it went to the queue instead. */
  function offer(item) {
    const why = reason(item.kind);
    if (why) { hold(item, why); return false; }
    cur.hour = [...lastHour(), now()];
    save();
    return true;
  }
  const gone = (item, line = null) => { const u = (line ?? item).until; if (Number.isFinite(u) && u <= now()) return true; try { return !!stale(item, line); } catch { return false; } };
  /** Drops what went out of date, counted by kind (a line at a time for items made of lines). */
  function prune() {
    const n = {};
    const kept = [];
    for (const i of cur.items) {
      if (Array.isArray(i.lines)) {
        const lines = i.lines.filter((l) => !gone(i, l));
        if (lines.length < i.lines.length) n[i.kind] = (n[i.kind] ?? 0) + i.lines.length - lines.length;
        if (lines.length) kept.push({ ...i, lines });
      } else if (i.kind !== 'caught' && gone(i)) n[i.kind] = (n[i.kind] ?? 0) + 1;
      else kept.push(i);
    }
    if (!Object.keys(n).length) return n;
    cur.items = kept;
    for (const [k, v] of Object.entries(n)) { cur.stale[k] = (cur.stale[k] ?? 0) + v; log('quiet_stale', { kind: k, n: v }); }
    save();
    return n;
  }
  const anything = () => cur.items.length > 0 || Object.keys(cur.stale).length > 0 || !!cur.stood;
  return {
    reason, offer, hold, prune, count,
    has: (fn) => cur.items.some(fn),
    /** Stand down has ended: what it stopped is said with the queue. */
    stoodDown(counts = {}) {
      const c = { ...(cur.stood ?? {}) };
      for (const [k, v] of Object.entries(counts)) c[k] = typeof v === 'boolean' ? !!c[k] || v : (c[k] ?? 0) + v;
      cur.stood = c; // {} too: the line that comes is stand down's, even when only what went out of date is in it
      save();
    },
    /** An exchange of the owner's has ended: what waits is to be given (not while stood down). */
    exchanged() { if (stood() || !anything() || cur.due) return false; cur.due = true; save(); return true; },
    /** Whether the queue is to be given now that things are quiet. */
    ready: () => cur.due && !stood() && anything(),
    /** Takes what is to be given: the out-of-date dropped first; then the line and the items, most urgent first, at
     *  most `most` of them (lines caught while stood down all come with the line). → { summary, items, left, stood }
     *  or null when there is nothing. */
    take(most, by = 'exchange') {
      if (stood()) return null;
      prune();
      const summary = quietSummary({ stood: cur.stood, stale: cur.stale }), wasStood = !!cur.stood;
      const order = (i) => QUEUE_ORDER.indexOf(i.kind);
      const sorted = cur.items.slice().sort((a, b) => order(a) - order(b) || a.at - b.at);
      const caught = sorted.filter((i) => i.kind === 'caught'), rest = sorted.filter((i) => i.kind !== 'caught');
      const items = [...caught, ...rest.slice(0, Math.max(0, most))];
      if (!summary && !items.length) { if (cur.due || cur.stood || Object.keys(cur.stale).length) { cur.due = false; cur.stale = {}; cur.stood = null; save(); } return null; }
      const taken = new Set(items);
      cur.items = cur.items.filter((i) => !taken.has(i));
      const staleN = Object.values(cur.stale).reduce((a, b) => a + b, 0);
      cur.stale = {}; cur.stood = null; cur.due = false;
      save();
      log('quiet_given', { by, items: items.length, left: cur.items.length, stale: staleN });
      return { summary, items, left: cur.items.length, stood: wasStood };
    },
    state: () => JSON.parse(JSON.stringify(cur)),
  };
}
