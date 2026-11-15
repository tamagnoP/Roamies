// Local-only build: the to-do list is mirrored in Super Productivity, through that app's local REST API.
//
// Every to-do of kind "commitment" has a task in the app; reminders have none. For a linked pair, seven fields are
// kept the same on both sides: title, done, start time, length, urgent, important, and the due time (the app's
// deadline). The link is the task's id, kept in ~/Documents/roamies-pi/state.json; a title never identifies anything.
//
// What is fixed here, in code:
//   - Requests go to 127.0.0.1 on the app's port and nowhere else, and only the ones in ROUTES: there is no DELETE.
//   - The access token is read from the app's own file for each request and kept nowhere. It is never in an error,
//     a log, a record, a bubble or what the model is given.
//   - Only tasks Roamies made are ever written to. From the others, four things are kept, in memory, to see clashes:
//     title, start, length, done. The rest of the app's answer is dropped as it is parsed.
//   - Only the two matrix tags are ever added to or taken from a task; its other tags are sent back as they were.
//
// A sync run: is the app there (1 second at most); read the task list once; for each link compare, field by field,
// Roamies' value, the app's, and the value both had after the last run. What only one side changed goes to the other;
// what both changed is the app's. What was written or read becomes the agreed value, so the next run finds nothing
// to do and writes nothing back.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { SP, isSend, limitsFor, loadSettings, readState, writeState } from './pi.mjs';

const ROUTES = [['GET', /^\/health$/], ['GET', /^\/tasks(\?[\w=&]*)?$/], ['GET', /^\/tasks\/[^/?#]+$/], ['POST', /^\/tasks$/], ['PATCH', /^\/tasks\/[^/?#]+$/]];
const TOKEN = /^[A-Za-z0-9]{32}$/;
export const FIELDS = ['title', 'done', 'start', 'minutes', 'urgent', 'important', 'due'];
const WORDS = { title: 'the title', done: 'whether it\'s done', start: 'the start time', minutes: 'the length', urgent: 'urgent', important: 'important', due: 'the due time' };
const HOW = 'Open Super Productivity, and check that Settings > Misc > Enable local REST API is on.';

/** The app can't be reached, or won't let Roamies in. `message` is plain words for the owner. */
export class Down extends Error {}

const title = (t) => String(t ?? '').trim().slice(0, 200).trim();
const stamp = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const minutes = (ms) => (typeof ms === 'number' && ms > 0 ? Math.round(ms / 60_000) : 0);
const quote = (t) => `"${t}"`;

/** Whether a line from a sync nobody asked for can be shown now: the overlay is up and the setup guide out of the
 *  way, no reply is being made or spoken, nobody is talking, and no bubble (Send, a plan, any question) is waiting. */
export const quiet = ({ ready, busy, queued, asking, voice, speakingUntil = 0, now = Date.now() }) => !!ready && !busy && !queued && !asking && voice === 'idle' && now >= speakingUntil;

/** The requests, and nothing else, to the app on this Mac. */
export function createClient({ home = os.homedir(), port = SP.port, tokenFile = path.join(home, SP.tokenFile) } = {}) {
  const agent = new http.Agent({ keepAlive: false }); // an agent of its own: no proxy, whatever the environment says
  function token() {
    let t = '';
    try { t = fs.readFileSync(tokenFile, 'utf8').trim(); } catch { /* handled below */ }
    if (!TOKEN.test(t)) throw new Down(`I can't read Super Productivity's access token. ${HOW}`);
    return t;
  }
  /** → { status, body }. Throws Down when the app isn't there, is too slow, or refuses the token. */
  function request(method, target, body, ms) {
    if (!ROUTES.some(([m, p]) => m === method && p.test(target))) throw new Error(`Roamies doesn't send ${method} ${target.split('?')[0]} to Super Productivity.`);
    const auth = target === '/health' ? null : token();
    const payload = body === undefined ? null : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const fail = () => reject(new Down(`Super Productivity isn't answering. ${HOW}`));
      const req = http.request({ host: SP.host, port, method, path: target, agent, headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) } }, (res) => {
        const parts = [];
        res.on('data', (d) => parts.push(d));
        res.on('error', () => { clearTimeout(timer); fail(); });
        res.on('end', () => {
          clearTimeout(timer);
          let parsed = null;
          try { parsed = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { /* not JSON: not the app */ }
          if (res.statusCode === 401) return reject(new Down(`Super Productivity didn't accept its access token. ${HOW}`));
          if (res.statusCode === 503 || !parsed || typeof parsed !== 'object') return fail();
          resolve({ status: res.statusCode, body: parsed });
        });
      });
      const timer = setTimeout(() => req.destroy(new Error('slow')), ms);
      req.on('error', () => { clearTimeout(timer); fail(); });
      req.end(payload ?? undefined);
    });
  }
  return { request };
}

/**
 * todos: Roamies' own list, as sidekick.mjs hands it over:
 *   all() → [{ id, text, due, status: 'open' | 'done', kind }]  (open ones, and those finished today)
 *   update(id, { status, dueMs }), rename(id, text)
 * ask: the question bubble. now: the clock. port, tokenFile: only tests set these.
 */
export function createCalendar({ home = os.homedir(), todos, ask = async () => null, log = () => {}, now = () => Date.now(), port, tokenFile } = {}) {
  const client = createClient({ home, port, tokenFile });
  const settings = () => loadSettings(home);
  const wait = () => limitsFor(home).calendarTimeoutSeconds * 1000;

  // ---- what is kept in state.json, under "calendar"
  // started: the owner said yes to putting the list in the app. links: { to-do id: { task, title, was, local, agreed } }
  // (local: start, minutes, urgent, important, which Roamies' own list has no place for; agreed: the seven fields as
  // both sides had them after the last run; was: the to-do's state when last seen). retired: links whose to-do is
  // done on both sides. intents: creates that were begun. held: lines and questions waiting to be shown. waiting:
  // to-dos whose task was deleted in the app, until the owner has said whether the to-do goes too.
  const blank = () => ({ started: false, links: {}, retired: {}, waiting: {}, intents: [], held: [] });
  function get() {
    const c = readState(settings().dir).calendar;
    return c && typeof c === 'object' && !Array.isArray(c) ? { ...blank(), ...c } : blank();
  }
  function put(cal) { const dir = settings().dir; writeState(dir, { ...readState(dir), calendar: cal }); }
  const edit = (fn) => { const cal = get(); const out = fn(cal); put(cal); return out; };

  // One thing at a time: a run, or a change to what is kept, never two at once.
  let chain = Promise.resolve();
  const inTurn = (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };

  // ---- the app's answer, cut down as it is parsed
  let others = []; // tasks Roamies didn't make: title, start, minutes, done. In memory only.
  const dueOf = (t, dayEnd) => {
    if (stamp(t.deadlineWithTime)) return t.deadlineWithTime;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof t.deadlineDay === 'string' ? t.deadlineDay : '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3], 0, dayEnd).getTime() : null; // a day with no time: the end of the working day
  };
  const own = (t, dayEnd) => {
    const tags = Array.isArray(t.tagIds) ? t.tagIds.filter((x) => typeof x === 'string') : [];
    return { id: String(t.id), title: title(t.title), done: !!t.isDone, start: stamp(t.dueWithTime), minutes: minutes(t.timeEstimate), urgent: tags.includes(SP.urgentTag), important: tags.includes(SP.importantTag), due: dueOf(t, dayEnd) };
  };
  const other = (t) => ({ title: title(t.title), start: stamp(t.dueWithTime), minutes: minutes(t.timeEstimate), done: !!t.isDone });
  const seven = (o) => Object.fromEntries(FIELDS.map((f) => [f, o[f]]));

  async function call(method, target, body) {
    const r = await client.request(method, target, body, wait());
    if (r.body.ok !== true && r.status !== 404) throw new Down(`Super Productivity refused a change (${String(r.body?.error?.code ?? r.status)}).`);
    return r;
  }
  /** The task list, cut down: the linked ones by id, the rest as clash facts. */
  async function readTasks(mine, dayEnd, source = '') {
    const r = await call('GET', `/tasks?includeDone=true${source ? `&source=${source}` : ''}`);
    const list = Array.isArray(r.body.data) ? r.body.data : [];
    const linked = new Map(), rest = [];
    for (const t of list) { if (t && mine.has(String(t.id))) linked.set(String(t.id), own(t, dayEnd)); else if (t) rest.push(other(t)); }
    return { linked, rest };
  }

  // ---- lines for the owner
  const hold = (items) => { if (items.length) edit((cal) => { cal.held.push(...items); }); };

  /** Is the app there? One second at most, and no token. */
  async function there() {
    try { const r = await client.request('GET', '/health', undefined, SP.healthSeconds * 1000); return r.status === 200 && r.body?.data?.rendererReady !== false; } catch { return false; }
  }

  // ---- writing a link's changes to the app
  async function writeTask(link, changes, local) {
    const id = encodeURIComponent(link.task);
    // The title goes alone, marked to be taken as written: any other way the app reads it for its short syntax.
    if ('title' in changes) { const r = await call('PATCH', `/tasks/${id}`, { title: changes.title, isIgnoreShortSyntax: true }); if (r.status === 404) return false; }
    const body = {};
    if ('done' in changes) body.isDone = changes.done;
    if ('start' in changes) body.dueWithTime = changes.start;
    if ('minutes' in changes) body.timeEstimate = changes.minutes * 60_000;
    if ('due' in changes) Object.assign(body, changes.due === null ? { deadlineDay: null, deadlineWithTime: null } : { deadlineWithTime: changes.due });
    if (Object.keys(body).length) { const r = await call('PATCH', `/tasks/${id}`, body); if (r.status === 404) return false; }
    if ('urgent' in changes || 'important' in changes) {
      // The task's tags as they are this moment: the two matrix tags are set, every other tag goes back untouched.
      const r = await call('GET', `/tasks/${id}`);
      if (r.status === 404) return false;
      const tags = (Array.isArray(r.body.data?.tagIds) ? r.body.data.tagIds : []).filter((x) => typeof x === 'string');
      const next = tags.filter((x) => x !== SP.urgentTag && x !== SP.importantTag);
      if (local.urgent) next.push(SP.urgentTag);
      if (local.important) next.push(SP.importantTag);
      const w = await call('PATCH', `/tasks/${id}`, { tagIds: next });
      if (w.status === 404) return false;
    }
    return true;
  }

  // ---- one run
  async function run() {
    const lines = [], asks = [];
    if (!(await there())) return { ok: false, lines, asks, why: `Super Productivity isn't answering. ${HOW}` };
    let cal = get();
    if (!cal.started) return { ok: true, started: false, lines, asks };
    const s = settings(), dayEnd = s.calendar.dayEnd;
    const list = await todos.all();
    const byId = new Map(list.map((t) => [t.id, t]));
    const save = () => put({ ...cal, held: get().held }); // what is waiting to be shown may have been taken meanwhile
    let archived = null;
    try {
      const mine = new Set([...Object.values(cal.links).map((l) => l.task), ...Object.values(cal.retired)]);
      const { linked, rest } = await readTasks(mine, dayEnd);
      others = rest;

      // A to-do finished on both sides, then opened again in Roamies: its task is taken up again if it's still there.
      for (const [id, task] of Object.entries(cal.retired)) {
        const t = byId.get(id);
        if (!t) { delete cal.retired[id]; continue; }
        if (t.status !== 'open') continue;
        delete cal.retired[id];
        const r = linked.get(task);
        if (r) cal.links[id] = { task, title: t.text, was: 'open', local: { start: r.start, minutes: r.minutes, urgent: r.urgent, important: r.important }, agreed: { ...seven(r), done: true } };
      }
      save();

      for (const [id, link] of Object.entries(cal.links)) {
        const t = byId.get(id);
        if (t) { link.was = t.status; link.title = t.text; }
        let remote = linked.get(link.task), gone = false;
        if (!remote) {
          // Not on the list: archived by the app (which counts as done), or deleted there.
          archived ??= (await readTasks(new Set(Object.values(cal.links).map((l) => l.task)), dayEnd, 'archived')).linked;
          if (archived.has(link.task)) { remote = { ...link.agreed, done: true }; gone = true; } else {
            delete cal.links[id]; save();
            log('calendar_unlinked', { why: 'deleted in the app' });
            if (t?.status === 'open') { cal.waiting[id] = true; save(); asks.push({ todo: id, title: t.text }); }
            continue;
          }
        }
        // Taken off Roamies' list (dropped): the task keeps its place in the app, without a time.
        if (!t && link.was !== 'done') {
          if (!gone && remote.start !== null) await writeTask(link, { start: null }, link.local);
          delete cal.links[id]; save();
          log('calendar_unlinked', { why: 'removed here' });
          lines.push(`${quote(link.title)} is off my list. Its task is still in Super Productivity, without a time: delete it there if you don't want it.`);
          continue;
        }
        const local = { title: t ? title(t.text) : link.agreed.title, done: t ? t.status === 'done' : true, start: link.local.start, minutes: link.local.minutes, urgent: link.local.urgent, important: link.local.important, due: t ? (t.due ?? null) : link.agreed.due };
        const toApp = {}, toHere = {}, both = [];
        for (const f of FIELDS) {
          const l = local[f], r = remote[f], a = link.agreed[f];
          if (l === r) { link.agreed[f] = l; continue; }
          if (r !== a) { toHere[f] = r; if (l !== a) both.push(f); } else toApp[f] = l;
        }
        // The app's changes come here first.
        if (Object.keys(toHere).length) {
          if (t) {
            if ('title' in toHere) await todos.rename(id, toHere.title);
            if ('done' in toHere) await todos.update(id, { status: toHere.done ? 'done' : 'open' });
            if ('due' in toHere) await todos.update(id, { dueMs: toHere.due });
          }
          for (const f of ['start', 'minutes', 'urgent', 'important']) if (f in toHere) link.local[f] = toHere[f];
          for (const f of Object.keys(toHere)) { link.agreed[f] = toHere[f]; local[f] = toHere[f]; }
          if ('title' in toHere) link.title = toHere.title;
          if ('done' in toHere) link.was = toHere.done ? 'done' : 'open';
          save();
          log('calendar_from_app', { fields: Object.keys(toHere) });
        }
        if (both.length) lines.push(`${quote(link.title)}: ${both.map((f) => WORDS[f]).join(' and ')} changed both here and in Super Productivity. I kept what the app has.`);
        // Then Roamies' changes go there. An archived task takes none.
        if (Object.keys(toApp).length && !gone) {
          if (await writeTask(link, toApp, local)) { for (const f of Object.keys(toApp)) link.agreed[f] = toApp[f]; save(); log('calendar_to_app', { fields: Object.keys(toApp) }); }
        }
        // Done on both sides: the link is retired and no longer synced.
        if (local.done && (gone || link.agreed.done)) { cal.retired[id] = link.task; delete cal.links[id]; save(); }
      }

      for (const id of Object.keys(cal.waiting)) if (byId.get(id)?.status !== 'open') delete cal.waiting[id];
      // Every open to-do of kind "commitment" has a task. The intent is written down before the create and cleared
      // when the link is saved, so a create that was cut short is known about at the next start.
      for (const t of list) {
        if (t.status !== 'open' || t.kind !== 'commitment' || cal.links[t.id] || cal.retired[t.id] || cal.waiting[t.id]) continue;
        cal.intents = [...cal.intents.filter((i) => i.todo !== t.id), { todo: t.id, title: t.text, at: now() }]; save();
        const r = await call('POST', '/tasks', { title: title(t.text), isIgnoreShortSyntax: true, ...(t.due ? { deadlineWithTime: t.due } : {}) });
        const made = r.body.data && typeof r.body.data.id === 'string' ? own(r.body.data, dayEnd) : null;
        if (!made) throw new Down('Super Productivity didn\'t say which task it made.');
        cal.links[t.id] = { task: made.id, title: t.text, was: 'open', local: { start: made.start, minutes: made.minutes, urgent: made.urgent, important: made.important }, agreed: { ...seven(made), title: title(t.text), due: t.due ?? null } };
        cal.intents = cal.intents.filter((i) => i.todo !== t.id);
        save();
        log('calendar_mirrored', {});
      }
    } catch (e) {
      save();
      if (!(e instanceof Down)) throw e;
      return { ok: false, lines, asks, why: e.message };
    }
    return { ok: true, started: true, lines, asks };
  }

  /** Runs a sync. From a tool, what it has to say comes back as text for the model; otherwise it is held for a bubble. */
  function sync(from = 'timer') {
    return inTurn(async () => {
      let r;
      try { r = await run(); } catch (e) { log('calendar_error', { message: String(e?.message ?? e).slice(0, 200) }); return { ok: false, text: '', why: 'The sync with Super Productivity ran into a problem.' }; }
      // A task deleted in the app: the question is the app's own bubble, whoever started the run.
      hold(r.asks.map((a) => ({ ask: a })));
      if (from !== 'tool') { hold(r.lines.map((text) => ({ text }))); return { ...r, text: '' }; }
      const text = [...r.lines, ...r.asks.map((a) => `The task for ${quote(a.title)} was deleted in Super Productivity. The app asks them in a bubble whether the to-do goes too: leave that to the bubble.`)].join('\n');
      return { ...r, text };
    });
  }

  /** A to-do changed in Roamies (ticked, dropped, added): its state is noted, then a sync follows. */
  function changed(c) {
    inTurn(() => { if (c?.id) edit((cal) => { const l = cal.links[c.id]; if (l && ['open', 'done', 'dropped'].includes(c.status)) l.was = c.status; }); }).catch(() => {});
    return sync('change');
  }

  /** What Roamies' own list has no place for (start, minutes, urgent, important), set on a linked to-do. */
  const setLocal = (id, changes) => inTurn(() => edit((cal) => { const l = cal.links[id]; if (!l) return false; for (const f of ['start', 'minutes', 'urgent', 'important']) if (f in changes) l.local[f] = changes[f]; return true; }));

  /** The owner has answered the question about a to-do whose task was deleted in the app. If the to-do stays, it
   *  gets a new task at the next run. */
  const answered = (id) => inTurn(() => edit((cal) => { delete cal.waiting[id]; }));

  /** At start-up: a create that was begun and never finished is said once. */
  function startup() {
    return inTurn(() => edit((cal) => {
      for (const i of cal.intents) cal.held.push({ text: `I was adding ${quote(i.title)} to Super Productivity when I last stopped. A stray task with that title may be in the app: delete it there if so.` });
      cal.intents = [];
    }));
  }

  /** What is waiting to be shown, taken off the pile: { lines: [text], asks: [{ todo, title }] }. */
  function takeHeld() {
    return edit((cal) => { const h = cal.held; cal.held = []; return { lines: h.filter((x) => x.text).map((x) => x.text), asks: h.filter((x) => x.ask).map((x) => x.ask) }; });
  }
  const hasHeld = () => get().held.length > 0;

  /** The first time: the to-dos that would be put in the app, or null when that's settled or the app isn't there. */
  async function firstRun() {
    if (get().started || !(await there())) return null;
    const open = (await todos.all()).filter((t) => t.status === 'open' && t.kind === 'commitment');
    if (!open.length) { await inTurn(() => edit((cal) => { cal.started = true; })); return null; }
    return open.map((t) => t.text);
  }
  /** Shows the count and the titles, and waits for a yes. Nothing is created before it. → true when it's on. */
  async function offerStart(signal) {
    const titles = await firstRun();
    if (get().started) return true;
    if (!titles) return false;
    const a = await ask({ placeholder: `Put my to-do list in Super Productivity? ${titles.length} to-do${titles.length === 1 ? '' : 's'}, each as a task there:\n${titles.map((t) => `- ${t}`).join('\n')}`, choices: ['Add them', 'Not now'] }, signal);
    if (!isSend(a)) return false;
    await inTurn(() => edit((cal) => { cal.started = true; }));
    log('calendar_started', { todos: titles.length });
    await sync('start');
    return true;
  }

  /** Upstream's to-do tools, with a sync before each: what the app changed is in before the list is read or changed. */
  const TODO_TOOLS = new Set(['remember_commitment', 'update_commitment', 'list_commitments', 'show_list']);
  const wrap = (tools) => tools.map((t) => (TODO_TOOLS.has(t.name) ? { ...t, execute: async (...a) => { const pre = await sync('tool'); const out = await t.execute(...a); return pre.text ? `${out}\n\n${pre.text}` : out; } } : t));

  const tools = [
    {
      name: 'sync_todos',
      description: 'Sync the to-do list with Super Productivity now (it also happens by itself, about once a minute). Use it when they ask to sync, or to put their to-do list in Super Productivity for the first time; that first time the app shows them the list and waits for their yes.',
      parameters: z.object({}),
      execute: async (_args, ctx) => {
        if (!(await there())) throw new Error(`Super Productivity isn't answering. ${HOW} The to-do list still works here and is synced when the app is back.`);
        if (!get().started && !(await offerStart(ctx?.signal))) return 'They didn\'t say yes, so nothing was added to Super Productivity.';
        const r = await sync('tool');
        if (!r.ok) throw new Error(r.why);
        return ['The to-do list and Super Productivity are in step.', r.text].filter(Boolean).join('\n');
      },
    },
  ];

  /** One line for the model's live state. */
  function live() {
    let cal;
    try { cal = get(); } catch { return '- Super Productivity: the settings file can\'t be read, so the to-do list isn\'t synced.'; }
    const n = Object.keys(cal.links).length;
    return cal.started ? `- Super Productivity: ${n} to-do${n === 1 ? '' : 's'} mirrored there as tasks (kept in step by the app, both ways).` : '- Super Productivity: the to-do list isn\'t mirrored there yet (sync_todos offers it).';
  }

  return { tools, wrap, sync, changed, setLocal, answered, startup, takeHeld, hasHeld, offerStart, firstRun, live, there, others: () => others, state: get };
}
