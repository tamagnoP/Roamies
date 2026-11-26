// Local-only build, feature 23 (stage 4), the owner's answer 4: what is made in private mode is hidden from Claude for
// good. A to-do, reminder or note made in a private request carries a private mark; Claude gets a count of the
// private items, never their titles or text. The local model sees them, and check-ins, the daily note and task pages
// work for them as for any other. The owner lifts the mark by asking, with a yes.
//
// Where the mark is kept:
//   - a to-do or reminder: `private: true` on it, in ~/.gg/sidekick/memory.json (store.mjs);
//   - a note: `private: true` in the note's own front matter, and its title in state.json under "privateNotes" (the
//     list the count and the redaction use, so the vault isn't read for every request).
// Every place that must respect it (each tested):
//   1. the live state (the outline, today's blocks): titles hidden, a count line (sidekick.mjs, livePrompt);
//   2. list_commitments: private ones left out, with a count (calendar.mjs);
//   3. search_notes, read_note, notes_for, link_note: private notes left out or refused, with a count (notes.mjs);
//   4. every other tool result Claude gets (show_day, plan_day, show_pending, a daily note found by search): the
//      private titles replaced (redact, below, wrapped round each tool for Claude in sidekick.mjs);
//   5. the side calls: the fold, the memory update, the handover's part two (their inputs), and the handover message
//      that opens Claude's new conversation;
//   6. the private exchanges themselves: answered by the local model only, kept in its own history, never placed in
//      Claude's conversation (localroute.mjs, route.mjs).
// The local route's tool calls carry { seePrivate: true }; anything without it is Claude's, and sees no private item.
import fs from 'node:fs';
import { only, plainNum, unfilled } from './answers.mjs';

export const PRIVATE_WORD = '[private]';
/** Whether a note's text marks it private (its front matter has `private: true`). */
export const privateNote = (text) => /^---\r?\n(?:[^\n]*\r?\n)*?private:\s*true\s*\r?\n(?:[^\n]*\r?\n)*?---/.test(String(text ?? ''));
/** Whether a note file is private. */
export function privateFile(file) { try { const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(2048); const n = fs.readSync(fd, b, 0, 2048, 0); fs.closeSync(fd); return privateNote(b.subarray(0, n).toString('utf8')); } catch { return false; } }

const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Text for Claude with every private title in it replaced by PRIVATE_WORD (any case, whole words; titles under 3
 *  characters are left alone). */
export function redact(text, titles = []) {
  const list = [...new Set(titles.map((t) => String(t ?? '').trim()).filter((t) => t.length >= 3))].sort((a, b) => b.length - a.length);
  if (!list.length || typeof text !== 'string') return text;
  return text.replace(new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.map(esc).join('|')})(?![\\p{L}\\p{N}])`, 'giu'), PRIVATE_WORD);
}
/** A tool result for Claude, redacted: a string, or the text parts of a result with content. */
export function redactResult(r, titles) {
  if (typeof r === 'string') return redact(r, titles);
  if (r && typeof r === 'object' && Array.isArray(r.content)) return { ...r, content: r.content.map((p) => (p?.type === 'text' ? { ...p, text: redact(p.text, titles) } : p)) };
  return r;
}
/** The line Claude gets about what it can't see. → '' when nothing is private. */
export function privateCount(todos, notes) {
  if (!todos && !notes) return '';
  const parts = [todos ? `${todos} to-do${todos === 1 ? '' : 's'} or reminder${todos === 1 ? '' : 's'}` : '', notes ? `${notes} note${notes === 1 ? '' : 's'}` : ''].filter(Boolean);
  return `- Private: ${parts.join(' and ')} made in private mode; you never see their titles or text (shown as ${PRIVATE_WORD}).`;
}

// Lifting the mark: said by the owner, matched by code, then a yes in a bubble.
const LIFT = [
  /^(?:please )?(?:lift|remove|take off|drop) the private mark (?:from|on|off) (.+)$/,
  /^(?:please )?make (.+?) (?:not private|public|visible to claude)$/,
  /^(.+?) (?:is|isn t|isnt) (?:no longer private|not private any ?more|not private)$/,
];
/** "Lift the private mark from <title>": → { title } (his words for the item), or null. */
export function liftAsk(text) {
  const t = unfilled(text, plainNum);
  for (const re of LIFT) { const m = re.exec(t); if (m) return { title: m[1].replace(/^(?:the|my) /, '').trim() }; }
  return null;
}
export const liftQuestion = (title) => `Lift the private mark from "${title}"? Claude will see it from then on.`;
export const LIFT_NONE = 'No private to-do or note has that title. Nothing was changed.';

/** The note's text with its private mark lifted (`private: true` becomes `private: false` in the front matter). */
export const unmarkNote = (text) => String(text).replace(/^(---\r?\n(?:[^\n]*\r?\n)*?)private:\s*true(\s*\r?\n)/, '$1private: false$2');
export const PRIVATE_ONLY = only(['private'], plainNum);
