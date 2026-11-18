// Local-only build: the to-do list mirrored in Super Productivity (calendar.mjs). The app is stood in for by a small
// HTTP server on a loopback port that behaves as 20.0.0 was seen to; the real app is never called from here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-home-')));
process.env.ROAMIES_DATA_DIR = path.join(home, 'data'); // for store.mjs, below
const dir = path.join(home, 'Documents', 'roamies-pi');
const stateFile = path.join(dir, 'state.json'), settingsFile = path.join(dir, 'settings.json');
const TOKEN = 'Tk'.repeat(16), tokenFile = path.join(home, 'token');
fs.writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 });
const SECRET = 'NOTES-OF-A-TASK-ROAMIES-DID-NOT-MAKE';

// Everything written to disk from here on is kept, to be searched at the end.
const written = [];
for (const name of ['writeFileSync', 'appendFileSync']) { const real = fs[name]; fs[name] = (file, data, ...rest) => { written.push({ file: String(file), data: String(data) }); return real(file, data, ...rest); }; }
for (const name of ['writeFile', 'appendFile']) { const real = fs.promises[name]; fs.promises[name] = (file, data, ...rest) => { written.push({ file: String(file), data: String(data) }); return real(file, data, ...rest); }; }

const { CALENDAR, LIMITS, SP, codeReference, loadSettings } = await import('../pi.mjs');
const { Down, FIELDS, createCalendar, createClient, dayFrom, minutesBetween, placeDay, quiet } = await import('../calendar.mjs');
const { settingsNotice, settingsReference } = await import('../reference.mjs');

// ---- the stand-in for Super Productivity
const app = { tasks: new Map(), archived: new Map(), log: [], seq: 0, hang: null, onPost: null, mode: 'up' };
const server = http.createServer((req, res) => {
  const parts = [];
  req.on('data', (d) => parts.push(d));
  req.on('end', () => {
    const url = new URL(req.url, 'http://x'), body = parts.length ? JSON.parse(Buffer.concat(parts).toString()) : undefined;
    app.log.push({ method: req.method, path: url.pathname, query: url.search, body, auth: req.headers.authorization ?? null, host: req.headers.host });
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(status < 400 ? { ok: true, data } : { ok: false, error: data })); };
    if (app.hang && app.hang(req.method, url.pathname)) return; // never answers
    if (app.mode === 'other') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>another program</html>'); }
    if (app.mode === 'starting') return send(503, { code: 'RENDERER_NOT_READY', message: 'Renderer not ready' });
    if (req.method === 'GET' && url.pathname === '/health') return send(200, { server: 'up', rendererReady: true });
    if (req.headers.authorization !== `Bearer ${TOKEN}` || app.mode === 'locked') return send(401, { code: 'UNAUTHORIZED', message: 'Invalid authorization token.' });
    const no = app.refuse?.(req.method, url.pathname, body);
    if (no) return send(no.status, { code: no.code, message: no.message });
    const id = url.pathname.startsWith('/tasks/') ? decodeURIComponent(url.pathname.slice(7)) : null;
    if (req.method === 'GET' && url.pathname === '/tasks') {
      const from = url.searchParams.get('source') === 'archived' ? app.archived : app.tasks;
      return send(200, [...from.values()].filter((t) => url.searchParams.get('includeDone') === 'true' || !t.isDone));
    }
    if (req.method === 'POST' && url.pathname === '/tasks') {
      app.onPost?.(body);
      // as the app does: without the flag, short syntax is read out of the title
      const t = { id: `sp${++app.seq}`, title: body.isIgnoreShortSyntax === true ? body.title.trim() : body.title.replace(/[@#+]\S+/g, '').trim(), isDone: false, timeEstimate: 0, tagIds: [], projectId: 'INBOX_PROJECT', notes: '', created: Date.now(), dueDay: '2026-11-14' };
      if (typeof body.deadlineWithTime === 'number') t.deadlineWithTime = body.deadlineWithTime;
      app.tasks.set(t.id, t);
      return send(201, t);
    }
    if (id && req.method === 'GET') return app.tasks.has(id) ? send(200, app.tasks.get(id)) : send(404, { code: 'TASK_NOT_FOUND', message: 'Task not found' });
    if (id && req.method === 'PATCH') {
      const t = app.tasks.get(id);
      if (!t) return send(404, { code: 'TASK_NOT_FOUND', message: 'Task not found' });
      const { isIgnoreShortSyntax, ...changes } = body;
      if ('title' in changes && !(isIgnoreShortSyntax === true && Object.keys(changes).length === 1) && Object.keys(changes).length === 1) changes.title = changes.title.replace(/[@#+]\S+/g, '').trim();
      if ('deadlineWithTime' in changes) { delete t.deadlineDay; if (changes.deadlineWithTime === null) { delete t.deadlineWithTime; delete changes.deadlineWithTime; } }
      if ('deadlineDay' in changes) { delete t.deadlineWithTime; if (changes.deadlineDay === null) { delete t.deadlineDay; delete changes.deadlineDay; } else delete t.deadlineWithTime; }
      if (typeof changes.dueWithTime === 'number' && typeof t.dueWithTime !== 'number') t.remindAt = changes.dueWithTime; // the app's own reminder
      if (changes.dueWithTime === null) delete t.remindAt;
      Object.assign(t, changes, { modified: Date.now() });
      return send(200, t);
    }
    if (id && req.method === 'DELETE') { app.tasks.delete(id); return send(200, { deleted: true, id }); }
    send(404, { code: 'NOT_FOUND', message: 'Route not found' });
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const writes = (from = 0) => app.log.slice(from).filter((r) => r.method !== 'GET');
const hand = (title, extra = {}) => { const t = { id: `hand${++app.seq}`, title, isDone: false, timeEstimate: 0, tagIds: ['PERSONAL'], notes: SECRET, attachments: [{ path: SECRET }], subTaskIds: [SECRET], projectId: 'INBOX_PROJECT', ...extra }; app.tasks.set(t.id, t); return t; };

// ---- Roamies' own list, stood in for
const list = [];
let seq = 0;
const add = (text, { due = null, kind = 'commitment' } = {}) => { const c = { id: `c${++seq}`, text, due, status: 'open', kind }; list.push(c); return c; };
const todos = {
  all: () => list.filter((c) => c.status === 'open' || c.status === 'done').map((c) => ({ ...c })),
  update: async (id, { status, dueMs }) => { const c = list.find((x) => x.id === id); if (status) c.status = status; if (dueMs !== undefined) c.due = dueMs; },
  rename: async (id, text) => { list.find((x) => x.id === id).text = text; },
  add: async (text) => add(text),
};
const logged = [];
let answer = null; const asked = [];
let clock = new Date(2026, 10, 14, 8).getTime();
const make = () => createCalendar({ home, todos, port, tokenFile, now: () => clock, ask: async (o) => { asked.push(o.placeholder); return answer; }, log: (kind, data) => logged.push({ kind, data }) });
const cal = make();
const state = () => (fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')).calendar : undefined);
const taskOf = (c) => app.tasks.get(state().links[c.id].task);
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();

// ---- 1. the settings: "calendar" and the request timeout, shown in settings.default.json
let s = loadSettings(home);
assert.deepEqual(s.calendar, { dayStart: 540, dayEnd: 1080, lunch: [750, 810], gapMinutes: 0, syncSeconds: 60 });
assert.equal(s.limits.calendarTimeoutSeconds, 20); assert.deepEqual(LIMITS.calendarTimeoutSeconds, { default: 20, min: 2, max: 60 });
const ref = settingsReference(home);
assert.deepEqual(ref.calendar, { dayStart: '09:00', dayEnd: '18:00', lunch: ['12:30', '13:30'], gapMinutes: 0, syncSeconds: 60 });
assert.equal(ref.limits.calendarTimeoutSeconds, 20);
assert.deepEqual(ref.reference.superProductivity.requestsSent, SP.requests); assert.equal(ref.reference.superProductivity.neverSent, 'DELETE');
assert.equal(ref.reference.superProductivity.address, 'http://127.0.0.1:3876'); assert.ok(!JSON.stringify(ref).includes(TOKEN));
assert.deepEqual([ref.reference.superProductivity.urgentTag, ref.reference.superProductivity.importantTag], ['EM_URGENT', 'EM_IMPORTANT']);
assert.deepEqual(ref.reference.calendarRanges.syncSeconds, { min: 15, max: 3600 });
const file0 = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
const withCalendar = (calendar) => { const f = { ...file0 }; if (calendar === undefined) delete f.calendar; else f.calendar = calendar; fs.writeFileSync(settingsFile, JSON.stringify(f)); return loadSettings(home); };
s = withCalendar(undefined);
assert.deepEqual(s.missing, ['calendar'], 'no "calendar" at all is one missing setting'); assert.equal(s.calendar.syncSeconds, 60);
s = withCalendar({ dayStart: '08:00', dayEnd: '20:00', lunch: [], gapMinutes: 5 });
assert.deepEqual(s.missing, ['calendar.syncSeconds']); assert.deepEqual(s.calendar, { dayStart: 480, dayEnd: 1200, lunch: null, gapMinutes: 5, syncSeconds: 60 });
assert.equal(withCalendar({ ...file0.calendar, lunch: null }).calendar.lunch, null, 'null: no break'); assert.deepEqual(withCalendar({ ...file0.calendar, lunch: null }).invalid, []);
for (const [part, bad] of [['dayStart', '25:00'], ['dayEnd', 'six'], ['lunch', ['13:00', '12:00']], ['lunch', ['12:00']], ['lunch', 'none'], ['gapMinutes', -1], ['gapMinutes', 2.5], ['syncSeconds', 5], ['syncSeconds', 4000], ['syncSeconds', '60']]) {
  s = withCalendar({ ...file0.calendar, [part]: bad });
  assert.deepEqual(s.invalid.map((i) => i.name), [`calendar.${part}`], `${part}: ${JSON.stringify(bad)}`);
  assert.deepEqual(s.invalid[0].using, CALENDAR[part].default);
  assert.match(settingsNotice(home), new RegExp(`can't use for: calendar\\.${part}\\.`));
}
s = withCalendar({ ...file0.calendar, dayStart: '19:00' });
assert.deepEqual(s.invalid.map((i) => i.name).sort(), ['calendar.dayEnd', 'calendar.dayStart'], 'a day that ends before it starts is the default day'); assert.equal(s.calendar.dayStart, 540);
s = withCalendar(file0.calendar);
const settingsBytes = fs.readFileSync(settingsFile, 'utf8');

// ---- 2. the requests: only these, only to this Mac, the token only where it's needed
const client = createClient({ home, port, tokenFile });
for (const [m, p] of [['DELETE', '/tasks/sp1'], ['PUT', '/tasks/sp1'], ['POST', '/tasks/sp1/archive'], ['POST', '/task-control/stop'], ['GET', '/notes'], ['GET', '/projects'], ['PATCH', '/tasks'], ['POST', '/tasks/sp1'], ['GET', 'http://example.com/tasks'], ['GET', '/tasks/a/b']]) {
  assert.throws(() => client.request(m, p, undefined, 500), /doesn't send/, `${m} ${p}`);
}
assert.equal(app.log.length, 0, 'and nothing reached the app');
assert.equal((await client.request('GET', '/health', undefined, 1000)).status, 200);
assert.equal(app.log[0].auth, null, 'the "is it there" check carries no token'); assert.equal(app.log[0].host, `127.0.0.1:${port}`);
assert.equal((await client.request('GET', '/tasks?includeDone=true', undefined, 1000)).status, 200);
assert.equal(app.log[1].auth, `Bearer ${TOKEN}`);
const noToken = createClient({ home, port, tokenFile: path.join(home, 'nope') }), before2 = app.log.length;
assert.throws(() => noToken.request('GET', '/tasks', undefined, 500), (e) => e instanceof Down && /access token/.test(e.message));
fs.writeFileSync(path.join(home, 'odd'), 'not a token at all\n');
assert.throws(() => createClient({ home, port, tokenFile: path.join(home, 'odd') }).request('GET', '/tasks', undefined, 500), Down, 'a file that isn\'t a token is never sent');
assert.equal(app.log.length, before2);
const wrong = 'Zz'.repeat(16); fs.writeFileSync(path.join(home, 'wrong'), wrong);
await assert.rejects(createClient({ home, port, tokenFile: path.join(home, 'wrong') }).request('GET', '/tasks', undefined, 500), (e) => e instanceof Down && /didn't accept/.test(e.message) && !e.message.includes(wrong));
await assert.rejects(createClient({ home, port: 1, tokenFile }).request('GET', '/health', undefined, 500), (e) => e instanceof Down && !e.message.includes(TOKEN), 'nothing listening');
assert.equal(new Set(SP.requests.map((r) => r.split(' ')[0])).has('DELETE'), false);
app.log.length = 0;

// ---- 3. the first time: nothing is created before a yes
const paper = add('Write the paper @tomorrow #urgent +work'), mail = add('Answer Ana', { due: at(16, 15) }), ping = add('Stretch', { kind: 'reminder', due: at(14, 20) });
let r = await cal.sync('timer');
assert.deepEqual([r.ok, r.started], [true, false]); assert.deepEqual(writes(), [], 'no yes yet: nothing created');
answer = null;
assert.equal(await cal.offerStart(), false);
assert.match(asked.at(-1), /^Put my to-do list in Super Productivity\? 2 to-dos, each as a task there:\n- Write the paper @tomorrow #urgent \+work\n- Answer Ana$/, 'the count and the titles; the reminder isn\'t one of them');
assert.deepEqual(writes(), []); assert.equal(state()?.started ?? false, false);
assert.equal(await cal.tools.find((t) => t.name === 'sync_todos').execute({}), 'They didn\'t say yes, so nothing was added to Super Productivity.');
answer = 'yes';
assert.equal(await cal.offerStart(), true);
assert.equal(state().started, true);
// ---- the mirror: a task for each commitment, none for a reminder, each title taken as written
assert.deepEqual(writes().map((w) => [w.method, w.path, w.body]), [
  ['POST', '/tasks', { title: 'Write the paper @tomorrow #urgent +work', isIgnoreShortSyntax: true }],
  ['POST', '/tasks', { title: 'Answer Ana', isIgnoreShortSyntax: true, deadlineWithTime: at(16, 15) }],
]);
assert.equal(taskOf(paper).title, 'Write the paper @tomorrow #urgent +work'); assert.equal(state().links[ping.id], undefined);
assert.deepEqual(state().intents, [], 'each create\'s intent is cleared once its link is saved');
assert.deepEqual(state().links[mail.id].agreed, { title: 'Answer Ana', done: false, start: null, minutes: 0, urgent: false, important: false, due: at(16, 15) });

// ---- a run that finds nothing changed writes nothing (no loop), and costs two requests
let mark = app.log.length;
r = await cal.sync('timer');
assert.deepEqual(app.log.slice(mark).map((x) => `${x.method} ${x.path}${x.query}`), ['GET /health', 'GET /tasks?includeDone=true']);
assert.ok(r.ok && r.lines.length === 0);
// a later to-do is mirrored when it is made; a reminder never is
const third = add('Book the room');
await cal.changed(third);
assert.equal(taskOf(third).title, 'Book the room'); assert.equal(app.tasks.size, 3);
add('Drink water', { kind: 'reminder' }); await cal.sync('timer'); assert.equal(app.tasks.size, 3);

// ---- 4. each field, from Roamies to the app, then nothing more
const sent = async (fn) => { const from = app.log.length; await fn(); const out = await cal.sync('timer'); return { out, w: writes(from).map((x) => x.body), all: app.log.slice(from) }; };
const twice = async () => { const from = app.log.length; await cal.sync('timer'); assert.deepEqual(writes(from), [], 'a second run writes nothing back'); };
let x = await sent(() => { paper.text = 'Write the paper #draft'; });
assert.deepEqual(x.w, [{ title: 'Write the paper #draft', isIgnoreShortSyntax: true }], 'a title goes alone and as written'); assert.equal(taskOf(paper).title, 'Write the paper #draft'); await twice();
x = await sent(() => { mail.due = at(17, 9); });
assert.deepEqual(x.w, [{ deadlineWithTime: at(17, 9) }]); await twice();
x = await sent(() => { mail.due = null; });
assert.deepEqual(x.w, [{ deadlineDay: null, deadlineWithTime: null }]); assert.ok(!('deadlineWithTime' in taskOf(mail))); await twice();
x = await sent(() => cal.setLocal(paper.id, { start: at(15, 10), minutes: 90 }));
assert.deepEqual(x.w, [{ dueWithTime: at(15, 10), timeEstimate: 90 * 60_000 }]); await twice();
taskOf(paper).tagIds = ['PERSONAL', 'KANBAN_IN_PROGRESS'];
x = await sent(() => cal.setLocal(paper.id, { urgent: true }));
assert.deepEqual(x.w, [{ tagIds: ['PERSONAL', 'KANBAN_IN_PROGRESS', 'EM_URGENT'] }], 'the task\'s other tags go back untouched');
assert.ok(x.all.some((q) => q.method === 'GET' && q.path === `/tasks/${state().links[paper.id].task}`), 'read just before the tags are written'); await twice();
x = await sent(() => cal.setLocal(paper.id, { urgent: false, important: true }));
assert.deepEqual(x.w, [{ tagIds: ['PERSONAL', 'KANBAN_IN_PROGRESS', 'EM_IMPORTANT'] }]); await twice();
x = await sent(() => cal.setLocal(paper.id, { important: false }));
assert.deepEqual(x.w, [{ tagIds: ['PERSONAL', 'KANBAN_IN_PROGRESS'] }]); await twice();
x = await sent(() => cal.setLocal(paper.id, { start: null }));
assert.deepEqual(x.w, [{ dueWithTime: null }]); await twice();

// ---- 5. each field, from the app to Roamies, and nothing written back
const got = async (fn) => { const from = app.log.length; fn(); const out = await cal.sync('timer'); assert.deepEqual(writes(from), [], 'what was read is not written back'); return out; };
await got(() => { taskOf(mail).title = 'Answer Ana and Rui'; }); assert.equal(mail.text, 'Answer Ana and Rui');
await got(() => { taskOf(mail).dueWithTime = at(16, 11); taskOf(mail).timeEstimate = 45 * 60_000; });
assert.deepEqual([state().links[mail.id].local.start, state().links[mail.id].local.minutes], [at(16, 11), 45]);
await got(() => { taskOf(mail).tagIds = ['EM_URGENT', 'EM_IMPORTANT', 'PERSONAL']; });
assert.deepEqual([state().links[mail.id].local.urgent, state().links[mail.id].local.important], [true, true]);
await got(() => { taskOf(mail).deadlineWithTime = at(18, 12); }); assert.equal(mail.due, at(18, 12));
await got(() => { delete taskOf(mail).deadlineWithTime; taskOf(mail).deadlineDay = '2026-11-20'; });
assert.equal(mail.due, at(20, 18), 'a deadline day with no time: the end of the working day');
await got(() => { delete taskOf(mail).deadlineDay; }); assert.equal(mail.due, null);
await got(() => { taskOf(mail).title = `  ${'long '.repeat(60)}`; }); assert.equal(mail.text.length, 199, 'a title is kept to the list\'s 200 characters, and not sent back cut');
await got(() => { taskOf(mail).title = 'Answer Ana'; });
await twice();

// ---- 6. both sides changed: different fields both survive; the same field is the app's, said in one line
x = await sent(() => { paper.text = 'Write the paper'; taskOf(paper).timeEstimate = 120 * 60_000; });
assert.deepEqual(x.w, [{ title: 'Write the paper', isIgnoreShortSyntax: true }]); assert.equal(state().links[paper.id].local.minutes, 120); assert.deepEqual(x.out.lines, []);
x = await sent(() => { paper.text = 'Write the paper, mine'; taskOf(paper).title = 'Write the paper, the app\'s'; });
assert.deepEqual(x.w, []); assert.equal(paper.text, 'Write the paper, the app\'s');
assert.deepEqual(x.out.lines, ['"Write the paper, the app\'s": the title changed both here and in Super Productivity. I kept what the app has.']);
await cal.setLocal(paper.id, { start: at(15, 9) }); taskOf(paper).dueWithTime = at(15, 14); paper.due = at(21, 9);
r = await cal.sync('timer');
assert.equal(state().links[paper.id].local.start, at(15, 14)); assert.equal(taskOf(paper).deadlineWithTime, at(21, 9), 'the field only Roamies changed still goes over');
assert.equal(r.lines.length, 1); assert.match(r.lines[0], /the start time changed both/);
await twice();

// ---- 7. identity is the task's id, never the title
const twinA = add('Call the lab'), twinB = add('Call the lab');
await cal.sync('timer');
assert.notEqual(state().links[twinA.id].task, state().links[twinB.id].task, 'two to-dos with one title: two tasks');
taskOf(twinA).title = 'Call the lab about the antibody'; taskOf(twinB).isDone = true;
await cal.sync('timer');
assert.equal(twinA.text, 'Call the lab about the antibody'); assert.equal(twinB.status, 'done'); assert.equal(list.filter((c) => c.text === 'Call the lab').length, 1);
// ---- done on both sides: the link is retired and no longer synced
assert.equal(state().links[twinB.id], undefined); assert.ok(state().retired[twinB.id]);
const twinBTask = state().retired[twinB.id];
app.tasks.get(twinBTask).title = 'changed after it was finished'; app.tasks.get(twinBTask).tagIds = ['EM_URGENT'];
mark = app.log.length; await cal.sync('timer');
assert.equal(twinB.text, 'Call the lab'); assert.deepEqual(writes(mark), []);
// done in Roamies: the task is marked done, then retired
twinA.status = 'done'; await cal.changed(twinA);
assert.equal(app.tasks.get(state().retired[twinA.id]).isDone, true); assert.equal(state().links[twinA.id], undefined);
// opened again in Roamies: the same task is taken up, not a new one
const size = app.tasks.size; twinA.status = 'open'; await cal.changed(twinA);
assert.equal(app.tasks.size, size); assert.equal(taskOf(twinA).isDone, false); assert.equal(state().retired[twinA.id], undefined);
// a finished to-do that Roamies has cleared away (midnight) leaves no link behind
list.splice(list.indexOf(twinB), 1); await cal.sync('timer'); assert.equal(state().retired[twinB.id], undefined);

// ---- 8. archived by the app counts as done; deleted there drops the link and asks once
assert.equal(cal.takeHeld().lines.length, 2, 'the two clashes above, held for a bubble');
const arch = add('Archive me'), gone = add('Delete me');
await cal.sync('timer');
const archTask = state().links[arch.id].task, goneTask = state().links[gone.id].task;
app.archived.set(archTask, { ...app.tasks.get(archTask), isDone: true }); app.tasks.delete(archTask); app.tasks.delete(goneTask);
mark = app.log.length; r = await cal.sync('timer');
assert.ok(app.log.slice(mark).some((q) => q.query === '?includeDone=true&source=archived'), 'the archive is looked in before a task counts as deleted');
assert.equal(arch.status, 'done'); assert.equal(state().retired[arch.id], archTask); assert.deepEqual(writes(mark), []);
assert.equal(state().links[gone.id], undefined); assert.equal(gone.status, 'open', 'the to-do is left alone until the owner answers');
assert.deepEqual(state().held, [{ ask: { todo: gone.id, title: 'Delete me' } }], 'a question, kept until it can be shown');
assert.deepEqual(cal.takeHeld(), { lines: [], asks: [{ todo: gone.id, title: 'Delete me' }], blocks: [] }); assert.deepEqual(state().held, []);
mark = app.log.length; await cal.sync('timer'); await cal.sync('tool');
assert.deepEqual(writes(mark), [], 'until the owner answers, the to-do gets no new task'); assert.deepEqual(cal.takeHeld(), { lines: [], asks: [], blocks: [] }, 'asked once');
// the owner keeps it: it is a to-do without a task, so it gets a new one
await cal.answered(gone.id); r = await cal.sync('timer'); assert.equal(taskOf(gone).title, 'Delete me'); assert.deepEqual(cal.takeHeld(), { lines: [], asks: [], blocks: [] });

// ---- 9. taken off Roamies' list: the time is cleared, the link dropped, the owner told; never a DELETE
await cal.setLocal(gone.id, { start: at(19, 10), minutes: 30 }); await cal.sync('timer');
const droppedTask = state().links[gone.id].task;
assert.equal(app.tasks.get(droppedTask).dueWithTime, at(19, 10)); assert.equal(app.tasks.get(droppedTask).remindAt, at(19, 10), '(the app\'s own reminder, as 20.0.0 adds it)');
gone.status = 'dropped'; mark = app.log.length;
await cal.changed(gone);
assert.deepEqual(writes(mark).map((w) => [w.method, w.path, w.body]), [['PATCH', `/tasks/${droppedTask}`, { dueWithTime: null }]]);
assert.ok(app.tasks.has(droppedTask), 'the task is still there'); assert.equal(state().links[gone.id], undefined);
assert.deepEqual(cal.takeHeld().lines, ['"Delete me" is off my list. Its task is still in Super Productivity, without a time: delete it there if you don\'t want it.']);
mark = app.log.length; await cal.sync('timer'); assert.deepEqual(writes(mark), [], 'and it is not made again');

// ---- 10. tasks Roamies didn't make: read for clashes only, never written, nothing else kept
const dentist = hand('Dentist', { dueWithTime: at(16, 9), timeEstimate: 60 * 60_000 });
mark = app.log.length; await cal.sync('timer');
assert.deepEqual(cal.others().find((o) => o.title === 'Dentist'), { title: 'Dentist', start: at(16, 9), minutes: 60, done: false }, 'title, start, length, done: nothing else');
assert.ok(cal.others().every((o) => Object.keys(o).join() === 'title,start,minutes,done'));
dentist.title = 'Dentist, moved'; dentist.isDone = true; await cal.sync('timer');
assert.ok(!list.some((c) => /Dentist/.test(c.text)), 'never imported'); assert.ok(!app.log.some((q) => q.path.includes(dentist.id)), 'never asked about by id, never written');

// ---- 11. the app closed, or hung: to-dos still work, and are brought in step afterwards
const wrapped = cal.wrap([{ name: 'remember_commitment', execute: async ({ text }) => { const c = add(text); return `Saved as ${c.id}.`; } }, { name: 'list_commitments', execute: async () => list.filter((c) => c.status === 'open').map((c) => c.text).join('; ') }, { name: 'draw', execute: async () => 'drawn' }]);
const tool = (n) => wrapped.find((t) => t.name === n);
app.hang = (m, p) => p === '/health';
let t0 = Date.now();
assert.match(await tool('remember_commitment').execute({ text: 'Made while the app was hung' }), /^Saved as c\d+\.$/);
let took = Date.now() - t0;
assert.ok(took >= 900 && took < 2500, `the check gives up within a second (${took} ms), whatever the request timeout is (${loadSettings(home).limits.calendarTimeoutSeconds} s)`);
r = await cal.sync('timer'); assert.equal(r.ok, false); assert.match(r.why, /^Super Productivity didn't answer within 1 second when asked to say that it is running\./);
await assert.rejects(cal.tools.find((t) => t.name === 'sync_todos').execute({}), /didn't answer within 1 second.*still works here/s);
app.hang = null;
const offline = list.find((c) => c.text === 'Made while the app was hung'); mail.text = 'Answer Ana today';
assert.equal(state().links[offline.id], undefined);
mark = app.log.length; await cal.sync('timer');
assert.equal(taskOf(offline).title, 'Made while the app was hung'); assert.equal(taskOf(mail).title, 'Answer Ana today', 'what changed meanwhile arrives on the next run');
// a to-do tool syncs first, so what the app changed is in before the list is read; other tools are left alone
taskOf(third).title = 'Book the big room';
assert.match(await tool('list_commitments').execute({}), /Book the big room/);
mark = app.log.length; assert.equal(await tool('draw').execute({}), 'drawn'); assert.equal(app.log.length, mark);
// from a tool, what a sync has to say goes to the model with the result, and is not held for a bubble
third.text = 'Book room A'; taskOf(third).title = 'Book room B';
const told = await tool('list_commitments').execute({});
assert.match(told, /Book room B[^]*\n\n"Book room B": the title changed both here and in Super Productivity\. I kept what the app has\.$/); assert.deepEqual(state().held, []);
// a slow answer to a real request ends the run without half-made changes being lost or repeated
app.hang = (m) => m === 'POST';
fs.writeFileSync(settingsFile, JSON.stringify({ ...file0, limits: { ...file0.limits, calendarTimeoutSeconds: 2 } }));
const slow = add('Made while the app was slow');
t0 = Date.now(); r = await cal.sync('timer'); took = Date.now() - t0;
assert.equal(r.ok, false); assert.ok(took >= 1900 && took < 4000, `the request timeout is the setting (${took} ms)`);
assert.deepEqual(state().intents.map((i) => [i.todo, i.title]), [[slow.id, 'Made while the app was slow']], 'the intent of a create that didn\'t finish stays on record');
fs.writeFileSync(settingsFile, settingsBytes);

// ---- 12. an intent left behind is reported once at the next start; the intent is written before the create
const next = make();
await next.startup();
assert.deepEqual(next.takeHeld().lines, ['I couldn\'t bring my to-do list and Super Productivity in step. Super Productivity didn\'t answer within 2 seconds when asked to make a task for "Made while the app was slow". Open Super Productivity, and check that Settings > Misc > Enable local REST API is on.', 'I was adding "Made while the app was slow" to Super Productivity when I last stopped. A stray task with that title may be in the app: delete it there if so.'], 'what failed, said as what it was, and the create that was cut short');
await next.startup(); assert.deepEqual(next.takeHeld().lines, [], 'once');
app.hang = null;
let seen = null; app.onPost = (body) => { seen = state().intents.map((i) => i.title).includes(body.title); };
await next.sync('timer'); app.onPost = null;
assert.equal(seen, true, 'on record before the request is made'); assert.deepEqual(state().intents, []); assert.ok(state().links[slow.id]);

// ---- 13. runs never overlap: two at once make one task
const race = add('Only one of me');
await Promise.all([cal.sync('timer'), cal.sync('timer'), cal.changed(race), cal.sync('tool'), cal.sync('timer')]);
assert.equal([...app.tasks.values()].filter((t) => t.title === 'Only one of me').length, 1);

// ---- 14. lines from a sync nobody asked for are held, kept in state.json, and shown only when nothing is going on
third.text = 'Book room C'; taskOf(third).title = 'Book room D';
r = await cal.sync('timer');
assert.equal(r.text, ''); assert.equal(state().held.length, 1); assert.ok(cal.hasHeld());
assert.match(make().takeHeld().lines[0], /Book room D/, 'kept across a restart'); assert.equal(cal.hasHeld(), false);
const calm = { ready: true, busy: false, queued: 0, asking: false, voice: 'idle', speakingUntil: 1000, now: 2000 };
assert.equal(quiet(calm), true);
for (const busyWith of [{ ready: false }, { busy: true }, { queued: 1 }, { asking: true }, { voice: 'listening' }, { voice: 'processing' }, { speakingUntil: 3000 }]) assert.equal(quiet({ ...calm, ...busyWith }), false, JSON.stringify(busyWith));
const side = fs.readFileSync(new URL('../sidekick.mjs', import.meta.url), 'utf8');
assert.match(side, /asking: pending\.size > 0 \|\| calAsking/, 'any bubble waiting for an answer (Send, a plan) counts');
const show = side.slice(side.indexOf('async function calShow()'), side.indexOf('tools.splice(0, tools.length'));
assert.ok(show.includes('if (!calQuiet()) return;') && show.includes('say(lines.join') && !show.includes('voiceLine') && !show.includes('enqueue'), 'shown in a bubble, never spoken');
assert.match(side, /if \(m\.type === 'voice_state'\) voiceState = /); assert.match(side, /lineUntil = Date\.now\(\) \+/);
assert.match(side, /cal\.sync\('briefing'\)/, 'a sync before each briefing'); assert.match(side, /loadSettings\(HOME\)\.calendar\.syncSeconds/, 'the timer follows the setting');
for (const hook of ["cal.changed(c); }, // Local-only build", 'cal.changed(after);', 'cal.changed(c); // Local-only build']) assert.ok(side.includes(hook), `a to-do changed in Roamies is told to the calendar: ${hook}`);


// ================= blocks =================
const T = (n) => cal.tools.find((t) => t.name === n);
const linkOf = (c) => state().links[c.id];
// ---- where a day plan puts things (the rule alone)
const M = 60_000, day0 = at(24, 0);
const P = (items, o) => placeDay(items, { from: at(24, 9), until: at(24, 18), ...o });
assert.deepEqual(P([{ k: 'a', minutes: 90 }, { k: 'b', minutes: 30 }]).placed.map((p) => [p.k, p.start]), [['a', at(24, 9)], ['b', at(24, 10, 30)]], 'back to back, in the order given');
assert.deepEqual(P([{ k: 'a', minutes: 90 }, { k: 'b', minutes: 30 }], { gap: 10 }).placed.map((p) => p.start), [at(24, 9), at(24, 10, 40)]);
const lunchBusy = { start: at(24, 12, 30), minutes: 60, gap: false };
assert.deepEqual(P([{ k: 'a', minutes: 180 }, { k: 'b', minutes: 60 }, { k: 'c', minutes: 30 }], { busy: [lunchBusy] }).placed.map((p) => p.start), [at(24, 9), at(24, 13, 30), at(24, 12)], 'lunch is kept free; a short one still fits before it');
assert.deepEqual(P([{ k: 'a', minutes: 60 }], { busy: [lunchBusy, { start: at(24, 9), minutes: 60 }], gap: 15 }).placed.map((p) => p.start), [at(24, 10, 15)], 'the gap also applies around what is already there, but not around lunch');
assert.deepEqual(P([{ k: 'a', minutes: 200 }, { k: 'b', minutes: 60 }], { busy: [{ start: at(24, 9, 30), minutes: 0 }] }).placed.map((p) => p.start), [at(24, 9, 31), at(24, 12, 51)], 'a task with a start and no length is a moment that is kept clear');
const tight = P([{ k: 'a', minutes: 300 }, { k: 'b', minutes: 300 }, { k: 'c', minutes: 60 }]);
assert.deepEqual([tight.placed.map((p) => p.k), tight.left.map((p) => p.k)], [['a', 'c'], ['b']], 'what doesn\'t fit is left out and named, the rest still placed');
assert.equal(day0 + 9 * 60 * M, at(24, 9));

// ---- before the first yes: block tools refuse, in plain words, and change nothing. With the app away, reading a
// day and planning one refuse (a single block is kept for later since 2026-11-18: see "kept blocks" below)
const home2 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-home2-')));
const unstarted = createCalendar({ home: home2, todos, port, tokenFile, ask: async () => null, now: () => clock });
mark = app.log.length;
for (const [name, args] of [['schedule_block', { todo: paper.id, date: '2026-11-23', start: '10:00', minutes: 60 }], ['move_block', { todo: paper.id, start: '11:00' }], ['unschedule_block', { todo: paper.id }], ['show_day', { date: '2026-11-23' }], ['plan_day', { date: '2026-11-23', items: [{ todo: paper.id, minutes: 30 }] }]]) {
  await assert.rejects(unstarted.tools.find((t) => t.name === name).execute(args), /isn't in Super Productivity yet.*nothing is added before their yes/is, name);
}
assert.deepEqual(writes(mark), []);
app.hang = (m, p) => p === '/health';
const stateBefore = JSON.stringify(state());
for (const [name, args, doing] of [['plan_day', { date: '2026-11-23', items: [{ todo: paper.id, minutes: 30 }] }, 'plan the day'], ['show_day', { date: '2026-11-23' }, 'read the calendar']]) {
  await assert.rejects(T(name).execute(args), new RegExp(`Error: Super Productivity didn't answer within 1 second when asked to say that it is running\\. .* So I can't ${doing}: I couldn't see what is already on the calendar\\.$`), name);
}
await assert.rejects(T('schedule_block').execute({ title: 'Something new', date: '2026-11-23', start: '10:00' }), /How long does it take\?/);
assert.equal(JSON.stringify(state()), stateBefore); assert.ok(!list.some((c) => c.text === 'Something new'), 'nothing is made for a request that can\'t be kept');
app.hang = null;

// ---- one block: a to-do, a day, a start, a length. It goes straight in.
const seminar = hand('Seminar', { dueWithTime: at(23, 10), timeEstimate: 60 * M });
mark = app.log.length; asked.length = 0;
let out = await T('schedule_block').execute({ todo: third.id, date: '2026-11-23', start: '14:00', minutes: 45 });
assert.match(out, /^"Book room D" is on the calendar Monday 23 November, 14:00 to 14:45\.$/);
assert.deepEqual(writes(mark).map((w) => [w.method, w.path, w.body]), [['PATCH', `/tasks/${linkOf(third).task}`, { dueWithTime: at(23, 14), timeEstimate: 45 * M }]]);
assert.equal(asked.length, 0, 'no question: a dictated block goes straight in');
// scheduling it again moves it: one block per to-do, the same task
mark = app.log.length;
out = await T('schedule_block').execute({ todo: third.id, date: '2026-11-23', start: '16:00' });
assert.match(out, /16:00 to 16:45 \(moved from where it was\)/, 'the length it had is kept');
assert.deepEqual(writes(mark).map((w) => [w.method, w.path, w.body]), [['PATCH', `/tasks/${linkOf(third).task}`, { dueWithTime: at(23, 16) }]]);
// a title that is something new: a to-do first (kind commitment), its task, then its block
mark = app.log.length; const before = list.length;
out = await T('schedule_block').execute({ title: 'Review Ines\'s draft @home', date: '2026-11-23', start: '22:00', minutes: 30 });
const review = list.at(-1);
assert.equal(list.length, before + 1); assert.deepEqual([review.text, review.kind, review.status], ['Review Ines\'s draft @home', 'commitment', 'open'], 'every block has a to-do behind it');
assert.match(out, new RegExp(`22:00 to 22:30, and on the to-do list as ${review.id}\\.$`), 'outside the working day is fine for a block they dictate');
assert.deepEqual(writes(mark).map((w) => [w.method, w.body]), [['POST', { title: 'Review Ines\'s draft @home', isIgnoreShortSyntax: true }], ['PATCH', { dueWithTime: at(23, 22), timeEstimate: 30 * M }]]);
assert.equal(app.tasks.get(linkOf(review).task).title, 'Review Ines\'s draft @home');
// what it needs
await assert.rejects(T('schedule_block').execute({ todo: paper.id, title: 'both', date: '2026-11-23', start: '10:00', minutes: 30 }), /either todo .* or title/);
await assert.rejects(T('schedule_block').execute({ date: '2026-11-23', start: '10:00', minutes: 30 }), /either todo .* or title/);
await assert.rejects(T('schedule_block').execute({ title: 'No length', date: '2026-11-23', start: '08:00' }), /How long does it take\?/);
await assert.rejects(T('schedule_block').execute({ todo: slow.id, date: '2026-11-23', start: '08:00' }), /How long does "Made while the app was slow" take\?/);
await assert.rejects(T('schedule_block').execute({ todo: paper.id, date: '23/11/2026', start: '10:00', minutes: 30 }), /YYYY-MM-DD/);
await assert.rejects(T('schedule_block').execute({ todo: paper.id, date: '2026-02-30', start: '10:00', minutes: 30 }), /YYYY-MM-DD/);
await assert.rejects(T('schedule_block').execute({ todo: paper.id, date: '2026-11-23', start: '25:00', minutes: 30 }), /HH:MM/);
await assert.rejects(T('schedule_block').execute({ todo: 'c-none', date: '2026-11-23', start: '10:00', minutes: 30 }), /no to-do c-none/);
await assert.rejects(T('schedule_block').execute({ todo: ping.id, date: '2026-11-23', start: '10:00', minutes: 30 }), /is a reminder, and reminders aren't put on the calendar/);
await assert.rejects(T('schedule_block').execute({ todo: arch.id, date: '2026-11-23', start: '10:00', minutes: 30 }), /already done/);
assert.ok(!list.some((c) => c.text === 'No length'));

// ---- a clash: the owner is shown what it overlaps and asked; without a yes nothing changes
answer = null; asked.length = 0; mark = app.log.length;
await assert.rejects(T('schedule_block').execute({ todo: slow.id, date: '2026-11-23', start: '10:30', minutes: 60 }), /It would overlap "Seminar" \(10:00 to 11:00\), and they didn't say to put it there anyway\. Nothing was changed\./);
assert.deepEqual(asked, ['"Made while the app was slow", 10:30 to 11:30 on Monday 23 November, overlaps "Seminar" (10:00 to 11:00). Put it there anyway?']);
assert.deepEqual(writes(mark), []); assert.equal(linkOf(slow).local.start, null);
await assert.rejects(T('schedule_block').execute({ todo: slow.id, date: '2026-11-23', start: '16:30', minutes: 60 }), /overlap "Book room D" \(16:00 to 16:45\)/, 'a clash with one of Roamies\' own blocks too');
answer = 'yes';
out = await T('schedule_block').execute({ todo: slow.id, date: '2026-11-23', start: '10:30', minutes: 60 });
assert.match(out, /10:30 to 11:30/); assert.equal(app.tasks.get(linkOf(slow).task).dueWithTime, at(23, 10, 30));
// back to back is not a clash, and a finished task of theirs takes no time
asked.length = 0; seminar.isDone = true;
await T('move_block').execute({ todo: slow.id, start: '11:00' }); await T('move_block').execute({ todo: slow.id, start: '10:15' });
assert.equal(asked.length, 0);
seminar.isDone = false;

// ---- move and unschedule
mark = app.log.length;
out = await T('move_block').execute({ todo: third.id, date: '2026-11-25' });
assert.match(out, /^"Book room D" is now Wednesday 25 November, 16:00 to 16:45\.$/, 'only the day changes');
out = await T('move_block').execute({ todo: third.id, start: '09:15', minutes: 20 });
assert.match(out, /Wednesday 25 November, 09:15 to 09:35/);
assert.deepEqual(writes(mark).map((w) => w.body), [{ dueWithTime: at(25, 16) }, { dueWithTime: at(25, 9, 15), timeEstimate: 20 * M }]);
await assert.rejects(T('move_block').execute({ todo: third.id }), /Say what changes/);
mark = app.log.length;
out = await T('unschedule_block').execute({ todo: third.id });
assert.equal(out, '"Book room D" is off the calendar. It is still on the to-do list.');
assert.deepEqual(writes(mark).map((w) => w.body), [{ dueWithTime: null }]); assert.equal(third.status, 'open'); assert.ok(app.tasks.has(linkOf(third).task));
assert.equal(linkOf(third).local.minutes, 20, 'the length is kept');
assert.equal(await T('unschedule_block').execute({ todo: third.id }), '"Book room D" has no block on the calendar.');
await assert.rejects(T('move_block').execute({ todo: third.id, start: '09:00' }), /has no block to move/);

// ---- ticking a to-do marks its block's task done
const reviewTask = linkOf(review).task; review.status = 'done'; await cal.changed(review);
assert.equal(app.tasks.get(reviewTask).isDone, true); assert.equal(app.tasks.get(reviewTask).dueWithTime, at(23, 22), 'its time stays where it was');

// ---- a day read back: Roamies' blocks with their to-dos; other tasks only as taken time
out = await T('show_day').execute({ date: '2026-11-23' });
assert.equal(out, `Monday 23 November:\n10:00 to 11:00: taken by a task of their own in Super Productivity\n10:15 to 11:15 (60 min): Made while the app was slow [${slow.id}]`);
assert.ok(!out.includes('Seminar'), 'what another task is called is used for clashes only');
assert.equal(await T('show_day').execute({ date: '2026-11-29' }), 'Nothing is on the calendar Sunday 29 November.');

// ---- a whole day: worked out by the code, shown whole, created only after a yes
const p1 = add('Plan: figures'), p2 = add('Plan: methods'), p3 = add('Plan: email'), p4 = add('Plan: too long');
hand('Group meeting', { dueWithTime: at(24, 10), timeEstimate: 60 * M });
await cal.sync('timer');
const items = [{ todo: p1.id, minutes: 120 }, { todo: p2.id, minutes: 150 }, { todo: p3.id, minutes: 30 }, { todo: p4.id, minutes: 400 }];
answer = null; asked.length = 0; mark = app.log.length;
await assert.rejects(T('plan_day').execute({ date: '2026-11-24', items }), /didn't say yes to the plan, so nothing was put on the calendar/);
assert.deepEqual(asked, ['Plan for Tuesday 24 November:\n13:30 to 15:30  Plan: figures\n15:30 to 18:00  Plan: methods\n09:00 to 09:30  Plan: email\nNo room for: Plan: too long'], 'lunch free, the meeting kept clear, back to back, and what doesn\'t fit is named');
assert.deepEqual(writes(mark), []); assert.equal(linkOf(p1).local.start, null);
answer = 'yes'; mark = app.log.length;
out = await T('plan_day').execute({ date: '2026-11-24', items });
assert.match(out, /^On the calendar Tuesday 24 November: 13:30 to 15:30 "Plan: figures"; 15:30 to 18:00 "Plan: methods"; 09:00 to 09:30 "Plan: email"\. No room for: "Plan: too long"\.$/);
assert.deepEqual(writes(mark).map((w) => w.body), [{ dueWithTime: at(24, 13, 30), timeEstimate: 120 * M }, { dueWithTime: at(24, 15, 30), timeEstimate: 150 * M }, { dueWithTime: at(24, 9), timeEstimate: 30 * M }]);
assert.equal(linkOf(p4).local.start, null);
// planned again, the same to-dos are moved, not doubled, and the day can be stretched for this one plan
mark = app.log.length;
out = await T('plan_day').execute({ date: '2026-11-24', items: [{ todo: p4.id, minutes: 180 }, { todo: p1.id }], from: '08:00', until: '21:00' });
assert.match(out, /18:00 to 21:00 "Plan: too long"; 13:30 to 15:30 "Plan: figures"\.$/);
assert.deepEqual([linkOf(p4).local.start, linkOf(p1).local.start], [at(24, 18), at(24, 13, 30)], 'around the meeting, lunch and the blocks that stay; until 21:00 this once; a length it already has is used');
assert.equal(writes(mark).filter((w) => w.method === 'POST').length, 0);
assert.equal(loadSettings(home).calendar.dayEnd, 1080, 'the setting itself is as it was');
// no lunch break, and a gap, when the settings say so
fs.writeFileSync(settingsFile, JSON.stringify({ ...file0, calendar: { ...file0.calendar, lunch: [], gapMinutes: 10 } }));
const q1 = add('Plan: a'), q2 = add('Plan: b'); await cal.sync('timer');
await T('plan_day').execute({ date: '2026-11-26', items: [{ todo: q1.id, minutes: 200 }, { todo: q2.id, minutes: 60 }] });
assert.deepEqual([linkOf(q1).local.start, linkOf(q2).local.start], [at(26, 9), at(26, 12, 30)], 'straight through what would be lunch, ten minutes apart');
fs.writeFileSync(settingsFile, settingsBytes);
// today, a plan starts from now
clock = at(14, 15, 2);
await T('plan_day').execute({ date: '2026-11-14', items: [{ todo: q2.id }] });
assert.equal(linkOf(q2).local.start, at(14, 15, 5), 'the next five minutes, not a time already gone');
clock = at(14, 8);
await assert.rejects(T('plan_day').execute({ date: '2026-11-27', items: [{ todo: q1.id }, { todo: q1.id }] }), /once: it has one block/);
await assert.rejects(T('plan_day').execute({ date: '2026-11-27', items: [{ todo: p3.id, minutes: 30 }], from: '19:00' }), /from before until/);
await assert.rejects(T('plan_day').execute({ date: '2026-11-27', items: [{ todo: twinA.id }] }), /How long does "Call the lab about the antibody" take\?/);
await assert.rejects(T('plan_day').execute({ date: '2026-11-27', items: [{ todo: p3.id, minutes: 30 }], from: '17:50' }), /Nothing fits Friday 27 November between 17:50 and 18:00/);

// ---- the morning briefing's note: today's blocks, and how much time other tasks take
hand('Lab meeting', { dueWithTime: at(14, 11), timeEstimate: 30 * M }); await cal.sync('timer');
assert.equal(cal.dayNote(new Date(at(14, 8))), '\nOn the calendar in Super Productivity today: 15:05 to 16:05 "Plan: b"; and 1 other stretch of time taken by tasks of their own there (11:00 to 11:30). Say it in a sentence or two.');
assert.equal(cal.dayNote(new Date(at(30, 8))), '\nNothing is on the calendar in Super Productivity today.');
assert.equal(unstarted.dayNote(new Date(at(14, 8))), '', 'nothing is said about a calendar that isn\'t known');
assert.match(side, /b\.kind === 'morning' \? `\$\{b\.note\}\$\{cal\.dayNote\(\)\}` : b\.note/);
// they work while pi is busy, like the to-do list
for (const n of ['schedule_block', 'move_block', 'unschedule_block', 'show_day', 'plan_day', 'sync_todos']) assert.ok(codeReference().tools.allowedWhilePiWorks.includes(n), n);

// ================= the Eisenhower matrix =================
const tagsOf = (c) => app.tasks.get(linkOf(c).task).tagIds;
cal.takeHeld();
// ---- said by voice: only what was said changes, and the task's other tags stay
const m1 = add('Matrix: grant report'), m2 = add('Matrix: tidy desk'), m3 = add('Matrix: reply to editor'), m4 = add('Matrix: order tips'), m5 = add('Matrix: call bank');
await cal.sync('timer');
app.tasks.get(linkOf(m1).task).tagIds = ['PERSONAL'];
await cal.setLocal(m1.id, { start: at(27, 9), minutes: 60 }); await cal.sync('timer'); // on the calendar already
mark = app.log.length;
out = await T('set_priority').execute({ todo: m1.id, urgent: true, important: true });
assert.equal(out, '"Matrix: grant report": urgent and important.');
assert.deepEqual(writes(mark).map((w) => w.body), [{ tagIds: ['PERSONAL', 'EM_URGENT', 'EM_IMPORTANT'] }]);
out = await T('set_priority').execute({ todo: m1.id, urgent: false });
assert.equal(out, '"Matrix: grant report": important, not urgent.'); assert.deepEqual(tagsOf(m1), ['PERSONAL', 'EM_IMPORTANT'], 'important stays as it was');
await assert.rejects(T('set_priority').execute({ todo: m1.id }), /Say which/);
await assert.rejects(T('set_priority').execute({ todo: ping.id, urgent: true }), /is a reminder/);
await assert.rejects(unstarted.tools.find((t) => t.name === 'set_priority').execute({ todo: m1.id, urgent: true }), /isn't in Super Productivity yet, and urgent and important are kept with each to-do's task there/);
// ---- set in the app: the flags follow, both ways round
tagsOf(m2).push('EM_URGENT'); await cal.sync('timer');
assert.deepEqual([linkOf(m2).local.urgent, linkOf(m2).local.important], [true, false]);
app.tasks.get(linkOf(m2).task).tagIds = []; await cal.sync('timer');
assert.deepEqual([linkOf(m2).local.urgent, linkOf(m2).local.important], [false, false]);

// ---- the matrix read back: four quadrants, and what isn't sorted yet
await T('set_priority').execute({ todo: m5.id, urgent: true });
out = await T('show_matrix').execute({});
const rows = out.split('\n');
assert.equal(rows.length, 5);
assert.equal(rows[0], `Urgent and important: Answer Ana today [${mail.id}] (on the calendar)`, '(made so in the app, earlier)');
assert.equal(rows[1], `Important, not urgent: Matrix: grant report [${m1.id}] (on the calendar)`);
assert.equal(rows[2], `Urgent, not important: Matrix: call bank [${m5.id}]`);
assert.match(rows[3], new RegExp(`^Neither urgent nor important: .*Matrix: tidy desk \\[${m2.id}\\]`), 'cleared in the app: it has had its place, so it is "neither", not unsorted');
assert.match(rows[4], /^Not sorted yet: /); assert.ok(rows[4].includes(`Matrix: reply to editor [${m3.id}]`) && rows[4].includes(`Matrix: order tips [${m4.id}]`) && !rows[4].includes('Matrix: tidy desk') && !rows[4].includes('Matrix: call bank'));
assert.ok(!out.includes('Stretch') && !out.includes('Seminar'), 'reminders and tasks that aren\'t Roamies\' have no place in it');

// ---- sort_tasks: a proposal for the unsorted ones, shown whole, applied only after a yes
const proposals = [{ todo: m3.id, urgent: true, important: true }, { todo: m4.id, urgent: false, important: false }];
answer = null; asked.length = 0; mark = app.log.length;
await assert.rejects(T('sort_tasks').execute({ proposals }), /didn't say yes to the proposal, so nothing was sorted/);
assert.deepEqual(asked, ['Sort these to-dos like this?\nUrgent and important: Matrix: reply to editor\nNeither urgent nor important: Matrix: order tips']);
assert.deepEqual(writes(mark), []); assert.deepEqual([linkOf(m3).local.urgent, linkOf(m3).sorted ?? false, linkOf(m4).sorted ?? false], [false, false, false]);
await assert.rejects(T('sort_tasks').execute({ proposals: [...proposals, { todo: m1.id, urgent: true, important: true }] }), /"Matrix: grant report" already has its place \(important, not urgent\)/);
await assert.rejects(T('sort_tasks').execute({ proposals: [proposals[0], proposals[0]] }), /Each to-do once/);
await assert.rejects(T('sort_tasks').execute({ proposals: [{ todo: ping.id, urgent: true, important: true }] }), /is a reminder/);
assert.deepEqual(writes(mark), []);
answer = 'yes'; mark = app.log.length;
out = await T('sort_tasks').execute({ proposals });
assert.deepEqual(writes(mark).map((w) => w.body), [{ tagIds: ['EM_URGENT', 'EM_IMPORTANT'] }], 'all of it, and "neither" needs no tag');
assert.deepEqual([linkOf(m3).local.urgent, linkOf(m3).local.important, linkOf(m4).sorted], [true, true, true]);
// ---- urgent and important, with no block: one is offered, once
assert.equal(out, 'Sorted 2 to-dos.\n"Matrix: reply to editor" is urgent and important, and isn\'t on the calendar. Shall I put a block for it there?');
out = await T('show_matrix').execute({});
assert.ok(!/Shall I put a block/.test(out), 'not offered a second time'); assert.match(out.split('\n')[0], /^Urgent and important: .*Matrix: reply to editor \[c\d+\]$/); assert.ok(!out.split('\n')[4].includes('Matrix:'), 'none of them is unsorted now');
await cal.sync('timer'); await T('set_priority').execute({ todo: m3.id, urgent: false }); out = await T('set_priority').execute({ todo: m3.id, urgent: true });
assert.equal(out, '"Matrix: reply to editor": urgent and important.', 'nor when it becomes urgent and important again');
out = await T('set_priority').execute({ todo: m1.id, urgent: true });
assert.equal(out, '"Matrix: grant report": urgent and important.', 'one that has a block is offered none');
// made urgent and important in the app, with nobody asking: the offer waits for a quiet moment, in a bubble
app.tasks.get(linkOf(m5).task).tagIds = ['EM_URGENT', 'EM_IMPORTANT']; await cal.sync('timer'); await cal.sync('timer');
assert.deepEqual(cal.takeHeld().lines, ['"Matrix: call bank" is urgent and important, and isn\'t on the calendar. Shall I put a block for it there?']);
// ---- with the app away, what is said is kept here and goes over at the next sync
app.hang = (m, p) => p === '/health'; mark = app.log.length;
out = await T('set_priority').execute({ todo: m4.id, important: true });
assert.equal(out, '"Matrix: order tips": important, not urgent.\nSuper Productivity stopped answering before this reached it: it is saved here and goes over at the next sync.');
assert.deepEqual(writes(mark), []);
app.hang = null; await cal.sync('timer');
assert.deepEqual(tagsOf(m4), ['EM_IMPORTANT']);
// ---- kept blocks (2026-11-18; before it these were refused): a block asked for while the app can't be reached is
// kept in state.json, and placed by the first sync that reaches the app
{
  // the app closed: nothing listens on the port (a second calendar over the same files, as after a restart)
  const logK = [];
  const closed = createCalendar({ home, todos, port: 1, tokenFile, now: () => clock, ask: async (o) => { asked.push(o.placeholder); return answer; }, log: (kind, data) => logK.push({ kind, data }) });
  const C = (n) => closed.tools.find((t) => t.name === n);
  const D = (d, h, m = 0) => new Date(2026, 11, d, h, m).getTime(); // December: clear of everything above
  const NOT_BOOKED = /^NOT on the calendar yet: Super Productivity isn't answering/, NEVER = /is on the calendar (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|now)|is now (Mon|Tue|Wed|Thu|Fri|Sat|Sun)|\bbooked\b(?! when)|moved from/;
  const says = (out) => { assert.match(out, NOT_BOOKED); assert.match(out, /the task is saved, and the slot will be booked when Super Productivity is open\. Don't say it is added to the calendar, booked, scheduled or moved/); assert.doesNotMatch(out.split(' Tell them exactly that')[0], NEVER, 'what was done is said as what it is'); };
  const ka = add('Kept: a'), kb = add('Kept: b'), km = add('Kept: mover'); await cal.sync('timer');
  await T('schedule_block').execute({ todo: km.id, date: '2026-12-04', start: '16:00', minutes: 45 });
  cal.takeHeld(); mark = app.log.length; const listBefore = list.length; asked.length = 0;
  // something new: the to-do is made now (it works without the app), the slot is kept, and it is said as that
  out = await C('schedule_block').execute({ title: 'Kept: flow test', date: '2026-12-03', start: '10:00', minutes: 30 });
  const flowTest = list.at(-1);
  assert.equal(list.length, listBefore + 1); assert.deepEqual([flowTest.text, flowTest.kind, flowTest.status], ['Kept: flow test', 'commitment', 'open']);
  says(out); assert.match(out, new RegExp(`"Kept: flow test" is saved on the to-do list as ${flowTest.id}, and its slot, Thursday 3 December, 10:00 to 10:30, is kept\\.`));
  // a to-do there already; and a move, which starts from the block as it is known here
  out = await C('schedule_block').execute({ todo: ka.id, date: '2026-12-03', start: '10:15', minutes: 30 });
  says(out); assert.match(out, /"Kept: a" is on the to-do list, and its slot, Thursday 3 December, 10:15 to 10:45, is kept\./);
  out = await C('move_block').execute({ todo: km.id, start: '17:00' });
  says(out); assert.match(out, /its slot, Friday 4 December, 17:00 to 17:45, is kept/);
  // the same to-do asked for again takes the first one's place: one kept block for a to-do
  out = await C('move_block').execute({ todo: km.id, start: '17:30', minutes: 20 });
  assert.match(out, /Friday 4 December, 17:30 to 17:50, is kept/, 'from the slot already kept: the day stays');
  assert.deepEqual(state().actions.map((a) => [a.todo, a.title, a.start, a.minutes]), [[flowTest.id, 'Kept: flow test', D(3, 10), 30], [ka.id, 'Kept: a', D(3, 10, 15), 30], [km.id, 'Kept: mover', D(4, 17, 30), 20]]);
  assert.ok(state().actions.every((a) => a.at === new Date(clock).toISOString() && typeof a.id === 'string'));
  assert.deepEqual(writes(mark), []); assert.equal(linkOf(flowTest), undefined); assert.equal(linkOf(km).local.start, D(4, 16), 'nothing has moved yet');
  // what can be checked without the app still is; a day plan is not kept: it needs the whole day in view
  await assert.rejects(C('schedule_block').execute({ todo: kb.id, date: '2026-12-03', start: '12:00' }), /How long does "Kept: b" take\?/);
  await assert.rejects(C('schedule_block').execute({ todo: ping.id, date: '2026-12-03', start: '12:00', minutes: 30 }), /is a reminder/);
  await assert.rejects(C('schedule_block').execute({ todo: 'c-none', date: '2026-12-03', start: '12:00', minutes: 30 }), /no to-do c-none/);
  await assert.rejects(C('move_block').execute({ todo: kb.id, start: '12:00' }), /"Kept: b" has no block to move/);
  await assert.rejects(C('schedule_block').execute({ title: 'Kept: too late', date: '2026-11-14', start: '07:00', minutes: 30 }), /Saturday 14 November, 07:00 to 07:30 has already passed, so there is nothing to keep for later\. Nothing was put on the calendar\./);
  assert.ok(!list.some((c) => c.text === 'Kept: too late'));
  await assert.rejects(C('plan_day').execute({ date: '2026-12-03', items: [{ todo: kb.id, minutes: 30 }] }), /^Error: Nothing is listening on port 1: Super Productivity is closed, or its local REST API is off\. .* So I can't plan the day: I couldn't see what is already on the calendar\.$/);
  await assert.rejects(C('show_day').execute({ date: '2026-12-03' }), /So I can't read the calendar/);
  assert.equal(state().actions.length, 3);
  // they are listed for show_pending and the morning briefing, and the model's live state says they are not booked
  assert.deepEqual(closed.kept().map((k) => k.brief), ['Put "Kept: flow test" on the calendar Thursday 3 December, 10:00 to 10:30', 'Put "Kept: a" on the calendar Thursday 3 December, 10:15 to 10:45', 'Put "Kept: mover" on the calendar Friday 4 December, 17:30 to 17:50']);
  assert.match(closed.live(), /\n- Not on the calendar yet, kept until Super Productivity is open \(the app places them itself then; don't say they are booked\): "Kept: flow test", Thursday 3 December, 10:00 to 10:30; /);
  assert.doesNotMatch(cal.live().split('\n')[0], /Not on the calendar yet/);
  // a sync that doesn't reach the app changes nothing
  r = await closed.sync('timer'); assert.equal(r.ok, false); assert.equal(state().actions.length, 3); assert.deepEqual(writes(mark), []);

  // the app is open again: the first sync mirrors the new to-do, places what is free, and sends it over
  r = await cal.sync('timer'); assert.equal(r.ok, true);
  assert.deepEqual(writes(mark).map((w) => [w.method, w.body]), [
    ['POST', { title: 'Kept: flow test', isIgnoreShortSyntax: true }],
    ['PATCH', { dueWithTime: D(4, 17, 30), timeEstimate: 20 * M }],
    ['PATCH', { dueWithTime: D(3, 10), timeEstimate: 30 * M }],
  ], 'the to-do made while the app was closed is mirrored, then its block and the move go over');
  assert.deepEqual([taskOf(flowTest).title, taskOf(flowTest).dueWithTime, taskOf(flowTest).timeEstimate], ['Kept: flow test', D(3, 10), 30 * M]);
  assert.equal(taskOf(km).dueWithTime, D(4, 17, 30)); assert.equal(linkOf(ka).local.start, null, 'the one that would overlap is not placed');
  assert.deepEqual(state().actions, [], 'placed or handed over: none is left to run again');
  let held = cal.takeHeld();
  assert.deepEqual(held.lines, ['"Kept: flow test" is on the calendar now, Thursday 3 December, 10:00 to 10:30: the slot I kept while Super Productivity was closed.', '"Kept: mover" is on the calendar now, Friday 4 December, 17:30 to 17:50: the slot I kept while Super Productivity was closed.']);
  assert.deepEqual(held.blocks.map((b) => [b.todo, b.title, b.start, b.minutes]), [[ka.id, 'Kept: a', D(3, 10, 15), 30]], 'a clash becomes the usual question');
  // never twice: the next runs write nothing and say nothing
  mark = app.log.length; await cal.sync('timer'); await cal.sync('tool'); await make().sync('start');
  assert.deepEqual(writes(mark), []); assert.deepEqual(cal.takeHeld(), { lines: [], asks: [], blocks: [] });
  // the clash: asked as an overlap is; a no leaves it off, a yes places it
  answer = null; asked.length = 0;
  assert.equal(await cal.placeKept(held.blocks[0]), ''); assert.equal(linkOf(ka).local.start, null); assert.deepEqual(writes(mark), []);
  assert.deepEqual(asked, ['"Kept: a", 10:15 to 10:45 on Thursday 3 December, overlaps "Kept: flow test" (10:00 to 10:30). Put it there anyway?']);
  answer = 'yes';
  assert.equal(await cal.placeKept(held.blocks[0]), '"Kept: a" is on the calendar Thursday 3 December, 10:15 to 10:45.'); await cal.sync('timer');
  assert.equal(taskOf(ka).dueWithTime, D(3, 10, 15));
  assert.equal(await cal.placeKept(held.blocks[0]), '', 'asked for again when it is there already: nothing'); 
  // ...and if the app has gone again when the question's turn comes, the block is kept again, as old as it was
  await cal.setLocal(ka.id, { start: null }); await cal.sync('timer');
  assert.equal(await closed.placeKept(held.blocks[0]), ''); assert.deepEqual(state().actions.map((a) => [a.todo, a.at, a.start]), [[ka.id, held.blocks[0].at, D(3, 10, 15)]]);
  // its block settled another way meanwhile (here: taken off the calendar): the kept slot is not placed as well
  out = await C('unschedule_block').execute({ todo: ka.id });
  assert.equal(out, 'The slot kept for "Kept: a" is dropped: it won\'t be put on the calendar. It is still on the to-do list.'); assert.deepEqual(state().actions, []);
  await C('schedule_block').execute({ todo: ka.id, date: '2026-12-05', start: '09:00', minutes: 30 }); assert.equal(state().actions.length, 1);
  await cal.setLocal(ka.id, { start: D(5, 11), minutes: 30 }); assert.deepEqual(state().actions, [], 'a block set meanwhile takes the kept one\'s place');
  await cal.setLocal(ka.id, { start: null }); await cal.sync('timer'); cal.takeHeld();

  // a to-do that is done or gone by the time the app is back: dropped without a word
  await C('schedule_block').execute({ todo: kb.id, date: '2026-12-05', start: '09:00', minutes: 30 });
  kb.status = 'done'; mark = app.log.length;
  await cal.sync('timer');
  assert.deepEqual(state().actions, []); assert.deepEqual(cal.takeHeld().lines, []); assert.ok(!writes(mark).some((w) => 'dueWithTime' in (w.body ?? {})));
  // its time has passed before the app was back: dropped, and said once, even while the app is still closed
  const clock0 = clock;
  await C('schedule_block').execute({ todo: ka.id, date: '2026-11-14', start: '09:00', minutes: 30 });
  clock = at(14, 9, 29); await closed.sync('timer'); assert.equal(state().actions.length, 1, 'still running: kept');
  clock = at(14, 9, 30); await closed.sync('timer');
  assert.deepEqual(state().actions, []);
  assert.deepEqual(closed.takeHeld().lines, ['I had kept a slot for "Kept: a", Saturday 14 November, 09:00 to 09:30, until Super Productivity was open. That time has passed, so it isn\'t on the calendar.']);
  mark = app.log.length; await closed.sync('timer'); await cal.sync('timer');
  assert.deepEqual(cal.takeHeld().lines, [], 'once'); assert.deepEqual(writes(mark), []); assert.equal(linkOf(ka).local.start, null);
  // older than limits.pendingKeepHours (24): dropped, and said once
  await C('schedule_block').execute({ todo: ka.id, date: '2026-12-09', start: '09:00', minutes: 30 });
  clock += 24 * 3600_000; await closed.sync('timer'); assert.equal(state().actions.length, 1);
  clock += 1; r = await cal.sync('tool');
  assert.deepEqual(state().actions, []); assert.equal(linkOf(ka).local.start, null);
  assert.match(r.text, /^I had kept a slot for "Kept: a", Wednesday 9 December, 09:00 to 09:30, until Super Productivity was open\. That was more than 24 hours ago, so it isn't on the calendar\.$/);
  clock = clock0;
  assert.ok(logK.some((l) => l.kind === 'calendar_kept' && l.data.what === 'place') && logK.some((l) => l.data.what === 'move') && !JSON.stringify(logK).includes('Kept:'), 'logged by what it was, without the titles');
  for (const c of [ka, km, flowTest]) c.status = 'done';
  await cal.sync('timer'); await cal.sync('timer'); cal.takeHeld();
}

// ---- a day and two times, as they were said: the date of a weekday and the length are worked out here, by code
{
  const ymd = (d) => d && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const wed = new Date(2026, 10, 18, 22, 16).getTime(); // when "book a slot on Friday from 10 to 11" was said
  assert.equal(ymd(dayFrom('friday', wed)), '2026-11-20'); assert.equal(minutesBetween('10:00', '11:00'), 60);
  for (const [said, date] of [['Friday', '2026-11-20'], ['on friday', '2026-11-20'], ['this Friday', '2026-11-20'], ['fri', '2026-11-20'], ['today', '2026-11-18'], ['tomorrow', '2026-11-19'], ['wednesday', '2026-11-18'], ['thursday', '2026-11-19'], ['tuesday', '2026-11-24'], ['sunday', '2026-11-22'], ['2026-12-01', '2026-12-01']]) assert.equal(ymd(dayFrom(said, wed)), date, said);
  assert.equal(ymd(dayFrom('wednesday', wed, () => true)), '2026-11-25', 'today\'s own name, when the time has passed today: a week on');
  assert.equal(ymd(dayFrom('friday', new Date(2026, 11, 30, 9).getTime())), '2027-01-01', 'over the end of a year');
  for (const bad of ['next friday', 'someday', '20/11/2026', '2026-02-30', '', 'fr']) assert.equal(dayFrom(bad, wed), null, bad);
  for (const [a, b, m] of [['09:00', '10:00', 60], ['10:00', '13:00', 180], ['14:00', '16:30', 150], ['17:00', '17:30', 30], ['9:05', '9:10', 5], ['08:00', '20:00', 720]]) assert.equal(minutesBetween(a, b), m);
  assert.throws(() => minutesBetween('10:00', '10:00'), /The end \(10:00\) isn't after the start \(10:00\)/); assert.throws(() => minutesBetween('10:00', '1:00'), /24-hour clock: one in the afternoon is 13:00/);
  assert.throws(() => minutesBetween('10:00', 'eleven'), /The end has to be a time, HH:MM\./); assert.throws(() => minutesBetween('ten', '11:00'), /The start has to be a time/);
  assert.throws(() => minutesBetween('00:00', '23:00'), /between 5 minutes and 12 hours/); assert.throws(() => minutesBetween('10:00', '10:03'), /between 5 minutes and 12 hours/);

  // through the tools (the clock here is Saturday 14 November 2026, 08:00)
  mark = app.log.length; answer = null; asked.length = 0;
  out = await T('schedule_block').execute({ title: 'Named: experiment', date: 'friday', start: '10:00', end: '11:00' });
  const named = list.at(-1);
  assert.match(out, new RegExp(`^"Named: experiment" is on the calendar Friday 20 November, 10:00 to 11:00, and on the to-do list as ${named.id}\\.$`));
  assert.deepEqual(writes(mark).map((w) => [w.method, w.body]), [['POST', { title: 'Named: experiment', isIgnoreShortSyntax: true }], ['PATCH', { dueWithTime: at(20, 10), timeEstimate: 60 * M }]]);
  await assert.rejects(T('schedule_block').execute({ todo: named.id, date: 'friday', start: '10:00', end: '11:00', minutes: 60 }), /Give end or minutes, not both/);
  await assert.rejects(T('schedule_block').execute({ todo: named.id, date: 'friday', start: '11:00', end: '10:00' }), /isn't after the start/);
  await assert.rejects(T('schedule_block').execute({ todo: named.id, date: 'next friday', start: '10:00', end: '11:00' }), /^Error: The date has to be a weekday \("friday"\), "today", "tomorrow", or YYYY-MM-DD\.$/);
  assert.equal(linkOf(named).local.start, at(20, 10));
  // today's own name: today while the block isn't over, the same day next week once it is
  out = await T('schedule_block').execute({ todo: named.id, date: 'saturday', start: '07:00', end: '07:30' });
  assert.match(out, /Saturday 21 November, 07:00 to 07:30 \(moved from where it was\)/);
  out = await T('schedule_block').execute({ todo: named.id, date: 'Saturday', start: '07:45', end: '08:15' });
  assert.match(out, /Saturday 14 November, 07:45 to 08:15/, 'still running: today');
  // a move: an end alone changes the length, a day word the day
  out = await T('move_block').execute({ todo: named.id, date: 'tomorrow', end: '09:00' });
  assert.equal(out, '"Named: experiment" is now Sunday 15 November, 07:45 to 09:00.'); assert.deepEqual([linkOf(named).local.start, linkOf(named).local.minutes], [at(15, 7, 45), 75]);
  await assert.rejects(T('move_block').execute({ todo: named.id, end: '09:30', minutes: 30 }), /Give end or minutes, not both/);
  await assert.rejects(T('move_block').execute({ todo: named.id }), /Say what changes: date, start, end or minutes\./);
  assert.match(await T('show_day').execute({ date: 'sunday' }), /^Sunday 15 November:\n07:45 to 09:00 \(75 min\): Named: experiment/);
  asked.length = 0;
  await assert.rejects(T('plan_day').execute({ date: 'monday', items: [{ todo: named.id, minutes: 30 }] }), /didn't say yes to the plan/);
  assert.match(asked[0], /^Plan for Monday 16 November:\n09:00 to 09:30 {2}Named: experiment$/);
  // the model is told to pass the day and the two times as they were said, and to say what the result says
  for (const n of ['schedule_block', 'move_block']) { assert.match(T(n).description, /Never work out the date of a weekday yourself\./); assert.match(T(n).description, /give start and end \(HH:MM, 24-hour\) and no minutes: the app works out the length/); assert.match(T(n).description, /say what the result says, never that it is (booked|moved)/); }
  assert.match(cal.live(), /"on the calendar", "booked" or "scheduled" only when the result says it is on the calendar; when it says the slot is kept until Super Productivity is open, say the task is saved and the slot will be booked when Super Productivity is open\./);

  // what was asked on 18 November with the app closed, said the way it was: saved and kept, then caught up
  const closed = createCalendar({ home, todos, port: 1, tokenFile, now: () => clock, ask: async () => null });
  mark = app.log.length;
  out = await closed.tools.find((t) => t.name === 'schedule_block').execute({ title: 'Named: experiment part I', date: 'friday', start: '10:00', end: '11:00' });
  const partOne = list.at(-1);
  assert.match(out, new RegExp(`^NOT on the calendar yet: .* "Named: experiment part I" is saved on the to-do list as ${partOne.id}, and its slot, Friday 20 November, 10:00 to 11:00, is kept\\. .*the task is saved, and the slot will be booked when Super Productivity is open\\.`));
  assert.doesNotMatch(out, /is on the calendar Friday|\badded\b(?! to the calendar, booked)|\bscheduled\b(?! or moved)/);
  // a to-do made the ordinary way while the app is closed, too
  const offTools = closed.wrap([{ name: 'remember_commitment', execute: async ({ text }) => { const c = add(text); return `Saved as ${c.id}.`; } }]);
  assert.match(await offTools[0].execute({ text: 'Named: made while closed' }), /^Saved as c\d+\.$/);
  const whileClosed = list.at(-1);
  assert.deepEqual(writes(mark), []); assert.equal(linkOf(partOne), undefined); assert.equal(linkOf(whileClosed), undefined);
  // the first sync after the app is open: both to-dos become tasks, and the block is on the calendar
  await cal.sync('timer');
  assert.deepEqual(writes(mark).map((w) => [w.method, w.body]), [['POST', { title: 'Named: experiment part I', isIgnoreShortSyntax: true }], ['POST', { title: 'Named: made while closed', isIgnoreShortSyntax: true }], ['PATCH', { dueWithTime: at(20, 10), timeEstimate: 60 * M }]]);
  assert.deepEqual([taskOf(partOne).title, taskOf(partOne).dueWithTime, taskOf(partOne).timeEstimate], ['Named: experiment part I', at(20, 10), 60 * M]); assert.equal(taskOf(whileClosed).title, 'Named: made while closed');
  assert.deepEqual(cal.takeHeld().lines, ['"Named: experiment part I" is on the calendar now, Friday 20 November, 10:00 to 11:00: the slot I kept while Super Productivity was closed.']);
  for (const c of [named, partOne, whileClosed]) c.status = 'done';
  await cal.sync('timer'); await cal.sync('timer'); cal.takeHeld();
}

// ---- over everything so far: the only tags Roamies ever adds are the two matrix tags
for (const w of writes().filter((q) => q.body && 'tagIds' in q.body)) assert.ok(w.body.tagIds.every((id) => ['EM_URGENT', 'EM_IMPORTANT', 'PERSONAL', 'KANBAN_IN_PROGRESS'].includes(id)), JSON.stringify(w.body));
for (const n of ['set_priority', 'sort_tasks', 'show_matrix']) assert.ok(codeReference().tools.allowedWhilePiWorks.includes(n), n);

// ---- 14b. a sync that fails says what failed, in plain words, with the app's own reason
{
  const S = () => cal.tools.find((t) => t.name === 'sync_todos').execute({});
  const why = async () => { try { await S(); } catch (e) { return e.message; } return 'no failure'; };
  cal.takeHeld();
  // refused by the app: the answer is shaped as the real app's refusals are ({ ok: false, error: { code, message } })
  const f1 = add('Fails: create'); mark = app.log.length;
  app.refuse = (m) => (m === 'POST' ? { status: 400, code: 'INVALID_INPUT', message: `title is not allowed, said with ${TOKEN}` } : null);
  let w = await why();
  assert.equal(w, 'Super Productivity refused to make a task for "Fails: create": title is not allowed, said with […] (INVALID_INPUT, HTTP 400).');
  assert.equal(linkOf(f1), undefined);
  // on the timer the owner is told once, not every minute; and again only when the reason changes
  await cal.sync('timer'); await cal.sync('timer'); await cal.sync('change');
  assert.deepEqual(cal.takeHeld().lines, [`I couldn't bring my to-do list and Super Productivity in step. ${w}`]);
  app.refuse = null; await cal.sync('timer'); assert.ok(linkOf(f1)); assert.deepEqual(cal.takeHeld().lines, []);
  // each kind of change is named
  app.refuse = (m, p, b) => (m === 'PATCH' ? { status: 500, code: 'INTERNAL_ERROR', message: 'Something broke' } : null);
  f1.text = 'Fails: renamed'; assert.equal(await why(), 'Super Productivity refused to change the title of "Fails: renamed": Something broke (INTERNAL_ERROR, HTTP 500).');
  app.refuse = (m, p, b) => (m === 'PATCH' && !('title' in b) ? { status: 400, code: 'INVALID_INPUT', message: '' } : null);
  f1.due = at(29, 12); await cal.setLocal(f1.id, { start: at(28, 9), minutes: 30 });
  assert.equal(await why(), 'Super Productivity refused to change the start time and the length and the due time of "Fails: renamed": it gave no reason (INVALID_INPUT, HTTP 400).');
  app.refuse = (m, p, b) => (m === 'PATCH' && 'tagIds' in b ? { status: 400, code: 'INVALID_INPUT', message: 'tagIds' } : null);
  await cal.setLocal(f1.id, { urgent: true });
  assert.equal(await why(), 'Super Productivity refused to change the urgent and important tags of "Fails: renamed": tagIds (INVALID_INPUT, HTTP 400).');
  app.refuse = (m, p) => (m === 'GET' && p === '/tasks' ? { status: 500, code: 'INTERNAL_ERROR', message: 'Renderer timeout' } : null);
  assert.equal(await why(), 'Super Productivity refused to give me its task list: Renderer timeout (INTERNAL_ERROR, HTTP 500).');
  app.refuse = null; await S(); await cal.setLocal(f1.id, { urgent: false, start: null }); await S(); cal.takeHeld();
  // the token: not accepted, not there, not a token (said by its length, never shown)
  app.mode = 'locked';
  assert.match(await why(), /^Super Productivity didn't accept its access token \(401\)\. Switching its local REST API off and on again/);
  app.mode = 'up';
  const odd = createCalendar({ home, todos, port, tokenFile: path.join(home, 'odd'), now: () => clock });
  r = await odd.sync('tool'); assert.equal(r.why, 'Super Productivity\'s access token isn\'t in the form I know (it is 18 characters; I expect 32 letters and digits), so I didn\'t send it.');
  r = await createCalendar({ home, todos, port, tokenFile: path.join(home, 'nope'), now: () => clock }).sync('tool');
  assert.match(r.why, /^Super Productivity's access token file isn't there, or can't be read\./);
  // not ready, something else on the port, too slow, nothing there
  app.mode = 'starting'; assert.match(await why(), /^Super Productivity answered that it isn't ready yet \(503\): it is probably still starting\./);
  app.mode = 'other'; assert.match(await why(), new RegExp(`^Something answered on port ${port} when asked to say that it is running, but not the way Super Productivity's REST API does \\(HTTP 200\\)\\.`));
  app.mode = 'up'; app.hang = (m, p) => m === 'GET' && p === '/tasks';
  fs.writeFileSync(settingsFile, JSON.stringify({ ...file0, limits: { ...file0.limits, calendarTimeoutSeconds: 2 } }));
  assert.match(await why(), /^Super Productivity didn't answer within 2 seconds when asked to give me its task list\./);
  fs.writeFileSync(settingsFile, settingsBytes); app.hang = null;
  const shut = createClient({ home, port: 1, tokenFile });
  await assert.rejects(shut.request('GET', '/tasks', undefined, 1000), /Error: Nothing is listening on port 1: Super Productivity is closed, or its local REST API is off\./);
  r = await createCalendar({ home, todos, port: 1, tokenFile, now: () => clock }).sync('timer');
  assert.match(r.why, /^Nothing is listening on port 1: Super Productivity is closed, or its local REST API is off\./);
  // a fault in Roamies' own code is said as that
  const real = todos.all; todos.all = async () => { throw new TypeError('list is broken'); };
  r = await cal.sync('tool'); assert.equal(r.why, 'The sync stopped on an error in Roamies itself, not in Super Productivity: list is broken');
  todos.all = real;
  // after the first yes, a failure is said even when the app has gone
  const home3 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-home3-')));
  const fresh3 = createCalendar({ home: home3, todos, port, tokenFile, now: () => clock, ask: async () => { app.hang = (m, p) => p === '/health'; return 'yes'; } });
  assert.equal(await fresh3.offerStart(), true);
  app.hang = null;
  const said3 = fresh3.takeHeld().lines;
  assert.equal(said3.length, 1); assert.match(said3[0], /^I couldn't bring my to-do list and Super Productivity in step\. Super Productivity didn't answer within 1 second/);
  assert.ok(![w, ...said3, JSON.stringify(logged)].join(' ').includes(TOKEN));
  assert.ok(!JSON.stringify(logged).includes('Fails:'), 'the reason names a to-do, so the log has only that a run failed');
  cal.takeHeld(); await S();
}

// ================= the calendar's bubbles take a spoken yes or no, as well as a click =================
{
  const { NO_WORDS, SPOKEN_HINT, YES_WORDS, createAnswers, spokenAnswer } = await import('../answers.mjs');
  // ---- which words count: these, alone
  for (const w of ['yes', 'Yes.', ' YES! ', 'Yes, please.', 'yes please', 'Go ahead.', 'do it', 'Do it!']) assert.equal(spokenAnswer(w), 'yes', w);
  for (const w of ['no', 'No.', 'Don\'t.', 'don’t', 'dont', 'Cancel.', 'CANCEL']) assert.equal(spokenAnswer(w), 'no', w);
  // the same word again, or several of the same kind, is still only an answer: "no, no" is a no
  for (const w of ['No, no.', 'No. No. No.', 'no cancel', 'No, don\'t.', 'Cancel, cancel']) assert.equal(spokenAnswer(w), 'no', w);
  for (const w of ['Yes, yes.', 'Yes, go ahead.', 'yes please do it', 'Go ahead, do it.']) assert.equal(spokenAnswer(w), 'yes', w);
  for (const w of ['yes no', 'no yes', 'no, go ahead', 'yes cancel', 'no no later', 'yes yes but', 'please', 'yes pleased']) assert.equal(spokenAnswer(w), null, w);
  for (const w of ['', 'maybe', 'yes but move the first one', 'no wait', 'yes no', 'not now', 'ok', 'send', 'yesterday', 'know', 'I said yes', 'go', 'do it later', 'don\'t know', 'cancel the meeting', 'what is on it?']) assert.equal(spokenAnswer(w), null, w);
  assert.deepEqual([YES_WORDS, NO_WORDS], [['yes', 'yes please', 'go ahead', 'do it'], ['no', 'don\'t', 'cancel']]);
  assert.deepEqual(codeReference().spokenAnswers.yes, YES_WORDS); assert.deepEqual(codeReference().spokenAnswers.no, NO_WORDS);

  // ---- the overlay's bubble, as sidekick.mjs has it: one resolver per bubble; an aborted signal takes it down
  const overlay = { open: new Map(), closed: [], seq: 0 };
  const overlayAsk = (opts, signal) => new Promise((resolve) => {
    const id = ++overlay.seq; overlay.open.set(id, { opts, resolve });
    signal?.addEventListener('abort', () => { if (overlay.open.delete(id)) overlay.closed.push(id); resolve(null); }, { once: true });
  });
  const click = (first) => { const [id, b] = [...overlay.open].at(-1); overlay.open.delete(id); b.resolve(first ? 'yes' : null); }; // as host.js answers: 'yes' for the first button
  const seenLabels = new Set();
  const clickLabel = (i) => { const [id, b] = [...overlay.open].at(-1); overlay.open.delete(id); b.opts.choices.forEach((l) => seenLabels.add(l)); b.resolve(b.opts.choices[i]); };
  const shown = async () => { for (let i = 0; i < 300 && !overlay.open.size; i++) await new Promise((r) => setTimeout(r, 5)); assert.equal(overlay.open.size, 1, 'one bubble is open'); return [...overlay.open.values()][0].opts; };
  const heardLog = [];
  const voiced = createAnswers({ ask: overlayAsk, log: (k, d) => heardLog.push([k, d]) });
  const pending = (p) => Promise.race([p.then(() => false, () => false), new Promise((r) => setTimeout(() => r(true), 60))]);

  // ---- a yes spoken with no bubble open does nothing here: it is ordinary speech
  assert.equal(voiced.listening(), false, 'so talking interrupts as it always does');
  assert.equal(voiced.heard('Yes.'), false, 'and the words go on as a request'); assert.equal(overlay.seq, 0);

  // ---- a calendar of its own, with the real tools, asking through that bubble
  const homeV = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-homeV-')));
  const listV = []; let seqV = 0;
  const addV = (text) => { const c = { id: `v${++seqV}`, text, due: null, status: 'open', kind: 'commitment' }; listV.push(c); return c; };
  const todosV = { all: async () => listV.filter((c) => c.status !== 'dropped'), update: async (id, ch) => { const c = listV.find((x) => x.id === id); if (ch.status) c.status = ch.status; }, rename: async () => {}, add: async (text) => addV(text) };
  const calV = createCalendar({ home: homeV, todos: todosV, port, tokenFile, now: () => clock, ask: voiced.ask });
  const V = (n) => calV.tools.find((t) => t.name === n);
  const v1 = addV('Voice: one'), v2 = addV('Voice: two');
  const settled = (p) => p.then((value) => ({ value }), (e) => ({ error: e.message }));

  // Each bubble, answered each way. `start` opens it; `yes` and `no` say what each answer must lead to.
  async function each(name, start, question, yes, no, prepare = async () => {}) {
    for (const [how, answerIt, want] of [
      ['a spoken yes', () => assert.equal(voiced.heard('Yes.'), true), 'yes'], ['a spoken "go ahead"', () => voiced.heard('Go ahead'), 'yes'],
      ['a spoken no', () => voiced.heard('No.'), 'no'], ['a spoken "cancel"', () => voiced.heard('cancel'), 'no'],
      ['a click on the first button', () => click(true), 'yes'], ['a click on the other button', () => click(false), 'no'],
      // should a page ever hand back the button's label: the first label is the first button, whatever it says
      ['the first button, by its label', () => clickLabel(0), 'yes'], ['the other button, by its label', () => clickLabel(1), 'no'],
    ]) {
      await prepare();
      const before = app.log.length, closedBefore = overlay.closed.length, p = settled(start(want));
      const opts = await shown();
      assert.match(opts.placeholder, question, `${name}: the question`); assert.ok(opts.placeholder.endsWith(`\n${SPOKEN_HINT}`), 'and that it can be said'); assert.equal(opts.choices.length, 2);
      assert.deepEqual(writes(before), [], `${name}: nothing is written before the answer`);
      // they start talking: the bubble stays, and the turn is not cancelled
      assert.equal(voiced.listening(), true, `${name}: talking is for the bubble`);
      assert.equal(voiced.state(), 'listening');
      // something unclear, three times over, with a take where nothing was heard in between: the words are taken
      // (they are not a new request), nothing happens, and after each the bubble is idle, as when it opened
      assert.equal(voiced.unheard(), true); assert.equal(voiced.state(), 'idle');
      for (const unclear of ['maybe later', 'hmm, what was the second one?', 'yes but later']) {
        assert.equal(voiced.listening(), true); assert.equal(voiced.state(), 'listening');
        assert.equal(voiced.heard(unclear), true);
        assert.equal(voiced.state(), 'idle', `${name}: idle after "${unclear}"`); assert.equal(overlay.open.size, 1); assert.equal(overlay.closed.length, closedBefore, 'the bubble was not taken down and put back');
      }
      assert.equal(voiced.listening(), true, `${name}: and talking again is for the bubble again`);
      assert.equal(overlay.open.size, 1, `${name}: still open after unclear words`); assert.equal(await pending(p), true, `${name}: and still waiting`); assert.deepEqual(writes(before), []);
      await answerIt();
      const out = await p;
      assert.equal(overlay.open.size, 0, `${name}, ${how}: the bubble is gone`);
      await (want === 'yes' ? yes : no)(out, before, how);
      assert.equal(voiced.listening(), false); assert.equal(voiced.state(), null); assert.equal(voiced.unheard(), false); assert.equal(voiced.heard('yes'), false, 'a yes after it has closed is for nobody');
    }
  }

  // 1. the first time
  await each('first mirror', () => V('sync_todos').execute({}), /^Put my to-do list in Super Productivity\? 2 to-dos, each as a task there:\n- Voice: one\n- Voice: two\n/,
    async (out, before, how) => {
      assert.equal(out.value, 'The to-do list and Super Productivity are in step.', how); assert.equal(writes(before).filter((w) => w.method === 'POST').length, 2);
      // back to before the yes, for the next way of answering
      fs.rmSync(path.join(homeV, 'Documents', 'roamies-pi', 'state.json'));
    },
    async (out, before) => { assert.equal(out.value, 'They didn\'t say yes, so nothing was added to Super Productivity.'); assert.deepEqual(writes(before), []); assert.equal(calV.state().started, false); });
  voiced.heard('x'); const go = settled(V('sync_todos').execute({})); await shown(); voiced.heard('yes please'); assert.match((await go).value, /in step/);
  const linkV = (c) => calV.state().links[c.id];

  // 2. a block that overlaps something
  const wall = hand('Voice: in the way', { dueWithTime: at(20, 10), timeEstimate: 60 * 60_000 });
  await each('an overlap', () => V('schedule_block').execute({ todo: v1.id, date: '2026-11-20', start: '10:30', minutes: 30 }), /^"Voice: one", 10:30 to 11:00 on Friday 20 November, overlaps "Voice: in the way" \(10:00 to 11:00\)\. Put it there anyway\?\n/,
    async (out, before) => { assert.match(out.value, /is on the calendar Friday 20 November, 10:30 to 11:00/); assert.equal(linkV(v1).local.start, at(20, 10, 30)); await calV.setLocal(v1.id, { start: null }); await calV.sync('timer'); },
    async (out, before) => { assert.match(out.error, /didn't say to put it there anyway\. Nothing was changed\./); assert.deepEqual(writes(before), []); assert.equal(linkV(v1).local.start, null); });
  wall.isDone = true;

  // 3. a day plan
  await each('a day plan', () => V('plan_day').execute({ date: '2026-11-21', items: [{ todo: v1.id, minutes: 60 }, { todo: v2.id, minutes: 30 }] }), /^Plan for Saturday 21 November:\n09:00 to 10:00  Voice: one\n10:00 to 10:30  Voice: two\n/,
    async (out) => { assert.match(out.value, /^On the calendar Saturday 21 November: 09:00 to 10:00 "Voice: one"; 10:00 to 10:30 "Voice: two"\.$/); await calV.setLocal(v1.id, { start: null }); await calV.setLocal(v2.id, { start: null }); await calV.sync('timer'); },
    async (out, before) => { assert.match(out.error, /didn't say yes to the plan/); assert.deepEqual(writes(before), []); assert.equal(linkV(v2).local.start, null); });

  // 4. a sorting proposal
  let pair = [];
  await each('sort_tasks', () => V('sort_tasks').execute({ proposals: [{ todo: pair[0].id, urgent: true, important: false }, { todo: pair[1].id, urgent: false, important: true }] }), /^Sort these to-dos like this\?\nImportant, not urgent: Voice: sort b\nUrgent, not important: Voice: sort a\n/,
    async (out) => { assert.match(out.value, /^Sorted 2 to-dos\./); assert.deepEqual([linkV(pair[0]).local.urgent, linkV(pair[1]).local.important], [true, true]); },
    async (out) => { assert.match(out.error, /nothing was sorted/); assert.deepEqual([linkV(pair[0]).local.urgent, linkV(pair[1]).local.important], [false, false]); },
    async () => { pair = [addV('Voice: sort a'), addV('Voice: sort b')]; await calV.sync('timer'); });

  // 5. a task deleted in the app
  const gone = { todo: v2.id, title: v2.text };
  await each('a deleted task', () => calV.askDeleted(gone), /^The task for "Voice: two" was deleted in Super Productivity\. Take it off my to-do list as well\?\n/,
    async (out) => assert.equal(out.value, true),
    async (out) => assert.equal(out.value, false));

  // ---- every one of its buttons was pressed by its label above, and none of those labels is a yes or no word:
  // they resolved because of where the button is, not what it says
  assert.deepEqual([...seenLabels].sort(), ['Add them', 'Don\'t', 'Keep it', 'Not now', 'Plan it', 'Put it there', 'Sort them', 'Take it off']);
  const { isSend: sendWord, isDontSend: dontWord } = await import('../pi.mjs');
  for (const l of seenLabels) if (l !== 'Don\'t') assert.ok(spokenAnswer(l) === null && !sendWord(l) && !dontWord(l), l);
  assert.ok(!/isSend|isYes/.test(fs.readFileSync(new URL('../calendar.mjs', import.meta.url), 'utf8')), 'calendar.mjs never judges an answer by send or yes words');

  // ---- the turn being cancelled some other way (Stop, Escape on the turn) still closes the bubble, as a no
  const stop = new AbortController();
  const cut = settled(V('plan_day').execute({ date: '2026-11-22', items: [{ todo: v1.id, minutes: 60 }] }, { signal: stop.signal }));
  await shown(); stop.abort();
  assert.match((await cut).error, /didn't say yes to the plan/); assert.equal(overlay.open.size, 0); assert.equal(voiced.listening(), false);
  // ---- one unclear phrase then yes; one then no; "no" said twice over (as a recogniser may write it)
  for (const [first, then, want] of [['maybe later', 'Yes.', true], ['maybe later', 'No.', false], ['maybe later', 'No, no.', false], ['later', 'yes, yes', true]]) {
    const p = settled(calV.askDeleted(gone)); await shown();
    voiced.listening(); voiced.heard(first); assert.equal(voiced.state(), 'idle'); assert.equal(await pending(p), true);
    voiced.listening(); voiced.heard(then);
    assert.equal((await p).value, want, `${first}, then ${then}`); assert.equal(voiced.state(), null);
  }
  // ---- what was said and not taken is on record by its size only: enough to see next time why it wasn't an answer
  assert.deepEqual(heardLog.find(([k, d]) => k === 'bubble_heard' && d.chars === 13), ['bubble_heard', { taken: false, chars: 13, words: 3, yesWord: true, noWord: false }], '"yes but later"');
  assert.ok(!JSON.stringify(heardLog).includes('later'));
  // ---- which way each answer came is on record, without what was asked
  assert.ok(heardLog.some(([k, d]) => k === 'bubble_answer' && d.by === 'voice' && d.yes) && heardLog.some(([, d]) => d.by === 'click' && !d.yes)); assert.ok(!JSON.stringify(heardLog).includes('Voice:'));

  // ---- feature 22: a question nobody answered (resume). Each is looked at first, without asking: done meanwhile
  // (cleared without a word), lost (one line), or still to be asked (ask).
  {
    const answerNext = async (words) => { await shown(); voiced.heard(words); };
    const askAgain = async (look) => { const r = await look; assert.equal(typeof r.ask, 'function', JSON.stringify(r)); return r.ask(); };
    const DONE = { done: true };
    // a sorting proposal: asked again whole; a yes applies it
    const sa = addV('Voice: later a'), sb = addV('Voice: later b'); await calV.sync('timer');
    const q = (kind, data) => ({ id: 'q1', at: new Date(clock).toISOString(), kind, brief: '', data });
    const openBefore = overlay.seq;
    let r = askAgain(calV.resume.sort(q('sort', { proposals: [{ todo: sa.id, urgent: true, important: true }, { todo: sb.id, urgent: false, important: true }, { todo: 'v-gone', urgent: true, important: true }] })));
    assert.match((await shown()).placeholder, /^Sort these to-dos like this\?\nUrgent and important: Voice: later a\nImportant, not urgent: Voice: later b\n/, 'without the to-do that is gone');
    await answerNext('yes');
    assert.deepEqual(await r, { say: 'Sorted 2 to-dos.' }); assert.deepEqual([linkV(sa).local.urgent, linkV(sb).local.important], [true, true]);
    // ...and once they are sorted the thing is done: no line, no bubble (fault 1: it was announced as dropped)
    let seen = overlay.seq;
    assert.deepEqual(await calV.resume.sort(q('sort', { proposals: [{ todo: sa.id, urgent: false, important: false }, { todo: sb.id, urgent: false, important: true }] })), DONE);
    assert.equal(overlay.seq, seen); assert.equal(overlay.open.size, 0);
    // a day plan: the day has passed → lost, one line; still ahead → asked again, and a no changes nothing
    const plan = (date, start) => q('plan', { date, shown: 'Plan for then:\n09:00 to 10:00  Voice: later a', placed: [{ todo: sa.id, title: sa.text, start, minutes: 60 }], left: [] });
    assert.match((await calV.resume.plan(plan('2026-11-13', at(13, 9)))).dropped, /^The day plan for Friday 13 November was waiting for your answer\. That day has passed, so it isn't on the calendar\.$/);
    assert.match((await calV.resume.plan(plan('2026-11-14', at(14, 7)))).dropped, /Its first times have passed/);
    await calV.sync('timer'); // what the yes above changed has gone over to the app
    const before = app.log.length;
    r = askAgain(calV.resume.plan(plan('2026-11-23', at(23, 9))));
    assert.match((await shown()).placeholder, /^Plan for then:/); await answerNext('no');
    assert.deepEqual(await r, {}); assert.deepEqual(writes(before), []); assert.equal(linkV(sa).local.start, null);
    r = askAgain(calV.resume.plan(plan('2026-11-23', at(23, 9)))); await answerNext('yes');
    assert.deepEqual(await r, { say: 'The plan for Monday 23 November is on the calendar.' }); assert.equal(linkV(sa).local.start, at(23, 9));
    // its to-dos are on the calendar that day now: the thing is done
    assert.deepEqual(await calV.resume.plan(plan('2026-11-23', at(23, 14))), DONE);
    // a to-do in a plan that is done meanwhile: the plan as it was is lost, and said; if all of them are, it is done
    sb.status = 'done';
    const two = [{ todo: sb.id, title: sb.text, start: at(24, 9), minutes: 30 }, { todo: sa.id, title: sa.text, start: at(24, 10), minutes: 30 }];
    assert.match((await calV.resume.plan(q('plan', { date: '2026-11-24', shown: 'x', placed: two, left: [] }))).dropped, /"Voice: later b" is no longer open, so it isn't on the calendar\.$/);
    assert.deepEqual(await calV.resume.plan(q('plan', { date: '2026-11-24', shown: 'x', placed: two.slice(0, 1), left: [] })), DONE);
    // an overlap: the to-do is done → done; the time has passed → lost, said; otherwise asked again even with nothing in the way
    assert.deepEqual(await calV.resume.overlap(q('overlap', { todo: sb.id, title: sb.text, start: at(25, 9), minutes: 30, was: null })), DONE);
    assert.match((await calV.resume.overlap(q('overlap', { todo: sa.id, title: sa.text, start: at(13, 9), minutes: 30, was: at(23, 9) }))).dropped, /^I had asked whether to put "Voice: later a" on the calendar Friday 13 November, 09:00 to 09:30, although it overlapped something\. That time has passed, so it isn't on the calendar\.$/);
    r = askAgain(calV.resume.overlap(q('overlap', { todo: sa.id, title: sa.text, start: at(25, 9), minutes: 30, was: at(23, 9) })));
    assert.match((await shown()).placeholder, /^"Voice: later a", 09:00 to 09:30 on Wednesday 25 November: nothing is in the way any more\. Put it there\?\n/, 'never placed without a yes');
    await answerNext('no'); assert.deepEqual(await r, {}); assert.equal(linkV(sa).local.start, at(23, 9));
    r = askAgain(calV.resume.overlap(q('overlap', { todo: sa.id, title: sa.text, start: at(25, 9), minutes: 30, was: at(23, 9) }))); await answerNext('yes');
    assert.match((await r).say, /^"Voice: later a" is on the calendar Wednesday 25 November, 09:00 to 09:30\.$/); assert.equal(linkV(sa).local.start, at(25, 9));
    // ...and a block placed since the question was asked (by a later request) settles it: done
    assert.deepEqual(await calV.resume.overlap(q('overlap', { todo: sa.id, title: sa.text, start: at(26, 9), minutes: 30, was: at(23, 9) })), DONE);
    // a deleted task and the first mirror, when they are settled already: done
    seen = overlay.seq;
    assert.deepEqual(await calV.resume.deleted(q('deleted', { todo: sa.id, title: sa.text })), DONE);
    assert.deepEqual(await calV.resume.start(q('start', {})), DONE);
    assert.equal(overlay.seq, seen, 'none of the done ones opened a bubble'); assert.ok(overlay.seq > openBefore);
    await calV.setLocal(sa.id, { start: null }); await calV.sync('timer');

    // ...and the first time round: when the answer window runs out, the tool is told so, nothing is written, and what
    // is kept says which question it was and holds what is needed to ask it again
    const keptQ = [];
    const timed = createAnswers({ ask: overlayAsk, question: (o) => { keptQ.push(o.pending); setTimeout(() => o.onTimeout(), 5); return { close() {} }; } });
    const calT = createCalendar({ home: homeV, todos: todosV, port, tokenFile, now: () => clock, ask: timed.ask });
    const T = (n) => calT.tools.find((t) => t.name === n);
    const sc = addV('Voice: later c'); await calT.sync('timer');
    const w0 = app.log.length;
    let out = await settled(T('sort_tasks').execute({ proposals: [{ todo: sc.id, urgent: true, important: false }] }));
    assert.match(out.error, /^They gave no answer, so nothing was changed\. The app has kept the question/); assert.equal(overlay.open.size, 0, 'the bubble closed');
    assert.deepEqual([keptQ.at(-1).kind, keptQ.at(-1).data], ['sort', { proposals: [{ todo: sc.id, urgent: true, important: false }] }]);
    out = await settled(T('plan_day').execute({ date: '2026-11-29', items: [{ todo: sc.id, minutes: 45 }] }));
    assert.match(out.error, /^They gave no answer/); assert.deepEqual([keptQ.at(-1).kind, keptQ.at(-1).data.date, keptQ.at(-1).data.placed], ['plan', '2026-11-29', [{ todo: sc.id, title: 'Voice: later c', start: at(29, 9), minutes: 45 }]]);
    assert.match(keptQ.at(-1).brief, /^Put the plan for Sunday 29 November on the calendar \(1 block\)\?$/);
    const wall2 = hand('Voice: wall two', { dueWithTime: at(28, 10), timeEstimate: 60 * 60_000 });
    out = await settled(T('schedule_block').execute({ todo: sc.id, date: '2026-11-28', start: '10:30', minutes: 30 }));
    assert.match(out.error, /^They gave no answer/); assert.deepEqual([keptQ.at(-1).kind, keptQ.at(-1).data], ['overlap', { todo: sc.id, title: 'Voice: later c', start: at(28, 10, 30), minutes: 30, was: null }]);
    out = await settled(calT.askDeleted({ todo: sc.id, title: sc.text }));
    assert.match(out.error, /^They gave no answer/); assert.deepEqual([keptQ.at(-1).kind, keptQ.at(-1).data], ['deleted', { todo: sc.id, title: 'Voice: later c' }]);
    assert.deepEqual(writes(w0), [], 'nothing was written for any of them'); assert.deepEqual([linkV(sc).local.urgent, linkV(sc).local.start], [false, null]);
    wall2.isDone = true; sc.status = 'done'; sa.status = 'done'; await calV.sync('timer');
  }

  // ---- the wiring in sidekick.mjs and in the overlay page (neither runs here; see ROADMAP "still to test")
  assert.match(side, /const answers = createAnswers\(\{ ask, /); assert.match(side, /const cal = createCalendar\(\{\n  ask: answers\.ask,/);
  assert.match(side, /await cal\.askDeleted\(a\)/, 'the deleted-task bubble too');
  // Feature 22: speech.hush() where this was speech.stop(): what is playing still stops, but the reply's voice is no
  // longer ended, so what Roamies says after the answer is spoken (flow.test.mjs checks hush against stop).
  assert.match(side, /if \(pi\.listening\(\) \|\| answers\.listening\(\)\) speech\.hush\(\);[^\n]*\n\s*else \{ interruptQuietly\(\);/, 'starting to talk cancels the turn only when no such bubble is open');
  assert.match(side, /if \(pi\.heard\(text\) \|\| answers\.heard\(text\)\) \{ ui\(\{ kind: 'heard' \}\); return; \}\n  if \(!area\?\.file\) return enqueue\(/, 'what is said goes to the bubble before it can become a request, and the shell is told the words were dealt with');
  assert.match(side, /m\.state === 'idle' && \(pi\.unheard\(\) \|\| answers\.unheard\(\)\)/);
  const shell = fs.readFileSync(new URL('../../src-tauri/src/main.rs', import.meta.url), 'utf8');
  assert.match(shell.slice(shell.indexOf('fn shows_answer')), /^[^}]*Some\("summon" \| "say" \| "ask" \| "list" \| "heard"\) => true/, 'on "heard" the shell lets the listening pill go (to_overlays: handoff)');
  const hostPage = fs.readFileSync(new URL('../../../roamies/host.js', import.meta.url), 'utf8');
  assert.match(hostPage, /if \(ask\?\.choices\) \{ Roamie\.sfx\?\.play\('listen'\); return; \}\n\s*if \(ask\) finishAsk\(null\);\n\s*endTalk\(\);/, 'the page leaves a bubble with buttons as it is when listening starts: before anything is closed or hidden');
  assert.match(calV.live(), /they answer it by saying yes or no, or by clicking: don't ask them yourself as well, and never tell them they have to click\./);
}

// ---- 15. the one function added to upstream's store: a to-do's wording, changed
const store = await import('../store.mjs');
const kept = await store.addCommitment('Send the figures', at(17, 10));
const renamed = await store.renameCommitment(kept.id, `  Send the figures to Marta ${'x'.repeat(300)}`);
assert.equal(renamed.text.length, 200); assert.ok(renamed.text.startsWith('Send the figures to Marta'));
assert.deepEqual([renamed.id, renamed.due, renamed.status, renamed.kind], [kept.id, at(17, 10), 'open', 'commitment'], 'nothing but the text changes');
assert.equal(store.openCommitments().find((c) => c.id === kept.id).text, renamed.text);
assert.equal(await store.renameCommitment(kept.id, '   '), null); assert.equal(await store.renameCommitment('c-none', 'x'), null);
await store.flushWrites();
assert.ok(fs.readFileSync(path.join(home, 'data', 'sidekick', 'memory.json'), 'utf8').includes('Send the figures to Marta'));

// ---- 16. over the whole run: never a DELETE, never the three fields Roamies must not set, only the two tags added
assert.ok(!app.log.some((q) => q.method === 'DELETE'), 'no DELETE was ever sent');
assert.ok(app.log.every((q) => ['GET', 'POST', 'PATCH'].includes(q.method)));
const bodies = writes().map((w) => w.body);
assert.ok(bodies.every((b) => !('deadlineRemindAt' in b) && !('notes' in b) && !('projectId' in b) && !('subTaskIds' in b) && !('dueDay' in b)));
assert.ok(writes().filter((w) => w.method === 'POST').every((w) => w.body.isIgnoreShortSyntax === true), 'every create asks for its title to be taken as written');
assert.ok(writes().filter((w) => 'title' in w.body && w.method === 'PATCH').every((w) => Object.keys(w.body).sort().join() === 'isIgnoreShortSyntax,title'));
// (the stand-in numbers what was made through POST sp…, and what the owner made by hand hand…)
const madeByRoamies = new Set([...Object.values(state().links).map((l) => l.task), ...Object.values(state().retired), droppedTask, archTask, goneTask, twinBTask]);
for (const w of writes().filter((q) => q.method === 'PATCH')) assert.ok(madeByRoamies.has(w.path.slice(7)) || /^\/tasks\/sp\d+$/.test(w.path), `only tasks Roamies made are written to: ${w.path}`);
assert.ok(app.log.every((q) => q.host === `127.0.0.1:${port}`));
// ---- the token, the app's full answer and anything from a task Roamies didn't make: in no file, log line or result
assert.ok(written.length > 20);
for (const w of written) { assert.ok(!w.data.includes(TOKEN), `the token is not in ${w.file}`); assert.ok(!w.data.includes(SECRET) && !w.data.includes('Dentist') && !w.data.includes('Seminar') && !w.data.includes('Group meeting') && !w.data.includes('INBOX_PROJECT') && !w.data.includes('"tagIds"'), `nothing of the app's answer beyond the synced fields is in ${w.file}`); }
const said = JSON.stringify([logged, asked, told]);
assert.ok(!said.includes(TOKEN) && !said.includes(SECRET) && !JSON.stringify(logged).includes('Seminar') && !said.includes('Dentist'), 'a task that isn\'t Roamies\' is named only to the owner, in the question about a clash');
assert.ok(logged.length > 10 && logged.every((l) => !/title|text/.test(Object.keys(l.data).join())), 'the records say what kind of change, not what a to-do says');
assert.equal(fs.readFileSync(settingsFile, 'utf8'), settingsBytes, 'and settings.json is as the owner left it');
assert.deepEqual(FIELDS, ['title', 'done', 'start', 'minutes', 'urgent', 'important', 'due']);
assert.deepEqual(Object.keys(codeReference().superProductivity.synced).length, 7);

server.close(); server.closeAllConnections();
console.log('calendar tests passed');
