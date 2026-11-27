// Local-only build: notes in an Obsidian vault. The one kind of file Roamies handles itself (everything else goes
// to pi): plain .md files in one folder, ~/Documents/roamies-vault unless "vault" in
// ~/Documents/roamies-pi/settings.json says otherwise. Obsidian opens that folder as a vault; it doesn't have to be
// running, and nothing here talks to it.
//
// What the tools can do: make a note, add to the end of one, search the notes, read one, and (feature 14) change a
// note the owner names in that request, once he has seen the change and said save, keeping the previous version in
// Roamies' own folder outside the vault (~/Documents/roamies-pi/note-versions), never deleted. Nothing deletes or
// renames a note, and nothing touches anything outside the vault: a title is only ever a file name inside it.
//
// Feature 18, task pages: a to-do or reminder can have a page of its own, "Tasks/<title>.md", made the first time a
// note is linked to it (write_note with task, or link_note). The page has a line for each note linked and each day
// it was planned, worked on or finished, linking that day's daily note; a linked note gets a line linking the page
// and the day. notes_for finds the notes from both sides (the page's links, and the notes that link to the page),
// so links added by hand count too. Which page is which to-do's is kept in state.json ("taskPages"). Two to-dos with
// one title get "Title (2)"; a new title adds a line, since nothing is renamed in the vault.
import { privateFile } from './privacy.mjs'; // feature 23: the private mark on notes
import { FILLER_WORDS, only, unfilled } from './answers.mjs'; // feature 14: the words that save a note's edit
import { namedIn } from './files.mjs'; // feature 14: a note named in his words
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { limitsFor, loadSettings, readState, writeState } from './pi.mjs';
import { PRIVATE_LINE, noteDay, ymd } from './daily.mjs';

// The sizes and counts are settings ("limits" in settings.json): noteMaxChars, the characters written or read in one
// go; notesSearched, the notes looked through in a search; noteTitleOnlyBytes, over which a note is searched by its
// title only.
export const NOTE_TOOLS = ['write_note', 'search_notes', 'read_note', 'link_note', 'notes_for', 'edit_note', 'undo_note_edit']; // the last two: feature 14
export const TASKS_FOLDER = 'Tasks'; // feature 18: where the task pages are
export const KEEP_PAGES = 500; // the to-do → page entries kept in state.json, the newest
// Feature 14: a note's edit. The folder, in Roamies' own, where the previous version of each edited note is kept
// (never deleted); the words that save an edit, said alone with the filler words (FILLER_WORDS) and the persona's name
// around them, hands-free too; the words that keep the note as it is; the edits remembered for an undo.
export const VERSIONS_FOLDER = 'note-versions';
export const SAVE_WORDS = ['save', 'save it'];
export const KEEP_NOTE_WORDS = ['keep it', 'keep it as it is', 'keep', 'no', "don't", 'cancel'];
export const UNDO_WORDS = /\b(?:undo|revert|restore|put (?:it |the note |that )?back)\b/i;
export const REWRITE_WORDS = /\bre-?write\b/i;
export const KEEP_EDITS = 50;

/** A title as a file name: no folders, no leading dots, none of the characters Obsidian or the file system refuse. */
export function noteName(title) {
  const n = String(title ?? '').trim().replace(/\.md$/i, '').replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+/, '').trim();
  return n.slice(0, 100).trim();
}

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const tilde = (p, home) => (p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p);
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
const oneLine = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

/** Feature 18: the one way anything is written in the vault (notes, daily notes, task pages). A file is made, or
 *  added to at its end; nothing is ever written over, renamed or deleted. A link is never followed, in a folder on
 *  the way or as the file itself, and nothing is written outside the vault. rel: a path inside the vault,
 *  "Folder/Name.md"; no part of it may be empty, start with a dot, or hold a slash. */
export class VaultRefused extends Error {}
export function createVault({ home = os.homedir(), userName = 'the user' } = {}) {
  /** The vault folder, made if it's missing. It has to be a real folder inside the home folder. */
  function root() {
    const dir = loadSettings(home).vault;
    fs.mkdirSync(dir, { recursive: true });
    const real = fs.realpathSync(dir), realHome = fs.realpathSync(home);
    if (real === realHome || !real.startsWith(realHome + path.sep)) throw new Error(`The notes vault (${dir}) has to be a folder inside the home folder. ${userName} sets it as "vault" in ~/Documents/roamies-pi/settings.json.`);
    return real;
  }
  const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };
  /** The file a path means, its folders made as needed. Refused: a part that isn't a plain name, a folder or file
   *  that is a link, a folder that is a file. */
  function place(rel, { make = true } = {}) {
    const parts = String(rel ?? '').split('/');
    if (!parts.length || parts.some((p) => !p || p.startsWith('.') || /[\\\0]/.test(p)) || !/\.md$/i.test(parts.at(-1))) throw new VaultRefused(`"${rel}" isn't a note's place in the vault.`);
    const top = root();
    let dir = top;
    for (const part of parts.slice(0, -1)) {
      const next = path.join(dir, part);
      let st = null;
      try { st = fs.lstatSync(next); } catch { /* not there yet */ }
      if (st && (st.isSymbolicLink() || !st.isDirectory())) throw new VaultRefused(`"${part}" in the vault is a link or a file, so I left it alone.`);
      if (!st) { if (!make) return null; fs.mkdirSync(next); }
      dir = next;
    }
    if (!fs.realpathSync(dir).startsWith(top)) throw new VaultRefused(`"${rel}" is outside the vault.`);
    return path.join(dir, parts.at(-1));
  }
  return {
    root, place,
    /** Makes a file that isn't there. → false when something by that name is already there (it is left alone). */
    create(rel, text) {
      const file = place(rel);
      try { fs.writeFileSync(file, text, { flag: 'wx' }); return true; } catch (e) { if (e.code === 'EEXIST') return false; throw e; }
    },
    /** Adds to the end of a file that is there, on a line of its own. → false when it isn't there. */
    append(rel, text) {
      const file = place(rel);
      let st;
      try { st = fs.lstatSync(file); } catch { return false; }
      if (st.isSymbolicLink() || !st.isFile()) throw new VaultRefused(`"${rel}" is a link or a folder, so I left it alone.`);
      const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND | (fs.constants.O_NOFOLLOW ?? 0));
      try { fs.writeSync(fd, `${st.size && !endsWithNewline(file, st.size) ? '\n' : ''}${text}`); } finally { fs.closeSync(fd); }
      return true;
    },
    /** Feature 14: a note's whole text, put in its place at once (a temporary file beside it, then renamed over it),
     *  only when it still holds exactly `was`. → false when it doesn't (nothing written). Refused: a link, a file
     *  with more than one name, a folder, an empty text. Never deletes or renames a note. */
    replace(rel, was, text) {
      const file = place(rel, { make: false });
      if (!file) throw new VaultRefused(`"${rel}" isn't in the vault.`);
      let st;
      try { st = fs.lstatSync(file); } catch { throw new VaultRefused(`"${rel}" isn't in the vault.`); }
      if (st.isSymbolicLink() || !st.isFile()) throw new VaultRefused(`"${rel}" is a link or a folder, so I left it alone.`);
      if (st.nlink > 1) throw new VaultRefused(`"${rel}" has more than one name (a hard link), so I left it alone.`);
      if (!String(text ?? '').trim()) throw new VaultRefused('That would leave the note empty, so nothing was changed.');
      if (fs.readFileSync(file, 'utf8') !== was) return false;
      const tmp = path.join(path.dirname(file), `.${path.basename(file)}.roamies-${process.pid}-${Date.now()}.tmp`);
      fs.writeFileSync(tmp, text, { flag: 'wx', mode: st.mode & 0o777 });
      fs.renameSync(tmp, file);
      return true;
    },
    /** A file's text, or null when it isn't there (or is a link). */
    read(rel) {
      let file;
      try { file = place(rel, { make: false }); } catch { return null; }
      if (!file || isLink(file)) return null;
      try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
    },
  };
}
function endsWithNewline(file, size) {
  const fd = fs.openSync(file, 'r'), b = Buffer.alloc(1);
  try { fs.readSync(fd, b, 0, 1, size - 1); } finally { fs.closeSync(fd); }
  return b[0] === 10;
}

/** Feature 18: the task pages, as agreed on 2026-11-21. todos(): the to-dos and reminders, [{ id, text, kind, status,
 *  due }]. A page holds the title, the due time when it had one, and a line for each note linked and each day the
 *  to-do was planned, worked on (a note linked) or finished, each linking to that day's daily note; a new title adds
 *  a line, since nothing is renamed in the vault. */
export function createTaskPages({ home = os.homedir(), userName = 'the user', todos = () => [], now = () => Date.now() } = {}) {
  const vault = createVault({ home, userName });
  const settings = () => loadSettings(home);
  const dir = () => settings().dir;
  /** to-do id → { name, title }: the page's name, and the title it last had. */
  function map() {
    const m = readState(dir()).taskPages, out = {};
    if (!m || typeof m !== 'object' || Array.isArray(m)) return out;
    for (const [k, v] of Object.entries(m)) { if (typeof v === 'string') out[k] = { name: v, title: v }; else if (v && typeof v.name === 'string') out[k] = { name: v.name, title: String(v.title ?? v.name) }; }
    return out;
  }
  function save(m) {
    const keys = Object.keys(m);
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_PAGES))) delete m[k];
    writeState(dir(), { ...readState(dir()), taskPages: m });
  }
  const rel = (name) => `${TASKS_FOLDER}/${name}.md`;
  /** The to-do or reminder an id means, or null. */
  const todo = (id) => { const all = todos(); return (Array.isArray(all) ? all : []).find((t) => t && t.id === id) ?? null; };
  /** The page's name, when the to-do has one that is still in the vault. */
  const pageOf = (id) => { const n = map()[id]?.name; return typeof n === 'string' && vault.read(rel(n)) !== null ? n : null; };
  /** The to-do's title, linked to its page when it has one (for the daily note). */
  const link = (id, text) => { const n = pageOf(id); return n ? `[[${TASKS_FOLDER}/${n}|${oneLine(text)}]]` : oneLine(text); };
  /** A day's daily note, linked: the day of a moment, as the daily note counts days (calendar.dayTurnsAt). */
  function dayLink(key = null) {
    const s = settings(), k = key ?? ymd(noteDay(now(), s.calendar.dayTurnsAt)), [y, m, d] = k.split('-').map(Number);
    return `[[${s.dailyFolder}/${k}|${new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '')}]]`;
  }
  /** The to-do's page, made if it has none: its name. A name taken by another page or by a file already there gets
   *  the next number. */
  function make(id) {
    const t = todo(id);
    if (!t) throw new Error(`There's no to-do with the id "${id}". list_commitments gives the ids.`);
    const was = pageOf(id);
    if (was) return was;
    const base = noteName(t.text) || 'To-do', taken = new Set(Object.entries(map()).filter(([k]) => k !== id).map(([, v]) => v.name.toLowerCase()));
    const when = new Date(now()), due = typeof t.due === 'number' ? new Date(t.due) : null;
    for (let i = 1; i < 100; i++) {
      const name = i === 1 ? base : `${base.slice(0, 94).trim()} (${i})`;
      if (taken.has(name.toLowerCase())) continue;
      if (vault.create(rel(name), `---\ntodo: ${id}\ncreated: ${stamp(when)}\n---\n\n# ${oneLine(t.text)}\n\n${t.kind === 'reminder' ? 'A reminder. ' : ''}${due ? `Due ${stamp(due)}. ` : ''}Roamies adds a line here for each note linked to this ${t.kind === 'reminder' ? 'reminder' : 'to-do'} and for each day it was planned, worked on or finished; links added by hand count too.\n\n`)) {
        save({ ...map(), [id]: { name, title: oneLine(t.text) } });
        return name;
      }
    }
    throw new Error('I couldn\'t find a free name for the to-do\'s page in the vault.');
  }
  /** The note titles the page links to (its day links aside). */
  function listed(id) {
    const n = pageOf(id), text = n ? vault.read(rel(n)) ?? '' : '', daily = `${settings().dailyFolder}/`;
    return [...text.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)].map((m) => m[1].trim()).filter((t) => t && !t.startsWith(daily) && !t.startsWith(`${TASKS_FOLDER}/`)).map((t) => t.split('/').pop());
  }
  /** A line on the page, once. */
  function line(page, text) {
    if ((vault.read(rel(page)) ?? '').split('\n').includes(text)) return false;
    vault.append(rel(page), `${text}\n`);
    return true;
  }
  /** Links a note to the to-do: a line on its page (made if needed). → { page, made, already }. */
  function add(id, title) {
    renames();
    const had = pageOf(id), page = make(id);
    if (listed(id).some((t) => t.toLowerCase() === title.toLowerCase())) return { page, made: !had, already: true };
    line(page, `- ${dayLink()}: note [[${title}]]`);
    return { page, made: !had, already: false };
  }
  /** A day the to-do was planned or finished (daily.mjs): a line on its page, once a day each, when it has a page. */
  function day(id, what, key = null) {
    const page = pageOf(id);
    if (!page) return false;
    renames();
    return line(page, `- ${dayLink(key)}: ${what}`);
  }
  /** A to-do whose title changed keeps its page: a line with the new title. */
  function renames() {
    const m = map(); let changed = false;
    for (const [id, e] of Object.entries(m)) {
      const t = todo(id), now_ = t ? oneLine(t.text) : null;
      if (!now_ || now_ === e.title || vault.read(rel(e.name)) === null) continue;
      line(e.name, `- ${dayLink()}: renamed "${now_}"`);
      m[id] = { ...e, title: now_ }; changed = true;
    }
    if (changed) save(m);
    return changed;
  }
  return { todo, pageOf, link, dayLink, make, listed, add, day, renames, rel };
}

// Feature 23: privateNow(): a private request is running (what is written carries the private mark); onPrivate(title):
// a private note was made. A call without { seePrivate } (Claude's) never sees a private note (privacy.mjs).
// Feature 14: heard() → his words in this request ('' when the app made it); ask(opts) → the bubble (answers.mjs);
// counted(kind, chars) → the ledger's count of a note's text sent; onEdited(title) → the daily note's Log line;
// persona() → the persona's name (said around "save").
export function createNotes({ home = os.homedir(), userName = 'the user', log = () => {}, now = () => Date.now(), onNote = () => {}, todos = () => [], privateNow = () => false, onPrivate = () => {}, heard = () => '', ask = async () => null, counted = () => {}, onEdited = () => {}, persona = () => '' } = {}) {
  // onNote(title, task): a note was made or added to, for a to-do or not (feature 18: its line in the daily note's Log).
  const told = (title, task = null) => { try { onNote(title, task); } catch (e) { console.error('daily note', e); } };
  const box = createVault({ home, userName });
  const vault = () => box.root();
  const pages = createTaskPages({ home, userName, todos, now });
  /** Feature 18: a task page or a daily note: kept by the app, not one of the notes. */
  const kept = (n) => { const top = n.rel.split(path.sep)[0]; return n.rel.includes(path.sep) && (top === TASKS_FOLDER || top === loadSettings(home).dailyFolder); };
  /** The to-do a note is about must be one (checked before anything is written). */
  function checkTask(task) {
    if (task == null || task === '') return null;
    const t = pages.todo(String(task));
    if (!t) throw new Error(`There's no to-do with the id "${task}". list_commitments gives the ids.`);
    return t.id;
  }
  function linked(task, name) {
    const r = pages.add(task, name);
    log('task_page', { made: r.made, linked: !r.already });
    return r;
  }

  /** Every note in the vault: { title, file, rel, mtime }. Folders starting with a dot (.obsidian, .trash) are skipped. */
  function all(dir) {
    const out = [], most = limitsFor(home).notesSearched, titleOnly = limitsFor(home).noteTitleOnlyBytes;
    const walk = (d, depth) => {
      if (depth > 8 || out.length >= most) return;
      let entries;
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f, depth + 1);
        else if (e.isFile() && /\.md$/i.test(e.name) && out.length < most) {
          let st; try { st = fs.statSync(f); } catch { continue; }
          out.push({ title: e.name.replace(/\.md$/i, ''), file: f, rel: path.relative(dir, f), mtime: st.mtimeMs, size: st.size, titleOnly: st.size > titleOnly });
        }
      }
    };
    walk(dir, 0);
    return out;
  }

  /** The note a title means: the exact title (any case), else the only one containing it. */
  function find(notes, title) {
    const want = noteName(title).toLowerCase();
    if (!want) return { error: 'Which note? Give its title.' };
    const exact = notes.filter((n) => n.title.toLowerCase() === want);
    if (exact.length) return { note: exact.sort((a, b) => b.mtime - a.mtime)[0] };
    const near = notes.filter((n) => n.title.toLowerCase().includes(want));
    if (near.length === 1) return { note: near[0] };
    if (near.length > 1) return { error: `Several notes match "${title}": ${near.slice(0, 8).map((n) => n.title).join('; ')}. Say which.` };
    return { error: `There's no note called "${title}". search_notes finds what there is.` };
  }

  const text = (n) => { try { return n.titleOnly ? '' : fs.readFileSync(n.file, 'utf8'); } catch { return ''; } };
  // Feature 14: a note's text going to a model, counted for the ledger (the local route's calls count their own).
  const noteText = (ctx, chars) => { if (chars > 0) { try { (ctx?.count ?? counted)('note', chars); } catch { /* never stops a read */ } } };
  // Feature 23: for Claude's calls, a line from a private exchange (the daily note's PRIVATE_LINE) is not there.
  const seen = (body, ctx) => (ctx?.seePrivate ? body : body.split('\n').filter((l) => !l.includes(PRIVATE_LINE)).join('\n'));

  const tools = [
    {
      name: 'write_note',
      description: `Save a note in ${userName}'s Obsidian vault as a Markdown file, only when they ask to note, write down or save an idea. title is the note's name (a few plain words, no folders). content is Markdown in ${userName}'s own words and meaning: tidy it, don't pad it or add ideas of your own. Link to related notes with [[Their Title]], using titles search_notes found (or a new title worth a note of its own). A new title makes a new note. append true adds to the end of an existing note under the date; without it an existing note is never touched. task: the id of the to-do or reminder the note is about (from today's plan or list_commitments), only when ${userName} says it is about it; the note is then linked to its page in the vault. A note is changed only with edit_note, and never deleted.`,
      parameters: z.object({ title: z.string(), content: z.string(), append: z.boolean().optional(), task: z.string().optional() }),
      executionMode: 'sequential',
      execute: async ({ title, content, append, task }, ctx) => {
        const name = noteName(title);
        if (!name) throw new Error('The note needs a title: a few plain words.');
        const body = String(content ?? '').trim();
        if (!body) throw new Error('The note is empty.');
        const most = limitsFor(home).noteMaxChars;
        if (body.length > most) throw new Error(`That's over ${most} characters. Split it into a few notes that link to each other.`);
        const todoId = checkTask(task);
        const dir = vault(), when = stamp(new Date(now()));
        const there = all(dir).find((n) => n.title.toLowerCase() === name.toLowerCase() && !kept(n));
        if (there) {
          if (!append) throw new Error(`A note called "${there.title}" already exists. Add to it with append true, or pick another title.`);
          // Feature 23: private text goes only into a private note; Claude never adds to one.
          if (privateNow() && !privateFile(there.file)) throw new Error(`"${there.title}" isn't private: in private mode, save this as a new note.`);
          if (!privateNow() && !ctx?.seePrivate && privateFile(there.file)) throw new Error(`A note called "${there.title}" already exists and can't be added to from here. Pick another title.`);
          const page = todoId ? pages.make(todoId) : null;
          try { box.append(path.relative(dir, there.file).split(path.sep).join('/'), `\n## ${when}\n\n${body}\n${page ? `\nFor ${pages.link(todoId, pages.todo(todoId).text)}, ${pages.dayLink()}.\n` : ''}`); } catch (e) {
            if (e instanceof VaultRefused) throw new Error(`"${there.title}" is a link to somewhere else, or in a folder that is, so I left it alone.`);
            throw e;
          }
          log('note_append', { chars: body.length });
          told(there.title, todoId);
          if (todoId) { linked(todoId, there.title); return `Added to the note "${there.title}", linked to its to-do's page.`; }
          return `Added to the note "${there.title}".`;
        }
        const page = todoId ? pages.make(todoId) : null;
        // Never writes over a file that appeared meanwhile.
        const priv = privateNow();
        if (!box.create(`${name}.md`, `---\ncreated: ${when}\n${priv ? 'private: true\n' : ''}${page ? `task: "[[${TASKS_FOLDER}/${page}]]"\nday: "${pages.dayLink().replace(/\|[^\]]*\]\]$/, ']]')}"\n` : ''}---\n\n${body}\n`)) throw new Error(`Something called "${name}.md" is already in the vault and isn't a note I can add to. Pick another title.`);
        log('note_new', { chars: body.length, ...(priv ? { private: true } : {}) });
        if (priv) onPrivate(name);
        told(name, todoId);
        if (todoId) { linked(todoId, name); return `Saved the note "${name}" in the vault, linked to its to-do's page.`; }
        return `Saved the note "${name}" in the vault.`;
      },
    },
    {
      name: 'search_notes',
      description: `Search ${userName}'s notes vault by words in titles and text; an empty query lists the most recently changed notes. Use when they ask what's in their notes, and before writing a note that should link to others. Returns titles with the matching lines; read_note gives a whole note.`,
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }, ctx) => {
        const dir = vault(), every = all(dir), notes = ctx?.seePrivate ? every : every.filter((n) => !privateFile(n.file));
        const unseen = every.length - notes.length ? `\n(${every.length - notes.length} private note${every.length - notes.length === 1 ? '' : 's'} not searched: made in private mode.)` : '';
        if (!notes.length) return `The vault has no notes yet.${unseen}`;
        const day = (ms) => new Date(ms).toISOString().slice(0, 10);
        const terms = [...new Set(String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean))].slice(0, 8);
        if (!terms.length) return `${notes.length} note${notes.length === 1 ? '' : 's'}. Most recently changed:\n${notes.sort((a, b) => b.mtime - a.mtime).slice(0, 20).map((n) => `- ${n.title} (${day(n.mtime)})`).join('\n')}${unseen}`;
        const scored = [];
        for (const n of notes) {
          const body = seen(text(n), ctx), title = n.title.toLowerCase(), lower = body.toLowerCase();
          const hit = terms.filter((t) => title.includes(t) || lower.includes(t));
          if (!hit.length) continue;
          let score = hit.length * 100;
          for (const t of hit) { if (title.includes(t)) score += 20; score += Math.min(10, lower.split(t).length - 1); }
          const lines = body.split('\n').filter((l) => l.trim() && !/^---\s*$/.test(l) && hit.some((t) => l.toLowerCase().includes(t))).slice(0, 3).map((l) => `  ${clip(l.trim(), 200)}`);
          scored.push({ n, score, all: hit.length === terms.length, lines });
        }
        // Notes with every word come first; if none has them all, ones with any.
        const full = scored.filter((s) => s.all), pool = (full.length ? full : scored).sort((a, b) => b.score - a.score || b.n.mtime - a.n.mtime);
        if (!pool.length) return `No note mentions "${query}".${unseen}`;
        const head = full.length ? '' : `No note has all of those words; these have some:\n`;
        noteText(ctx, pool.slice(0, 8).reduce((a, x) => a + x.lines.join('\n').length, 0)); // feature 14: the lines quoted
        return `${head}${pool.slice(0, 8).map((s) => `- ${s.n.title}${path.dirname(s.n.rel) === '.' ? '' : ` (in ${path.dirname(s.n.rel)})`} (${day(s.n.mtime)})${s.lines.length ? `\n${s.lines.join('\n')}` : ''}`).join('\n')}${pool.length > 8 ? `\n…and ${pool.length - 8} more.` : ''}${unseen}`;
      },
    },
    {
      name: 'read_note',
      description: `Read one note from ${userName}'s vault by its title (as search_notes gave it). Use when they ask what a note says.`,
      parameters: z.object({ title: z.string() }),
      execute: async ({ title }, ctx) => {
        const { note, error } = find(all(vault()).filter((n) => ctx?.seePrivate || !privateFile(n.file)), title);
        if (error) throw new Error(error);
        const body = seen(fs.readFileSync(note.file, 'utf8'), ctx), most = limitsFor(home).noteMaxChars;
        noteText(ctx, Math.min(body.length, most)); // feature 14: counted for the ledger
        return `# ${note.title}\n\n${body.length > most ? `${body.slice(0, most)}\n[Cut off: the note is longer than this.]` : body}`;
      },
    },
    {
      name: 'link_note',
      description: `Link a note already in ${userName}'s vault to one of their to-dos or reminders, when they ask: a line on its page in the vault (made the first time), and a line at the end of the note linking the page and the day. title is the note's title as search_notes gave it; task is the to-do's id (from today's plan or list_commitments).`,
      parameters: z.object({ title: z.string(), task: z.string() }),
      executionMode: 'sequential',
      execute: async ({ title, task }, ctx) => {
        const todoId = checkTask(task);
        if (!todoId) throw new Error('Which to-do? Give its id (list_commitments has them).');
        const { note, error } = find(all(vault()).filter((n) => !kept(n) && (ctx?.seePrivate || !privateFile(n.file))), title);
        if (error) throw new Error(error);
        const r = linked(todoId, note.title);
        if (r.already) return `"${note.title}" is already linked to that to-do.`;
        // The note carries a link to the page and to the day, added at its end (it is never changed otherwise).
        try { box.append(path.relative(vault(), note.file).split(path.sep).join('/'), `\nFor ${pages.link(todoId, pages.todo(todoId).text)}, ${pages.dayLink()}.\n`); } catch (e) { if (!(e instanceof VaultRefused)) throw e; }
        return `Linked the note "${note.title}" to the to-do's page.`;
      },
    },
    {
      name: 'notes_for',
      description: `The notes in ${userName}'s vault about one of their to-dos or reminders: the ones on its page, and the ones that link to the page (links added by hand count too). task is the to-do's id. Titles only; read_note gives a note.`,
      parameters: z.object({ task: z.string() }),
      execute: async ({ task }, ctx) => {
        const todoId = checkTask(task);
        if (!todoId) throw new Error('Which to-do? Give its id (list_commitments has them).');
        const page = pages.pageOf(todoId);
        if (!page) return 'No note is linked to that to-do yet.';
        const notes = all(vault()).filter((n) => !kept(n) && (ctx?.seePrivate || !privateFile(n.file))), byTitle = new Map(notes.map((n) => [n.title.toLowerCase(), n]));
        const found = new Map();
        for (const t of pages.listed(todoId)) { const n = byTitle.get(t.toLowerCase()); if (n) found.set(n.title.toLowerCase(), n); }
        // A link to the page by its bare name counts only when no note outside the pages has that name.
        const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const to = new RegExp(`\\[\\[(?:${esc(TASKS_FOLDER)}/${esc(page)}${byTitle.has(page.toLowerCase()) ? '' : `|${esc(page)}`})(?:[|#\\]])`, 'i');
        for (const n of notes) if (!found.has(n.title.toLowerCase()) && to.test(text(n))) found.set(n.title.toLowerCase(), n);
        log('notes_for', { notes: found.size });
        if (!found.size) return 'No note is linked to that to-do yet.';
        const list = [...found.values()].sort((a, b) => b.mtime - a.mtime);
        return `${list.length} note${list.length === 1 ? '' : 's'} about that to-do:\n${list.slice(0, 20).map((n) => `- ${n.title}${path.dirname(n.rel) === '.' ? '' : ` (in ${path.dirname(n.rel)})`}`).join('\n')}${list.length > 20 ? `\n…and ${list.length - 20} more.` : ''}`;
      },
    },
  ];

  // ---- feature 14: changing a note the owner names
  const relOf = (n) => path.relative(vault(), n.file).split(path.sep).join('/');
  const ownDir = () => loadSettings(home).dir;
  /** The previous version, kept before a change: <roamies-pi>/note-versions/<the note's folders>/<title> <stamp>.md,
   *  never written over. → its path inside the versions folder. */
  function keepVersion(rel, title, body) {
    const own = fs.realpathSync(ownDir()), top = path.join(own, VERSIONS_FOLDER), parts = rel.split('/').slice(0, -1);
    let dir = top;
    for (const part of ['', ...parts]) {
      if (part) dir = path.join(dir, part);
      fs.mkdirSync(dir, { recursive: true });
      if (fs.lstatSync(dir).isSymbolicLink() || !fs.realpathSync(dir).startsWith(own + path.sep)) throw new Error('The note versions folder is a link, so nothing was changed.');
    }
    const d = new Date(now()), when = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
    for (let i = 1; i < 100; i++) {
      const name = `${title} ${when}${i === 1 ? '' : ` (${i})`}.md`;
      try { fs.writeFileSync(path.join(dir, name), body, { flag: 'wx', mode: 0o600 }); return [...parts, name].join('/'); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
    throw new Error('I couldn\'t find a free name for the previous version, so nothing was changed.');
  }
  const edits = () => { const l = readState(ownDir()).noteEdits; return Array.isArray(l) ? l.filter((e) => e && typeof e.rel === 'string' && typeof e.version === 'string') : []; };
  const setEdits = (l) => writeState(ownDir(), { ...readState(ownDir()), noteEdits: l.slice(-KEEP_EDITS) });
  /** The changed lines, as the bubble shows them: "- " removed, "+ " added, the rest left out; at most
   *  limits.noteEditLines, then "and N more lines". */
  function changedLines(was, next) {
    const a = was.split('\n'), b = next.split('\n');
    let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
    let j = 0; while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
    const x = a.slice(i, a.length - j), y = b.slice(i, b.length - j), out = [];
    if (x.length * y.length <= 250_000) {
      const L = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
      for (let p = x.length - 1; p >= 0; p--) for (let q = y.length - 1; q >= 0; q--) L[p][q] = x[p] === y[q] ? L[p + 1][q + 1] + 1 : Math.max(L[p + 1][q], L[p][q + 1]);
      let p = 0, q = 0;
      while (p < x.length || q < y.length) {
        if (p < x.length && q < y.length && x[p] === y[q]) { p++; q++; } else if (p < x.length && (q === y.length || L[p + 1][q] >= L[p][q + 1])) out.push(`- ${x[p++]}`); else out.push(`+ ${y[q++]}`);
      }
    } else out.push(...x.map((l) => `- ${l}`), ...y.map((l) => `+ ${l}`));
    const most = limitsFor(home).noteEditLines, shown = out.slice(0, most).map((l) => clip(l, 160));
    return `${shown.join('\n')}${out.length > most ? `\nand ${out.length - most} more lines` : ''}`;
  }
  const SAVE = only(SAVE_WORDS), KEEP = only(KEEP_NOTE_WORDS);
  /** What was said to the bubble: save, keep, or neither (the bubble stays open). Filler words and the persona's name
   *  may stand around it, hands-free too. */
  function saidToEdit(t) {
    const name = String(persona() ?? '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
    let p = unfilled(t);
    if (name) p = unfilled(` ${p} `.split(` ${name} `).join(' ').trim());
    return SAVE.test(p) ? { kind: 'save' } : KEEP.test(p) ? { kind: 'keep' } : null;
  }
  /** Shows the change and waits for save. → 'save', 'keep' or 'none'. */
  async function approve(question, spoken, change) {
    // Answered by the caller's words (saidToEdit) or by button position (clicks, answers.mjs), as daily.mjs's are.
    const opts = { placeholder: `${question}\n${change}`, spoken, choices: ['Save it', 'Keep it as it is'], clicks: [{ kind: 'save' }, { kind: 'keep' }], hint: '"save it" or "keep it"', parse: saidToEdit };
    let a = null;
    try { a = await ask(opts); } catch (e) { if (e?.name !== 'Unanswered') throw e; a = null; }
    return a?.kind === 'save' ? 'save' : a?.kind === 'keep' ? 'keep' : 'none';
  }
  /** Saves a change he approved: the previous version first, then the note, if it is still as shown. → the line. */
  function save(note, was, next, title, how, remember = true) {
    const rel = relOf(note), version = keepVersion(rel, title, was);
    let done;
    try { done = box.replace(rel, was, next); } catch (e) { if (e instanceof VaultRefused) throw new Error(e.message); throw e; }
    if (!done) { log('note_edit', { answer: 'save', changed: false }); return 'The note changed since I showed the change, so nothing was saved.'; }
    if (remember) setEdits([...edits(), { rel, title, version, at: now() }]);
    log('note_edit', { answer: 'save', how, chars: next.length });
    try { onEdited(title); } catch (e) { console.error('daily note', e); }
    return null;
  }
  const editable = (ctx) => all(vault()).filter((n) => !kept(n) && (ctx?.seePrivate || !privateFile(n.file)));
  const editTools = [
    {
      name: 'edit_note',
      description: `Change a note in ${userName}'s vault, only when they ask you to change a note they name in this message. title: the note's title. changes: each an exact piece of the note's text (find, as read_note gave it, occurring once) and what replaces it. text: the whole new text instead, only when they ask for a rewrite. The app shows them the change and saves it only when they say save; it keeps the previous version. Daily notes and task pages can't be changed; no note is ever deleted.`,
      parameters: z.object({ title: z.string(), changes: z.array(z.object({ find: z.string(), replace: z.string() })).optional(), text: z.string().optional() }),
      executionMode: 'sequential',
      execute: async ({ title, changes = [], text: whole }, ctx) => {
        const words = String(heard() ?? '').trim();
        if (!words) throw new Error(`I change a note only when ${userName} asks in a request they typed or spoke; nothing was changed.`);
        const { note, error } = find(all(vault()).filter((n) => ctx?.seePrivate || !privateFile(n.file)), title);
        if (error) throw new Error(error);
        if (kept(note)) throw new Error('Daily notes and task pages are kept by the app and can\'t be changed here.');
        if (!namedIn(words, note.title, { ext: false })) throw new Error(`I change a note only when ${userName} names it in this request (its title, or all its words). Ask them which note, by its title; nothing was changed.`);
        if (fs.lstatSync(note.file).nlink > 1) throw new Error(`"${note.title}" has more than one name (a hard link), so I left it alone.`);
        const was = fs.readFileSync(note.file, 'utf8');
        let next = was;
        if (typeof whole === 'string') {
          if (!REWRITE_WORDS.test(words)) throw new Error('A whole new text only when they ask for a rewrite: give the exact changes instead. Nothing was changed.');
          next = whole.endsWith('\n') || !was.endsWith('\n') ? whole : `${whole}\n`;
        } else {
          if (!changes.length) throw new Error('Give the changes: each an exact piece of the note (find) and what replaces it.');
          for (const c of changes) {
            const f = String(c.find ?? '');
            if (!f) throw new Error('A change needs the exact text to find.');
            const k = next.split(f).length - 1;
            if (k !== 1) throw new Error(k ? `"${clip(oneLine(f), 80)}" is in the note ${k} times: give more of the text around it, so it is there once. Nothing was changed.` : `"${clip(oneLine(f), 80)}" isn't in the note as written: read_note gives its exact text. Nothing was changed.`);
            next = next.replace(f, () => String(c.replace ?? ''));
          }
        }
        if (next === was) throw new Error('That changes nothing in the note.');
        if (!next.trim()) throw new Error('That would leave the note empty, so nothing was changed.');
        const a = await approve(`Change ${note.title}?`, `Change ${note.title}?`, changedLines(was, next));
        if (a !== 'save') { log('note_edit', { answer: a }); return a === 'keep' ? `${userName} chose to keep "${note.title}" as it is; nothing was changed.` : `No answer, so "${note.title}" wasn't changed. Don't ask again now.`; }
        const failed = save(note, was, next, note.title, typeof whole === 'string' ? 'rewrite' : 'changes');
        return failed ?? `Saved the change to "${note.title}"; its previous version is kept.`;
      },
    },
    {
      name: 'undo_note_edit',
      description: `Put back the version of a note from before its last edit by Roamies, only when ${userName} asks to undo it. title: the note, when they name one; empty: the last note edited. The app shows the change and saves it only when they say save.`,
      parameters: z.object({ title: z.string().optional() }),
      executionMode: 'sequential',
      execute: async ({ title }, ctx) => {
        const words = String(heard() ?? '').trim();
        if (!words || !UNDO_WORDS.test(words)) throw new Error(`I undo a note's edit only when ${userName} asks for it in this request (undo, revert, restore or put back); nothing was changed.`);
        const list = edits(), want = noteName(title ?? '').toLowerCase();
        const e = [...list].reverse().find((x) => !want || x.title.toLowerCase() === want);
        if (!e) throw new Error(want ? `There's no edit of "${title}" to undo.` : 'There\'s no note edit to undo.');
        const note = editable(ctx).find((n) => relOf(n) === e.rel);
        if (!note) throw new Error(`"${e.title}" isn't in the vault where it was, so nothing was changed.`);
        let back;
        try { back = fs.readFileSync(path.join(fs.realpathSync(ownDir()), VERSIONS_FOLDER, ...e.version.split('/')), 'utf8'); } catch { throw new Error(`The previous version of "${e.title}" isn't there any more, so nothing was changed.`); }
        const was = fs.readFileSync(note.file, 'utf8');
        if (back === was) throw new Error(`"${e.title}" is already as it was before that edit.`);
        const d = new Date(e.at), at = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
        const a = await approve(`Put back ${e.title} as it was before the edit at ${at}?`, `Put back ${e.title} as it was before the edit?`, changedLines(was, back));
        if (a !== 'save') { log('note_edit', { answer: a, undo: true }); return a === 'keep' ? `${userName} chose to keep "${e.title}" as it is; nothing was changed.` : `No answer, so "${e.title}" wasn't changed. Don't ask again now.`; }
        const failed = save(note, was, back, e.title, 'undo', false);
        if (failed) return failed;
        setEdits(edits().filter((x) => !(x.rel === e.rel && x.version === e.version && x.at === e.at)));
        return `Put back "${e.title}" as it was before that edit; the version it replaced is kept too.`;
      },
    },
  ];
  tools.push(...editTools);

  /** A line for the model's live state. */
  function live() {
    try { const dir = vault(); const n = all(dir).length; return `- Notes vault: ${tilde(dir, fs.realpathSync(home))} (${n} note${n === 1 ? '' : 's'}).`; } catch (e) { return `- Notes vault: not usable (${e.message}).`; }
  }

  return { tools, live, pages };
}
