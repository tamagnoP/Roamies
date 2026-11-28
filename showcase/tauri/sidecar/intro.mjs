import { CUE } from './speech.mjs';
import { EMOTES } from './reply.mjs';

// What is left of the setup guide's get-to-know-you chat (feature 21 took the chat, the tour and the showcase out):
// a conversation saved before then may still hold the app's hidden notes, which the memory pass leaves out, and a
// reply is made plain text the same way everywhere.
const NOTE = '[Getting to know you: a note from the app, not typed by the user]';

/** A chat turn as the memory pass reads it: the user's words without the app's note (the opener note has none). */
export const stripNote = (text) => {
  const t = String(text ?? '');
  if (!t.startsWith(NOTE)) return t;
  const i = t.indexOf('\n\n'), m = i < 0 ? null : /^[^\n]*? said: /.exec(t.slice(i + 2));
  return m ? t.slice(i + 2 + m[0].length) : '';
};

const TAGS = new RegExp(`\\[(?:${EMOTES.join('|')})\\]`, 'gi');
/** A reply as plain text: no body tags, no voice cues. */
export const plain = (reply) => String(reply ?? '').replace(TAGS, '').replace(CUE, '').replace(/[ \t]+/g, ' ').replace(/ ([,.!?])/g, '$1').trim();
