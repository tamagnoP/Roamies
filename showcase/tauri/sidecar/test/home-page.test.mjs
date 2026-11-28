// Local-only build: the orb's home on the desktop, in the overlay itself (core.js, agent.js, orb.js,
// host.js), run here without a screen: the page's scripts are loaded as they are, with a stand-in for the browser (a
// canvas that draws nowhere, a clock moved by hand, and a stand-in for the Tauri shell; page.mjs). What it can't show
// is how any of it looks; that is checked by eye. Run: npm run test:all (slow: minutes of the page's clock drawn
// frame by frame; not in npm test). The rule and the setting: home.test.mjs.
import assert from 'node:assert/strict';
import { HOME, SEND, atSpot, bubbleOnScreen, started } from './page.mjs';


// Without the setting (the showcase pages, or a sidecar from before it): upstream's behaviour, hidden until needed.
{
  const p = await started({ home: null });
  assert.equal(p.agent.homing, false); assert.equal(p.agent.presence, 'hidden');
  p.ptr(600, 400); await p.tick(0.3); p.agent.say('hello'); await p.tick(1.5);
  assert.ok(Math.hypot(p.m.x - 600, p.m.y - 400) < 200, 'it pops up beside the cursor, as upstream does');
}

// At home: there from the start with nothing asked, still there a minute later, and nothing runs meanwhile.
for (const [home, spot] of Object.entries(HOME)) {
  const p = await started({ home });
  assert.equal(p.agent.homing, true);
  assert.equal(p.agent.presence, 'shown', `${home}: on screen without being asked for anything`);
  atSpot(p, spot, home);
  await p.tick(3);
  assert.equal(p.R.rested(), true, `${home}: the frame loop has stopped`);
  assert.equal(await p.tick(60), 0, `${home}: not one frame in a minute at rest`);
  assert.equal(p.agent.presence, 'shown', `${home}: it never hides for being idle`); atSpot(p, spot, `${home}, a minute later`);
  assert.equal(p.creature.face.sleepy < 0.05, true, 'and it has not dozed off');
  assert.equal(p.escHeld(), false, `${home}: Esc is not held from other apps while it only rests`);
  // what is left running in the page: the host's Esc watch (upstream's, 150 ms), nothing else
  assert.deepEqual(p.timers.map((t) => t.every), [150], `${home}: the timers still set at rest`);

  // the cursor moving about the screen, and resting for a while: no frames, no move, clicks go through
  for (let i = 0; i < 200; i++) p.ptr(300 + i * 4, 200 + (i % 50) * 3);
  assert.equal(await p.tick(20), 0, `${home}: the cursor elsewhere on the screen doesn't wake it`);
  assert.equal(p.hot(), false, `${home}: clicks go through everywhere but on its body`);
  atSpot(p, spot, `${home}, with the cursor about`);

  // the cursor right beside it, hovering: it holds its spot (upstream hopped out of the way)
  for (let i = 0; i < 80; i++) { p.ptr(spot[0] + 110 + (i % 5), spot[1] - 40); await p.tick(0.05); }
  atSpot(p, spot, `${home}, with the cursor hovering beside it`); assert.equal(p.hot(), false);
  // on its body: the click is its own, so it can be dragged
  p.ptr(spot[0] + 10, spot[1] - 8); assert.equal(p.hot(), true, `${home}: its centre takes clicks`);
  p.ptr(spot[0] + 17, spot[1]); assert.equal(p.hot(), true); p.ptr(spot[0] + 19, spot[1]); assert.equal(p.hot(), false, 'feature 21: only a spot of 18 px radius round its centre takes clicks (agreed 2026-11-17)');
  p.ptr(spot[0] + 14, spot[1] + 14); assert.equal(p.hot(), false, 'a circle, not a square');
  p.ptr(spot[0] + 40, spot[1]); assert.equal(p.hot(), false, 'the rest of the orb lets clicks through');
  p.ptr(900, 300); await p.tick(3);

  // a reply: said from home, with the cursor far away, the bubble whole on screen beside it
  p.ptr(home.endsWith('left') ? 1200 : 200, 450);
  const said = p.agent.say('Here is the answer, and it runs over a few lines so the bubble has to grow to hold all of it without leaving the screen.');
  await p.tick(2.5);
  atSpot(p, spot, `${home}, speaking`); bubbleOnScreen(p, `${home} speech`);
  assert.equal(p.escHeld(), true, 'Esc is held while it has something up');
  p.agent.hush(); await p.tick(1); void said;
  // a thought, a question to type an answer to, a listening bubble, and the Send bubble with its buttons
  p.agent.think('reading the file'); await p.tick(1.5); atSpot(p, spot, `${home}, thinking`); bubbleOnScreen(p, `${home} thought`); p.agent.hush(); await p.tick(0.6);
  const q = p.agent.prompt({ placeholder: 'Which project do you mean?' }); await p.tick(1.5);
  atSpot(p, spot, `${home}, asking`); bubbleOnScreen(p, `${home} question`); q.close(); await p.tick(0.6);
  const l = p.agent.listen({}); l.set('ask pi to explain segment dot py'); await p.tick(1.5);
  atSpot(p, spot, `${home}, listening`); bubbleOnScreen(p, `${home} listening`); l.close(); await p.tick(0.6);
  p.host({ kind: 'ask', id: 7, prompt: SEND, choices: ['Send', "Don't send"] }); await p.tick(2.5);
  atSpot(p, spot, `${home}, Send bubble`); bubbleOnScreen(p, `${home} Send bubble`);
  assert.ok(p.agent.bubble.input.choices.rects.length === 2, 'with its two buttons');
  for (const [bx, by, bw, bh] of p.agent.bubble.input.choices.rects) { const S = p.bounds(); assert.ok(bx >= S.l && by >= S.t && bx + bw <= S.r && by + bh <= S.b, `${home}: the Send bubble's buttons are on screen`); }
  p.host({ kind: 'cancel_ask', id: 7 }); await p.tick(1);
  // the task tag while a tool runs
  const t = p.agent.tool('read', { label: 'Reading', detail: 'segment.py' }); await p.tick(1); atSpot(p, spot, `${home}, working`); t.done(true); await p.tick(3);

  // and back to rest
  await p.tick(4);
  assert.equal(p.R.rested(), true, `${home}: at rest again after talking`); assert.equal(await p.tick(30), 0); atSpot(p, spot, `${home}, afterwards`);
}

// A home given as coordinates, and one that would sit under the Dock.
{
  const p = await started({ home: { x: 700, y: 400 } });
  atSpot(p, [700, 400], 'coordinates');
  p.agent.say('Said from the middle of the screen.'); await p.tick(2); bubbleOnScreen(p, 'coordinates speech');
  const low = await started({ home: { x: 20, y: 895 } });
  atSpot(low, [78.4, 746.5], 'coordinates under the Dock, at the edge');
  low.host({ kind: 'ask', id: 1, prompt: SEND, choices: ['Send', "Don't send"] }); await low.tick(2.5); bubbleOnScreen(low, 'Send bubble in the very corner');
}

// It leaves only as a drawing's pen, and comes back home; its own size comes back too.
{
  const p = await started();
  const home = HOME['bottom-left'];
  p.ptr(1000, 300); // the cursor is far from home: upstream went back beside it
  const took = p.agent.pen.take(); await p.tick(2); await took;
  assert.equal(p.agent.pen.held, true); assert.equal(p.creature.form, 'cursor');
  const moved = p.agent.pen.move(900, 250); await p.tick(1.5); await moved;
  assert.ok(Math.hypot(p.m.x - 900, p.m.y - 250) < 60, 'it goes where the drawing points');
  assert.equal(p.R.rested(), false);
  const back = p.agent.pen.release(); await p.tick(3); await back;
  assert.equal(p.agent.pen.held, false); assert.equal(p.creature.form, 'default', 'back to its own size');
  atSpot(p, home, 'after a drawing'); await p.tick(4); atSpot(p, home, 'and it stays'); assert.equal(p.R.rested(), true);

  // work in another app (act_in_app): hops to each step, then home
  p.host({ kind: 'hands', on: true });
  p.host({ kind: 'hands', step: { bounds: [800, 500, 40, 20] } }); await p.tick(2.5);
  assert.ok(Math.hypot(p.m.x - 820, p.m.y - 510) < 60, `it hops to the step (${p.at().map(Math.round)})`);
  assert.equal(p.hot(), false, 'and lets clicks through while it works');
  p.host({ kind: 'hands', on: false }); await p.tick(4);
  atSpot(p, home, 'after work in another app'); assert.equal(p.creature.form, 'default');

  // let go of in the middle of a drawing (Esc, a new voice request): it doesn't stay out there as a cursor
  const again = p.agent.pen.take(); await p.tick(2); await again;
  const far = p.agent.pen.move(1100, 200); await p.tick(1.5); await far;
  p.agent.hide(); await p.tick(8);
  assert.equal(p.agent.presence, 'shown', 'hide() no longer takes it off the screen'); assert.equal(p.creature.form, 'default');
  atSpot(p, home, 'after a drawing was cut short');
}

// Dragged: it stays where it was dropped, through talking, until it next goes home. The setting doesn't change.
{
  const p = await started();
  const home = HOME['bottom-left'];
  await p.drag(760, 420);
  atSpot(p, [760, 420], 'dropped'); await p.tick(20); atSpot(p, [760, 420], 'it stays where it was dropped');
  p.ptr(1300, 200); await p.tick(5);
  assert.equal(p.R.rested(), true, 'and rests there');
  p.agent.say('Still here, talking from the spot where I was put down a moment ago.'); await p.tick(1.5); atSpot(p, [760, 420], 'it talks from where it was dropped'); bubbleOnScreen(p, 'dropped speech');
  p.agent.hide(); await p.tick(3); atSpot(p, [760, 420], 'a new voice request (hide) leaves it there');
  // a click on it without moving it is not a drag
  const ev = { target: p.canvas, clientX: p.m.x, clientY: p.m.y, pointerId: 1 };
  p.ptr(p.m.x, p.m.y); for (const f of p.listeners.pointerdown) f(ev); await p.tick(0.1); for (const f of p.canvas.on.pointerup) f(ev); await p.tick(6);
  atSpot(p, [760, 420], 'after a click on it');
  // its next pointing takes it home
  const took = p.agent.pen.take(); await p.tick(2); await took;
  const moved = p.agent.pen.move(300, 300); await p.tick(1); await moved;
  const back = p.agent.pen.release(); await p.tick(3); await back;
  atSpot(p, home, 'home again after its next drawing: the setting was not changed by the drag');
  // a nudge of a few pixels isn't a move: it settles back on its spot
  await p.drag(home[0] + 12, home[1] - 8); await p.tick(4);
  atSpot(p, home, 'after a nudge');
}

// The Dock grows, the size changes, the overlay changes screens: home moves with them.
{
  const p = await started();
  atSpot(p, [117.6, 726.9], 'before'); await p.tick(3); assert.equal(p.R.rested(), true);
  p.win.__roamieSafe({ top: 33, left: 0, bottom: 140, right: 0, ox: 0, oy: 0 }); await p.tick(4);
  atSpot(p, [117.6, 666.9], 'a taller Dock'); await p.tick(3); assert.equal(p.R.rested(), true);
  p.win.__roamieSafe({ top: 33, left: 96, bottom: 0, right: 0, ox: 0, oy: 0 }); await p.tick(4);
  atSpot(p, [213.6, 806.9], 'the Dock on the left');
  // feature 21: orb.size changed (80 points, radius 39.2): closer to the corner, same behaviour
  p.host({ kind: 'orb', size: 80 }); await p.tick(4);
  assert.equal(p.creature.size, 80); assert.equal(p.agent.homing, true); atSpot(p, [96 + 94.08, 900 - 74.48], 'at 80 points');
  await p.tick(4); assert.equal(p.R.rested(), true); assert.equal(await p.tick(30), 0);
  p.ptr(600, 400); p.agent.say('Smaller, and still at home.'); await p.tick(2); atSpot(p, [190.08, 825.52], 'at 80 points, speaking'); bubbleOnScreen(p, 'speech at 80 points');
  p.agent.hush(); await p.tick(1);
  // outside 80 to 140: held to the range; nonsense: the default
  p.host({ kind: 'orb', size: 300 }); assert.equal(p.creature.size, 140); p.host({ kind: 'orb', size: 'big' }); assert.equal(p.creature.size, 100); p.host({ kind: 'orb', size: 80 });
  // the old size message does nothing now
  p.host({ kind: 'size', size: 'cursor' }); await p.tick(4); assert.equal(p.creature.form, 'default'); assert.equal(p.agent.homing, true);
  // the setting edited (sent again with the next request): it moves there
  p.host({ kind: 'home', home: 'top-right' }); await p.tick(9);
  atSpot(p, [1440 - 94.08, 33 + 94.08], 'after the setting changed');
  // the overlay moves to another screen: gone for a moment, then at that screen's home
  p.win.__roamieMoved(); await p.tick(0.1);
  assert.equal(p.agent.presence, 'hidden');
  p.win.innerWidth = 1920; p.win.innerHeight = 1080; p.win.__roamieSafe({ top: 25, left: 0, bottom: 0, right: 0, ox: 1440, oy: 0 }); p.win.dispatchEvent(new p.win.Event('resize'));
  await p.tick(5);
  assert.equal(p.agent.presence, 'shown'); atSpot(p, [1920 - 94.08, 25 + 94.08], 'on the other screen');
}

// The summon key still sends it away and brings it back; Esc doesn't take it off the screen.
{
  const p = await started();
  p.host({ kind: 'summon' }); await p.tick(3);
  assert.equal(p.agent.presence, 'hidden', 'the summon key sends it away'); await p.tick(30); assert.equal(p.agent.presence, 'hidden', 'and it stays away');
  p.host({ kind: 'summon' }); await p.tick(5);
  assert.equal(p.agent.presence, 'shown'); atSpot(p, HOME['bottom-left'], 'summoned back');
  p.host({ kind: 'summon' }); await p.tick(3); assert.equal(p.agent.presence, 'hidden');
  p.agent.say('Something to say brings it back too.'); await p.tick(3);
  assert.equal(p.agent.presence, 'shown'); atSpot(p, HOME['bottom-left'], 'back for a reply');
  p.host({ kind: 'esc' }); await p.tick(3);
  assert.equal(p.agent.presence, 'shown', 'Esc closes what it was saying, and it stays'); assert.equal(p.agent.bubble, null);
  assert.equal(p.escHeld(), false);
}

console.log('home position tests (the overlay): passed');
