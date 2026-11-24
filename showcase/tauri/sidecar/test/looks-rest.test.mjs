// Feature 24, lean running: every look at rest draws nothing, and none fills a Map or a Set frame after frame. Run:
// npm run test:all (slow: minutes of the page's clock for each of five looks in two sizes; not in npm test).
// The overlay page without a screen, as in home.test.mjs (page.mjs).
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { started } from './page.mjs';

// Feature 24: every look, in both sizes that rest at home, comes to rest and then draws nothing: not one frame asked
// for, and the frame loop stopped. The same again after it has spoken and the bubble has closed.
for (const look of ['classic', 'jarvis', 'anime', 'sarah', 'adrian']) for (const size of ['default', 'small']) {
  const p = await started({ size });
  p.host({ kind: 'look', look }); await p.tick(6);
  const what = `${look}, ${size}`;
  assert.equal(p.R.rested(), true, `${what}: the frame loop has stopped`);
  assert.equal(await p.tick(5), 0, `${what}: no frame in 5 s at rest`);
  assert.equal(await p.tick(60), 0, `${what}: none in the minute after`);
  const said = p.agent.say('A line to wake it.'); await p.tick(1);
  assert.equal(p.R.rested(), false, `${what}: speaking wakes it`);
  p.agent.bubble?.close?.(); await said.catch?.(() => {}); p.agent.dismiss?.(); await p.tick(30);
  assert.equal(p.agent.bubble, null, `${what}: the bubble has closed`);
  assert.equal(p.R.rested(), true, `${what}: at rest again after speaking`);
  assert.equal(await p.tick(5), 0, `${what}: no frame in 5 s at rest, afterwards`);
}

// Feature 24: while it is active (here thinking, so every frame is drawn) no look fills a Map or a Set frame after
// frame. JARVIS did: a Map emptied and filled again each frame, whose old storage WebKit could not always free, and
// the overlay page grew by megabytes a second.
for (const look of ['classic', 'jarvis', 'anime', 'sarah', 'adrian']) for (const size of ['default', 'small']) {
  const p = await started({ size });
  p.host({ kind: 'look', look }); await p.tick(3);
  let filled = 0;
  for (const [C, k] of [['Map', 'set'], ['Set', 'add']]) { const proto = vm.runInContext(C, p.win).prototype, was = proto[k]; proto[k] = function (...a) { filled++; return was.apply(this, a); }; }
  p.host({ kind: 'agent', e: { type: 'start' } }); await p.tick(1); filled = 0;
  const frames = await p.tick(3);
  assert.ok(frames > 100, `${look}, ${size}: it is being drawn while it thinks (${frames} frames in 3 s)`);
  assert.ok(filled <= 3, `${look}, ${size}: no Map or Set filled frame after frame (${filled} entries added over ${frames} frames)`);
}

console.log('looks at rest tests: passed');
