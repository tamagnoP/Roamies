// Feature 24, lean running, for the orb (feature 21): at rest it draws nothing, and nothing fills a Map or a Set frame
// after frame while it moves. Run: npm run test:all (slow: minutes of the page's clock at three sizes; not in npm
// test). The overlay page without a screen, as in home-page.test.mjs (page.mjs).
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { started } from './page.mjs';

// At rest, at the smallest, the default and the largest size, with the working day on its dial: not one frame asked
// for, and the frame loop stopped. The same again after it has spoken and the bubble has closed.
for (const size of [80, 100, 140]) {
  const p = await started({ size });
  p.host({ kind: 'dial', start: 540, end: 1080, mine: [[600, 660]], theirs: [[700, 720]] }); await p.tick(6);
  const what = `${size} points`;
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

// While it moves (thinking with its bubble; listening with none) nothing fills a Map or a Set frame after frame:
// the page grew by megabytes a second when a look did (feature 24).
for (const [what, on] of [['thinking', (p) => p.host({ kind: 'agent', e: { type: 'start' } })], ['listening', (p) => p.creature.setHearing(true)]]) {
  const p = await started();
  await p.tick(3);
  let filled = 0;
  for (const [C, k] of [['Map', 'set'], ['Set', 'add']]) { const proto = vm.runInContext(C, p.win).prototype, was = proto[k]; proto[k] = function (...a) { filled++; return was.apply(this, a); }; }
  on(p); p.R.wake(); await p.tick(1); filled = 0;
  const frames = await p.tick(3);
  assert.ok(frames > 100, `${what}: it is being drawn (${frames} frames in 3 s)`);
  assert.ok(filled <= 3, `${what}: no Map or Set filled frame after frame (${filled} entries added over ${frames} frames)`);
}

console.log('the orb at rest tests: passed');
