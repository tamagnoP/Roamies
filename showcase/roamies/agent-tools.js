// How long each tool call's task tag plays (agent.js shows what it's doing on the tag under the orb). Feature 21:
// the orb has no face, hands or sounds, so a tool call only times its tag; the orb shows "thinking" meanwhile. The
// agent layer runs them via agent.tool().
(() => {
  const R = window.Roamie;
  const T = (R.agentTools = {});
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const thinking = () => ({ mode: 'think' });

  // Looking at the screen (a screenshot): just the tag while the shot is taken. It stays up a moment so it can be read.
  T.look = {
    variants: ['screen', 'window'], label: 'looking at your screen',
    update(st) { if (st.age > 0.5 && !st.status) st.finish(true); },
    pose: thinking,
  };

  // A screenshot: in live mode a window shot waits until the real window is located (or a few seconds pass).
  const SHOT = { aim: 0.62, scan: 0.62, after: 1.0 };
  T.screenshot = {
    variants: ['screen', 'region', 'window'], label: 'screenshot',
    start(st) { st.d.aimAt = st.live && st.variant === 'window' && !st.target ? Infinity : 0.12; },
    retarget(st) { if (st.d.aimAt === Infinity) st.d.aimAt = st.age; },
    update(st) {
      const d = st.d;
      if (d.aimAt === Infinity) { if (st.age > 4 || (st.image && st.age > 1.2)) d.aimAt = st.age; return; }
      if (!d.snapped && st.age - d.aimAt >= SHOT.aim + SHOT.scan) d.snapped = st.age;
      if (d.snapped && st.age - d.snapped > SHOT.after) st.finish(true);
    },
    pose: thinking,
  };

  // Reading: a file, many files (a page each), or a search that finds its match.
  T.read = {
    variants: ['file', 'many', 'search'], label: 'read',
    start(st) { st.d.page = 0; st.d.pages = st.variant === 'many' ? 3 + Math.floor(hash(st.seed) * 3) : 1; },
    update(st) {
      const d = st.d;
      if (st.variant === 'search') { d.found = d.found ?? 1.6 + hash(st.seed) * 0.8; if (st.age > d.found + 1) st.finish(true); return; }
      const per = st.variant === 'many' ? 1.25 : 2.6, p = Math.floor(st.age / per);
      if (p !== d.page) { if (p >= d.pages) { st.finish(true); return; } d.page = p; }
    },
    pose: thinking,
  };

  // Writing: an edit, a new file, or a deletion.
  T.write = {
    variants: ['edit', 'create', 'delete'], label: 'write',
    start(st) { st.d.lines = 6; },
    update(st) {
      if (st.variant === 'delete' || st.variant === 'crumble') { if (st.age > 2.2) st.finish(true); return; }
      const t0 = st.variant === 'create' ? 0.7 : 0.2;
      if (Math.floor(Math.max(0, st.age - t0) / 0.42) >= st.d.lines + 1) st.finish(true);
    },
    pose: thinking,
  };

  // Running a command: it ends well or not.
  T.run = {
    variants: ['ok', 'progress', 'fail'], label: 'run',
    update(st) {
      const outT = st.age - 0.9, total = st.variant === 'progress' ? 2.6 : 1.8;
      if (st.age >= 0.9 && outT > total && !st.status) st.finish(st.variant !== 'fail');
    },
    pose: thinking,
  };

  // The web: a search or a fetched page.
  T.web = {
    variants: ['search', 'fetch'], label: 'web',
    update(st) { if (st.age > (st.variant === 'fetch' ? 2.9 : 2.4)) st.finish(true); },
    pose: thinking,
  };
})();
