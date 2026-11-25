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
import { CLOSING_PHRASES, FILLER_WORDS, MOVE_WORDS, NEW_WORDS, NO_WORDS, SECOND_WORDS, THAT_WORDS, Unanswered, YES_WORDS, firstButton, heardLine, heardShape, only, plain, unfilled } from './answers.mjs';
import { WAKE_BEFORE_BRIEFING_MINUTES } from './kokorovoice.mjs'; // feature 24: shown in settings.default.json
import { MEASURE_SECONDS, SETTLE_HOLD_SECONDS } from './rebuild.mjs'; // feature 24, fix 6: shown in settings.default.json
import { CHFLAGS, EXTENSION, PS, PS_ARGS, RECORD, START_SLACK, endedNotice, offNotice, prepareLeftovers } from './leftovers.mjs'; // feature 24
import { COMING_DAYS, KEEP_DAYS, REVIEW_PHRASES } from './daily.mjs'; // feature 18: shown in settings.default.json
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const READ_TOOLS = 'read,grep,find,ls';
// The sizes, times and counts are settings ("limits" in settings.json, see LIMITS below); none lives only here.
// The folder Roamies keeps beside the owner's settings, and what is in it.
const PATHS = { folder: path.join('Documents', 'roamies-pi'), settings: 'settings.json', reference: 'settings.default.json', state: 'state.json', log: 'log', workspace: 'workspace', pending: 'pending.txt' };

// Tools taken out of Roamies: files and commands are pi's job.
export const REMOVED = new Set(['read_file', 'list_files', 'search_files', 'write_file', 'edit_file', 'run_command', 'fetch_url']);
// What still works while pi is busy.
const DURING = new Set(['stop_pi', 'remember_commitment', 'update_commitment', 'forget_fact', 'list_commitments', 'show_list', 'write_note', 'search_notes', 'read_note', 'show_pending', 'sync_todos', 'schedule_block', 'move_block', 'unschedule_block', 'show_day', 'plan_day', 'set_priority', 'sort_tasks', 'show_matrix']);

// Super Productivity (calendar.mjs): the to-do list is mirrored there through that app's local REST API. Where it
// The nudge for a to-do that has come due is worded by code (nudgeLine in calendar.mjs), never by the model: how many
// are named in one nudge before the rest are counted, and after how many minutes "is due" becomes "was due".
export const NUDGE = { named: 3, lateMinutes: 5 };
// listens, where its access token is kept (read when a request is made, never stored), the two tags its Eisenhower
// matrix goes by, how long the "is it there?" check may take, and the only requests Roamies sends (never DELETE).
export const SP = {
  host: '127.0.0.1', port: 3876, tokenFile: 'Library/Application Support/superProductivity/local-rest-api-token',
  urgentTag: 'EM_URGENT', importantTag: 'EM_IMPORTANT', healthSeconds: 1,
  titlesShown: 10, // how many titles the first-time question about the app's tasks shows, and a list for the model holds, before "and N more"
  requests: ['GET /health', 'GET /tasks', 'GET /tasks/:id', 'POST /tasks', 'PATCH /tasks/:id'],
};

const SEND_WORDS = ['send', 'send it', 'send now', 'yes', 'yeah', 'yep', 'yup', 'ok', 'okay', 'go', 'go ahead', 'do it', 'approve', 'approved', 'confirm'];
// Said to the Send bubble, or typed to a yes/no question. It sends only when what was said is nothing but send
// words: one alone, repeated or combined ("yes, send it", "ok go ahead"), with "please" if they like. It declines
// only when it is nothing but don't-send words, by the same rule. Anything else leaves the bubble open: a send word
// followed by other words ("ok, wait, change the prompt", "go back") and mixed ones ("yes no") included.
const DONT_WORDS = ['no', 'nope', "don't", 'do not', "don't send", "don't send it", 'do not send', 'do not send it', 'cancel', 'stop', 'never mind'];
const SEND = only(SEND_WORDS), DONT = only(DONT_WORDS);
const said = (text) => plain(text).split(' ').filter((w) => w && w !== 'please').join(' ');
export const isSend = (text) => SEND.test(said(text));
export const isDontSend = (text) => DONT.test(said(text));
// Feature 22. Heard hands-free, in an answer window, a hand-off that can edit goes only on one of these, said alone
// ("please" may come with it): no "ok", no "yes", no filler words. After a key press the wider send words above
// count, and filler words before or after them don't spoil the answer (answers.mjs).
export const HANDS_FREE_SEND = ['send', 'send it'];
export const isHandsFreeSend = (text) => HANDS_FREE_SEND.includes(said(text));
// How long after an answer window's end a phrase that was finished inside it may still arrive and be judged (the
// microphone is closed by then: only the recogniser is finishing), and the least time left for which the microphone
// is opened again after a phrase that wasn't an answer.
export const WINDOW = { graceSeconds: 3, reopenMinSeconds: 1 };
/** A hand-off's prompt as it is said aloud: its first sentence, cut to max characters, and that there is more. */
export function briefly(text, max) {
  const all = forVoice(text), first = (/^.*?[.!?](?=\s|$)/s.exec(all)?.[0] ?? all).trim();
  const cut = first.length > max ? `${first.slice(0, max).replace(/\s+\S*$/, '')}…` : first;
  return cut.length < all.length ? `${cut} The rest is on screen.` : cut;
}

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
  ['literal', `${r}/${PATHS.settings}`], ['literal', `${r}/${PATHS.reference}`], ['literal', `${r}/${PATHS.state}`], ['subpath', `${r}/${PATHS.log}`],
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
// Always readable: pi's own folder (in the home folder). Always writable: devices and the temporary folders (the
// user's own temporary folder and its cache folder are added when the profile is built).
const PI_HOME = '.pi';
const WRITE_ALWAYS = ['/dev'], TEMP = ['/private/tmp', '/private/var/tmp'];
// With Docker allowed for the project: what docker reads in the home folder. Without it, the sockets pi can't reach.
const DOCKER_READS = ['.docker', '.orbstack/bin', '.orbstack/run', '.orbstack/shell'];
const DOCKER_SOCKETS = { home: ['.orbstack/run', '.docker/run'], system: ['/private/var/run/docker.sock', '/var/run/docker.sock'] };

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
  const agent = realPath(path.join(home, PI_HOME, 'agent'));
  const temp = uniq([...TEMP, realPath(tmpdir)].flatMap((t) => (path.basename(t) === 'T' && t.startsWith('/private/var/folders/') ? [t, path.join(path.dirname(t), 'C')] : [t])));
  // Readable inside the home folder, beyond the owner's listed folders: pi's own folder, the shell's start-up files,
  // the tool folders, the folder an absolute "pi" command sits in, and (with Docker allowed) what docker reads.
  const own = [realPath(path.join(home, PI_HOME)), ...STARTUP.map((f) => path.join(h, f)), ...tools];
  if (path.isAbsolute(settings.pi)) own.push(path.dirname(realPath(settings.pi)), path.dirname(path.resolve(settings.pi)));
  const dockerReads = DOCKER_READS.map((d) => `${h}/${d}`);
  const dockerSockets = [...DOCKER_SOCKETS.home.map((d) => rule(['subpath', `${h}/${d}`])), ...DOCKER_SOCKETS.system.map((d) => rule(['literal', d]))].join(' ');
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
    `(allow file-write* ${sub([...WRITE_ALWAYS, ...temp])})`,
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

// ---- the settings
// Every setting has its default here and nowhere else, and every one is written to settings.default.json beside the
// owner's settings.json at start-up (reference.mjs), so none has a value the owner can't see.
// voice: the Mac voice for every look ('' = the system voice); voices: one per look, which wins over voice.
const DEFAULT_VOICES = { jarvis: 'Daniel' }; // JARVIS speaks British English unless the settings say otherwise
const HOME_CORNERS = ['bottom-left', 'bottom-right', 'top-left', 'top-right']; // the first is the default
// How far the character keeps from the screen's edges, in body radii: the same numbers as the overlay's home.js
// (settings.test.mjs checks they match).
const HOME_MARGINS = { corner: { side: 2.4, top: 2.4, bottom: 1.9 }, edge: { side: 1.6, top: 1.8, bottom: 1.5 } };
export const NEVER_LOOK = ['1Password', 'Bitwarden', 'KeePassXC', 'Keychain Access', 'Passwords', 'Messages']; // guard.mjs
/** The sizes, times and counts, set under "limits": each a number from min to max (whole: no fractions). One that is
 *  missing or out of range uses its default and is named at start-up. */
export const LIMITS = {
  approvalBubbleChars: { default: 600, min: 200, max: 5000, whole: true }, // characters of a prompt the Send bubble holds; longer ones are also saved to pending.txt
  promptChars: { default: 8000, min: 500, max: 100_000, whole: true }, // the longest prompt ask_pi takes
  piReplyChars: { default: 3000, min: 200, max: 50_000, whole: true }, // characters of pi's last reply the model is given
  stepBubbleSeconds: { default: 4, min: 0.5, max: 60 }, // between step bubbles: a burst of steps shows as one line, the latest
  answerWaitMinutes: { default: 10, min: 1, max: 120 }, // how long a Send bubble waits for an answer (read when Roamies starts)
  gitTimeoutSeconds: { default: 30, min: 5, max: 600 }, // each git command of an undo snapshot
  morningBriefingWindowHours: { default: 4, min: 0.25, max: 24 }, // how long after its time the morning briefing is still given
  snapshotMaxFileMB: { default: 2, min: 0.1, max: 100 }, // a new file bigger than this is left out of an undo snapshot
  snapshotMaxFiles: { default: 5000, min: 1, max: 100_000, whole: true }, // new files in one undo snapshot
  routinesShown: { default: 12, min: 1, max: 100, whole: true }, // routines the model is told about
  noteMaxChars: { default: 20_000, min: 1000, max: 1_000_000, whole: true }, // characters of a note written or read in one go
  notesSearched: { default: 5000, min: 10, max: 100_000, whole: true }, // notes looked through in a search
  noteTitleOnlyBytes: { default: 300_000, min: 1000, max: 10_000_000, whole: true }, // a bigger note is searched by its title only
  frontLookupMs: { default: 900, min: 100, max: 5000, whole: true }, // how long the look-up of the app in front may take
  frontReuseSeconds: { default: 8, min: 1, max: 60 }, // how long the look-up made when you stop talking stays good
  calendarTimeoutSeconds: { default: 20, min: 2, max: 60 }, // each request to Super Productivity (not the 1-second "is it there?" check)
  answerWindowSeconds: { default: 10, min: 3, max: 30 }, // how long the microphone stays open by itself after Roamies has asked something
  exchangeEndSeconds: { default: 20, min: 5, max: 600 }, // quiet time after Roamies' last reply that ends an exchange (a pending question is then raised)
  pendingKeepHours: { default: 24, min: 1, max: 720 }, // a question nobody answered is dropped when it is older than this
  spokenQuestionChars: { default: 200, min: 40, max: 1000, whole: true }, // characters of a question (or of a hand-off's first sentence) that are said aloud
  heardLineChars: { default: 80, min: 20, max: 300, whole: true }, // characters of a phrase that wasn't taken, as shown in the bubble's last line
  kokoroTimeoutSeconds: { default: 20, min: 2, max: 120 }, // how long the natural voice may take over one sentence (and, six times that, to start) before the macOS voice takes over
  historyTokens: { default: 40_000, min: 20_000, max: 500_000, whole: true }, // feature 24: tokens sent in one request at which the older part of the conversation is folded into a summary (never later than three quarters of what a request may hold)
  kokoroSentenceChars: { default: 120, min: 40, max: 1000, whole: true }, // a sentence longer than this is split at a clause before the natural voice makes it
  pageRebuildQuietMinutes: { default: 15, min: 0, max: 1440, whole: true, zero: 'never' }, // feature 24: quiet minutes, with the character at rest at home and nothing on screen, after which the overlay page is rebuilt (rebuild.mjs)
};
// The voice that speaks ("voiceEngine"): Kokoro, kept loaded in a helper process (kokorovoice.mjs), or the macOS voice.
export const VOICE_ENGINES = ['kokoro', 'system'];
const text = (max) => (v) => typeof v === 'string' && !!v.trim() && v.length <= max && !/[\0\n\r]/.test(v);
/** The parts of "kokoro". python: the Python that has mlx_audio (used only if it is a full path to a program that
 *  exists); model: its name as downloaded, or a folder; voice: one that ships with the model; lang: the model's
 *  language letter; speed: 1 is the voice's own pace. */
export const KOKORO = {
  python: { default: '/opt/homebrew/anaconda3/envs/localai/bin/python', ok: text(1000) },
  model: { default: 'mlx-community/Kokoro-82M-bf16', ok: (v) => text(300)(v) && (/^[\w.-]+\/[\w.-]+$/.test(v) || v.startsWith('/') || v.startsWith('~/')) },
  voice: { default: 'bm_george', ok: (v) => typeof v === 'string' && /^[a-z]{2}_[a-z0-9]{1,32}$/.test(v) },
  lang: { default: 'b', ok: (v) => typeof v === 'string' && /^[a-z]$/.test(v) },
  speed: { default: 1.05, min: 0.5, max: 2, ok: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0.5 && v <= 2 },
  // Feature 24: what the helper tells MLX when it starts. cacheMB: freed memory MLX keeps for reuse (0: none).
  // memoryMB: what MLX aims to stay under while it makes a sentence; it goes over when one step needs more.
  cacheMB: { default: 0, min: 0, max: 16384, ok: (v) => Number.isInteger(v) && v >= 0 && v <= 16384 },
  memoryMB: { default: 400, min: 100, max: 16384, ok: (v) => Number.isInteger(v) && v >= 100 && v <= 16384 },
  // Feature 24: minutes without a sentence after which the helper is ended to give its memory back (0: never).
  sleepAfterMinutes: { default: 0, min: 0, max: 1440, ok: (v) => Number.isInteger(v) && v >= 0 && v <= 1440 },
};
/** The parts of "persona": how Roamies speaks, and nothing about what it may do (persona.mjs). address may be "". */
export const PERSONA = {
  name: { default: 'Jarvis', ok: text(40) },
  address: { default: 'sir', ok: (v) => v === '' || (text(30)(v) && /^[\p{L}\p{M}' .-]+$/u.test(v)) },
  manner: { default: 'calm, precise, formally polite, loyal', ok: text(200) },
  humour: { default: 'dry and rare', ok: text(100) },
  maxSentences: { default: 2, min: 1, max: 5, ok: (v) => Number.isInteger(v) && v >= 1 && v <= 5 },
  beats: { default: ['One moment, sir.', 'Checking now, sir.', 'Right away, sir.'], ok: (v) => Array.isArray(v) && v.length >= 1 && v.length <= 40 && v.every(text(60)) },
  // How often the form of address is used, by the app's lines and the model's replies together; 0: always.
  addressEverySeconds: { default: 180, min: 0, max: 86400, ok: (v) => Number.isInteger(v) && v >= 0 && v <= 86400 },
};
function partDefaults(table) { return Object.fromEntries(Object.entries(table).map(([k, v]) => [k, Array.isArray(v.default) ? [...v.default] : v.default])); }
const limitDefaults = () => Object.fromEntries(Object.entries(LIMITS).map(([k, v]) => [k, v.default]));
const limitOk = (name, v) => typeof v === 'number' && Number.isFinite(v) && v >= LIMITS[name].min && v <= LIMITS[name].max && (!LIMITS[name].whole || Number.isInteger(v));
// pi's own folder is a subfolder, so the settings file isn't in the folder pi is started in. "projects" is empty
// because the current project is always on the list, whatever it holds.
const DEFAULTS = (dir) => ({ project: `${dir}/${PATHS.workspace}`, projects: [], pi: 'pi', maxMinutes: 60, keepLogsDays: 30, autoSendReadOnly: 5, progressSeconds: 90, routines: {}, briefings: {}, voice: '', voices: { ...DEFAULT_VOICES }, vault: '~/Documents/roamies-vault', dailyFolder: 'Daily', neverLook: [...NEVER_LOOK], sandbox: true, readOnly: [], calendar: calendarDefaults(), toolFolders: [], toolFoldersOff: [], docker: [], home: HOME_CORNERS[0], autoListenQuestions: true, closingReply: 'Any time.', speakNotices: true, measurePageRebuild: false, voiceEngine: VOICE_ENGINES[0], kokoro: partDefaults(KOKORO), persona: partDefaults(PERSONA), limits: limitDefaults() });
/** Every setting with its default, as settings.json is first made and as settings.default.json shows it. */
export const settingsDefaults = (home) => DEFAULTS(tilde(path.join(home, PATHS.folder), home));

// What a setting may be, and what is used when it isn't. Each takes the value as written and the default, and gives
// [the value used, whether that is what was written]. A value that can't be used gives the default; in a list, the
// entries that can be used are kept and the rest left out. Either way the setting is named at start-up, with what is
// used instead. The safety settings fall back to the safe side: the sandbox on, the built-in never-look list.
const isStr = (v) => typeof v === 'string';
const full = (v) => isStr(v) && !!v.trim();
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const strs = (v) => Array.isArray(v) && v.every(full);
const clock = (v) => { const m = /^(\d{1,2}):(\d{2})$/.exec(isStr(v) ? v.trim() : ''); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; };
const when = (ok) => (v, d) => (ok(v) ? [v, true] : [d, false]);
const number = (low) => (v, d) => ((typeof v === 'number' || full(v)) && Number.isFinite(Number(v)) && low(Number(v)) ? [Number(v), true] : [d, false]);
const list = (v) => { const kept = Array.isArray(v) ? v.filter(full) : []; return [kept, Array.isArray(v) && kept.length === v.length]; };
const CLEAN = {
  project: when(full),
  projects: (v) => {
    if (Array.isArray(v)) return list(v);
    if (!isObj(v)) return [[], false];
    const kept = Object.entries(v).filter(([n, p]) => n.trim() && full(p));
    return [Object.fromEntries(kept), kept.length === Object.keys(v).length];
  },
  pi: when(full),
  maxMinutes: number((n) => n > 0),
  keepLogsDays: number((n) => n >= 0),
  autoSendReadOnly: number((n) => n >= 0),
  progressSeconds: number((n) => n >= 0),
  routines: (v, d) => {
    if (!isObj(v)) return [d, false];
    let ok = true;
    const kept = Object.entries(v).map(([n, steps]) => { const all = Array.isArray(steps) ? steps : [steps], good = all.filter(full); if (good.length !== all.length) ok = false; return [n, good]; }).filter(([n, good]) => (n.trim() && good.length ? true : (ok = false)));
    return [Object.fromEntries(kept), ok];
  },
  briefings: (v, d) => {
    if (!isObj(v)) return [d, false];
    const kept = {}; let ok = true;
    for (const k of ['morning', 'evening']) { if (v[k] === undefined || v[k] === null || v[k] === '') continue; if (clock(v[k]) === null) ok = false; else kept[k] = v[k]; }
    return [kept, ok];
  },
  voice: when(isStr),
  voices: (v, d) => { if (!isObj(v)) return [d, false]; const kept = Object.entries(v).filter(([, name]) => isStr(name)); return [Object.fromEntries(kept), kept.length === Object.keys(v).length]; },
  vault: when(full),
  dailyFolder: when((v) => isStr(v) && /^[^/\\:*?"<>|#^[\]\u0000-\u001f]{1,60}$/.test(v) && !v.startsWith('.') && v.trim() === v),
  neverLook: when(strs),
  sandbox: when((v) => typeof v === 'boolean'),
  readOnly: list, toolFolders: list, toolFoldersOff: list, docker: list,
  home: when((v) => (isStr(v) && HOME_CORNERS.includes(v.trim().toLowerCase())) || (isObj(v) && typeof v.x === 'number' && typeof v.y === 'number' && Number.isFinite(v.x) && Number.isFinite(v.y))),
  autoListenQuestions: when((v) => typeof v === 'boolean'),
  closingReply: when(full),
  speakNotices: when((v) => typeof v === 'boolean'),
  measurePageRebuild: when((v) => typeof v === 'boolean'),
  voiceEngine: when((v) => VOICE_ENGINES.includes(v)),
  kokoro: when(isObj),
  persona: when(isObj),
  limits: when(isObj),
  calendar: when(isObj),
};
/** The parts of "calendar": the working day a day plan fills, the lunch break kept free ([] or null: none), the
 *  minutes left between blocks, and how often the to-do list is synced with Super Productivity. One that is missing
 *  or can't be used takes its default and is named at start-up, like a limit. */
const whole = (v, lo, hi) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
export const CALENDAR = {
  dayStart: { default: '09:00', ok: (v) => clock(v) !== null },
  dayEnd: { default: '18:00', ok: (v) => clock(v) !== null },
  lunch: { default: ['12:30', '13:30'], ok: (v) => v === null || (Array.isArray(v) && (v.length === 0 || (v.length === 2 && clock(v[0]) !== null && clock(v[1]) !== null && clock(v[0]) < clock(v[1])))) },
  gapMinutes: { default: 0, min: 0, max: 240, ok: (v) => whole(v, 0, 240) },
  syncSeconds: { default: 60, min: 15, max: 3600, ok: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 15 && v <= 3600 },
  // Feature 18. dayTurnsAt: when one day's note ends and the next one's starts (and, later, the conversation turns
  // over); not after dayStart. reviewAt: when the day's review is written and its questions asked; "" for only when
  // asked. When it is missing it is dayEnd's value.
  dayTurnsAt: { default: '04:00', ok: (v) => clock(v) !== null },
  reviewAt: { default: '18:00', ok: (v) => v === '' || clock(v) !== null },
};
function calendarDefaults() { return Object.fromEntries(Object.entries(CALENDAR).map(([k, v]) => [k, Array.isArray(v.default) ? [...v.default] : v.default])); }

/** What Roamies itself keeps in ~/Documents/roamies-pi/state.json: the project chosen with switch_project, and the
 *  days the briefings were given. {} when there's none or it can't be read. */
export function readState(dir) {
  try { const s = JSON.parse(fs.readFileSync(path.join(dir, PATHS.state), 'utf8')); return s && typeof s === 'object' && !Array.isArray(s) ? s : {}; } catch { return {}; }
}
export const writeState = (dir, state) => fs.writeFileSync(path.join(dir, PATHS.state), `${JSON.stringify(state, null, 2)}\n`);

/** Reads ~/Documents/roamies-pi/settings.json, making the folder and the file the first time. After that the file is
 *  the owner's alone: nothing here, or anywhere else in Roamies, writes it.
 *  A setting the file lacks, or holds a value for that can't be used, takes its default: `missing` names the first
 *  kind and `invalid` the second ({ name, using }), for the start-up bubble. Safety settings fall back to the safe
 *  side: the sandbox on, the built-in never-look list. */
export function loadSettings(home) {
  const dir = path.join(home, PATHS.folder), file = path.join(dir, PATHS.settings);
  fs.mkdirSync(path.join(dir, PATHS.log), { recursive: true });
  fs.mkdirSync(path.join(dir, PATHS.workspace), { recursive: true });
  const defaults = DEFAULTS(tilde(dir, home));
  if (!fs.existsSync(file)) fs.writeFileSync(file, `${JSON.stringify(defaults, null, 2)}\n`);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${tilde(file, home)} isn't valid JSON (${e.message}). Fix or delete it.`); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${tilde(file, home)} should be a JSON object.`);
  // set: each setting as the file has it when it's there and usable, else its default.
  const missing = [], invalid = [], set = {};
  for (const name of Object.keys(defaults)) {
    if (!Object.hasOwn(raw, name)) { missing.push(name); set[name] = defaults[name]; continue; }
    const [value, asWritten] = CLEAN[name](raw[name], defaults[name]);
    set[name] = value;
    if (!asWritten) invalid.push({ name, using: value });
  }
  // limits: one by one. A file without "limits" at all lacks one setting, not fifteen.
  const limits = limitDefaults();
  if (set.limits !== defaults.limits) {
    for (const name of Object.keys(LIMITS)) {
      if (!Object.hasOwn(set.limits, name)) missing.push(`limits.${name}`);
      else if (!limitOk(name, set.limits[name])) invalid.push({ name: `limits.${name}`, using: LIMITS[name].default });
      else limits[name] = set.limits[name];
    }
  }
  // calendar: part by part, the same way. A day that doesn't start before it ends is the default day.
  const cal = calendarDefaults();
  if (set.calendar !== defaults.calendar) {
    for (const name of Object.keys(CALENDAR)) {
      if (!Object.hasOwn(set.calendar, name)) missing.push(`calendar.${name}`);
      else if (!CALENDAR[name].ok(set.calendar[name])) invalid.push({ name: `calendar.${name}`, using: CALENDAR[name].default });
      else cal[name] = set.calendar[name];
    }
    if (clock(cal.dayStart) >= clock(cal.dayEnd)) {
      for (const name of ['dayStart', 'dayEnd']) { cal[name] = CALENDAR[name].default; if (!invalid.some((i) => i.name === `calendar.${name}`)) invalid.push({ name: `calendar.${name}`, using: cal[name] }); }
    }
    if (!Object.hasOwn(set.calendar, 'reviewAt')) cal.reviewAt = cal.dayEnd;
    if (clock(cal.dayTurnsAt) > clock(cal.dayStart)) {
      cal.dayTurnsAt = clock(CALENDAR.dayTurnsAt.default) <= clock(cal.dayStart) ? CALENDAR.dayTurnsAt.default : '00:00';
      if (!invalid.some((i) => i.name === 'calendar.dayTurnsAt')) invalid.push({ name: 'calendar.dayTurnsAt', using: cal.dayTurnsAt });
    }
  }
  // kokoro and persona: part by part, the same way.
  const parts = {};
  for (const [group, given, table] of [['kokoro', set.kokoro, KOKORO], ['persona', set.persona, PERSONA]]) {
    parts[group] = partDefaults(table);
    if (given === defaults[group]) continue;
    for (const name of Object.keys(table)) {
      if (!Object.hasOwn(given, name)) missing.push(`${group}.${name}`);
      else if (!table[name].ok(given[name])) invalid.push({ name: `${group}.${name}`, using: table[name].default });
      else parts[group][name] = Array.isArray(given[name]) ? [...given[name]] : given[name];
    }
  }
  parts.kokoro.python = parts.kokoro.python.trim(); // as written: it is used only if it is a full path (kokorovoice.mjs)
  const calendar = { dayStart: clock(cal.dayStart), dayEnd: clock(cal.dayEnd), lunch: cal.lunch?.length ? cal.lunch.map(clock) : null, gapMinutes: cal.gapMinutes, syncSeconds: cal.syncSeconds, dayTurnsAt: clock(cal.dayTurnsAt), reviewAt: cal.reviewAt === '' ? null : clock(cal.reviewAt) };
  // projects: a list of folders (named by their last part), or { name: folder }.
  const listed = Array.isArray(set.projects) ? set.projects.map((p) => [base(expand(p, home)), p]) : Object.entries(set.projects);
  // The settings folder itself used to be pi's default project. It no longer can be one (pi could rewrite these
  // settings), so it means its workspace subfolder now.
  const moved = (p) => (p === dir ? path.join(dir, PATHS.workspace) : p);
  const projects = listed.map(([name, p]) => { const d = moved(expand(p.trim(), home)); return { name: d === path.join(dir, PATHS.workspace) ? PATHS.workspace : String(name), dir: d }; });
  const fileProject = moved(expand(set.project.trim(), home));
  // The project chosen with switch_project (state.json) counts while it's still listed under "projects" and "project"
  // in the settings file is what it was when the switch was made. A "project" the owner has edited since wins.
  const state = readState(dir);
  const at = (v) => (typeof v === 'string' && v.trim() ? moved(expand(v.trim(), home)) : null);
  const chosen = at(state.project);
  const project = chosen && at(state.projectWas) === fileProject && projects.some((p) => p.dir === chosen) ? chosen : fileProject;
  if (!projects.some((p) => p.dir === project)) projects.unshift({ name: base(project), dir: project });
  const voices = Object.fromEntries(Object.entries(set.voices).map(([k, v]) => [k.toLowerCase(), v.trim()]).filter(([, v]) => v)); // "" for a look: no voice of its own
  const vault = expand(set.vault.trim(), home); // the Obsidian vault Roamies keeps notes in (notes.mjs)
  const neverLook = set.neverLook.map((n) => n.trim());
  // routines: { "what you say": ["step", "step"] }; briefings: { "morning": "09:00", "evening": "18:30" }
  const routines = Object.entries(set.routines).map(([name, steps]) => ({ name: name.trim(), steps: (Array.isArray(steps) ? steps : [steps]).map((x) => x.trim()) }));
  const briefings = { morning: clock(set.briefings.morning), evening: clock(set.briefings.evening) };
  // The sandbox (all four are read from this file only). sandbox: on unless it says false. readOnly: more folders pi
  // may read. toolFolders: more tool folders, added to the built-in ones; toolFoldersOff: built-in ones to drop.
  // docker: the projects where pi may reach Docker.
  const folders = (v) => v.map((p) => expand(p.trim(), home));
  const off = new Set(folders(set.toolFoldersOff));
  const toolFolders = [...new Set([...TOOL_FOLDERS.map((p) => expand(p, home)).filter((p) => !off.has(p)), ...folders(set.toolFolders)])];
  // home: where the character rests on the desktop in its default and small sizes (the overlay's home.js): a corner,
  // or { x, y } in screen points.
  const homeSpot = isObj(set.home) ? { x: set.home.x, y: set.home.y } : set.home.trim().toLowerCase();
  return { dir, file, raw, missing, invalid, limits, calendar, home: homeSpot, project, fileProject, projects, sandbox: set.sandbox, readOnly: folders(set.readOnly), toolFolders, docker: folders(set.docker), vault, dailyFolder: set.dailyFolder, neverLook, routines, briefings, autoSendReadOnly: Number(set.autoSendReadOnly), progressSeconds: Number(set.progressSeconds), keepLogsDays: Number(set.keepLogsDays), voice: set.voice.trim(), voices, pi: set.pi.trim(), maxMinutes: Number(set.maxMinutes), autoListenQuestions: set.autoListenQuestions, closingReply: set.closingReply.trim(), speakNotices: set.speakNotices, measurePageRebuild: set.measurePageRebuild, voiceEngine: set.voiceEngine, kokoro: parts.kokoro, persona: parts.persona };
}

/** Where the character rests on the desktop (the "home" setting): a corner, or { x, y }. Never throws. */
export function homeFor(home = os.homedir()) {
  try { return loadSettings(home).home; } catch { return HOME_CORNERS[0]; }
}

/** The Mac voice a look speaks in (a name from `say -v '?'`), or '' for the system voice. Never throws. */
export function voiceFor(look, home = os.homedir()) {
  try { const s = loadSettings(home); return s.voices[String(look ?? '').toLowerCase()] || s.voice || ''; } catch { return ''; }
}

/** The sizes, times and counts ("limits") as they stand now. Never throws: the defaults if the settings can't be read. */
export function limitsFor(home = os.homedir()) {
  try { return loadSettings(home).limits; } catch { return limitDefaults(); }
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
  let settingsDir; try { settingsDir = fs.realpathSync(path.join(home, PATHS.folder)); } catch { settingsDir = null; }
  if (settingsDir && (real === settingsDir || settingsDir.startsWith(real + path.sep))) return `${tilde(dir, home)} holds Roamies' own settings, so it can't be a project. Use a folder beside it or inside it, like ~/Documents/roamies-pi/workspace.`;
  return '';
}

/** A snapshot of a project as it is now, kept as a git ref (refs/roamies/<stamp>) without touching the branch, the
 *  index or any file: the tracked files as they are, plus new files up to 2 MB each that .gitignore doesn't exclude.
 *  { ref } on success, { why } when there's none (not a git repository, git missing, or it failed). */
export function snapshot(project, stampText, { init = false, limits = limitDefaults() } = {}) {
  const git = (args, opts = {}) => spawnSync('git', ['-c', 'user.name=Roamies', '-c', 'user.email=roamies@localhost', ...args], { cwd: project, encoding: 'utf8', timeout: limits.gitTimeoutSeconds * 1000, maxBuffer: 64 * 1024 * 1024, ...opts });
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
        .filter((f) => { try { const st = fs.lstatSync(path.join(project, f)); return st.isFile() && st.size <= limits.snapshotMaxFileMB * 1024 * 1024; } catch { return false; } }).slice(0, limits.snapshotMaxFiles);
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

// ---- feature 24: ending pi and everything it started
export const KILL_AFTER_MS = 2000; // after being asked to end, what is left of pi's group is killed
export const EXIT_DRAIN_MS = 300; // after pi exits, how long its last output may take to arrive
const groups = new Set();
const groupAlive = (pid) => { try { process.kill(-pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
/** child was started detached, so its pid is its process group. end(): the group is asked to end (SIGTERM) and
 *  killed after killAfterMs if any of it is left; resolves when none is. kill(): at once. */
export function endGroup(child, { killAfterMs = KILL_AFTER_MS } = {}) {
  const pid = child.pid;
  let ending = null;
  const signal = (sig) => { if (!pid) return; try { process.kill(-pid, sig); } catch { try { child.kill(sig); } catch { /* gone */ } } };
  const g = {
    pid,
    alive: () => !!pid && groupAlive(pid),
    kill() { signal('SIGKILL'); groups.delete(g); },
    end() {
      ending ??= new Promise((done) => {
        if (!g.alive()) { groups.delete(g); return done(); }
        signal('SIGTERM');
        const t0 = Date.now();
        const tick = setInterval(() => {
          if (g.alive() && Date.now() - t0 < killAfterMs) return;
          clearInterval(tick);
          if (g.alive()) signal('SIGKILL');
          groups.delete(g); done();
        }, 50);
      });
      return ending;
    },
  };
  if (pid) groups.add(g);
  return g;
}
/** A small watcher outside this process: when this process is gone (killed, crashed) it ends pi's group the same
 *  way, and the groups recorded for the hand-off (leftovers.mjs: $3 is its folder, or empty), then removes that
 *  folder and ends itself. It runs /bin/sh with a fixed script; the two numbers and the folder are its only arguments.
 *  The recorded groups are found as leftovers.mjs finds them: /bin/ps with fixed arguments (pid, group, elapsed time),
 *  its output read by awk and dropped; a pid now held by a process started at another time is left alone. */
const AWK_ENDABLE = `BEGIN { while ((getline l < rec) > 0) if (l ~ /^[0-9]+ [0-9]+$/) { split(l, a, " "); if (a[1] > 1) t[a[1]] = a[2] } }
{ n = split($3, e, /[-:]/); s = e[n] + 60 * e[n - 1]; if (n > 2) s += 3600 * e[n - 2]; if (n > 3) s += 86400 * e[n - 3]; st[$1] = now - s; m[$2] = 1 }
END { for (p in t) if ((p in m) && !((p in st) && (st[p] < t[p] - ${START_SLACK.before} || st[p] > t[p] + ${START_SLACK.after}))) print p }`;
export const WATCH_SCRIPT = [
  'while kill -0 "$1" 2>/dev/null && kill -0 -- "-$2" 2>/dev/null; do sleep 1; done',
  'kill -0 "$1" 2>/dev/null && exit 0',
  'p=""; kill -0 -- "-$2" 2>/dev/null && p="$2"',
  `g=""; [ -n "$3" ] && g=$(${PS} ${PS_ARGS.join(' ')} | /usr/bin/awk -v now="$(/bin/date +%s)" -v rec="$3/${RECORD}" '${AWK_ENDABLE}')`,
  'for x in $p $g; do kill -TERM -- "-$x" 2>/dev/null; done',
  '[ -n "$p$g" ] && sleep 2',
  'for x in $p $g; do kill -KILL -- "-$x" 2>/dev/null; done',
  `[ -n "$3" ] && { ${CHFLAGS} nouappnd "$3/${RECORD}"; /bin/rm -f "$3/${RECORD}" "$3/${EXTENSION}"; /bin/rmdir "$3"; } 2>/dev/null`,
  'exit 0',
].join('\n');
export function watchParent(groupPid, spawnImpl = spawn, dir = '') {
  if (!groupPid || process.platform === 'win32') return { stop() {} };
  let w = null;
  try { w = spawnImpl('/bin/sh', ['-c', WATCH_SCRIPT, 'sh', String(process.pid), String(groupPid), dir], { stdio: 'ignore', detached: true, env: { PATH: '/usr/bin:/bin' } }); w.unref?.(); w.on?.('error', () => {}); } catch { /* no watcher: the exit handler still ends the group */ }
  return { stop() { try { if (w?.pid) process.kill(-w.pid, 'SIGKILL'); } catch { /* gone */ } } };
}

/** How a hand-off that ended done or error is told (sidekick.mjs onDone). With spoken replies on, Roamies first says
 *  the gist in its own turn (summarise; the model is given pi's reply, never the notice); then the full text goes on
 *  screen; then, once the gist has finished playing, the leftovers notice (feature 24) is said, worded by code. */
export async function tellResult(r, { voiceOn, summarise, show, speak, played }) {
  if (voiceOn) await summarise(r);
  show(r.shown);
  if (voiceOn && r.notice) { await played(); speak(r.notice); }
}

export function createPi({ home = os.homedir(), userName = 'the user', say = () => {}, tell = () => {}, onDone = null, ask, askYesNo = null, question = null, retext = () => {}, log = () => {}, onChange = () => {}, spawnImpl = spawn, shell = process.env.SHELL || '/bin/zsh', sandboxExec = SANDBOX_EXEC, volumes = VOLUMES, now = () => Date.now(), leftoversTmp = os.tmpdir(), leftoversSpawnSync = spawnSync } = {}) {
  let job = null; // the hand-off pi is working on
  const openLeftovers = new Set(); // feature 24: hand-off folders not yet removed (leftovers.mjs)
  let last = null; // the one before: { prompt, mode, project, status, reply, at }
  let approval = null; // an approval waiting for Send: { answer(text) }
  const sessions = new Map(); // project folder -> pi session id of the last hand-off there
  let seq = 0;
  let seen = null; // the settings file as it was at the last hand-off, to notice a change made behind Roamies' back
  const settingsText = (s) => { try { return fs.readFileSync(s.file, 'utf8'); } catch { return ''; } };

  const stamp = (d = new Date(now())) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;

  /** Shows the hand-off and waits for Send (a click, the Y key, or the word "send"). */
  // Feature 22: with `question` (flow.mjs) the bubble's question is said through it, and in an exchange started by
  // voice the microphone then opens by itself for the answer. If that window runs out with no answer the bubble
  // closes, nothing is sent, the hand-off is kept as a pending question and approve rejects with Unanswered.
  // kept: the pending question this is, when it is being asked again (it keeps its age).
  async function approve({ prompt, mode, project, followUp, dir, notes = [], auto = 0, limits = limitDefaults(), kept = null }, signal) {
    const where = tilde(project, home);
    // auto: a read-only task is sent after this many seconds unless it's stopped. One that can edit always waits for Send.
    const head = `${auto ? `Asking pi in ${auto} s` : 'Send to pi?'}  ${mode === 'edit' ? 'CAN EDIT files and run commands' : 'Read only'} · in ${where}${followUp ? ' · continues the last pi task' : ''}${notes.map((n) => `\n${n}`).join('')}`;
    let body = prompt;
    const pendingFile = path.join(dir, PATHS.pending);
    if (prompt.length > limits.approvalBubbleChars) {
      fs.writeFileSync(pendingFile, `${head}\n\n${prompt}\n`);
      body = `${prompt.slice(0, limits.approvalBubbleChars - 100)}… (the whole text is in ${tilde(pendingFile, home)})`;
    }
    // Said briefly: what it is and the prompt's first sentence. The whole prompt is in the bubble.
    const brief = briefly(prompt, limits.spokenQuestionChars);
    const line = auto ? `Asking pi: ${brief}` : `For pi, ${mode === 'edit' ? 'with editing allowed' : 'read only'}${followUp ? ', continuing the last task' : ''}. ${brief} Say send to send it.`;
    let noAnswer = () => {}, answered = false;
    const unanswered = new Promise((_, reject) => { noAnswer = () => reject(new Unanswered('nothing went to pi')); });
    unanswered.catch(() => {});
    const keep = { ...(kept ? { id: kept.id, at: kept.at } : {}), kind: 'handoff', brief: `For pi, ${mode === 'edit' ? 'with editing allowed' : 'read only'}: ${briefly(prompt, limits.heardLineChars)}`, data: { prompt, mode, followUp: !!followUp, project } };
    const window = question ? question({ brief: line, always: true, pending: keep, onTimeout: () => noAnswer() }) : (tell(null, line), null);
    const closing = new AbortController();
    const signals = signal ? AbortSignal.any([signal, closing.signal]) : closing.signal;
    let by = 'click';
    // What is said while the bubble is open: only send words send, only don't-send words decline, and anything else
    // (or nothing heard) leaves the bubble as it was, ready for the next thing said or a click, any number of times.
    const voiced = new Promise((resolve) => {
      approval = {
        listening: false, closed: false, talked: false, // talked: they have said something, so the countdown is off for good
        // handsFree: heard in the answer window, not after a key press. Then a hand-off that can edit goes only on
        // "send" or "send it"; a read-only one on the send words. After a key press: the send words, and filler words
        // before or after them don't count.
        answer: (text, { handsFree = false } = {}) => {
          approval.listening = false;
          if (String(text ?? '').trim()) approval.talked = true;
          const words = handsFree ? text : unfilled(text);
          const send = handsFree && mode === 'edit' ? isHandsFreeSend(text) : isSend(words);
          // The bubble itself is gone (it closed while they talked): there is nothing left to answer later.
          if (!send && !isDontSend(words) && !approval.closed) {
            log?.('send_heard', { taken: false, ...heardShape(text), sendWord: plain(text).split(' ').includes('send'), ...(handsFree ? { handsFree: true } : {}) });
            // Shown, not swallowed: the bubble's last line says what was heard, until the next phrase. Screen only.
            if (String(text ?? '').trim()) retext(`${head}\n\n${body}\n${heardLine(text, 'send or no', limits.heardLineChars)}`);
            return;
          }
          by = 'voice'; resolve(send);
        },
      };
    });
    // Once the user has started talking, the answer is what they say: a bubble that closes meanwhile isn't a "no".
    // A click is judged by which button it was, never by its label: the first sends, the other doesn't.
    const buttons = [auto ? 'Send now' : 'Send', "Don't send"];
    const clicked = ask({ placeholder: `${head}\n\n${body}`, choices: buttons }, signals).then((a) => { if (a == null && approval?.listening) { approval.closed = true; return new Promise(() => {}); } return firstButton(a, buttons); });
    // The countdown. Once the user starts talking it no longer counts: what they say decides.
    let timer = null;
    const timed = auto ? new Promise((resolve) => { timer = setTimeout(() => { if (approval?.talked) return; by = 'auto'; resolve(true); }, auto * 1000); }) : new Promise(() => {});
    try {
      const ok = await Promise.race([clicked, voiced, timed, unanswered]);
      answered = !signal?.aborted; // a bubble taken down with its request is not an answer
      return { ok, by };
    } finally {
      clearTimeout(timer);
      window?.close(answered); // answered: every pending copy of this hand-off is cleared (flow.mjs)
      approval = null;
      closing.abort(); // closes the bubble if it was answered by voice or went by itself
      fs.rmSync(pendingFile, { force: true });
    }
  }

  function start({ prompt, mode, project, followUp, settings, by, snap = null, box = null, leftovers = true }) {
    const id = ++seq, t0 = now();
    // Feature 24: a hand-off that can edit gets the extension that records its commands (leftovers.mjs). macOS only.
    const lf = mode === 'edit' && leftovers && process.platform === 'darwin' ? prepareLeftovers({ tmpdir: leftoversTmp, spawnSyncImpl: leftoversSpawnSync, log }) : null;
    const lfOff = mode === 'edit' && process.platform === 'darwin' && !lf ? (leftovers ? 'setup' : 'load') : null; // why it runs without
    const dropLf = () => { lf.remove(); openLeftovers.delete(lf); };
    if (lf) openLeftovers.add(lf);
    // Old records go: keepLogsDays in the settings (30 unless it says otherwise; 0 keeps them all).
    if (settings.keepLogsDays > 0) {
      try {
        const logs = path.join(settings.dir, PATHS.log), cutoff = t0 - settings.keepLogsDays * 864e5;
        for (const f of fs.readdirSync(logs)) { const p = path.join(logs, f); if (f.endsWith('.jsonl') && fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true }); }
      } catch { /* best effort */ }
    }
    const record = path.join(settings.dir, PATHS.log, `${stamp()}_${String(id).padStart(3, '0')}_${mode}.jsonl`); // one file per hand-off
    const write = (o) => { try { fs.appendFileSync(record, `${typeof o === 'string' ? o : JSON.stringify(o)}\n`); } catch { /* the record is best effort */ } };
    const session = followUp ? sessions.get(project) : null;
    // "--" ends pi's options; a leading @ would attach a file, so it's kept off the front.
    const text = prompt.startsWith('@') ? ` ${prompt}` : prompt;
    const args = ['--mode', 'json', ...(mode === 'read' ? ['--tools', READ_TOOLS] : []), ...(lf ? ['-e', lf.extension] : []), ...(session ? ['--session', session] : []), '--', text];
    write({ type: 'roamies_handoff', at: new Date(t0).toISOString(), project, mode, follow_up: !!session, approved_by: by, snapshot: snap?.ref ?? null, undo: snap?.ref ? `git -C "${project}" restore --source=${snap.ref} --worktree -- .` : null, prompt, command: [settings.pi, ...args.slice(0, -1), '<prompt>'], sandbox: box ? 'on' : settings.sandbox ? 'not applied' : 'off', docker: box ? box.docker : undefined });
    const env = { ...process.env };
    if (path.isAbsolute(settings.pi)) env.PATH = `${path.dirname(settings.pi)}${path.delimiter}${env.PATH ?? ''}`; // node sits beside it
    // A login shell, so pi and node are found the way they are in Terminal. The prompt travels as an argument, never as shell text.
    // Under the sandbox it's sandbox-exec that starts the shell, so the shell's start-up, pi and all they run are confined.
    const line = [shell, '-lc', 'exec "$0" "$@"', settings.pi, ...args];
    const [cmd, ...cmdArgs] = box ? [sandboxExec, '-p', lf ? `${box.profile}${lf.rules().join('\n')}\n` : box.profile, ...line] : line;
    // Local-only build (feature 24): pi is started as the leader of a process group of its own, so everything it
    // starts can be ended with it. The command and the sandbox are unchanged.
    const child = spawnImpl(cmd, cmdArgs, { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const group = endGroup(child, { killAfterMs: KILL_AFTER_MS });
    const guard = watchParent(child.pid, spawnImpl, lf?.dir ?? ''); // ends the group (and the recorded ones) if this process dies without a chance to
    if (lfOff) log('pi_leftovers_off', { why: lfOff });
    const j = job = { id, prompt, mode, project, at: t0, child, snapshot: snap?.ref ?? null, stopped: false, reply: '', problem: '', stderr: '', steps: 0, record, leftovers: lf, events: 0 };
    log('pi_start', { mode, followUp: !!session, chars: prompt.length });
    onChange();
    let stepAt = 0, stepTimer = null, stepText = '';
    const step = (line) => {
      j.steps++;
      const next = `Pi's ${line}…`;
      if (next === stepText) return; // the same thing again: nothing new to show
      stepText = next;
      const wait = stepAt + settings.limits.stepBubbleSeconds * 1000 - now();
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
        j.events++;
        if (e.type !== 'message_update') write(line); // the streaming deltas are left out; message_end has the whole text
        try { onEvent(e); } catch (err) { console.error('pi event', err); }
      }
    });
    child.stderr.on('data', (d) => { j.stderr = (j.stderr + d.toString('utf8')).slice(-4000); });
    // Every so often on a long task, a spoken line so the silence isn't a mystery (only with spoken replies on).
    let told = 0;
    const lines = [(n, w) => `Still on it. Pi's ${n} step${n === 1 ? '' : 's'} in${w}.`, (n, w) => `Pi's still working${w}. ${n} step${n === 1 ? '' : 's'} so far.`, (n, w) => `Bear with me, pi's not done yet${w}.`];
    const progress = settings.progressSeconds > 0 ? setInterval(() => { if (job === j) tell(null, lines[told++ % lines.length](j.steps, stepText ? `, ${stepText.replace(/^Pi's /, '').replace(/…$/, '')} right now` : '')); }, settings.progressSeconds * 1000) : null;
    const timer = setTimeout(() => { j.problem = `it ran for over ${settings.maxMinutes} minutes, so I stopped it`; j.stopped = 'timeout'; group.end(); }, settings.maxMinutes * 60_000);
    let finished = false;
    const finish = (code, spawnError) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer); clearTimeout(stepTimer); clearInterval(progress);
      group.end(); // pi has gone: nothing it started stays, whatever still holds its output open
      // Feature 24: pi couldn't load the extension (it stops before doing anything): started again without it.
      if (lf && !j.stopped && !j.events && code !== 0 && j.stderr.includes('Failed to load extension') && j.stderr.includes(path.basename(lf.dir))) {
        guard.stop(); dropLf();
        write({ type: 'roamies_retry', why: 'pi could not load the extension that records its commands' });
        if (job === j) job = null;
        start({ prompt, mode, project, followUp, settings, by, snap, box, leftovers: false });
        return;
      }
      // Feature 24: what its commands left running (leftovers.mjs), then the watcher and the folder go.
      let leftNotice = lfOff ? offNotice : '';
      if (lf) {
        const ran = lf.ready() || !j.events;
        const { count, done } = lf.end('pi_end');
        done.then(dropLf, dropLf);
        if (count) leftNotice = endedNotice(count);
        else if (!ran) { leftNotice = offNotice; log('pi_leftovers_off', { why: 'hook' }); }
      }
      guard.stop();
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
      const shown = `${status === 'stopped' ? 'Stopped pi.' : status === 'error' ? `Pi hit a problem: ${j.problem}${j.reply ? `\n\nBefore that it said:\n\n${j.reply}` : ''}` : `Here's what pi came back with:\n\n${j.reply}`}${leftNotice ? `\n\n${leftNotice}` : ''}`;
      const result = { status, reply: j.reply, problem: last.problem, prompt: j.prompt, mode: j.mode, snapshot: j.snapshot, shown, notice: leftNotice };
      // The app decides how it's told (sidekick.mjs: Roamies says the gist in its own voice, then the full reply goes on
      // screen). Without one, it's shown and read out as it is.
      if (onDone) Promise.resolve().then(() => onDone(result)).catch((e) => { console.error('pi relay', e); tell(shown, null); });
      else tell(shown, status === 'done' ? `Pi says: ${forVoice(j.reply)}${leftNotice ? ` ${leftNotice}` : ''}` : forVoice(shown));
    };
    child.on('error', (e) => finish(null, e));
    child.on('close', (code) => finish(code));
    // Finished when pi exits, not when its output closes: something pi started can hold that open for as long as
    // it runs. A moment is left for pi's last lines to arrive.
    child.on('exit', (code) => setTimeout(() => finish(code), EXIT_DRAIN_MS));
    j.group = group;
    return j;
  }

  function stop() {
    if (!job) return false;
    job.stopped = true;
    job.group.end();
    return true;
  }

  /** At quit: everything pi started is ended now. Resolves when it has gone (at the latest after the kill). */
  function stopAll() {
    const g = job?.group;
    if (!g) return Promise.resolve();
    job.stopped = true;
    const left = job.leftovers?.end('quit'); // feature 24: what pi's commands left running ends with it
    return Promise.all([g.end(), left?.done]);
  }
  /** As this process ends, whatever the reason: no waiting is possible, so the group is killed outright, and what
   *  pi's commands left running too. */
  function killNow() { for (const g of groups) g.kill(); for (const lf of openLeftovers) { lf.endNow(); lf.remove(); } }

  /** One hand-off: its checks, the Send bubble, and pi started on a yes. → { ok, mode, project }. kept: the pending
   *  question this is, when it is asked again: then there is no countdown, whatever its mode, so a hand-off is never
   *  sent because it was pending. Throws Unanswered when the answer window ran out (it is kept, or kept again). */
  async function handoff({ text, mode, followUp }, signal, { kept = null } = {}) {
        if (!text) throw new Error('The prompt is empty.');
        const settings = loadSettings(home);
        if (text.length > settings.limits.promptChars) throw new Error(`The prompt is over ${settings.limits.promptChars} characters. Make it shorter: name the files instead of pasting them.`);
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
          snap = snapshot(settings.project, stamp(), { init: settings.project === path.join(settings.dir, PATHS.workspace), limits: settings.limits });
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
        const { ok, by } = await approve({ prompt: text, mode: m, project: settings.project, followUp: cont, dir: settings.dir, notes, auto: !kept && m === 'read' && !unconfined ? settings.autoSendReadOnly : 0, limits: settings.limits, kept }, signal);
        if (!ok) { log('pi_declined', { mode: m }); return { ok: false, mode: m, project: settings.project }; }
        start({ prompt: text, mode: m, project: settings.project, followUp: cont, settings, by, snap, box });
        return { ok: true, mode: m, project: settings.project };
  }
  /** A pending hand-off (flow.mjs). Looked at first, without asking: it is lost when its prompt can't be read or pi
   *  now works in another folder (said in one line). Otherwise ask() asks it again in full: a new Send bubble with
   *  the whole prompt, and no countdown. */
  async function reask(q) {
    if (job) return { later: true };
    const d = q?.data ?? {};
    let settings;
    try { settings = loadSettings(home); } catch { return { later: true }; }
    if (typeof d.prompt !== 'string' || !d.prompt.trim()) return { dropped: 'A task for pi was waiting for your answer, but I can no longer read it, so it was not sent.' };
    if (settings.project !== d.project || projectProblem(settings.project, home)) return { dropped: 'A task for pi was waiting for your answer, but pi now works in another folder, so it was not sent.' };
    return { ask: async () => {
      const r = await handoff({ text: d.prompt.trim(), mode: d.mode, followUp: d.followUp }, undefined, { kept: q });
      if (r.ok) tell('Sent to pi.', 'Sent to pi.');
      return {};
    } };
  }
  /** The folder pi works in, changed after a yes. → what to say. A no throws (declined: true). */
  async function switchTo(name, signal, kept = null) {
        const settings = loadSettings(home);
        const want = String(name ?? '').trim().toLowerCase();
        const hit = settings.projects.find((p) => p.name.toLowerCase() === want) ?? settings.projects.find((p) => p.name.toLowerCase().includes(want) && want.length > 2);
        if (!hit) throw new Error(`No project called "${name}". The list: ${settings.projects.map((p) => p.name).join(', ')}. ${userName} adds projects in ${tilde(settings.file, home)}.`);
        const problem = projectProblem(hit.dir, home);
        if (problem) throw new Error(problem);
        if (hit.dir === settings.project) return { same: true, text: `pi already works in ${hit.name} (${tilde(hit.dir, home)}).` };
        const buttons = ['Switch', "Don't switch"]; // answered by which button it was, not by its words
        const opts = { placeholder: `Have pi work in ${hit.name} (${tilde(hit.dir, home)}) from now on?`, choices: buttons };
        // Feature 22: with askYesNo (answers.mjs) it also takes a spoken yes or no, and is kept when nobody answers.
        const answer = askYesNo ? await askYesNo({ ...opts, pending: { ...(kept ? { id: kept.id, at: kept.at } : {}), kind: 'project', brief: `Have pi work in ${hit.name} from now on?`, data: { name: hit.name } } }, signal) : await ask(opts, signal);
        const a = firstButton(answer, buttons);
        if (!a) throw Object.assign(new Error(`${userName} said no, so pi stays in ${tilde(settings.project, home)}.`), { declined: true });
        // Kept in state.json, never settings.json (that file is the owner's), with "project" as the settings file has it
        // now: if the owner edits that later, their value wins over this choice.
        writeState(settings.dir, { ...readState(settings.dir), project: tilde(hit.dir, home), projectWas: tilde(settings.fileProject, home) });
        log('pi_project', {});
        onChange();
        return { text: `pi now works in ${hit.name} (${tilde(hit.dir, home)}).` };
  }
  /** A pending folder question (flow.mjs). pi already works there: done, cleared without a word. The project is
   *  gone from the list: said in one line. Otherwise ask() asks it again. */
  async function reswitch(q) {
    if (job) return { later: true };
    let settings;
    try { settings = loadSettings(home); } catch { return { later: true }; }
    const want = String(q?.data?.name ?? '').trim().toLowerCase();
    const hit = settings.projects.find((p) => p.name.toLowerCase() === want);
    if (hit && hit.dir === settings.project) return { done: true };
    if (!hit || projectProblem(hit.dir, home)) return { dropped: `You hadn't answered whether pi should work in ${q?.data?.name ?? 'another folder'}. That project can no longer be used, so pi stays where it is.` };
    return { ask: async () => {
      try {
        const r = await switchTo(hit.name, undefined, q);
        if (!r.same) tell(r.text, r.text);
      } catch (e) { if (!e.declined) throw e; }
      return {};
    } };
  }

  const tools = [
    {
      name: 'ask_pi',
      description: `Hand a task to pi, ${userName}'s coding agent: the only way anything is read from, searched in, written to or run on ${userName}'s files. Write prompt as a complete instruction in ${userName}'s own words and intent, adding nothing they didn't ask for; pi has not seen this conversation or the screen, so include what it needs (file names, what was said, text you read on screen if they asked about it). mode "read" lets pi only read and search; "edit" also lets it change files and run commands: use "edit" only when ${userName} asked for something to be changed, made or run. follow_up true continues the last pi task in this project, e.g. to pass on ${userName}'s answer to a question pi asked. ${userName} always sees the exact prompt first: a read-only task then goes by itself after a few seconds unless they stop it, and one that can edit goes only when they say send. pi then works in the background and the app shows its steps. Don't wait for it: you're told when pi has finished.`,
      parameters: z.object({ prompt: z.string(), mode: z.enum(['read', 'edit']), follow_up: z.boolean().optional() }),
      executionMode: 'sequential', timeoutMs: limitsFor(home).answerWaitMinutes * 60_000, // time to read the prompt and answer; pi itself runs in the background
      execute: async ({ prompt, mode, follow_up: followUp }, ctx) => {
        if (job) throw new Error('pi is still working on the last task. Wait for its reply, or stop it with stop_pi.');
        const r = await handoff({ text: String(prompt ?? '').trim(), mode, followUp }, ctx?.signal);
        if (!r.ok) throw new Error(`${userName} didn't say send, so nothing went to pi. Don't ask again unless they bring it up.`);
        return `Sent to pi (${r.mode === 'edit' ? 'editing allowed' : 'read only'}, in ${tilde(r.project, home)}). It's working in the background and the app shows ${userName} its steps. Say in a few words, your own way, that pi is on it, and stop: you'll be told when it has finished.`;
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
        return (await switchTo(name, ctx?.signal)).text;
      },
    },
  ];

  /** Lines for the model's live state: where pi works, whether it's busy, what it last said. */
  function live() {
    let s;
    try { s = loadSettings(home); } catch (e) { return `- pi: its settings file has a problem (${e.message}).`; }
    const others = s.projects.filter((p) => p.dir !== s.project).map((p) => p.name);
    const lines = [`- pi works in: ${tilde(s.project, home)}${others.length ? `. Other projects ${userName} listed: ${others.join(', ')}` : ''}.`];
    for (const r of s.routines.slice(0, s.limits.routinesShown)) lines.push(`- Routine "${r.name}": ${r.steps.map((x, i) => `${i + 1}) ${x}`).join('  ')}`);
    if (job) lines.push(`- pi is WORKING now (${job.mode === 'edit' ? 'editing allowed' : 'read only'}) on: "${clip(job.prompt, 300)}". Until it replies you can only talk, keep the to-do list and notes, or stop_pi.`);
    else if (last && last.project === s.project) {
      const said = last.reply ? ` pi's reply (the app puts it on screen for ${userName} in full): <<<${clip(last.reply, s.limits.piReplyChars)}>>>` : '';
      lines.push(`- Last pi task (${last.status}${last.problem ? `: ${clip(last.problem, 200)}` : ''}; ${last.mode === 'edit' ? 'editing allowed' : 'read only'}): "${clip(last.prompt, 300)}".${said}${last.snapshot ? ` A snapshot from before pi's edits is kept as ${last.snapshot}; to undo, ${userName} runs in Terminal: git -C "${last.project}" restore --source=${last.snapshot} --worktree -- .` : ''}${/\?\s*$/.test(last.reply) ? ` It ended with a question: ${userName}'s answer goes to pi with ask_pi and follow_up true.` : ''}`);
    }
    return lines.join('\n');
  }

  /** What was handed to pi on a day (a Date): [{ time, mode, prompt, status }], oldest first, from the records. */
  function tasksOn(day) {
    const out = [];
    try {
      const s = loadSettings(home), prefix = stamp(day).slice(0, 10);
      for (const f of fs.readdirSync(path.join(s.dir, PATHS.log)).filter((n) => n.startsWith(prefix) && n.endsWith('.jsonl')).sort()) {
        const rows = fs.readFileSync(path.join(s.dir, PATHS.log, f), 'utf8').split('\n').filter(Boolean);
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
    if (due('morning', s.briefings.morning + s.limits.morningBriefingWindowHours * 60)) {
      const y = new Date(d); y.setDate(y.getDate() - 1);
      return { kind: 'morning', note: `(System, not ${userName}: it's time for the morning briefing they set up. In a few short spoken sentences, in character: greet them, say how their to-do list stands and what is planned today, from the outline at the end of this note (its numbers and today's plan; call no tool, and name no to-do that isn't in it), and what pi worked on yesterday, from this list. Don't read the list out line by line.)\nWhat pi was asked yesterday:\n${list(tasksOn(y))}` };
    }
    if (due('evening', 24 * 60)) {
      return { kind: 'evening', note: `(System, not ${userName}: it's time for the end-of-day summary they set up. Tell them in one or two spoken sentences what pi was asked today, from this list, and what stood out. The app writes the day's review in their daily note itself: write no note, and call no tool.)\nWhat pi was asked today:\n${list(tasksOn(d))}` };
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
    tools, live, stop, stopAll, killNow, tasksOn, briefing,
    busy: () => !!job,
    /** Something said while a Send bubble is open is for the bubble: "send" sends, "no" doesn't, anything else leaves
     *  it open. True when a bubble was open. */
    heard(text, opts) { if (!approval) return false; approval.answer(text, opts); return true; },
    /** Pending questions of these kinds, asked again (flow.mjs): a hand-off, and the folder pi works in. */
    resume: { handoff: reask, project: reswitch },
    /** The user started talking. True while a Send bubble is open: what they say will answer it. */
    listening() { if (!approval) return false; approval.listening = approval.talked = true; return true; },
    /** They stopped and nothing was heard: nothing is sent, and the bubble stays open. True when one was listening. */
    unheard() { if (!approval?.listening) return false; approval.answer(''); return true; },
    /** The Send bubble: null (none), 'listening' (open, and they are talking) or 'idle' (open, waiting). */
    bubble: () => (approval ? (approval.listening ? 'listening' : 'idle') : null),
    state: () => ({ working: job ? { prompt: job.prompt, mode: job.mode, project: job.project, since: job.at } : null, last }),
  };
}

/** What stays in code, for the owner to see (the "reference" part of settings.default.json): the sandbox's lists and
 *  the guards and fixed facts no setting changes. Built from the constants themselves; paths are written with ~. */
export function codeReference() {
  const h = '~', dir = `~/${PATHS.folder.split(path.sep).join('/')}`;
  const blocked = BLOCKED(h, dir);
  return {
    limitRanges: Object.fromEntries(Object.entries(LIMITS).map(([k, v]) => [k, { min: v.min, max: v.max, ...(v.whole ? { wholeNumber: true } : {}), ...(v.zero ? { zero: v.zero } : {}) }])),
    kokoroRanges: { python: 'a full path to a program that exists; started directly, never through a shell', model: 'a name as downloaded ("owner/name"), or a folder', voice: 'a voice that ships with the model, such as bm_george', lang: 'one letter', speed: { min: KOKORO.speed.min, max: KOKORO.speed.max }, cacheMB: { min: KOKORO.cacheMB.min, max: KOKORO.cacheMB.max, wholeNumber: true, zero: 'MLX keeps no freed memory for reuse' }, memoryMB: { min: KOKORO.memoryMB.min, max: KOKORO.memoryMB.max, wholeNumber: true }, memory: 'read when the helper starts', sleepAfterMinutes: { min: KOKORO.sleepAfterMinutes.min, max: KOKORO.sleepAfterMinutes.max, wholeNumber: true, zero: 'it never sleeps', wakes: `on the talk key, an answer window, a spoken request, and ${WAKE_BEFORE_BRIEFING_MINUTES} minutes before a briefing; meanwhile the Mac's voice speaks` } },
    personaRanges: { name: 'up to 40 characters', address: 'up to 30 letters, or "" for none', manner: 'up to 200 characters', humour: 'up to 100 characters', maxSentences: { min: PERSONA.maxSentences.min, max: PERSONA.maxSentences.max, wholeNumber: true }, beats: 'one to forty short lines', addressEverySeconds: { min: PERSONA.addressEverySeconds.min, max: PERSONA.addressEverySeconds.max, wholeNumber: true, zero: 'the form of address is used every time' }, rule: 'the persona changes how Roamies speaks and nothing about what it may do' },
    voiceEngines: [...VOICE_ENGINES],
    calendarRanges: { dayStart: 'HH:MM', dayEnd: 'HH:MM, after dayStart', lunch: '["HH:MM", "HH:MM"], or [] or null for no break', gapMinutes: { min: CALENDAR.gapMinutes.min, max: CALENDAR.gapMinutes.max, wholeNumber: true }, syncSeconds: { min: CALENDAR.syncSeconds.min, max: CALENDAR.syncSeconds.max }, dayTurnsAt: 'HH:MM, not after dayStart: when one day\'s note ends and the next one\'s starts', reviewAt: 'HH:MM, or "" for only when asked; when it is missing it is dayEnd\'s value' },
    superProductivity: {
      address: `http://${SP.host}:${SP.port}`, tokenFile: `${h}/${SP.tokenFile}`, tokenKept: 'read from that file for each request; never stored, logged or shown',
      requestsSent: [...SP.requests], neverSent: 'DELETE',
      urgentTag: SP.urgentTag, importantTag: SP.importantTag, isItThereCheckSeconds: SP.healthSeconds,
      synced: ['title', 'done', 'start time', 'length', 'urgent', 'important', 'due time (the app\'s deadline)'],
      adopted: 'after the owner\'s yes, every open task in the app that is not a sub-task has a to-do, in any project, with or without a time; a task added in the app later is adopted by the next sync',
      readFromAnAdoptedTask: ['title', 'done', 'start time', 'length', 'urgent', 'important', 'due time (the app\'s deadline)', 'whether it repeats (not the rule)'],
      neverRead: ['notes', 'attachments', 'other tags', 'the project', 'sub-tasks', 'the repeat rule'],
      written: 'only linked tasks, only the seven synced fields, only what was changed in Roamies; a task is never deleted, and none is created for an adopted to-do',
      takenOffRoamiesList: 'a task that came from the app stays there exactly as it is, time included, and is not adopted again while it stays open; a task Roamies made loses its time and stays',
      fromTasksWithoutAToDo: ['title', 'start time', 'length', 'done'],
      titlesShown: SP.titlesShown,
    },
    dueNudge: { wording: '"<title> is due at <time>." ("was due" once it is late; with the day when that isn\'t today), built by the app, shown and spoken', sentToTheModel: 'nothing', namedInOne: NUDGE.named, thenCounted: 'and N more are due: the list shows them', wasDueAfterMinutes: NUDGE.lateMinutes },
    sandbox: {
      builtInToolFolders: [...TOOL_FOLDERS],
      blockedFolders: blocked.filter(([kind]) => kind === 'subpath').map(([, p]) => p),
      blockedFiles: blocked.filter(([kind]) => kind === 'literal').map(([, p]) => p),
      startupFilesReadable: STARTUP.map((f) => `${h}/${f}`),
      piMayWriteInItsOwnFolder: PI_WRITES.map(([kind, f]) => `${h}/${PI_HOME}/agent/${f}${kind === 'subpath' ? '/' : ''}`),
      programsPiCannotRun: [...NO_EXEC],
      externalDrives: VOLUMES,
      dockerReadableWhenAllowed: DOCKER_READS.map((d) => `${h}/${d}`),
      dockerSocketsClosedOtherwise: [...DOCKER_SOCKETS.home.map((d) => `${h}/${d}`), ...DOCKER_SOCKETS.system],
      alwaysReadable: [`${h}/${PI_HOME}`, 'the folder of the "pi" command, when "pi" is a full path'],
      alwaysWritable: [...WRITE_ALWAYS, ...TEMP, 'your temporary folder ($TMPDIR) and the cache folder beside it'],
      sandboxProgram: SANDBOX_EXEC,
    },
    tools: { removed: [...REMOVED], piReadOnly: READ_TOOLS.split(','), allowedWhilePiWorks: [...DURING] },
    sendWords: [...SEND_WORDS],
    handsFreeSendWords: { edit: [...HANDS_FREE_SEND], optional: 'please', readOnly: 'the send words', rule: 'heard in an answer window, a hand-off that can edit is sent only on one of these, said alone' },
    fillerWords: [...FILLER_WORDS],
    fillerRule: 'after a key press, these words before or after an answer are ignored; never hands-free for a hand-off that can edit',
    closingPhrases: [...CLOSING_PHRASES],
    answerWindow: { judgedAfterTheEndSeconds: WINDOW.graceSeconds, reopenedWhenAtLeastSecondsLeft: WINDOW.reopenMinSeconds, endOfSpeech: 'reported by the overlay when the last sample has played', microphoneClosedBy: ['the voice helper, at the window\'s end', 'the sidecar\'s own timer', 'a phrase from a window that is over is discarded'] },
    pendingQuestions: { keptIn: PATHS.state, kinds: ['handoff', 'project', 'start', 'overlap', 'plan', 'sort', 'deleted', 'day', 'same', 'near', 'adopt', 'offer'], onceEach: 'The same question is pending once: asked again, the new one takes the old one\'s place. An answer clears every copy.', sameQuestion: { handoff: 'the same prompt, for the same folder, in the same mode', project: 'the same project', start: 'there is only one', overlap: 'the same to-do', plan: 'the same day', sort: 'there is only one', deleted: 'the same to-do', day: 'the same block: the same to-do, or the same title when it has no to-do yet', same: 'the same to-do that is already booked', near: 'the same title, asked about the same to-do', adopt: 'there is only one', offer: 'the same to-do' } },
    dontSendWords: [...DONT_WORDS],
    spokenAnswers: { yes: [...YES_WORDS], no: [...NO_WORDS], whenABubbleIsOpen: 'only these phrases, alone, answer a yes/no bubble; anything else leaves it open', betweenTwoDays: 'a question between two days ("next friday") is answered by the day of the month ("the 20th", "Friday the twentieth"), by "the first one" or "the later one", or by a no word for neither', moveOrSecond: { move: [...MOVE_WORDS], second: [...SECOND_WORDS], rule: 'a block asked for by the title of an open to-do that already has a block: these phrases, alone, say whether it moves or a second to-do is made; a no word changes nothing' }, thatOrNew: { that: [...THAT_WORDS], new: [...NEW_WORDS], rule: 'a block asked for by a title that holds the title of an open to-do, or is held by it, as whole words: these phrases, alone, say whether it is that to-do or a new task; a no word changes nothing' }, titleMatch: 'a title is matched with an open to-do ignoring capitals, the spaces around it and a leading "the". A title that is not the same but holds an open to-do\'s title as whole words, or is held by it, is asked about; titles of fewer than two words never match that way' },
    pageRebuild: { settleHoldSeconds: SETTLE_HOLD_SECONDS, settle: 'the new page puts the character on its home spot at once, with no entrance and no glide; for settleHoldSeconds after that, a change of the home spot moves it there at once too', oldWindowsGo: 'once the new page reports that it has drawn the character, or 10 seconds after it has its settings if it never does', measureSeconds: MEASURE_SECONDS, measured: 'with measurePageRebuild on: from the rebuild until measureSeconds after the old windows have gone, both windows\' position, size and visibility, their events (created, moved, resized, focus, close, destroyed), the character\'s drawn position in every frame on both pages, the page\'s edges and size, and every change of the home spot with its cause; numbers only, in the activity log (~/.gg/sidekick/logs) as rebuild_measure' },
    dailyNote: { place: 'the vault\'s "dailyFolder" folder, one note a day named YYYY-MM-DD.md', writtenBy: 'the app alone, through the vault\'s one writer: only ever added to', dayTurnsAt: 'calendar.dayTurnsAt', plan: 'the to-dos with a block or a due time on the day, the ones whose every time has passed (Needs a new time), and the deadlines coming up', comingUpDays: COMING_DAYS, log: ['Done: a to-do finished, in Roamies or in Super Productivity', 'Note: a note taken, linked'], review: 'at calendar.reviewAt, or when asked by one of reviewPhrases said alone: each planned to-do as done, missed or still open today, and two sentences worded by the app; a second review adds only what changed', reviewPhrases: [...REVIEW_PHRASES], counted: 'to-dos only; reminders and timers never appear', notIn: 'pi\'s work (it stays in the records folder)', keptDaysInState: KEEP_DAYS, sentToTheModel: 'nothing' },
    home: { corners: [...HOME_CORNERS], cornerMargins: { ...HOME_MARGINS.corner }, pointMargins: { ...HOME_MARGINS.edge }, marginsUnit: 'body radii' },
    paths: { folder: dir, settings: PATHS.settings, reference: PATHS.reference, state: PATHS.state, records: `${PATHS.log}/`, defaultProject: `${PATHS.workspace}/`, longPrompt: PATHS.pending },
  };
}
/** Where settings.default.json is. */
export const referenceFile = (home) => path.join(home, PATHS.folder, PATHS.reference);

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
