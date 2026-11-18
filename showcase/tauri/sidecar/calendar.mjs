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
//   - Every block has a to-do behind it, and a to-do has one block at most. A block is never placed without the task
//     list having just been read, so a clash is always seen; a day plan is created only after a yes.
//   - A block asked for while the app can't be reached is kept (state.json, calendar.actions) and placed by the
//     first sync that reaches the app: once, after the task list has been read, with the usual question on a clash.
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
import { byButton } from './answers.mjs';
import { SP, limitsFor, loadSettings, readState, writeState } from './pi.mjs';

const ROUTES = [['GET', /^\/health$/], ['GET', /^\/tasks(\?[\w=&]*)?$/], ['GET', /^\/tasks\/[^/?#]+$/], ['POST', /^\/tasks$/], ['PATCH', /^\/tasks\/[^/?#]+$/]];
const TOKEN = /^[A-Za-z0-9]{32}$/;
export const FIELDS = ['title', 'done', 'start', 'minutes', 'urgent', 'important', 'due'];
const WORDS = { title: 'the title', done: 'whether it\'s done', start: 'the start time', minutes: 'the length', urgent: 'urgent', important: 'important', due: 'the due time' };
const HOW = 'Open Super Productivity, and check that Settings > Misc > Enable local REST API is on.';

/** The app can't be reached, or won't let Roamies in. `message` is plain words for the owner. */
export class Down extends Error {}
/** A tool couldn't see the calendar because the app isn't answering. A block asked for then is kept for later. */
export class Away extends Error {}

const title = (t) => String(t ?? '').trim().slice(0, 200).trim();
const stamp = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const minutes = (ms) => (typeof ms === 'number' && ms > 0 ? Math.round(ms / 60_000) : 0);
const quote = (t) => `"${t}"`;
/** Text from the app or from an error, made safe to show: short, and with nothing in it that could be the token. */
const scrub = (t) => String(t ?? '').replace(/[A-Za-z0-9]{32,}/g, '[…]').replace(/\s+/g, ' ').trim().slice(0, 200);
const pad = (n) => String(n).padStart(2, '0');
const hm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const span = (b) => `${hm(b.start)} to ${hm(b.start + b.minutes * 60_000)}`;
const dayOf = (text) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text ?? '').trim()); const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; return d && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d : null; };
const clockOf = (text) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? '').trim()); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; };
/** A day as it was said, turned into a date by code, not by the model: "today", "tomorrow", a weekday, or
 *  YYYY-MM-DD. A weekday is the next day of that name counting today; today itself only while `passed(day)` is false
 *  (a block whose time today is over means the same day next week). → a Date at 00:00, or null. */
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export function dayFrom(text, nowMs, passed = () => false) {
  const exact = dayOf(text);
  if (exact) return exact;
  const word = String(text ?? '').trim().toLowerCase().replace(/^(on|this)\s+/, '').replace(/[.,]$/, '');
  const n = new Date(nowMs), today = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  const plus = (d) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + d);
  if (word === 'today') return today;
  if (word === 'tomorrow') return plus(1);
  const w = WEEKDAYS.findIndex((name) => name === word || (word.length === 3 && name.startsWith(word)));
  if (w < 0) return null;
  const ahead = (w - today.getDay() + 7) % 7;
  return ahead === 0 && passed(today) ? plus(7) : plus(ahead);
}
/** The length of a block, in minutes, from its two times: worked out here, not by the model. */
export function minutesBetween(start, end) {
  const a = clockOf(start), b = clockOf(end);
  if (a === null) throw new Error('The start has to be a time, HH:MM.');
  if (b === null) throw new Error('The end has to be a time, HH:MM.');
  if (b <= a) throw new Error(`The end (${String(end).trim()}) isn't after the start (${String(start).trim()}). Times are on the 24-hour clock: one in the afternoon is 13:00.`);
  if (b - a < 5 || b - a > 720) throw new Error('A block is between 5 minutes and 12 hours long.');
  return b - a;
}
const DATE_HOW = 'The date has to be a weekday ("friday"), "today", "tomorrow", or YYYY-MM-DD.';
const dayName = (d) => d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
/** Two stretches of time overlap. One with no length is a moment, and clashes when it falls inside the other. */
const overlap = (a, b) => a.start < b.start + Math.max(b.minutes, 1) * 60_000 && b.start < a.start + Math.max(a.minutes, 1) * 60_000;

/** Where a day plan puts each item: in the order given, each at the first free stretch of its length between `from`
 *  and `until` (ms), clear of `busy` ([{ start, minutes }]) and of each other, `gap` minutes apart. → { placed:
 *  [{ ...item, start }], left: [item] } (left: what doesn't fit). */
export function placeDay(items, { from, until, busy = [], gap = 0 }) {
  const taken = busy.map((b) => ({ start: b.start - (b.gap === false ? 0 : gap * 60_000), end: b.start + Math.max(b.minutes, 1) * 60_000 + (b.gap === false ? 0 : gap * 60_000) }));
  const placed = [], left = [];
  for (const item of items) {
    let at = from, found = false;
    for (;;) {
      const end = at + item.minutes * 60_000;
      if (end > until) break;
      const hit = taken.filter((t) => at < t.end && t.start < end).sort((a, b) => b.end - a.end)[0];
      if (!hit) { found = true; break; }
      at = hit.end;
    }
    if (!found) { left.push(item); continue; }
    placed.push({ ...item, start: at });
    taken.push({ start: at - gap * 60_000, end: at + item.minutes * 60_000 + gap * 60_000 });
  }
  return { placed, left };
}

/** Whether a line from a sync nobody asked for can be shown now: the overlay is up and the setup guide out of the
 *  way, no reply is being made or spoken, nobody is talking, and no bubble (Send, a plan, any question) is waiting. */
export const quiet = ({ ready, busy, queued, asking, voice, speakingUntil = 0, now = Date.now() }) => !!ready && !busy && !queued && !asking && voice === 'idle' && now >= speakingUntil;

/** The requests, and nothing else, to the app on this Mac. */
export function createClient({ home = os.homedir(), port = SP.port, tokenFile = path.join(home, SP.tokenFile) } = {}) {
  const agent = new http.Agent({ keepAlive: false }); // an agent of its own: no proxy, whatever the environment says
  function token() {
    let t = '';
    try { t = fs.readFileSync(tokenFile, 'utf8').trim(); } catch { throw new Down(`Super Productivity's access token file isn't there, or can't be read. The app writes it when its local REST API is switched on. ${HOW}`); }
    // Said without the token: only how long it is.
    if (!TOKEN.test(t)) throw new Down(`Super Productivity's access token isn't in the form I know (it is ${t.length} characters; I expect 32 letters and digits), so I didn't send it.`);
    return t;
  }
  /** → { status, body }. Throws Down when the app isn't there, is too slow, or refuses the token. */
  function request(method, target, body, ms, doing) {
    if (!ROUTES.some(([m, p]) => m === method && p.test(target))) throw new Error(`Roamies doesn't send ${method} ${target.split('?')[0]} to Super Productivity.`);
    const auth = target === '/health' ? null : token();
    const payload = body === undefined ? null : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      // What went wrong, in plain words: each way of not getting an answer is said as what it is.
      const fail = (why) => reject(new Down(`${why} ${HOW}`));
      const what = doing ? `when asked to ${doing}` : `(${method} ${target.split('?')[0].replace(/^\/tasks\/.+/, '/tasks/…')})`;
      const req = http.request({ host: SP.host, port, method, path: target, agent, headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) } }, (res) => {
        const parts = [];
        res.on('data', (d) => parts.push(d));
        res.on('error', () => { clearTimeout(timer); fail(`Super Productivity broke off its answer ${what}.`); });
        res.on('end', () => {
          clearTimeout(timer);
          let parsed = null;
          try { parsed = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { /* not JSON: not the app */ }
          if (res.statusCode === 401) return reject(new Down('Super Productivity didn\'t accept its access token (401). Switching its local REST API off and on again in Settings > Misc makes a new one.'));
          if (res.statusCode === 503) return fail('Super Productivity answered that it isn\'t ready yet (503): it is probably still starting.');
          if (!parsed || typeof parsed !== 'object') return fail(`Something answered on port ${port} ${what}, but not the way Super Productivity's REST API does (HTTP ${res.statusCode}).`);
          resolve({ status: res.statusCode, body: parsed });
        });
      });
      let slow = false;
      const timer = setTimeout(() => { slow = true; req.destroy(new Error('slow')); }, ms);
      req.on('error', (e) => { clearTimeout(timer); fail(slow ? `Super Productivity didn't answer within ${ms / 1000} second${ms === 1000 ? '' : 's'} ${what}.` : e?.code === 'ECONNREFUSED' ? `Nothing is listening on port ${port}: Super Productivity is closed, or its local REST API is off.` : `The connection to Super Productivity failed ${what} (${scrub(e?.code ?? e?.message)}).`); });
      req.end(payload ?? undefined);
    });
  }
  return { request };
}

/**
 * todos: Roamies' own list, as sidekick.mjs hands it over:
 *   all() → [{ id, text, due, status: 'open' | 'done', kind }]  (open ones, and those finished today)
 *   update(id, { status, dueMs }), rename(id, text), add(text) → { id }  (a new to-do of kind commitment)
 * ask: the question bubble. now: the clock. port, tokenFile: only tests set these.
 */
export function createCalendar({ home = os.homedir(), todos, ask = async () => null, log = () => {}, now = () => Date.now(), port, tokenFile } = {}) {
  const client = createClient({ home, port, tokenFile });
  const yesTo = byButton(ask); // its bubbles are answered by which button it was (a spoken answer arrives the same way)
  // Feature 22: what is kept of a question when its answer window runs out with no answer (answers.mjs, flow.mjs):
  // its kind, a short wording, and what is needed to ask it again. kept: the pending question this already is.
  const keep = (kept, kind, brief, data) => ({ ...(kept ? { id: kept.id, at: kept.at } : {}), kind, brief, data });
  const settings = () => loadSettings(home);
  const wait = () => limitsFor(home).calendarTimeoutSeconds * 1000;

  // ---- what is kept in state.json, under "calendar"
  // started: the owner said yes to putting the list in the app. links: { to-do id: { task, title, was, local, agreed } }
  // (local: start, minutes, urgent, important, which Roamies' own list has no place for; agreed: the seven fields as
  // both sides had them after the last run; was: the to-do's state when last seen). retired: links whose to-do is
  // done on both sides. intents: creates that were begun. held: lines and questions waiting to be shown. waiting:
  // to-dos whose task was deleted in the app, until the owner has said whether the to-do goes too. actions: blocks
  // asked for while the app couldn't be reached, [{ id, at, todo, title, start, minutes }], one for a to-do at most.
  const blank = () => ({ started: false, links: {}, retired: {}, waiting: {}, intents: [], held: [], actions: [] });
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

  /** One request. `doing` is what it is for, in plain words: a refusal is said as that, with the app's own reason. */
  async function call(method, target, body, doing) {
    const r = await client.request(method, target, body, wait(), doing);
    if (r.body.ok !== true && r.status !== 404) throw new Down(`Super Productivity refused to ${doing}: ${scrub(r.body?.error?.message) || 'it gave no reason'} (${scrub(r.body?.error?.code) || 'no code'}, HTTP ${r.status}).`);
    return r;
  }
  /** The task list, cut down: the linked ones by id, the rest as clash facts. */
  async function readTasks(mine, dayEnd, source = '') {
    const r = await call('GET', `/tasks?includeDone=true${source ? `&source=${source}` : ''}`, undefined, source ? 'give me its archived tasks' : 'give me its task list');
    if (!Array.isArray(r.body.data)) throw new Down(`Super Productivity's answer to "${source ? 'archived tasks' : 'task list'}" wasn't a list (HTTP ${r.status}).`);
    const list = Array.isArray(r.body.data) ? r.body.data : [];
    const linked = new Map(), rest = [];
    for (const t of list) { if (t && mine.has(String(t.id))) linked.set(String(t.id), own(t, dayEnd)); else if (t) rest.push(other(t)); }
    return { linked, rest };
  }

  // ---- lines for the owner
  const hold = (items) => { if (items.length) edit((cal) => { cal.held.push(...items); }); };

  /** Is the app there? One second at most, and no token. */
  async function reach() {
    try {
      const r = await client.request('GET', '/health', undefined, SP.healthSeconds * 1000, 'say that it is running');
      if (r.status !== 200) return { ok: false, why: `Super Productivity answered "are you there" with HTTP ${r.status}. ${HOW}` };
      if (r.body?.data?.rendererReady === false) return { ok: false, why: 'Super Productivity is open but says it isn\'t ready yet: it is probably still starting.' };
      return { ok: true, why: '' };
    } catch (e) { if (e instanceof Down) return { ok: false, why: e.message }; throw e; }
  }
  const there = async () => (await reach()).ok;

  // ---- writing a link's changes to the app
  async function writeTask(link, changes, local) {
    const id = encodeURIComponent(link.task);
    // The title goes alone, marked to be taken as written: any other way the app reads it for its short syntax.
    const name = quote(link.title);
    if ('title' in changes) { const r = await call('PATCH', `/tasks/${id}`, { title: changes.title, isIgnoreShortSyntax: true }, `change the title of ${name}`); if (r.status === 404) return false; }
    const body = {};
    if ('done' in changes) body.isDone = changes.done;
    if ('start' in changes) body.dueWithTime = changes.start;
    if ('minutes' in changes) body.timeEstimate = changes.minutes * 60_000;
    if ('due' in changes) Object.assign(body, changes.due === null ? { deadlineDay: null, deadlineWithTime: null } : { deadlineWithTime: changes.due });
    if (Object.keys(body).length) { const r = await call('PATCH', `/tasks/${id}`, body, `change ${['done', 'start', 'minutes', 'due'].filter((f) => f in changes).map((f) => WORDS[f]).join(' and ')} of ${name}`); if (r.status === 404) return false; }
    if ('urgent' in changes || 'important' in changes) {
      // The task's tags as they are this moment: the two matrix tags are set, every other tag goes back untouched.
      const r = await call('GET', `/tasks/${id}`, undefined, `give me the tags of ${name}`);
      if (r.status === 404) return false;
      const tags = (Array.isArray(r.body.data?.tagIds) ? r.body.data.tagIds : []).filter((x) => typeof x === 'string');
      const next = tags.filter((x) => x !== SP.urgentTag && x !== SP.importantTag);
      if (local.urgent) next.push(SP.urgentTag);
      if (local.important) next.push(SP.importantTag);
      const w = await call('PATCH', `/tasks/${id}`, { tagIds: next }, `change the urgent and important tags of ${name}`);
      if (w.status === 404) return false;
    }
    return true;
  }

  // ---- one run
  async function run() {
    const lines = [], asks = [];
    const up = await reach();
    if (!up.ok) return { ok: false, reached: false, lines, asks, why: up.why };
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
          if ('urgent' in toHere || 'important' in toHere) link.sorted = true; // given a place in the matrix, in the app
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
        // Urgent and important, and not on the calendar: a block is offered, once for each to-do.
        if (!local.done && link.local.urgent && link.local.important && link.local.start === null && !link.offered && cal.links[id]) {
          link.offered = true; save();
          lines.push(`${quote(link.title)} is urgent and important, and isn't on the calendar. Shall I put a block for it there?`);
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
        const r = await call('POST', '/tasks', { title: title(t.text), isIgnoreShortSyntax: true, ...(t.due ? { deadlineWithTime: t.due } : {}) }, `make a task for ${quote(t.text)}`);
        const made = r.status !== 404 && r.body.data && typeof r.body.data.id === 'string' ? own(r.body.data, dayEnd) : null;
        if (!made) throw new Down(`Super Productivity answered the new task for ${quote(t.text)} without saying which task it made (HTTP ${r.status}), so I can't tell it apart from the others. A task with that title may now be in the app.`);
        cal.links[t.id] = { task: made.id, title: t.text, was: 'open', local: { start: made.start, minutes: made.minutes, urgent: made.urgent, important: made.important }, agreed: { ...seven(made), title: title(t.text), due: t.due ?? null } };
        cal.intents = cal.intents.filter((i) => i.todo !== t.id);
        save();
        log('calendar_mirrored', {});
      }
    } catch (e) {
      save();
      if (!(e instanceof Down)) throw e;
      return { ok: false, reached: true, lines, asks, why: e.message };
    }
    return { ok: true, started: true, lines, asks };
  }

  /** Runs a sync. From a tool, what it has to say comes back as text for the model; otherwise it is held for a bubble. */
  let lastOk = false; // whether the last run reached the app: what is known of its calendar is only good then
  let toldWhy = null; // the failure the owner was last told about, so the timer doesn't say the same thing every minute
  function sync(from = 'timer') {
    return inTurn(async () => {
      let r, lost = [];
      try { lost = expireKept(); } catch (e) { console.error('calendar', e); } // first, and whether the app answers or not: a kept block whose time has passed is dropped and said once
      try {
        r = await run(); lastOk = r.ok && r.started !== false;
        // The blocks kept while the app was away: placed now that its task list has just been read, then sent over.
        if (lastOk && applyKept(r.lines)) { const over = await run(); r.lines.push(...over.lines); r.asks.push(...over.asks); }
      } catch (e) {
        lastOk = false;
        log('calendar_error', { message: scrub(e?.message ?? e) });
        r = { ok: false, reached: true, lines: [], asks: [], why: `The sync stopped on an error in Roamies itself, not in Super Productivity: ${scrub(e?.message ?? e)}` };
      }
      r.lines.unshift(...lost);
      if (r.ok) toldWhy = null; else log('calendar_failed', { from, reached: !!r.reached }); // the reason names a to-do, so it isn't logged
      // A failure nobody asked about is said once, as what it is. The app simply being closed is not one: that is
      // said when something is asked of it. After the first yes it is said either way.
      if (!r.ok && from !== 'tool' && (r.reached || from === 'start') && r.why !== toldWhy) { toldWhy = r.why; r.lines.push(`I couldn't bring my to-do list and Super Productivity in step. ${r.why}`); }
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

  /** A to-do's kept slot, and the question about one that overlapped, taken off. → whether there was one. */
  const unkeep = (cal, id) => { const n = cal.actions.length + cal.held.length; cal.actions = cal.actions.filter((a) => a.todo !== id); cal.held = cal.held.filter((h) => h.block?.todo !== id); return cal.actions.length + cal.held.length < n; };
  /** What Roamies' own list has no place for (start, minutes, urgent, important), set on a linked to-do. */
  const setLocal = (id, changes) => inTurn(() => edit((cal) => {
    const l = cal.links[id];
    if (!l) return false;
    for (const f of ['start', 'minutes', 'urgent', 'important']) if (f in changes) l.local[f] = changes[f];
    if ('start' in changes) unkeep(cal, id); // its block was settled now: a slot kept for it is not placed as well
    return true;
  }));

  /** The owner has answered the question about a to-do whose task was deleted in the app. If the to-do stays, it
   *  gets a new task at the next run. */
  const answered = (id) => inTurn(() => edit((cal) => { delete cal.waiting[id]; }));

  /** The question about a to-do whose task was deleted in the app. → true when the to-do is to go too. */
  const askDeleted = (a, signal, kept = null) => yesTo({ placeholder: `The task for ${quote(a.title)} was deleted in Super Productivity. Take it off my to-do list as well?`, choices: ['Take it off', 'Keep it'], pending: keep(kept, 'deleted', `The task for ${quote(a.title)} was deleted in Super Productivity. Take it off the to-do list as well?`, { todo: a.todo, title: a.title }) }, signal);

  /** At start-up: a create that was begun and never finished is said once. */
  function startup() {
    return inTurn(() => edit((cal) => {
      for (const i of cal.intents) cal.held.push({ text: `I was adding ${quote(i.title)} to Super Productivity when I last stopped. A stray task with that title may be in the app: delete it there if so.` });
      cal.intents = [];
    }));
  }

  /** What is waiting to be shown, taken off the pile: { lines: [text], asks: [{ todo, title }] }. */
  function takeHeld() {
    return edit((cal) => { const h = cal.held; cal.held = []; return { lines: h.filter((x) => x.text).map((x) => x.text), asks: h.filter((x) => x.ask).map((x) => x.ask), blocks: h.filter((x) => x.block).map((x) => x.block) }; });
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
  async function offerStart(signal, kept = null) {
    const titles = await firstRun();
    if (get().started) return true;
    if (!titles) return false;
    const a = await yesTo({ placeholder: `Put my to-do list in Super Productivity? ${titles.length} to-do${titles.length === 1 ? '' : 's'}, each as a task there:\n${titles.map((t) => `- ${t}`).join('\n')}`, choices: ['Add them', 'Not now'], spoken: `Put my to-do list in Super Productivity? ${titles.length} to-do${titles.length === 1 ? '' : 's'}.`, pending: keep(kept, 'start', 'Put the to-do list in Super Productivity?', {}) }, signal);
    if (!a) return false;
    await inTurn(() => edit((cal) => { cal.started = true; }));
    log('calendar_started', { todos: titles.length });
    await sync('start');
    return true;
  }

  // ---- blocks: a to-do's start time and length, on the calendar in the app
  const NOT_YET = 'The to-do list isn\'t in Super Productivity yet, so there is nowhere to put a block. sync_todos shows them the list and asks; nothing is added before their yes.';
  /** Before a block is placed or a day read: the app answers, the list is mirrored, and a sync has just run, so
   *  what is on the calendar is what the app has this moment. Otherwise the tool refuses, in plain words. */
  async function fresh(doing) {
    const up = await reach();
    if (!up.ok) throw new Away(`${up.why} So I can't ${doing}: I couldn't see what is already on the calendar.`);
    if (!get().started) throw new Error(NOT_YET);
    const r = await sync('tool');
    if (!r.ok) throw new Away(`${r.why} So I can't ${doing}: I couldn't see what is already on the calendar.`);
    return r.text;
  }
  /** What is on the calendar on a day: Roamies' own blocks (with their to-do), and the time other tasks take. */
  function dayBlocks(day, cal = get(), list = []) {
    const from = day.getTime(), until = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
    const on = (b) => b.start !== null && b.start < until && b.start + Math.max(b.minutes, 1) * 60_000 > from;
    const mine = Object.entries(cal.links).filter(([, l]) => on(l.local)).map(([id, l]) => ({ todo: id, title: list.find((t) => t.id === id)?.text ?? l.title, start: l.local.start, minutes: l.local.minutes, done: l.was === 'done' }));
    return { mine: mine.sort((a, b) => a.start - b.start), theirs: others.filter((o) => !o.done && on(o)).sort((a, b) => a.start - b.start) };
  }
  /** The open to-do a block is for: of kind commitment. */
  async function openTodo(id) {
    const t = (await todos.all()).find((x) => x.id === id);
    if (!t) throw new Error(`There's no to-do ${id}. list_commitments shows the ids.`);
    if (t.kind !== 'commitment') throw new Error(`${quote(t.text)} is a reminder, and reminders aren't put on the calendar.`);
    if (t.status !== 'open') throw new Error(`${quote(t.text)} is already done.`);
    return t;
  }
  /** ...and mirrored. */
  async function todoFor(id) {
    const t = await openTodo(id);
    const link = get().links[id];
    if (!link) throw new Error(`${quote(t.text)} has no task in Super Productivity right now (its task was deleted there, and they haven't said yet whether the to-do stays).`);
    return { t, link };
  }
  const settle = async (pre, said) => { const r = await sync('tool'); return [said, r.ok ? '' : 'Super Productivity stopped answering before this reached it: it is saved here and goes over at the next sync.', pre, r.text].filter(Boolean).join('\n'); };
  const when = (date, start, mins = 0) => {
    const at = clockOf(start);
    const day = dayFrom(date, now(), (today) => at !== null && today.getTime() + (at + (mins ?? 0)) * 60_000 <= now());
    if (!day) throw new Error(DATE_HOW);
    if (at === null) throw new Error('The start has to be a time, HH:MM.');
    return { day, start: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, at).getTime() };
  };
  /** Puts one block on the calendar. If it would overlap something, the owner is shown what and asked. */
  async function place(id, title_, start, mins, signal, kept = null) {
    const cal = get(), day = new Date(start); day.setHours(0, 0, 0, 0);
    const { mine, theirs } = dayBlocks(day, cal);
    const block = { start, minutes: mins };
    const hits = [...mine.filter((b) => b.todo !== id && !b.done && overlap(block, b)), ...theirs.filter((b) => overlap(block, b))];
    // kept: the question is being asked again. It is asked even if nothing is in the way any more: a block that
    // waited for a yes is never placed without one.
    if (hits.length || kept) {
      const what = hits.map((b) => `${quote(b.title)} (${span(b)})`).join(' and ');
      const pending = keep(kept, 'overlap', `Put ${quote(title_)} on ${dayName(day)}, ${span(block)}, although it overlaps something?`, { todo: id, title: title_, start, minutes: mins, was: cal.links[id]?.local.start ?? null });
      const a = await yesTo({ placeholder: hits.length ? `${quote(title_)}, ${span(block)} on ${dayName(day)}, overlaps ${what}. Put it there anyway?` : `${quote(title_)}, ${span(block)} on ${dayName(day)}: nothing is in the way any more. Put it there?`, choices: ['Put it there', 'Don\'t'], pending }, signal);
      if (!a) throw Object.assign(new Error(`It would overlap ${what}, and they didn't say to put it there anyway. Nothing was changed. Ask what time suits instead.`), { declined: true });
    }
    await setLocal(id, { start, minutes: mins });
  }
  // ---- blocks asked for while the app couldn't be reached (the owner's decision of 2026-11-18; before it they were
  // refused). The request is kept in state.json and placed by the first sync that reaches the app. One for a to-do
  // at most: a newer one takes its place. It is taken off the list in the same write that places it, so it never
  // runs twice. plan_day is not kept: it needs the whole day in view.
  const slot = (a) => `${dayName(new Date(a.start))}, ${span(a)}`;
  const withoutKept = (cal, id) => { cal.actions = cal.actions.filter((x) => x.id !== id); };
  /** Keeps a block for later and says so, in words the model is to pass on as they are. */
  async function keepBlock({ todo, name, start, mins, made = false, moved = false }) {
    if (!(start + mins * 60_000 > now())) throw new Error(`Super Productivity isn't answering, and ${slot({ start, minutes: mins })} has already passed, so there is nothing to keep for later. Nothing was put on the calendar.`);
    await inTurn(() => edit((cal) => { cal.actions = [...cal.actions.filter((x) => x.todo !== todo), { id: `a${now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: new Date(now()).toISOString(), todo, title: name, start, minutes: mins }]; }));
    log('calendar_kept', { what: moved ? 'move' : 'place' });
    return `NOT on the calendar yet: Super Productivity isn't answering (it is closed, or its local REST API is off). What was done: ${made ? `${quote(name)} is saved on the to-do list as ${todo}` : `${quote(name)} is on the to-do list`}, and its slot, ${slot({ start, minutes: mins })}, is kept. The app books that slot by itself as soon as Super Productivity is open, and asks them itself if it overlaps something. Tell them exactly that: the task is saved, and the slot will be booked when Super Productivity is open. Don't say it is added to the calendar, booked, scheduled or moved, and don't call this tool again for it.`;
  }
  /** Before every sync, whether the app answers or not: a kept block whose time has passed, or that is older than
   *  "limits.pendingKeepHours", is dropped, and the owner told once. → the lines. */
  function expireKept() {
    const lines = [];
    let hours;
    try { if (!get().actions.length) return lines; hours = limitsFor(home).pendingKeepHours; } catch { return lines; }
    edit((cal) => {
      for (const a of [...cal.actions]) {
        const passed = !(a.start + a.minutes * 60_000 > now()), old = now() - Date.parse(a.at) > hours * 3600_000;
        if (!passed && !old) continue;
        withoutKept(cal, a.id);
        log('calendar_kept_dropped', { why: passed ? 'passed' : 'old' });
        lines.push(`I had kept a slot for ${quote(a.title)}, ${slot(a)}, until Super Productivity was open. ${passed ? 'That time has passed' : `That was more than ${hours} hour${hours === 1 ? '' : 's'} ago`}, so it isn't on the calendar.`);
      }
    });
    return lines;
  }
  /** Right after a run that reached the app (so the task list has just been read): each kept block is placed, or,
   *  when it overlaps something, handed over as the usual question. One whose to-do is done or gone is dropped
   *  without a word. → whether any was placed (then a second run sends it to the app). */
  function applyKept(lines) {
    let placed = false;
    for (const a of [...get().actions].sort((x, y) => Date.parse(x.at) - Date.parse(y.at))) {
      const cal = get(), link = cal.links[a.todo];
      if (cal.waiting[a.todo]) continue; // its task was deleted in the app and the owner hasn't answered yet
      if (!link || link.was !== 'open') { edit((c) => withoutKept(c, a.id)); log('calendar_kept_dropped', { why: 'done' }); continue; }
      const day = new Date(a.start); day.setHours(0, 0, 0, 0);
      const { mine, theirs } = dayBlocks(day, cal);
      const hits = [...mine.filter((b) => b.todo !== a.todo && !b.done && overlap(a, b)), ...theirs.filter((b) => overlap(a, b))];
      if (hits.length) {
        // A clash: the question, asked when nothing else is going on (sidekick.mjs → placeKept).
        edit((c) => { withoutKept(c, a.id); c.held.push({ block: { todo: a.todo, title: link.title, start: a.start, minutes: a.minutes, at: a.at } }); });
        log('calendar_kept_asks', {});
        continue;
      }
      // Off the list and onto the calendar in one write: it can't be placed twice.
      edit((c) => { withoutKept(c, a.id); c.links[a.todo].local.start = a.start; c.links[a.todo].local.minutes = a.minutes; });
      log('calendar_block', { what: 'placed', kept: true });
      lines.push(`${quote(link.title)} is on the calendar now, ${slot(a)}: the slot I kept while Super Productivity was closed.`);
      placed = true;
    }
    return placed;
  }
  /** A kept block that overlaps something: the usual question, then placed on a yes. → a line to say, or ''. */
  async function placeKept(b, signal) {
    try { await fresh('place a block'); } catch (e) {
      if (!(e instanceof Away)) throw e;
      await inTurn(() => edit((cal) => { if (!cal.actions.some((x) => x.todo === b.todo)) cal.actions.push({ id: `a${now().toString(36)}r`, at: b.at, todo: b.todo, title: b.title, start: b.start, minutes: b.minutes }); })); // the app went away again: kept again, as old as it was
      return '';
    }
    let t;
    try { ({ t } = await todoFor(b.todo)); } catch { return ''; } // done or gone meanwhile
    if (get().links[b.todo].local.start === b.start) return ''; // placed meanwhile
    if (!(b.start + b.minutes * 60_000 > now())) return `I had kept a slot for ${quote(t.text)}, ${slot(b)}, until Super Productivity was open. That time has passed, so it isn't on the calendar.`;
    try { await place(b.todo, t.text, b.start, b.minutes, signal); } catch (e) { if (e.declined) return ''; throw e; }
    log('calendar_block', { what: 'placed', kept: true });
    sync('change').catch(() => {});
    return `${quote(t.text)} is on the calendar ${slot(b)}.`;
  }
  /** The kept blocks, for show_pending and the morning briefing: [{ at, brief }]. */
  function kept() {
    try { return get().actions.map((a) => ({ at: a.at, brief: `Put ${quote(a.title)} on the calendar ${slot(a)}` })); } catch { return []; }
  }

  /** The day plan, shown whole; said as the day and how many blocks. → true on a yes. */
  const askPlan = (day, shown, placed, left, signal, kept = null) => yesTo({
    placeholder: shown, choices: ['Plan it', 'Don\'t'],
    spoken: `Plan for ${dayName(day)}: ${placed.length} block${placed.length === 1 ? '' : 's'}, from ${hm(placed[0].start)}. Put it on the calendar?`,
    pending: keep(kept, 'plan', `Put the plan for ${dayName(day)} on the calendar (${placed.length} block${placed.length === 1 ? '' : 's'})?`, { date: `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`, shown, placed: placed.map((p) => ({ todo: p.todo, title: p.title, start: p.start, minutes: p.minutes })), left: left.map((l) => ({ title: l.title })) }),
  }, signal);
  const minutesArg = z.number().int().min(5).max(720);
  /** A block's length: from start and end when an end was given (never both an end and minutes), else minutes. */
  const lengthOf = (start, end, mins) => {
    if (end === undefined || end === null || end === '') return mins;
    if (mins) throw new Error('Give end or minutes, not both: with an end, the app works out the length.');
    return minutesBetween(start, end);
  };
  const DATE_ARG = 'date is the day as they said it: "today", "tomorrow", a weekday ("friday": the app works out which date that is, the next one counting today), or YYYY-MM-DD when they named a date. Never work out the date of a weekday yourself. When they give a start and an end ("from 10 to 11"), give start and end (HH:MM, 24-hour) and no minutes: the app works out the length. The result names the day and times that were used: say those.';
  const blockTools = [
    {
      name: 'schedule_block',
      description: 'Put a to-do on the calendar in Super Productivity as a block of time: a start and a length. Give todo (the id of an open to-do), or title for something new, which also becomes a to-do. A to-do has one block: scheduling it again moves it. minutes is needed unless the to-do already has a length; if they didn\'t say how long, ask. A block they dictate goes straight in; if it overlaps something, the app asks them itself. If Super Productivity is closed the app keeps the slot and books it itself when it is open again: the result says so, and you say what the result says, never that it is booked. ' + DATE_ARG,
      parameters: z.object({ todo: z.string().optional(), title: z.string().min(2).max(200).optional(), date: z.string(), start: z.string(), end: z.string().optional(), minutes: minutesArg.optional() }),
      execute: async ({ todo, title: name, date, start, end, minutes: given }, ctx) => {
        if (!todo === !name?.trim()) throw new Error('Give either todo (an id) or title (something new), not both.');
        const mins = lengthOf(start, end, given);
        const at = when(date, start, mins);
        let pre;
        try { pre = await fresh('place a block'); } catch (e) {
          if (!(e instanceof Away)) throw e;
          // The app isn't answering: the request is kept and placed when it is back. Everything that can be checked
          // without the app is checked now.
          if (!get().started) throw new Error(NOT_YET);
          if (todo) {
            const t = await openTodo(todo);
            const length = mins ?? get().links[todo]?.local.minutes;
            if (!length) throw new Error(`How long does ${quote(t.text)} take? Ask, then give minutes.`);
            return keepBlock({ todo, name: t.text, start: at.start, mins: length });
          }
          if (!mins) throw new Error('How long does it take? Ask, then give minutes.');
          if (!(at.start + mins * 60_000 > now())) return keepBlock({ todo: '', name: title(name), start: at.start, mins }); // throws: nothing is made for a time that has passed
          const made = await todos.add(title(name)); // every block has a to-do behind it: mirrored at the next sync
          return keepBlock({ todo: made.id, name: title(name), start: at.start, mins, made: true });
        }
        let id = todo;
        if (!id) {
          if (!mins) throw new Error('How long does it take? Ask, then give minutes.');
          id = (await todos.add(title(name))).id; // every block has a to-do behind it
          const made = await sync('tool');
          if (!made.ok || !get().links[id]) return keepBlock({ todo: id, name: title(name), start: at.start, mins, made: true }); // the app went away in between: the slot is kept
        }
        const { t, link } = await todoFor(id);
        const length = mins ?? link.local.minutes;
        if (!length) throw new Error(`How long does ${quote(t.text)} take? Ask, then give minutes.`);
        const moved = link.local.start !== null;
        await place(id, t.text, at.start, length, ctx?.signal);
        log('calendar_block', { what: moved ? 'moved' : 'placed' });
        return settle(pre, `${quote(t.text)} is on the calendar ${dayName(at.day)}, ${span({ start: at.start, minutes: length })}${moved ? ' (moved from where it was)' : ''}${todo ? '' : `, and on the to-do list as ${id}`}.`);
      },
    },
    {
      name: 'move_block',
      description: 'Move a to-do\'s block on the calendar to another day or time, or change its length. Give what changes; the rest stays. If Super Productivity is closed the app keeps the move and makes it itself when it is open again: say what the result says, never that it is moved. ' + DATE_ARG,
      parameters: z.object({ todo: z.string(), date: z.string().optional(), start: z.string().optional(), end: z.string().optional(), minutes: minutesArg.optional() }),
      execute: async ({ todo, date, start, end, minutes: given }, ctx) => {
        if (!date && !start && !end && !given) throw new Error('Say what changes: date, start, end or minutes.');
        let pre;
        try { pre = await fresh('move a block'); } catch (e) {
          if (!(e instanceof Away)) throw e;
          // The app isn't answering: the move is kept. It starts from the slot already kept for this to-do, if there
          // is one, else from the block as it is known here.
          if (!get().started) throw new Error(NOT_YET);
          const t = await openTodo(todo);
          const local = get().links[todo]?.local, waiting = get().actions.find((a) => a.todo === todo);
          const from = waiting ?? (local && local.start !== null ? local : null);
          if (!from) throw new Error(`${quote(t.text)} has no block to move. schedule_block places one.`);
          const was = new Date(from.start);
          const length = lengthOf(start ?? hm(from.start), end, given) ?? from.minutes;
          const at = when(date ?? `${was.getFullYear()}-${pad(was.getMonth() + 1)}-${pad(was.getDate())}`, start ?? hm(from.start), length);
          if (!length) throw new Error(`How long does ${quote(t.text)} take? Ask, then give minutes.`);
          return keepBlock({ todo, name: t.text, start: at.start, mins: length, moved: true });
        }
        const { t, link } = await todoFor(todo);
        if (link.local.start === null) throw new Error(`${quote(t.text)} has no block to move. schedule_block places one.`);
        const was = new Date(link.local.start);
        const length = lengthOf(start ?? hm(link.local.start), end, given) ?? link.local.minutes;
        const at = when(date ?? `${was.getFullYear()}-${pad(was.getMonth() + 1)}-${pad(was.getDate())}`, start ?? hm(link.local.start), length);
        if (!length) throw new Error(`How long does ${quote(t.text)} take? Ask, then give minutes.`);
        await place(todo, t.text, at.start, length, ctx?.signal);
        log('calendar_block', { what: 'moved' });
        return settle(pre, `${quote(t.text)} is now ${dayName(at.day)}, ${span({ start: at.start, minutes: length })}.`);
      },
    },
    {
      name: 'unschedule_block',
      description: 'Take a to-do\'s block off the calendar. The to-do and its task stay; only the time goes.',
      parameters: z.object({ todo: z.string() }),
      execute: async ({ todo }) => {
        if (!get().started) throw new Error(NOT_YET);
        const pre = (await sync('tool')).text;
        const { t, link } = await todoFor(todo);
        if (link.local.start === null) {
          const waiting = await inTurn(() => edit((cal) => unkeep(cal, todo)));
          return waiting ? `The slot kept for ${quote(t.text)} is dropped: it won't be put on the calendar. It is still on the to-do list.` : `${quote(t.text)} has no block on the calendar.`;
        }
        await setLocal(todo, { start: null });
        log('calendar_block', { what: 'unscheduled' });
        return settle(pre, `${quote(t.text)} is off the calendar. It is still on the to-do list.`);
      },
    },
    {
      name: 'show_day',
      description: 'What is on the calendar on a day: the blocks of their to-dos, with times and lengths, and the time taken by other tasks they scheduled in Super Productivity themselves (given as taken time only). date: "today", "tomorrow", a weekday (the app works out its date) or YYYY-MM-DD.',
      parameters: z.object({ date: z.string() }),
      execute: async ({ date }) => {
        const day = dayFrom(date, now());
        if (!day) throw new Error(DATE_HOW);
        const pre = await fresh('read the calendar');
        const { mine, theirs } = dayBlocks(day, get(), await todos.all());
        const lines = [...mine.map((b) => ({ at: b.start, text: `${span(b)} (${b.minutes} min): ${b.title}${b.done ? ' (done)' : ''} [${b.todo}]` })), ...theirs.map((b) => ({ at: b.start, text: `${span(b)}: taken by a task of their own in Super Productivity` }))].sort((a, b) => a.at - b.at).map((l) => l.text);
        return [lines.length ? `${dayName(day)}:\n${lines.join('\n')}` : `Nothing is on the calendar ${dayName(day)}.`, pre].filter(Boolean).join('\n');
      },
    },
    {
      name: 'plan_day',
      description: 'Plan a day: give the to-dos to place, in the order to do them, each with how long it takes (ask when they haven\'t said and the to-do has no length). The app works out the times itself, inside the working day, keeping lunch and everything already scheduled free, then shows them the whole plan and creates it only after their yes. from and until (HH:MM) stretch or shorten the day for this one plan, only when they say so ("plan until 20:00 today"). date: "today", "tomorrow", a weekday (the app works out its date) or YYYY-MM-DD.',
      parameters: z.object({ date: z.string(), items: z.array(z.object({ todo: z.string(), minutes: minutesArg.optional() })).min(1).max(30), from: z.string().optional(), until: z.string().optional() }),
      execute: async ({ date, items, from, until }, ctx) => {
        const day = dayFrom(date, now());
        if (!day) throw new Error(DATE_HOW);
        const c = settings().calendar, a = from ? clockOf(from) : c.dayStart, b = until ? clockOf(until) : c.dayEnd;
        if (a === null || b === null || a >= b) throw new Error('from and until have to be times, HH:MM, from before until.');
        const pre = await fresh('plan the day');
        if (new Set(items.map((i) => i.todo)).size !== items.length) throw new Error('A to-do can be in the plan once: it has one block.');
        const want = [];
        for (const i of items) {
          const { t, link } = await todoFor(i.todo);
          const length = i.minutes ?? link.local.minutes;
          if (!length) throw new Error(`How long does ${quote(t.text)} take? Ask, then give its minutes.`);
          want.push({ todo: i.todo, title: t.text, minutes: length });
        }
        const at = (m) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m).getTime();
        const { mine, theirs } = dayBlocks(day);
        const busy = [...mine.filter((x) => !x.done && !want.some((w) => w.todo === x.todo)), ...theirs, ...(c.lunch ? [{ start: at(c.lunch[0]), minutes: c.lunch[1] - c.lunch[0], gap: false }] : [])];
        // Today, a plan starts from now (to the next five minutes), not from a time already gone.
        const soonest = Math.ceil(now() / 300_000) * 300_000;
        const { placed, left } = placeDay(want, { from: Math.max(at(a), soonest), until: at(b), busy, gap: c.gapMinutes });
        if (!placed.length) throw new Error(`Nothing fits ${dayName(day)} between ${hm(Math.max(at(a), soonest))} and ${hm(at(b))} with what is already there. Nothing was changed.`);
        const shown = [`Plan for ${dayName(day)}:`, ...placed.map((p) => `${span(p)}  ${p.title}`), ...(left.length ? [`No room for: ${left.map((l) => l.title).join('; ')}`] : [])].join('\n');
        const yes = await askPlan(day, shown, placed, left, ctx?.signal);
        if (!yes) throw new Error('They didn\'t say yes to the plan, so nothing was put on the calendar.');
        for (const p of placed) await setLocal(p.todo, { start: p.start, minutes: p.minutes });
        log('calendar_plan', { blocks: placed.length, left: left.length });
        return settle(pre, `On the calendar ${dayName(day)}: ${placed.map((p) => `${span(p)} ${quote(p.title)}`).join('; ')}.${left.length ? ` No room for: ${left.map((l) => quote(l.title)).join(', ')}.` : ''}`);
      },
    },
  ];

  // ---- the Eisenhower matrix: urgent and important, which are the app's two matrix tags
  const QUADRANTS = [['Urgent and important', true, true], ['Important, not urgent', false, true], ['Urgent, not important', true, false], ['Neither urgent nor important', false, false]];
  const quadrant = (urgent, important) => QUADRANTS.find(([, u, i]) => u === !!urgent && i === !!important)[0];
  /** The open to-dos that are mirrored, each with where it sits: [{ id, title, urgent, important, sorted, block }]. */
  async function sortable() {
    const cal = get();
    return (await todos.all()).filter((t) => t.status === 'open' && cal.links[t.id]).map((t) => { const l = cal.links[t.id]; return { id: t.id, title: t.text, urgent: l.local.urgent, important: l.local.important, sorted: !!l.sorted || l.local.urgent || l.local.important, block: l.local.start }; });
  }
  const setFlags = (id, flags) => inTurn(() => edit((cal) => { const l = cal.links[id]; if (!l) return false; for (const f of ['urgent', 'important']) if (typeof flags[f] === 'boolean') l.local[f] = flags[f]; l.sorted = true; return true; }));
  /** Before the matrix is read or changed: mirrored, and in step with the app when it answers (without it, what is
   *  set here is kept and goes over at the next sync). */
  async function mirrored() {
    if (!get().started) throw new Error(NOT_YET.replace('so there is nowhere to put a block', 'and urgent and important are kept with each to-do\'s task there'));
    return (await sync('tool')).text;
  }
  /** The sorting proposal, shown whole. → true on a yes. */
  const askSort = (proposals, all, signal, kept = null) => {
    const shown = ['Sort these to-dos like this?', ...QUADRANTS.map(([name, u, i]) => { const here = proposals.filter((p) => p.urgent === u && p.important === i).map((p) => all.find((x) => x.id === p.todo).title); return here.length ? `${name}: ${here.join('; ')}` : null; }).filter(Boolean)].join('\n');
    return yesTo({ placeholder: shown, choices: ['Sort them', 'Don\'t'], spoken: `Sort ${proposals.length} to-do${proposals.length === 1 ? '' : 's'} the way it's shown?`, pending: keep(kept, 'sort', `Sort ${proposals.length} to-do${proposals.length === 1 ? '' : 's'} into the matrix as proposed?`, { proposals: proposals.map((p) => ({ todo: p.todo, urgent: p.urgent, important: p.important })) }) }, signal);
  };
  const matrixTools = [
    {
      name: 'set_priority',
      description: 'Mark a to-do urgent or not, important or not (the Eisenhower matrix; in Super Productivity these are its two matrix tags). Use it when they say so ("that one is urgent and important", "the email isn\'t urgent"). Give only what they said; the other stays as it is.',
      parameters: z.object({ todo: z.string(), urgent: z.boolean().optional(), important: z.boolean().optional() }),
      execute: async ({ todo, urgent, important }) => {
        if (urgent === undefined && important === undefined) throw new Error('Say which: urgent, important, or both.');
        const pre = await mirrored();
        const { t } = await todoFor(todo);
        await setFlags(todo, { urgent, important });
        const l = get().links[todo].local;
        log('calendar_priority', { set: 1 });
        return settle(pre, `${quote(t.text)}: ${quadrant(l.urgent, l.important).toLowerCase()}.`);
      },
    },
    {
      name: 'sort_tasks',
      description: 'Propose where each unsorted to-do goes in the Eisenhower matrix. Call show_matrix first to see which are unsorted, then give a proposal for every one of them: urgent or not, important or not, judged from what the to-do says and when it is due. The app shows them the whole proposal and applies it only after their yes. For one to-do they have placed themselves, use set_priority instead.',
      parameters: z.object({ proposals: z.array(z.object({ todo: z.string(), urgent: z.boolean(), important: z.boolean() })).min(1).max(60) }),
      execute: async ({ proposals }, ctx) => {
        const pre = await mirrored();
        const all = await sortable();
        if (new Set(proposals.map((p) => p.todo)).size !== proposals.length) throw new Error('Each to-do once.');
        for (const p of proposals) {
          const it = all.find((x) => x.id === p.todo);
          if (!it) { await todoFor(p.todo); throw new Error(`${p.todo} can't be sorted.`); } // todoFor says why not
          if (it.sorted) throw new Error(`${quote(it.title)} already has its place (${quadrant(it.urgent, it.important).toLowerCase()}). sort_tasks is for the unsorted ones; set_priority changes one they name.`);
        }
        const yes = await askSort(proposals, all, ctx?.signal);
        if (!yes) throw new Error('They didn\'t say yes to the proposal, so nothing was sorted.');
        for (const p of proposals) await setFlags(p.todo, { urgent: p.urgent, important: p.important });
        log('calendar_priority', { set: proposals.length });
        return settle(pre, `Sorted ${proposals.length} to-do${proposals.length === 1 ? '' : 's'}.`);
      },
    },
    {
      name: 'show_matrix',
      description: 'The Eisenhower matrix of their open to-dos: the four quadrants, and the to-dos not sorted yet. Say it briefly: a quadrant at a time, a few words each, not every line.',
      parameters: z.object({}),
      execute: async () => {
        const pre = await mirrored();
        const all = await sortable();
        if (!all.length) return ['There are no open to-dos to sort.', pre].filter(Boolean).join('\n');
        const line = (x) => `${x.title} [${x.id}]${x.block === null ? '' : ' (on the calendar)'}`;
        const parts = QUADRANTS.map(([name, u, i]) => { const here = all.filter((x) => x.sorted && x.urgent === u && x.important === i); return `${name}: ${here.length ? here.map(line).join('; ') : 'nothing'}`; });
        const loose = all.filter((x) => !x.sorted);
        return [...parts, loose.length ? `Not sorted yet: ${loose.map(line).join('; ')}` : 'Every to-do is sorted.', pre].filter(Boolean).join('\n');
      },
    },
  ];

  /** For the morning briefing: what is on the calendar today, as a note for the model. '' when that isn't known. */
  function dayNote(d = new Date(now())) {
    let cal;
    try { cal = get(); } catch { return ''; }
    if (!cal.started || !lastOk) return '';
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const { mine, theirs } = dayBlocks(day, cal);
    const open = mine.filter((b) => !b.done);
    if (!open.length && !theirs.length) return '\nNothing is on the calendar in Super Productivity today.';
    return `\nOn the calendar in Super Productivity today: ${open.map((b) => `${span(b)} ${quote(b.title)}`).join('; ') || 'none of their to-dos'}${theirs.length ? `; and ${theirs.length} other stretch${theirs.length === 1 ? '' : 'es'} of time taken by tasks of their own there (${theirs.map(span).join(', ')})` : ''}. Say it in a sentence or two.`;
  }

  /** Upstream's to-do tools, with a sync before each: what the app changed is in before the list is read or changed. */
  const TODO_TOOLS = new Set(['remember_commitment', 'update_commitment', 'list_commitments', 'show_list']);
  const wrap = (tools) => tools.map((t) => (TODO_TOOLS.has(t.name) ? { ...t, execute: async (...a) => { const pre = await sync('tool'); const out = await t.execute(...a); return pre.text ? `${out}\n\n${pre.text}` : out; } } : t));

  const tools = [
    ...blockTools,
    ...matrixTools,
    {
      name: 'sync_todos',
      description: 'Sync the to-do list with Super Productivity now (it also happens by itself, about once a minute). Use it when they ask to sync, or to put their to-do list in Super Productivity for the first time; that first time the app shows them the list and waits for their yes.',
      parameters: z.object({}),
      execute: async (_args, ctx) => {
        const up = await reach();
        if (!up.ok) throw new Error(`${up.why} The to-do list still works here and is synced when the app is back.`);
        if (!get().started && !(await offerStart(ctx?.signal))) return 'They didn\'t say yes, so nothing was added to Super Productivity.';
        const r = await sync('tool');
        if (!r.ok) throw new Error(r.why);
        return ['The to-do list and Super Productivity are in step.', r.text].filter(Boolean).join('\n');
      },
    },
  ];

  // ---- feature 22: a question nobody answered, asked again when an exchange ends (flow.mjs). Each first looks,
  // without asking anything, at what has become of it:
  //   { done: true }      the thing was done meanwhile (sorted, placed, settled): cleared without a word
  //   { dropped: line }   it no longer applies and something they wanted is lost (the time has passed): one line
  //   { later: true }     the app isn't answering: it stays kept
  //   { ask }             it still applies: ask() asks it again → { say }. Without an answer it throws Unanswered,
  //                       and the question is kept again with its first age.
  const up = async () => (await reach()).ok && get().started;
  const stillOpen = async (id) => { const t = (await todos.all()).find((x) => x.id === id); return t && t.status === 'open' && get().links[id] ? t : null; };
  const DONE = { done: true };
  const resume = {
    async start(q) {
      if (get().started) return DONE;
      if (!(await there())) return { later: true };
      if (!(await firstRun())) return DONE; // no open to-dos: nothing to put there, and it counts as settled
      return { ask: async () => ({ say: (await offerStart(undefined, q)) ? 'The to-do list is in Super Productivity now.' : '' }) };
    },
    async deleted(q) {
      const { todo } = q.data ?? {};
      const t = (await todos.all()).find((x) => x.id === todo);
      if (!t || t.status !== 'open' || !get().waiting[todo]) return DONE; // the to-do is gone or done, or has a task again
      return { ask: async () => {
        const yes = await askDeleted({ todo, title: t.text }, undefined, q);
        if (yes) await todos.update(todo, { status: 'dropped' });
        await answered(todo);
        sync('change').catch(() => {});
        return { say: yes ? `${quote(t.text)} is off the to-do list.` : `${quote(t.text)} stays on the to-do list.` };
      } };
    },
    async overlap(q) {
      const { todo, title: name, start, minutes: mins } = q.data ?? {};
      const t = (await todos.all()).find((x) => x.id === todo);
      if (!t || t.status !== 'open') return DONE; // done or taken off the list: no block is wanted for it
      const link = get().links[todo];
      // On the calendar since the question was asked, there or elsewhere: a later request settled it.
      if (link && link.local.start !== null && link.local.start !== q.data?.was) return DONE;
      if (!(start + mins * 60_000 > now())) return { dropped: `I had asked whether to put ${quote(name ?? t.text)} on the calendar ${dayName(new Date(start))}, ${span({ start, minutes: mins })}, although it overlapped something. That time has passed, so it isn't on the calendar.` };
      if (!link || !(await up())) return { later: true };
      return { ask: async () => {
        if (!(await sync('tool')).ok) throw new Error('Super Productivity stopped answering.');
        try { await place(todo, t.text, start, mins, undefined, q); } catch (e) { if (e.declined) return {}; throw e; }
        log('calendar_block', { what: 'placed' });
        sync('change').catch(() => {});
        return { say: `${quote(t.text)} is on the calendar ${dayName(new Date(start))}, ${span({ start, minutes: mins })}.` };
      } };
    },
    async plan(q) {
      const { date, shown, placed = [], left = [] } = q.data ?? {};
      const day = dayOf(date);
      const gone = (why) => ({ dropped: `The day plan${day ? ` for ${dayName(day)}` : ''} was waiting for your answer. ${why}, so it isn't on the calendar.` });
      if (!day || !placed.length) return gone('I can no longer read it');
      const links = get().links, all = await todos.all();
      const open = placed.filter((p) => all.some((x) => x.id === p.todo && x.status === 'open'));
      // Every to-do in it is done or gone, or already has a block that day: there is nothing left to plan.
      const until = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
      if (open.every((p) => { const at = links[p.todo]?.local.start; return at != null && at >= day.getTime() && at < until; })) return DONE;
      if (placed.some((p) => p.start < now())) return gone(until <= now() ? 'That day has passed' : 'Its first times have passed');
      if (!(await up())) return { later: true };
      for (const p of placed) if (!(await stillOpen(p.todo))) return gone(`${quote(p.title)} is no longer open`);
      return { ask: async () => {
        if (!(await askPlan(day, shown, placed, left, undefined, q))) return {};
        for (const p of placed) await setLocal(p.todo, { start: p.start, minutes: p.minutes });
        log('calendar_plan', { blocks: placed.length, left: left.length });
        sync('change').catch(() => {});
        return { say: `The plan for ${dayName(day)} is on the calendar.` };
      } };
    },
    async sort(q) {
      if (!get().started) return DONE;
      const all = await sortable();
      const proposals = (q.data?.proposals ?? []).filter((p) => all.some((x) => x.id === p.todo && !x.sorted));
      if (!proposals.length) return DONE; // sorted meanwhile, done, or gone
      return { ask: async () => {
        if (!(await askSort(proposals, all, undefined, q))) return {};
        for (const p of proposals) await setFlags(p.todo, { urgent: p.urgent, important: p.important });
        log('calendar_priority', { set: proposals.length });
        sync('change').catch(() => {});
        return { say: `Sorted ${proposals.length} to-do${proposals.length === 1 ? '' : 's'}.` };
      } };
    },
  };

  /** One line for the model's live state. */
  function live() {
    let cal;
    try { cal = get(); } catch { return '- Super Productivity: the settings file can\'t be read, so the to-do list isn\'t synced.'; }
    const n = Object.keys(cal.links).length, later = kept();
    const how = ' When a calendar tool needs a yes (the first time, an overlap, a day plan, a sorting proposal), the app opens a bubble itself and they answer it by saying yes or no, or by clicking: don\'t ask them yourself as well, and never tell them they have to click. What you say about the calendar is what the tool\'s result says was done, with the day and times it names: "on the calendar", "booked" or "scheduled" only when the result says it is on the calendar; when it says the slot is kept until Super Productivity is open, say the task is saved and the slot will be booked when Super Productivity is open.';
    const waits = later.length ? `\n- Not on the calendar yet, kept until Super Productivity is open (the app places them itself then; don't say they are booked): ${later.map((a) => a.brief.replace(/^Put /, '').replace(' on the calendar ', ', ')).join('; ')}.` : '';
    return (cal.started ? `- Super Productivity: ${n} to-do${n === 1 ? '' : 's'} mirrored there as tasks (kept in step by the app, both ways).` : '- Super Productivity: the to-do list isn\'t mirrored there yet (sync_todos offers it).') + how + waits;
  }

  return { tools, wrap, sync, changed, setLocal, answered, askDeleted, placeKept, kept, resume, dayNote, startup, takeHeld, hasHeld, offerStart, firstRun, live, there, others: () => others, state: get };
}
