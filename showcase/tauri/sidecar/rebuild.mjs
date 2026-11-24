// Local-only build (feature 24, fix 6): the overlay page is rebuilt after a quiet stretch. WebKit keeps memory the
// page has finished with until the system asks for it back, and the page has no way to ask; a new page starts at
// about 72 MB. Code decides when; the model is never asked.
//
// The page is rebuilt only when all of these hold, and have held for "limits.pageRebuildQuietMinutes" (0: never):
// the character is at rest at its home and not where it was dragged, nothing is on screen, nothing is being said or
// heard, no question is on screen or waiting in an answer window (the page reports the first three, quiet() the
// rest; a question kept in state.json does not count); and something was shown or spoken since the last rebuild.
// While the new page is made, the shell holds what goes to the overlay and hands it over once the new page has its
// settings; the sidecar answers the new page without a greeting.

/** minutes: → the setting. quiet: → whether the sidecar has nothing going on and no question pending. rebuild: asks
 *  the shell for a new page. timeoutMs: how long a new page has to report ready before the rebuild counts as over. */
export function createPageRebuild({ minutes, quiet, rebuild, log = () => {}, now = () => Date.now(), timeoutMs = 15_000 }) {
  let rest = null; // what the page last said of itself: { keep } while it is at rest, null otherwise
  let since = null; // when the quiet stretch began: the page came to rest, or something was last shown
  let shown = false; // something was shown or spoken since the last rebuild (or since start-up)
  let asked = null; // a rebuild under way: { at, keep }
  const broken = () => { since = null; };
  return {
    /** Something was shown or spoken on the page (not one of its settings). */
    shown() { shown = true; since = now(); },
    /** The page says whether it is at rest at home with nothing on it; keep: what the new page takes over from it. */
    page(on, keep = null) {
      if (on) { if (!rest) since = now(); rest = { keep: keep && typeof keep === 'object' ? keep : null }; } else { rest = null; broken(); }
    },
    /** Checked on a timer. → true when a rebuild was asked for now. */
    tick() {
      if (asked) { if (now() - asked.at > timeoutMs) { log('page_rebuild_late', { ms: now() - asked.at }); asked = null; } return false; }
      let n = 0;
      try { n = minutes(); } catch { n = 0; }
      if (!n || !rest || !quiet()) { broken(); return false; }
      since ??= now();
      if (!shown || now() - since < n * 60_000) return false;
      asked = { at: now(), keep: rest.keep };
      shown = false; rest = null; since = null;
      log('page_rebuild', { quietMinutes: n });
      rebuild();
      return true;
    },
    /** A rebuild is under way: the next page to report ready is the new one. */
    rebuilding: () => !!asked,
    /** The new page reported ready. → what it takes over from the old one ({} when nothing), or null when no rebuild
     *  was under way (an ordinary start, which is greeted). */
    ready() {
      if (!asked) return null;
      const { at, keep } = asked;
      asked = null;
      log('page_rebuilt', { ms: now() - at });
      return keep ?? {};
    },
  };
}
