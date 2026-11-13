// Local-only build: the character's home on the desktop. In its default and small sizes it rests at one fixed spot
// (the "home" setting in ~/Documents/roamies-pi/settings.json) instead of popping up beside the pointer; agent.js asks
// here where that spot is. Only the rule lives in this file, so it can be tested without a screen (home.test.mjs).
(() => {
  const R = (window.Roamie ??= {});
  const CORNERS = ['bottom-left', 'bottom-right', 'top-left', 'top-right'];
  // How far the body's centre keeps from each edge of the visible screen, in body radii. Corners: room for its
  // hands, ears and glow. EDGE: the closest a home given as coordinates may come (the body stays whole).
  const CORNER = { side: 2.4, top: 2.4, bottom: 1.9 }, EDGE = { side: 1.6, top: 1.8, bottom: 1.5 };
  const num = (v) => typeof v === 'number' && Number.isFinite(v);

  /** The setting as written, made safe: one of the four corners, or { x, y } in screen points. Anything else is
   *  the default, "bottom-left". */
  R.homeSetting = (v) => {
    if (typeof v === 'string' && CORNERS.includes(v.trim().toLowerCase())) return v.trim().toLowerCase();
    if (v && typeof v === 'object' && num(v.x) && num(v.y)) return { x: v.x, y: v.y };
    return CORNERS[0];
  };

  /** Where the body's centre rests, [x, y] in overlay px.
   *  bounds: the visible screen in overlay px, { l, t, r, b }, already less the menu bar and the Dock.
   *  r: the body's radius. origin: the overlay's top-left corner in screen points (coordinates are given in those).
   *  A corner sits a little in from both edges. Coordinates are kept whole on the visible screen of the display the
   *  overlay is on: a point under the Dock, under the menu bar or on another display lands at the nearest spot. */
  R.homeSpot = (setting, bounds, r, origin = { x: 0, y: 0 }) => {
    const s = R.homeSetting(setting), mid = [(bounds.l + bounds.r) / 2, (bounds.t + bounds.b) / 2];
    const within = (v, lo, hi, fallback) => (lo > hi ? fallback : Math.min(hi, Math.max(lo, v)));
    if (typeof s === 'string') {
      const x = s.endsWith('left') ? bounds.l + r * CORNER.side : bounds.r - r * CORNER.side;
      const y = s.startsWith('top') ? bounds.t + r * CORNER.top : bounds.b - r * CORNER.bottom;
      return [within(x, bounds.l + r * EDGE.side, bounds.r - r * EDGE.side, mid[0]), within(y, bounds.t + r * EDGE.top, bounds.b - r * EDGE.bottom, mid[1])];
    }
    return [within(s.x - (origin?.x || 0), bounds.l + r * EDGE.side, bounds.r - r * EDGE.side, mid[0]), within(s.y - (origin?.y || 0), bounds.t + r * EDGE.top, bounds.b - r * EDGE.bottom, mid[1])];
  };
})();
