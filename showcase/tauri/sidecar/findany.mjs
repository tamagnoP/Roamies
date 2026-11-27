// Local-only build, feature 40: find a file anywhere and show its folder (the owner's plan and answers of 2026-11-27).
//
// "Where is budget.xlsx?", "find the file budget", "which folder is the poster in?": decided and answered by code
// alone, on either route. No model is asked, and no file name or path goes to any model. What is fixed here:
//   - The sentence (findAsk). "Where is <name>?" is a file search only when the name looks like a file or a folder
//     (an extension, or a type word: file, folder, document, PDF and the like); "find the file …" and "which folder
//     is … in?" always are. Anything else goes the usual way.
//   - The search: Spotlight, by name only, through the hands helper (roamies-hands find, started per command, as every
//     hands command is), in the home folder and on the local external drives. Contents are never read.
//   - Left out (leftOut): ~/Library (iCloud Drive and the cloud folders with it), hidden parts (the Trash with them),
//     the sandbox's blocked list, Roamies' own folders, the notes vault, what safety.mjs never reads (keys, .env…),
//     apps, the insides of packages, Time Machine backups, network drives, SKIPPED_FOLDERS and "findLeaveOut".
//   - Ranked (rank): how the name matches his words, then the last opened, the last changed, the fewest folders deep,
//     and a project folder before elsewhere.
//   - The card shows at most limits.findMatches; what is said is the count and the first one or two names only.
//   - His pick (pickRow): by voice in the answer window, or a click on the card until it closes or the next request.
//     The picked file is shown in Finder, selected (roamies-hands reveal); nothing is opened.
//   - The log gets counts only: never what he said, a name or a folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NO_WORDS, YES_WORDS, only, plainNum, unfilled } from './answers.mjs';
import { SKIPPED_FOLDERS } from './files.mjs';
import { blockedPaths, loadSettings } from './pi.mjs';
import { checkRead } from './safety.mjs';

// Words that make "where is …" about a file or a folder, each with what it narrows the search to (the owner: "file,
// folder, document, PDF and the like"). A type word alone is no name: "where are my photos?" goes the usual way.
const SHEETS = ['xlsx', 'xls', 'numbers', 'csv', 'tsv', 'ods'], SLIDES = ['key', 'pptx', 'ppt', 'odp'];
const PICTURES = ['jpg', 'jpeg', 'png', 'heic', 'gif', 'tif', 'tiff', 'webp', 'bmp', 'svg', 'raw', 'dng'];
const VIDEOS = ['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm'], SOUNDS = ['m4a', 'wav', 'mp3', 'aiff', 'aif', 'flac'];
export const TYPE_WORDS = {
  file: { files: true }, files: { files: true }, document: { files: true }, documents: { files: true }, doc: { files: true }, docs: { files: true },
  folder: { folders: true }, folders: { folders: true }, directory: { folders: true }, directories: { folders: true },
  pdf: { exts: ['pdf'] }, pdfs: { exts: ['pdf'] },
  spreadsheet: { exts: SHEETS }, spreadsheets: { exts: SHEETS },
  presentation: { exts: SLIDES }, presentations: { exts: SLIDES }, slides: { exts: SLIDES }, deck: { exts: SLIDES },
  image: { exts: PICTURES }, images: { exts: PICTURES }, photo: { exts: PICTURES }, photos: { exts: PICTURES }, picture: { exts: PICTURES }, pictures: { exts: PICTURES }, screenshot: { exts: PICTURES }, screenshots: { exts: PICTURES },
  video: { exts: VIDEOS }, videos: { exts: VIDEOS }, recording: { exts: [...VIDEOS, ...SOUNDS] }, recordings: { exts: [...VIDEOS, ...SOUNDS] },
  script: { exts: ['py', 'sh', 'js', 'mjs', 'ts', 'r', 'm', 'jl', 'rb', 'pl', 'swift', 'rs'] }, scripts: { exts: ['py', 'sh', 'js', 'mjs', 'ts', 'r', 'm', 'jl', 'rb', 'pl', 'swift', 'rs'] },
  notebook: { exts: ['ipynb'] }, notebooks: { exts: ['ipynb'] },
  archive: { exts: ['zip', 'tar', 'gz', 'tgz', '7z', 'rar'] }, zip: { exts: ['zip'] },
};
// Words of the name that aren't searched for ("the config file for the pipeline": config, pipeline).
export const FIND_SMALL_WORDS = ['the', 'a', 'an', 'my', 'our', 'his', 'her', 'their', 'your', 'this', 'that', 'these', 'those', 'of', 'for', 'in', 'on', 'at', 'to', 'from', 'with', 'and', 'about', 'called', 'named', 'i', 'me', 'it'];
const SMALL = new Set(FIND_SMALL_WORDS);
// Said around a request, never part of it: the filler words (answers.mjs) and these.
const AROUND = new Set(['and', 'um', 'uh', 'now', 'so', 'well', 'just', 'please', 'then', 'sir', 'jarvis', 'roamies', 'hey', 'ok', 'okay', 'oh']);
const ASKING = ['can you', 'could you', 'would you', 'will you', 'can you please', 'could you please', 'do you know', 'tell me'];
// The frames. WHERE needs a name that looks like a file or a folder; FIND needs a type word or an extension; WHICH
// is always a search.
const WHERE = /^(?:where(?:'s| is| are| was| were)|where did i (?:put|save|leave|keep)|where have i (?:put|saved|left|kept)|where can i find|where do i (?:keep|have)) (.+)$/;
const FIND = /^find (?:me )?(.+)$/;
const WHICH = /^(?:in )?(?:which|what) (?:folder|directory) (?:is|are|was|has|holds|contains|did i (?:put|save)) (.+?)(?: (?:in|kept in|saved in|stored in))?$/;
// Package folders whose insides are never listed (the package itself can be): apps, libraries, bundles.
const PACKAGE = /\.(app|appex|bundle|framework|plugin|kext|xpc|photoslibrary|musiclibrary|tvlibrary|imovielibrary|fcpbundle|lrlibrary|lrdata|logicx|band|sparsebundle|xcarchive|xcodeproj|xcworkspace|rtfd|pages|numbers|key|docset|qlgenerator|prefpane|saver|component|vst3?|aaxplugin)$/i;
// Time Machine's folders: old copies of every file.
const BACKUP = /^(Backups\.backupdb|.+\.(backup|previous|interrupted|inprogress))$/i;
const SKIPPED = new Set(SKIPPED_FOLDERS);
export const LEFT_OUT_REASONS = ['place', 'library', 'hidden', 'app', 'package', 'backup', 'skipped', 'blocked', 'own', 'vault', 'yours', 'secret'];

const inside = (p, dir) => !!dir && (p === dir || p.startsWith(dir.endsWith('/') ? dir : `${dir}/`));
const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
/** A Keynote presentation: its name ends in .key like a key file's, and Spotlight's kind says which it is. */
const isKeynote = (item) => /\.key$/i.test(String(item?.path ?? '')) && /keynote/i.test(String(item?.type ?? ''));
const extOf = (name) => (/(.)\.([^.\s/]{1,10})$/.exec(name)?.[2] ?? '').toLowerCase();
const stemOf = (name) => name.replace(/(.)\.[^.\s/]{1,10}$/, '$1');

/** The words of a name: split at separators, capitals and digits, lower case, the small words aside. */
export function nameWords(s) {
  const split = String(s ?? '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2').replace(/(\d)([A-Za-z])/g, '$1 $2');
  return split.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/['’]/g, '').split(/[^\p{L}\p{N}]+/u).filter((w) => w && !SMALL.has(w));
}

/** His sentence with what stands around a request taken off its ends (the filler words, the persona's name, "can you"),
 *  the dots, dashes and underscores of a name kept. */
function sentence(text, persona = '') {
  let t = String(text ?? '').toLowerCase().replace(/[’‘`]/g, '\'').replace(/[?!,;:"“”()]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  const name = plainNum(persona);
  const around = (w) => AROUND.has(w) || (name && w === name);
  for (let again = true; again;) {
    again = false;
    let w = t.split(' ');
    while (w.length && around(w[0].replace(/[.]$/, ''))) { w.shift(); again = true; }
    while (w.length && around(w.at(-1))) { w.pop(); again = true; }
    t = w.join(' ');
    for (const a of [...ASKING].sort((x, y) => y.length - x.length)) if (t.startsWith(`${a} `)) { t = t.slice(a.length + 1); again = true; break; }
    if (t.endsWith(' for me')) { t = t.slice(0, -7); again = true; }
  }
  return t.trim();
}

/** The name in the frame's slot: its words, its extension, the type words in it. → { said, words, spot, ext, types } */
function slotName(slot) {
  const toks = slot.replace(/ dot (?=[a-z0-9]{1,6}(?: |$))/g, '.').split(' ').filter(Boolean);
  const kept = [], types = [];
  let ext = '';
  for (let t of toks) {
    t = t.replace(/'s$/, '').replace(/'/g, '');
    if (TYPE_WORDS[t]) { types.push(t); continue; }
    if (SMALL.has(t) || !t) continue;
    const e = /^(.+)\.([a-z0-9]{1,6})$/.exec(t);
    if (e && !ext && /[a-z]/.test(e[2])) ext = e[2];
    kept.push(t);
  }
  const said = kept.join(' '), bare = ext ? said.replace(new RegExp(`\\.${ext}(?= |$)`), '') : said;
  // What Spotlight is asked for: his words as he split them ("v1.2 data": v1, 2, data), each in the name somewhere.
  const spot = [...new Set(bare.normalize('NFD').replace(/\p{M}/gu, '').split(/[^\p{L}\p{N}]+/u).filter((w) => w && !SMALL.has(w)))];
  return { said, words: nameWords(bare), spot, ext, types };
}

/** What a sentence asks for, when it is a search for a file or a folder by name; else null (the usual way).
 *  → { said, words, ext, types, filter: { files, folders, exts } } (words may be empty: "find the file" asks which) */
export function findAsk(text, { persona = '' } = {}) {
  const t = sentence(text, persona);
  let m, always = false;
  if ((m = WHICH.exec(t))) always = true;
  else if (!(m = WHERE.exec(t)) && !(m = FIND.exec(t))) return null;
  const q = slotName(m[1]);
  if (!always && !q.ext && !q.types.length) return null;
  if (!always && WHERE.test(t) && !q.words.length) return null; // "where are my photos?": a type word alone is no name
  const filter = { files: false, folders: false, exts: null };
  for (const w of q.types) { const f = TYPE_WORDS[w]; if (f.files) filter.files = true; if (f.folders) filter.folders = true; if (f.exts) filter.exts = [...(filter.exts ?? []), ...f.exts]; }
  if (filter.files && filter.folders) filter.files = filter.folders = false; // "the file in the thesis folder": either
  return { ...q, filter };
}

/** Why an item from Spotlight must not be shown, or '' when it may. item: { path, kind, type }; ctx from places(). */
export function leftOut(item, ctx) {
  const p = String(item?.path ?? '');
  const drive = ctx.drives.find((d) => inside(p, d.path));
  const base = inside(p, ctx.home) ? ctx.home : drive?.path;
  if (!base || p === base) return 'place';
  if (inside(p, path.join(ctx.home, 'Library'))) return 'library';
  const parts = p.slice(base.length + 1).split('/');
  if (parts.some((x) => x.startsWith('.'))) return 'hidden';
  const name = parts.at(-1);
  if (item.kind === 'app' || /\.app$/i.test(name)) return 'app';
  if (item.kind === 'volume') return 'place';
  if (parts.slice(0, -1).some((x) => PACKAGE.test(x))) return 'package';
  if (parts.some((x) => BACKUP.test(x))) return 'backup';
  if (parts.some((x) => SKIPPED.has(x))) return 'skipped';
  if (ctx.blocked.some(([kind, b]) => (kind === 'literal' ? p === b : inside(p, b)))) return 'blocked';
  if (ctx.own.some((d) => inside(p, d))) return 'own';
  if (ctx.vault && inside(p, ctx.vault)) return 'vault';
  if (ctx.leaveOut.some((d) => inside(p, d))) return 'yours';
  // A Keynote presentation ends in .key like a key file; its kind says which it is.
  if (!isKeynote(item) && checkRead(p, ctx.home).level === 'block') return 'secret';
  return '';
}

/** Whether an item is of the kind asked for ("the thesis folder", "the budget PDF", "budget.xlsx"). */
export function fits(item, q) {
  const name = path.basename(String(item.path ?? '')), ext = extOf(name), folder = item.kind === 'folder';
  if (q.filter.folders && !folder) return false;
  if (q.filter.files && folder) return false;
  if (q.filter.exts && (folder || !q.filter.exts.includes(ext))) return false;
  if (q.ext && ext !== q.ext) return false;
  return true;
}

/** How a name matches his words: 1 the name (without its extension) is his words, 2 it starts with them, 3 each of
 *  his words is a whole word of it, 4 each is in it as part of a word (as Spotlight found it). */
export function tier(name, q) {
  const own = nameWords(stemOf(name)), raw = nameWords(name), words = q.words;
  const same = (a, b) => a.length === b.length && a.every((w, i) => w === b[i]);
  if (same(own, words) || same(raw, words)) return 1;
  if (words.length && words.every((w, i) => own[i] === w)) return 2;
  if (words.every((w) => raw.includes(w))) return 3;
  return 4;
}

/** The items in the order they are shown: tier, the last opened (newest first), the last changed, the fewest folders
 *  deep (below the home folder or the drive: bases), a project folder before elsewhere, then by name. */
export function rank(items, q, { projects = [], bases = [] } = {}) {
  const depth = (p) => { const b = bases.filter((d) => inside(p, d)).sort((x, y) => y.length - x.length)[0] ?? ''; return p.slice(b.length).split('/').length; };
  const inProject = (p) => (projects.some((d) => inside(p, d)) ? 1 : 0);
  return items.map((it) => ({ ...it, tier: tier(path.basename(it.path), q) })).sort((a, b) => a.tier - b.tier
    || (b.used ?? 0) - (a.used ?? 0) || (b.changed ?? 0) - (a.changed ?? 0) || depth(a.path) - depth(b.path)
    || inProject(b.path) - inProject(a.path) || path.basename(a.path).localeCompare(path.basename(b.path)));
}

/** Where an item is, as the card shows it: ~/Documents/Finance, or "Backup drive › Finance" on a drive. */
export function folderShown(p, ctx) {
  const dir = path.dirname(p);
  if (inside(dir, ctx.home)) return dir === ctx.home ? '~' : `~${dir.slice(ctx.home.length)}`;
  const d = ctx.drives.find((x) => inside(dir, x.path));
  if (!d) return dir;
  const rest = dir.slice(d.path.length).split('/').filter(Boolean);
  return [d.name, ...rest].join(' › ');
}

const NUMS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const ORDS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth'];
export const NONE_WORDS = ['none', 'neither', 'none of them', 'neither of them', 'never mind', 'nevermind', 'not any', 'no thanks', ...NO_WORDS];
const NONE = only(NONE_WORDS, plainNum), YES = only([...YES_WORDS, 'show it', 'show me', 'that one', 'show that one'], plainNum);
const LEAD = /^(?:show me|show|i want|give me|lets see|let me see|i mean|it is|its|go for|pick|take)(?: |$)/;
/** What was said to the pick: { kind: 'pick', row } (from 0), { kind: 'none' }, or null when it fits no row or more
 *  than one. rows: [{ name }]. The filler words and the persona's name may stand around it. */
export function pickRow(text, rows, { persona = '' } = {}) {
  const name = plainNum(persona);
  let p = unfilled(text, plainNum);
  if (name) p = unfilled(` ${p} `.split(` ${name} `).join(' ').trim(), plainNum);
  if (!p) return null;
  if (NONE.test(p)) return { kind: 'none' };
  if (rows.length === 1 && YES.test(p)) return { kind: 'pick', row: 0 };
  let w = p.replace(LEAD, '').replace(/^(?:the|number|no) /, '').replace(/ (?:one|file|folder|please)$/, '').replace(/^(?:the|number) /, '').trim();
  const at = (n) => (n >= 1 && n <= rows.length ? { kind: 'pick', row: n - 1 } : null);
  if (w === 'last' || w === 'last one') return { kind: 'pick', row: rows.length - 1 };
  if (/^\d{1,2}(?:st|nd|rd|th)?$/.test(w)) return at(parseInt(w, 10));
  if (ORDS.includes(w)) return at(ORDS.indexOf(w));
  if (NUMS.includes(w) && w !== 'zero') return at(NUMS.indexOf(w));
  // By its name: the whole name, or words that fit exactly one row.
  w = w.replace(/ dot (?=\S)/g, ' ');
  const said = nameWords(w);
  if (!said.length) return null;
  const hit = rows.map((r, i) => [i, nameWords(r.name)]).filter(([, own]) => said.every((x) => own.includes(x)));
  return hit.length === 1 ? { kind: 'pick', row: hit[0][0] } : null;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const label = (r) => (r.folder ? `${r.name} folder` : r.name);
/** What is said and shown when there are matches: the count and the first one or two names only. */
export function foundLine(rows, total, { voiced = false } = {}) {
  const first = total === 1 ? `I found 1: ${label(rows[0])}.` : total === 2 ? `I found 2: ${label(rows[0])} and ${label(rows[1])}.` : `I found ${total}; the first two are ${label(rows[0])} and ${label(rows[1])}.`;
  if (voiced) return `${first} ${total === 1 ? 'Shall I show it in Finder?' : 'Which one should I show?'}`;
  return `${first} ${total === 1 ? 'Click it to show it in Finder.' : 'Click one to show it in Finder.'}`;
}
/** What is said when nothing was found: the limits, plainly. */
export function nothingLine(q, { timedOut = false, seconds = 3, drives = true } = {}) {
  const what = q.filter.folders ? 'folder' : q.filter.files || q.filter.exts || q.ext ? 'file' : 'file or folder';
  if (timedOut) return `Spotlight didn't answer within ${plural(seconds, 'second')}, so I found no ${what} called "${q.said}".`;
  return `I found no ${what} called "${q.said}". I look by name with Spotlight in your home folder${drives ? ' and on your drives' : ''}; hidden folders, ~/Library and the folders you excluded from Spotlight (System Settings, Spotlight, Search Privacy) aren't searched, and a drive Spotlight doesn't index can't be either.`;
}
export const NOT_MAC = 'Finding files anywhere works on macOS only, so nothing was searched.';
export const NO_HELPER = 'Finding files anywhere needs the Roamies app, so nothing was searched.';
// No name in the request: asked for with the request, so that a name said next isn't sent to the model as a reply.
export const WHICH_FILE = 'Say its name with the request, as in "find the file budget".';

/**
 * home; settings() → loadSettings; hands(args, input, ms) → the helper's JSON (throws when it fails); platform.
 * → { ask(text, persona), places(), search(q) }
 *   search(q) → { rows: [{ path, name, folder, where }], total, leftOut, otherKind, timedOut, drives, ms, failed }
 */
export function createFind({ home = os.homedir(), settings = () => loadSettings(home), hands = null, platform = process.platform, now = () => Date.now() } = {}) {
  /** The places searched and the places left out, as real paths. */
  function places(s = settings(), drives = []) {
    const h = real(home);
    return {
      home: h, drives,
      blocked: blockedPaths(home, s.dir),
      own: [real(s.dir), path.join(h, '.gg')],
      vault: s.vault ? real(s.vault) : '',
      leaveOut: (s.findLeaveOut ?? []).map((d) => real(d)),
      projects: [s.project, ...(s.projects ?? []).map((p) => p.dir)].filter(Boolean).map((d) => real(d)),
    };
  }
  async function search(q) {
    const s = settings(), t0 = now(), seconds = s.limits.findSeconds;
    if (platform !== 'darwin') return { rows: [], total: 0, leftOut: 0, timedOut: false, drives: 0, ms: 0, failed: NOT_MAC };
    if (!hands) return { rows: [], total: 0, leftOut: 0, timedOut: false, drives: 0, ms: 0, failed: NO_HELPER };
    const spot = [...q.spot, ...(q.ext ? [`.${q.ext}`] : [])];
    let r;
    try { r = await hands(['find'], JSON.stringify({ words: spot, seconds, max: 1000, drives: s.findDrives }), (seconds + 6) * 1000); } catch (e) {
      return { rows: [], total: 0, leftOut: 0, timedOut: false, drives: 0, ms: now() - t0, failed: `Spotlight couldn't be asked (${String(e?.message ?? e).slice(0, 120)}), so nothing was found.` };
    }
    const drives = (Array.isArray(r?.drives) ? r.drives : []).filter((d) => typeof d?.path === 'string' && d.path.startsWith('/Volumes/')).map((d) => ({ path: d.path, name: String(d.name || path.basename(d.path)) }));
    const ctx = places(s, s.findDrives ? drives : []);
    let left = 0, otherKind = 0;
    const kept = (Array.isArray(r?.items) ? r.items : []).filter((it) => typeof it?.path === 'string' && it.path.startsWith('/')).filter((it) => {
      if (leftOut(it, ctx)) { left++; return false; }
      if (!fits(it, q)) { otherKind++; return false; }
      return true;
    });
    const ranked = rank(kept, q, { projects: ctx.projects, bases: [ctx.home, ...ctx.drives.map((d) => d.path)] });
    const rows = ranked.slice(0, s.limits.findMatches).map((it) => ({ path: it.path, name: path.basename(it.path), folder: it.kind === 'folder', where: folderShown(it.path, ctx), ...(isKeynote(it) ? { keynote: true } : {}) }));
    return { rows, total: ranked.length, leftOut: left, otherKind, timedOut: r?.timedOut === true, drives: ctx.drives.length, ms: now() - t0, failed: '' };
  }
  return { ask: (text, persona = '') => (settings().findAnywhere ? findAsk(text, { persona }) : null), places, search };
}
