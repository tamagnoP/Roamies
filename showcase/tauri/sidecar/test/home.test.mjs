// Local-only build: the character's home on the desktop. Run: npm test
//  1. the rule (showcase/roamies/home.js: where the home spot is), on its own;
//  2. the "home" setting (pi.mjs: loadSettings, homeFor);
//  3. the overlay itself (core.js, agent.js, 10-dither.js, host.js), run here without a screen: the page's scripts are
//     loaded as they are, with a stand-in for the browser (a canvas that draws nowhere, a clock moved by hand, and a
//     stand-in for the Tauri shell). What it can't show is how any of it looks; that is checked by eye.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { homeFor, loadSettings } from '../pi.mjs';

const ROOT = new URL('../../../', import.meta.url); // showcase/
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

// ---- 1. the rule
{
  const window = { Roamie: {} };
  vm.runInNewContext(fs.readFileSync(new URL('roamies/home.js', ROOT), 'utf8'), { window, Math, Number });
  const { homeSpot, homeSetting } = window.Roamie;
  const spot = (...a) => Array.from(homeSpot(...a));
  // A 1440 x 900 screen with a 33 px menu bar and an 80 px Dock at the bottom; a body of radius 60.
  const B = { l: 0, t: 33, r: 1440, b: 820 }, r = 60;
  const whole = ([x, y], b = B) => x - r * 1.5 >= b.l && x + r * 1.5 <= b.r && y - r * 1.5 >= b.t && y + r * 1.5 <= b.b;

  assert.deepEqual(spot('bottom-left', B, r), [144, 706]);
  assert.deepEqual(spot('bottom-right', B, r), [1296, 706]);
  assert.deepEqual(spot('top-left', B, r), [144, 177]);
  assert.deepEqual(spot('top-right', B, r), [1296, 177]);
  for (const c of ['bottom-left', 'bottom-right', 'top-left', 'top-right']) assert.ok(whole(spot(c, B, r)), `${c}: the whole body is on the visible screen`);
  // the default, and anything that isn't a corner or a point
  for (const bad of [undefined, null, '', 'middle', 7, [], {}, { x: 1 }, { x: '10', y: 20 }, { x: NaN, y: 2 }, { x: Infinity, y: 2 }]) assert.deepEqual(spot(bad, B, r), [144, 706], `${JSON.stringify(bad)} means bottom-left`);
  assert.deepEqual(spot(' Top-Right ', B, r), [1296, 177], 'capitals and spaces are forgiven');
  assert.equal(homeSetting('BOTTOM-RIGHT'), 'bottom-right'); assert.equal(homeSetting('nowhere'), 'bottom-left');
  assert.deepEqual({ ...homeSetting({ x: 5, y: 6, z: 7 }) }, { x: 5, y: 6 });

  // clear of the Dock wherever it is, and of the menu bar
  const dockLeft = { l: 90, t: 33, r: 1440, b: 900 }, dockRight = { l: 0, t: 33, r: 1350, b: 900 }, noDock = { l: 0, t: 33, r: 1440, b: 900 };
  assert.deepEqual(spot('bottom-left', dockLeft, r), [234, 786]);
  assert.deepEqual(spot('bottom-right', dockRight, r), [1206, 786]);
  assert.deepEqual(spot('bottom-left', noDock, r), [144, 786]);
  assert.ok(spot('top-left', B, r)[1] - r * 1.5 >= 33, 'below the menu bar');
  // the small size sits closer to the corner
  assert.deepEqual(spot('bottom-left', B, 30), [72, 763]);

  // coordinates: screen points, kept as given when the body fits there
  assert.deepEqual(spot({ x: 700, y: 400 }, B, r), [700, 400]);
  // ...and moved the least it takes to keep the body whole on the visible screen
  assert.deepEqual(spot({ x: 0, y: 0 }, B, r), [96, 141], 'not under the menu bar, not off the left edge');
  assert.deepEqual(spot({ x: 1440, y: 900 }, B, r), [1344, 730], 'not under the Dock, not off the right edge');
  assert.deepEqual(spot({ x: 700, y: 880 }, B, r), [700, 730], 'a point under the Dock lands just above it');
  assert.deepEqual(spot({ x: -5000, y: 99999 }, B, r), [96, 730]);
  for (const p of [{ x: 0, y: 0 }, { x: 1440, y: 900 }, { x: 3, y: 500 }, { x: 900, y: 34 }]) assert.ok(whole(spot(p, B, r)), `${JSON.stringify(p)}: whole on the visible screen`);
  // a second display to the right of the main one: its top-left corner is (1440, 0) in screen points
  const second = { x: 1440, y: 0 };
  assert.deepEqual(spot({ x: 2000, y: 400 }, B, r, second), [560, 400], 'screen points become this overlay\'s own');
  assert.deepEqual(spot({ x: 700, y: 400 }, B, r, second), [96, 400], 'a point on another display lands at the nearest edge of this one');
  assert.deepEqual(spot('bottom-left', B, r, second), [144, 706], 'a corner is this display\'s corner, whichever display it is');
  // a display above the main one has a negative origin
  assert.deepEqual(spot({ x: 300, y: -500 }, B, r, { x: 0, y: -900 }), [300, 400]);
  // a screen too small for the margins: the middle, never outside
  assert.deepEqual(spot('bottom-left', { l: 0, t: 0, r: 100, b: 100 }, r), [50, 50]);
  assert.deepEqual(spot({ x: 900, y: 900 }, { l: 0, t: 0, r: 100, b: 100 }, r), [50, 50]);
}

// ---- 2. the setting
{
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'home-setting-')));
  const file = path.join(home, 'Documents', 'roamies-pi', 'settings.json');
  assert.equal(loadSettings(home).home, 'bottom-left');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).home, 'bottom-left', 'a new settings file names it, with its default');
  const made = fs.readFileSync(file, 'utf8');
  const withHome = (v) => { fs.writeFileSync(file, JSON.stringify(v === undefined ? {} : { home: v })); return loadSettings(home).home; };
  assert.equal(withHome(undefined), 'bottom-left', 'a file from before the setting existed works as before');
  for (const c of ['bottom-left', 'bottom-right', 'top-left', 'top-right']) assert.equal(withHome(c), c);
  assert.equal(withHome(' Top-Left '), 'top-left');
  assert.deepEqual(withHome({ x: 300, y: 120.5 }), { x: 300, y: 120.5 });
  assert.deepEqual(withHome({ x: -1200, y: 40, display: 2 }), { x: -1200, y: 40 }, 'only x and y are taken');
  for (const bad of ['centre', 3, true, null, [], [10, 20], {}, { x: 10 }, { x: '10', y: '20' }, { x: null, y: 2 }]) assert.equal(withHome(bad), 'bottom-left', `${JSON.stringify(bad)} means the default`);
  assert.deepEqual(homeFor(home), 'bottom-left');
  fs.writeFileSync(file, JSON.stringify({ home: 'top-right' })); assert.equal(homeFor(home), 'top-right');
  const before = fs.readFileSync(file, 'utf8');
  homeFor(home); loadSettings(home);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'reading the setting never writes the file');
  fs.writeFileSync(file, '{ not json'); assert.equal(homeFor(home), 'bottom-left', 'a broken file means the default, not an error');
  assert.ok(made.includes('"home"'));
  fs.rmSync(home, { recursive: true, force: true });
}

// ---- 3. the overlay, without a screen
/** The overlay page with stand-ins for the browser and the shell. Time only moves in tick(). */
function page({ w = 1440, h = 900, safe = { top: 33, left: 0, bottom: 80, right: 0, ox: 0, oy: 0 } } = {}) {
  let clock = 1000, tid = 1, frames = 0;
  const rafs = [], timers = [], listeners = {}, sent = [], invoked = [];
  // Something that can be read, called and built without complaint: the parts of the browser nothing here depends on.
  const anything = () => new Proxy(function () {}, {
    get: (t, p) => (p === Symbol.toPrimitive ? () => 0 : p === 'then' ? undefined : (t[p] ??= anything())),
    set: (t, p, v) => { t[p] = v; return true; },
    apply: () => anything(), construct: () => anything(),
  });
  const ctx2d = () => {
    const c = anything();
    c.createImageData = (W, H) => ({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4) });
    c.getImageData = (x, y, W, H) => ({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4) });
    c.measureText = (s) => ({ width: String(s).length * 7 });
    return c;
  };
  const el = (tag) => {
    const e = anything(), on = {};
    Object.assign(e, { style: {}, width: 1, height: 1, tagName: tag, on, classList: { add() {}, remove() {}, contains: () => false, toggle() {} } });
    e.getContext = () => (e.ctx ??= ctx2d());
    e.addEventListener = (n, f) => { (on[n] ??= []).push(f); };
    for (const n of ['setAttribute', 'appendChild', 'focus', 'blur', 'setPointerCapture']) e[n] = () => {};
    e.getAttribute = () => ''; e.toDataURL = () => 'data:image/png;base64,AAAA'; e.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 });
    return e;
  };
  const canvas = el('canvas');
  const win = {
    Math, Map, Set, Promise, JSON, Date, Array, Object, Number, String, Symbol, Error, RegExp, Uint32Array, Uint8ClampedArray, Uint8Array, Float32Array, Int32Array, Infinity, NaN, isFinite, parseFloat, parseInt, console, URLSearchParams,
    ROAMIE_ONLY: ['sidekick'], ROAMIE_UNIT: 400, // as the shell sets them (main.rs)
    innerWidth: w, innerHeight: h, devicePixelRatio: 2,
    performance: { now: () => clock },
    requestAnimationFrame: (f) => { rafs.push(f); return rafs.length; },
    setTimeout: (f, ms = 0) => { timers.push({ id: tid, at: clock + ms, f }); return tid++; },
    setInterval: (f, ms) => { timers.push({ id: tid, at: clock + ms, f, every: ms }); return tid++; },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener: (n, f) => { (listeners[n] ??= []).push(f); }, removeEventListener() {},
    dispatchEvent: (e) => { for (const f of listeners[e.type] ?? []) f(e); },
    Event: class { constructor(t) { this.type = t; } }, Image: class {}, Path2D: class { moveTo() {} lineTo() {} closePath() {} rect() {} arc() {} },
    location: { search: '' }, navigator: { platform: 'MacIntel', userAgent: '' },
    document: { createElement: el, addEventListener() {}, body: el('body'), documentElement: el('html'), head: el('head'), fonts: { load() {} }, querySelector: () => null },
    // the shell: every call is noted, messages for the sidecar are kept apart
    __TAURI__: { core: { invoke: (cmd, args) => { invoked.push([cmd, args]); if (cmd === 'sidecar_send') sent.push(args.msg); return Promise.resolve(true); } } },
  };
  win.clearInterval = win.clearTimeout; win.window = win; win.globalThis = win; win.self = win;
  const ctx = vm.createContext(win);
  const run = (f) => vm.runInContext(fs.readFileSync(new URL(`roamies/${f}`, ROOT), 'utf8'), ctx, { filename: f });
  // desktop.html's order, less what only draws cards, sounds and drawings
  for (const f of ['core.js', 'glass.js', 'home.js', 'agent.js', 'agent-tools.js', 'jarvis.js', 'people.js', '10-dither.js', '12-sidekick.js']) run(f);
  win.Roamie.setSafe(safe);
  win.Roamie.bootDesktop(canvas);
  run('host.js');
  const R = win.Roamie, creature = R.tiles.find((t) => t.creature.agent).creature;
  /** Lets `sec` seconds pass at 60 frames a second. Returns how many frames the page asked for and ran. */
  const tick = async (sec) => {
    const n0 = frames;
    for (const end = clock + sec * 1000; clock < end;) {
      clock += 1000 / 60;
      for (const t of timers.filter((x) => x.at <= clock)) { if (t.every) t.at += t.every; else timers.splice(timers.indexOf(t), 1); t.f(); }
      for (const f of rafs.splice(0)) { frames++; f(clock); }
      await null; await null; await null;
    }
    return frames - n0;
  };
  const m = creature.mover, agent = creature.agent;
  return {
    win, R, agent, creature, m, tick, sent, invoked, canvas, listeners, timers,
    host: (msg) => win.__roamieHost(msg),
    ptr: (x, y) => win.__roamiePtr(x, y, clock), // the shell's cursor sample; it answers through set_hot
    hot: () => invoked.filter(([c]) => c === 'set_hot').at(-1)?.[1].hot ?? false,
    escHeld: () => invoked.filter(([c]) => c === 'esc_watch').at(-1)?.[1].on ?? false,
    at: () => [m.x, m.y],
    bounds: () => ({ l: R.safe.left, t: R.safe.top, r: win.innerWidth - R.safe.right, b: win.innerHeight - R.safe.bottom }),
    /** Press on the body, drag to (x, y) slowly and let go there. */
    async drag(x, y) {
      const from = [m.x, m.y], ev = (cx, cy) => ({ target: canvas, clientX: cx, clientY: cy, pointerId: 1 });
      this.ptr(from[0], from[1]); await tick(0.1);
      for (const f of listeners.pointerdown) f(ev(from[0], from[1]));
      for (let i = 1; i <= 40; i++) { this.ptr(from[0] + ((x - from[0]) * i) / 40, from[1] + ((y - from[1]) * i) / 40); await tick(0.05); }
      await tick(0.6);
      for (const f of canvas.on.pointerup) f(ev(x, y));
      await tick(0.2);
    },
  };
}
/** The page as the app starts it: the sidecar answers ui_ready with the size and the home. */
async function started({ size = 'default', home = 'bottom-left', ...o } = {}) {
  const p = page(o);
  await p.tick(0.5);
  assert.deepEqual(p.sent.map((s) => s.type), ['ui_ready']);
  p.host({ kind: 'size', size });
  if (home !== null) p.host({ kind: 'home', home });
  await p.tick(4);
  return p;
}
const HOME = { 'bottom-left': [144, 706], 'bottom-right': [1296, 706], 'top-left': [144, 177], 'top-right': [1296, 177] }; // radius 60, as in part 1
const atSpot = (p, [x, y], what) => assert.ok(Math.hypot(p.m.x - x, p.m.y - y) <= 6, `${what}: at (${x}, ${y}), is at (${p.m.x.toFixed(1)}, ${p.m.y.toFixed(1)})`);
const bubbleOnScreen = (p, what) => {
  const b = p.agent.bubble, S = p.bounds();
  assert.ok(b, `${what}: a bubble is open`);
  const [x0, y0, x1, y1] = [b.x.x, b.y.x, b.x.x + b.w.x, b.y.x + b.h.x];
  assert.ok(x0 >= S.l && y0 >= S.t && x1 <= S.r && y1 <= S.b, `${what}: the bubble is whole on the visible screen (${[x0, y0, x1, y1].map(Math.round)} in ${JSON.stringify(S)})`);
  assert.ok(b.w.x > 40 && b.h.x > 10, `${what}: the bubble has opened`);
  // beside the body: its nearest edge within three body radii of the body's centre
  const dx = Math.max(x0 - p.m.x, 0, p.m.x - x1), dy = Math.max(y0 - p.m.y, 0, p.m.y - y1);
  assert.ok(Math.hypot(dx, dy) <= 60 * 3, `${what}: the bubble is beside the body (${Math.round(Math.hypot(dx, dy))} px away)`);
};
const SEND = 'Send to pi?  CAN EDIT files and run commands · in ~/Documents/cell-segmentation\nUndo snapshot taken.\nSandboxed: pi can read 3 folders and write only in this project.\n\n[[ Please read segment.py and explain what the watershed step does, then add a short docstring to each function that has none, keeping the code itself exactly as it is. ]]';

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
  p.ptr(spot[0] + 20, spot[1] - 10); assert.equal(p.hot(), true, `${home}: the body takes clicks`);
  p.ptr(spot[0] + 82, spot[1]); assert.equal(p.hot(), true); p.ptr(spot[0] + 84, spot[1]); assert.equal(p.hot(), false, 'the patch that takes clicks is a circle of 82.5 px radius round its centre');
  p.ptr(spot[0] + 60, spot[1] + 60); assert.equal(p.hot(), false, 'a circle, not a square');
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
  atSpot(low, [96, 730], 'coordinates under the Dock, at the edge');
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
  atSpot(p, [144, 706], 'before'); await p.tick(3); assert.equal(p.R.rested(), true);
  p.win.__roamieSafe({ top: 33, left: 0, bottom: 140, right: 0, ox: 0, oy: 0 }); await p.tick(4);
  atSpot(p, [144, 646], 'a taller Dock'); await p.tick(3); assert.equal(p.R.rested(), true);
  p.win.__roamieSafe({ top: 33, left: 96, bottom: 0, right: 0, ox: 0, oy: 0 }); await p.tick(4);
  atSpot(p, [240, 786], 'the Dock on the left');
  // the small size: half the body, closer to the corner, same behaviour
  p.host({ kind: 'size', size: 'small' }); await p.tick(4);
  assert.equal(p.agent.homing, true); atSpot(p, [96 + 72, 900 - 57], 'small');
  await p.tick(4); assert.equal(p.R.rested(), true); assert.equal(await p.tick(30), 0);
  p.ptr(600, 400); p.agent.say('Small, and still at home.'); await p.tick(2); atSpot(p, [168, 843], 'small, speaking'); bubbleOnScreen(p, 'small speech');
  p.agent.hush(); await p.tick(1);
  // the setting edited (sent again with the next request): it moves there
  p.host({ kind: 'home', home: 'top-right' }); await p.tick(5);
  atSpot(p, [1440 - 72, 33 + 72], 'after the setting changed');
  // the overlay moves to another screen: gone for a moment, then at that screen's home
  p.win.__roamieMoved(); await p.tick(0.1);
  assert.equal(p.agent.presence, 'hidden');
  p.win.innerWidth = 1920; p.win.innerHeight = 1080; p.win.__roamieSafe({ top: 25, left: 0, bottom: 0, right: 0, ox: 1440, oy: 0 }); p.win.dispatchEvent(new p.win.Event('resize'));
  await p.tick(5);
  assert.equal(p.agent.presence, 'shown'); atSpot(p, [1920 - 72, 25 + 72], 'on the other screen');
}

// The cursor size is upstream's: beside the cursor, following it, hidden when idle. Switching sizes switches behaviour.
{
  const p = await started({ size: 'cursor' });
  assert.equal(p.agent.homing, false); assert.equal(p.agent.presence, 'hidden', 'cursor size: hidden until needed');
  p.ptr(600, 400); await p.tick(0.3); p.agent.say('hi'); await p.tick(1.5);
  assert.ok(Math.hypot(p.m.x - 600, p.m.y - 400) < 120, 'cursor size: beside the cursor');
  p.ptr(900, 500); await p.tick(1); p.ptr(900, 500); await p.tick(1);
  assert.ok(Math.hypot(p.m.x - 900, p.m.y - 500) < 120, 'cursor size: it follows the cursor');
  p.agent.hush(); await p.tick(12);
  assert.equal(p.agent.presence, 'hidden', 'cursor size: hides when idle');
  // to the default size: it comes on at home and stays
  p.host({ kind: 'size', size: 'default' }); await p.tick(5);
  assert.equal(p.agent.presence, 'shown'); atSpot(p, HOME['bottom-left'], 'switched to the default size');
  await p.tick(30); assert.equal(p.agent.presence, 'shown');
  // and back to the cursor size: hidden again when idle, beside the cursor when asked
  p.host({ kind: 'size', size: 'cursor' }); await p.tick(12);
  assert.equal(p.agent.presence, 'hidden');
  p.ptr(500, 300); await p.tick(0.3); p.agent.say('hi again'); await p.tick(1.5);
  assert.ok(Math.hypot(p.m.x - 500, p.m.y - 300) < 120);
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

console.log('home position tests: passed');
