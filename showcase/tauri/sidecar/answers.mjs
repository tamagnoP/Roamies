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
/** What is safe to log about something said: its size, and whether a yes or a no word was in it. Never the words. */
export const heardShape = (text) => { const w = plain(text).split(' ').filter(Boolean); return { chars: String(text ?? '').trim().length, words: w.length, yesWord: w.some((x) => x === 'yes'), noWord: w.some((x) => x === 'no' || x === 'dont' || x === 'cancel') }; };

/**
 * ask: the overlay's question bubble, (opts, signal) → Promise<'yes' | null | text>; an aborted signal closes it.
 * → { ask, listening(), heard(text), unheard(), open(), state() }
 *   ask(opts, signal): the same bubble, with the hint under the question; resolves 'yes' or null, like a click.
 *   listening(): the owner has started talking. True when a bubble is open, which is when the caller must not
 *     cancel the turn or close anything.
 *   heard(text): what they said. True when a bubble is open (the words were for it, whatever they were).
 *   unheard(): they stopped and nothing was heard. True when a bubble is open.
 *   state(): null (no bubble), 'listening' (a bubble is open and they are talking) or 'idle' (open, waiting).
 *     After words that were not an answer, and after nothing was heard, it is 'idle' again: nothing is carried
 *     over from one thing said to the next.
 */
export function createAnswers({ ask, log = () => {} }) {
  const waiting = []; // the bubbles that are open, the newest last
  let talking = false;
  function askSpoken(opts, signal) {
    const closing = new AbortController();
    const inner = signal ? AbortSignal.any([signal, closing.signal]) : closing.signal;
    return new Promise((resolve) => {
      const entry = {
        settle(answer, by) {
          const i = waiting.indexOf(entry);
          if (i < 0) return;
          waiting.splice(i, 1);
          log('bubble_answer', { by, yes: answer === 'yes' });
          resolve(answer);
          closing.abort(); // answered by voice: the bubble is taken down
        },
      };
      waiting.push(entry);
      Promise.resolve(ask({ ...opts, placeholder: `${opts.placeholder}\n${SPOKEN_HINT}` }, inner)).then((a) => entry.settle(a ?? null, 'click'), () => entry.settle(null, 'click'));
    });
  }
  return {
    ask: askSpoken,
    open: () => waiting.length > 0,
    state: () => (waiting.length ? (talking ? 'listening' : 'idle') : null),
    listening() { talking = waiting.length > 0; return talking; },
    heard(text) {
      talking = false;
      if (!waiting.length) return false;
      const a = spokenAnswer(text);
      if (a) waiting.at(-1).settle(a === 'yes' ? 'yes' : null, 'voice');
      else log('bubble_heard', { taken: false, ...heardShape(text) });
      return true;
    },
    unheard() { talking = false; return waiting.length > 0; },
  };
}
