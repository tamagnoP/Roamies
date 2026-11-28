// The orb: Roamies' one look (feature 21, part a). The owner's design of 2026-11-17 (the "Roamies orb instrument"
// prototype) and DESIGN-SPEC.md: an instrument on its own dark disc, where every line is a readout. From the outside
// in: the working day as a dial (calendar.dayStart to calendar.dayEnd, the day's blocks as arcs, a line for now), the
// particle ring, and the centre, which shows the state by its shape:
//   at rest: the centre rings, still; listening: a bright open ring, the particles rippling with the microphone;
//   thinking: one arc travelling round a dotted ring; speaking: bars that follow the voice; waiting on the owner: an
//   amber half ring and the count of what the quiet queue holds; stood down: one dim grey ring with a flat dash, and
//   nothing else; pi working: three short arcs, drawn once.
// Still at rest: a state that doesn't move is drawn once and the frame loop stops (core.js). The moving states are
// drawn at most 30 times a second. At rest the dial is drawn again every five minutes and when a block starts or
// ends, nothing in between. With Reduce Motion each state is drawn once and holds still.
// Roamie.orbKit(o) returns a roamie definition with the same parts the agent layer (agent.js) and core.js use.
(() => {
  const R = window.Roamie;
  const { clamp } = R;
  const TAU = Math.PI * 2, TOP = -Math.PI / 2;
  // The owner's values (2026-11-17). Fixed in code: only the size on screen is a setting (orb.size, in points).
  const ORB = { disc: 100, line: 1, ticks: 36, hue: 194, count: 700, thick: 20, size: 1, speed: 50 };
  const SIZE = { default: 100, min: 80, max: 140 };
  const FPS = 30;
  const CURSOR_R = 13; // the pen's reticle while it draws or works in another app
  const COL = { ground: '#06090F', text: '#F2F7FB', quiet: '#B4C2CE', accent: '#62D5F8', amber: '#F7C078', stood: '#6B7B88' };
  const blue = (a) => `hsla(${ORB.hue},92%,68%,${a})`;
  const white = (a) => `rgba(242,247,251,${a})`;
  const amber = (a) => `rgba(247,192,120,${a})`;
  const grey = (a) => `rgba(107,123,136,${a})`;
  const SANS = '-apple-system, system-ui, "Segoe UI", sans-serif';

  // The particles: placed once, the same on every page (a seeded sequence), so a new page draws what the old one did.
  const seeded = (s) => () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const rnd = seeded(194);
  const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;
  const N = ORB.count;
  const P = { th: new Float32Array(N), ro: new Float32Array(N), ph: new Float32Array(N), sp: new Float32Array(N), sz: new Float32Array(N) };
  for (let i = 0; i < N; i++) { P.th[i] = rnd() * TAU; P.ro[i] = gauss(); P.ph[i] = rnd() * TAU; P.sp[i] = 0.6 + rnd() * 0.8; const q = rnd(); P.sz[i] = 0.5 + q * q * 1.5; }
  // One soft dot, made once and drawn for every particle.
  let dot = null;
  const sprite = () => {
    if (dot) return dot;
    dot = document.createElement('canvas'); dot.width = dot.height = 64;
    const c = dot.getContext('2d'), g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, `hsla(${ORB.hue},100%,86%,1)`); g.addColorStop(0.25, `hsla(${ORB.hue},95%,66%,.9)`); g.addColorStop(1, `hsla(${ORB.hue},95%,58%,0)`);
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    R.orbSprites = (R.orbSprites ?? 0) + 1; // for the tests: made once
    return dot;
  };

  /** The working day's minutes now, and the key that changes only when the dial must be drawn again: every five
   *  minutes, and when a block starts or ends. */
  const dialKey = (dial, at) => {
    if (!dial) return 'none';
    const d = new Date(at), min = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    const edges = [...dial.mine, ...dial.theirs].flat().filter((e) => e <= min).length;
    return `${Math.floor(min / 5)}:${edges}`;
  };
  /** When the dial is next drawn again, in ms from at (null: never). */
  const dialNext = (dial, at) => {
    if (!dial) return null;
    const d = new Date(at), min = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 60000;
    const next = Math.min((Math.floor(min / 5) + 1) * 5, ...[...dial.mine, ...dial.theirs].flat().filter((e) => e > min));
    return Math.max(1000, Math.ceil((next - min) * 60000) + 50);
  };

  /** Draws the orb on ctx, centred at (cx, cy), D css px across. st: { state, ang, at, level, dial, now, queued, pi,
   *  cursor }. Returns nothing; draws only. */
  function drawOrb(ctx, cx, cy, D, st) {
    const arc = (r, a0, a1) => { ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke(); };
    ctx.save();
    ctx.lineCap = 'butt'; ctx.globalCompositeOperation = 'source-over';
    if (st.cursor) {
      // The pen: a small reticle, its tip the centre.
      const r = D / 2;
      ctx.fillStyle = COL.ground; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = blue(0.95); ctx.lineWidth = 1.6; arc(r - 2, 0, TAU);
      ctx.strokeStyle = white(0.8); ctx.lineWidth = 1;
      for (let j = 0; j < 4; j++) { const a = j * TAU / 4; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (r - 6), cy + Math.sin(a) * (r - 6)); ctx.lineTo(cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2)); ctx.stroke(); }
      ctx.fillStyle = blue(1); ctx.beginPath(); ctx.arc(cx, cy, 1.8, 0, TAU); ctx.fill();
      ctx.restore();
      return;
    }
    const w = D * 1.114, lw = ORB.line;
    const RD = w * 0.44, RA = w * 0.405, RB = w * 0.362, RC = w * 0.333, RP = w * 0.305, RR = w * 0.262;
    // the dark disc it always sits on, so it reads the same over any window
    ctx.fillStyle = `rgba(6,9,15,${ORB.disc / 100})`; ctx.beginPath(); ctx.arc(cx, cy, RD, 0, TAU); ctx.fill();
    if (st.state === 'stood') {
      // Stood down: one dim grey ring with a flat dash; no dial, no particles, no count.
      ctx.strokeStyle = grey(0.6); ctx.lineWidth = lw * 0.8; arc(RD - lw / 2, 0, TAU);
      ctx.strokeStyle = grey(0.75); ctx.lineWidth = lw * 1.4; arc(RC * 0.9, 0, TAU);
      ctx.lineCap = 'round'; ctx.lineWidth = lw * 2.6; ctx.beginPath(); ctx.moveTo(cx - w * 0.1, cy); ctx.lineTo(cx + w * 0.1, cy); ctx.stroke();
      ctx.restore();
      return;
    }
    ctx.strokeStyle = white(0.28); ctx.lineWidth = lw; arc(RD - lw / 2, 0, TAU);
    // The dial: the working day round the whole face from the top, a mark each hour and a finer one between.
    const dial = st.dial;
    if (dial) {
      const span = Math.max(1, dial.end - dial.start), ang = (min) => TOP + clamp((min - dial.start) / span, 0, 1) * TAU;
      for (let j = 0; j < ORB.ticks; j++) {
        const a = TOP + (j / ORB.ticks) * TAU;
        ctx.strokeStyle = white(0.4); ctx.lineWidth = lw;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * RA, cy + Math.sin(a) * RA); ctx.lineTo(cx + Math.cos(a) * (RA - w * 0.012), cy + Math.sin(a) * (RA - w * 0.012)); ctx.stroke();
      }
      for (let h = Math.ceil(dial.start / 60) * 60; h <= dial.end; h += 60) {
        const a = ang(h), edge = h === dial.start || h === dial.end, len = edge ? w * 0.034 : w * 0.024;
        ctx.strokeStyle = white(edge ? 0.95 : 0.75); ctx.lineWidth = edge ? lw * 1.6 : lw;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * RA, cy + Math.sin(a) * RA); ctx.lineTo(cx + Math.cos(a) * (RA - len), cy + Math.sin(a) * (RA - len)); ctx.stroke();
      }
      const now = st.now;
      ctx.lineWidth = lw * 3; ctx.lineCap = 'round';
      const gap = 0.012;
      for (const [list, mine] of [[dial.theirs, false], [dial.mine, true]]) {
        for (const [s, e] of list) {
          if (e <= dial.start || s >= dial.end) continue;
          const past = e <= now, a0 = ang(Math.max(s, dial.start)) + gap, a1 = ang(Math.min(e, dial.end)) - gap;
          if (a1 <= a0) continue;
          ctx.strokeStyle = mine ? blue(past ? 0.38 : 0.95) : white(past ? 0.16 : 0.4);
          arc(RB, a0, a1);
        }
      }
      ctx.lineCap = 'butt';
      if (now >= dial.start && now <= dial.end) {
        const na = ang(now);
        ctx.strokeStyle = blue(1); ctx.lineWidth = lw * 2;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(na) * (RA + w * 0.012), cy + Math.sin(na) * (RA + w * 0.012)); ctx.lineTo(cx + Math.cos(na) * (RB - w * 0.022), cy + Math.sin(na) * (RB - w * 0.022)); ctx.stroke();
      }
    }
    // Listening: a bright open ring. Opened by an answer window (st.left: the share of its time left), it drains from
    // the top as the time goes, over a faint ring; opened by a clap or the talk keys, it stays whole.
    if (st.state === 'listen') {
      if (st.left == null) { ctx.strokeStyle = blue(1); ctx.lineWidth = lw * 2.2; arc(RC, 0, TAU); }
      else {
        ctx.strokeStyle = white(0.3); ctx.lineWidth = lw; arc(RC, 0, TAU);
        if (st.left > 0) { ctx.strokeStyle = blue(1); ctx.lineWidth = lw * 2.2; arc(RC, TOP, TOP + TAU * st.left); }
      }
    }
    // Waiting on the owner: an amber half ring over the top, the lower half a faint line.
    if (st.state === 'waiting') {
      ctx.lineCap = 'round'; ctx.strokeStyle = amber(1); ctx.lineWidth = lw * 2.6; arc(RC, Math.PI, TAU);
      ctx.lineCap = 'butt'; ctx.strokeStyle = white(0.3); ctx.lineWidth = lw; arc(RC, 0, Math.PI);
    }
    // Pi working: three short arcs, drawn once, no motion.
    if (st.pi) { ctx.strokeStyle = white(0.85); ctx.lineWidth = lw * 1.8; for (let j = 0; j < 3; j++) { const s0 = TOP + 0.35 + (j * TAU) / 3; arc(RP, s0, s0 + 0.9); } }
    // The particle ring: still at rest; turning, rippling with the microphone or pulsing with the voice otherwise.
    const moving = st.state === 'listen' || st.state === 'speak' || st.state === 'think';
    const bri = st.state === 'rest' || st.state === 'waiting' ? 0.5 : 0.95, env = st.level ?? 0;
    const th = (ORB.thick / 100) * RR, pulse = st.state === 'speak' ? 1 + env * 0.06 : 1;
    const rip = st.state === 'listen' ? env * th * 1.8 + th * 0.3 : 0, px = ORB.size, time = st.at ?? 0, img = sprite();
    ctx.globalCompositeOperation = 'lighter';
    for (let j = 0; j < N; j++) {
      const a = P.th[j] + (st.ang ?? 0) * P.sp[j];
      let r = (RR + P.ro[j] * th) * pulse;
      if (rip) r += rip * Math.sin(P.th[j] * 5 + time * 6 + P.ph[j] * 0.3);
      const al = bri * (0.6 + 0.4 * Math.sin(P.ph[j] + (moving ? time * (1.5 + P.sp[j]) : 0))), sz = px * P.sz[j];
      ctx.globalAlpha = al > 1 ? 1 : al;
      ctx.drawImage(img, cx + r * Math.cos(a) - sz * 2, cy + r * Math.sin(a) - sz * 2, sz * 4, sz * 4);
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    // The centre.
    if (st.state === 'think') {
      // One arc travelling round a dotted ring.
      const rr = w * 0.15;
      ctx.fillStyle = blue(0.8);
      for (let j = 0; j < 24; j++) { const a = (j / 24) * TAU; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, lw * 0.9, 0, TAU); ctx.fill(); }
      const a0 = TOP + time * 3.2;
      ctx.strokeStyle = blue(1); ctx.lineWidth = lw * 3; ctx.lineCap = 'round'; arc(rr, a0, a0 + Math.PI / 2); ctx.lineCap = 'butt';
      ctx.fillStyle = blue(1); ctx.beginPath(); ctx.arc(cx, cy, w * 0.014, 0, TAU); ctx.fill();
    } else if (st.state === 'speak') {
      // Bars that follow the voice.
      const hs = [0.35, 0.7, 1, 0.65, 0.3], bw = w * 0.032, step = w * 0.07, top = w * 0.17;
      ctx.strokeStyle = blue(1); ctx.lineWidth = bw; ctx.lineCap = 'round';
      for (let j = 0; j < 5; j++) {
        const wob = 0.55 + 0.45 * Math.abs(Math.sin(time * (5 + j * 1.7) + j)), h = Math.max(w * 0.02, top * hs[j] * (0.25 + 0.75 * env) * wob);
        const x = cx + (j - 2) * step;
        ctx.beginPath(); ctx.moveTo(x, cy - h); ctx.lineTo(x, cy + h); ctx.stroke();
      }
      ctx.lineCap = 'butt';
    } else if (st.state === 'waiting') {
      ctx.fillStyle = COL.amber; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `600 ${Math.round(w * 0.2)}px ${SANS}`;
      ctx.fillText(st.queued > 9 ? '9+' : String(st.queued), cx, cy + w * 0.01);
    } else {
      // At rest (and listening): the centre rings, still.
      const radii = [0.045, 0.085, 0.125, 0.165];
      for (let j = 0; j < radii.length; j++) {
        const rr = w * radii[j], gaps = j + 2;
        ctx.strokeStyle = j % 2 ? blue(0.5 + 0.45 * bri) : white(0.45 + 0.5 * bri); ctx.lineWidth = lw * (j === 0 ? 1.8 : 1.1);
        for (let g = 0; g < gaps; g++) { const a0 = (j % 2 ? -0.4 : 0.3) + (g * TAU) / gaps; arc(rr, a0, a0 + TAU / gaps - 0.32); }
      }
      ctx.fillStyle = blue(0.6 + 0.4 * bri); ctx.beginPath(); ctx.arc(cx, cy, w * 0.014, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  R.orb = { ORB, SIZE, FPS, COL, drawOrb, dialKey, dialNext };

  R.orbKit = (o) => ({
    id: o.id,
    label: o.label,
    bg: COL.ground,
    create(env) {
      const m = new R.Mover(env, { speed: 95, accel: 2.4 });
      const face = new R.Face(); // where it looks: the agent layer still keeps it, and the orb has no face to show it
      const sq = new R.Spring(170, 8); // a press's little squeeze
      let size = SIZE.default, form = 'default', userForm = 'default', lastEnv = null, t = 0;
      let stood = false, queued = 0, mark = '', pi = false, dial = null, hearing = false, level = 0, win = null;
      let ang = 0, at = 0, stateWas = '', drawnKey = '', dialTimer = 0;
      let pose = null;
      // Presence: 'shown' | 'hidden' | 'in' (appearing) | 'out' (going); u runs 0 → 1 over the change.
      const pres = { state: 'shown', u: 1 };
      const IN = 0.25, OUT = 0.22;
      const radius = () => (form === 'cursor' ? CURSOR_R : size * 0.49);
      const place = () => { m.radius = radius() * 1.02; };
      const teleport = (x, y) => { m.x = x; m.y = y; m.vx = m.vy = 0; m.tx = x; m.ty = y; m.mode = 'rest'; m.rest = 1.5; m.flung = false; m.dragging = false; m.stretch = 0; };
      const appear = (variant, x = m.x, y = m.y, instant = false) => {
        if (pres.state === 'shown' || pres.state === 'in') return false;
        const W = lastEnv?.w ?? 800, H = lastEnv?.h ?? 600, r = radius();
        x = clamp(x, r * 1.2, W - r * 1.2); y = clamp(y, r * 1.2, H - r * 1.2);
        teleport(x, y);
        Object.assign(pres, instant || lastEnv?.reduced ? { state: 'shown', u: 1 } : { state: 'in', u: 0 });
        return true;
      };
      const vanish = (variant, instant = false) => {
        if (instant) { Object.assign(pres, { state: 'hidden', u: 1 }); m.dragging = false; return true; }
        if (pres.state === 'hidden' || pres.state === 'out') return false;
        Object.assign(pres, lastEnv?.reduced ? { state: 'hidden', u: 1 } : { state: 'out', u: 0 });
        m.mode = 'rest'; m.vx = m.vy = 0; m.dragging = false; m.flung = false;
        return true;
      };
      // Blink: it goes dark, mid() moves it, and it comes back there (hopping between spots in another app).
      let bl = null;
      const blinkCut = () => { if (!bl) return; if (bl.dir === 'out') bl.mid?.(); const r = bl.res; bl = null; r(); };
      const blink = (mid) => new Promise((res) => { blinkCut(); bl = { dir: 'out', u: 0, mid, res }; if (lastEnv?.reduced || pres.state !== 'shown') blinkCut(); });
      // Morph between its size and the pen's reticle: it shrinks or grows around its centre.
      let mo = null;
      const swap = (f) => { form = f; place(); };
      const morph = (to) => new Promise((res) => {
        const f = to === 'cursor' ? 'cursor' : 'default';
        if (mo) { const r = mo.res; if (!mo.swapped) swap(mo.to); mo = null; r(); }
        if (f === form) { res(); return; }
        mo = { to: f, t: 0, res, swapped: false };
        if (lastEnv?.reduced || pres.state !== 'shown') { swap(f); mo = null; res(); }
      });
      const MORPH = 0.18;
      const scaleNow = () => {
        let s = 1;
        if (pres.state === 'in') s = 0.6 + 0.4 * pres.u;
        else if (pres.state === 'out') s = 1 - 0.4 * pres.u;
        if (mo) s *= mo.swapped ? 0.5 + 0.5 * clamp((mo.t - MORPH) / MORPH, 0, 1) : 1 - 0.5 * clamp(mo.t / MORPH, 0, 1);
        if (bl) s *= bl.dir === 'out' ? 1 - bl.u : bl.u;
        return s * (1 + sq.x * 0.01);
      };
      const alphaNow = () => (pres.state === 'in' ? pres.u : pres.state === 'out' ? 1 - pres.u : 1);
      const stateNow = () => {
        if (stood) return 'stood';
        const mode = pose?.mode;
        if (hearing || mode === 'listen') return 'listen';
        if (mode === 'talk') return 'speak';
        if (mode === 'think') return 'think';
        if (queued > 0) return 'waiting';
        return 'rest';
      };
      const moving = (s) => !lastEnv?.reduced && (s === 'listen' || s === 'speak' || s === 'think');
      const levelNow = (s) => (s === 'speak' ? (R.voiceOut?.playing() ? clamp(R.voiceOut.level() * 1.6, 0, 1) : 0.35) : s === 'listen' ? clamp(pose?.heard ?? level, 0, 1) : 0);
      // The dial is drawn again at its next key (every five minutes, or a block's start or end): the loop is woken then.
      const armDial = () => {
        clearTimeout(dialTimer); dialTimer = 0;
        const ms = dialNext(dial, Date.now());
        if (ms != null) dialTimer = setTimeout(() => { dialTimer = 0; R.wake?.(); armDial(); }, ms);
      };

      const kit = {
        o, m, face, sq,
        PAL: [[6, 9, 15], [16, 25, 34], [57, 67, 76], [98, 213, 248], [180, 194, 206], [242, 247, 251]], L: 5,
        S: () => {}, startAct: () => {}, stopAct: () => {}, busy: false,
        get P() { return 4; }, // the layout unit the bubbles are measured in (agent.js)
        get R() { return radius(); }, get t() { return t; },
        appear, vanish, blink, morph, teleport,
        get morphing() { return !!mo; },
        get presence() { return pres.state; }, get presU() { return pres.u; }, get form() { return form; },
        get userForm() { return userForm; },
        get look() { return 'orb'; },
        get spin() { return ang; }, set spin(v) { if (Number.isFinite(v)) ang = v; }, // a new page shows the particles where the old one had them
        get tip() { return [0, 0]; }, // the pen draws from its centre
        calmBody: () => pres.state === 'shown' && !bl && !mo && Math.abs(sq.x) < 0.04 && !m.dragging && !m.flung,
        sprite: () => null, // no native follower: the orb rests at its home
      };
      const plug = o.plugin ? o.plugin(kit) : null;

      const self = {
        mover: m, face, agent: plug?.api, appear, vanish,
        get hidden() { return pres.state === 'hidden' || pres.state === 'out'; },
        get gone() { return pres.state === 'hidden'; },
        hit: (x, y) => !!plug?.hit?.(x, y),
        press: (x, y) => plug?.press?.(x, y),
        wheel: (dy) => plug?.wheel?.(dy),
        // Only a small spot in the centre takes clicks (core.js), as agreed on 2026-11-17.
        get spot() { return form === 'cursor' ? CURSOR_R : size * 0.18; },
        get form() { return form; },
        get drawnAt() { return [m.x, m.y]; },
        setForm() { userForm = 'default'; if (!plug?.ghost?.()) swap('default'); },
        ghost: () => !!plug?.ghost?.(),
        morph,
        get look() { return 'orb'; },
        setStood(v) { stood = !!v; },
        get stood() { return stood; },
        setQueued(n) { queued = Math.max(0, Math.floor(Number(n) || 0)); },
        get queued() { return queued; },
        setMark(s) { mark = String(s ?? '').slice(0, 20); },
        get mark() { return mark; },
        // The orb's size on screen, in points (orb.size in settings.json).
        setSize(pt) { size = typeof pt === 'number' && Number.isFinite(pt) ? clamp(Math.round(pt), SIZE.min, SIZE.max) : SIZE.default; place(); },
        get size() { return size; },
        setPi(v) { pi = !!v; },
        // The microphone is open (the voice helper's listening, shown by the cursor on macOS), and its level.
        // w: the answer window that opened it ({ end, total } in the page's milliseconds), or none (a clap, the keys).
        setHearing(v, w = null) { hearing = !!v; win = hearing && w && w.total > 0 && Number.isFinite(w.end) ? { end: w.end, total: w.total } : null; if (!hearing) level = 0; },
        get window() { return win; },
        setLevel(v) { const x = Number(v); level = Number.isFinite(x) ? clamp(x, 0, 1) : 0; },
        get pi() { return pi; },
        // The working day and today's blocks, in minutes from midnight: { start, end, mine: [[s, e]], theirs: [[s, e]] }.
        setDial(d) {
          const ok = d && Number.isFinite(d.start) && Number.isFinite(d.end) && d.end > d.start;
          const list = (v) => (Array.isArray(v) ? v.filter((x) => Array.isArray(x) && Number.isFinite(x[0]) && Number.isFinite(x[1]) && x[1] > x[0]).slice(0, 48).map((x) => [x[0], x[1]]) : []);
          dial = ok ? { start: d.start, end: d.end, mine: list(d.mine), theirs: list(d.theirs) } : null;
          armDial();
        },
        get dial() { return dial; },
        get state() { return stateNow(); },
        // In a state that moves (listening, thinking, speaking): the frame loop mustn't stop (core.js).
        get animating() { return pres.state === 'shown' && moving(stateNow()); },
        resize(env) { lastEnv = env; place(); },
        boop() { sq.kick(11); },
        grab() {},
        tap() {},
        bonk() { sq.kick(16); },
        update(dt, env) {
          t += dt; lastEnv = env;
          if (pres.state === 'hidden') { blinkCut(); plug?.update?.(dt, env); return; }
          if (pres.state === 'in' || pres.state === 'out') {
            pres.u = Math.min(1, pres.u + dt / (pres.state === 'in' ? IN : OUT));
            if (pres.u >= 1) { pres.state = pres.state === 'in' ? 'shown' : 'hidden'; pres.u = 1; m.mode = 'rest'; m.rest = 1.5; }
          } else m.update(dt, env);
          if (mo) { mo.t += dt; if (!mo.swapped && mo.t >= MORPH) { mo.swapped = true; swap(mo.to); } if (mo.t >= MORPH * 2) { const r = mo.res; mo = null; r(); } }
          if (bl) { if (pres.state !== 'shown') blinkCut(); else { bl.u = Math.min(1, bl.u + dt / (bl.dir === 'out' ? 0.14 : 0.18)); if (bl.u >= 1) { if (bl.dir === 'out') { bl.mid?.(); bl.dir = 'in'; bl.u = 0; } else blinkCut(); } } }
          sq.update(dt);
          pose = m.dragging || pres.state === 'in' || pres.state === 'out' ? null : plug?.pose?.(dt, env) ?? null;
          const s = stateNow();
          if (s !== stateWas) { stateWas = s; at = 0; }
          if (moving(s)) { at += dt; ang += dt * (s === 'think' ? 0.5 : s === 'speak' ? 0.14 : 0.08) * (ORB.speed / 100) * 2; }
          face.update(dt, env, m.x, m.y, m);
          plug?.update?.(dt, env);
        },
        // The area it covers (css px), with a fingerprint of the picture: the same fingerprint, the same picture, so
        // the page isn't painted again (core.js). The moving states change it at most FPS times a second.
        prepare(env) {
          lastEnv = env;
          if (pres.state === 'hidden') return null;
          const s = stateNow(), r = radius() * 1.12, frame = moving(s) ? Math.floor(t * FPS) : -1;
          const busyBubbles = !!plug && !plug.quiet?.();
          let x0 = m.x - r, y0 = m.y - r, x1 = m.x + r, y1 = m.y + r + (mark && pres.state === 'shown' ? radius() * 0.5 : 0);
          const ext = plug?.extent?.();
          if (ext) { x0 = Math.min(x0, ext[0] - 20); y0 = Math.min(y0, ext[1] - 20); x1 = Math.max(x1, ext[2] + 20); y1 = Math.max(y1, ext[3] + 20); }
          if (plug?.wide?.()) { x0 = 0; y0 = 0; x1 = env.w; y1 = env.h; }
          const animating = pres.state !== 'shown' || !!mo || !!bl || Math.abs(sq.x) > 0.02 || m.speed > 0.5 || m.dragging;
          const key = [s, form, size, Math.round(m.x * 4), Math.round(m.y * 4), frame, s === 'stood' ? '' : dialKey(dial, Date.now()), queued, mark, pi ? 1 : 0].join(',');
          drawnKey = key;
          const sig = busyBubbles || animating ? NaN : hash(key);
          return { x0, y0, x1, y1, sig };
        },
        draw(ctx, env) {
          if (pres.state === 'hidden') return;
          const s = stateNow(), sc = scaleNow(), D = (form === 'cursor' ? CURSOR_R * 2 : size) * sc;
          const d = new Date(), now = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
          ctx.save();
          ctx.globalAlpha *= alphaNow();
          const left = s === 'listen' && win ? clamp((win.end - performance.now()) / win.total, 0, 1) : null;
          if (D > 1) drawOrb(ctx, m.x, m.y, D, { state: s, ang, at, level: levelNow(s), dial, now, queued, pi: pi && s !== 'stood', cursor: form === 'cursor', left });
          ctx.restore();
          plug?.over?.(ctx, env);
          // Feature 23: private mode's mark, under the orb, while it is on screen.
          if (mark && pres.state === 'shown' && form !== 'cursor') {
            const fs = 11, y = m.y + radius() + 12;
            ctx.save();
            ctx.font = `600 ${fs}px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const wd = ctx.measureText(mark.toUpperCase()).width + 14;
            ctx.fillStyle = COL.ground; ctx.fillRect(Math.round(m.x - wd / 2), Math.round(y - 9), Math.round(wd), 18);
            ctx.strokeStyle = COL.accent; ctx.lineWidth = 1; ctx.strokeRect(Math.round(m.x - wd / 2) + 0.5, Math.round(y - 9) + 0.5, Math.round(wd) - 1, 17);
            ctx.fillStyle = COL.accent; ctx.fillText(mark.toUpperCase(), m.x, y + 0.5);
            ctx.restore();
          }
        },
      };
      return self;
    },
  });
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

  R.register(R.orbKit({ id: 'sidekick', label: 'Jarvis', plugin: (kit) => R.agentPlugin?.(kit) ?? null }));
})();
