// Local-only build (feature 24, fix 6): numbers around a page rebuild, while the "measurePageRebuild" setting is on.
// The shell starts it: in a new page from its first line (window.ROAMIE_MEASURE, milliseconds), in the old one and
// again after the old windows have gone with __roamieMeasure (host.js). Rows are [time, event, ...numbers or words],
// the time in milliseconds since 1970 (the shell's rows use the same clock), and go to the sidecar every 100 ms, which
// logs them as rebuild_measure. Nothing else is measured, kept or sent; with the setting off this does nothing.
//   start: the page's size, its place on the screen, the screen's scale and edges, whether its frame loop is stopped
//   at: where the character is drawn now, and how it is shown (the old page, whose frame loop is stopped)
//   frame: every frame: where the character is drawn (x, y), whether the canvas was painted, how it is shown
//   home: the home spot changed: from (x, y) to (x, y), and what changed (agent.js)
//   place: the character put straight onto a spot: (x, y) and why (settle, at_once)
//   msg: a message from the shell (its kind only); safe: the screen's edges as the shell gives them; resize: the page
//   drawn: the page reported the character drawn at (x, y)
(() => {
  const R = (window.Roamie ??= {});
  const origin = Number.isFinite(performance.timeOrigin) ? performance.timeOrigin : Date.now() - performance.now();
  const clock = () => origin + performance.now();
  let until = 0, rows = [], timer = 0;
  const on = () => until > 0 && clock() < until;
  const flush = () => {
    if (rows.length && R.measure.send) R.measure.send({ type: 'measure', src: 'page', label: typeof window.ROAMIE_LABEL === 'string' ? window.ROAMIE_LABEL : '', rows: rows.splice(0) });
    if (!on() && timer) { clearInterval(timer); timer = 0; flush(); }
  };
  const shown = (c) => (c ? c.agent?.presence ?? (c.hidden ? 'hidden' : 'shown') : 'none');
  const agent = () => R.tiles?.find((t) => t.creature.agent)?.creature;
  R.measure = {
    send: null,
    get on() { return on(); },
    row(ev, ...v) { if (on()) rows.push([clock(), ev, ...v]); },
    /** Measures for ms milliseconds from now (or longer, if it already was). */
    start(ms) {
      const first = !on();
      until = Math.max(until, clock() + Math.max(0, +ms || 0));
      if (!timer) timer = setInterval(flush, 100);
      if (!first) return;
      const s = R.safe ?? {};
      this.row('start', innerWidth, innerHeight, window.screenX ?? null, window.screenY ?? null, devicePixelRatio || 1, s.top ?? null, s.left ?? null, s.bottom ?? null, s.right ?? null, R.rested?.() ? 1 : 0);
      const c = agent();
      if (c) this.row('at', c.drawnAt?.[0] ?? c.mover.x, c.drawnAt?.[1] ?? c.mover.y, shown(c));
    },
  };
  // every frame the page runs (core.js)
  (R.frameHooks ??= []).push((f) => { if (on()) rows.push([clock(), 'frame', f.at?.[0] ?? null, f.at?.[1] ?? null, f.drew ? 1 : 0, f.presence ?? 'none']); });
  addEventListener('resize', () => R.measure.row('resize', innerWidth, innerHeight));
  if (window.ROAMIE_MEASURE) R.measure.start(+window.ROAMIE_MEASURE);
})();
