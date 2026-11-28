// Feature 33, stand down, on the overlay page without a screen (page.mjs): the stood-down orb is one dim grey ring with
// a flat dash, with no particles, dial or count, and still (the page stops drawing); and stand down clears the screen
// at once without answering the question that was open (the sidecar keeps what must be kept). Numbers only; the
// shapes of every state are in orb.test.mjs.
import assert from 'node:assert/strict';
import { started } from './page.mjs';

/** What the orb draws now: every stroke's colour and every particle, through a canvas that records them. */
function drawn(p) {
  const ops = [];
  const c = {
    strokeStyle: '', fillStyle: '', globalAlpha: 1, lineWidth: 1, font: '', save() {}, restore() {}, beginPath() {}, arc() {}, moveTo() {}, lineTo() {},
    stroke() { ops.push({ op: 'stroke', style: c.strokeStyle }); }, fill() { ops.push({ op: 'fill', style: c.fillStyle }); }, drawImage() { ops.push({ op: 'image' }); },
    fillText(t) { ops.push({ op: 'text', t }); }, fillRect() {}, strokeRect() {}, measureText: () => ({ width: 10 }),
  };
  p.creature.draw(c, p.R.tiles[0].env);
  return ops;
}

{
  const p = await started();
  p.host({ kind: 'dial', start: 540, end: 1080, mine: [[600, 660]], theirs: [] });
  p.host({ kind: 'queue', n: 2 }); await p.tick(6);
  assert.equal(p.R.rested(), true, 'at rest');
  const normal = drawn(p);
  assert.ok(normal.filter((o) => o.op === 'image').length === 700 && normal.some((o) => o.op === 'text'), 'normal rest: the particles and the count');
  p.host({ kind: 'stand', on: true, clear: true }); await p.tick(3);
  assert.equal(p.creature.state, 'stood');
  const down = drawn(p);
  assert.equal(down.filter((o) => o.op === 'image').length, 0, 'no particles when stood down');
  assert.equal(down.filter((o) => o.op === 'text').length, 0, 'no count');
  assert.ok(down.filter((o) => o.op === 'stroke').length >= 3 && down.filter((o) => o.op === 'stroke').every((o) => o.style.startsWith('rgba(107,123,136')), 'only dim grey lines');
  assert.equal(p.R.rested(), true, 'the frame loop has stopped');
  assert.equal(await p.tick(10), 0, 'still: no frame in 10 s');
  assert.equal(p.R.stood(), true);
  p.host({ kind: 'stand', on: false }); await p.tick(3);
  assert.equal(drawn(p).filter((o) => o.op === 'image').length, 700, 'its particles are back when it ends');
  assert.equal(p.R.stood(), false);
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
  assert.equal(q.R.stood(), true); assert.equal(q.creature.state, 'stood', 'a new page has the stood-down look');
}

console.log('stand down, the page: passed');
