// Local-only build, feature 25: check-ins (checkin.mjs) and the Plan's boxes (daily.mjs), with the daily note in a
// throwaway home folder: when a check-in is due (a block's end, a due time, not in the middle of a block, the day's
// limit, again after "still on it", none after the review), the answers as said (one table), what each does and its
// line in the Log, what makes one in the queue out of date, a box ticked in Obsidian, and deadlines at risk.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CHECK_AGAIN_TIMES, checkQuestion, createCheckIns, dueWords, parseCheckIn } from '../checkin.mjs';
import { createDaily } from '../daily.mjs';
import { THIRD, Unanswered, createAnswers } from '../answers.mjs';
import { loadSettings, readState } from '../pi.mjs';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-home-')));
const dir = path.join(home, 'Documents', 'roamies-pi'), settingsFile = path.join(dir, 'settings.json');
const vault = path.join(home, 'Documents', 'roamies-vault');
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
let clock = at(26, 8);
loadSettings(home);
const made = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
const todos = [
  { id: 'a', text: 'Write methods', kind: 'commitment', status: 'open', due: null, doneAt: null },
  { id: 'b', text: 'Send slides', kind: 'commitment', status: 'open', due: at(26, 11, 30), doneAt: null },
  { id: 'c', text: 'Analyse plates', kind: 'commitment', status: 'open', due: null, doneAt: null },
  { id: 'e', text: 'Grant report', kind: 'commitment', status: 'open', due: at(27, 10), doneAt: null },
  { id: 'r', text: 'Stretch', kind: 'reminder', status: 'open', due: at(26, 10, 30), doneAt: null },
];
const blocks = { a: { start: at(26, 9), minutes: 60, kept: false }, c: { start: at(26, 10), minutes: 120, kept: false } };
const logs = [];
const daily = createDaily({ home, userName: 'Tiago', todos: () => todos.map((t) => ({ ...t })), blocks: () => ({ ...blocks }), log: (k, d) => logs.push([k, d]), now: () => clock });
const checks = createCheckIns({ home, daily, todos: () => todos.map((t) => ({ ...t })), blocks: () => ({ ...blocks }), log: (k, d) => logs.push([k, d]), now: () => clock });
const note = (key = '2026-11-26') => fs.readFileSync(path.join(vault, 'Daily', `${key}.md`), 'utf8');
const ids = (list) => list.map((c) => `${c.id}:${c.how}`);

// ---- the answers, as said: one table
{
  const opts = { now: at(26, 15), dayStart: 540, dayEnd: 1080 };
  const table = {
    done: ['done', 'Done.', 'yes', 'yes, done', "it's done", 'all done', 'finished', 'I did it', 'um, done please'],
    still: ['still on it', 'Still working on it.', "I'm on it", 'almost done', 'in progress'],
    notyet: ['not yet', 'no', 'nope', 'not done yet', 'not finished'],
    none: ['maybe', 'done and dusted', 'not yet, sometime', 'leave it', 'drop it', 'next friday', ''],
  };
  for (const [kind, list] of Object.entries(table)) for (const t of list) assert.deepEqual(parseCheckIn(t, opts), kind === 'none' ? null : { kind }, `"${t}"`);
  assert.deepEqual(parseCheckIn('not yet, tomorrow at 10', opts), { kind: 'notyet', when: { kind: 'at', start: at(27, 10) } });
  assert.deepEqual(parseCheckIn("no, I'll do it Friday at 2pm", opts), { kind: 'notyet', when: { kind: 'at', start: at(27, 14) } });
  assert.deepEqual(parseCheckIn('not yet, by Monday', opts), { kind: 'notyet', when: { kind: 'day', day: new Date(2026, 10, 30) } });
  assert.deepEqual(parseCheckIn('not yet, leave it', opts), { kind: 'notyet', when: { kind: 'leave' } });
  assert.deepEqual(parseCheckIn('tomorrow at 10', opts), { kind: 'notyet', when: { kind: 'at', start: at(27, 10) } }, 'a time alone is a "not yet"');
  assert.equal(checkQuestion('block', 'Write methods', 0), 'Your block for Write methods has ended. Is it done?');
  assert.equal(checkQuestion('due', 'Send slides', at(26, 11, 30)), 'Send slides was due at 11:30. Is it done?');
  assert.equal(checkQuestion('again', 'Send slides', 0), 'Is Send slides done now?');
  assert.equal(dueWords(at(27, 10), at(26, 15)), 'tomorrow at 10:00'); assert.equal(dueWords(at(26, 17), at(26, 15)), 'today at 17:00'); assert.equal(dueWords(at(28, 9, 5), at(26, 15)), 'Saturday at 09:05');
}

// ---- the three buttons answer by position (the third with THIRD, host.js)
{
  for (const [click, want] of [['yes', 'done'], ['second', 'still'], [THIRD, 'notyet'], [null, null]]) {
    let shown = null;
    const answers = createAnswers({ ask: async (o) => { shown = o; return click; } });
    const a = await answers.ask({ placeholder: 'Is it done?', choices: ['Done', 'Still on it', 'Not yet'], clicks: [{ kind: 'done' }, { kind: 'still' }, { kind: 'notyet' }], parse: () => null, hint: 'x' });
    assert.deepEqual(a, want ? { kind: want } : null, `${click}`); assert.equal(shown.third, THIRD); assert.equal(shown.second, 'second');
  }
  let shown = null;
  await createAnswers({ ask: async (o) => { shown = o; return null; } }).ask({ placeholder: 'q', choices: ['Leave it', 'Drop it'], clicks: [{ kind: 'leave' }, { kind: 'drop' }], parse: () => null, hint: 'x' });
  assert.equal(shown.third, undefined, 'two buttons: no third');
}

// ---- when: at a block's end; a due time, not in the middle of a block; once for each time; the day's limit
const said = [], done = [], moved = [];
let script = [];
const io = {
  ask: async (o) => { const a = script.shift(); io.asked.push(o); if (a instanceof Error) throw a; return typeof a === 'string' ? o.parse(a) : a; }, asked: [],
  say: async (t) => { said.push(t); }, done: async (id) => { done.push(id); const t = todos.find((x) => x.id === id); t.status = 'done'; t.doneAt = clock; delete blocks[id]; },
  reschedule: async (id, when) => { moved.push([id, when]); const t = todos.find((x) => x.id === id); if (when.start && blocks[id]) blocks[id] = { ...blocks[id], start: when.start }; else t.due = when.start ?? when.day.getTime(); return { ok: true, line: 'Moved.' }; },
};
{
  daily.ensure(); // the Plan, with its boxes
  assert.match(note(), /- \[ \] 09:00 to 10:00 Write methods \^td-a\n/);
  clock = at(26, 9, 59); assert.deepEqual(checks.due(), [], 'nothing before the block ends');
  clock = at(26, 10, 0, 30); assert.deepEqual(ids(checks.due()), ['a:block'], 'at its end, though the next block starts then');
  assert.equal(checks.due()[0].question, 'Your block for Write methods has ended. Is it done?');
  const item = checks.mark(checks.due()[0]);
  assert.deepEqual(item, { kind: 'checkIn', data: { key: '2026-11-26', id: 'a', at: at(26, 10), how: 'block', title: 'Write methods', question: 'Your block for Write methods has ended. Is it done?' }, until: at(27, 4) });
  assert.deepEqual(checks.due(), [], 'once for that time');
  // done: marked done, and its line comes from the regular check
  script = ['done'];
  assert.equal(await checks.ask(item, io), 'done');
  assert.deepEqual(done, ['a']); assert.equal(said.at(-1), 'Write methods: marked done.');
  daily.tick(); assert.match(note(), /- 10:00 Done: Write methods\n$/);
  assert.deepEqual(logs.at(-2), ['checkin', { how: 'block', answer: 'done' }]);
  // the due time passes in the middle of c's block (10:00 to 12:00): it waits for that block to end
  clock = at(26, 11, 31); assert.deepEqual(checks.due(), [], 'not in the middle of a block');
  clock = at(26, 12, 0, 30); assert.deepEqual(ids(checks.due()), ['b:due', 'c:block'], 'when it ends; soonest first');
  assert.equal(checks.due()[0].question, 'Send slides was due at 11:30. Is it done?');
  // the reminder never gets one
  assert.ok(!checks.due().some((c) => c.id === 'r'));
}

// ---- still on it: again later, not in the middle of a block, at most CHECK_AGAIN_TIMES; still open at the review
{
  const b = checks.mark(checks.due()[0]);
  script = ['still on it'];
  assert.equal(await checks.ask(b, io), 'still');
  assert.match(note(), /- 12:00 Check-in: Send slides: still on it\n$/);
  clock = at(26, 12, 20); assert.deepEqual(ids(checks.due()), ['c:block'], 'not before limits.checkInAgainMinutes (30)');
  const c = checks.mark(checks.due()[0]);
  script = [new Unanswered()];
  assert.equal(await checks.ask(c, io), 'none', 'no answer: nothing changes');
  assert.match(note(), /- 12:20 Check-in: Analyse plates: no answer\n$/);
  assert.equal(todos.find((t) => t.id === 'c').status, 'open'); assert.equal(io.asked.at(-1).pending, undefined, 'not kept as a pending question');
  blocks.x = { start: at(26, 12, 25), minutes: 60, kept: false }; // something else runs from 12:25
  clock = at(26, 12, 31); assert.deepEqual(checks.due(), [], 'again, but in the middle of a block');
  clock = at(26, 13, 25, 30); assert.deepEqual(ids(checks.due()), ['b:again'], 'once that block has ended');
  assert.equal(checks.due()[0].question, 'Is Send slides done now?');
  delete blocks.x;
  let again = checks.mark(checks.due()[0]); script = ['still on it']; await checks.ask(again, io);
  clock = at(26, 14); again = checks.mark(checks.due()[0]); script = [new Unanswered()]; await checks.ask(again, io);
  assert.equal(readState(dir).daily.days['2026-11-26'].checks.b.answer, 'still', 'no answer to the one asked again: "still on it" stands');
  clock = at(26, 15); assert.deepEqual(checks.due(), [], `at most ${CHECK_AGAIN_TIMES} times again`);
  assert.equal(readState(dir).daily.days['2026-11-26'].checks.b.again, CHECK_AGAIN_TIMES);
}

// ---- not yet: with a time, read as "When will you do it?" is; alone, that question is asked
{
  todos.push({ id: 'n', text: 'Order reagents', kind: 'commitment', status: 'open', due: at(26, 14, 30), doneAt: null });
  todos.push({ id: 'm', text: 'Email Bo', kind: 'commitment', status: 'open', due: at(26, 14, 40), doneAt: null });
  clock = at(26, 15);
  assert.deepEqual(ids(checks.due()), ['n:due'], 'five asked so far: one left of the six');
  fs.writeFileSync(settingsFile, JSON.stringify({ ...made, limits: { ...made.limits, checkInsPerDay: 10 } }));
  assert.deepEqual(ids(checks.due()), ['n:due', 'm:due']);
  script = ['not yet, tomorrow at 10'];
  const n = checks.mark(checks.due()[0]);
  assert.equal(await checks.ask(n, io), 'notyet');
  assert.deepEqual(moved.at(-1), ['n', { start: at(27, 10) }]); assert.equal(said.at(-1), 'Moved.');
  assert.match(note(), /- 15:00 Rescheduled: Order reagents → Friday 27 November, 10:00\n$/);
  script = ['not yet', { kind: 'leave' }];
  const m = checks.mark(checks.due()[0]);
  assert.equal(await checks.ask(m, io), 'notyet');
  assert.equal(io.asked.at(-1).placeholder.split('\n')[0], 'When will you do Email Bo?'); assert.deepEqual(io.asked.at(-1).choices, ['Leave it', 'Drop it']);
  assert.equal(readState(dir).daily.days['2026-11-26'].answered.m, 'left');
  assert.deepEqual(logs.filter(([k]) => k === 'checkin').at(-1), ['checkin', { how: 'due', answer: 'notyet', then: 'left' }]);
  fs.writeFileSync(settingsFile, JSON.stringify(made));
}

// ---- the day's limit (limits.checkInsPerDay, 6 by default): a, b, c, b again twice, n, m make 7 asked
{
  todos.push({ id: 'p', text: 'Print poster', kind: 'commitment', status: 'open', due: at(26, 15, 10), doneAt: null });
  clock = at(26, 15, 20); assert.deepEqual(checks.due(), [], 'the limit is reached');
  fs.writeFileSync(settingsFile, JSON.stringify({ ...made, limits: { ...made.limits, checkInsPerDay: 8 } }));
  assert.deepEqual(ids(checks.due()), ['p:due']);
  fs.writeFileSync(settingsFile, JSON.stringify(made));
}

// ---- in the queue: out of date when the to-do is done or moved, when the review has run, when the day turns
{
  const item = { kind: 'checkIn', data: { key: '2026-11-26', id: 'p', at: at(26, 15, 10), how: 'due' } };
  assert.equal(checks.stale(item), false);
  todos.find((t) => t.id === 'p').due = at(26, 16); assert.equal(checks.stale(item), true, 'moved');
  todos.find((t) => t.id === 'p').due = at(26, 15, 10); todos.find((t) => t.id === 'p').status = 'done'; assert.equal(checks.stale(item), true, 'done');
  todos.find((t) => t.id === 'p').status = 'open';
  // the review: Send slides was answered "still on it": still open, not missed, and not asked about (the owner, 2026-11-25)
  clock = at(26, 18);
  const r = daily.review();
  assert.deepEqual(r.rows.map((x) => `${x.title}:${x.status}`).sort(), ['Analyse plates:missed', 'Email Bo:missed', 'Print poster:missed', 'Send slides:open', 'Write methods:done'], 'Order reagents was moved to tomorrow');
  assert.deepEqual(daily.questions('review').map((q) => q.title), ['Analyse plates', 'Print poster'], 'Email Bo was answered "leave it" in its check-in');
  assert.equal(checks.stale(item), true, 'the review has run'); assert.deepEqual(checks.due(), [], 'and none comes after it');
  // the next morning, Send slides needs a new time like any other
  clock = at(27, 9);
  assert.ok(daily.planFor(daily.today()).needs.some(({ t }) => t.id === 'b'));
  assert.equal(checks.stale({ ...item, data: { ...item.data } }), true, 'the day has turned');
}

// ---- a box ticked in the Plan, in Obsidian: that to-do is marked done, once; an untick does nothing
{
  daily.ensure(); // Friday's Plan
  const key = '2026-11-27', file = path.join(vault, 'Daily', `${key}.md`);
  assert.match(note(key), /- \[ \] Send slides \(was Thursday 26 November, 11:30\) \^td-b\n/);
  const ticked = [];
  fs.writeFileSync(file, note(key).replace('- [ ] Send slides', '- [x] Send slides'));
  assert.equal(await daily.checkTicks(async (id) => { ticked.push(id); }), 1);
  assert.deepEqual(ticked, ['b']); assert.deepEqual(logs.at(-1), ['plan_ticked', { todos: 1 }]);
  clock += 6 * 60_000;
  assert.equal(await daily.checkTicks(async (id) => { ticked.push(id); }), 0, 'once');
  fs.writeFileSync(file, note(key).replace('- [x] Send slides', '- [ ] Send slides'));
  clock += 6 * 60_000;
  assert.equal(await daily.checkTicks(async (id) => { ticked.push(id); }), 0, 'an untick does nothing'); assert.deepEqual(ticked, ['b']);
  // and at most every few minutes
  assert.match(note(key), /- \[ \] Grant report \(due 10:00\) \^td-e\n/);
  fs.writeFileSync(file, note(key).replace('- [ ] Grant report', '- [x] Grant report'));
  assert.equal(await daily.checkTicks(async () => {}), 0, 'not read again within TICKS_MINUTES');
  clock += 6 * 60_000;
  assert.equal(await daily.checkTicks(async (id) => { ticked.push(id); }), 1); assert.deepEqual(ticked, ['b', 'e']);
}

// ---- deadlines at risk: due within limits.atRiskHours (24), no block ending before the due time; said once each
{
  clock = at(26, 11); // Grant report is due tomorrow at 10:00, with no block
  fs.rmSync(path.join(dir, 'state.json'));
  todos.splice(0, todos.length, { id: 'e', text: 'Grant report', kind: 'commitment', status: 'open', due: at(27, 10), doneAt: null }, { id: 'f', text: 'Far', kind: 'commitment', status: 'open', due: at(28, 10), doneAt: null }, { id: 'g', text: 'Booked', kind: 'commitment', status: 'open', due: at(26, 17), doneAt: null });
  for (const k of Object.keys(blocks)) delete blocks[k];
  blocks.g = { start: at(26, 15), minutes: 60, kept: false };
  const r = checks.atRisk();
  assert.deepEqual(r, { kind: 'deadlineAtRisk', lines: [{ id: 'e', due: at(27, 10), until: at(27, 10), text: 'Grant report is due tomorrow at 10:00 and has no time planned before then.' }] });
  assert.equal(checks.atRisk(), null, 'once for that due time');
  assert.equal(checks.riskStale(r.lines[0]), false);
  blocks.e = { start: at(27, 8), minutes: 60, kept: false }; assert.equal(checks.riskStale(r.lines[0]), true, 'a block before its due time now');
  delete blocks.e; todos[0].due = at(27, 11); assert.equal(checks.riskStale(r.lines[0]), true, 'a new due time');
  assert.deepEqual(checks.atRisk().lines.map((l) => l.id), ['e'], 'said again for the new due time');
  blocks.e = { start: at(27, 10, 30), minutes: 60, kept: false }; todos[0].due = at(27, 10, 45);
  assert.deepEqual(checks.atRisk().lines.map((l) => l.id), ['e'], 'a block that ends after the due time does not count');
  assert.deepEqual(logs.filter(([k]) => k === 'deadline_at_risk').at(-1), ['deadline_at_risk', { todos: 1 }]);
}

// ---- the log has no words
for (const [k, d] of logs) for (const v of Object.values(d ?? {})) assert.ok(typeof v !== 'string' || /^[a-z]+$/.test(v), `${k}: ${v}`);

fs.rmSync(home, { recursive: true, force: true });
console.log('check-in tests: passed');
