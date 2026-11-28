// Feature 21 (the owner, 2026-11-28 14:09): the bubbles' text font is one constant (BUBBLE_TEXT in agent.js), so SF Pro
// and SF Mono can be compared by eye. It is SF Pro for replies and notices; numbers, times, paths and code stay in
// SF Mono. In either, a letter keeps its place once it has landed while a reply streams in.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { page } from './page.mjs';

const src = fs.readFileSync(new URL('../../../roamies/agent.js', import.meta.url), 'utf8');
assert.equal((src.match(/^ {2}const BUBBLE_TEXT = '(sans|mono)';$/gm) ?? []).length, 1, 'one constant');
assert.match(src, /^ {2}const BUBBLE_TEXT = 'sans';$/m, 'set to SF Pro');
assert.match(src, /f = `\$\{it\}\$\{w\} \$\{fpx\}px \$\{mono \? G\.MONO : G\.SANS\}`/, 'each letter is drawn in SF Mono or SF Pro, by the mask');
const glass = fs.readFileSync(new URL('../../../roamies/glass.js', import.meta.url), 'utf8');
assert.match(glass, /SANS = '-apple-system, system-ui, /, 'SF Pro is the system font: nothing downloaded');

// A canvas that measures like a proportional font (letters of different widths) and a monospaced one (all 60 at 100px).
const p = page();
const realCreate = p.win.document.createElement;
p.win.document.createElement = (t) => (t === 'canvas' ? {
  getContext: () => ({ font: '', measureText(ch) { return { width: /monospace/.test(this.font) ? 60 : 30 + (ch.charCodeAt(0) % 9) * 7 + (/^700/.test(this.font) ? 4 : 0) }; } }),
} : realCreate(t));
const { bubbleLayout: layout, bubbleText } = p.R;
assert.equal(bubbleText, 'sans');

const reply = 'Your call with Ana is at 10:30 in the small room; the notes are in ~/Documents/plan.md and it lasts 45 minutes.';
const first = layout(reply, null, 38);
const monoOf = (word) => { const i = reply.indexOf(word); return [...first.mono.slice(i, i + word.length)]; };
assert.deepEqual(monoOf('10:30'), [1, 1, 1, 1, 1], 'a time is in SF Mono, its colon too');
assert.deepEqual(monoOf('45'), [1, 1], 'a number');
assert.ok(monoOf('~/Documents/plan.md').every((v) => v === 1), 'a path');
assert.ok(monoOf('Your call with Ana').every((v) => v === 0), 'the words are in SF Pro');
assert.equal(first.mono[reply.indexOf(';')], 0);
// proportional: letters take their own widths, and no line is wider than the bubble's 38 columns
assert.ok(new Set(first.lines[0].x.slice(1).map((x, j) => +(x - first.lines[0].x[j]).toFixed(3))).size > 3, 'letters of different widths');
assert.ok(first.lines.every((l) => l.w <= 38 + 1e-6), 'every line fits');
assert.ok(first.lines.length >= 3);

// Streaming, a letter at a time: once a letter has landed, its place (line and x) changes only when the word it is
// in moves down whole to the next line, as in SF Mono. Never a shift along its line.
let before = null, wraps = 0;
for (let k = 1; k <= reply.length; k++) {
  const now = layout(reply.slice(0, k), null, 38);
  const where = (lines) => { const m = new Map(); lines.forEach((l, li) => l.x.slice(0, -1).forEach((x, j) => m.set(l.start + j, [li, x]))); return m; };
  const at = where(now.lines);
  if (before) {
    for (const [i, [li, x]] of before) {
      if (reply[i] === ' ') continue; // a space at a line's end is dropped when the line breaks there: nothing is drawn
      const [li2, x2] = at.get(i) ?? [];
      if (li2 === li) assert.equal(x2, x, `letter ${i} ("${reply[i]}") kept its place when "${reply[k - 1]}" arrived`);
      else { wraps++; assert.equal(li2, li + 1, 'a word that no longer fits moves down whole'); assert.ok(!/\s/.test(reply.slice(i, k)), 'only the word being written'); }
    }
  }
  before = at;
}
assert.ok(wraps > 0, 'the case of a word moving down was met');

// A mark between two digits is decided by the next letter: it changes font in place, and the letters after it are new.
const a = layout('at 10:', null, 38), b = layout('at 10:3', null, 38);
assert.equal(a.mono[5], 0); assert.equal(b.mono[5], 1);
assert.equal(a.lines[0].x[5], b.lines[0].x[5], 'the colon stays where it landed');
// A path is known from its first letter: it never switches font after landing.
for (let k = 1; k <= 12; k++) assert.ok([...layout('~/Documents/x'.slice(0, k), null, 38).mono].every((v) => v === 1));

// The placeholder and typed text are laid out the same way (the caret goes where the next letter does).
assert.match(src, /const src = bb\.text \? bb\.lines : layout\(bb\.input\.placeholder \|\| ' ', null, MAX_COLS\)\.lines;/);
assert.match(src, /let cx = bb\.text \? xAt\(bb\.lines\[li\], col\) : 0;/);

console.log('bubble text tests: passed');
