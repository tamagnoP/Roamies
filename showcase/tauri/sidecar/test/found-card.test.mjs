// Feature 40: the card of found files in the overlay (ink.js), run without a screen (page.mjs): each row is its number,
// name and folder; a click on a row sends found_pick with the card's id and the row's number; × sends found_closed;
// rows the screen has no room for are counted in "and N more", never clickable out of sight; { close: true } and a
// new card take it down. How it looks is checked by eye (TESTS.md).
import assert from 'node:assert/strict';
import { page } from './page.mjs';

const p = page({ ink: true });
await p.tick(0.5);
p.host({ kind: 'size', size: 'default' }); p.host({ kind: 'home', home: 'bottom-left' }); await p.tick(2);
const rows = (n) => Array.from({ length: n }, (_, i) => ({ n: i + 1, name: `budget-${i + 1}.xlsx`, folder: i === 1, where: '~/Documents/Finance' }));
const press = (x, y) => { for (const f of p.listeners.pointerdown) f({ clientX: x, clientY: y, stopPropagation() {}, preventDefault() {} }); };
const rects = () => p.win.Roamie.inkRects();
const sent = () => JSON.parse(JSON.stringify(p.sent.filter((m) => /^found_/.test(m.type)))); // out of the page's own realm

p.host({ kind: 'found', id: 3, total: 12, said: 'budget', more: 4, rows: rows(8) });
await p.tick(2);
let r = rects();
assert.equal(r.length, 8 + 3, 'eight rows, the close button, the bar and the card');
assert.ok(r.slice(0, 8).every((x, i) => x[3] === 42 && x[1] === r[0][1] + i * 42), 'one row under the other');
press(r[1][0] + 30, r[1][1] + 10); await p.tick(0.3);
assert.deepEqual(sent(), [{ type: 'found_pick', id: 3, n: 2 }]);
const close = r.find((x) => x[2] === 26 && x[3] === 22);
press(close[0] + 5, close[1] + 5); await p.tick(1);
assert.deepEqual(sent().at(-1), { type: 'found_closed', id: 3 }); assert.equal(rects().length, 0, 'closed');

// a short screen: only the rows that fit are there to click; the rest are counted
const small = page({ ink: true, h: 420 });
await small.tick(0.5); small.host({ kind: 'size', size: 'default' }); await small.tick(1);
small.host({ kind: 'found', id: 5, total: 20, said: 'budget', more: 0, rows: rows(20) }); await small.tick(2);
const sr = small.win.Roamie.inkRects(), rowsShown = sr.filter((x) => x[3] === 42);
assert.ok(rowsShown.length >= 1 && rowsShown.length < 20, `${rowsShown.length} rows fit`);
const cardBox = sr.at(-1);
assert.ok(rowsShown.every((x) => x[1] + x[3] <= cardBox[1] + cardBox[3]), 'every clickable row is inside the card');

// a new card takes the old one's place; { close: true } takes it down
p.host({ kind: 'found', id: 4, total: 1, said: 'x', more: 0, rows: [{ n: 1, name: 'x.pdf', folder: false, where: 'Backup › Finance' }] }); await p.tick(1.5);
assert.equal(rects().length, 1 + 3);
p.host({ kind: 'found', id: 6, total: 2, said: 'y', more: 0, rows: rows(2) }); await p.tick(1.5);
assert.equal(rects().length, 2 + 3, 'only the newest card');
press(rects()[0][0] + 30, rects()[0][1] + 10); await p.tick(0.3);
assert.deepEqual(sent().at(-1), { type: 'found_pick', id: 6, n: 1 });
p.host({ kind: 'found', close: true }); await p.tick(1);
assert.equal(rects().length, 0);
console.log('the card of found files tests passed');
process.exit(0);
