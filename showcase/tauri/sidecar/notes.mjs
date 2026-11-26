// Local-only build: notes in an Obsidian vault. The one kind of file Roamies handles itself (everything else goes
// to pi): plain .md files in one folder, ~/Documents/roamies-vault unless "vault" in
// ~/Documents/roamies-pi/settings.json says otherwise. Obsidian opens that folder as a vault; it doesn't have to be
// running, and nothing here talks to it.
//
// What the tools can do: make a note, add to the end of one, search the notes, read one. They can't change or delete
// what's already written, and can't touch anything outside the vault: a title is only ever a file name inside it.
//
// Feature 18, task pages: a to-do or reminder can have a page of its own, "Tasks/<title>.md", made the first time a
// note is linked to it (write_note with task, or link_note). The page has a line for each note linked and each day
// it was planned, worked on or finished, linking that day's daily note; a linked note gets a line linking the page
// and the day. notes_for finds the notes from both sides (the page's links, and the notes that link to the page),
// so links added by hand count too. Which page is which to-do's is kept in state.json ("taskPages"). Two to-dos with
// one title get "Title (2)"; a new title adds a line, since nothing is renamed in the vault.
import { privateFile } from './privacy.mjs'; // feature 23: the private mark on notes
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { limitsFor, loadSettings, readState, writeState } from './pi.mjs';
import { PRIVATE_LINE, noteDay, ymd } from './daily.mjs';

// The sizes and counts are settings ("limits" in settings.json): noteMaxChars, the characters written or read in one
// go; notesSearched, the notes looked through in a search; noteTitleOnlyBytes, over which a note is searched by its
// title only.
export const NOTE_TOOLS = ['write_note', 'search_notes', 'read_note', 'link_note', 'notes_for'];
export const TASKS_FOLDER = 'Tasks'; // feature 18: where the task pages are
export const KEEP_PAGES = 500; // the to-do → page entries kept in state.json, the newest

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
export function createNotes({ home = os.homedir(), userName = 'the user', log = () => {}, now = () => Date.now(), onNote = () => {}, todos = () => [], privateNow = () => false, onPrivate = () => {} } = {}) {
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
  // Feature 23: for Claude's calls, a line from a private exchange (the daily note's PRIVATE_LINE) is not there.
  const seen = (body, ctx) => (ctx?.seePrivate ? body : body.split('\n').filter((l) => !l.includes(PRIVATE_LINE)).join('\n'));

  const tools = [
    {
      name: 'write_note',
      description: `Save a note in ${userName}'s Obsidian vault as a Markdown file, only when they ask to note, write down or save an idea. title is the note's name (a few plain words, no folders). content is Markdown in ${userName}'s own words and meaning: tidy it, don't pad it or add ideas of your own. Link to related notes with [[Their Title]], using titles search_notes found (or a new title worth a note of its own). A new title makes a new note. append true adds to the end of an existing note under the date; without it an existing note is never touched. task: the id of the to-do or reminder the note is about (from today's plan or list_commitments), only when ${userName} says it is about it; the note is then linked to its page in the vault. Notes can't be changed or deleted from here.`,
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

  /** A line for the model's live state. */
  function live() {
    try { const dir = vault(); const n = all(dir).length; return `- Notes vault: ${tilde(dir, fs.realpathSync(home))} (${n} note${n === 1 ? '' : 's'}).`; } catch (e) { return `- Notes vault: not usable (${e.message}).`; }
  }

  return { tools, live, pages };
}
