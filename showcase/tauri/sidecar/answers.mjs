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
//   - A question between two things ("Friday the 20th or Friday the 27th?", opts.which). Its two buttons are the
//     two things; the caller gives the phrases that name each, and what is said counts only when it is made of one
//     side's phrases and nothing else. Digits count there ("the 20th"). A no word answers neither. Otherwise it is a
//     bubble like the others: said, with an answer window, kept when unanswered.
//   - Feature 18: a question whose answer is judged by the caller's own code (opts.parse: "When will you do it?",
//     daily.mjs). What is said counts only when parse() takes it; its two buttons answer by position (opts.clicks).
//     Feature 25: a check-in has three (checkin.mjs); the third answers with THIRD.

// A click is never judged by words. The overlay answers a bubble with buttons by which button it was: FIRST for the
// first one (also the Y key), nothing for any other. Should a page ever hand back the button's label instead, the
// first label is still the first button, whatever it says.
export const FIRST = 'yes';
// The second button of a question between two things (opts.which). Of a yes/no bubble the second button is a no.
export const SECOND = 'second';
// Feature 25: the third button of a question judged by the caller's code with three buttons (a check-in).
export const THIRD = 'third';
/** The answer to a question between two things, by which button it was: FIRST, SECOND, or null for neither. */
export const whichButton = (answer, choices = []) => (firstButton(answer, choices) ? FIRST : answer === SECOND || (typeof answer === 'string' && choices.length > 1 && answer === choices[1]) ? SECOND : null);
export const firstButton = (answer, choices = []) => answer === FIRST || (typeof answer === 'string' && choices.length > 0 && answer === choices[0]);
/** A question bubble with buttons, answered by position: (opts, signal) → true when the first button was pressed. */
export const byButton = (ask) => async (opts, signal) => firstButton(await ask(opts, signal), opts.choices);

export const YES_WORDS = ['yes', 'yes please', 'go ahead', 'do it'];
export const NO_WORDS = ['no', "don't", 'cancel'];
export const SPOKEN_HINT = 'Say yes or no, or click.';
// "Move it, or make a second one?" (calendar.mjs: a block asked for by the title of a to-do that is already booked):
// the phrases that answer it, alone or several of one side together. A no word answers neither.
export const MOVE_WORDS = ['move it', 'move', 'move that one', 'move the same one', 'the same one', 'same one', 'the same', 'same'];
export const SECOND_WORDS = ['a new one', 'new one', 'a new', 'new', 'make a new one', 'a second one', 'second one', 'a second', 'make a second one', 'another one', 'another'];
// "Is this <title>, or a new task?" (calendar.mjs: a block asked for by a title that contains an open to-do's title,
// or is contained in one): the phrases that answer it. A yes or a no word answers neither.
export const THAT_WORDS = ['that one', 'that', 'this one', 'it is that one', 'the same one', 'same one', 'the same', 'same', 'the existing one', 'the old one'];
export const NEW_WORDS = ['a new task', 'new task', 'a new one', 'new one', 'a new', 'new', 'make a new one', 'make a new task', 'another one', 'another', 'a second one', 'second one'];

export const plain = (t) => String(t ?? '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z]+/g, ' ').trim();
// Longest first, so "yes please" is one phrase and not "yes" followed by something else.
export const only = (words, norm = plain) => new RegExp(`^(?:(?:${words.map(norm).sort((a, b) => b.length - a.length).join('|')})(?: |$))+$`);
/** As plain(), with the digits kept: for the answers that name a date. */
export const plainNum = (t) => String(t ?? '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
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
export function unfilled(text, norm = plain) {
  const w = norm(text).split(' ').filter(Boolean);
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
/** What was said, as the answer to a question between two things: FIRST, SECOND, 'no' (neither), or null. A phrase
 *  that names both sides is given to neither. */
export function whichAnswer(text, which) {
  const p = plainNum(text);
  if (!p) return null;
  const both = new Set(which.first.map(plainNum).filter((w) => which.second.map(plainNum).includes(w)));
  const side = (words) => { const mine = words.filter((w) => plainNum(w) && !both.has(plainNum(w))); return mine.length > 0 && only(mine, plainNum).test(p); };
  return side(which.first) ? FIRST : side(which.second) ? SECOND : NO.test(plain(text)) ? 'no' : null;
}
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
 *     opts.which: { first: [phrases], second: [phrases], hint }: a question between two things. choices are the two;
 *     resolves FIRST, SECOND, or null for neither.
 *     opts.spoken: what is said aloud for it (else its first line). opts.always: said whenever replies are spoken,
 *     not only in an exchange started by voice (outside one it gets no answer window). opts.pending: { kind, brief, data }, what is kept
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
    const { spoken, pending, which = null, always = false, parse = null, clicks = [], hint = '', ...shown } = opts;
    const button = (a) => { const w = whichButton(a, opts.choices); return w === FIRST ? clicks[0] ?? null : w === SECOND ? clicks[1] ?? null : a === THIRD ? clicks[2] ?? null : null; };
    return new Promise((resolve, reject) => {
      const entry = {
        settle(answer, by) {
          const i = waiting.indexOf(entry);
          if (i < 0) return;
          waiting.splice(i, 1);
          log('bubble_answer', { by, ...(parse ? { kind: answer?.kind ?? null } : { yes: answer === FIRST, ...(which ? { second: answer === SECOND } : {}) }) });
          resolve(answer);
          entry.window?.close(!signal?.aborted); // an answer clears every pending copy of the question (flow.mjs); a bubble taken down with its request is not one
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
        refused(text) { retext(`${opts.placeholder}\n${heardLine(text, which ? which.hint : parse ? hint : 'yes or no', heardChars())}`); },
        // What was said, as an answer to this bubble: → [answer] when it is one, else null.
        judge(text, handsFree) {
          if (parse) { const v = parse(text); return v ? [v] : null; }
          const a = which ? whichAnswer(handsFree ? text : unfilled(text, plainNum), which) : spokenAnswer(handsFree ? text : unfilled(text));
          return !a ? null : [a === 'no' ? null : a === 'yes' ? FIRST : a];
        },
      };
      waiting.push(entry);
      entry.window = question?.({ brief: spoken ?? briefOf(opts.placeholder), pending: pending ?? null, always, onTimeout: () => entry.unanswered() }) ?? null;
      // which: the overlay answers the second button with SECOND instead of nothing (host.js).
      Promise.resolve(ask({ ...shown, ...(which || parse ? { second: SECOND } : {}), ...(parse && clicks.length > 2 ? { third: THIRD } : {}), placeholder: `${opts.placeholder}\n${which ? `Say ${which.hint}, or click.` : parse ? `Say ${hint}, or click.` : SPOKEN_HINT}` }, inner)).then((a) => entry.settle(parse ? button(a) : which ? whichButton(a, opts.choices) : firstButton(a, opts.choices) ? FIRST : null, 'click'), () => entry.settle(null, 'click'));
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
      const a = waiting.at(-1).judge(text, handsFree);
      if (a) waiting.at(-1).settle(a[0], 'voice');
      else { log('bubble_heard', { taken: false, ...heardShape(text), ...(handsFree ? { handsFree: true } : {}) }); if (String(text ?? '').trim()) waiting.at(-1).refused(text); }
      return true;
    },
    unheard() { talking = false; return waiting.length > 0; },
  };
}
