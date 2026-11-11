// Local-only build: notes in an Obsidian vault. The one kind of file Roamies handles itself (everything else goes
// to pi): plain .md files in one folder, ~/Documents/roamies-vault unless "vault" in
// ~/Documents/roamies-pi/settings.json says otherwise. Obsidian opens that folder as a vault; it doesn't have to be
// running, and nothing here talks to it.
//
// What the tools can do: make a note, add to the end of one, search the notes, read one. They can't change or delete
// what's already written, and can't touch anything outside the vault: a title is only ever a file name inside it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { loadSettings } from './pi.mjs';

const MAX_NOTE = 20_000; // characters written or read in one go
const MAX_FILES = 5000; // notes looked through in a search
const MAX_BYTES = 300_000; // a bigger file is searched by its title only
export const NOTE_TOOLS = ['write_note', 'search_notes', 'read_note'];

/** A title as a file name: no folders, no leading dots, none of the characters Obsidian or the file system refuse. */
export function noteName(title) {
  const n = String(title ?? '').trim().replace(/\.md$/i, '').replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+/, '').trim();
  return n.slice(0, 100).trim();
}

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const tilde = (p, home) => (p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p);
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function createNotes({ home = os.homedir(), userName = 'the user', log = () => {}, now = () => Date.now() } = {}) {
  /** The vault folder, made if it's missing. It has to be a real folder inside the home folder. */
  function vault() {
    const dir = loadSettings(home).vault;
    fs.mkdirSync(dir, { recursive: true });
    const real = fs.realpathSync(dir), realHome = fs.realpathSync(home);
    if (real === realHome || !real.startsWith(realHome + path.sep)) throw new Error(`The notes vault (${dir}) has to be a folder inside the home folder. ${userName} sets it as "vault" in ~/Documents/roamies-pi/settings.json.`);
    return real;
  }

  /** Every note in the vault: { title, file, rel, mtime }. Folders starting with a dot (.obsidian, .trash) are skipped. */
  function all(dir) {
    const out = [];
    const walk = (d, depth) => {
      if (depth > 8 || out.length >= MAX_FILES) return;
      let entries;
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f, depth + 1);
        else if (e.isFile() && /\.md$/i.test(e.name) && out.length < MAX_FILES) {
          let st; try { st = fs.statSync(f); } catch { continue; }
          out.push({ title: e.name.replace(/\.md$/i, ''), file: f, rel: path.relative(dir, f), mtime: st.mtimeMs, size: st.size });
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

  const text = (n) => { try { return n.size > MAX_BYTES ? '' : fs.readFileSync(n.file, 'utf8'); } catch { return ''; } };

  const tools = [
    {
      name: 'write_note',
      description: `Save a note in ${userName}'s Obsidian vault as a Markdown file, only when they ask to note, write down or save an idea. title is the note's name (a few plain words, no folders). content is Markdown in ${userName}'s own words and meaning: tidy it, don't pad it or add ideas of your own. Link to related notes with [[Their Title]], using titles search_notes found (or a new title worth a note of its own). A new title makes a new note. append true adds to the end of an existing note under the date; without it an existing note is never touched. Notes can't be changed or deleted from here.`,
      parameters: z.object({ title: z.string(), content: z.string(), append: z.boolean().optional() }),
      executionMode: 'sequential',
      execute: async ({ title, content, append }) => {
        const name = noteName(title);
        if (!name) throw new Error('The note needs a title: a few plain words.');
        const body = String(content ?? '').trim();
        if (!body) throw new Error('The note is empty.');
        if (body.length > MAX_NOTE) throw new Error(`That's over ${MAX_NOTE} characters. Split it into a few notes that link to each other.`);
        const dir = vault(), when = stamp(new Date(now()));
        const there = all(dir).find((n) => n.title.toLowerCase() === name.toLowerCase());
        if (there) {
          if (!append) throw new Error(`A note called "${there.title}" already exists. Add to it with append true, or pick another title.`);
          if (fs.lstatSync(there.file).isSymbolicLink()) throw new Error(`"${there.title}" is a link to somewhere else, so I left it alone.`);
          const old = text(there);
          fs.appendFileSync(there.file, `${old.endsWith('\n') || !old ? '' : '\n'}\n## ${when}\n\n${body}\n`);
          log('note_append', { chars: body.length });
          return `Added to the note "${there.title}".`;
        }
        // 'wx': never writes over a file that appeared meanwhile.
        try { fs.writeFileSync(path.join(dir, `${name}.md`), `---\ncreated: ${when}\n---\n\n${body}\n`, { flag: 'wx' }); } catch (e) {
          if (e.code === 'EEXIST') throw new Error(`Something called "${name}.md" is already in the vault and isn't a note I can add to. Pick another title.`);
          throw e;
        }
        log('note_new', { chars: body.length });
        return `Saved the note "${name}" in the vault.`;
      },
    },
    {
      name: 'search_notes',
      description: `Search ${userName}'s notes vault by words in titles and text; an empty query lists the most recently changed notes. Use when they ask what's in their notes, and before writing a note that should link to others. Returns titles with the matching lines; read_note gives a whole note.`,
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        const dir = vault(), notes = all(dir);
        if (!notes.length) return 'The vault has no notes yet.';
        const day = (ms) => new Date(ms).toISOString().slice(0, 10);
        const terms = [...new Set(String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean))].slice(0, 8);
        if (!terms.length) return `${notes.length} note${notes.length === 1 ? '' : 's'}. Most recently changed:\n${notes.sort((a, b) => b.mtime - a.mtime).slice(0, 20).map((n) => `- ${n.title} (${day(n.mtime)})`).join('\n')}`;
        const scored = [];
        for (const n of notes) {
          const body = text(n), title = n.title.toLowerCase(), lower = body.toLowerCase();
          const hit = terms.filter((t) => title.includes(t) || lower.includes(t));
          if (!hit.length) continue;
          let score = hit.length * 100;
          for (const t of hit) { if (title.includes(t)) score += 20; score += Math.min(10, lower.split(t).length - 1); }
          const lines = body.split('\n').filter((l) => l.trim() && !/^---\s*$/.test(l) && hit.some((t) => l.toLowerCase().includes(t))).slice(0, 3).map((l) => `  ${clip(l.trim(), 200)}`);
          scored.push({ n, score, all: hit.length === terms.length, lines });
        }
        // Notes with every word come first; if none has them all, ones with any.
        const full = scored.filter((s) => s.all), pool = (full.length ? full : scored).sort((a, b) => b.score - a.score || b.n.mtime - a.n.mtime);
        if (!pool.length) return `No note mentions "${query}".`;
        const head = full.length ? '' : `No note has all of those words; these have some:\n`;
        return `${head}${pool.slice(0, 8).map((s) => `- ${s.n.title}${path.dirname(s.n.rel) === '.' ? '' : ` (in ${path.dirname(s.n.rel)})`} (${day(s.n.mtime)})${s.lines.length ? `\n${s.lines.join('\n')}` : ''}`).join('\n')}${pool.length > 8 ? `\n…and ${pool.length - 8} more.` : ''}`;
      },
    },
    {
      name: 'read_note',
      description: `Read one note from ${userName}'s vault by its title (as search_notes gave it). Use when they ask what a note says.`,
      parameters: z.object({ title: z.string() }),
      execute: async ({ title }) => {
        const { note, error } = find(all(vault()), title);
        if (error) throw new Error(error);
        const body = fs.readFileSync(note.file, 'utf8');
        return `# ${note.title}\n\n${body.length > MAX_NOTE ? `${body.slice(0, MAX_NOTE)}\n[Cut off: the note is longer than this.]` : body}`;
      },
    },
  ];

  /** A line for the model's live state. */
  function live() {
    try { const dir = vault(); const n = all(dir).length; return `- Notes vault: ${tilde(dir, fs.realpathSync(home))} (${n} note${n === 1 ? '' : 's'}).`; } catch (e) { return `- Notes vault: not usable (${e.message}).`; }
  }

  return { tools, live };
}
