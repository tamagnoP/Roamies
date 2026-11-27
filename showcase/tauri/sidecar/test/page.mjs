// The overlay page run without a screen, for the tests: the page's scripts are loaded as they are, with a stand-in
// for the browser (a canvas that draws nowhere, a clock moved by hand) and for the Tauri shell. Shared by
// home.test.mjs, looks-rest.test.mjs and rebuild.test.mjs. Not a test of its own.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../../../', import.meta.url); // showcase/
/** The overlay page with stand-ins for the browser and the shell. Time only moves in tick(). */
export function page({ w = 1440, h = 900, safe = { top: 33, left: 0, bottom: 80, right: 0, ox: 0, oy: 0 }, ink = false } = {}) {
  let clock = 1000, tid = 1, frames = 0;
  const rafs = [], timers = [], listeners = {}, sent = [], invoked = [], made = [];
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
    c.putImageData = (img) => { c.last = img; }; // feature 33: what was last put on it, to measure (stand-page.test.mjs)
    made.push(c);
    return c;
  };
  const el = (tag) => {
    const e = anything(), on = {};
    Object.assign(e, { style: {}, width: 1, height: 1, tagName: tag, on, classList: { add() {}, remove() {}, contains: () => false, toggle() {} } });
    let ctx = null; // a closure, not a property: on the stand-in every property already reads as something
    e.getContext = () => (ctx ??= ctx2d());
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
    document: { createElement: el, addEventListener() {}, body: el('body'), documentElement: el('html'), head: el('head'), fonts: { load() {} }, querySelector: () => null, getElementById: () => null },
    // the shell: every call is noted, messages for the sidecar are kept apart
    __TAURI__: { core: { invoke: (cmd, args) => { invoked.push([cmd, args]); if (cmd === 'sidecar_send') sent.push(args.msg); return Promise.resolve(true); } } },
  };
  win.clearInterval = win.clearTimeout; win.window = win; win.globalThis = win; win.self = win;
  const ctx = vm.createContext(win);
  const run = (f) => vm.runInContext(fs.readFileSync(new URL(`roamies/${f}`, ROOT), 'utf8'), ctx, { filename: f });
  // desktop.html's order, less what only draws cards, sounds and drawings
  for (const f of ['core.js', 'measure.js', 'glass.js', 'home.js', 'agent.js', 'agent-tools.js', 'jarvis.js', 'people.js', '10-dither.js', '12-sidekick.js']) run(f);
  win.Roamie.setSafe(safe);
  win.Roamie.bootDesktop(canvas);
  if (ink) for (const f of ['ink3d.js', 'world.js', 'ink.js', 'pen.js']) run(f); // the drawings and cards (feature 40's card of found files)
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
    win, R, agent, creature, m, tick, sent, invoked, canvas, listeners, timers, made,
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
export async function started({ size = 'default', home = 'bottom-left', ...o } = {}) {
  const p = page(o);
  await p.tick(0.5);
  assert.deepEqual(p.sent.map((s) => s.type), ['ui_ready']);
  p.host({ kind: 'size', size });
  if (home !== null) p.host({ kind: 'home', home });
  await p.tick(4);
  return p;
}
export const HOME = { 'bottom-left': [144, 706], 'bottom-right': [1296, 706], 'top-left': [144, 177], 'top-right': [1296, 177] }; // radius 60, as in part 1
export const atSpot = (p, [x, y], what) => assert.ok(Math.hypot(p.m.x - x, p.m.y - y) <= 6, `${what}: at (${x}, ${y}), is at (${p.m.x.toFixed(1)}, ${p.m.y.toFixed(1)})`);
export const bubbleOnScreen = (p, what) => {
  const b = p.agent.bubble, S = p.bounds();
  assert.ok(b, `${what}: a bubble is open`);
  const [x0, y0, x1, y1] = [b.x.x, b.y.x, b.x.x + b.w.x, b.y.x + b.h.x];
  assert.ok(x0 >= S.l && y0 >= S.t && x1 <= S.r && y1 <= S.b, `${what}: the bubble is whole on the visible screen (${[x0, y0, x1, y1].map(Math.round)} in ${JSON.stringify(S)})`);
  assert.ok(b.w.x > 40 && b.h.x > 10, `${what}: the bubble has opened`);
  // beside the body: its nearest edge within three body radii of the body's centre
  const dx = Math.max(x0 - p.m.x, 0, p.m.x - x1), dy = Math.max(y0 - p.m.y, 0, p.m.y - y1);
  assert.ok(Math.hypot(dx, dy) <= 60 * 3, `${what}: the bubble is beside the body (${Math.round(Math.hypot(dx, dy))} px away)`);
};
export const SEND = 'Send to pi?  CAN EDIT files and run commands · in ~/Documents/cell-segmentation\nUndo snapshot taken.\nSandboxed: pi can read 3 folders and write only in this project.\n\n[[ Please read segment.py and explain what the watershed step does, then add a short docstring to each function that has none, keeping the code itself exactly as it is. ]]';
