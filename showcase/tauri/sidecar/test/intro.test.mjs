// What is left of the setup guide's chat (feature 21 took the chat, the tour and the showcase out): the memory pass
// reads a saved conversation's words without the app's notes, and replies are made plain.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { plain, stripNote } from '../intro.mjs';

const NOTE = '[Getting to know you: a note from the app, not typed by the user]';
assert.equal(stripNote(`${NOTE} That was answer 2 of 4.\n\nKen said: I make videos\n\nand courses`), 'I make videos\n\nand courses');
assert.equal(stripNote(`${NOTE} Say EXACTLY this`), '', 'the opener note has no words of theirs');
assert.equal(stripNote('[Mon] what time is it'), '[Mon] what time is it', 'ordinary messages untouched');
assert.equal(plain('[hype] [chuckling] Nice one! [break] Go.'), 'Nice one! Go.');

// Nothing of the chat, the tour or the showcase is left in the app.
const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const side = src('sidekick.mjs');
for (const gone of ['startIntro', 'introAnswer', 'playTour', 'playShowcase', "'chat_start'", "'ob_showcase'", 'tourBeats', 'showcaseBeats']) assert.ok(!side.includes(gone), gone);
const guide = fs.readFileSync(new URL('../../../onboarding/onboarding.js', import.meta.url), 'utf8');
for (const gone of ["'chat_start'", "'ob_showcase'", 'step-chat', 'step-demo', "'ob_look'", "'ob_size'"]) assert.ok(!guide.includes(gone), `the guide: ${gone}`);
console.log('intro tests: passed');
