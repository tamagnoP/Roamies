// Local-only build, feature 23 (stage 4): which model answers a request, decided by code.
//
//   - The provider can't be reached: the Mac has no network (the shell's reading, presence.rs), or the request fails
//     with a network error before any reply. Then that request goes to the local model, with a line saying so. A slow
//     provider never switches.
//   - Private: "keep this private" at the start of a request makes that request private; said alone it is a mode
//     that never ends by itself (not at the day turn, not at a restart), only on "back to Claude". Private requests
//     go to the local model only; when it can't be reached nothing is sent anywhere.
//   - Never silent: the first local reply after a switch starts with a code-worded line, every local bubble carries
//     the "local" tag, and "Claude is answering again." starts the first reply after.
//   - No automatic fallback otherwise: the local model failing never sends a request to the provider, and a reply
//     the provider has begun is never taken over.
//   - Asks for pi, the screen, drawing or clicking are refused on the local route by a code-worded line.
import { only, plainNum, unfilled } from './answers.mjs';

export const PRIVATE_PHRASES = ['keep this private', 'keep it private', 'this is private', 'private mode', 'go private', 'private mode on', 'privately'];
export const BACK_PHRASES = ['back to claude', 'go back to claude', 'private mode off', 'end private mode', 'stop private mode', 'leave private mode'];
const PRIVATE_ALONE = only(PRIVATE_PHRASES, plainNum), BACK = only(BACK_PHRASES, plainNum);
const words = (t) => plainNum(t);
/** What he said about private mode. → { mode: true } (a private phrase alone: the mode), { request: text } (one at
 *  the start of a request: that request is private; text: the rest, as he said it), { back: true } ("back to
 *  Claude" alone), or null. */
export function privateAsk(text) {
  const t = unfilled(text, plainNum);
  if (PRIVATE_ALONE.test(t)) return { mode: true };
  if (BACK.test(t)) return { back: true };
  const raw = String(text ?? '').trim();
  for (const p of [...PRIVATE_PHRASES].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`^(?:(?:please|ok|okay|um|so)[\\s,]+)*${p.split(' ').join('\\s+')}\\b[\\s,.:;!-]*`, 'i');
    const m = re.exec(raw);
    if (m && raw.slice(m[0].length).trim()) return { request: raw.slice(m[0].length).trim() };
  }
  return null;
}

// What the local model can't do here, found by code in what he said, each with its line.
const ASK = '^ (?:(?:please|can you|could you|would you|will you|ok|okay|hey|now|then|and) )*';
const CANT = [
  [new RegExp(`${ASK}(?:ask|tell|get|have|use) pi\\b|\\bhand (?:it |this |that )?(?:over )?to pi\\b|\\bsend (?:it |this |that )?to pi\\b`), 'a hand-off to pi'],
  [/\b(?:on|at|of) (?:my|the|this) (?:screen|display)\b|\bscreenshot\b|\bscreen shot\b|\bwhat am i looking at\b|\b(?:this|that|the front) window\b/, 'looking at the screen'],
  [new RegExp(`${ASK}(?:draw|sketch|illustrate|diagram|plot)\\b|\\b(?:draw|sketch) (?:me|a|an|the|it|this|that)\\b|\\b(?:make|show me|give me|create) (?:a |me a )?(?:diagram|chart|graph|plot)\\b`), 'drawing'],
  [new RegExp(`${ASK}(?:click|double click|right click|press|type)\\b|\\bclick (?:on|the)\\b|\\btype (?:it |this |that )?in(?:to)? \\w`), 'clicking or typing in an app'],
];
/** The code-worded refusal for an ask the local model can't do, or ''. */
export function cantLocally(text) {
  const t = ` ${words(text)} `;
  for (const [re, what] of CANT) if (re.test(t)) return `That needs Claude: ${what} can't be done with the local model. Nothing was sent.`;
  return '';
}

export const SWITCH_OFFLINE = 'Claude can\'t be reached, so the local model on this Mac is answering.';
export const SWITCH_PRIVATE = 'Private: the local model on this Mac is answering, and nothing goes to Claude.';
export const PRIVATE_ON = 'Private mode is on: the local model on this Mac answers, and nothing goes to Claude until you say "back to Claude".';
export const PRIVATE_OFF = 'Private mode is off.';
export const BACK_AGAIN = 'Claude is answering again.';
export const LOCAL_TAG = 'local';
export const PRIVATE_TAG = 'local · private';

/** Where a request goes. privateMode: the mode is on; privateThis: this request is private; offline: the shell says
 *  the Mac has no network; local: loadSettings().local. → 'local' | 'claude' | 'none' (private, and the local model is
 *  off: nothing is sent anywhere). */
export function routeFor({ privateMode = false, privateThis = false, offline = false, local = {} }) {
  const on = !!local.address;
  if (privateMode || privateThis) return on ? 'local' : 'none';
  if (offline && on && local.whenOffline) return 'local';
  return 'claude';
}

/** A failure that means the provider can't be reached, before any reply: no network, no name, no route, refused.
 *  A timeout, a stall or an answer from the provider (an error status) is not one: a slow provider never switches. */
export function isNetworkError(err) {
  const codes = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNREFUSED', 'ENETDOWN', 'EADDRNOTAVAIL', 'ECONNRESET']);
  for (let e = err, k = 0; e && k < 5; e = e.cause, k++) {
    if (codes.has(e.code) || codes.has(e.errno)) return true;
    if (/\b(?:getaddrinfo|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ECONNREFUSED|network is unreachable|internet connection appears to be offline)\b/i.test(String(e.message ?? ''))) return true;
  }
  return false;
}

/** The lines that say which model is answering, kept across requests. → { before(route, why) → the line to say first
 *  ('' when none), state() } */
export function createAnnouncer() {
  let last = 'claude', lastWhy = '';
  return {
    before(route, why = '') {
      if (route === 'claude') { const was = last; last = 'claude'; lastWhy = ''; return was === 'local' ? BACK_AGAIN : ''; }
      if (route !== 'local') return '';
      const line = last !== 'local' || lastWhy !== why ? (why === 'private' ? SWITCH_PRIVATE : SWITCH_OFFLINE) : '';
      last = 'local'; lastWhy = why;
      return line;
    },
    state: () => ({ last, why: lastWhy }),
  };
}
