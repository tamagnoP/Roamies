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
//
// ~/Documents/roamies-pi/settings.json holds the project folder pi starts in and the list of projects to pick from.
// Only the user edits that list; the model can switch between listed projects, after a yes.
// While pi is working, Roamies' other tools are refused (gateTools): it can talk, keep the to-do list, or stop pi.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const READ_TOOLS = 'read,grep,find,ls';
const SHOW_MAX = 600; // characters of a prompt the approval bubble holds; longer ones are also saved to pending.txt
const STEP_GAP = 1500; // ms between step bubbles, so a burst of steps doesn't flicker
const LIVE_MAX = 3000; // characters of pi's last reply the model is given

// Tools taken out of Roamies: files and commands are pi's job.
export const REMOVED = new Set(['read_file', 'list_files', 'search_files', 'write_file', 'edit_file', 'run_command', 'fetch_url']);
// What still works while pi is busy.
const DURING = new Set(['stop_pi', 'remember_commitment', 'update_commitment', 'forget_fact', 'list_commitments', 'show_list']);

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

// voice: the Mac voice for every look ('' = the system voice); voices: one per look, which wins over voice.
const DEFAULT_VOICES = { jarvis: 'Daniel' }; // JARVIS speaks British English unless the settings say otherwise
const DEFAULTS = (dir) => ({ project: dir, projects: [dir], pi: 'pi', maxMinutes: 60, voice: '', voices: DEFAULT_VOICES });

/** Reads ~/Documents/roamies-pi/settings.json, making the folder and the file the first time. */
export function loadSettings(home) {
  const dir = path.join(home, 'Documents', 'roamies-pi'), file = path.join(dir, 'settings.json');
  fs.mkdirSync(path.join(dir, 'log'), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, `${JSON.stringify({ ...DEFAULTS(tilde(dir, home)), projects: [tilde(dir, home)] }, null, 2)}\n`);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${tilde(file, home)} isn't valid JSON (${e.message}). Fix or delete it.`); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${tilde(file, home)} should be a JSON object.`);
  // projects: a list of folders (named by their last part), or { name: folder }.
  const list = Array.isArray(raw.projects) ? raw.projects.map((p) => [base(expand(p, home)), p]) : raw.projects && typeof raw.projects === 'object' ? Object.entries(raw.projects) : [];
  const projects = list.filter(([n, p]) => n && typeof p === 'string' && p.trim()).map(([name, p]) => ({ name: String(name), dir: expand(p.trim(), home) }));
  const project = expand(typeof raw.project === 'string' && raw.project.trim() ? raw.project.trim() : dir, home);
  if (!projects.some((p) => p.dir === project)) projects.unshift({ name: base(project), dir: project });
  const minutes = Number(raw.maxMinutes);
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const voices = raw.voices && typeof raw.voices === 'object' && !Array.isArray(raw.voices) ? Object.fromEntries(Object.entries(raw.voices).map(([k, v]) => [k.toLowerCase(), str(v)]).filter(([, v]) => v)) : raw.voices === undefined ? { ...DEFAULT_VOICES } : {};
  return { dir, file, raw, project, projects, voice: str(raw.voice), voices, pi: typeof raw.pi === 'string' && raw.pi.trim() ? raw.pi.trim() : 'pi', maxMinutes: minutes > 0 ? minutes : 60 };
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
  return '';
}

export function createPi({ home = os.homedir(), userName = 'the user', say = () => {}, tell = () => {}, ask, log = () => {}, onChange = () => {}, spawnImpl = spawn, shell = process.env.SHELL || '/bin/zsh', now = () => Date.now() } = {}) {
  let job = null; // the hand-off pi is working on
  let last = null; // the one before: { prompt, mode, project, status, reply, at }
  let approval = null; // an approval waiting for Send: { answer(text) }
  const sessions = new Map(); // project folder -> pi session id of the last hand-off there
  let seq = 0;

  const stamp = (d = new Date(now())) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;

  /** Shows the hand-off and waits for Send (a click, the Y key, or the word "send"). */
  async function approve({ prompt, mode, project, followUp, dir }, signal) {
    const where = tilde(project, home);
    const head = `Send to pi?  ${mode === 'edit' ? 'CAN EDIT files and run commands' : 'Read only'} · in ${where}${followUp ? ' · continues the last pi task' : ''}`;
    let body = prompt;
    const pendingFile = path.join(dir, 'pending.txt');
    if (prompt.length > SHOW_MAX) {
      fs.writeFileSync(pendingFile, `${head}\n\n${prompt}\n`);
      body = `${prompt.slice(0, SHOW_MAX - 100)}… (the whole text is in ${tilde(pendingFile, home)})`;
    }
    tell(null, `For pi, ${mode === 'edit' ? 'with editing allowed' : 'read only'}${followUp ? ', continuing the last task' : ''}. ${forVoice(prompt)} Say send to send it.`);
    const closing = new AbortController();
    const signals = signal ? AbortSignal.any([signal, closing.signal]) : closing.signal;
    let by = 'click';
    const voiced = new Promise((resolve) => { approval = { listening: false, answer: (text) => { by = 'voice'; resolve(isSend(text)); } }; });
    // Once the user has started talking, the answer is what they say: a bubble that closes meanwhile isn't a "no".
    const clicked = ask({ placeholder: `${head}\n\n${body}`, choices: ['Send', "Don't send"] }, signals).then((a) => (a == null && approval?.listening ? new Promise(() => {}) : isSend(a)));
    try {
      const ok = await Promise.race([clicked, voiced]);
      return { ok, by };
    } finally {
      approval = null;
      closing.abort(); // closes the bubble if it was answered by voice
      fs.rmSync(pendingFile, { force: true });
    }
  }

  function start({ prompt, mode, project, followUp, settings, by }) {
    const id = ++seq, t0 = now();
    const record = path.join(settings.dir, 'log', `${stamp()}_${String(id).padStart(3, '0')}_${mode}.jsonl`); // one file per hand-off
    const write = (o) => { try { fs.appendFileSync(record, `${typeof o === 'string' ? o : JSON.stringify(o)}\n`); } catch { /* the record is best effort */ } };
    const session = followUp ? sessions.get(project) : null;
    // "--" ends pi's options; a leading @ would attach a file, so it's kept off the front.
    const text = prompt.startsWith('@') ? ` ${prompt}` : prompt;
    const args = ['--mode', 'json', ...(mode === 'read' ? ['--tools', READ_TOOLS] : []), ...(session ? ['--session', session] : []), '--', text];
    write({ type: 'roamies_handoff', at: new Date(t0).toISOString(), project, mode, follow_up: !!session, approved_by: by, prompt, command: [settings.pi, ...args.slice(0, -1), '<prompt>'] });
    const env = { ...process.env };
    if (path.isAbsolute(settings.pi)) env.PATH = `${path.dirname(settings.pi)}${path.delimiter}${env.PATH ?? ''}`; // node sits beside it
    // A login shell, so pi and node are found the way they are in Terminal. The prompt travels as an argument, never as shell text.
    const child = spawnImpl(shell, ['-lc', 'exec "$0" "$@"', settings.pi, ...args], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const j = job = { id, prompt, mode, project, at: t0, child, stopped: false, reply: '', problem: '', stderr: '', steps: 0, record };
    log('pi_start', { mode, followUp: !!session, chars: prompt.length });
    onChange();
    let stepAt = 0, stepTimer = null, stepText = '';
    const step = (line) => {
      j.steps++; stepText = `pi · ${line}`;
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
    const timer = setTimeout(() => { j.problem = `it ran for over ${settings.maxMinutes} minutes, so I stopped it`; j.stopped = 'timeout'; child.kill(); }, settings.maxMinutes * 60_000);
    let finished = false;
    const finish = (code, spawnError) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer); clearTimeout(stepTimer);
      const errText = spawnError ? spawnError.message : j.stderr.trim().split('\n').filter(Boolean).slice(-3).join(' ');
      let status = 'done';
      if (j.stopped === true) status = 'stopped';
      else if (code === 127 || /command not found|No such file or directory/i.test(spawnError?.message ?? (code ? errText : ''))) { status = 'error'; j.problem = `I couldn't start pi ("${settings.pi}" wasn't found). Put its full path, from \`which pi\` in Terminal, as "pi" in ${tilde(settings.file, home)}.`; }
      else if (j.problem || code || !j.reply) { status = 'error'; j.problem ||= errText || (code ? `pi exited with code ${code}` : 'pi finished without a reply'); }
      last = { prompt: j.prompt, mode: j.mode, project: j.project, status, reply: j.reply, problem: status === 'error' ? j.problem : '', at: now() };
      write({ type: 'roamies_result', at: new Date(now()).toISOString(), status, exit: code ?? null, ms: now() - t0, steps: j.steps, reply: j.reply, problem: last.problem || undefined });
      log('pi_end', { status, ms: now() - t0, steps: j.steps, chars: j.reply.length });
      if (job === j) job = null;
      onChange();
      if (status === 'stopped') tell('Stopped pi.', 'Stopped pi.');
      else if (status === 'error') tell(`pi ran into a problem: ${j.problem}${j.reply ? `\n\n**pi said:**\n${j.reply}` : ''}`, `pi ran into a problem. ${forVoice(j.problem)}`);
      else tell(`**pi says:**\n${j.reply}`, `pi says: ${forVoice(j.reply)}`);
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
      description: `Hand a task to pi, ${userName}'s coding agent: the only way anything is read from, searched in, written to or run on ${userName}'s files. Write prompt as a complete instruction in ${userName}'s own words and intent, adding nothing they didn't ask for; pi has not seen this conversation or the screen, so include what it needs (file names, what was said, text you read on screen if they asked about it). mode "read" lets pi only read and search; "edit" also lets it change files and run commands: use "edit" only when ${userName} asked for something to be changed, made or run. follow_up true continues the last pi task in this project, e.g. to pass on ${userName}'s answer to a question pi asked. Nothing is sent until ${userName} has seen the exact prompt and said send; pi then works in the background and the app itself shows and reads out pi's steps and its reply, so don't wait for it, repeat it or sum it up.`,
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
        const { ok, by } = await approve({ prompt: text, mode: m, project: settings.project, followUp: cont, dir: settings.dir }, ctx?.signal);
        if (!ok) { log('pi_declined', { mode: m }); throw new Error(`${userName} didn't say send, so nothing went to pi. Don't ask again unless they bring it up.`); }
        start({ prompt: text, mode: m, project: settings.project, followUp: cont, settings, by });
        return `Sent to pi (${m === 'edit' ? 'editing allowed' : 'read only'}, in ${tilde(settings.project, home)}). It's working in the background. The app shows ${userName} each step and shows and reads out pi's reply itself, so say only that it's been sent (a few words) and stop.`;
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
        fs.writeFileSync(settings.file, `${JSON.stringify({ ...settings.raw, project: tilde(hit.dir, home) }, null, 2)}\n`);
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
    if (job) lines.push(`- pi is WORKING now (${job.mode === 'edit' ? 'editing allowed' : 'read only'}) on: "${clip(job.prompt, 300)}". Until it replies you can only talk, keep the to-do list, or stop_pi.`);
    else if (last && last.project === s.project) {
      const said = last.reply ? ` pi's reply, which ${userName} has already been shown in full and heard: <<<${clip(last.reply, LIVE_MAX)}>>>` : '';
      lines.push(`- Last pi task (${last.status}${last.problem ? `: ${clip(last.problem, 200)}` : ''}; ${last.mode === 'edit' ? 'editing allowed' : 'read only'}): "${clip(last.prompt, 300)}".${said}${/\?\s*$/.test(last.reply) ? ` It ended with a question: ${userName}'s answer goes to pi with ask_pi and follow_up true.` : ''}`);
    }
    return lines.join('\n');
  }

  return {
    tools, live, stop,
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
export function gateTools(tools, pi) {
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
  return [...narrowed, ...pi.tools].map((t) => (DURING.has(t.name) ? t : {
    ...t,
    execute: async (...a) => {
      if (pi.busy() && t.name !== 'ask_pi' && t.name !== 'switch_project') throw new Error('pi is working on a task, and until it replies I only talk, keep the to-do list, or stop pi (stop_pi). Say so in a few words.');
      return t.execute(...a);
    },
  }));
}
