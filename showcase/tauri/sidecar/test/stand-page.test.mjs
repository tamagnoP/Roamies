// Feature 33, stand down, on the overlay page without a screen (page.mjs): the stood-down look is grey, clearly dimmer
// than normal rest and still (the page stops drawing), in every look; and stand down clears the screen at once without
// answering the question that was open (the sidecar keeps what must be kept). Numbers only.
import assert from 'node:assert/strict';
import { started } from './page.mjs';

/** The lit cells of the last picture put on the character's canvas: their mean brightness (0 to 255) and how grey
 *  they are (the largest gap between red, green and blue). */
function lit(p) {
  const img = p.made.map((c) => c.last).filter((x) => x?.data instanceof Uint8ClampedArray).at(-1);
  assert.ok(img, 'a picture was put on the canvas');
  let n = 0, sum = 0, gap = 0;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3] || d[i] + d[i + 1] + d[i + 2] < 30) continue;
    n++; sum += (d[i] + d[i + 1] + d[i + 2]) / 3; gap = Math.max(gap, Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]));
  }
  return { n, mean: n ? sum / n : 0, gap };
}

for (const look of ['jarvis', 'classic', 'anime', 'sarah', 'adrian']) {
  const p = await started();
  p.host({ kind: 'look', look }); await p.tick(6);
  assert.equal(p.R.rested(), true, `${look}: at rest`);
  const normal = lit(p);
  assert.ok(normal.n > 50 && normal.gap > 40, `${look}: normal rest is in colour (${normal.n} cells, gap ${normal.gap})`);
  p.host({ kind: 'stand', on: true, clear: true }); await p.tick(3);
  const down = lit(p);
  assert.ok(down.n > 50, `${look}: still drawn when stood down (${down.n} cells)`);
  assert.ok(down.gap <= 2, `${look}: grey (gap ${down.gap})`);
  assert.ok(down.mean < normal.mean * 0.6, `${look}: clearly dimmer than normal rest (${down.mean.toFixed(0)} against ${normal.mean.toFixed(0)})`);
  assert.equal(p.R.rested(), true, `${look}: the frame loop has stopped`);
  assert.equal(await p.tick(10), 0, `${look}: still: no frame in 10 s`);
  assert.equal(p.R.stood(), true);
  p.host({ kind: 'stand', on: false }); await p.tick(3);
  const back = lit(p);
  assert.ok(back.gap > 40 && back.mean > normal.mean * 0.8, `${look}: its colour is back when it ends (gap ${back.gap})`);
  assert.equal(p.R.stood(), false);
}

// JARVIS's heart: a flat dash, one row of cells, where at rest it is a dot or a disc
{
  const p = await started();
  p.host({ kind: 'look', look: 'jarvis' }); await p.tick(6);
  p.host({ kind: 'stand', on: true, clear: true }); await p.tick(3);
  const img = p.made.map((c) => c.last).filter((x) => x?.data instanceof Uint8ClampedArray).at(-1), d = img.data, W = img.width;
  // the brightest cells are the heart's: they lie in one row of the LED grid
  let top = 0;
  for (let i = 0; i < d.length; i += 4) top = Math.max(top, d[i]);
  const rows = new Set();
  for (let i = 0; i < d.length; i += 4) if (d[i] === top && d[i + 3]) rows.add(Math.floor(i / 4 / W));
  assert.ok(rows.size >= 1 && rows.size <= 3, `the heart is a flat dash (${rows.size} pixel rows at the brightest)`);
}

// stand down clears the screen at once: the bubble and the question close, the question without an answer
{
  const p = await started();
  p.agent.say('A reply being said.'); await p.tick(1);
  assert.ok(p.agent.bubble, 'a bubble is open');
  p.host({ kind: 'ask', id: 'a1', placeholder: 'Send to pi?', choices: ['Send', "Don't send"] }); await p.tick(1);
  p.host({ kind: 'stand', on: true, clear: true }); await p.tick(3);
  assert.equal(p.agent.bubble, null, 'no bubble');
  assert.ok(!p.sent.some((m) => m.type === 'answer'), 'the question was closed without an answer');
  assert.equal(p.escHeld(), false, 'Esc is not held: nothing is on screen');
  // a new page told it again keeps the look (the sidecar sends it at ui_ready)
  const q = await started();
  q.host({ kind: 'stand', on: true }); await q.tick(3);
  assert.equal(q.R.stood(), true); assert.ok(lit(q).gap <= 2, 'a new page has the stood-down look');
}

console.log('stand down, the page: passed');
