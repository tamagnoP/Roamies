// The instrument style (feature 21, DESIGN-SPEC.md) shared by the orb's own UI (bubbles, the thinking tag, task tags,
// the step list) and the drawings' cards (ink.js): near-black panels, a thin line, square corners with short accent
// corner marks, one ice blue, amber for a warning, the system's own fonts (nothing is downloaded).
(() => {
  const R = window.Roamie;
  if (!R || typeof document === 'undefined') return;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ACC = '#62D5F8', HOT = '#F2F7FB', MID = '#3FA9CC', DEEP = '#1B4A5C', EDGE = 'rgba(6,9,15,0.7)';
  const GLASS = 'rgba(6,9,15,0.97)', TEXT = '#F2F7FB', DIM = '#B4C2CE', CORAL = '#FF8A7A', NOTE = '#F7C078', AMBER = '#F7C078', LINE = '#39434C', STOOD = '#6B7B88';
  const MONO = 'ui-monospace, "SF Mono", Menlo, monospace', SANS = '-apple-system, system-ui, "Segoe UI", sans-serif';
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const rgba = (h, a) => `rgba(${hex(h).join(',')},${a})`;

  // A panel: near-black, a thin line, square corners, short marks at each corner in the accent (o.edge: another
  // colour, a task that failed). o.tail is not drawn: the instrument's bubbles sit beside the orb.
  function chrome(c, x, y, w, h, o = {}) {
    const edge = o.edge || ACC, k = Math.min(14, w / 3, h / 3);
    c.save();
    c.fillStyle = GLASS; c.shadowColor = 'rgba(0,0,0,0.35)'; c.shadowBlur = 12; c.shadowOffsetY = 3;
    if (o.path) c.fill(o.path); else c.fillRect(x, y, w, h);
    c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetY = 0;
    c.strokeStyle = LINE; c.lineWidth = 1;
    if (o.path) c.stroke(o.path); else c.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
    if (!o.path && w > 20 && h > 16) {
      c.strokeStyle = edge; c.lineWidth = 2; c.lineCap = 'butt';
      const X = Math.round(x), Y = Math.round(y), R2 = Math.round(x + w), B = Math.round(y + h);
      c.beginPath();
      c.moveTo(X + 1, Y + k); c.lineTo(X + 1, Y + 1); c.lineTo(X + k, Y + 1);
      c.moveTo(R2 - k, Y + 1); c.lineTo(R2 - 1, Y + 1); c.lineTo(R2 - 1, Y + k);
      c.moveTo(X + 1, B - k); c.lineTo(X + 1, B - 1); c.lineTo(X + k, B - 1);
      c.moveTo(R2 - k, B - 1); c.lineTo(R2 - 1, B - 1); c.lineTo(R2 - 1, B - k);
      c.stroke();
    }
    c.restore();
  }

  const meas = document.createElement('canvas').getContext('2d');
  const textW = (s, font) => { meas.font = font; return meas.measureText(String(s ?? '')).width; };
  // Words typing themselves in; the last couple land white. Returns the full width.
  function typed(c, str, x, y, font, color, u = 1, o = {}) {
    str = String(str ?? '');
    c.save(); c.font = font; c.textBaseline = o.baseline || 'middle'; c.textAlign = 'left';
    const full = c.measureText(str).width, x0 = o.anchor === 'middle' ? x - full / 2 : o.anchor === 'end' ? x - full : x;
    const n = Math.floor(str.length * clamp(u, 0, 1));
    if (n >= str.length) { c.fillStyle = color; c.fillText(str, x0, y); }
    else if (n > 0) { const head = str.slice(0, Math.max(0, n - 2)); c.fillStyle = color; c.fillText(head, x0, y); c.fillStyle = '#ffffff'; c.fillText(str.slice(head.length, n), x0 + c.measureText(head).width, y); }
    c.restore();
    return full;
  }
  // Lines of at most w px (a word wider than a line is broken); past max rows the last one ends in an ellipsis.
  function wrapRows(str, w, font, max = Infinity) {
    meas.font = font;
    const fits = (t) => meas.measureText(t).width <= w, rows = [];
    for (const para of String(str ?? '').split('\n')) {
      let row = '';
      for (let wd of para.split(/\s+/).filter(Boolean)) {
        const tr = row ? `${row} ${wd}` : wd;
        if (fits(tr)) { row = tr; continue; }
        if (row) { rows.push(row); row = ''; }
        while (!fits(wd)) { let k = wd.length - 1; while (k > 1 && !fits(wd.slice(0, k))) k--; rows.push(wd.slice(0, k)); wd = wd.slice(k); }
        row = wd;
      }
      rows.push(row);
    }
    if (rows.length > max) {
      const rest = rows.splice(max), full = `${rows[max - 1]} ${rest.join(' ')}`;
      let last = full;
      while (last && !fits(`${last}…`)) last = last.slice(0, -1);
      // End on a whole word when one is close, rather than mid-word.
      const sp = last.lastIndexOf(' ');
      if (full[last.length] !== ' ' && sp > last.length * 0.6) last = last.slice(0, sp);
      rows[max - 1] = `${last.trimEnd()}…`;
    }
    return rows;
  }
  // A hand-drawn ring: a slightly wobbly circle that overshoots where it closes, the same each time for one seed.
  const ringPts = (cx, cy, r, seed = 0) => Array.from({ length: 34 }, (_, i) => {
    const a = -2.2 + (i / 30) * Math.PI * 2, k = 1 + 0.06 * Math.sin(i * 1.7 + seed) + (i > 28 ? 0.08 : 0);
    return [cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k];
  });
  // The pen's stroke (a dark edge so it reads on white, then the colour with a soft glow), drawn up to u of its length.
  function pen(c, pts, color, w = 2.2, u = 1) {
    const n = Math.max(2, Math.ceil(pts.length * clamp(u, 0, 1)));
    if (u <= 0) return;
    const path = new Path2D(); pts.slice(0, n).forEach((q, i) => (i ? path.lineTo(q[0], q[1]) : path.moveTo(q[0], q[1])));
    c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
    c.strokeStyle = EDGE; c.lineWidth = w + 2; c.stroke(path);
    c.shadowColor = rgba(color, 0.7); c.shadowBlur = 6; c.strokeStyle = color; c.lineWidth = w; c.stroke(path);
    c.restore();
  }

  // A button as on the artboards: the first is filled in the accent with dark ink, the others are outlined in grey with
  // light ink; square corners, at least 44 points high. focus: a ring in the accent; down: pressed in a little.
  const CHIP_F = `600 15px ${SANS}`, CHIP_F2 = `500 15px ${SANS}`, INK_DARK = '#04121C';
  const chipW = (label) => Math.round(textW(label, CHIP_F) + 40);
  function chip(c, x, y, w, h, label, o = {}) {
    c.save();
    if (o.focus) { c.strokeStyle = ACC; c.lineWidth = 2; c.strokeRect(x - 3, y - 3, w + 6, h + 6); }
    if (o.down) c.translate(0, 1);
    if (o.filled) { c.fillStyle = o.hover ? '#8FE2FA' : ACC; c.fillRect(x, y, w, h); }
    else {
      c.fillStyle = o.hover ? 'rgba(98,213,248,0.10)' : 'transparent'; c.fillRect(x, y, w, h);
      c.strokeStyle = STOOD; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
    c.font = o.filled ? CHIP_F : CHIP_F2; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = o.filled ? INK_DARK : TEXT;
    c.fillText(String(label ?? ''), x + w / 2, y + h / 2 + 0.5);
    c.restore();
  }

  R.glass = { ACC, HOT, MID, DEEP, EDGE, GLASS, TEXT, DIM, CORAL, NOTE, AMBER, LINE, STOOD, MONO, SANS, rgba, chrome, textW, typed, wrapRows, ringPts, pen, chip, chipW, CHIP_H: 44 };
})();
