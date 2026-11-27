// Local-only build (feature 41, the owner's plan of 2026-11-27): pi's updates in plain words.
// Code reads pi's event stream and keeps a digest of the work: the task in the owner's words, the kinds of steps and
// their counts, pi's own statements (cleaned) and the five events that must always be said. The digest never holds a
// command, a command's output or a file's text. A model words one or two sentences from it; code checks them and adds
// its own plain line for any event they leave out. Code sees only the words of a command: a program or script that
// goes online, deletes or pushes by itself is not recognised (said in LOCAL-ONLY.md and settings.default.json).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normal } from './checks.mjs';
import { namedIn } from './files.mjs';

export const EVENT_KINDS = ['install', 'removed', 'unnamed', 'network', 'pushed'];
/** An event of these kinds brings the next update forward, to within this many seconds (the owner, answer 5). */
export const URGENT_KINDS = ['install', 'removed', 'network', 'pushed'];
export const URGENT_SECONDS = 20;
export const UPDATE_MODES = ['worded', 'plain', 'off'];
export const MAX_SENTENCES = { update: 2, summary: 3 }; // the owner, answer 1
export const OUT_TOKENS = { update: 120, summary: 220 };

// ---- reading a command
// What code recognises, by the words of each simple command. Shown in settings.default.json.
const JS = ['npm', 'pnpm', 'yarn', 'bun'];
export const RECOGNISED = {
  install: [
    'npm, pnpm, yarn, bun: install, i, add, ci (and yarn alone)', 'pip, pip3, python -m pip, pipx: install', 'uv: pip install, add, sync, tool install',
    'poetry, pdm: add, install', 'conda, mamba, micromamba: install, create', 'brew: install, reinstall, upgrade, bundle', 'cargo: install, add',
    'go: install, get', 'gem, bundle: install', 'composer: require, install', 'apt, apt-get, dnf, yum, zypper, port: install', 'pacman -S',
  ],
  removed: ['rm, rmdir, unlink, trash, shred, srm', 'mv (a move)', 'git rm, git mv, git clean', 'find … -delete, find … -exec rm', 'rsync --remove-source-files (a move)', 'at the end of an edit hand-off in a git project: files deleted or moved since the snapshot, however that happened'],
  unnamed: ['pi\'s edit and write', 'redirects (> and >>), tee', 'sed -i, perl -i', 'the target of cp and mv, touch', 'at the end of an edit hand-off in a git project: files changed or added since the snapshot, however that happened'],
  network: [
    'curl, wget, http, xh, ssh, scp, sftp, ftp, nc, ncat, telnet, ping, traceroute, dig, nslookup, host, whois, aria2c, gh, ngrok, mosh',
    'rsync to or from another machine', 'git clone, fetch, pull, push, ls-remote, submodule update, remote update',
    'the package managers\' install, update, upgrade, search, view, outdated, audit and publish', 'npx, pnpx, bunx, uvx, pnpm dlx, yarn dlx, pipx run',
    'docker pull, push, login, build, run; docker compose pull', 'hf, huggingface-cli: download, upload, login', 'ollama pull, push',
    'any command with a web address (http, https, ftp, ssh, git) or user@host: as a word of its own', 'a pi tool whose name has web, fetch, http, browse or search in it',
  ],
  pushed: ['git push', 'gh pr create, gh release create, gh repo create, gh gist create', 'npm, pnpm, yarn, bun publish', 'cargo publish, gem push, twine upload, uv publish, poetry publish, flit publish', 'docker push', 'hf, huggingface-cli upload', 'scp or rsync to another machine', 'aws s3 cp or sync, gsutil cp or rsync, to s3:// or gs://'],
};
export const NOT_SEEN = 'what a program or script does by itself (a script that downloads, deletes or uploads, a make target, an alias or a shell function, python -c), what runs inside a container, and, in a project that isn\'t a git repository or a read-only hand-off, deletions and changes made other than by the commands above';

const WRAPPERS = { sudo: ['-u', '-g', '-C', '-h', '-p', '-U'], env: ['-u', '-C', '-S'], command: [], time: [], nohup: [], nice: ['-n'], exec: ['-a'], caffeinate: ['-t', '-w'], timeout: ['-s', '-k'], xargs: ['-n', '-I', '-P', '-L', '-s', '-d', '-E'], stdbuf: ['-i', '-o', '-e'] };
const KEYWORDS = new Set(['then', 'do', 'else', 'elif', 'if', 'while', 'until', '!', '{', '}', 'fi', 'done']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish']);
const GIT_GLOBAL_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env']);
const TEXT_PROGS = new Set(['echo', 'printf', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'sed', 'awk', 'cat', 'less', 'more', 'head', 'tail', 'wc', 'sort', 'uniq', 'cut', 'tr', 'jq', 'yq', 'print', 'say', 'cd', 'export', 'ls', 'test', '[']);
const NET_PROGS = new Set(['curl', 'wget', 'http', 'https', 'xh', 'httpie', 'ssh', 'scp', 'sftp', 'ftp', 'nc', 'ncat', 'netcat', 'telnet', 'ping', 'ping6', 'traceroute', 'dig', 'nslookup', 'host', 'whois', 'aria2c', 'gh', 'ngrok', 'mosh']);
const RUNNERS = new Set(['npx', 'pnpx', 'bunx', 'uvx']);
const URL_WORD = /^(?:https?|ftp|ssh|git|sftp|wss?):\/\/[^\s'"]+$/i;
const USER_HOST = /^[\w.+-]+@([\w-]+(?:\.[\w-]+)*):/;
const HOST_PATH = /^([A-Za-z0-9][\w-]*(?:\.[\w-]+)*):(?!\/\/)/;
const URL_ANY = /\b(?:https?|ftp|ssh|git|sftp|wss?):\/\/[^\s'"`)<>]+|\bwww\.[^\s'"`)<>]+/gi;

/** A command as simple commands: [{ words: [{ t, q }], redirects: [target] }]. Splits at && || ; | & ( ) newlines,
 *  $( and backquotes; quotes and escapes are read as the shell reads them; comments and here-documents are skipped. */
export function lex(src) {
  src = String(src ?? '');
  const cmds = [];
  let cur = { words: [], redirects: [] }, w = null, target = null; // target: 'out' or 'in' for the next word
  const docs = []; // here-document delimiters waiting for the end of this line
  const endWord = () => {
    if (!w) return;
    if (target === 'out') cur.redirects.push(w.t);
    else if (target === 'doc') docs.push(w.t);
    else if (target !== 'in') cur.words.push(w);
    target = null; w = null;
  };
  const endCmd = () => { endWord(); if (cur.words.length || cur.redirects.length) cmds.push(cur); cur = { words: [], redirects: [] }; target = null; };
  const add = (s, q = false) => { w ??= { t: '', q: false }; w.t += s; if (q) w.q = true; };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { if (src[i + 1] === '\n') i++; else add(src[++i] ?? ''); continue; }
    if (c === '\'') { const j = src.indexOf('\'', i + 1), end = j < 0 ? src.length : j; add(src.slice(i + 1, end), true); i = end; continue; }
    if (c === '"') {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== '"') { if (src[j] === '\\' && j + 1 < src.length) { s += src[j + 1]; j += 2; } else s += src[j++]; }
      add(s, true); i = j; continue;
    }
    if (c === '#' && !w) { const j = src.indexOf('\n', i); i = (j < 0 ? src.length : j) - 1; continue; }
    if (c === '\n') {
      endCmd();
      for (const d of docs.splice(0)) { // a here-document's lines are text, not commands
        const lines = src.slice(i + 1).split('\n');
        let k = 0, skip = 0;
        for (; k < lines.length; k++) { skip += lines[k].length + 1; if (lines[k].replace(/^\t+/, '') === d) break; }
        i += skip;
      }
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') { endWord(); continue; }
    if (c === '$' && src[i + 1] === '(') { endCmd(); i++; continue; }
    if (c === '`') { endCmd(); continue; }
    if (c === '>' || c === '<') {
      if (w && !w.q && /^\d+$/.test(w.t)) w = null; else endWord();
      if (c === '<' && src[i + 1] === '<') {
        if (src[i + 2] === '<') { i += 2; target = 'in'; continue; }
        i++; if (src[i + 1] === '-') i++;
        target = 'doc'; continue;
      }
      if (src[i + 1] === '&') { i++; while (/[\d-]/.test(src[i + 1] ?? '')) i++; continue; }
      if (src[i + 1] === c || src[i + 1] === '|') i++;
      target = c === '>' ? 'out' : 'in'; continue;
    }
    if (c === '&' && src[i + 1] === '>') { endWord(); i++; if (src[i + 1] === '>') i++; target = 'out'; continue; }
    if (';&|()'.includes(c)) { endCmd(); if (src[i + 1] === c) i++; continue; }
    add(c);
  }
  endCmd();
  return cmds;
}

const opt = (t) => /^-/.test(t);
/** One simple command with its wrappers taken off: { prog, args: [{ t, q }], redirects }, or several when it is a
 *  shell started with -c (read inside, twice deep at most). */
export function simple(cmd, depth = 0) {
  let ws = cmd.words.slice();
  for (;;) {
    while (ws.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(ws[0].t)) ws.shift();
    if (!ws.length) return [];
    const head = path.basename(ws[0].t);
    if (KEYWORDS.has(ws[0].t)) { ws.shift(); continue; }
    if (head === 'command' && ws[1]?.t === '-v') return [];
    if (WRAPPERS[head]) {
      const valued = WRAPPERS[head];
      ws.shift();
      while (ws.length && (opt(ws[0].t) || (head === 'env' && /^[A-Za-z_]\w*=/.test(ws[0].t)))) { const o = ws.shift().t; if (valued.includes(o)) ws.shift(); }
      if (head === 'timeout' && ws.length && /^\d/.test(ws[0].t)) ws.shift();
      continue;
    }
    break;
  }
  let prog = path.basename(ws[0].t), args = ws.slice(1);
  if (SHELLS.has(prog)) {
    const at = args.findIndex((a) => !a.q && /^-[a-z]*c[a-z]*$/.test(a.t));
    if (at >= 0 && args[at + 1] && depth < 2) return lex(args[at + 1].t).flatMap((c) => simple(c, depth + 1)).map((s) => ({ ...s, redirects: [...s.redirects, ...cmd.redirects] }));
  }
  if (/^python(?:\d(?:\.\d+)?)?$/.test(prog) && args[0]?.t === '-m' && args[1]) { prog = args[1].t; args = args.slice(2); }
  if (prog === 'git') {
    while (args.length && opt(args[0].t)) { const o = args.shift().t; if (GIT_GLOBAL_VALUE.has(o)) args.shift(); }
  }
  return [{ prog, args, redirects: cmd.redirects }];
}

/** Every simple command in a bash call, with the folder it runs in (a cd earlier in the same call is followed). */
export function commandsOf(command, cwd) {
  const out = [];
  let dir = cwd;
  for (const c of lex(command)) {
    for (const s of simple(c)) {
      if (s.prog === 'cd') { const to = s.args.find((a) => !opt(a.t))?.t; if (to) dir = path.resolve(dir, to.replace(/^~(?=$|\/)/, os.homedir())); continue; }
      out.push({ ...s, cwd: dir });
    }
  }
  return out;
}

const nonOpt = (args) => args.filter((a) => !opt(a.t)).map((a) => a.t);
const isRemote = (t) => URL_WORD.test(t) || USER_HOST.test(t) || (HOST_PATH.test(t) && !/^[A-Za-z]:[\\/]/.test(t));
function hostOf(t) {
  if (URL_WORD.test(t)) { try { return new URL(t).hostname; } catch { return ''; } }
  return USER_HOST.exec(t)?.[1] ?? HOST_PATH.exec(t)?.[1] ?? '';
}
const lookPath = (t) => /^(?:\.{0,2}\/|~\/|\/)/.test(t);
/** The names of what an install installs: the package names given, a requirements file's packages, or the project's. */
function installNames(args, prog) {
  const names = [];
  for (let i = 0; i < args.length; i++) {
    const t = args[i].t;
    if (['-r', '--requirement', '-c', '--constraint'].includes(t)) { const f = args[++i]?.t; if (f) names.push(`the packages listed in ${path.basename(f)}`); continue; }
    if (['-e', '--editable'].includes(t)) { const f = args[++i]?.t; if (f) names.push(f === '.' ? 'this project' : path.basename(f)); continue; }
    if (opt(t)) { if (/^--(?:registry|prefix|index-url|extra-index-url|target|root|cwd|channel|python|config)$/.test(t) || ['-t', '-i', '-p', '-C'].includes(t)) i++; continue; }
    if (t === '.') { names.push('this project'); continue; }
    if (lookPath(t) && !t.startsWith('@')) { names.push(path.basename(t)); continue; }
    names.push(t);
  }
  return names.length ? names : [JS.includes(prog) ? 'the project\'s dependencies' : 'packages'];
}
const startsWith = (words, entry) => { const e = String(entry).trim().split(/\s+/); return e.length && e.every((x, i) => words[i] === x); };

/** What one simple command is: { step, events: [{ kind, names, how }], changed: [{ path, how }] }. extra: the owner's
 *  added programs ({ installs, network, pushes }, each "program" or "program subcommand"). */
export function classifyCommand({ prog, args, redirects, cwd }, extra = {}) {
  const words = [prog, ...args.map((a) => a.t)];
  const sub = nonOpt(args)[0] ?? '', rest = nonOpt(args).slice(1);
  const events = [], changed = [];
  let step = 'command';
  const ev = (kind, names = [], how = '') => events.push({ kind, names, how });
  const file = (t, how = 'changed') => changed.push({ path: path.resolve(cwd, String(t).replace(/^~(?=$|\/)/, os.homedir())), how });
  for (const r of redirects) if (!/^\/dev\//.test(r) && !/^&/.test(r)) file(r);
  // installs
  let install = false;
  if (JS.includes(prog) && (['install', 'i', 'add', 'ci'].includes(sub) || (prog === 'yarn' && !sub))) { install = true; ev('install', installNames(sub ? args.slice(args.findIndex((a) => a.t === sub) + 1) : args, prog)); }
  else if (['pip', 'pip3', 'pipx'].includes(prog) && sub === 'install') { install = true; ev('install', installNames(args.slice(args.findIndex((a) => a.t === 'install') + 1), prog)); }
  else if (prog === 'uv' && (sub === 'add' || sub === 'sync' || (['pip', 'tool'].includes(sub) && rest[0] === 'install'))) { install = true; const from = args.findIndex((a) => a.t === (sub === 'add' || sub === 'sync' ? sub : 'install')); ev('install', sub === 'sync' ? ['the project\'s dependencies'] : installNames(args.slice(from + 1), prog)); }
  else if (['poetry', 'pdm'].includes(prog) && ['add', 'install'].includes(sub)) { install = true; ev('install', sub === 'install' ? ['the project\'s dependencies'] : installNames(args.slice(args.findIndex((a) => a.t === sub) + 1), prog)); }
  else if (['conda', 'mamba', 'micromamba'].includes(prog) && ['install', 'create'].includes(sub)) { install = true; ev('install', installNames(args.slice(args.findIndex((a) => a.t === sub) + 1).filter((a, i, all) => !['-n', '--name', '-p', '--prefix', '-c', '--channel'].includes(all[i - 1]?.t)), prog)); }
  else if (prog === 'brew' && ['install', 'reinstall', 'upgrade', 'bundle'].includes(sub)) { install = true; ev('install', sub === 'bundle' ? ['the packages in the Brewfile'] : installNames(args.slice(args.findIndex((a) => a.t === sub) + 1), prog)); }
  else if (['cargo', 'go'].includes(prog) && ['install', 'add', 'get'].includes(sub) && !(prog === 'cargo' && sub === 'get')) { install = true; ev('install', installNames(args.slice(args.findIndex((a) => a.t === sub) + 1), prog)); }
  else if (['gem', 'bundle'].includes(prog) && sub === 'install') { install = true; ev('install', prog === 'bundle' ? ['the project\'s gems'] : installNames(args.slice(args.findIndex((a) => a.t === sub) + 1), prog)); }
  else if (prog === 'composer' && ['require', 'install'].includes(sub)) { install = true; ev('install', sub === 'install' ? ['the project\'s dependencies'] : installNames(args.slice(args.findIndex((a) => a.t === sub) + 1), prog)); }
  else if (['apt', 'apt-get', 'dnf', 'yum', 'zypper', 'port'].includes(prog) && sub === 'install') { install = true; ev('install', installNames(args.slice(args.findIndex((a) => a.t === sub) + 1), prog)); }
  else if (prog === 'pacman' && args.some((a) => /^-S[a-z]*$/.test(a.t))) { install = true; ev('install', installNames(args.filter((a) => !/^-S/.test(a.t)), prog)); }
  else if ((extra.installs ?? []).some((e) => startsWith(words, e))) { install = true; const n = String(extra.installs.find((e) => startsWith(words, e))).trim().split(/\s+/).length, names = nonOpt(args).slice(n - 1); ev('install', names.length ? names : ['packages']); }
  if (install) step = 'install';
  // pushes
  let pushed = false;
  const lastArg = nonOpt(args).at(-1) ?? '';
  if (prog === 'git' && sub === 'push') {
    pushed = true;
    const [remote, spec] = rest;
    const branch = spec ? spec.replace(/^\+/, '').split(':').pop().replace(/^refs\/heads\//, '') : '';
    ev('pushed', [remote ? (branch ? `the ${branch} branch to ${remote}` : `to ${remote}`) : 'the current branch'], 'git');
  } else if (prog === 'gh' && ['pr', 'release', 'repo', 'gist'].includes(sub) && rest[0] === 'create') { pushed = true; ev('pushed', [{ pr: 'a pull request', release: 'a release', repo: 'a new repository', gist: 'a gist' }[sub]], 'gh'); }
  else if ([...JS].includes(prog) && sub === 'publish') { pushed = true; ev('pushed', ['the package'], 'publish'); }
  else if ((prog === 'cargo' && sub === 'publish') || (prog === 'gem' && sub === 'push') || (prog === 'twine' && sub === 'upload') || (['uv', 'poetry', 'flit'].includes(prog) && sub === 'publish')) { pushed = true; ev('pushed', ['the package'], 'publish'); }
  else if (prog === 'docker' && (sub === 'push' || (sub === 'compose' && rest.includes('push')))) { pushed = true; ev('pushed', [rest[0] && sub === 'push' ? `the image ${rest[0]}` : 'the images'], 'docker'); }
  else if (['hf', 'huggingface-cli'].includes(prog) && sub === 'upload') { pushed = true; ev('pushed', [rest[0] ? `to ${rest[0]}` : 'files'], 'upload'); }
  else if (['scp', 'rsync'].includes(prog) && nonOpt(args).length >= 2 && isRemote(lastArg)) { pushed = true; ev('pushed', [`files to ${hostOf(lastArg) || 'another machine'}`], 'copy'); }
  else if (((prog === 'aws' && sub === 's3' && ['cp', 'sync', 'mv'].includes(rest[0])) || (prog === 'gsutil' && ['cp', 'rsync', 'mv'].includes(sub))) && /^(s3|gs):\/\//.test(lastArg)) { pushed = true; ev('pushed', [`files to ${lastArg.split('/')[2] ?? 'the cloud'}`], 'copy'); }
  else if ((extra.pushes ?? []).some((e) => startsWith(words, e))) { pushed = true; ev('pushed', ['the work'], 'extra'); }
  // removals and moves, and files changed
  const files = nonOpt(args);
  if (['rm', 'rmdir', 'unlink', 'trash', 'shred', 'srm'].includes(prog)) { for (const f of files) file(f, 'deleted'); }
  else if (prog === 'mv' && files.length >= 2) { for (const f of files.slice(0, -1)) file(f, 'moved'); file(files.at(-1), 'changed'); }
  else if (prog === 'git' && sub === 'rm') { for (const f of rest) file(f, 'deleted'); }
  else if (prog === 'git' && sub === 'mv' && rest.length >= 2) { for (const f of rest.slice(0, -1)) file(f, 'moved'); }
  else if (prog === 'git' && sub === 'clean' && args.some((a) => /^-[a-z]*f/.test(a.t) || a.t === '--force')) ev('removed', ['files git didn\'t track'], 'deleted');
  else if (prog === 'find' && (args.some((a) => a.t === '-delete') || (args.some((a) => a.t === '-exec' || a.t === '-execdir') && args.some((a) => a.t === 'rm')))) {
    const at = args.findIndex((a) => ['-name', '-iname', '-path'].includes(a.t));
    ev('removed', [at >= 0 && args[at + 1] ? `files matching ${args[at + 1].t}` : `files in ${path.basename(files[0] ?? '.') || 'the folder'}`], 'deleted');
  } else if (prog === 'rsync' && args.some((a) => a.t === '--remove-source-files') && files.length >= 2) { for (const f of files.slice(0, -1)) if (!isRemote(f)) file(f, 'moved'); }
  else if (prog === 'tee') { for (const f of files) file(f); }
  else if (prog === 'touch') { for (const f of files) file(f, 'created'); }
  else if (prog === 'cp' && files.length >= 2) file(files.at(-1));
  else if (prog === 'sed' && args.some((a) => /^-[a-zA-Z]*i/.test(a.t) || a.t.startsWith('--in-place'))) {
    const scripted = args.some((a) => a.t === '-e' || a.t === '--expression' || a.t === '-f');
    const valued = new Set(); args.forEach((a, i) => { if (['-e', '--expression', '-f'].includes(a.t) || (a.t === '-i' && /^(?:$|\.\w+$)/.test(args[i + 1]?.t ?? 'x'))) valued.add(i + 1); });
    const plain = args.filter((a, i) => !opt(a.t) && !valued.has(i)).map((a) => a.t);
    for (const f of scripted ? plain : plain.slice(1)) file(f);
  } else if (prog === 'perl' && args.some((a) => /^-[a-zA-Z]*i/.test(a.t))) {
    const valued = new Set(); args.forEach((a, i) => { if (a.t === '-e' || a.t === '-E') valued.add(i + 1); });
    for (const f of args.filter((a, i) => !opt(a.t) && !valued.has(i)).map((a) => a.t)) file(f);
  }
  // the network (not listed again for an install or a push)
  if (!install && !pushed) {
    const hosts = new Set();
    let online = false;
    if (NET_PROGS.has(prog) && prog !== 'rsync') online = true;
    if (prog === 'rsync' && files.some(isRemote)) online = true;
    if (prog === 'git' && (['clone', 'fetch', 'pull', 'ls-remote'].includes(sub) || (sub === 'submodule' && rest.includes('update')) || (sub === 'remote' && rest[0] === 'update'))) online = true;
    if (JS.includes(prog) && ['update', 'upgrade', 'up', 'outdated', 'view', 'info', 'search', 'audit', 'dlx', 'create'].includes(sub)) online = true;
    if (['pip', 'pip3'].includes(prog) && ['download', 'search', 'index'].includes(sub)) online = true;
    if (prog === 'pipx' && sub === 'run') online = true;
    if (prog === 'brew' && ['update', 'search', 'fetch', 'tap', 'outdated'].includes(sub)) online = true;
    if (prog === 'cargo' && ['update', 'search', 'fetch'].includes(sub)) online = true;
    if (prog === 'go' && sub === 'mod' && rest[0] === 'download') online = true;
    if (prog === 'docker' && (['pull', 'login', 'build', 'run', 'search'].includes(sub) || (sub === 'compose' && rest.includes('pull')))) online = true;
    if (['hf', 'huggingface-cli'].includes(prog) && ['download', 'login'].includes(sub)) online = true;
    if (prog === 'ollama' && ['pull', 'push'].includes(sub)) online = true;
    if (RUNNERS.has(prog)) online = true;
    if ((extra.network ?? []).some((e) => startsWith(words, e))) online = true;
    if (!TEXT_PROGS.has(prog) && !(prog === 'git' && ['commit', 'log', 'tag', 'show', 'config'].includes(sub))) {
      for (const a of args) { const t = a.t.trim(); if (URL_WORD.test(t) || USER_HOST.test(t) || (['ssh', 'scp', 'sftp', 'rsync', 'mosh'].includes(prog) && isRemote(t))) { online = true; const h = hostOf(t); if (h) hosts.add(h); } }
    }
    if (online) ev('network', [...hosts], prog);
  }
  if (step === 'command') {
    if (['pytest', 'jest', 'vitest', 'mocha', 'ava', 'rspec', 'phpunit', 'ctest', 'tox', 'nox', 'unittest'].includes(prog) || (JS.includes(prog) && (sub === 'test' || sub === 't' || (sub === 'run' && /test/.test(rest[0] ?? '')))) || (['cargo', 'go', 'swift', 'dotnet', 'deno'].includes(prog) && sub === 'test') || (prog === 'make' && ['test', 'check'].includes(sub)) || (prog === 'node' && args.some((a) => a.t === '--test'))) step = 'test';
    else if ((JS.includes(prog) && (sub === 'build' || (sub === 'run' && /build/.test(rest[0] ?? '')))) || (['cargo', 'go', 'swift', 'dotnet', 'vite'].includes(prog) && sub === 'build') || ['make', 'tsc', 'xcodebuild', 'gradle', 'mvn', 'cmake', 'ninja'].includes(prog)) step = 'build';
    else if (prog === 'git' && sub === 'commit') step = 'commit';
  }
  return { step, events, changed };
}

const STEP_RANK = ['test', 'build', 'commit', 'install', 'command'];
/** One pi step, from its tool_execution_start: what kind it is, its events and the files it changes. */
export function classifyStep(tool, args = {}, { cwd, extra = {}, exists = fs.existsSync } = {}) {
  if (tool === 'bash') {
    const parts = commandsOf(String(args.command ?? ''), cwd).map((c) => classifyCommand(c, extra));
    const step = parts.map((p) => p.step).sort((a, b) => STEP_RANK.indexOf(a) - STEP_RANK.indexOf(b))[0] ?? 'command';
    return { step, events: parts.flatMap((p) => p.events), changed: parts.flatMap((p) => p.changed) };
  }
  const p = args.path ?? args.file_path ?? args.file;
  if (tool === 'edit' && p) return { step: 'changed', events: [], changed: [{ path: path.resolve(cwd, p), how: 'changed' }] };
  if (tool === 'write' && p) { const at = path.resolve(cwd, p); return { step: exists(at) ? 'changed' : 'created', events: [], changed: [{ path: at, how: exists(at) ? 'changed' : 'created' }] }; }
  if (tool === 'read') return { step: 'read', events: [], changed: [] };
  if (['grep', 'find', 'ls'].includes(tool)) return { step: 'searched', events: [], changed: [] };
  if (/web|fetch|http|browse|search/i.test(String(tool))) { const h = typeof args.url === 'string' ? hostOf(args.url) : ''; return { step: 'command', events: [{ kind: 'network', names: h ? [h] : [], how: 'tool' }], changed: [] }; }
  return { step: 'command', events: [], changed: [] };
}

/** Words of the commands pi ran, for the checks: pairs and triples of words in a row, from the words outside quotes. */
export function commandWords(command) {
  const pairs = new Set(), triples = new Set();
  for (const c of lex(command)) {
    const toks = c.words.filter((w) => !w.q).flatMap((w) => normal(w.t).split(' ')).filter(Boolean);
    for (let i = 0; i + 1 < toks.length; i++) { if (!(COMMON.has(toks[i]) && COMMON.has(toks[i + 1]))) pairs.add(`${toks[i]} ${toks[i + 1]}`); if (i + 2 < toks.length) triples.add(`${toks[i]} ${toks[i + 1]} ${toks[i + 2]}`); }
  }
  return { pairs, triples };
}
const COMMON = new Set('a an the and or of to in on at for with it is be by as from this that i you we he she they me my your our up down out off over all any some no not do did done have has had am are was were will would can could should may might go get got make made run ran test tests set use used new old one two three'.split(' '));

// ---- pi's own words, cleaned
const tempDirs = () => { const t = [os.tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders']; try { t.push(fs.realpathSync(os.tmpdir())); } catch { /* as it is */ } return t; };
const isTemp = (p) => tempDirs().some((d) => p === d || p.startsWith(d.endsWith(path.sep) ? d : d + path.sep)) || /(^|[\\/])\.git([\\/]|$)/.test(p) || /(^|[\\/])(__pycache__|node_modules)([\\/]|$)/.test(p);

/** pi's statement without code, commands, web addresses, long tokens or paths (a path becomes its last part), and
 *  without any three words in a row that a command it ran had. */
export function cleanSaid(text, triples = new Set(), max = 300) {
  let t = String(text ?? '')
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .split('\n').filter((l) => !/^\s*[$>]/.test(l) && !/^\s*\|/.test(l)).join(' ')
    .replace(URL_ANY, ' ')
    .replace(/\b[A-Za-z0-9_+/=-]{32,}\b/g, ' ')
    .replace(/(?:~|\.{1,2})?(?:\/[\w.@+-]+)+\/?|(?:[\w.@+-]+\/)+([\w.@+-]+)/g, (m, last) => last ?? path.basename(m))
    .replace(/(^|\s)--?[a-zA-Z][\w-]*/g, ' ')
    .replace(/[*_~#>|]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (triples.size) {
    const ws = t.split(' '), drop = new Set();
    const n = ws.map((w) => normal(w));
    for (let i = 0; i + 2 < ws.length; i++) if (triples.has(`${n[i]} ${n[i + 1]} ${n[i + 2]}`)) { drop.add(i); drop.add(i + 1); drop.add(i + 2); }
    t = ws.filter((_, i) => !drop.has(i)).join(' ');
  }
  return t.length > max ? `${t.slice(0, max).replace(/\s+\S*$/, '')}…` : t;
}

// ---- named in the task
const folderNamed = (text, name) => {
  const t = ` ${normal(text)} `, n = normal(name);
  if (!n) return false;
  if (String(text).includes(`${name}/`) || String(text).includes(`${name}\\`)) return true;
  if (n.split(' ').length >= 2 && t.includes(` ${n} `)) return true;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(` (?:${esc} (?:folder|directory|dir)|(?:folder|directory|dir) (?:called |named )?${esc}) `).test(t);
};
/** Whether a file is named by the task (his words) or the prompt he approved: by feature 14's rule for the file, or
 *  its path, or a folder it is inside named as a folder (the owner, answer 3). */
export function namedBy(texts, file, project) {
  const rel = path.relative(project, file);
  const inside = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  const parts = (inside ? rel : file).split(/[\\/]/).filter(Boolean);
  const base = parts.at(-1) ?? '';
  for (const text of texts.filter(Boolean)) {
    if (namedIn(text, base)) return true;
    if (inside && rel.includes('/') && text.includes(rel)) return true;
    if (inside && parts.slice(0, -1).some((d) => folderNamed(text, d))) return true;
  }
  return false;
}

// ---- the watcher
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const STEP_WORDS = { read: ['file read', 'files read'], searched: ['search', 'searches'], changed: ['file changed', 'files changed'], created: ['file created', 'files created'], command: ['command run', 'commands run'], install: ['install', 'installs'], test: ['test run', 'test runs'], build: ['build', 'builds'], commit: ['commit', 'commits'] };
const ZERO = () => ({ read: 0, searched: 0, changed: 0, created: 0, command: 0, install: 0, test: 0, testFailed: 0, build: 0, commit: 0, errors: 0, retries: 0, tidied: 0 });

/** Fed pi's events (event(e)); keeps the counts, pi's statements and the events, and gives the digest. task: his words
 *  (or the prompt's first sentence); prompt: what he approved; project: pi's folder. */
export function createWatch({ task = '', prompt = '', project = process.cwd(), mode = 'read', extra = {}, limits: given = {}, now = Date.now, exists = fs.existsSync } = {}) {
  const limits = { piStatements: 3, piStatementChars: 300, piNamesSaid: 3, piReplyChars: 3000, ...given };
  const t0 = now();
  const totals = ZERO();
  let base = ZERO();
  const said = []; // { text, at }
  let saidFrom = 0, lastSaid = '';
  const events = []; // { id, kind, names, how, status, told, call }
  const calls = new Map(); // toolCallId → { events: [ids], step }
  const pairs = new Set(), triples = new Set();
  const changedFiles = new Map(); // path → { how, named, status }
  let seq = 0, gen = 0, compared = false;
  const add = (kind, names, how, call) => {
    // the same kind and names already waiting to be told, from another command: counted once more, not listed twice
    const same = events.find((e) => !e.told && e.kind === kind && e.how === how && e.status !== 'failed' && JSON.stringify(e.names) === JSON.stringify(names) && kind !== 'network');
    if (same) { same.count++; if (call) same.calls.add(call); return same; }
    const e = { id: ++seq, kind, names: [...names], how, status: call ? 'running' : 'ok', told: false, count: 1, calls: new Set(call ? [call] : []) };
    events.push(e); gen++;
    return e;
  };
  const noteFile = (file, how, call) => {
    const rel = path.relative(project, file), inProject = !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
    if (inProject ? /(^|[\\/])(\.git|__pycache__|node_modules)([\\/]|$)/.test(rel) : isTemp(file)) return null; // a temporary folder never holds pi's project here
    if (how === 'deleted' || how === 'moved') return add('removed', [path.basename(file)], how, call);
    if (namedBy([task, prompt], file, project) || changedFiles.has(file)) return null;
    changedFiles.set(file, { how });
    return add('unnamed', [path.basename(file)], 'changed', call);
  };
  function event(e) {
    if (!e || typeof e !== 'object') return { urgent: false };
    if (e.type === 'tool_execution_start') {
      const c = classifyStep(e.toolName, e.args ?? {}, { cwd: project, extra, exists });
      if (e.toolName === 'bash') { const w = commandWords(String(e.args?.command ?? '')); for (const p of w.pairs) pairs.add(p); for (const t of w.triples) triples.add(t); }
      totals[c.step] = (totals[c.step] ?? 0) + 1;
      gen++;
      const ids = [];
      const call = e.toolCallId ?? `call-${seq + 1}`;
      for (const x of c.events) ids.push(add(x.kind, x.names, x.how, call).id);
      for (const f of c.changed) { const x = noteFile(f.path, f.how, call); if (x) ids.push(x.id); }
      calls.set(call, { ids, step: c.step });
      return { urgent: ids.some((id) => URGENT_KINDS.includes(events.find((x) => x.id === id)?.kind)) };
    }
    if (e.type === 'tool_execution_end') {
      const c = calls.get(e.toolCallId);
      if (e.isError) { totals.errors++; if (c?.step === 'test') totals.testFailed++; }
      if (c) for (const id of c.ids) { const x = events.find((y) => y.id === id); if (x && x.status === 'running') x.status = e.isError ? 'failed' : 'ok'; }
      gen++;
      return { urgent: false, ended: !!c?.ids.length, running: running() };
    }
    if (e.type === 'auto_retry_start') { totals.retries++; gen++; }
    if (e.type === 'compaction_start') { totals.tidied++; gen++; }
    if (e.type === 'message_end' && e.message?.role === 'assistant') {
      const text = (Array.isArray(e.message.content) ? e.message.content.filter((b) => b?.type === 'text').map((b) => b.text).join('') : String(e.message.content ?? '')).trim();
      if (text) { said.push({ raw: text }); gen++; }
    }
    return { urgent: false };
  }
  const running = () => events.some((e) => e.status === 'running' && URGENT_KINDS.includes(e.kind));
  /** The changes found by comparing the project with the snapshot taken before an edit hand-off: [{ status, path,
   *  from }] (git's letters: M, A, D, R). Those the commands already showed are not added again. */
  function compare(changes = []) {
    compared = true;
    for (const c of changes) {
      const abs = path.resolve(project, c.path);
      if (c.status === 'D') { if (!events.some((e) => e.kind === 'removed' && e.names.includes(path.basename(abs)))) noteFile(abs, 'deleted'); }
      else if (c.status === 'R') { const from = path.resolve(project, c.from ?? c.path); if (!events.some((e) => e.kind === 'removed' && e.names.includes(path.basename(from)))) noteFile(from, 'moved'); }
      else noteFile(abs, 'changed');
    }
  }
  const statementsSince = (from) => said.slice(from).map((s) => cleanSaid(s.raw, triples, limits.piStatementChars)).filter(Boolean).slice(-limits.piStatements);
  /** What is told now: the counts since the last update and in all, pi's statements since then, and the events not
   *  yet told (all of them for the closing summary). final: { status, problem, reply }. */
  function digest(final = null) {
    const since = Object.fromEntries(Object.keys(totals).map((k) => [k, totals[k] - base[k]]));
    const reply = final ? cleanSaid(final.reply ?? '', triples, limits.piReplyChars) : '';
    const statements = final ? said.slice(0, -1).map((s) => cleanSaid(s.raw, triples, limits.piStatementChars)).filter(Boolean).slice(-limits.piStatements) : statementsSince(saidFrom);
    const toTell = (final ? events : events.filter((e) => !e.told)).filter((e) => !(e.kind === 'unnamed' && e.status === 'failed')).map((e) => ({ ...e, calls: undefined }));
    return {
      final: !!final, task, mode, minutes: Math.round((now() - t0) / 60000), since, totals: { ...totals }, statements, reply, lastSaid,
      status: final?.status ?? 'working', problem: final?.problem ?? '', asks: !!final && /\?\s*$/.test(String(final.reply ?? '').trim()),
      toTell, everKinds: [...new Set(events.map((e) => e.kind))], mark: { totals: { ...totals }, said: said.length, gen },
    };
  }
  /** The update d was given, saying text: its events are told, and the counts start again from there. */
  function given(d, text) {
    for (const e of d.toTell) { const x = events.find((y) => y.id === e.id); if (x) x.told = true; }
    base = { ...d.mark.totals }; saidFrom = d.mark.said; lastSaid = String(text ?? '');
    toldGen = d.mark.gen;
  }
  let toldGen = 0;
  return {
    event, compare, digest, given, running,
    /** Something new since the last update given: a step, a statement or an event. */
    pending: () => gen !== toldGen,
    urgentWaiting: () => events.some((e) => !e.told && URGENT_KINDS.includes(e.kind)),
    events: () => events.map((e) => ({ ...e, calls: undefined })),
    words: () => ({ pairs, triples }),
    compared: () => compared,
  };
}

// ---- the digest as the model reads it
const list = (names, max) => {
  const n = [...new Set(names)];
  if (n.length <= 1) return n[0] ?? '';
  if (n.length <= max) return `${n.slice(0, -1).join(', ')} and ${n.at(-1)}`;
  return `${n.slice(0, max).join(', ')} and ${n.length - max} more`;
};
const countsLine = (c) => {
  const parts = [];
  for (const k of ['read', 'searched', 'changed', 'created', 'install', 'test', 'build', 'commit', 'command']) if (c[k] > 0) parts.push(plural(c[k], ...STEP_WORDS[k]));
  if (c.testFailed > 0) parts.push(`${plural(c.testFailed, 'test run')} failed`);
  if (c.errors > 0) parts.push(plural(c.errors, 'step') + ' ended in an error');
  if (c.retries > 0) parts.push(plural(c.retries, 'retry', 'retries'));
  if (c.tidied > 0) parts.push('its memory tidied');
  return parts.join(', ') || 'nothing yet';
};
/** How an event is described to the model. */
export function eventText(e, max = 3) {
  const names = list(e.names, max), st = e.status === 'failed' ? ' (it failed)' : e.status === 'running' ? ' (still running)' : '';
  switch (e.kind) {
    case 'install': return `installed ${names}${st}`;
    case 'removed': return `${e.how === 'moved' ? 'moved' : 'deleted'} ${names}${st}`;
    case 'unnamed': return `changed ${names}, which the task didn't name`;
    case 'network': return `${e.count > 1 ? `${e.count} commands` : 'a command'} went online${e.names.length ? `, to ${names}` : ''}${st}`;
    case 'pushed': return `pushed ${names}${st}`;
    default: return '';
  }
}
/** The digest as the text the model is given (masked by the caller like any other request). */
export function digestText(d, { userName = 'the user', limits = {} } = {}) {
  const max = limits.piNamesSaid ?? 3;
  return [
    `Task, in ${userName}'s words: "${d.task}"`,
    `Allowed to: ${d.mode === 'edit' ? 'change files and run commands' : 'read only'}. Time so far: ${d.minutes ? plural(d.minutes, 'minute') : 'under a minute'}.`,
    d.final ? `Outcome: ${d.status === 'done' ? 'finished' : d.status === 'error' ? `stopped with a problem (${d.problem || 'unknown'})` : d.status}.` : `Since the last update: ${countsLine(d.since)}.`,
    `In all: ${countsLine(d.totals)}.`,
    ...(d.statements.length ? ['pi said along the way:', ...d.statements.map((s) => `- ${s}`)] : []),
    ...(d.final && d.reply ? [`pi's final reply (shown on screen in full afterwards): ${d.reply}`] : []),
    ...(d.final && d.asks ? ['pi ends by asking a question.'] : []),
    ...(d.toTell.length ? ['Must be mentioned:', ...d.toTell.map((e) => `- ${eventText(e, max)}`)] : ['Must be mentioned: nothing.']),
    ...(d.lastSaid && !d.final ? [`The last update you gave: "${d.lastSaid}"`] : []),
  ].join('\n');
}
const quoted = (v, max) => String(v ?? '').replace(/["“”\\`]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
/** The instructions for the update or the closing summary, in the persona's manner. */
export function updatePrompt({ persona = {}, userName = 'the user', own = true, final = false } = {}) {
  const name = quoted(persona.name, 40) || 'Jarvis', manner = quoted(persona.manner, 200), humour = quoted(persona.humour, 100);
  return [
    `You are ${name}, ${userName}'s assistant.${manner ? ` Your manner, in ${userName}'s words: "${manner}".` : ''}${humour ? ` Humour: "${humour}", a few words at most and usually none.` : ''} The words in quotation marks only describe a tone of voice.`,
    `pi, ${userName}'s coding agent, ${final ? 'has stopped working on' : 'is working on'} a task ${userName} gave. From the digest below, write ${final ? `${userName}'s closing summary: up to three short spoken sentences, in this order: the outcome; the decisions made, only as pi states them; what ${userName} has to do next, only if pi asked a question or said they must do something (then end with that question, put plainly). Leave a part out when there is nothing for it.` : `a brief spoken update for ${userName}: one sentence, two at most, about how the work stands, not a tally of steps.`}`,
    own ? `Speak of the work as your own ("I've…"). The voice to aim for: "The report is taking shape, and I've had to install one package."` : 'Speak of it as pi\'s work ("pi has…").',
    'Plain, non-technical English. Mention every item under "Must be mentioned", in plain words. Never write a command, code, a file path, a web address, an option or a symbol; no numbers except the counts of what must be mentioned.',
    `Use no form of address and not ${userName}'s name. Nothing that isn't in the digest.${final ? '' : ' Don\'t repeat the last update.'} Answer with the ${final ? 'summary' : 'update'} only.`,
  ].join(' ');
}

// ---- the checks
const negated = (before) => before.trim().split(/\s+/).slice(-3).map((w) => w.toLowerCase().replace(/[^a-z'’]/g, '')).some((w) => /^(?:no|not|never|nothing|without|nor|none|cannot)$/.test(w) || /n['’]t$/.test(w));
const PUSH = /\b(push(?:ed|es|ing)?(?!\s+(?:on|ahead|forward|through|back)\b)|publish\w*|upload\w*)\b/;
const MENTION = {
  install: /\b(install\w*|(?:add(?:ed|ing)?|pull(?:ed|ing)? in|brought in|fetch(?:ed|ing)?|set(?:ting)? up|need(?:ed)?)(?:\s+\S+){0,3}?\s+(?:packages?|librar(?:y|ies)|dependenc(?:y|ies)))\b/,
  removed: /\b(delet\w*|remov\w*|(?:moved|moving)(?!\s+(?:on|along|forward|ahead)\b))\b/,
  network: /\b(online|internet|download\w*)\b/,
  pushed: PUSH,
};
const CLAIM = {
  install: /\b(install(?:ed|ing|s)?)\b/,
  removed: /\b(delet(?:ed|ing)|remov(?:ed|ing)|moved(?!\s+(?:on|along|forward|ahead)\b))\b/,
  network: /\b(online|internet|download(?:ed|ing)?)\b/,
  pushed: PUSH,
};
const hits = (re, text) => [...text.matchAll(new RegExp(re.source, 'gi'))].some((m) => !negated(text.slice(0, m.index)));
const UNNAMED_PHRASE = /\b(?:didn['’]?t|did not|not|never)\s+(?:name|mention|ask(?:ed)? (?:for|about))\b|\bunnamed\b|\bnot (?:in|part of) (?:the|your) (?:task|request)\b/i;
/** Whether text mentions an event of this kind (unnamed: the phrase, or every file's name). */
export function mentions(kind, text, names = []) {
  if (kind === 'unnamed') { const low = text.toLowerCase(); return UNNAMED_PHRASE.test(text) || (names.length > 0 && names.every((n) => low.includes(n.toLowerCase()) || low.includes(n.toLowerCase().replace(/\.[^.]+$/, '')))); }
  return hits(MENTION[kind], text);
}
const FORBIDDEN = /`|\$ |(?:^|\s)--?[a-zA-Z]|\||&&|[<>]|(?:^|\s)[~.]?\/|\w\/\w|https?:|www\.|[{}[\]]|;\s*$/;
const sentencesOf = (t) => t.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
/** The model's text, checked: { text, ok, why, cut }. ok false: code's fallback is used in its place. */
export function checkSentence(raw, d, { pairs = new Set(), limits = {} } = {}) {
  let t = String(raw ?? '').replace(/^\s*(?:update|summary)\s*:\s*/i, '').replace(/^["“']+|["”']+$/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return { text: '', ok: false, why: 'empty', cut: false };
  const max = d.final ? MAX_SENTENCES.summary : MAX_SENTENCES.update;
  const all = sentencesOf(t);
  let cut = false;
  if (all.length > max) { t = all.slice(0, max).join(' '); cut = true; }
  const chars = d.final ? limits.piSummaryChars ?? 400 : limits.piUpdateChars ?? 220;
  if (t.length > chars) return { text: t, ok: false, why: 'long', cut };
  if (FORBIDDEN.test(t)) return { text: t, ok: false, why: 'command', cut };
  const toks = normal(t).split(' ');
  for (let i = 0; i + 1 < toks.length; i++) if (pairs.has(`${toks[i]} ${toks[i + 1]}`)) return { text: t, ok: false, why: 'command', cut };
  for (const kind of Object.keys(CLAIM)) if (!d.everKinds.includes(kind) && hits(CLAIM[kind], t)) return { text: t, ok: false, why: 'claim', cut };
  return { text: t, ok: true, why: '', cut };
}

/** Code's own line for each event the text leaves out (all of them when text is ''). own: Roamies speaks of pi's work
 *  as its own. → [line] */
export function codeLines(toTell, text = '', { own = true, max = 3 } = {}) {
  const lines = [];
  const who = own ? { has: 'I\'ve', is: 'I\'m', tried: 'I tried', cmd: 'command' } : { has: 'Pi has', is: 'Pi is', tried: 'Pi tried', cmd: 'of pi\'s commands' };
  const by = (kind) => toTell.filter((e) => e.kind === kind);
  const groups = (es, key) => { const m = new Map(); for (const e of es) { const k = key(e); m.set(k, [...(m.get(k) ?? []), e]); } return m; };
  for (const kind of EVENT_KINDS) {
    const es = by(kind);
    if (!es.length) continue;
    if (text && mentions(kind, text, es.flatMap((e) => e.names))) continue;
    for (const [k, g] of groups(es, (e) => `${e.status}|${e.how}`)) {
      const [status, how] = k.split('|');
      const names = g.flatMap((e) => e.names), what = list(names, max);
      if (kind === 'install') {
        const pk = names.length === 1 && /^(the |this |packages$)/.test(names[0]) ? what : `${plural(names.length, 'package')}: ${what}`;
        lines.push(status === 'failed' ? `${who.tried} to install ${what}; it failed.` : status === 'running' ? `${who.is} installing ${what}.` : `${who.has} installed ${pk}.`);
      } else if (kind === 'removed') {
        const verb = how === 'moved' ? ['moved', 'moving', 'move'] : ['deleted', 'deleting', 'delete'];
        lines.push(status === 'failed' ? `${who.tried} to ${verb[2]} ${what}; it failed.` : status === 'running' ? `${who.is} ${verb[1]} ${what}.` : `${who.has} ${verb[0]} ${what}.`);
      } else if (kind === 'unnamed') {
        lines.push(`${who.has} also changed ${what}, which you didn't name.`);
      } else if (kind === 'network') {
        const n = g.reduce((s, e) => s + e.count, 0);
        const hosts = list(names, max);
        const subject = n === 1 ? `One ${who.cmd}` : `${n} ${own ? 'commands' : 'of pi\'s commands'}`;
        lines.push(`${subject} ${status === 'failed' ? (n === 1 ? 'tried to go' : 'tried to go') : 'went'} online${hosts ? `, to ${hosts}` : ''}${status === 'failed' ? '; it failed' : ''}.`);
      } else if (kind === 'pushed') {
        lines.push(status === 'failed' ? `${who.tried} to push ${what}; it failed.` : status === 'running' ? `${who.is} pushing ${what}.` : `${who.has} pushed ${what}.`);
      }
    }
  }
  return lines;
}

/** Code's sentence when the model's can't be used, or no request is made. */
export function fallbackSentence(d, { own = true } = {}) {
  if (!d.final) return own ? 'I\'m still working on it.' : 'Pi\'s still working on it.';
  const q = d.asks ? ' There\'s a question for you on screen.' : '';
  if (d.status === 'done') return `${own ? 'That\'s done; the full reply is on screen.' : 'Pi has finished; its full reply is on screen.'}${q}`;
  return `${own ? 'I ran into a problem; the details are on screen.' : 'Pi ran into a problem; the details are on screen.'}${q}`;
}

/** What is said: the model's checked text (or code's fallback), then code's lines for what it left out.
 *  → { text, how: 'worded' | 'fallback' | 'plain', why, cut, added } */
export function compose(d, raw, { own = true, pairs = new Set(), limits = {}, plain = false } = {}) {
  const c = plain || raw == null ? { ok: false, why: plain ? 'plain' : 'no answer', text: '', cut: false } : checkSentence(raw, d, { pairs, limits });
  const first = c.ok ? c.text : fallbackSentence(d, { own });
  const lines = codeLines(d.toTell, c.ok ? c.text : '', { own, max: limits.piNamesSaid ?? 3 });
  return { text: [first, ...lines].join(' '), how: plain ? 'plain' : c.ok ? 'worded' : 'fallback', why: c.why, cut: c.cut, added: lines.length };
}

// ---- when updates are given
/** The update ticks: one every `seconds` (none when 0), only when something is new (due() decides); an urgent
 *  event brings the next forward to within URGENT_SECONDS, or a moment after the commands behind it end. */
export function createSchedule({ seconds, urgentSeconds = URGENT_SECONDS, due, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let tick = null, urgent = null, stopped = false;
  const arm = () => { clearTimer(tick); tick = seconds > 0 && !stopped ? setTimer(fire, seconds * 1000) : null; };
  function fire() { clearTimer(urgent); urgent = null; if (stopped) return; arm(); try { due(); } catch (e) { console.error('pi update', e); } }
  arm();
  return {
    urgent() { if (stopped || seconds <= 0 || urgent) return; urgent = setTimer(fire, urgentSeconds * 1000); },
    settled() { if (stopped || !urgent) return; clearTimer(urgent); urgent = setTimer(fire, 2000); },
    stop() { stopped = true; clearTimer(tick); clearTimer(urgent); tick = urgent = null; },
  };
}
