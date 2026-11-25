// Local-only build, feature 22: conversation flow. When Roamies asks something, the owner answers by just speaking.
//
// Three things live here, and nothing else decides them:
//   - The exchange. It opens when a request is made by voice and ends on a closing phrase said alone ("thanks") or
//     after a quiet time following Roamies' last reply. While it is open, what Roamies shows it also says.
//   - The answer window. After a question has been said, the microphone opens by itself for a set time. It opens
//     only when the overlay has reported that the question has finished playing (a mark, speaker.mjs and
//     voice-out.js): never on an estimate, so Roamies doesn't hear itself. What is heard in the window is judged in
//     code: an answer settles the question; anything else is logged by its shape and dropped. It is never a request,
//     so it never reaches the model, the session or the activity record. The window stays open until it runs out.
//   - Pending questions. A question whose window ran out with no answer is closed and kept in state.json under
//     "pending" (never in the notes vault). Nothing is sent or changed. When the next exchange ends (not the one it
//     went unanswered in), the oldest one is asked again, one at a time, spoken and with its window. A hand-off is
//     asked again in full and never sent because it was pending.
//     The same question is pending once (SAME, below, says what "the same" is for each kind): asked again while it
//     is pending, the new one takes the old one's place. When a question is answered, however that happens (a
//     spoken answer, a click, the same question asked again by a later request), every pending copy of it is cleared
//     without a word. One that no longer applies because the thing was done is dropped without a word too; one that
//     no longer applies and loses something the owner still wanted (its time has passed) is dropped with one line;
//     one that is too old is dropped.
//
// The microphone is closed at the window's end three times over, each on its own:
//   1. the voice helper has the window's length and stops listening at that time itself (voice/main.swift);
//   2. the timer here sends the cancel at the same time;
//   3. a phrase marked with a window that is over (or isn't this one) is discarded.
// A phrase that was finished inside the window may be judged up to WINDOW.graceSeconds after its end, while the
// recogniser finishes its words; the microphone is already closed by then.
//
// The model's own questions (a reply ending in a question, Auto Listen) use the same window when
// "autoListenQuestions" is on: opened on the same report, closed by the same three stops. What is said there goes to
// the model as the answer, as before.
import os from 'node:os';
import { z } from 'zod';
import { heardShape, isClosing } from './answers.mjs';
import { WINDOW, loadSettings, readState, writeState } from './pi.mjs';

/** What makes two pending questions the same one, for each kind: the parts of its data that are compared. A kind
 *  that isn't here is the same only when all of its data is. */
export const SAME = {
  handoff: (d) => [d.project, d.mode, String(d.prompt ?? '').trim()], // the same prompt, for the same folder, in the same mode
  project: (d) => [String(d.name ?? '').toLowerCase()], // the same project
  start: () => [], // there is one: putting the to-do list in Super Productivity
  adopt: () => [], // there is one: adding the app's open tasks to the to-do list
  deleted: (d) => [d.todo], // the same to-do
  offer: (d) => [d.todo], // "<title> is urgent and important and has no block. Book one?": the same to-do
  overlap: (d) => [d.todo], // the same to-do: it has one block, so a newer time takes the older one's place
  plan: (d) => [d.date], // the same day
  sort: () => [], // there is one: the newest proposal takes the older one's place
  same: (d) => [d.todo], // "move it, or make a second one?": the same to-do that is already booked
  near: (d) => [d.todo, String(d.args?.title ?? '').trim().toLowerCase()], // "is this <title>, or a new task?": the same title asked about the same to-do
  day: (d) => [d.tool, d.args?.todo ?? String(d.args?.title ?? '').trim().toLowerCase()], // "next friday": the same block, by its to-do, or by its title when it has none yet
};
/** The questions whose wording names a to-do, as the morning briefing's note has them: what they are about. */
const UNNAMED = {
  overlap: 'whether to place a block that overlaps something',
  deleted: 'whether a to-do goes too, now that its task was deleted in Super Productivity',
  offer: 'whether to book a block for an urgent and important to-do',
  day: 'which of two days a block is for',
  same: 'whether a to-do that is already booked moves, or a second one is made',
  near: 'whether a block is for a to-do already on the list, or for a new task',
  plan: 'whether to put a day plan on the calendar',
};
export const sameKey = (q) => `${q?.kind}:${JSON.stringify((SAME[q?.kind] ?? ((d) => [d]))(q?.data ?? {}))}`;

/**
 * speak(text | null): says a line when replies are spoken, and resolves when the overlay reports that everything
 *   handed over has finished playing (with null: when nothing is playing). It never resolves on a guess.
 * announce(text): the same for a line that is also shown in a bubble.
 * listen({ seconds, window, again }) opens the microphone hands-free for that long; cancel() closes it.
 * bubbles(): the holders of open questions, each with heard(text, { handsFree }) → true when one was open.
 * idle(): nothing is going on (no request running or waiting, nobody talking, no question open).
 * onWindow(open, by): the answer window opened or closed (speech is held back meanwhile).
 * onPending(event, question): 'pending' | 'answered' | 'dropped'. The daily note's hook (feature 18); unused for now.
 * actions(): what is kept until Super Productivity is open (calendar.mjs), [{ at, brief }]. show_pending and the
 *   morning briefing's note list them. They are not questions: nothing here asks or runs them.
 * afterExchange: { due(), run() }. Feature 18: when an exchange ends and due() is true, run() asks its questions
 *   (the daily note's morning questions) as a series, before any pending question is raised.
 */
export function createFlow({ home = os.homedir(), settings = () => loadSettings(home), speak = async () => {}, announce = async () => {}, listen = () => {}, cancel = () => {}, bubbles = () => [], idle = () => true, onWindow = () => {}, onPending = () => {}, actions = () => [], afterExchange = { due: () => false, run: async () => {} }, log = () => {}, now = () => Date.now(), timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t) } } = {}) {
  let ex = null; // the exchange started by voice, while it is open: { gen, timer }
  let raising = false; // a pending question is being asked again
  let replyQ = null; // the model's own question, until its reply has finished playing
  let win = null, wins = 0; // the answer window that is open: { id, q, until, timer, processing, expired }
  let qseq = 0;
  const fresh = new Set(); // the questions that became pending in the exchange that is open: they wait for the next one
  const asked = new Set(); // feature 33: the questions open on screen (question()), so stand down can close them
  // kind → (question) → what has become of it, found without asking anything:
  //   { done: true }      the thing was done meanwhile: cleared without a word
  //   { dropped: line }   it no longer applies and something they wanted is lost: cleared, and said in one line
  //   { later: true }     it can't be asked now (the app isn't answering): it stays
  //   { ask: async () => ({ say }) }   it still applies: ask() asks it again (throws Unanswered when nobody answers)
  const resumers = new Map();
  const spokenNow = () => !!ex || raising;
  const hook = (event, q) => { try { onPending(event, q); } catch (e) { console.error('pending hook', e); } };

  // ---- pending questions, in state.json under "pending": [{ id, at, kind, brief, data }]
  const usable = (q) => !!q && typeof q === 'object' && typeof q.id === 'string' && typeof q.kind === 'string' && Number.isFinite(Date.parse(q.at));
  const stored = () => { const s = readState(settings().dir); return Array.isArray(s.pending) ? s.pending.filter(usable) : []; };
  const store = (all) => { const dir = settings().dir; writeState(dir, { ...readState(dir), pending: all }); };
  /** The pending questions, oldest first. The ones older than "limits.pendingKeepHours" are dropped here, and of
   *  two that are the same question only the newest stays. */
  function pending() {
    let all, limits;
    try { all = stored().sort((a, b) => Date.parse(a.at) - Date.parse(b.at)); ({ limits } = settings()); } catch { return []; }
    const old = all.filter((q) => now() - Date.parse(q.at) > limits.pendingKeepHours * 3600_000);
    const twice = all.filter((q, i) => !old.includes(q) && all.some((x, j) => j > i && !old.includes(x) && sameKey(x) === sameKey(q)));
    if (!old.length && !twice.length) return all;
    const rest = all.filter((q) => !old.includes(q) && !twice.includes(q));
    store(rest);
    for (const q of old) { log('pending_dropped', { kind: q.kind, why: 'old' }); hook('dropped', q); }
    for (const q of twice) log('pending_dropped', { kind: q.kind, why: 'twice' });
    return rest;
  }
  /** Keeps a question: { kind, brief, data }, or one that was pending already ({ id, at } too: it keeps its age).
   *  It takes the place of any that is the same question: a question is pending once. */
  function keep(p) {
    const again = typeof p.id === 'string' && Number.isFinite(Date.parse(p.at));
    const q = { id: again ? p.id : `q${now().toString(36)}${(++qseq).toString(36)}`, at: again ? p.at : new Date(now()).toISOString(), kind: String(p.kind), brief: String(p.brief ?? ''), data: p.data ?? {} };
    let replaced = 0;
    try { const was = stored(), rest = was.filter((x) => x.id !== q.id && sameKey(x) !== sameKey(q)); replaced = was.filter((x) => x.id !== q.id).length - rest.length; store([...rest, q]); } catch (e) { console.error('pending', e); return null; }
    log('pending_kept', { kind: q.kind, again, replaced });
    if (ex) fresh.add(q.id);
    if (!again) hook('pending', q);
    return q;
  }
  const forget = (id) => { try { store(stored().filter((q) => q.id !== id)); } catch (e) { console.error('pending', e); } };
  /** The question was answered: every pending copy of it goes, without a word. */
  function clear(q) {
    try {
      const was = stored(), gone = was.filter((x) => sameKey(x) === sameKey(q));
      if (!gone.length) return;
      store(was.filter((x) => !gone.includes(x)));
      log('pending_cleared', { kind: q.kind, copies: gone.length });
      for (const x of gone) hook('answered', x);
    } catch (e) { console.error('pending', e); }
  }
  const done = (q) => { forget(q.id); log('pending_dropped', { kind: q.kind, why: 'done' }); hook('answered', q); };
  /** What has become of a pending question, without asking anything. null: nothing here knows how to ask it. */
  const look = async (q) => { const run = resumers.get(q.kind); return run ? ((await run(q)) ?? { later: true }) : null; };

  /** Clears, without a word, the pending questions whose thing was done meanwhile. */
  async function tidy() {
    for (const q of pending()) {
      try { if ((await look(q))?.done) done(q); } catch (e) { console.error('pending question', e); }
    }
  }

  /** Asks the oldest pending question again, if nothing else is going on. One at a time. skip: the ones that became
   *  pending in the exchange that has just ended: "the next exchange" is not the one they went unanswered in.
   *  One whose thing was done meanwhile is cleared without a word, and the next one is looked at. */
  async function raise(skip = new Set()) {
    if (raising || win || !idle()) return false;
    const passed = new Set(skip);
    raising = true;
    try {
      for (;;) {
        const q = pending().find((x) => !passed.has(x.id));
        if (!q) return false;
        passed.add(q.id);
        let r;
        try { r = await look(q); } catch (e) { log('pending_failed', { kind: q.kind }); console.error('pending question', e); continue; }
        if (!r) { forget(q.id); log('pending_dropped', { kind: q.kind, why: 'unknown' }); hook('dropped', q); continue; }
        if (r.done) { done(q); continue; }
        if (r.later) continue;
        if (win || !idle()) return false; // something started while it was looked at: it stays for the next time
        if (r.dropped) { forget(q.id); log('pending_dropped', { kind: q.kind, why: 'stale' }); hook('dropped', q); await announce(String(r.dropped)); return true; }
        log('pending_raised', { kind: q.kind });
        try {
          // It stays kept while it is asked: an answer clears it (clear, from its bubble closing), no answer keeps
          // it with its first age, and anything going wrong leaves it where it was.
          const a = await r.ask();
          clear(q);
          log('pending_answered', { kind: q.kind });
          if (a?.say) await announce(String(a.say));
        } catch (e) {
          if (e?.name !== 'Unanswered') { log('pending_failed', { kind: q.kind }); console.error('pending question', e); }
        }
        return true;
      }
    } finally { raising = false; }
  }

  /** Feature 18: questions the app asks one after another (the daily note's). While they run, each is said and gets
   *  its answer window, as a pending question asked again does. Only when nothing else is going on.
   *  → false when it couldn't start. */
  async function series(fn) {
    if (raising || win || !idle()) return false;
    raising = true;
    try { await fn(); } finally { raising = false; }
    return true;
  }
  const afterDue = () => { try { return !!afterExchange.due(); } catch { return false; } };
  /** An exchange has ended: the questions that follow one, then the oldest pending question. */
  async function wrapUp(skip) {
    if (afterDue()) { log('after_exchange', {}); await series(() => afterExchange.run()).catch((e) => console.error('after exchange', e)); }
    return raise(skip);
  }

  /** After the closing line: the microphone and the request that carried the phrase may need a moment to settle. */
  async function raiseSoon(skip, tries = 10) {
    if (ex) return; // they went on talking: a new exchange is open, and its own end raises the question
    if (!raising && !win && !idle() && tries > 0 && (pending().some((x) => !skip.has(x.id)) || afterDue())) { timers.set(() => { raiseSoon(skip, tries - 1).catch((e) => console.error('pending question', e)); }, 1000); return; }
    await wrapUp(skip);
  }

  // ---- the exchange
  function activity() {
    if (replyQ) { replyQ.open = false; replyQ = null; }
    if (!ex) return;
    ex.gen++;
    timers.clear(ex.timer); ex.timer = null;
  }
  /** Roamies has said its piece (done: resolves when it has finished playing): the quiet time starts then. */
  function settle(done = null) {
    if (!ex) return;
    const mine = ++ex.gen;
    timers.clear(ex.timer); ex.timer = null;
    Promise.resolve(done ?? speak(null)).then(() => {
      if (!ex || ex.gen !== mine) return;
      let limits;
      try { ({ limits } = settings()); } catch { return; }
      const wait = () => { ex.timer = timers.set(() => { if (!ex || ex.gen !== mine) return; if (!idle() || win) return wait(); wrapUp(end('quiet')).catch((e) => console.error('pending question', e)); }, limits.exchangeEndSeconds * 1000); };
      wait();
    }, () => {});
  }
  /** → the questions that became pending in it (not asked again at this end). */
  function end(by) {
    if (ex) timers.clear(ex.timer);
    ex = null;
    const skip = new Set(fresh);
    fresh.clear();
    log('exchange_end', { by });
    return skip;
  }
  /** A closing phrase said alone ends the exchange here: a short spoken line, and nothing goes to the model. */
  function closing(text) {
    if (!isClosing(text)) return false;
    if (replyQ) { replyQ.open = false; replyQ = null; }
    const skip = end('phrase');
    let reply = '';
    try { reply = settings().closingReply; } catch { /* nothing is said */ }
    Promise.resolve(reply ? announce(reply, { closing: true }) : null).then(() => raiseSoon(skip), () => {}).catch((e) => console.error('pending question', e));
    return true;
  }

  // ---- the answer window
  function openWindow(q) {
    let limits;
    try { ({ limits } = settings()); } catch { return; } // the settings can't be read: no window
    if (win) closeWindow('replaced');
    const w = { id: ++wins, q, until: now() + limits.answerWindowSeconds * 1000, timer: null, processing: false, expired: false };
    win = w;
    w.timer = timers.set(() => expire(w), limits.answerWindowSeconds * 1000);
    onWindow(true, 'open');
    log('window_open', { kind: q.kind, seconds: limits.answerWindowSeconds });
    listen({ seconds: limits.answerWindowSeconds, window: w.id, again: false });
  }
  /** The window's time is up: the microphone is closed now. A phrase that was already being finished may still be
   *  judged for a moment; then the window is over. */
  function expire(w) {
    if (win !== w || w.expired) return;
    w.expired = true;
    cancel();
    if (w.processing) w.timer = timers.set(() => finish(w), WINDOW.graceSeconds * 1000);
    else finish(w);
  }
  function finish(w) {
    if (win !== w) return;
    timers.clear(w.timer);
    win = null;
    onWindow(false, 'time');
    log('window_closed', { by: 'time', kind: w.q.kind });
    const q = w.q;
    asked.delete(q);
    if (q.kind !== 'bubble' || !q.open) return;
    // No answer: the question closes, is kept for later, and nothing is sent or changed.
    q.open = false;
    if (q.pending) keep(q.pending);
    q.onTimeout();
    settle();
  }
  function closeWindow(by) {
    const w = win;
    if (!w) return;
    timers.clear(w.timer);
    win = null;
    if (by !== 'key' && !w.expired) cancel(); // a key press has taken the microphone over: it isn't closed under it
    onWindow(false, by);
    log('window_closed', { by, kind: w.q.kind });
  }

  /** A question is open (a bubble with buttons). In an exchange started by voice, or when a pending question is
   *  asked again, it is said and its answer window opens once it has finished playing. always: said whenever replies
   *  are spoken (pi's Send bubble always was). pending: what is kept if the window runs out; onTimeout() then closes
   *  the bubble. → { close(answered), windowed }. close(): the question was answered (a yes or a no, said or
   *  clicked), so every pending copy of it is cleared; close(false): it was taken down without an answer. */
  function question({ brief = '', pending: kept = null, onTimeout = () => {}, always = false } = {}) {
    const voiced = spokenNow();
    const q = { kind: 'bubble', open: true, pending: kept, onTimeout };
    asked.add(q);
    activity();
    if (voiced || always) {
      const done = Promise.resolve(speak(brief || null));
      if (voiced) done.then(() => { if (q.open) openWindow(q); }, () => {});
    }
    return {
      windowed: voiced,
      close(answered = true) {
        asked.delete(q);
        if (!q.open) return;
        q.open = false;
        if (answered && kept) clear(kept);
        if (win?.q === q) closeWindow('answered');
        settle();
      },
    };
  }

  /** The model's own question (a reply ending in one): the same window, opened when the reply has finished playing
   *  (done), unless "autoListenQuestions" is off or something else has started meanwhile. → whether it is armed. */
  function replyWindow(done) {
    let on = false;
    try { on = settings().autoListenQuestions; } catch { /* off */ }
    if (!on) return false;
    const q = { kind: 'reply', open: true };
    if (replyQ) replyQ.open = false;
    replyQ = q;
    Promise.resolve(done).then(() => { if (!q.open || replyQ !== q) return; replyQ = null; if (!win && idle()) openWindow(q); }, () => {});
    return true;
  }

  /** What the voice helper is doing. window: the answer window its session belongs to; none for a key press. */
  function voice(state, window = null) {
    if (window == null) {
      // A key press: it takes over from an open window, and from then on it is an ordinary talk.
      if (state === 'listening') { if (win) closeWindow('key'); activity(); }
      return;
    }
    const w = win;
    if (!w || w.id !== window) return;
    if (state === 'processing') w.processing = true;
    else if (state === 'idle') {
      w.processing = false;
      if (w.expired) return finish(w);
      // A phrase ended (or nothing was heard) and the window isn't over: the microphone opens again for the rest.
      const left = (w.until - now()) / 1000;
      if (left >= WINDOW.reopenMinSeconds) listen({ seconds: left, window: w.id, again: true });
    }
  }

  /** Words heard in an answer window (they carry its id). → 'request' only for the answer to the model's own
   *  question; 'closing' when that was a closing phrase; otherwise 'kept': they settled the open question or were
   *  dropped, and in neither case do they go anywhere else. */
  function windowPhrase(text, window) {
    const w = win;
    if (!w || w.id !== window) { log('window_heard', { taken: false, late: true, ...heardShape(text) }); return 'kept'; }
    w.processing = false;
    const took = bubbles().some((b) => b.heard(text, { handsFree: true }));
    if (!took && w.q.kind === 'reply') { closeWindow('answered'); return closing(text) ? 'closing' : 'request'; }
    if (!took) log('window_heard', { taken: false, ...heardShape(text) });
    if (win === w && w.expired) finish(w);
    return 'kept';
  }

  /** Feature 33, stand down: the answer window closes (the microphone with it), the exchange ends without its
   *  questions, and every question open on screen is closed unanswered, as when its window runs out: the ones that are
   *  kept when unanswered are kept (a hand-off among them, asked again later in full and never sent by itself), and
   *  nothing is sent or changed. → how many were kept. */
  function standDown() {
    if (replyQ) { replyQ.open = false; replyQ = null; }
    if (win) closeWindow('stand');
    if (ex) end('stand');
    let n = 0;
    for (const q of [...asked]) {
      asked.delete(q);
      if (!q.open) continue;
      q.open = false;
      if (q.pending && keep(q.pending)) n++;
      try { q.onTimeout(); } catch (e) { console.error('stand down', e); }
    }
    return n;
  }

  const kept = () => { try { return (actions() ?? []).filter((a) => a && a.brief); } catch { return []; } };
  const tools = [{
    name: 'show_pending',
    description: 'The questions the app asked that got no answer and are waiting to be asked again (a hand-off to pi, a calendar question), and the calendar blocks kept until Super Productivity is open. Use it when they ask what is pending or still open between you. Read them out briefly. The app asks the questions again by itself when the conversation pauses, and places the kept blocks itself: don\'t ask them yourself and don\'t act on them.',
    parameters: z.object({}),
    execute: async () => {
      await tidy();
      const all = pending(), later = kept();
      const hm = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
      const parts = [];
      if (all.length) parts.push(`${all.length} question${all.length === 1 ? ' is' : 's are'} waiting for an answer, oldest first:\n${all.map((q) => `- ${q.brief || q.kind} (asked ${hm(q.at)})`).join('\n')}`);
      if (later.length) parts.push(`${later.length} request${later.length === 1 ? ' is' : 's are'} kept until Super Productivity is open. Not done yet: the app does ${later.length === 1 ? 'it' : 'them'} by itself then.\n${later.map((a) => `- ${a.brief} (asked ${hm(a.at)})`).join('\n')}`);
      return parts.join('\n') || 'No question is waiting for an answer.';
    },
  }];

  return {
    tools, question, replyWindow, voice, windowPhrase, closing, raise, series, standDown,
    /** A request was made by voice: the exchange is open. */
    start() { ex ??= { gen: 0, timer: null }; activity(); },
    activity, settle,
    spoken: spokenNow,
    open: () => !!ex,
    window: () => (win ? { id: win.id, kind: win.q.kind, expired: win.expired } : null),
    resume(kind, run) { resumers.set(kind, run); },
    pending, tidy, clear,
    /** For the morning briefing: the questions still waiting, as a note for the model. '' when there are none. */
    // 2026-11-19: a question that names a to-do is said here by what it is about, without the title, and kept
    // blocks are counted: a to-do's title goes to the model only when the owner asks (show_pending names them).
    note() {
      const all = pending(), later = kept();
      return (all.length ? `\nQuestions the app asked that are still waiting for their answer (it asks them again by itself; mention in one sentence how many and what about, and don't ask them yourself; show_pending has their wording when they ask):\n${all.map((q) => `- ${UNNAMED[q.kind] ?? (q.brief || q.kind)}`).join('\n')}` : '')
        + (later.length ? `\n${later.length} block${later.length === 1 ? ' is' : 's are'} kept until Super Productivity is open, and not on the calendar yet (the app places them itself then; mention it in one sentence, and don't say they are booked; show_pending names them when they ask).` : '');
    },
  };
}
