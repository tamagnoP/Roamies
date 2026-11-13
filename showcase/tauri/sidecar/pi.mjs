// Local-only build: file work is handed to pi (the pi coding agent), never done by Roamies itself.
//
// How a hand-off goes:
//   1. The model calls ask_pi with a prompt. Nothing is sent yet.
//   2. The exact prompt, the folder and the mode are shown in a bubble with Send / Don't send, and read aloud.
//      Only a click on Send, the Y key, or saying "send" lets it through.
//   3. pi runs in the background, in the project folder, as `pi --mode json` (its JSON event stream).
//   4. Each step pi takes shows in a bubble. Its reply (an answer, or a question back) is shown in full and read
//      aloud by the app itself, not retold by the model.
//   5. Everything is kept in ~/Documents/roamies-pi/log, one .jsonl file per hand-off.
// pi runs under a macOS sandbox (see sandboxProfile): it writes only in the project, reads only the folders the owner
// listed, and never the settings, the records, or keys.
//
// ~/Documents/roamies-pi/settings.json holds the project folder pi starts in and the list of projects to pick from.
// Only the user edits that file: Roamies makes it the first time and never writes it again. The model can switch
// between listed projects, after a yes; that choice is kept beside it, in state.json.
// While pi is working, Roamies' other tools are refused (gateTools): it can talk, keep the to-do list, or stop pi.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const READ_TOOLS = 'read,grep,find,ls';
const SHOW_MAX = 600; // characters of a prompt the approval bubble holds; longer ones are also saved to pending.txt
const STEP_GAP = 4000; // ms between step bubbles: a burst of steps shows as one line, the latest
const LIVE_MAX = 3000; // characters of pi's last reply the model is given

// Tools taken out of Roamies: files and commands are pi's job.
export const REMOVED = new Set(['read_file', 'list_files', 'search_files', 'write_file', 'edit_file', 'run_command', 'fetch_url']);
// What still works while pi is busy.
const DURING = new Set(['stop_pi', 'remember_commitment', 'update_commitment', 'forget_fact', 'list_commitments', 'show_list', 'write_note', 'search_notes', 'read_note']);

export const isSend = (text) => /^\s*(send|send it|yes|yeah|yep|yup|ok|okay|go|go ahead|do it|approve|approved|confirm)\b/i.test(String(text ?? ''));

const tilde = (p, home) => (p === home ? '~' : p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p);
const expand = (p, home) => path.resolve(String(p).replace(/^~(?=$|\/)/, home));
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
const base = (p) => path.basename(String(p ?? '')) || String(p ?? '');

/** One line for a step pi takes, from a tool_execution_start event. */
export function describeStep(tool, args = {}) {
  const file = base(args.path ?? args.file_path ?? args.file ?? '');
  switch (tool) {
    case 'read': return `reading ${file || 'a file'}`;
    case 'edit': return `editing ${file || 'a file'}`;
    case 'write': return `writing ${file || 'a file'}`;
    case 'bash': return `running ${clip(String(args.command ?? 'a command').replace(/\s+/g, ' ').trim(), 70)}`;
    case 'grep': return `searching for "${clip(String(args.pattern ?? ''), 40)}"`;
    case 'find': return `finding ${clip(String(args.pattern ?? 'files'), 40)}`;
    case 'ls': return `listing ${file || 'the folder'}`;
    default: return `using ${tool}`;
  }
}

/** The text of an assistant message from pi's event stream. */
export function messageText(message) {
  const c = message?.content;
  if (typeof c === 'string') return c.trim();
  if (!Array.isArray(c)) return '';
  return c.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('').trim();
}

/** A reply as it's read aloud: code and tables stay on screen, markup is dropped. */
export function forVoice(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' (code, shown on screen) ')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- the sandbox pi runs in
// pi, its login shell and everything they start run under a macOS sandbox profile (sandbox-exec), so the file limits
// below are enforced by the system, not by pi's instructions. The profile is built here from the project folder and
// the settings, with real paths, and handed to sandbox-exec as an argument: nothing is written to disk.
const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
// Folders developer and ML tools keep in the home folder, which pi may read and never write. "toolFolders" in the
// settings adds to these; "toolFoldersOff" drops one.
export const TOOL_FOLDERS = [
  '~/.anaconda', '~/.conda', '~/.condarc', '~/.continuum', '~/.cargo', '~/.local', '~/.npm',
  '~/.cache/huggingface', '~/.cache/uv', '~/.cache/fontconfig', '~/.cache/tree-sitter', '~/.cache/chroma',
  '~/.cellpose', '~/.matplotlib', '~/.ipython', '~/.jupyter', '~/.duckdb',
  '~/.config/git', '~/.config/rstudio',
  '~/Library/Jupyter', '~/Library/Fonts', '~/Library/Caches/pip',
];
// What the login shell and git read on the way to starting pi. Readable always.
const STARTUP = ['.bash_profile', '.bashrc', '.bash_login', '.profile', '.zshenv', '.zprofile', '.zshrc', '.zlogin', '.gitconfig'];
// Inside pi's own folder (~/.pi/agent), all of which it can read, the only things it can write: its session files; its
// sign-in (refreshed tokens); and the lock folders it makes and removes beside its sign-in, settings and trust files
// while it reads them (without the trust lock it doesn't start; without the settings lock it ignores its settings).
// A lock is an empty folder: the settings and trust files themselves, and pi's instructions, skills, packages,
// extensions and tools, are not writable.
const PI_WRITES = [['subpath', 'sessions'], ['literal', 'auth.json'], ['subpath', 'auth.json.lock'], ['subpath', 'settings.json.lock'], ['subpath', 'trust.json.lock']];
// Never readable or writable, wherever they sit and whatever lists a folder around them. (home, roamies-pi folder)
const BLOCKED = (h, r) => [
  ['literal', `${r}/settings.json`], ['literal', `${r}/state.json`], ['subpath', `${r}/log`],
  ['subpath', `${h}/.ssh`], ['subpath', `${h}/.gnupg`], ['subpath', `${h}/.gg`], ['subpath', `${h}/.claude`],
  ['subpath', `${h}/Library/Keychains`], ['subpath', '/Library/Keychains'],
  ['subpath', `${h}/Library/Application Support/superProductivity`],
  ['subpath', `${h}/.config/gh`], ['literal', `${h}/.cache/huggingface/token`], ['subpath', `${h}/.cache/huggingface/stored_tokens`],
  ['subpath', `${h}/.orbstack/ssh`], ['subpath', `${h}/.orbstack/config`],
  // saved sign-ins that sit inside readable tool folders (~/.cargo, ~/.config/git)
  ['literal', `${h}/.cargo/credentials.toml`], ['literal', `${h}/.cargo/credentials`], ['literal', `${h}/.config/git/credentials`],
];
// Where external drives are mounted. Nothing under it is readable but the folders the owner listed.
const VOLUMES = '/Volumes';
// Programs that reach outside the sandbox by asking the system or another app to act.
const NO_EXEC = ['/usr/bin/security', '/usr/bin/osascript', '/usr/bin/open'];

/** A path with its symbolic links resolved, as the sandbox sees it. One that doesn't exist (yet) is resolved as far
 *  as it does exist. */
function realPath(p) {
  const rest = [];
  for (let cur = path.resolve(String(p)); ;) {
    try { return path.join(fs.realpathSync(cur), ...rest); } catch { /* go up */ }
    const up = path.dirname(cur);
    if (up === cur) return path.resolve(String(p));
    rest.unshift(path.basename(cur)); cur = up;
  }
}
const inside = (p, dir) => p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);

/** The sandbox profile for a hand-off in `project`: { profile, reads, docker }. reads is how many of the owner's
 *  folders pi can read (the project, the other "projects" and "readOnly"); docker is whether this project is in "docker".
 *  In the profile a later rule wins over an earlier one, so the order is the policy: the blocked paths come last. */
export function sandboxProfile({ home, project, settings, tmpdir = os.tmpdir(), volumes = VOLUMES }) {
  const q = (p) => { if (/[\0\n\r]/.test(p)) throw new Error(`a folder name with a line break in it (${JSON.stringify(p)})`); return `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`; };
  const rule = ([kind, p]) => `(${kind} ${q(p)})`;
  const sub = (list) => list.map((p) => rule(['subpath', p])).join(' ');
  const uniq = (list) => [...new Set(list)];
  const h = realPath(home), proj = realPath(project), roamies = realPath(settings.dir), vol = realPath(volumes);
  const others = uniq(settings.projects.map((p) => realPath(p.dir))).filter((p) => p !== proj);
  const readOnly = uniq((settings.readOnly ?? []).map(realPath)).filter((p) => p !== proj);
  const tools = uniq((settings.toolFolders ?? []).map(realPath));
  const docker = (settings.docker ?? []).some((d) => realPath(d) === proj);
  const agent = realPath(path.join(home, '.pi', 'agent'));
  const temp = uniq(['/private/tmp', '/private/var/tmp', realPath(tmpdir)].flatMap((t) => (path.basename(t) === 'T' && t.startsWith('/private/var/folders/') ? [t, path.join(path.dirname(t), 'C')] : [t])));
  // Readable inside the home folder, beyond the owner's listed folders: pi's own folder, the shell's start-up files,
  // the tool folders, the folder an absolute "pi" command sits in, and (with Docker allowed) what docker reads.
  const own = [realPath(path.join(home, '.pi')), ...STARTUP.map((f) => path.join(h, f)), ...tools];
  if (path.isAbsolute(settings.pi)) own.push(path.dirname(realPath(settings.pi)), path.dirname(path.resolve(settings.pi)));
  const dockerReads = [`${h}/.docker`, `${h}/.orbstack/bin`, `${h}/.orbstack/run`, `${h}/.orbstack/shell`];
  const dockerSockets = `(subpath ${q(`${h}/.orbstack/run`)}) (subpath ${q(`${h}/.docker/run`)}) (literal "/private/var/run/docker.sock") (literal "/var/run/docker.sock")`;
  const listed = uniq([proj, ...others, ...readOnly]);
  // A folder listed through a symbolic link (~/gdrive) is allowed by its real path; the link itself has to be readable
  // too, for the path as the owner wrote it to work.
  const links = [];
  const below = (at, top) => inside(at, top) && at !== top;
  for (const p of [project, ...settings.projects.map((x) => x.dir), ...(settings.readOnly ?? []), ...(settings.toolFolders ?? [])]) {
    for (let at = path.resolve(String(p)); below(at, path.resolve(home)) || below(at, path.resolve(volumes)); at = path.dirname(at)) {
      try { if (fs.lstatSync(at).isSymbolicLink()) links.push(path.join(realPath(path.dirname(at)), path.basename(at))); } catch { /* not there */ }
    }
  }
  // The startup disk also appears among the external drives, as a link to "/". The link stays readable, so a path
  // written through it works; what it leads to is under the other rules.
  let startup = [];
  try { startup = fs.readdirSync(vol).map((n) => path.join(vol, n)).filter((p) => { try { return fs.lstatSync(p).isSymbolicLink() && fs.realpathSync(p) === path.parse(p).root; } catch { return false; } }); } catch { /* no such folder */ }
  const readable = uniq([...own, ...(docker ? dockerReads : []), ...listed]);
  // The folders above a readable one can be seen to exist (so a path can be walked), but not listed or read. The
  // same goes for the drives folder itself, and the folders above a listed folder on an external drive.
  const above = new Set([vol]);
  const climb = (p, top) => { for (let up = path.dirname(p); inside(up, top); up = path.dirname(up)) { above.add(up); if (up === top) break; } };
  for (const p of [...readable, ...links]) { climb(p, h); climb(p, vol); }
  // Listed folders pi must not write: every one but the project. One that holds the project is left to the
  // deny-everything rule; one inside the project, or anywhere else, is denied after the project is allowed, so
  // "readOnly" and other projects win over the project they sit in.
  const noWrite = uniq([...others, ...readOnly, ...tools]).filter((p) => !inside(proj, p));
  const lines = [
    '(version 1)',
    '(allow default)', // the network, processes and everything outside the rules below are left as they are
    ';; writing: nowhere, but temporary folders, what pi must write of its own, and the project',
    '(deny file-write* (subpath "/"))',
    `(allow file-write* (subpath "/dev") ${sub(temp)})`,
    `(allow file-write* ${PI_WRITES.map(([kind, f]) => rule([kind, path.join(agent, f)])).join(' ')})`,
    `(allow file-write* (subpath ${q(proj)}))`,
    ...(noWrite.length ? [`(deny file-write* ${sub(noWrite)})`] : []),
    ';; reading: nothing in the home folder, but pi\'s own folder, start-up files, tool folders and the listed folders',
    `(deny file-read* (subpath ${q(h)}))`,
    ';; nor on an external drive, but in a listed folder there',
    `(deny file-read* (subpath ${q(vol)}))`,
    `(allow file-read-metadata ${[...above].map((p) => rule(['literal', p])).join(' ')})`,
    `(allow file-read* ${sub(readable)})`,
    ...(links.length || startup.length ? [`(allow file-read* ${uniq([...links, ...startup]).map((p) => rule(['literal', p])).join(' ')})`] : []),
    ';; programs that act outside the sandbox, Apple Events, and Docker',
    `(deny process-exec* ${NO_EXEC.map((p) => rule(['literal', p])).join(' ')})`,
    '(deny appleevent-send)',
    ...(docker ? [] : [`(deny network-outbound (remote unix-socket ${dockerSockets}))`]),
    ';; blocked whatever is listed above',
    `(deny file-read* file-write* ${BLOCKED(h, roamies).map(rule).join(' ')})`,
  ];
  return { profile: `${lines.join('\n')}\n`, reads: listed.length, docker };
}

/** Why a profile can't be applied on this Mac, or '' when it can: sandbox-exec is run once with it, on /usr/bin/true. */
export function sandboxProblem(profile, exec = SANDBOX_EXEC) {
  try {
    const r = spawnSync(exec, ['-p', profile, '/usr/bin/true'], { encoding: 'utf8', timeout: 10_000 });
    if (r.error) return r.error.code === 'ENOENT' ? `${exec} is missing` : r.error.message;
    if (r.status !== 0) return clip((r.stderr || '').trim().split('\n').filter(Boolean).at(-1) || `sandbox-exec exited with ${r.status ?? r.signal}`, 160);
    return '';
  } catch (e) { return e.message; }
}

// voice: the Mac voice for every look ('' = the system voice); voices: one per look, which wins over voice.
const DEFAULT_VOICES = { jarvis: 'Daniel' }; // JARVIS speaks British English unless the settings say otherwise
const HOME_CORNERS = ['bottom-left', 'bottom-right', 'top-left', 'top-right']; // the first is the default
const NEVER_LOOK = ['1Password', 'Bitwarden', 'KeePassXC', 'Keychain Access', 'Passwords', 'Messages']; // guard.mjs
// pi's own folder is a subfolder, so the settings file isn't in the folder pi is started in.
const DEFAULTS = (dir) => ({ project: `${dir}/workspace`, projects: [`${dir}/workspace`], pi: 'pi', maxMinutes: 60, keepLogsDays: 30, autoSendReadOnly: 5, progressSeconds: 90, routines: {}, briefings: {}, voice: '', voices: DEFAULT_VOICES, vault: '~/Documents/roamies-vault', neverLook: NEVER_LOOK, sandbox: true, readOnly: [], toolFolders: [], toolFoldersOff: [], docker: [], home: 'bottom-left' });

/** What Roamies itself keeps in ~/Documents/roamies-pi/state.json: the project chosen with switch_project, and the
 *  days the briefings were given. {} when there's none or it can't be read. */
function readState(dir) {
  try { const s = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')); return s && typeof s === 'object' && !Array.isArray(s) ? s : {}; } catch { return {}; }
}
const writeState = (dir, state) => fs.writeFileSync(path.join(dir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);

/** Reads ~/Documents/roamies-pi/settings.json, making the folder and the file the first time. After that the file is
 *  the owner's alone: nothing here, or anywhere else in Roamies, writes it. */
export function loadSettings(home) {
  const dir = path.join(home, 'Documents', 'roamies-pi'), file = path.join(dir, 'settings.json');
  fs.mkdirSync(path.join(dir, 'log'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'workspace'), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, `${JSON.stringify(DEFAULTS(tilde(dir, home)), null, 2)}\n`);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${tilde(file, home)} isn't valid JSON (${e.message}). Fix or delete it.`); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${tilde(file, home)} should be a JSON object.`);
  // projects: a list of folders (named by their last part), or { name: folder }.
  const list = Array.isArray(raw.projects) ? raw.projects.map((p) => [base(expand(p, home)), p]) : raw.projects && typeof raw.projects === 'object' ? Object.entries(raw.projects) : [];
  // The settings folder itself used to be pi's default project. It no longer can be one (pi could rewrite these
  // settings), so it means its workspace subfolder now.
  const moved = (p) => (p === dir ? path.join(dir, 'workspace') : p);
  const projects = list.filter(([n, p]) => n && typeof p === 'string' && p.trim()).map(([name, p]) => { const d = moved(expand(p.trim(), home)); return { name: d === path.join(dir, 'workspace') ? 'workspace' : String(name), dir: d }; });
  const fileProject = moved(expand(typeof raw.project === 'string' && raw.project.trim() ? raw.project.trim() : path.join(dir, 'workspace'), home));
  // The project chosen with switch_project (state.json) counts while it's still listed under "projects" and "project"
  // in the settings file is what it was when the switch was made. A "project" the owner has edited since wins.
  const state = readState(dir);
  const at = (v) => (typeof v === 'string' && v.trim() ? moved(expand(v.trim(), home)) : null);
  const chosen = at(state.project);
  const project = chosen && at(state.projectWas) === fileProject && projects.some((p) => p.dir === chosen) ? chosen : fileProject;
  if (!projects.some((p) => p.dir === project)) projects.unshift({ name: base(project), dir: project });
  const minutes = Number(raw.maxMinutes);
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const voices = raw.voices && typeof raw.voices === 'object' && !Array.isArray(raw.voices) ? Object.fromEntries(Object.entries(raw.voices).map(([k, v]) => [k.toLowerCase(), str(v)]).filter(([, v]) => v)) : raw.voices === undefined ? { ...DEFAULT_VOICES } : {};
  const vault = expand(str(raw.vault) || '~/Documents/roamies-vault', home); // the Obsidian vault Roamies keeps notes in (notes.mjs)
  const neverLook = Array.isArray(raw.neverLook) ? raw.neverLook.map(str).filter(Boolean) : [...NEVER_LOOK];
  const keep = Number(raw.keepLogsDays);
  const num = (v, d) => (v === undefined || v === null || !(Number(v) >= 0) ? d : Number(v));
  // routines: { "what you say": ["step", "step"] }; briefings: { "morning": "09:00", "evening": "18:30" }
  const routines = raw.routines && typeof raw.routines === 'object' && !Array.isArray(raw.routines)
    ? Object.entries(raw.routines).map(([name, steps]) => ({ name: str(name), steps: (Array.isArray(steps) ? steps : [steps]).map(str).filter(Boolean) })).filter((r) => r.name && r.steps.length) : [];
  const clock = (v) => { const m = /^(\d{1,2}):(\d{2})$/.exec(str(v)); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; };
  const briefings = raw.briefings && typeof raw.briefings === 'object' ? { morning: clock(raw.briefings.morning), evening: clock(raw.briefings.evening) } : { morning: null, evening: null };
  // The sandbox (all four are read from this file only). sandbox: on unless it says false. readOnly: more folders pi
  // may read. toolFolders: more tool folders, added to the built-in ones; toolFoldersOff: built-in ones to drop.
  // docker: the projects where pi may reach Docker.
  const folders = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean).map((p) => expand(p, home)) : []);
  const off = new Set(folders(raw.toolFoldersOff));
  const toolFolders = [...new Set([...TOOL_FOLDERS.map((p) => expand(p, home)).filter((p) => !off.has(p)), ...folders(raw.toolFolders)])];
  // home: where the character rests on the desktop in its default and small sizes (the overlay's home.js): a corner,
  // or { x, y } in screen points. Anything else is the default corner.
  const corner = str(raw.home).toLowerCase(), point = raw.home && typeof raw.home === 'object' && Number.isFinite(raw.home.x) && Number.isFinite(raw.home.y) && typeof raw.home.x === 'number' && typeof raw.home.y === 'number';
  const homeSpot = point ? { x: raw.home.x, y: raw.home.y } : HOME_CORNERS.includes(corner) ? corner : HOME_CORNERS[0];
  return { dir, file, raw, home: homeSpot, project, fileProject, projects, sandbox: raw.sandbox !== false, readOnly: folders(raw.readOnly), toolFolders, docker: folders(raw.docker), vault, neverLook, routines, briefings, autoSendReadOnly: num(raw.autoSendReadOnly, 5), progressSeconds: num(raw.progressSeconds, 90), keepLogsDays: keep >= 0 && raw.keepLogsDays !== undefined ? keep : 30, voice: str(raw.voice), voices, pi: typeof raw.pi === 'string' && raw.pi.trim() ? raw.pi.trim() : 'pi', maxMinutes: minutes > 0 ? minutes : 60 };
}

/** Where the character rests on the desktop (the "home" setting): a corner, or { x, y }. Never throws. */
export function homeFor(home = os.homedir()) {
  try { return loadSettings(home).home; } catch { return HOME_CORNERS[0]; }
}

/** The Mac voice a look speaks in (a name from `say -v '?'`), or '' for the system voice. Never throws. */
export function voiceFor(look, home = os.homedir()) {
  try { const s = loadSettings(home); return s.voices[String(look ?? '').toLowerCase()] || s.voice || ''; } catch { return ''; }
}

/** Why a folder can't be pi's project, or '' when it can: it must exist, and be inside the home folder. */
export function projectProblem(dir, home) {
  let real;
  try { real = fs.realpathSync(dir); } catch { return `The folder ${tilde(dir, home)} doesn't exist.`; }
  if (!fs.statSync(real).isDirectory()) return `${tilde(dir, home)} isn't a folder.`;
  const realHome = fs.realpathSync(home);
  if (real === realHome) return 'The whole home folder can\'t be a project: pick a folder inside it.';
  if (!real.startsWith(realHome + path.sep)) return `${dir} is outside the home folder.`;
  // Not the settings folder, nor a folder with it inside: pi must not be started where it can rewrite its own settings.
  let settingsDir; try { settingsDir = fs.realpathSync(path.join(home, 'Documents', 'roamies-pi')); } catch { settingsDir = null; }
  if (settingsDir && (real === settingsDir || settingsDir.startsWith(real + path.sep))) return `${tilde(dir, home)} holds Roamies' own settings, so it can't be a project. Use a folder beside it or inside it, like ~/Documents/roamies-pi/workspace.`;
  return '';
}

/** A snapshot of a project as it is now, kept as a git ref (refs/roamies/<stamp>) without touching the branch, the
 *  index or any file: the tracked files as they are, plus new files up to 2 MB each that .gitignore doesn't exclude.
 *  { ref } on success, { why } when there's none (not a git repository, git missing, or it failed). */
export function snapshot(project, stampText, { init = false } = {}) {
  const git = (args, opts = {}) => spawnSync('git', ['-c', 'user.name=Roamies', '-c', 'user.email=roamies@localhost', ...args], { cwd: project, encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 * 1024, ...opts });
  try {
    let inside = git(['rev-parse', '--is-inside-work-tree']);
    if (inside.error) return { why: 'git isn\'t installed' };
    if (inside.status !== 0 && init) { git(['init', '-q']); inside = git(['rev-parse', '--is-inside-work-tree']); }
    if (inside.status !== 0 || inside.stdout.trim() !== 'true') return { why: 'not a git repository' };
    const gitDir = path.resolve(project, git(['rev-parse', '--git-dir']).stdout.trim());
    const index = path.join(gitDir, `roamies-index-${process.pid}-${Date.now()}`);
    const env = { ...process.env, GIT_INDEX_FILE: index };
    try {
      const head = git(['rev-parse', '--verify', '-q', 'HEAD']).stdout.trim();
      if (head && git(['read-tree', head], { env }).status !== 0) return { why: 'git couldn\'t read the last commit' };
      if (git(['add', '-u'], { env }).status !== 0) return { why: 'git couldn\'t record the changed files' };
      const fresh = git(['ls-files', '-o', '--exclude-standard', '-z'], { env }).stdout.split('\0').filter(Boolean)
        .filter((f) => { try { const st = fs.lstatSync(path.join(project, f)); return st.isFile() && st.size <= 2 * 1024 * 1024; } catch { return false; } }).slice(0, 5000);
      if (fresh.length && git(['add', '--pathspec-from-file=-', '--pathspec-file-nul'], { env, input: fresh.join('\0') }).status !== 0) return { why: 'git couldn\'t record the new files' };
      const tree = git(['write-tree'], { env }).stdout.trim();
      if (!tree) return { why: 'git couldn\'t write the snapshot' };
      const commit = git(['commit-tree', tree, ...(head ? ['-p', head] : []), '-m', `Roamies snapshot before pi could edit (${stampText})`]).stdout.trim();
      const ref = `refs/roamies/${stampText}`;
      if (!commit || git(['update-ref', ref, commit]).status !== 0) return { why: 'git couldn\'t save the snapshot' };
      return { ref };
    } finally { fs.rmSync(index, { force: true }); fs.rmSync(`${index}.lock`, { force: true }); }
  } catch (e) { return { why: e.message }; }
}

export function createPi({ home = os.homedir(), userName = 'the user', say = () => {}, tell = () => {}, onDone = null, ask, log = () => {}, onChange = () => {}, spawnImpl = spawn, shell = process.env.SHELL || '/bin/zsh', sandboxExec = SANDBOX_EXEC, volumes = VOLUMES, now = () => Date.now() } = {}) {
  let job = null; // the hand-off pi is working on
  let last = null; // the one before: { prompt, mode, project, status, reply, at }
  let approval = null; // an approval waiting for Send: { answer(text) }
  const sessions = new Map(); // project folder -> pi session id of the last hand-off there
  let seq = 0;
  let seen = null; // the settings file as it was at the last hand-off, to notice a change made behind Roamies' back
  const settingsText = (s) => { try { return fs.readFileSync(s.file, 'utf8'); } catch { return ''; } };

  const stamp = (d = new Date(now())) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;

  /** Shows the hand-off and waits for Send (a click, the Y key, or the word "send"). */
  async function approve({ prompt, mode, project, followUp, dir, notes = [], auto = 0 }, signal) {
    const where = tilde(project, home);
    // auto: a read-only task is sent after this many seconds unless it's stopped. One that can edit always waits for Send.
    const head = `${auto ? `Asking pi in ${auto} s` : 'Send to pi?'}  ${mode === 'edit' ? 'CAN EDIT files and run commands' : 'Read only'} · in ${where}${followUp ? ' · continues the last pi task' : ''}${notes.map((n) => `\n${n}`).join('')}`;
    let body = prompt;
    const pendingFile = path.join(dir, 'pending.txt');
    if (prompt.length > SHOW_MAX) {
      fs.writeFileSync(pendingFile, `${head}\n\n${prompt}\n`);
      body = `${prompt.slice(0, SHOW_MAX - 100)}… (the whole text is in ${tilde(pendingFile, home)})`;
    }
    tell(null, auto ? `Asking pi: ${forVoice(prompt)}` : `For pi, ${mode === 'edit' ? 'with editing allowed' : 'read only'}${followUp ? ', continuing the last task' : ''}. ${forVoice(prompt)} Say send to send it.`);
    const closing = new AbortController();
    const signals = signal ? AbortSignal.any([signal, closing.signal]) : closing.signal;
    let by = 'click';
    const voiced = new Promise((resolve) => { approval = { listening: false, answer: (text) => { by = 'voice'; resolve(isSend(text)); } }; });
    // Once the user has started talking, the answer is what they say: a bubble that closes meanwhile isn't a "no".
    const clicked = ask({ placeholder: `${head}\n\n${body}`, choices: [auto ? 'Send now' : 'Send', "Don't send"] }, signals).then((a) => (a == null && approval?.listening ? new Promise(() => {}) : isSend(a)));
    // The countdown. Once the user starts talking it no longer counts: what they say decides.
    let timer = null;
    const timed = auto ? new Promise((resolve) => { timer = setTimeout(() => { if (approval?.listening) return; by = 'auto'; resolve(true); }, auto * 1000); }) : new Promise(() => {});
    try {
      const ok = await Promise.race([clicked, voiced, timed]);
      return { ok, by };
    } finally {
      clearTimeout(timer);
      approval = null;
      closing.abort(); // closes the bubble if it was answered by voice or went by itself
      fs.rmSync(pendingFile, { force: true });
    }
  }

  function start({ prompt, mode, project, followUp, settings, by, snap = null, box = null }) {
    const id = ++seq, t0 = now();
    // Old records go: keepLogsDays in the settings (30 unless it says otherwise; 0 keeps them all).
    if (settings.keepLogsDays > 0) {
      try {
        const logs = path.join(settings.dir, 'log'), cutoff = t0 - settings.keepLogsDays * 864e5;
        for (const f of fs.readdirSync(logs)) { const p = path.join(logs, f); if (f.endsWith('.jsonl') && fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true }); }
      } catch { /* best effort */ }
    }
    const record = path.join(settings.dir, 'log', `${stamp()}_${String(id).padStart(3, '0')}_${mode}.jsonl`); // one file per hand-off
    const write = (o) => { try { fs.appendFileSync(record, `${typeof o === 'string' ? o : JSON.stringify(o)}\n`); } catch { /* the record is best effort */ } };
    const session = followUp ? sessions.get(project) : null;
    // "--" ends pi's options; a leading @ would attach a file, so it's kept off the front.
    const text = prompt.startsWith('@') ? ` ${prompt}` : prompt;
    const args = ['--mode', 'json', ...(mode === 'read' ? ['--tools', READ_TOOLS] : []), ...(session ? ['--session', session] : []), '--', text];
    write({ type: 'roamies_handoff', at: new Date(t0).toISOString(), project, mode, follow_up: !!session, approved_by: by, snapshot: snap?.ref ?? null, undo: snap?.ref ? `git -C "${project}" restore --source=${snap.ref} --worktree -- .` : null, prompt, command: [settings.pi, ...args.slice(0, -1), '<prompt>'], sandbox: box ? 'on' : settings.sandbox ? 'not applied' : 'off', docker: box ? box.docker : undefined });
    const env = { ...process.env };
    if (path.isAbsolute(settings.pi)) env.PATH = `${path.dirname(settings.pi)}${path.delimiter}${env.PATH ?? ''}`; // node sits beside it
    // A login shell, so pi and node are found the way they are in Terminal. The prompt travels as an argument, never as shell text.
    // Under the sandbox it's sandbox-exec that starts the shell, so the shell's start-up, pi and all they run are confined.
    const line = [shell, '-lc', 'exec "$0" "$@"', settings.pi, ...args];
    const [cmd, ...cmdArgs] = box ? [sandboxExec, '-p', box.profile, ...line] : line;
    const child = spawnImpl(cmd, cmdArgs, { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const j = job = { id, prompt, mode, project, at: t0, child, snapshot: snap?.ref ?? null, stopped: false, reply: '', problem: '', stderr: '', steps: 0, record };
    log('pi_start', { mode, followUp: !!session, chars: prompt.length });
    onChange();
    let stepAt = 0, stepTimer = null, stepText = '';
    const step = (line) => {
      j.steps++;
      const next = `Pi's ${line}…`;
      if (next === stepText) return; // the same thing again: nothing new to show
      stepText = next;
      const wait = stepAt + STEP_GAP - now();
      if (wait <= 0) { stepAt = now(); say(stepText); } else if (!stepTimer) stepTimer = setTimeout(() => { stepTimer = null; stepAt = now(); if (job === j) say(stepText); }, wait);
    };
    const onEvent = (e) => {
      if (e.type === 'session' && typeof e.id === 'string') sessions.set(project, e.id);
      else if (e.type === 'tool_execution_start') step(describeStep(e.toolName, e.args));
      else if (e.type === 'auto_retry_start') step('trying again after an error');
      else if (e.type === 'compaction_start') step('tidying its memory');
      else if (e.type === 'message_end' && e.message?.role === 'assistant') {
        const t = messageText(e.message);
        if (t) j.reply = t;
        j.problem = e.message.stopReason === 'error' ? String(e.message.errorMessage ?? 'the model returned an error') : '';
      }
    };
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      for (let at; (at = buf.indexOf('\n')) >= 0;) {
        const line = buf.slice(0, at).replace(/\r$/, ''); buf = buf.slice(at + 1);
        if (!line.trim()) continue;
        let e;
        try { e = JSON.parse(line); } catch { write({ type: 'roamies_unparsed', line: clip(line, 2000) }); continue; }
        if (e.type !== 'message_update') write(line); // the streaming deltas are left out; message_end has the whole text
        try { onEvent(e); } catch (err) { console.error('pi event', err); }
      }
    });
    child.stderr.on('data', (d) => { j.stderr = (j.stderr + d.toString('utf8')).slice(-4000); });
    // Every so often on a long task, a spoken line so the silence isn't a mystery (only with spoken replies on).
    let told = 0;
    const lines = [(n, w) => `Still on it. Pi's ${n} step${n === 1 ? '' : 's'} in${w}.`, (n, w) => `Pi's still working${w}. ${n} step${n === 1 ? '' : 's'} so far.`, (n, w) => `Bear with me, pi's not done yet${w}.`];
    const progress = settings.progressSeconds > 0 ? setInterval(() => { if (job === j) tell(null, lines[told++ % lines.length](j.steps, stepText ? `, ${stepText.replace(/^Pi's /, '').replace(/…$/, '')} right now` : '')); }, settings.progressSeconds * 1000) : null;
    const timer = setTimeout(() => { j.problem = `it ran for over ${settings.maxMinutes} minutes, so I stopped it`; j.stopped = 'timeout'; child.kill(); }, settings.maxMinutes * 60_000);
    let finished = false;
    const finish = (code, spawnError) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer); clearTimeout(stepTimer); clearInterval(progress);
      const errText = spawnError ? spawnError.message : j.stderr.trim().split('\n').filter(Boolean).slice(-3).join(' ');
      let status = 'done';
      if (j.stopped === true) status = 'stopped';
      else if (code === 127 || /command not found|No such file or directory/i.test(spawnError?.message ?? (code ? errText : ''))) { status = 'error'; j.problem = `I couldn't start pi ("${settings.pi}" wasn't found). Put its full path, from \`which pi\` in Terminal, as "pi" in ${tilde(settings.file, home)}.`; }
      else if (j.problem || code || !j.reply) { status = 'error'; j.problem ||= errText || (code ? `pi exited with code ${code}` : 'pi finished without a reply'); }
      last = { prompt: j.prompt, mode: j.mode, project: j.project, snapshot: j.snapshot, status, reply: j.reply, problem: status === 'error' ? j.problem : '', at: now() };
      write({ type: 'roamies_result', at: new Date(now()).toISOString(), status, exit: code ?? null, ms: now() - t0, steps: j.steps, reply: j.reply, problem: last.problem || undefined });
      log('pi_end', { status, ms: now() - t0, steps: j.steps, chars: j.reply.length });
      if (job === j) job = null;
      onChange();
      // What's put on screen: pi's own words, whole and unchanged.
      const shown = status === 'stopped' ? 'Stopped pi.' : status === 'error' ? `Pi hit a problem: ${j.problem}${j.reply ? `\n\nBefore that it said:\n\n${j.reply}` : ''}` : `Here's what pi came back with:\n\n${j.reply}`;
      const result = { status, reply: j.reply, problem: last.problem, prompt: j.prompt, mode: j.mode, snapshot: j.snapshot, shown };
      // The app decides how it's told (sidekick.mjs: Roamies says the gist in its own voice, then the full reply goes on
      // screen). Without one, it's shown and read out as it is.
      if (onDone) Promise.resolve().then(() => onDone(result)).catch((e) => { console.error('pi relay', e); tell(shown, null); });
      else tell(shown, status === 'done' ? `Pi says: ${forVoice(j.reply)}` : forVoice(shown));
    };
    child.on('error', (e) => finish(null, e));
    child.on('close', (code) => finish(code));
    return j;
  }

  function stop() {
    if (!job) return false;
    job.stopped = true;
    try { job.child.kill(); } catch { /* already gone */ }
    return true;
  }

  const tools = [
    {
      name: 'ask_pi',
      description: `Hand a task to pi, ${userName}'s coding agent: the only way anything is read from, searched in, written to or run on ${userName}'s files. Write prompt as a complete instruction in ${userName}'s own words and intent, adding nothing they didn't ask for; pi has not seen this conversation or the screen, so include what it needs (file names, what was said, text you read on screen if they asked about it). mode "read" lets pi only read and search; "edit" also lets it change files and run commands: use "edit" only when ${userName} asked for something to be changed, made or run. follow_up true continues the last pi task in this project, e.g. to pass on ${userName}'s answer to a question pi asked. ${userName} always sees the exact prompt first: a read-only task then goes by itself after a few seconds unless they stop it, and one that can edit goes only when they say send. pi then works in the background and the app shows its steps. Don't wait for it: you're told when pi has finished.`,
      parameters: z.object({ prompt: z.string(), mode: z.enum(['read', 'edit']), follow_up: z.boolean().optional() }),
      executionMode: 'sequential', timeoutMs: 10 * 60_000, // time to read the prompt and answer; pi itself runs in the background
      execute: async ({ prompt, mode, follow_up: followUp }, ctx) => {
        if (job) throw new Error('pi is still working on the last task. Wait for its reply, or stop it with stop_pi.');
        const text = String(prompt ?? '').trim();
        if (!text) throw new Error('The prompt is empty.');
        if (text.length > 8000) throw new Error('The prompt is over 8000 characters. Make it shorter: name the files instead of pasting them.');
        const settings = loadSettings(home);
        const problem = projectProblem(settings.project, home);
        if (problem) throw new Error(`${problem} Tell ${userName} to fix "project" in ${tilde(settings.file, home)}.`);
        const cont = !!followUp && sessions.has(settings.project);
        const m = mode === 'edit' ? 'edit' : 'read';
        // Things the Send bubble points out: settings changed by something other than Roamies, an unusual pi command,
        // and (for edits) whether there's a snapshot to go back to.
        const notes = [];
        const now_ = settingsText(settings);
        if (seen !== null && seen !== now_) notes.push('⚠ settings.json has changed since the last hand-off. Check the folder above.');
        seen = now_;
        if (settings.pi !== 'pi') notes.push(`⚠ pi is started with: ${settings.pi}`);
        let snap = null;
        if (m === 'edit') {
          snap = snapshot(settings.project, stamp(), { init: settings.project === path.join(settings.dir, 'workspace') });
          notes.push(snap.ref ? 'Undo snapshot taken.' : `No undo snapshot (${snap.why}).`);
        }
        // The sandbox: built and tried before anything is shown, so the bubble says what will really happen. If it
        // can't be applied the hand-off is not sent by itself, and not confined if it is sent: the owner decides.
        let box = null, unconfined = false;
        if (!settings.sandbox) notes.push('⚠ Sandbox is off: pi is not confined.');
        else {
          let why;
          try { box = sandboxProfile({ home, project: settings.project, settings, volumes }); why = sandboxProblem(box.profile, sandboxExec); } catch (e) { why = e.message; }
          if (why) { box = null; unconfined = true; notes.push(`⚠ The sandbox could not be applied (${why}). If you send, pi runs unconfined.`); }
          else {
            notes.push(`Sandboxed: pi can read ${box.reads} folder${box.reads === 1 ? '' : 's'} and write only in this project.`);
            if (box.docker) notes.push('Docker allowed: containers can reach folders outside this project.');
          }
        }
        const { ok, by } = await approve({ prompt: text, mode: m, project: settings.project, followUp: cont, dir: settings.dir, notes, auto: m === 'read' && !unconfined ? settings.autoSendReadOnly : 0 }, ctx?.signal);
        if (!ok) { log('pi_declined', { mode: m }); throw new Error(`${userName} didn't say send, so nothing went to pi. Don't ask again unless they bring it up.`); }
        start({ prompt: text, mode: m, project: settings.project, followUp: cont, settings, by, snap, box });
        return `Sent to pi (${m === 'edit' ? 'editing allowed' : 'read only'}, in ${tilde(settings.project, home)}). It's working in the background and the app shows ${userName} its steps. Say in a few words, your own way, that pi is on it, and stop: you'll be told when it has finished.`;
      },
    },
    {
      name: 'stop_pi', description: `Stop the task pi is working on. Use when ${userName} says to stop or cancel pi.`,
      parameters: z.object({}),
      execute: async () => (stop() ? 'Stopping pi.' : 'pi isn\'t working on anything.'),
    },
    {
      name: 'switch_project',
      description: `Change the folder pi works in, to one of the projects listed in the <live-state> block (${userName} keeps that list in ~/Documents/roamies-pi/settings.json; you can't add to it). Only when ${userName} asks to work on another project. They're asked to confirm.`,
      parameters: z.object({ name: z.string() }), executionMode: 'sequential',
      execute: async ({ name }, ctx) => {
        if (job) throw new Error('pi is working. Switch projects after it finishes, or stop it first.');
        const settings = loadSettings(home);
        const want = String(name ?? '').trim().toLowerCase();
        const hit = settings.projects.find((p) => p.name.toLowerCase() === want) ?? settings.projects.find((p) => p.name.toLowerCase().includes(want) && want.length > 2);
        if (!hit) throw new Error(`No project called "${name}". The list: ${settings.projects.map((p) => p.name).join(', ')}. ${userName} adds projects in ${tilde(settings.file, home)}.`);
        const problem = projectProblem(hit.dir, home);
        if (problem) throw new Error(problem);
        if (hit.dir === settings.project) return `pi already works in ${hit.name} (${tilde(hit.dir, home)}).`;
        const a = await ask({ placeholder: `Have pi work in ${hit.name} (${tilde(hit.dir, home)}) from now on?`, choices: ['Switch', "Don't switch"] }, ctx?.signal);
        if (!isSend(a)) throw new Error(`${userName} said no, so pi stays in ${tilde(settings.project, home)}.`);
        // Kept in state.json, never settings.json (that file is the owner's), with "project" as the settings file has it
        // now: if the owner edits that later, their value wins over this choice.
        writeState(settings.dir, { ...readState(settings.dir), project: tilde(hit.dir, home), projectWas: tilde(settings.fileProject, home) });
        log('pi_project', {});
        onChange();
        return `pi now works in ${hit.name} (${tilde(hit.dir, home)}).`;
      },
    },
  ];

  /** Lines for the model's live state: where pi works, whether it's busy, what it last said. */
  function live() {
    let s;
    try { s = loadSettings(home); } catch (e) { return `- pi: its settings file has a problem (${e.message}).`; }
    const others = s.projects.filter((p) => p.dir !== s.project).map((p) => p.name);
    const lines = [`- pi works in: ${tilde(s.project, home)}${others.length ? `. Other projects ${userName} listed: ${others.join(', ')}` : ''}.`];
    for (const r of s.routines.slice(0, 12)) lines.push(`- Routine "${r.name}": ${r.steps.map((x, i) => `${i + 1}) ${x}`).join('  ')}`);
    if (job) lines.push(`- pi is WORKING now (${job.mode === 'edit' ? 'editing allowed' : 'read only'}) on: "${clip(job.prompt, 300)}". Until it replies you can only talk, keep the to-do list and notes, or stop_pi.`);
    else if (last && last.project === s.project) {
      const said = last.reply ? ` pi's reply (the app puts it on screen for ${userName} in full): <<<${clip(last.reply, LIVE_MAX)}>>>` : '';
      lines.push(`- Last pi task (${last.status}${last.problem ? `: ${clip(last.problem, 200)}` : ''}; ${last.mode === 'edit' ? 'editing allowed' : 'read only'}): "${clip(last.prompt, 300)}".${said}${last.snapshot ? ` A snapshot from before pi's edits is kept as ${last.snapshot}; to undo, ${userName} runs in Terminal: git -C "${last.project}" restore --source=${last.snapshot} --worktree -- .` : ''}${/\?\s*$/.test(last.reply) ? ` It ended with a question: ${userName}'s answer goes to pi with ask_pi and follow_up true.` : ''}`);
    }
    return lines.join('\n');
  }

  /** What was handed to pi on a day (a Date): [{ time, mode, prompt, status }], oldest first, from the records. */
  function tasksOn(day) {
    const out = [];
    try {
      const s = loadSettings(home), prefix = stamp(day).slice(0, 10);
      for (const f of fs.readdirSync(path.join(s.dir, 'log')).filter((n) => n.startsWith(prefix) && n.endsWith('.jsonl')).sort()) {
        const rows = fs.readFileSync(path.join(s.dir, 'log', f), 'utf8').split('\n').filter(Boolean);
        let first, lastRow; try { first = JSON.parse(rows[0]); lastRow = JSON.parse(rows.at(-1)); } catch { continue; }
        if (first?.type !== 'roamies_handoff') continue;
        out.push({ time: `${f.slice(11, 13)}:${f.slice(13, 15)}`, mode: first.mode, prompt: clip(String(first.prompt ?? ''), 160), status: lastRow?.type === 'roamies_result' ? lastRow.status : 'unfinished' });
      }
    } catch { /* no records */ }
    return out;
  }

  /** The briefing that's due now, if any: { kind, note } (note is the system note for the model). A morning one is
   *  due from its time for four hours, an evening one from its time until midnight, each once a day. done(kind)
   *  marks it given. */
  function briefing(d = new Date(now())) {
    let s; try { s = loadSettings(home); } catch { return null; }
    const mins = d.getHours() * 60 + d.getMinutes(), today = stamp(d).slice(0, 10);
    const given = readState(s.dir).briefings ?? {};
    const list = (tasks) => (tasks.length ? tasks.map((t) => `- ${t.time} (${t.mode === 'edit' ? 'could edit' : 'read only'}, ${t.status}): ${t.prompt}`).join('\n') : '- nothing');
    const due = (kind, until) => s.briefings[kind] !== null && mins >= s.briefings[kind] && mins < until && given[kind] !== today;
    if (due('morning', s.briefings.morning + 240)) {
      const y = new Date(d); y.setDate(y.getDate() - 1);
      return { kind: 'morning', note: `(System, not ${userName}: it's time for the morning briefing they set up. In a few short spoken sentences, in character: greet them, say what's on their to-do list and what's due today (call list_commitments first; no other tool), and what pi worked on yesterday, from this list. Don't read the list out line by line.)\nWhat pi was asked yesterday:\n${list(tasksOn(y))}` };
    }
    if (due('evening', 24 * 60)) {
      return { kind: 'evening', note: `(System, not ${userName}: it's time for the end-of-day summary they set up. Save a note titled "Daily log ${today}" with write_note (append true): a short Markdown summary of what pi was asked today, from this list, and of their to-do list (call list_commitments first). Then tell them in one or two spoken sentences that the day's log is saved and what stood out. No other tools.)\nWhat pi was asked today:\n${list(tasksOn(d))}` };
    }
    return null;
  }
  briefing.done = (kind, d = new Date(now())) => {
    try {
      const s = loadSettings(home), state = readState(s.dir);
      writeState(s.dir, { ...state, briefings: { ...(state.briefings ?? {}), [kind]: stamp(d).slice(0, 10) } });
    } catch { /* best effort */ }
  };

  return {
    tools, live, stop, tasksOn, briefing,
    busy: () => !!job,
    /** Something said while a Send bubble is open answers it ("send" sends, anything else doesn't). True if it did. */
    heard(text) { if (!approval) return false; approval.answer(text); return true; },
    /** The user started talking. True while a Send bubble is open: what they say will answer it. */
    listening() { if (!approval) return false; approval.listening = true; return true; },
    /** They stopped and nothing was heard. True if that ended a Send bubble (nothing is sent). */
    unheard() { if (!approval?.listening) return false; approval.answer(''); return true; },
    state: () => ({ working: job ? { prompt: job.prompt, mode: job.mode, project: job.project, since: job.at } : null, last }),
  };
}

// What the open tool may be given: an app's name. Not a link, a web address, or a file or folder path.
export const isAppName = (target) => {
  const t = String(target ?? '').trim();
  if (!t || /^[~/.\\]/.test(t) || /^[a-z]:[\\/]/i.test(t) || /^[a-z][a-z0-9+.-]*:/i.test(t)) return false;
  if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i.test(t) && !/\.app$/i.test(t)) return false; // example.com
  return !/[/\\]/.test(t);
};

/** Roamies' own tools for this build: file and command tools out, pi's in, the rest refused while pi works, and
 *  the app tools narrowed: open takes an app's name only, act_in_app works the app in front only, and a drawing
 *  can't open a link by itself. (tools.mjs is left as upstream wrote it, so its own tests still hold.) */
export function gateTools(tools, pi, extra = []) {
  const narrowed = tools.filter((t) => !REMOVED.has(t.name)).map((t) => {
    if (t.name === 'open') {
      return { ...t,
        description: 'Open an app by name (e.g. "Zotero", "Inkscape"), only when the user names the app to open. This build opens nothing else: no websites, files or folders.',
        execute: async (args, ...rest) => {
          if (!isAppName(args?.target)) throw new Error('This build only opens apps by name, not websites, files or folders. Say so.');
          return t.execute({ target: String(args.target).trim() }, ...rest);
        } };
    }
    if (t.name === 'act_in_app') return { ...t, execute: async (args, ...rest) => t.execute({ ...args, target: 'front' }, ...rest) };
    if (t.name === 'draw') {
      return { ...t, execute: async (args, ...rest) => {
        if ((args?.beats ?? []).some((b) => (b?.marks ?? []).some((m) => m?.kind === 'open'))) throw new Error('This build doesn\'t open links from a drawing. Leave the open mark out.');
        return t.execute(args, ...rest);
      } };
    }
    return t;
  });
  return [...narrowed, ...extra, ...pi.tools].map((t) => (DURING.has(t.name) ? t : {
    ...t,
    execute: async (...a) => {
      if (pi.busy() && t.name !== 'ask_pi' && t.name !== 'switch_project') throw new Error('pi is working on a task, and until it replies I only talk, keep the to-do list and notes, or stop pi (stop_pi). Say so in a few words.');
      return t.execute(...a);
    },
  }));
}
