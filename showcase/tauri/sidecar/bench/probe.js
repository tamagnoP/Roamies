// Counting only, injected before the page's own scripts when PROBE is set. Holds nothing alive: buffers, sources and
// canvases are followed through weak references. Nothing of what is said or shown is read.
(() => {
  const c = { ctx: [], bufMade: 0, bufLive: 0, bufSecsLive: 0, bufSecsMade: 0, srcMade: 0, srcLive: 0, srcEnded: 0, canvMade: 0, canv: [], timeouts: 0, timeoutsLive: 0, intervalsLive: 0, frames: 0, rafAsked: 0, evals: 0, evalChars: 0 };
  const gone = new FinalizationRegistry((h) => { if (h.k === 'buf') { c.bufLive--; c.bufSecsLive -= h.s; } else if (h.k === 'src') c.srcLive--; });
  const AC = window.AudioContext;
  if (AC) {
    window.AudioContext = class extends AC {
      constructor(...a) { super(...a); c.ctx.push(new WeakRef(this)); }
      createBuffer(...a) { const b = super.createBuffer(...a); c.bufMade++; c.bufLive++; c.bufSecsLive += b.duration; c.bufSecsMade += b.duration; gone.register(b, { k: 'buf', s: b.duration }); return b; }
      createBufferSource() { const s = super.createBufferSource(); c.srcMade++; c.srcLive++; gone.register(s, { k: 'src' }); s.addEventListener('ended', () => { c.srcEnded++; }); return s; }
    };
  }
  const mk = document.createElement.bind(document);
  document.createElement = (tag, ...r) => { const el = mk(tag, ...r); if (String(tag).toLowerCase() === 'canvas') { c.canvMade++; c.canv.push(new WeakRef(el)); } return el; };
  if (window.OffscreenCanvas) { const OC = window.OffscreenCanvas; window.OffscreenCanvas = class extends OC { constructor(...a) { super(...a); c.canvMade++; c.canv.push(new WeakRef(this)); } }; }
  const st = window.setTimeout, ct = window.clearTimeout, si = window.setInterval, ci = window.clearInterval, live = new Set(), ints = new Set();
  window.setTimeout = (fn, ms, ...a) => { c.timeouts++; const id = st(() => { live.delete(id); typeof fn === 'function' ? fn(...a) : 0; }, ms); live.add(id); return id; };
  window.clearTimeout = (id) => { live.delete(id); ct(id); };
  window.setInterval = (fn, ms, ...a) => { const id = si(fn, ms, ...a); ints.add(id); return id; };
  window.clearInterval = (id) => { ints.delete(id); ci(id); };
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = (fn) => { c.rafAsked++; return raf((t) => { c.frames++; fn(t); }); };
  for (const k of ['width', 'height']) {
    const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, k);
    Object.defineProperty(HTMLCanvasElement.prototype, k, { ...d, set(v) { if (this[k] !== (v | 0)) { c.resizes = (c.resizes ?? 0) + 1; const w = k === 'width' ? v : this.width, h = k === 'height' ? v : this.height; c.resizedMPx = (c.resizedMPx ?? 0) + (w * h) / 1e6; } d.set.call(this, v); } });
  }
  const gid = CanvasRenderingContext2D.prototype.getImageData; let gidN = 0, gidMPx = 0;
  CanvasRenderingContext2D.prototype.getImageData = function (...a) { gidN++; gidMPx += (Math.abs(a[2]) * Math.abs(a[3])) / 1e6; return gid.apply(this, a); };
  const cid = CanvasRenderingContext2D.prototype.createImageData; let cidN = 0;
  CanvasRenderingContext2D.prototype.createImageData = function (...a) { cidN++; return cid.apply(this, a); };
  const n = { path2d: 0, pathOps: 0, grads: 0, measure: 0, drawImage: 0, fillText: 0, strokes: 0, saves: 0 };
  const P = window.Path2D; window.Path2D = class extends P { constructor(...a) { super(...a); n.path2d++; } };
  for (const k of ['moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'arc', 'rect', 'ellipse']) { const f = P.prototype[k]; P.prototype[k] = function (...a) { n.pathOps++; return f.apply(this, a); }; }
  const C = CanvasRenderingContext2D.prototype;
  for (const [k, key] of [['createLinearGradient', 'grads'], ['createRadialGradient', 'grads'], ['measureText', 'measure'], ['drawImage', 'drawImage'], ['fillText', 'fillText'], ['stroke', 'strokes'], ['save', 'saves']]) { const f = C[k]; C[k] = function (...a) { n[key]++; return f.apply(this, a); }; }
  n.bigOps = 0; n.bigClear = 0; n.bigDrawImage = 0; n.bigFilter = 0;
  for (const k of ['clearRect', 'fillRect', 'fill', 'stroke', 'fillText', 'drawImage']) { const f = C[k]; C[k] = function (...a) { if (this.canvas.width > 2000) { n.bigOps++; if (k === 'clearRect') n.bigClear++; if (k === 'drawImage') { n.bigDrawImage++; if (this.filter && this.filter !== 'none') n.bigFilter++; } } return f.apply(this, a); }; }
  const more = () => ({ ...n, resizes: c.resizes ?? 0, resizedMPx: Math.round(c.resizedMPx ?? 0), getImageData: gidN, getImageDataMPx: Math.round(gidMPx), createImageData: cidN });
  window.__probe = {
    read() {
      c.canv = c.canv.filter((w) => w.deref());
      const cs = c.canv.map((w) => w.deref()).filter(Boolean);
      const ctx = c.ctx.map((w) => w.deref()).filter(Boolean).map((a) => ({ state: a.state, t: Math.round(a.currentTime * 10) / 10, rate: a.sampleRate }));
      return { ctx, bufMade: c.bufMade, bufLive: c.bufLive, bufSecsMade: Math.round(c.bufSecsMade), bufSecsLive: Math.round(c.bufSecsLive), srcMade: c.srcMade, srcLive: c.srcLive, srcEnded: c.srcEnded,
        canvMade: c.canvMade, canvLive: cs.length, canvMPx: Math.round(cs.reduce((n, x) => n + x.width * x.height, 0) / 1e4) / 100, canvInDoc: document.getElementsByTagName('canvas').length,
        dom: document.getElementsByTagName('*').length, timeouts: c.timeouts, timeoutsLive: live.size, intervalsLive: ints.size, frames: c.frames, ...more() };
    },
  };
})();
