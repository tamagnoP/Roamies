// Feature 21, part (a): the orb (showcase/roamies/orb.js), on the overlay page without a screen (page.mjs). What it
// draws in each state is recorded call by call (a stand-in canvas), so each state's shape is checked by numbers; how
// it looks is checked by eye (TESTS.md). Run: npm test.
//   - the owner's values; the design shown in settings.default.json is the one drawn
//   - each state differs in shape: listening an open ring, thinking an arc on a dotted ring, speaking bars, waiting an
//     amber half ring and the count, stood down one dim grey ring and a flat dash with nothing else, pi working three
//     short arcs; the dial is the working day with today's blocks and a line for now
//   - still at rest: no frame once settled, in every state that doesn't move; the moving states drawn at most 30
//     times a second; with Reduce Motion nothing moves
//   - the dial is drawn again every five minutes and when a block starts or ends, nothing in between
//   - the particle sprite is made once; only the centre spot takes clicks; orb.size is held to 80 to 140
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { page, started } from './page.mjs';
import { ORB_DESIGN, codeReference, settingsDefaults } from '../pi.mjs';

const src = fs.readFileSync(new URL('../../../roamies/orb.js', import.meta.url), 'utf8');

// ---- the owner's values, the same in code and in settings.default.json
{
  const p = page();
  assert.deepEqual({ ...p.R.orb.ORB }, ORB_DESIGN, 'orb.js draws the design settings.default.json shows');
  assert.deepEqual(codeReference().orb.design, ORB_DESIGN);
  assert.deepEqual({ ...p.R.orb.SIZE }, { default: 100, min: 80, max: 140 });
  assert.equal(settingsDefaults('/x').orb.size, 100);
  assert.equal(p.R.orb.FPS, 30);
  assert.match(src, /\{ disc: 100, line: 1, ticks: 36, hue: 194, count: 700, thick: 20, size: 1, speed: 50 \}/);
  for (const c of ['#06090F', '#F2F7FB', '#B4C2CE', '#62D5F8', '#F7C078', '#6B7B88']) assert.ok(src.includes(c), `the spec's colour ${c}`);
  assert.ok(!/fonts\.googleapis|https?:\/\//.test(src), 'nothing from the network');
}

// ---- what each state draws (a stand-in canvas that records every call)
function recorder() {
  const ops = [], stack = [];
  const c = {
    ops, strokeStyle: '', fillStyle: '', globalAlpha: 1, lineWidth: 1, font: '', globalCompositeOperation: 'source-over', lineCap: 'butt', textAlign: '', textBaseline: '',
    save() { stack.push([c.strokeStyle, c.fillStyle, c.globalAlpha, c.lineWidth, c.font]); },
    restore() { const s = stack.pop(); if (s) [c.strokeStyle, c.fillStyle, c.globalAlpha, c.lineWidth, c.font] = s; },
    beginPath() { c.path = []; }, arc(x, y, r, a0, a1) { c.path.push({ x, y, r, a0, a1 }); }, moveTo(x, y) { c.path.push({ m: [x, y] }); }, lineTo(x, y) { c.path.push({ l: [x, y] }); },
    stroke() { ops.push({ op: 'stroke', style: c.strokeStyle, w: c.lineWidth, path: c.path }); },
    fill() { ops.push({ op: 'fill', style: c.fillStyle, path: c.path }); },
    drawImage() { ops.push({ op: 'image', alpha: c.globalAlpha }); },
    fillText(t) { ops.push({ op: 'text', t: String(t), style: c.fillStyle }); },
    fillRect() { ops.push({ op: 'rect', style: c.fillStyle }); }, strokeRect() {}, measureText: (t) => ({ width: String(t).length * 7 }),
  };
  return c;
}
const p0 = page();
const DIAL = { start: 540, end: 1080, mine: [[600, 660], [780, 840]], theirs: [[700, 720]] };
const draw = (st) => { const r = recorder(); p0.R.orb.drawOrb(r, 200, 200, 100, { ang: 0, at: 0.5, level: 0.6, dial: DIAL, now: 690, queued: 0, pi: false, ...st }); return r.ops; };
const W = 100 * 1.114, RC = W * 0.333, RB = W * 0.362;
const near = (a, b) => Math.abs(a - b) < 0.01;
const ringsAt = (ops, r, style) => ops.filter((o) => o.op === 'stroke' && o.path.some((q) => near(q.r ?? -1, r)) && (!style || o.style.startsWith(style)));
const images = (ops) => ops.filter((o) => o.op === 'image').length;
{
  const rest = draw({ state: 'rest' });
  assert.equal(images(rest), 700, 'at rest: the 700 particles');
  assert.equal(ringsAt(rest, RC).length, 0, 'at rest: no ring at the listening radius');
  // the dial: three blocks as arcs (two of his, one taken), one past by 11:30 (dim), a line for now
  const arcs = ringsAt(rest, RB);
  assert.equal(arcs.length, 3, 'the day\'s blocks');
  assert.ok(arcs.some((a) => /0\.38\)$/.test(a.style)), 'a block that is over is dimmer');
  const nowLine = rest.filter((o) => o.op === 'stroke' && o.path.length === 2 && o.path[0].m && /hsla\(194,92%,68%,1\)/.test(o.style));
  assert.equal(nowLine.length, 1, 'one line for now');
  // the working day round the whole face: 09:00 at the top, 13:30 at the bottom (halfway)
  const a0 = arcs.find((a) => /0\.38\)$/.test(a.style)).path[0].a0;
  assert.ok(Math.abs(a0 - (-Math.PI / 2 + (60 / 540) * 2 * Math.PI) - 0.012) < 1e-6, 'a block starts where its time is on the working day');

  const listen = draw({ state: 'listen' });
  assert.equal(ringsAt(listen, RC, 'hsla(194').length, 1, 'listening: a bright open ring');
  assert.equal(images(listen), 700);

  const think = draw({ state: 'think' });
  const dots = think.filter((o) => o.op === 'fill' && o.path.length === 1 && near(Math.hypot(o.path[0].x - 200, o.path[0].y - 200), W * 0.15));
  assert.equal(dots.length, 24, 'thinking: a dotted ring');
  assert.equal(ringsAt(think, W * 0.15).length, 1, 'and one arc travelling on it');
  assert.ok(near(ringsAt(think, W * 0.15)[0].path[0].a1 - ringsAt(think, W * 0.15)[0].path[0].a0, Math.PI / 2), 'a quarter of the ring');

  const speak = draw({ state: 'speak' });
  const isBar = (o) => o.op === 'stroke' && near(o.w, W * 0.032) && o.path.length === 2 && o.path[0].m && o.path[0].m[0] === o.path[1].l[0];
  const bars = speak.filter(isBar);
  assert.equal(bars.length, 5, 'speaking: five bars');
  const quiet = draw({ state: 'speak', level: 0 }), loud = draw({ state: 'speak', level: 1 });
  const height = (ops) => ops.filter(isBar).reduce((s, o) => s + Math.abs(o.path[1].l[1] - o.path[0].m[1]), 0);
  assert.ok(height(loud) > height(quiet) * 2, 'the bars follow the voice');

  const waiting = draw({ state: 'waiting', queued: 3 });
  const half = ringsAt(waiting, RC, 'rgba(247,192,120');
  assert.equal(half.length, 1, 'waiting on the owner: an amber ring');
  assert.ok(near(half[0].path[0].a1 - half[0].path[0].a0, Math.PI), 'a half ring');
  assert.deepEqual(waiting.filter((o) => o.op === 'text').map((o) => [o.t, o.style]), [['3', '#F7C078']], 'and the count, in amber');
  assert.deepEqual(draw({ state: 'waiting', queued: 12 }).filter((o) => o.op === 'text').map((o) => o.t), ['9+']);

  const stood = draw({ state: 'stood', queued: 3, pi: false });
  assert.equal(images(stood), 0, 'stood down: no particles');
  assert.ok(stood.filter((o) => o.op === 'stroke').every((o) => o.style.startsWith('rgba(107,123,136')), 'only dim grey lines');
  assert.equal(stood.filter((o) => o.op === 'text').length, 0, 'no count');
  assert.equal(ringsAt(stood, RB).length, 0, 'no dial');
  const dash = stood.filter((o) => o.op === 'stroke' && o.path.length === 2 && o.path[0].m && o.path[0].m[1] === o.path[1].l[1] && o.path[0].m[1] === 200);
  assert.equal(dash.length, 1, 'a flat dash');

  const pi = draw({ state: 'rest', pi: true });
  assert.equal(ringsAt(pi, W * 0.305).length, 3, 'pi working: three short arcs');
  assert.equal(ringsAt(draw({ state: 'rest' }), W * 0.305).length, 0);
  // the same state, a moment later: the same picture (no motion at rest)
  assert.deepEqual(draw({ state: 'rest', at: 9 }), draw({ state: 'rest', at: 1 }), 'at rest nothing moves with time');
  assert.notDeepEqual(draw({ state: 'think', at: 2 }), draw({ state: 'think', at: 1 }), 'thinking moves');
  const nod = draw({ state: 'rest', dial: null });
  assert.equal(ringsAt(nod, RB).length, 0, 'no working day known: no dial');
}

// ---- still at rest, on the page: no frame once settled, in each state that doesn't move
{
  const p = await started();
  p.host({ kind: 'dial', ...DIAL });
  await p.tick(3);
  assert.equal(p.creature.state, 'rest'); assert.equal(p.R.rested(), true);
  assert.equal(await p.tick(20), 0, 'at rest: not one frame in 20 s');
  assert.equal(p.R.orbSprites, 1, 'the particle sprite is made once');
  for (const [msg, state] of [[{ kind: 'queue', n: 2 }, 'waiting'], [{ kind: 'pi', on: true }, 'waiting'], [{ kind: 'queue', n: 0 }, 'rest'], [{ kind: 'pi', on: false }, 'rest'], [{ kind: 'private', on: true }, 'rest'], [{ kind: 'stand', on: true }, 'stood'], [{ kind: 'stand', on: false }, 'rest']]) {
    p.host(msg);
    const f = await p.tick(1.5);
    assert.equal(p.creature.state, state, JSON.stringify(msg));
    assert.ok(f >= 1 && f <= 4, `${JSON.stringify(msg)}: drawn once or twice (${f} frames)`);
    assert.equal(await p.tick(10), 0, `${JSON.stringify(msg)}: then still`);
  }
  assert.equal(p.R.orbSprites, 1);
  // the moving states: thinking while a request runs; the orb in the listening state (no bubble: the pill by the
  // cursor on macOS) is painted at most 30 times a second though the page runs at 60
  p.agent.think('reading the file'); await p.tick(0.5);
  assert.equal(p.creature.state, 'think');
  p.agent.hush(); await p.tick(4);
  assert.equal(p.creature.state, 'rest'); assert.equal(p.R.rested(), true, 'still again once it is done');
  let painted = 0;
  const orig = p.creature.draw.bind(p.creature);
  p.creature.draw = (ctx, env) => { painted++; return orig(ctx, env); };
  p.creature.setHearing(true); p.creature.setLevel(0.5); p.R.wake();
  await p.tick(0.5); painted = 0;
  const frames = await p.tick(2);
  assert.ok(frames >= 110, `the page runs at 60 (${frames} frames in 2 s)`);
  assert.ok(painted >= 50 && painted <= 62, `the orb is painted at most 30 times a second (${painted} in 2 s)`);
  p.creature.setHearing(false); p.creature.draw = orig;
  // listening, from the voice helper (the pill by the cursor on macOS): the open ring, with the microphone's level
  p.win.__roamieVoice?.({ type: 'state', state: 'listening', wave: true });
  p.creature.setHearing(true); p.creature.setLevel(0.7); await p.tick(0.5);
  assert.equal(p.creature.state, 'listen');
  p.creature.setHearing(false); await p.tick(3);
  assert.equal(p.creature.state, 'rest'); assert.equal(p.R.rested(), true);
}

// ---- Reduce Motion: a moving state is drawn once and holds still
{
  const p = await started();
  p.R.tiles[0].env.reduced = true;
  p.win.matchMedia = () => ({ matches: true, addEventListener() {} });
  p.creature.setHearing(true); await p.tick(0.5);
  const a = p.creature.prepare({ ...p.R.tiles[0].env, reduced: true }).sig;
  await p.tick(0.5);
  const b = p.creature.prepare({ ...p.R.tiles[0].env, reduced: true }).sig;
  assert.equal(a, b, 'listening with Reduce Motion: the same picture');
}

// ---- the dial: drawn again every five minutes and when a block starts or ends, nothing in between
{
  const { dialKey, dialNext } = p0.R.orb;
  const at = (h, m, s = 0) => new Date(2026, 10, 28, h, m, s).getTime();
  const d = { start: 540, end: 1080, mine: [[602, 660]], theirs: [] };
  assert.equal(dialKey(d, at(10, 0, 10)), dialKey(d, at(10, 1, 50)), 'the same picture within a five-minute stretch');
  assert.notEqual(dialKey(d, at(10, 1, 50)), dialKey(d, at(10, 2, 5)), 'a block starting at 10:02 draws it again');
  assert.notEqual(dialKey(d, at(10, 4, 59)), dialKey(d, at(10, 5, 1)), 'and every five minutes');
  assert.ok(Math.abs(dialNext(d, at(10, 0, 0)) - 120_050) < 100, 'next at the block\'s start, 10:02');
  assert.ok(Math.abs(dialNext(d, at(10, 3, 0)) - 120_050) < 100, 'next at 10:05');
  assert.equal(dialNext(null, at(10, 0)), null, 'no dial, no timer');
  // on the page: one timer for the dial, and it wakes the loop for one picture
  const p = await started();
  p.host({ kind: 'dial', ...d }); await p.tick(3);
  assert.equal(p.R.rested(), true);
  const dialTimers = p.timers.filter((t) => !t.every);
  assert.equal(dialTimers.length, 1, 'one timer set for the next redraw');
  assert.ok(dialTimers[0].at - 1000 >= 1000 && dialTimers[0].at <= 5 * 60_000 + 2000 + 4000 + 1000, 'within five minutes');
}

// ---- size and the click spot
{
  const p = await started({ size: 140 });
  assert.equal(p.creature.size, 140); assert.equal(p.creature.spot, 140 * 0.18);
  p.host({ kind: 'orb', size: 79 }); assert.equal(p.creature.size, 80);
  p.host({ kind: 'orb', size: 141 }); assert.equal(p.creature.size, 140);
  p.host({ kind: 'orb', size: null }); assert.equal(p.creature.size, 100);
  assert.equal(p.creature.look, 'orb');
}

// ---- nothing of the old looks or their sounds is left in the page
{
  const root = new URL('../../../', import.meta.url);
  const html = fs.readFileSync(new URL('desktop.html', root), 'utf8');
  for (const gone of ['10-dither.js', '12-sidekick.js', 'jarvis.js', 'people.js', 'sfx.js', 'Martian Mono', 'Doto', 'woff2']) assert.ok(!html.includes(gone), `desktop.html: ${gone}`);
  for (const f of ['10-dither.js', '12-sidekick.js', 'jarvis.js', 'people.js', 'sfx.js']) assert.ok(!fs.existsSync(new URL(`roamies/${f}`, root)), `${f} is deleted`);
  assert.ok(!fs.existsSync(new URL('onboarding/fonts', root)), 'the bundled fonts are deleted');
  for (const f of fs.readdirSync(new URL('roamies/', root))) {
    const t = fs.readFileSync(new URL(`roamies/${f}`, root), 'utf8');
    assert.ok(!/Roamie\.sfx|\bsfx\(|Martian Mono|"Doto"|ditherKit/.test(t), `roamies/${f}: no sounds, old fonts or the old look`);
    assert.ok(!/fonts\.googleapis|fonts\.gstatic/.test(t), `roamies/${f}: no web fonts`);
  }
}
console.log('orb tests: passed');
