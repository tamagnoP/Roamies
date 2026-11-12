// Local-only build: the never-look list. Apps named in "neverLook" in ~/Documents/roamies-pi/settings.json (password
// managers and Messages, unless the list says otherwise) are never captured, read or worked:
//   - a screenshot or a read of that app, or of the front window when that app is in front, is refused;
//   - a whole-screen screenshot is refused while any such app has a window open, since it could be in the picture;
//   - list_windows leaves those windows out, and the "what's in front" line sent with each request hides them.
// It fails closed: if the open windows can't be listed, nothing is captured.
import os from 'node:os';
import { loadSettings } from './pi.mjs';

export const DEFAULT_NEVER_LOOK = ['1Password', 'Bitwarden', 'KeePassXC', 'Keychain Access', 'Passwords', 'Messages'];

export function createGuard({ home = os.homedir(), windows }) {
  const names = () => { try { return loadSettings(home).neverLook.map((n) => n.toLowerCase()); } catch { return DEFAULT_NEVER_LOOK.map((n) => n.toLowerCase()); } };
  const hit = (app, list) => { const a = String(app ?? '').toLowerCase().trim(); return a ? list.find((n) => a === n || a.includes(n) || (a.length > 3 && n.includes(a))) : undefined; };
  const no = (what) => new Error(`${what} is on the never-look list, so I can't look at it or work in it. Say so in a few words; don't try another way to see it.`);

  /** Throws unless looking at `target` is allowed right now. */
  async function check(target) {
    const list = names();
    if (!list.length) return;
    const t = String(target || 'screen').trim().toLowerCase();
    let wins;
    try { wins = await windows(); } catch (e) { throw new Error(`I couldn't check which apps are open (${e.message}), so I didn't look. The never-look list needs that check.`); }
    wins = Array.isArray(wins) ? wins : [];
    if (t === 'front') { const f = wins.find((w) => w.frontApp) ?? wins[0]; if (f && hit(f.app, list)) throw no(f.app); return; }
    if (t.startsWith('window:')) { const w = wins.find((x) => `window:${x.id}` === t); if (w && hit(w.app, list)) throw no(w.app); return; }
    if (t === 'screen' || t.startsWith('display')) {
      const open = wins.find((w) => hit(w.app, list));
      if (open) throw new Error(`${open.app} is open and on the never-look list, so I won't take a picture of the whole screen. I can look at one window instead (the one in front, or an app by name) if that isn't it.`);
      return;
    }
    if (hit(t, list)) throw no(target);
  }

  /** The screen tools with the check in front of them. Other tools pass through untouched. */
  function wrap(tools) {
    return tools.map((t) => {
      if (t.name === 'take_screenshot') return { ...t, execute: async (a, ...r) => { await check(a?.target || 'screen'); return t.execute(a, ...r); } };
      if (t.name === 'read_window' || t.name === 'act_in_app') return { ...t, execute: async (a, ...r) => { await check(a?.target || 'front'); return t.execute(a, ...r); } };
      if (t.name === 'list_windows') {
        return { ...t, execute: async (...a) => {
          const out = String(await t.execute(...a)), list = names();
          if (!list.length) return out;
          // Each line is "window:<id>  <app> — <title>": the app is what's checked, so a title can't hide or unhide a window.
          const lines = out.split('\n'), kept = lines.filter((l) => !hit(l.replace(/^window:\S+\s+/, '').split(' — ')[0].replace(/\s+\(frontmost app\)$/, ''), list));
          return kept.length === lines.length ? out : `${kept.join('\n') || 'No other windows open.'}\n(${lines.length - kept.length} window${lines.length - kept.length === 1 ? '' : 's'} left out: on the never-look list.)`;
        } };
      }
      return t;
    });
  }

  /** The "what's in front" line for the model: hidden when it names an app on the list. */
  const front = (line) => { const l = String(line ?? ''), low = l.toLowerCase(); return l && names().some((n) => low.includes(n)) ? 'In front: an app on the never-look list (its name and window are hidden).' : l; };

  return { check, wrap, front };
}
