// Local-only build, feature 26: Roamies sees every open task in Super Productivity (calendar.mjs), and the model is
// given the to-do list in outline only. The app is stood in for by a small HTTP server on a loopback port; the real
// app is never called from here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'adopt-home-')));
process.env.ROAMIES_DATA_DIR = path.join(home, 'data');
const dir = path.join(home, 'Documents', 'roamies-pi');
const stateFile = path.join(dir, 'state.json');
const TOKEN = 'Tk'.repeat(16), tokenFile = path.join(home, 'token');
fs.writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 });
const SECRET = 'NOTES-OF-A-TASK-FROM-THE-APP';
const written = [];
for (const name of ['writeFileSync', 'appendFileSync']) { const real = fs[name]; fs[name] = (file, data, ...rest) => { written.push({ file: String(file), data: String(data) }); return real(file, data, ...rest); }; }

const { SP, codeReference } = await import('../pi.mjs');
const { createCalendar } = await import('../calendar.mjs');
const { SAME } = await import('../flow.mjs');

// ---- the stand-in for Super Productivity
const app = { tasks: new Map(), archived: new Map(), log: [], seq: 0 };
const server = http.createServer((req, res) => {
  const parts = [];
  req.on('data', (d) => parts.push(d));
  req.on('end', () => {
    const url = new URL(req.url, 'http://x'), body = parts.length ? JSON.parse(Buffer.concat(parts).toString()) : undefined;
    app.log.push({ method: req.method, path: url.pathname, body });
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(status < 400 ? { ok: true, data } : { ok: false, error: data })); };
    if (req.method === 'GET' && url.pathname === '/health') return send(200, { server: 'up', rendererReady: true });
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { code: 'UNAUTHORIZED', message: 'no' });
    const id = url.pathname.startsWith('/tasks/') ? decodeURIComponent(url.pathname.slice(7)) : null;
    if (req.method === 'GET' && url.pathname === '/tasks') return send(200, [...(url.searchParams.get('source') === 'archived' ? app.archived : app.tasks).values()]);
    if (req.method === 'POST' && url.pathname === '/tasks') { const t = { id: `sp${++app.seq}`, title: body.title.trim(), isDone: false, timeEstimate: 0, tagIds: [], projectId: 'INBOX_PROJECT', subTaskIds: [] }; if (typeof body.deadlineWithTime === 'number') t.deadlineWithTime = body.deadlineWithTime; app.tasks.set(t.id, t); return send(201, t); }
    if (id && req.method === 'GET') return app.tasks.has(id) ? send(200, app.tasks.get(id)) : send(404, { code: 'TASK_NOT_FOUND', message: 'Task not found' });
    if (id && req.method === 'PATCH') {
      const t = app.tasks.get(id);
      if (!t) return send(404, { code: 'TASK_NOT_FOUND', message: 'Task not found' });
      const { isIgnoreShortSyntax, ...changes } = body;
      for (const [k, v] of Object.entries(changes)) { if (v === null) delete t[k]; else t[k] = v; }
      return send(200, t);
    }
    send(404, { code: 'NOT_FOUND', message: 'Route not found' });
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const writes = (from = 0) => app.log.slice(from).filter((r) => r.method !== 'GET');
// a task made by hand in the app: with everything Roamies must never read
const hand = (title, extra = {}) => { const t = { id: `hand${++app.seq}`, title, isDone: false, timeEstimate: 0, tagIds: ['PERSONAL'], notes: SECRET, attachments: [{ path: SECRET }], subTaskIds: [], projectId: 'WORK', ...extra }; app.tasks.set(t.id, t); return t; };

// ---- Roamies' own list, stood in for
const list = [], shown = [];
let seq = 0;
const add = (text, { due = null, kind = 'commitment' } = {}) => { const c = { id: `c${++seq}`, text, due, status: 'open', kind }; list.push(c); return c; };
const todos = {
  all: () => list.filter((c) => c.status === 'open' || c.status === 'done').map((c) => ({ ...c })),
  update: async (id, { status, dueMs }) => { const c = list.find((x) => x.id === id); if (status) c.status = status; if (dueMs !== undefined) c.due = dueMs; },
  rename: async (id, text) => { list.find((x) => x.id === id).text = text; },
  add: async (text) => { const c = add(text); shown.push(c.id); return c; }, // puts the list on screen
  adopt: async (text, due) => add(text, { due }), // doesn't
};
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
let clock = at(14, 8); // Saturday 14 November 2026, 08:00
const M = 60_000;
const logged = [], asked = [];
let answer = null;
const cal = createCalendar({ home, todos, port, tokenFile, now: () => clock, ask: async (o) => { asked.push(o); if (answer === 'nobody') throw Object.assign(new Error('no answer'), { name: 'Unanswered' }); return answer; }, log: (kind, data) => logged.push({ kind, data }) });
const state = () => JSON.parse(fs.readFileSync(stateFile, 'utf8')).calendar;
const linkOf = (c) => state().links[c.id];
const todoOf = (task) => { const e = Object.entries(state().links).find(([, l]) => l.task === task.id); return e ? list.find((c) => c.id === e[0]) : null; };
const T = (n) => cal.tools.find((t) => t.name === n);
const L = cal.wrap([{ name: 'list_commitments', execute: async () => 'THE WHOLE LIST' }])[0];

// ---- 0. Roamies' own list is in the app (the first yes), and the app has tasks of its own
const report = add('Write report', { due: at(14, 17) }), paper = add('Read the paper');
answer = 'yes'; assert.equal(await cal.offerStart(), true); asked.length = 0;
assert.equal(writes().filter((w) => w.method === 'POST').length, 2);
const dentist = hand('Dentist', { dueWithTime: at(16, 9), timeEstimate: 60 * M, projectId: 'HOME' });
const milk = hand('Buy milk', { projectId: 'HOME' });
const grant = hand('Grant draft', { deadlineWithTime: at(20, 12), tagIds: ['PERSONAL', 'EM_IMPORTANT'] });
const standup = hand('Stand-up', { repeatCfgId: 'rep1', dueWithTime: at(14, 10), timeEstimate: 15 * M });
const parent = hand('Thesis chapter'), child = hand('Thesis chapter: figures', { parentId: parent.id, dueWithTime: at(14, 13), timeEstimate: 30 * M });
parent.subTaskIds = [child.id];
const doneOne = hand('Already done', { isDone: true });
app.archived.set('arch1', { id: 'arch1', title: 'Archived long ago', isDone: true, timeEstimate: 0, tagIds: [] });
hand('   '); // no title: nothing to call a to-do
const more = Array.from({ length: 8 }, (_, i) => hand(`Extra ${i + 1}`));
const OPEN = [dentist, milk, grant, standup, parent, ...more]; // 13: what can be adopted

// ---- 1. before the yes: nothing is added; the tasks are clash facts, as before
let mark = app.log.length, n = list.length;
assert.equal(state().adopt, false);
await cal.sync('timer'); assert.equal(cal.adoptable(), 13);
assert.equal(list.length, n, 'no to-do is made before the yes'); assert.deepEqual(writes(mark), []); assert.equal(Object.keys(state().links).length, 2);
assert.ok(cal.others().some((o) => o.title === 'Dentist') && cal.others().every((o) => Object.keys(o).join() === 'title,start,minutes,done'));
assert.deepEqual(cal.takeHeld(), { lines: [], notices: [], asks: [], offers: [], blocks: [] });

// ---- 2. the first time: the count, the first ten titles, "and N more"; a yes before anything is linked
answer = null;
assert.equal(await cal.offerAdopt(), false); assert.equal(state().adopt, false); assert.equal(list.length, n);
assert.equal(asked.length, 1);
assert.equal(asked[0].placeholder, ['Super Productivity has 13 open tasks that aren\'t on my to-do list. Add them, and keep new ones on my list from now on?', '- Dentist', '- Buy milk', '- Grant draft', '- Stand-up', '- Thesis chapter', '- Extra 1', '- Extra 2', '- Extra 3', '- Extra 4', '- Extra 5', 'and 3 more'].join('\n'));
assert.equal(SP.titlesShown, 10); assert.equal(codeReference().superProductivity.titlesShown, 10);
assert.equal(asked[0].spoken, 'Super Productivity has 13 open tasks that aren\'t on my to-do list. Add them, and keep new ones on my list from now on?', 'said without the titles');
assert.deepEqual(asked[0].choices, ['Add them', 'Not now']); assert.deepEqual(asked[0].pending, { kind: 'adopt', brief: 'Add the open tasks in Super Productivity to the to-do list?', data: {} });
for (const gone of ['figures', 'Already done', 'Archived']) assert.ok(!asked[0].placeholder.includes(gone), `${gone}: a sub-task, a done or an archived task is not offered`);
// nobody answers: kept (flow.mjs), and asked again later
answer = 'nobody'; await assert.rejects(cal.offerAdopt(), (e) => e.name === 'Unanswered');
const q = { id: 'qa', at: new Date(clock).toISOString(), ...asked.at(-1).pending };
assert.deepEqual(SAME.adopt(q.data), []); assert.ok(codeReference().pendingQuestions.kinds.includes('adopt'));
let r = await cal.resume.adopt(q); assert.equal(typeof r.ask, 'function');
answer = null; asked.length = 0; assert.deepEqual(await r.ask(), { say: '' }); assert.deepEqual([asked[0].pending.id, asked[0].pending.at], ['qa', q.at]); assert.equal(list.length, n);
// yes
answer = 'yes'; asked.length = 0; mark = app.log.length;
assert.equal(await cal.offerAdopt(), 13);
assert.equal(state().adopt, true); assert.equal(list.length, n + 13); assert.deepEqual(shown, [], 'added without the list being put on screen');
assert.deepEqual(writes(mark), [], 'adopting writes nothing to the app: no task is made, changed or deleted');
assert.ok(!app.log.slice(mark).some((x) => x.path.startsWith('/tasks/')), 'and asks for no task by its id');
for (const t of OPEN) { const c = todoOf(t); assert.ok(c, t.title); assert.equal(c.text, t.title); assert.equal(linkOf(c).from, 'app'); }
assert.equal(linkOf(report).from, undefined, 'a link Roamies made says nothing: that is how the two are told apart');
assert.deepEqual(await cal.resume.adopt(q), { done: true }); assert.equal(cal.adoptable(), 0);
// what was read: the seven fields, and that it repeats
assert.deepEqual(linkOf(todoOf(dentist)), { task: dentist.id, title: 'Dentist', was: 'open', from: 'app', offered: true, local: { start: at(16, 9), minutes: 60, urgent: false, important: false }, agreed: { title: 'Dentist', done: false, start: at(16, 9), minutes: 60, urgent: false, important: false, due: null } });
assert.equal(todoOf(grant).due, at(20, 12), 'the app\'s deadline is the to-do\'s due time'); assert.equal(linkOf(todoOf(grant)).local.important, true);
assert.equal(linkOf(todoOf(standup)).repeats, true, 'a repeating task is adopted, and the link says it repeats'); assert.equal(linkOf(todoOf(dentist)).repeats, undefined);
// what was not: a sub-task, a done task, an archived one, one without a title
assert.equal(todoOf(child), null); assert.equal(todoOf(doneOne), null); assert.ok(!list.some((c) => /figures|Already done|Archived/.test(c.text) || !c.text.trim()));
assert.deepEqual(cal.others().filter((o) => !o.done).map((o) => o.title), ['Thesis chapter: figures', ''], 'a sub-task still counts as taken time; an adopted task is no longer "another task"');
assert.deepEqual(logged.filter((l) => l.kind === 'calendar_adopted').map((l) => l.data), [{ tasks: 13, byTitle: 0, repeating: 1 }], 'the log has how many, never a title');
assert.deepEqual(cal.takeHeld(), { lines: [], notices: [], asks: [], offers: [], blocks: [] }, 'no block is offered for an adopted task, and nothing else is said');

// ---- 3. afterwards: a task added in the app is adopted at the next sync, without a bubble or a line
const later = hand('Added later', { dueWithTime: at(17, 14), timeEstimate: 45 * M });
n = list.length; asked.length = 0; mark = app.log.length;
await cal.sync('timer');
assert.equal(list.length, n + 1); assert.equal(todoOf(later).text, 'Added later'); assert.equal(asked.length, 0); assert.deepEqual(cal.takeHeld(), { lines: [], notices: [], asks: [], offers: [], blocks: [] }); assert.deepEqual(writes(mark), []);
await cal.sync('timer'); assert.equal(list.length, n + 1, 'once: a task is one to-do');

// ---- 4. the pair is synced both ways like any other; only the seven fields are written, and only what changed here
mark = app.log.length;
todoOf(milk).text = 'Buy oat milk'; await cal.sync('change');
assert.deepEqual(writes(mark).map((w) => [w.method, w.path, w.body]), [['PATCH', `/tasks/${milk.id}`, { title: 'Buy oat milk', isIgnoreShortSyntax: true }]]);
assert.deepEqual([milk.notes, milk.tagIds, milk.projectId], [SECRET, ['PERSONAL'], 'HOME'], 'the rest of the task is as it was');
dentist.title = 'Dentist, 9 o\'clock'; dentist.dueWithTime = at(16, 9, 30); await cal.sync('timer');
assert.equal(todoOf(dentist).text, 'Dentist, 9 o\'clock'); assert.equal(linkOf(todoOf(dentist)).local.start, at(16, 9, 30));
// a block for an adopted to-do: placed like any other
answer = 'yes'; mark = app.log.length;
assert.match(await T('schedule_block').execute({ todo: todoOf(milk).id, date: 'monday', start: '18:00', minutes: 20 }), /^"Buy oat milk" is on the calendar Monday 16 November, 18:00 to 18:20\./);
assert.deepEqual(writes(mark).map((w) => w.body), [{ dueWithTime: at(16, 18), timeEstimate: 20 * M }]);
// urgent: the two matrix tags only; its other tag goes back as it was
mark = app.log.length; await T('set_priority').execute({ todo: todoOf(milk).id, urgent: true }); await cal.sync('timer');
assert.deepEqual(writes(mark).map((w) => w.body), [{ tagIds: ['PERSONAL', 'EM_URGENT'] }]);
// done in Roamies: done in the app, and the pair is retired; opened again in the app, the to-do is open again
mark = app.log.length; todoOf(more[0]).status = 'done'; const m0 = todoOf(more[0]); await cal.sync('change');
assert.deepEqual(writes(mark).map((w) => w.body), [{ isDone: true }]); assert.equal(state().retired[m0.id], more[0].id); assert.equal(linkOf(m0), undefined);
more[0].isDone = false; await cal.sync('timer');
assert.equal(m0.status, 'open', 'opened again in the app'); assert.equal(linkOf(m0).task, more[0].id); assert.equal(list.filter((c) => c.text === 'Extra 1').length, 1, 'by its old to-do, not a second one');
// done in the app: the to-do is done
more[1].isDone = true; const m1 = todoOf(more[1]); await cal.sync('timer'); assert.equal(m1.status, 'done');

// ---- 5. a to-do that came from the app, taken off Roamies' list: the task stays exactly as it is, and isn't brought back
const before = JSON.stringify(dentist); const d = todoOf(dentist);
d.status = 'dropped'; mark = app.log.length; n = list.filter((c) => c.status === 'open').length;
await cal.sync('change');
assert.deepEqual(writes(mark), [], 'nothing is written: not its time, nothing'); assert.equal(JSON.stringify(dentist), before);
assert.deepEqual(cal.takeHeld().lines, ['"Dentist, 9 o\'clock" is off my list. Its task stays in Super Productivity as it is (I never delete there), and I won\'t bring it back.']);
assert.deepEqual(state().released, { [dentist.id]: true }); assert.equal(state().links[d.id], undefined);
await cal.sync('timer'); await cal.sync('timer');
assert.equal(list.filter((c) => c.status === 'open').length, n, 'not adopted again'); assert.ok(cal.others().some((o) => o.title === 'Dentist, 9 o\'clock' && o.start === at(16, 9, 30)), 'it still counts as taken time');
// ...until it is done in the app: then it is forgotten. Opened again there, it is adopted as new
dentist.isDone = true; await cal.sync('timer'); assert.deepEqual(state().released, {});
dentist.isDone = false; await cal.sync('timer'); assert.equal(todoOf(dentist).text, 'Dentist, 9 o\'clock'); assert.notEqual(todoOf(dentist).id, d.id);
// a to-do Roamies made, taken off: its task loses its time and stays, as before; and it is not brought back either
await T('schedule_block').execute({ todo: report.id, date: 'monday', start: '10:00', minutes: 30 });
report.status = 'dropped'; mark = app.log.length; n = list.length; const reportTask = app.tasks.get('sp1');
await cal.sync('change');
assert.deepEqual(writes(mark).map((w) => [w.path, w.body]), [['/tasks/sp1', { dueWithTime: null }]]);
assert.deepEqual(cal.takeHeld().lines, ['"Write report" is off my list. Its task is still in Super Productivity, without a time: delete it there if you don\'t want it. I won\'t bring it back.']);
await cal.sync('timer'); assert.equal(list.length, n); assert.equal(reportTask.isDone, false); assert.equal(state().released.sp1, true);

// ---- 6. duplicates
// a to-do without a task and a task without a to-do, of the same title, one of each: linked, no second task
const ana = add('call ANA', { due: at(18, 9) }); const anaTask = hand('Call Ana');
mark = app.log.length; n = list.length;
await cal.sync('timer');
assert.ok(!writes(mark).some((w) => w.method === 'POST'), 'no second task is made'); assert.equal(list.length, n, 'and no second to-do');
assert.deepEqual([linkOf(ana).task, linkOf(ana).from, ana.text], [anaTask.id, 'app', 'Call Ana']);
await cal.sync('timer'); assert.equal(anaTask.deadlineWithTime, at(18, 9), 'what only the to-do had goes over');
// the app's deadline wins where both have one
const bo = add('Mail Bo', { due: at(18, 9) }); const boTask = hand('mail bo', { deadlineWithTime: at(19, 9) });
await cal.sync('timer'); await cal.sync('timer'); assert.equal(bo.due, at(19, 9)); assert.equal(boTask.deadlineWithTime, at(19, 9));
// a to-do that has its own task, and another task of that title made in the app: two tasks are two to-dos
hand('Read the paper'); n = list.length; await cal.sync('timer');
assert.equal(list.length, n + 1); assert.equal(list.filter((c) => c.text === 'Read the paper' && c.status === 'open').length, 2);
await assert.rejects(T('schedule_block').execute({ title: 'Read the paper', date: 'monday', start: '11:00', minutes: 30 }), /2 open to-dos are called "Read the paper"/);
// two tasks of one title and one to-do without a task: not guessed; both are adopted and the to-do gets its own
const twin = add('Order tips'); hand('Order tips'); hand('order tips'); n = list.length; mark = app.log.length;
await cal.sync('timer');
assert.equal(list.length, n + 2); assert.equal(writes(mark).filter((w) => w.method === 'POST').length, 1); assert.equal(linkOf(twin).from, undefined);

// ---- 7. never a DELETE, and nothing of a task but the seven fields is kept or written anywhere
assert.ok(!app.log.some((x) => x.method === 'DELETE')); assert.deepEqual(SP.requests, ['GET /health', 'GET /tasks', 'GET /tasks/:id', 'POST /tasks', 'PATCH /tasks/:id']);
for (const w of written) assert.ok(!w.data.includes(SECRET) && !w.data.includes(TOKEN) && !w.data.includes('"notes"') && !w.data.includes('WORK') && !w.data.includes('rep1') && !w.data.includes('subTaskIds') && !w.data.includes('parentId'), w.file);
assert.ok(!JSON.stringify(logged).includes('Dentist') && !JSON.stringify(logged).includes('Extra'), 'no title in the log');
const sp = codeReference().superProductivity;
assert.deepEqual(sp.neverRead, ['notes', 'attachments', 'other tags', 'the project', 'sub-tasks', 'the repeat rule']); assert.equal(sp.neverSent, 'DELETE'); assert.ok(!('fromTasksRoamiesDidNotMake' in sp));

// ---- 8. what the model is given: an outline with each request, never the list (2026-11-19)
clock = at(14, 8);
for (const c of list) if (c.status === 'done') c.status = 'gone';
standup.dueWithTime = at(14, 10); todoOf(more[2]).due = at(14, 17); await cal.sync('timer');
const open = () => list.filter((c) => c.status === 'open');
const out = cal.outline().split('\n');
const counts = { today: open().filter((c) => c.due !== null && c.due >= at(14, 0) && c.due < at(15, 0)).length, week: open().filter((c) => c.due !== null && c.due >= at(9, 0) && c.due < at(16, 0)).length, overdue: open().filter((c) => c.due !== null && c.due < clock).length, none: open().filter((c) => c.due === null).length };
assert.equal(out[0], `To-do list, in outline: ${open().length} open: ${counts.today} due today, ${counts.week} due this week, ${counts.overdue} overdue, ${counts.none} without a date.`);
assert.equal(out[1], `Planned for today: 10:00 to 10:15 "Stand-up" [${todoOf(standup).id}].`, 'today\'s planned blocks, in full');
assert.equal(out[2], '1 other stretch of today is taken in Super Productivity by tasks that aren\'t on the to-do list.', '(the sub-task)');
assert.match(out[3], /^This outline is all you are given of the list: no other title is sent to you\. When they ask what is open or how the list stands, say these numbers and today's plan first, and offer the details\./);
assert.equal(out.length, 4);
for (const c of open()) if (c.id !== todoOf(standup).id) assert.ok(!cal.outline().includes(c.text), `${c.text}: no title outside today's plan`);
assert.ok(!cal.live().includes('Stand-up') && open().every((c) => !cal.live().includes(c.text)), 'nor in the calendar\'s line of the live state');
assert.match(cal.live(), /Every open task they have in the app is on the to-do list too, whoever made it; the app adds new ones itself\./);
assert.equal(cal.dayNote(), `\nTheir to-do list now:\n${cal.outline()}\nSay it in a sentence or two.`, 'the morning briefing has the same outline');
// a slot kept for today is part of today's plan, and said as what it is
const closed = createCalendar({ home, todos, port: 1, tokenFile, now: () => clock, ask: async () => 'yes' });
await closed.tools.find((t) => t.name === 'schedule_block').execute({ todo: todoOf(milk).id, date: 'today', start: '19:00', minutes: 20 });
assert.match(cal.outline().split('\n')[1], new RegExp(`; 19:00 to 19:20 "Buy oat milk" \\[${todoOf(milk).id}\\] \\(slot kept, not booked yet\\)\\.$`));
await cal.sync('timer'); cal.takeHeld();
// list_commitments: the outline without a filter; with one, ten at most, then "and N more"
assert.equal(L.name, 'list_commitments'); assert.equal(await L.execute({}), cal.outline(), 'no filter: the outline, not the list'); assert.notEqual(await L.execute({}), 'THE WHOLE LIST');
assert.match(L.description, /Without a filter: the outline .*which is what to say first when they ask what is open; then offer the details\. With a filter, when they ask about those to-dos or name one: the open to-dos it picks, with their ids, 10 at most, then "and N more"/);
assert.deepEqual(Object.keys(L.parameters.shape), ['due', 'words', 'quadrant', 'skip']);
let rows = (await L.execute({ due: 'none' })).split('\n');
assert.equal(rows[0], `${counts.none} open to-dos without a date:`); assert.equal(rows.length, 12); assert.equal(rows[11], `and ${counts.none - 10} more`); assert.ok(rows.slice(1, 11).every((l) => /^- c\d+: /.test(l)));
rows = (await L.execute({ due: 'none', skip: 10 })).split('\n');
assert.equal(rows[0], `${counts.none} open to-dos without a date, from the 11th on:`); assert.equal(rows.length, 1 + Math.min(10, counts.none - 10) + (counts.none > 20 ? 1 : 0));
assert.equal(await L.execute({ due: 'today' }), `${counts.today} open to-do${counts.today === 1 ? '' : 's'} due today:\n${open().filter((c) => c.due !== null && c.due < at(15, 0)).map((c) => `- ${c.id}: ${c.text} (due Saturday 14 November, ${new Date(c.due).toTimeString().slice(0, 5)})`).join('\n')}`);
assert.match(await L.execute({ due: 'this week' }), new RegExp(`^${counts.week} open to-dos? due this week:`));
assert.match(await L.execute({ due: 'friday' }), /^1 open to-do due Friday 20 November:\n- c\d+: Grant draft \(due Friday 20 November, 12:00\)$/);
assert.match(await L.execute({ due: '2026-11-19' }), /^1 open to-do due Thursday 19 November:\n- c\d+: mail bo /);
assert.equal(await L.execute({ due: 'overdue' }), 'No open to-do is overdue.');
clock = at(21, 8); assert.match(await L.execute({ due: 'overdue' }), /^\d+ open to-dos overdue:\n[^]*Grant draft \(due Friday 20 November, 12:00, OVERDUE\)/); clock = at(14, 8);
assert.match(await L.execute({ words: 'oat milk' }), new RegExp(`^1 open to-do with "oat milk" in the title:\\n- ${todoOf(milk).id}: Buy oat milk \\(on the calendar Saturday 14 November, 19:00 to 19:20\\)$`));
assert.match(await L.execute({ words: 'extra' }), /^7 open to-dos with "extra" in the title:/);
assert.match(await L.execute({ quadrant: 'urgent' }), /^1 open to-do urgent, not important:\n- c\d+: Buy oat milk/);
assert.match(await L.execute({ quadrant: 'important', words: 'grant' }), /^1 open to-do with "grant" in the title, and important, not urgent:/);
assert.equal(await L.execute({ words: 'zebra' }), 'No open to-do is with "zebra" in the title.');
await assert.rejects(L.execute({ due: 'whenever' }), /due is "today", "tomorrow", a weekday, YYYY-MM-DD, "this week", "overdue" or "none"\./);
assert.match(await T('show_matrix').execute({}), /^Urgent and important: \d+\nImportant, not urgent: \d+\nUrgent, not important: 1\nNeither urgent nor important: \d+\nNot sorted yet: \d+\nTitles: list_commitments with quadrant, when they ask\.$/);
// a task of a to-do deleted in the app, seen while a tool runs: the model is told of it without the title
const delTask = hand('Deleted soon'); await cal.sync('timer'); app.tasks.delete(delTask.id);
const told = await L.execute({ due: 'overdue' });
assert.equal(told, 'No open to-do is overdue.', 'a task deleted in the app, seen while a tool runs: the result has nothing of it');
assert.deepEqual(cal.takeHeld().asks.map((a) => a.title), ['Deleted soon'], 'the bubble has it');

// ---- 9. the same in sidekick.mjs, tools.mjs and the briefing notes: no list is put together for the model
const side = fs.readFileSync(new URL('../sidekick.mjs', import.meta.url), 'utf8');
assert.ok(side.includes('const memory = `${cal.outline()}\n') && !side.includes('Open commitments:') && !side.includes('function commitmentsText') && !side.includes('function doneTodayText'), 'the memory section is the outline');
assert.ok(side.includes('commitmentsText: () => cal.outline(),'), 'and upstream\'s list_commitments, were it ever left in, has nothing else to give');
assert.ok(side.includes("adopt: async (text, due) => { const c = await addCommitment(text, due, 'commitment', { reminded: due !== null && due <= Date.now() });"), 'a task adopted with a due time already past gets no nudge');
assert.ok(side.includes('if (!adoptOffered && cal.adoptable()) {'), 'the first-time question waits for a quiet moment, once per start');
// 2026-11-19: the offer of a block is the app's own bubble; only a yes hands that one to-do to the model, to ask for the day and time
assert.ok(side.includes('for (const o of offers) {') && side.includes('await cal.askOffer(o)'));
assert.ok(/book: \(\{ todo, title \}\) => enqueue\(`\(System, not \$\{userName\}: in a bubble of the app's own, \$\{userName\} has just said yes to booking a calendar block for the to-do "\$\{title\}" \[\$\{todo\}\]/.test(side));
const pi = fs.readFileSync(new URL('../pi.mjs', import.meta.url), 'utf8');
assert.ok(pi.includes('from the outline at the end of this note (its numbers and today\'s plan; call no tool, and name no to-do that isn\'t in it)') && pi.includes('The app writes the day\'s review in their daily note and tells them its counts itself: don\'t repeat them, write no note, and call no tool.'), 'the evening briefing names no to-do and writes no note (feature 18)');

server.close(); server.closeAllConnections();
console.log('adoption tests: passed');
