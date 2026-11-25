// Local-only build, feature 33: stand down. The owner says the phrase ("standDown.phrase") or presses the shortcut
// ("standDown.shortcut"), and everything Roamies is doing stops at once: speech, the microphone and any answer window,
// the request to the model, pi and what pi started, and what is on screen. Code decides it; the model is never asked.
//
// The phrase counts only when it is all that was said, small words around it aside (STAND_FILL, the persona's name and
// form of address), in any order. The shell matches it on what the voice helper has heard so far (src-tauri/src/stand.rs,
// the twin of isStandDown below): once it has matched for STAND_SETTLE_MS with nothing more said, or in the final words.
// Words that went on past it (the phrase inside a longer sentence) do nothing. What was heard is never logged.
//
// While it lasts, nothing is said or shown unasked: briefings, reminders, calendar lines, notices and questions wait for
// a quiet moment as they always did, and being stood down is one more reason to wait. Nothing of it is dropped, except
// what the owner chose (2026-11-25): a briefing whose window passes is skipped as before, and a calendar line whose
// block has ended is dropped and counted. It ends when the owner next starts a conversation the usual way (a request,
// spoken or typed), or by itself at the day turn ("standDown.endsAtDayTurn"). Then one line worded here says what
// happened meanwhile, and what was held is given under the usual rules.
//
// Kept in state.json under "standDown", so a restart and a new overlay page keep it. One log line when it starts and
// one when it ends, with counts and true/false only. Nothing goes in the daily note.
import os from 'node:os';
import { noteDay, ymd } from './daily.mjs';
import { loadSettings, readState, writeState } from './pi.mjs';

/** The small words that may be said with the phrase, besides the persona's name and form of address. */
export const STAND_FILL = ['please', 'now', 'okay', 'ok'];
/** How long the phrase must have been all that was heard, with nothing more said, before it counts (the shell's). */
export const STAND_SETTLE_MS = 700;
/** At most this many lines caught on their way to the screen while stood down are kept to be shown afterwards. */
export const STAND_CAUGHT = 20;

/** The words of a phrase as they are compared: lower case, apostrophes dropped, split on anything not a letter or digit. */
export const standWords = (text) => String(text ?? '').toLowerCase().replace(/['’`]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** The small words allowed around the phrase for this persona. */
export const standFill = (persona = {}) => [...new Set([...STAND_FILL, ...standWords(persona.name), ...standWords(persona.address)])];
/** Whether what was heard is the phrase alone: the phrase, once or more, and nothing else but the small words. */
export function isStandDown(text, phrase, fill = STAND_FILL) {
  const w = standWords(text), p = Array.isArray(phrase) ? phrase : standWords(phrase), f = new Set(fill);
  if (!p.length) return false;
  let found = false;
  for (let i = 0; i < w.length;) {
    if (p.every((x, j) => w[i + j] === x)) { found = true; i += p.length; } else if (f.has(w[i])) i++; else return false;
  }
  return found;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** The one line said when it ends, for everything that happened meanwhile. '' when nothing did. */
export function standSummary({ pi = false, processes = 0, questions = 0, lines = 0, review = false } = {}) {
  const parts = [];
  if (pi) parts.push(processes ? `pi was stopped and ${plural(processes, 'process', 'processes')} it had left running ${processes === 1 ? 'was' : 'were'} ended` : 'pi was stopped');
  if (questions) parts.push(`${plural(questions, 'question')} I had open ${questions === 1 ? 'was' : 'were'} kept for later`);
  if (lines) parts.push(`${plural(lines, 'calendar line')} went by, ${lines === 1 ? 'its block' : 'their blocks'} over`);
  if (review) parts.push('the day\'s review was written in the daily note');
  return parts.length ? `While I stood down: ${parts.join('; ')}.` : '';
}

/**
 * The state, in state.json. settings: → loadSettings(home). log(kind, data): the activity log.
 * → { on(), start(by, what), add(counts), reviewed(key, line), caught(text, mood), end(by, held), turned(), give(), given(), state() }
 */
export function createStandDown({ home = os.homedir(), settings = () => loadSettings(home), log = () => {}, now = () => Date.now() } = {}) {
  const usable = (s) => !!s && typeof s === 'object' && typeof s.on === 'boolean' && Number.isFinite(Date.parse(s.since)) && s.counts && typeof s.counts === 'object' && Array.isArray(s.caught);
  let cur = null;
  try { const s = readState(settings().dir).standDown; cur = usable(s) ? s : null; } catch { cur = null; }
  const save = () => {
    try {
      const dir = settings().dir, st = readState(dir);
      if (cur) st.standDown = cur; else delete st.standDown;
      writeState(dir, st);
    } catch (e) { console.error('stand down', e); }
  };
  const on = () => !!cur?.on;
  return {
    on,
    /** It starts (by: 'phrase' | 'key'). what: what it stopped, true or false each, for the log line. → false when it
     *  was on already (then nothing is logged). What an earlier one left to say, not said yet, carries over. */
    start(by, what = {}) {
      if (on()) return false;
      cur = { on: true, since: new Date(now()).toISOString(), by: String(by), counts: cur?.counts ?? {}, caught: cur?.caught ?? [], ...(cur?.review ? { review: cur.review } : {}) };
      save();
      log('stand_down', { by: String(by), ...Object.fromEntries(Object.entries(what).map(([k, v]) => [k, !!v])) });
      return true;
    },
    /** What happened, for the line said at the end: true/false parts stay true once true, numbers add up. */
    add(counts) {
      if (!cur) return;
      for (const [k, v] of Object.entries(counts)) cur.counts[k] = typeof v === 'boolean' ? !!cur.counts[k] || v : (cur.counts[k] ?? 0) + v;
      save();
    },
    /** The day's review was written while stood down (key: its day): its line waits to be said. */
    reviewed(key, line) { if (!cur) return; cur.review = { key: String(key), line: String(line ?? '') }; save(); },
    /** A line that was on its way to the screen while stood down: kept to be shown after. → whether it was caught. */
    caught(text, mood = null) {
      if (!on()) return false;
      if (cur.caught.length < STAND_CAUGHT) cur.caught.push({ text: String(text ?? '').slice(0, 2000), mood: typeof mood === 'string' ? mood : null });
      save();
      return true;
    },
    /** It ends (by: 'voice' | 'typed' | 'day'); held: how many things are waiting to be given. → the state, or null. */
    end(by, held = 0) {
      if (!on()) return null;
      const minutes = Math.max(0, Math.round((now() - Date.parse(cur.since)) / 60_000));
      cur = { ...cur, on: false, endedBy: String(by) };
      save();
      log('stand_down_end', { by: String(by), minutes, held });
      return cur;
    },
    /** Whether the day has turned since it started, and "standDown.endsAtDayTurn" says that ends it. */
    turned() {
      if (!on()) return false;
      let s; try { s = settings(); } catch { return false; }
      if (!s.standDown.endsAtDayTurn) return false;
      const turn = s.calendar.dayTurnsAt;
      return ymd(noteDay(now(), turn)) !== ymd(noteDay(Date.parse(cur.since), turn));
    },
    /** What is left to give once it has ended: { counts, caught, review, quiet } (review: { key, line } when the day's
     *  review was written meanwhile; quiet: it ended at the day turn, so the line is shown and not said). null while it
     *  lasts, or when there is nothing. */
    give() {
      if (!cur || cur.on) return null;
      if (!standSummary(cur.counts) && !cur.caught.length && !cur.review) { cur = null; save(); return null; }
      return { counts: { ...cur.counts }, caught: cur.caught.slice(), review: cur.review ?? null, quiet: cur.endedBy === 'day' };
    },
    /** It has been given: forgotten. */
    given() { if (cur && !cur.on) { cur = null; save(); } },
    state: () => (cur ? { ...cur } : null),
  };
}
