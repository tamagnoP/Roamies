// Local-only build: a yes/no bubble that also takes a spoken answer.
//
// The bubbles Roamies opens itself with two buttons (the to-do list going into Super Productivity for the first
// time, a block that overlaps something, a day plan, a sorting proposal, a task deleted in the app) can be answered
// by clicking or by saying yes or no. What is fixed here, in code:
//   - Words count only while such a bubble is open, and only when they are made of the phrases below and nothing
//     else: one of them, or several of the same kind ("no, no", "yes, go ahead"). Anything else leaves the bubble
//     open and changes nothing, and the bubble is then as ready for an answer as when it opened.
//   - While a bubble is open, what is said goes to the bubble and nowhere else: it is not a new request, and
//     starting to talk doesn't cancel what Roamies is doing.
//   - A click answers as it always did.
//   - Feature 22 (flow.mjs). In an exchange started by voice the question is also said, and the microphone then opens
//     by itself for a set time (the answer window). What is heard there hands-free is judged by the phrases alone;
//     after a key press, filler words before or after an answer ("um, yes", "no then") don't spoil it. A phrase
//     that wasn't taken is shown as the bubble's last line until the next one, on screen only. When the window runs
//     out with no answer the bubble closes, the question is kept for later, and ask() rejects with Unanswered.

// A click is never judged by words. The overlay answers a bubble with buttons by which button it was: FIRST for the
// first one (also the Y key), nothing for any other. Should a page ever hand back the button's label instead, the
// first label is still the first button, whatever it says.
export const FIRST = 'yes';
export const firstButton = (answer, choices = []) => answer === FIRST || (typeof answer === 'string' && choices.length > 0 && answer === choices[0]);
/** A question bubble with buttons, answered by position: (opts, signal) → true when the first button was pressed. */
export const byButton = (ask) => async (opts, signal) => firstButton(await ask(opts, signal), opts.choices);

export const YES_WORDS = ['yes', 'yes please', 'go ahead', 'do it'];
export const NO_WORDS = ['no', "don't", 'cancel'];
export const SPOKEN_HINT = 'Say yes or no, or click.';

export const plain = (t) => String(t ?? '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z]+/g, ' ').trim();
// Longest first, so "yes please" is one phrase and not "yes" followed by something else.
export const only = (words) => new RegExp(`^(?:(?:${words.map(plain).sort((a, b) => b.length - a.length).join('|')})(?: |$))+$`);
const YES = only(YES_WORDS), NO = only(NO_WORDS);
/** What was said, as an answer to a yes/no bubble: 'yes', 'no', or null when it isn't clearly either. */
export function spokenAnswer(text) {
  const p = plain(text);
  return YES.test(p) ? 'yes' : NO.test(p) ? 'no' : null;
}

// Words that may come before or after an answer said after a key press, without changing it. Never in the middle,
// and never hands-free for a hand-off that can edit (pi.mjs).
export const FILLER_WORDS = ['and', 'um', 'uh', 'now', 'so', 'well', 'just', 'please', 'then', 'sir', 'jarvis', 'roamies'];
const FILLERS = new Set(FILLER_WORDS.map(plain));
/** What was said, in plain words, without the filler words at its start and end. */
export function unfilled(text) {
  const w = plain(text).split(' ').filter(Boolean);
  let a = 0, b = w.length;
  while (a < b && FILLERS.has(w[a])) a++;
  while (b > a && FILLERS.has(w[b - 1])) b--;
  return w.slice(a, b).join(' ');
}
// Said alone, these end the exchange: answered by the app itself, never sent to the model (flow.mjs).
export const CLOSING_PHRASES = ['thanks', 'thank you', 'thanks mate', "that's all"];
const CLOSING = only(CLOSING_PHRASES);
export const isClosing = (text) => CLOSING.test(unfilled(text));
/** The bubble's last line after a phrase that wasn't taken: what was heard, and what can be said. Screen only. */
export const heardLine = (text, hint, max = 80) => { const t = String(text ?? '').replace(/\s+/g, ' ').trim(); return `Heard "${t.length > max ? `${t.slice(0, max - 1)}…` : t}". Say ${hint}.`; };
/** ask() rejects with this when the answer window ran out with no answer: nothing was changed, and the question is
 *  kept (state.json) and asked again by the app when the exchange ends. Its message is what the model is told. */
export class Unanswered extends Error {
  constructor(what = 'nothing was changed') {
    super(`They gave no answer, so ${what}. The app has kept the question and asks it again by itself later: don't ask it again, don't call this tool again for it, and say in a few words that you'll come back to it.`);
    this.name = 'Unanswered';
  }
}
/** What a question says aloud when it gives no wording of its own: its first line. */
export const briefOf = (placeholder) => String(placeholder ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';

/** What is safe to log about something said: its size, and whether a yes or a no word was in it. Never the words. */
export const heardShape = (text) => { const w = plain(text).split(' ').filter(Boolean); return { chars: String(text ?? '').trim().length, words: w.length, yesWord: w.some((x) => x === 'yes'), noWord: w.some((x) => x === 'no' || x === 'dont' || x === 'cancel') }; };

/**
 * ask: the overlay's question bubble, (opts, signal) → Promise<'yes' | null | text>; an aborted signal closes it.
 * → { ask, listening(), heard(text), unheard(), open(), state() }
 *   ask(opts, signal): the same bubble, with the hint under the question; resolves 'yes' or null, like a click.
 *     opts.spoken: what is said aloud for it (else its first line). opts.pending: { kind, brief, data }, what is kept
 *     when the answer window runs out; ask() then rejects with Unanswered.
 *   listening(): the owner has started talking. True when a bubble is open, which is when the caller must not
 *     cancel the turn or close anything.
 *   heard(text, { handsFree }): what they said. True when a bubble is open (the words were for it, whatever they
 *     were). handsFree: heard in an answer window, not after a key press: the phrases alone, no filler words.
 *   unheard(): they stopped and nothing was heard. True when a bubble is open.
 *   state(): null (no bubble), 'listening' (a bubble is open and they are talking) or 'idle' (open, waiting).
 *     After words that were not an answer, and after nothing was heard, it is 'idle' again: nothing is carried
 *     over from one thing said to the next.
 */
export function createAnswers({ ask, log = () => {}, question = null, retext = () => {}, heardChars = () => 80 }) {
  // question: flow.mjs's (says the question, opens the answer window, keeps it when unanswered). retext(text): the
  // open bubble's text, changed on screen. Without them it is the bubble as it was before feature 22.
  const waiting = []; // the bubbles that are open, the newest last
  let talking = false;
  function askSpoken(opts, signal) {
    const closing = new AbortController();
    const inner = signal ? AbortSignal.any([signal, closing.signal]) : closing.signal;
    const { spoken, pending, ...shown } = opts;
    return new Promise((resolve, reject) => {
      const entry = {
        settle(answer, by) {
          const i = waiting.indexOf(entry);
          if (i < 0) return;
          waiting.splice(i, 1);
          log('bubble_answer', { by, yes: answer === FIRST });
          resolve(answer);
          entry.window?.close();
          closing.abort(); // answered by voice: the bubble is taken down
        },
        // The answer window ran out: the bubble closes, nothing is changed, and the caller is told so.
        unanswered() {
          const i = waiting.indexOf(entry);
          if (i < 0) return;
          waiting.splice(i, 1);
          log('bubble_answer', { by: 'nobody' });
          reject(new Unanswered());
          closing.abort();
        },
        // What was heard and not taken, as the bubble's last line (in place of the hint) until the next phrase.
        refused(text) { retext(`${opts.placeholder}\n${heardLine(text, 'yes or no', heardChars())}`); },
      };
      waiting.push(entry);
      entry.window = question?.({ brief: spoken ?? briefOf(opts.placeholder), pending: pending ?? null, onTimeout: () => entry.unanswered() }) ?? null;
      Promise.resolve(ask({ ...shown, placeholder: `${opts.placeholder}\n${SPOKEN_HINT}` }, inner)).then((a) => entry.settle(firstButton(a, opts.choices) ? FIRST : null, 'click'), () => entry.settle(null, 'click'));
    });
  }
  return {
    ask: askSpoken,
    open: () => waiting.length > 0,
    state: () => (waiting.length ? (talking ? 'listening' : 'idle') : null),
    listening() { talking = waiting.length > 0; return talking; },
    heard(text, { handsFree = false } = {}) {
      talking = false;
      if (!waiting.length) return false;
      const a = spokenAnswer(handsFree ? text : unfilled(text));
      if (a) waiting.at(-1).settle(a === 'yes' ? FIRST : null, 'voice');
      else { log('bubble_heard', { taken: false, ...heardShape(text), ...(handsFree ? { handsFree: true } : {}) }); if (String(text ?? '').trim()) waiting.at(-1).refused(text); }
      return true;
    },
    unheard() { talking = false; return waiting.length > 0; },
  };
}
