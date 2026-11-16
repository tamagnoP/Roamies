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
//     went unanswered in), the oldest one is asked again, one at a time, spoken and with its window. One that no longer applies is dropped with one
//     line; one that is too old is dropped. A hand-off is asked again in full and never sent because it was pending.
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

/**
 * speak(text | null): says a line when replies are spoken, and resolves when the overlay reports that everything
 *   handed over has finished playing (with null: when nothing is playing). It never resolves on a guess.
 * announce(text): the same for a line that is also shown in a bubble.
 * listen({ seconds, window, again }) opens the microphone hands-free for that long; cancel() closes it.
 * bubbles(): the holders of open questions, each with heard(text, { handsFree }) → true when one was open.
 * idle(): nothing is going on (no request running or waiting, nobody talking, no question open).
 * onWindow(open, by): the answer window opened or closed (speech is held back meanwhile).
 * onPending(event, question): 'pending' | 'answered' | 'dropped'. The daily note's hook (feature 18); unused for now.
 */
export function createFlow({ home = os.homedir(), settings = () => loadSettings(home), speak = async () => {}, announce = async () => {}, listen = () => {}, cancel = () => {}, bubbles = () => [], idle = () => true, onWindow = () => {}, onPending = () => {}, log = () => {}, now = () => Date.now(), timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t) } } = {}) {
  let ex = null; // the exchange started by voice, while it is open: { gen, timer }
  let raising = false; // a pending question is being asked again
  let replyQ = null; // the model's own question, until its reply has finished playing
  let win = null, wins = 0; // the answer window that is open: { id, q, until, timer, processing, expired }
  let qseq = 0;
  const fresh = new Set(); // the questions that became pending in the exchange that is open: they wait for the next one
  const resumers = new Map(); // kind → (question) → { answered, say } | { dropped: line } | { later: true }
  const spokenNow = () => !!ex || raising;
  const hook = (event, q) => { try { onPending(event, q); } catch (e) { console.error('pending hook', e); } };

  // ---- pending questions, in state.json under "pending": [{ id, at, kind, brief, data }]
  const usable = (q) => !!q && typeof q === 'object' && typeof q.id === 'string' && typeof q.kind === 'string' && Number.isFinite(Date.parse(q.at));
  const stored = () => { const s = readState(settings().dir); return Array.isArray(s.pending) ? s.pending.filter(usable) : []; };
  const store = (all) => { const dir = settings().dir; writeState(dir, { ...readState(dir), pending: all }); };
  /** The pending questions, oldest first. The ones older than "limits.pendingKeepHours" are dropped here. */
  function pending() {
    let all, limits;
    try { all = stored().sort((a, b) => Date.parse(a.at) - Date.parse(b.at)); ({ limits } = settings()); } catch { return []; }
    const old = all.filter((q) => now() - Date.parse(q.at) > limits.pendingKeepHours * 3600_000);
    if (!old.length) return all;
    const rest = all.filter((q) => !old.includes(q));
    store(rest);
    for (const q of old) { log('pending_dropped', { kind: q.kind, why: 'old' }); hook('dropped', q); }
    return rest;
  }
  /** Keeps a question: { kind, brief, data }, or one that was pending already ({ id, at } too: it keeps its age). */
  function keep(p) {
    const again = typeof p.id === 'string' && Number.isFinite(Date.parse(p.at));
    const q = { id: again ? p.id : `q${now().toString(36)}${(++qseq).toString(36)}`, at: again ? p.at : new Date(now()).toISOString(), kind: String(p.kind), brief: String(p.brief ?? ''), data: p.data ?? {} };
    try { store([...stored().filter((x) => x.id !== q.id), q]); } catch (e) { console.error('pending', e); return null; }
    log('pending_kept', { kind: q.kind, again });
    if (ex) fresh.add(q.id);
    if (!again) hook('pending', q);
    return q;
  }
  const forget = (id) => { try { store(stored().filter((q) => q.id !== id)); } catch (e) { console.error('pending', e); } };

  /** Asks the oldest pending question again, if nothing else is going on. One at a time. skip: the ones that became
   *  pending in the exchange that has just ended: "the next exchange" is not the one they went unanswered in. */
  async function raise(skip = new Set()) {
    if (raising || win || !idle()) return false;
    const q = pending().find((x) => !skip.has(x.id));
    if (!q) return false;
    const run = resumers.get(q.kind);
    forget(q.id);
    if (!run) { log('pending_dropped', { kind: q.kind, why: 'unknown' }); hook('dropped', q); return false; }
    raising = true;
    log('pending_raised', { kind: q.kind });
    try {
      const r = await run(q);
      if (r?.later) keep(q);
      else if (r?.dropped) { log('pending_dropped', { kind: q.kind, why: 'stale' }); hook('dropped', q); await announce(String(r.dropped)); }
      else { log('pending_answered', { kind: q.kind }); hook('answered', q); if (r?.say) await announce(String(r.say)); }
    } catch (e) {
      // Unanswered: its window ran out again, and the question itself was kept again (with its first age).
      if (e?.name !== 'Unanswered') { keep(q); log('pending_failed', { kind: q.kind }); console.error('pending question', e); }
    } finally { raising = false; }
    return true;
  }

  /** After the closing line: the microphone and the request that carried the phrase may need a moment to settle. */
  async function raiseSoon(skip, tries = 10) {
    if (ex) return; // they went on talking: a new exchange is open, and its own end raises the question
    if (!raising && !win && !idle() && tries > 0 && pending().some((x) => !skip.has(x.id))) { timers.set(() => { raiseSoon(skip, tries - 1).catch((e) => console.error('pending question', e)); }, 1000); return; }
    await raise(skip);
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
      const wait = () => { ex.timer = timers.set(() => { if (!ex || ex.gen !== mine) return; if (!idle() || win) return wait(); raise(end('quiet')); }, limits.exchangeEndSeconds * 1000); };
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
    Promise.resolve(reply ? announce(reply) : null).then(() => raiseSoon(skip), () => {}).catch((e) => console.error('pending question', e));
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
   *  the bubble. → { close(), windowed } */
  function question({ brief = '', pending: kept = null, onTimeout = () => {}, always = false } = {}) {
    const voiced = spokenNow();
    const q = { kind: 'bubble', open: true, pending: kept, onTimeout };
    activity();
    if (voiced || always) {
      const done = Promise.resolve(speak(brief || null));
      if (voiced) done.then(() => { if (q.open) openWindow(q); }, () => {});
    }
    return {
      windowed: voiced,
      close() {
        if (!q.open) return;
        q.open = false;
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

  const tools = [{
    name: 'show_pending',
    description: 'The questions the app asked that got no answer and are waiting to be asked again (a hand-off to pi, a calendar question). Use it when they ask what is pending or still open between you. Read them out briefly. The app asks them again by itself when the conversation pauses: don\'t ask them yourself and don\'t act on them.',
    parameters: z.object({}),
    execute: async () => {
      const all = pending();
      if (!all.length) return 'No question is waiting for an answer.';
      const hm = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
      return `${all.length} question${all.length === 1 ? ' is' : 's are'} waiting for an answer, oldest first:\n${all.map((q) => `- ${q.brief || q.kind} (asked ${hm(q.at)})`).join('\n')}`;
    },
  }];

  return {
    tools, question, replyWindow, voice, windowPhrase, closing, raise,
    /** A request was made by voice: the exchange is open. */
    start() { ex ??= { gen: 0, timer: null }; activity(); },
    activity, settle,
    spoken: spokenNow,
    open: () => !!ex,
    window: () => (win ? { id: win.id, kind: win.q.kind, expired: win.expired } : null),
    resume(kind, run) { resumers.set(kind, run); },
    pending,
    /** For the morning briefing: the questions still waiting, as a note for the model. '' when there are none. */
    note() {
      const all = pending();
      return all.length ? `\nQuestions the app asked that are still waiting for their answer (it asks them again by itself; mention in one sentence how many and what about, and don't ask them yourself):\n${all.map((q) => `- ${q.brief || q.kind}`).join('\n')}` : '';
    },
  };
}
