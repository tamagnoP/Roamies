// Feature 31, the quiet queue's count on the overlay page without a screen (page.mjs). Feature 21: the orb's "waiting on
// you" state shows it, in its centre with an amber half ring, while there is something waiting; gone at 0; hidden
// while stood down and back after; "9+" past nine; drawn at once on a page at rest, which then rests again.
import assert from 'node:assert/strict';
import { started } from './page.mjs';

{
  const look = 'the orb';
  const p = await started(); await p.tick(2);
  assert.equal(p.R.rested(), true, `${look}: at rest`);
  const ctx = p.canvas.getContext('2d'), texts = [];
  ctx.fillText = (t, x, y) => texts.push([String(t), x, y]);
  const badge = () => texts.filter(([t]) => /^(\d|9\+)$/.test(t));
  p.host({ kind: 'queue', n: 2 });
  assert.ok(await p.tick(1) > 0, `${look}: a page at rest draws it at once`);
  assert.equal(p.creature.queued, 2);
  const [t, x, y] = badge().at(-1) ?? [];
  assert.equal(t, '2', `${look}: the count is drawn`);
  assert.ok(Math.hypot(x - p.m.x, y - p.m.y) < 4, `${look}: in the orb's centre (${Math.round(x - p.m.x)}, ${Math.round(y - p.m.y)})`);
  assert.equal(p.creature.state, 'waiting');
  await p.tick(6); assert.equal(p.R.rested(), true, `${look}: and rests again`);
  texts.length = 0; p.host({ kind: 'queue', n: 14 }); await p.tick(1);
  assert.equal(badge().at(-1)?.[0], '9+');
  texts.length = 0; p.host({ kind: 'stand', on: true, clear: true }); await p.tick(3);
  assert.deepEqual(badge(), [], `${look}: hidden while stood down`);
  texts.length = 0; p.host({ kind: 'stand', on: false }); await p.tick(2);
  assert.equal(badge().at(-1)?.[0], '9+', `${look}: back when it ends`);
  texts.length = 0; p.host({ kind: 'queue', n: 0 }); await p.tick(2);
  assert.deepEqual(badge(), [], `${look}: gone at 0`);
}

console.log('quiet queue, the page: passed');
