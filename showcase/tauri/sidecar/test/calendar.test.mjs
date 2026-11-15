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
const { Down, FIELDS, createCalendar, createClient, quiet } = await import('../calendar.mjs');
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
    if (req.method === 'GET' && url.pathname === '/health') return send(200, { server: 'up', rendererReady: true });
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { code: 'UNAUTHORIZED', message: 'Invalid authorization token.' });
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
};
const logged = [];
let answer = null; const asked = [];
const make = () => createCalendar({ home, todos, port, tokenFile, ask: async (o) => { asked.push(o.placeholder); return answer; }, log: (kind, data) => logged.push({ kind, data }) });
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
assert.deepEqual(cal.takeHeld(), { lines: [], asks: [{ todo: gone.id, title: 'Delete me' }] }); assert.deepEqual(state().held, []);
mark = app.log.length; await cal.sync('timer'); await cal.sync('tool');
assert.deepEqual(writes(mark), [], 'until the owner answers, the to-do gets no new task'); assert.deepEqual(cal.takeHeld(), { lines: [], asks: [] }, 'asked once');
// the owner keeps it: it is a to-do without a task, so it gets a new one
await cal.answered(gone.id); r = await cal.sync('timer'); assert.equal(taskOf(gone).title, 'Delete me'); assert.deepEqual(cal.takeHeld(), { lines: [], asks: [] });

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
r = await cal.sync('timer'); assert.equal(r.ok, false); assert.match(r.why, /isn't answering/);
await assert.rejects(cal.tools.find((t) => t.name === 'sync_todos').execute({}), /isn't answering.*still works here/s);
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
assert.deepEqual(next.takeHeld().lines, ['I was adding "Made while the app was slow" to Super Productivity when I last stopped. A stray task with that title may be in the app: delete it there if so.']);
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
const madeByRoamies = new Set([...Object.values(state().links).map((l) => l.task), ...Object.values(state().retired), droppedTask, archTask, goneTask, twinBTask]);
for (const w of writes().filter((q) => q.method === 'PATCH')) assert.ok(madeByRoamies.has(w.path.slice(7)), `only tasks Roamies made are written to: ${w.path}`);
assert.ok(app.log.every((q) => q.host === `127.0.0.1:${port}`));
// ---- the token, the app's full answer and anything from a task Roamies didn't make: in no file, log line or result
assert.ok(written.length > 20);
for (const w of written) { assert.ok(!w.data.includes(TOKEN), `the token is not in ${w.file}`); assert.ok(!w.data.includes(SECRET) && !w.data.includes('Dentist') && !w.data.includes('INBOX_PROJECT') && !w.data.includes('"tagIds"'), `nothing of the app's answer beyond the synced fields is in ${w.file}`); }
const said = JSON.stringify([logged, asked, told]);
assert.ok(!said.includes(TOKEN) && !said.includes(SECRET) && !said.includes('Dentist'));
assert.ok(logged.length > 10 && logged.every((l) => !/title|text/.test(Object.keys(l.data).join())), 'the records say what kind of change, not what a to-do says');
assert.equal(fs.readFileSync(settingsFile, 'utf8'), settingsBytes, 'and settings.json is as the owner left it');
assert.deepEqual(FIELDS, ['title', 'done', 'start', 'minutes', 'urgent', 'important', 'due']);
assert.deepEqual(Object.keys(codeReference().superProductivity.synced).length, 7);

server.close(); server.closeAllConnections();
console.log('calendar tests passed');
