// Local-only build, feature 31: the speaking budget and the quiet queue (quiet.mjs), the parts that need no app: the
// rules and their order, the hour's budget over a restart, what goes out of date, the order things are given in, the
// line worded here, "anything waiting?" said alone, the settings, and how sidekick.mjs puts everything said unasked
// through one gate. The real sidecar is in quiet-run.test.mjs (npm run test:all); the page's count in
// queue-page.test.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { QUEUE_ORDER, WAITING_PHRASES, WHY, createQuiet, isWaitingAsk, quietSummary } from '../quiet.mjs';
import { SPEAKING, SPEAKING_KINDS, STAND_RESERVED, codeReference, loadSettings, readState, settingsDefaults } from '../pi.mjs';
import { STAND_CAUGHT } from '../standdown.mjs';

const SRC = new URL('..', import.meta.url).pathname;
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'quiet-home-')));
const dir = path.join(home, 'Documents', 'roamies-pi'), file = path.join(dir, 'settings.json');
loadSettings(home);
const made = JSON.parse(fs.readFileSync(file, 'utf8'));
const put = (o) => fs.writeFileSync(file, JSON.stringify(o));

// ---- the settings
{
  assert.deepEqual(settingsDefaults(home).speaking, { perHour: 3, briefing: true, review: true, checkIn: true, deadlineAtRisk: true, calendarLine: true, notice: true, awayMinutes: 10, quietInCalls: true });
  assert.deepEqual(SPEAKING_KINDS, ['briefing', 'review', 'checkIn', 'deadlineAtRisk', 'calendarLine', 'notice']);
  assert.deepEqual(loadSettings(home).speaking, made.speaking);
  const bad = { perHour: [-1, 31, 2.5, '3', null], awayMinutes: [-1, 241, 1.5, '10'], quietInCalls: [1, 'yes', null], checkIn: [0, 'off'] };
  for (const [name, list] of Object.entries(bad)) for (const v of list) {
    put({ ...made, speaking: { ...made.speaking, [name]: v } });
    const s = loadSettings(home);
    assert.deepEqual(s.invalid, [{ name: `speaking.${name}`, using: SPEAKING[name].default }], `speaking.${name}: ${JSON.stringify(v)} is out`);
  }
  for (const [name, v] of [['perHour', 0], ['perHour', 30], ['awayMinutes', 0], ['awayMinutes', 240], ['quietInCalls', false], ['briefing', false]]) {
    put({ ...made, speaking: { ...made.speaking, [name]: v } });
    const s = loadSettings(home);
    assert.deepEqual([s.missing, s.invalid], [[], []], `speaking.${name}: ${JSON.stringify(v)} is in`); assert.equal(s.speaking[name], v);
  }
  const { quietInCalls, ...less } = made.speaking;
  put({ ...made, speaking: less });
  assert.deepEqual(loadSettings(home).missing, ['speaking.quietInCalls']); assert.equal(loadSettings(home).speaking.quietInCalls, true);
  put(made);
  const ref = codeReference().speaking;
  assert.deepEqual(ref.kinds, SPEAKING_KINDS); assert.deepEqual(ref.order, QUEUE_ORDER); assert.deepEqual(ref.why, WHY); assert.deepEqual(ref.waitingPhrases, WAITING_PHRASES);
  assert.deepEqual(ref.perHour, { min: 0, max: 30, wholeNumber: true, zero: 'nothing is given unasked: it all waits in the queue' }); assert.deepEqual(ref.awayMinutes, { min: 0, max: 240, wholeNumber: true, zero: 'off' });
}

// ---- "anything waiting?", said alone, is the app's; not a phrase stand down may take
{
  for (const yes of ['anything waiting?', 'Anything waiting', 'um, is anything waiting please', "what's waiting?", 'what did I miss', 'Jarvis, anything waiting?']) assert.ok(isWaitingAsk(yes), yes);
  for (const no of ['anything waiting for the bus', 'what is waiting for me at the lab', 'is the meeting waiting', 'waiting', '']) assert.ok(!isWaitingAsk(no), no);
  assert.ok(STAND_RESERVED().includes('anything waiting'), 'not a stand-down phrase');
}

// ---- the rules, one word each, in their order; the hour's budget, kept over a restart
{
  let t = new Date(2026, 10, 26, 10, 0).getTime();
  const logs = [], flags = { stood: false, away: false, call: false }, counts = [];
  const make = () => createQuiet({ home, log: (k, d) => logs.push([k, d]), now: () => t, stood: () => flags.stood, away: () => flags.away, call: () => flags.call, onCount: (n) => counts.push(n) });
  let q = make();
  assert.deepEqual(['notice', 'checkIn'].map(q.reason), [null, null]);
  flags.stood = flags.away = flags.call = true; assert.equal(q.reason('notice'), 'stood', 'stood down first');
  flags.stood = false; put({ ...made, speaking: { ...made.speaking, notice: false } });
  assert.equal(q.reason('notice'), 'off', 'then a kind switched off'); assert.equal(q.reason('checkIn'), 'away', 'then away');
  flags.away = false; assert.equal(q.reason('checkIn'), 'call', 'then a call');
  flags.call = false; put(made);
  // three an hour (the default), then the budget
  for (let i = 0; i < 3; i++) { assert.equal(q.offer({ kind: 'calendarLine', lines: [{ text: `line ${i}` }] }), true, `given ${i + 1}`); t += 60_000; }
  assert.equal(q.offer({ kind: 'notice', text: 'A notice.' }), false, 'the fourth waits');
  assert.deepEqual(logs.at(-1), ['quiet_queued', { kind: 'notice', why: 'budget' }]);
  assert.deepEqual(counts.at(-1), 1, 'the count is told');
  q = make(); // a restart: the hour and the queue are kept
  assert.equal(q.count(), 1); assert.equal(q.reason('briefing'), 'budget');
  t = new Date(2026, 10, 26, 11, 0).getTime() + 1; // an hour after the first
  assert.equal(q.reason('briefing'), null, 'one has left the hour');
  put({ ...made, speaking: { ...made.speaking, perHour: 0 } }); assert.equal(q.reason('briefing'), 'budget', 'perHour 0: none'); put(made);
  // an exchange ends: the queue is due, then given
  assert.equal(q.ready(), false);
  flags.stood = true; assert.equal(q.exchanged(), false, 'not while stood down'); flags.stood = false;
  assert.equal(q.exchanged(), true); assert.equal(q.ready(), true);
  const g = q.take(3);
  assert.deepEqual([g.summary, g.items.map((i) => i.text), g.left, g.stood], ['', ['A notice.'], 0, false]);
  assert.deepEqual(logs.at(-1), ['quiet_given', { by: 'exchange', items: 1, left: 0, stale: 0 }]);
  assert.equal(q.ready(), false); assert.equal(q.take(3), null, 'nothing more');
  assert.equal(q.exchanged(), false, 'an exchange with nothing waiting changes nothing');
  assert.equal(q.offer({ kind: 'notice', text: 'x' }), true, 'given now: giving the queue spent nothing from the budget');
  for (const [k, d] of logs) for (const v of Object.values(d)) assert.ok(typeof v === 'number' || [...WHY, ...QUEUE_ORDER, 'exchange', 'asked'].includes(v), `no words in the log: ${k}`);
}

// ---- most urgent first, at most so many; what went out of date is dropped and counted; the line worded here
{
  let t = new Date(2026, 10, 27, 10, 0).getTime();
  fs.writeFileSync(path.join(dir, 'state.json'), '{}');
  const logs = [], gone = new Set();
  const q = createQuiet({ home, log: (k, d) => logs.push([k, d]), now: () => t, stood: () => false, stale: (item, line) => gone.has(line?.text ?? item.data?.name) });
  q.hold({ kind: 'notice', text: 'Notice.' }, 'budget'); t += 1;
  q.hold({ kind: 'briefing', data: { name: 'evening' } }, 'away'); t += 1;
  q.hold({ kind: 'calendarLine', lines: [{ text: 'Over.', until: t + 1000 }, { text: 'Still on.', until: t + 3600_000 }, { text: 'No end.' }] }, 'call'); t += 1;
  q.hold({ kind: 'checkIn', data: { name: 'c1' } }, 'budget'); t += 1;
  q.hold({ kind: 'checkIn', data: { name: 'c2' } }, 'budget'); t += 1;
  q.hold({ kind: 'deadlineAtRisk', lines: [{ text: 'At risk.', until: t + 7200_000 }] }, 'budget'); t += 1;
  q.hold({ kind: 'review', data: { name: 'review' } }, 'off');
  assert.equal(q.count(), 7);
  t += 5000; gone.add('c2'); gone.add('evening');
  q.stoodDown({ pi: true, questions: 1 });
  assert.equal(q.exchanged(), true);
  const g = q.take(3);
  assert.equal(g.summary, 'While I stood down: pi was stopped; 1 question I had open was kept for later; 1 calendar line went by, its block over. Dropped as out of date: 1 check-in and 1 briefing.');
  assert.deepEqual(g.items.map((i) => i.kind), ['deadlineAtRisk', 'checkIn', 'review'], 'most urgent first, three at most'); assert.equal(g.left, 2); assert.equal(g.stood, true);
  assert.deepEqual(logs.filter(([k]) => k === 'quiet_stale'), [['quiet_stale', { kind: 'briefing', n: 1 }], ['quiet_stale', { kind: 'calendarLine', n: 1 }], ['quiet_stale', { kind: 'checkIn', n: 1 }]]);
  const rest = q.state().items;
  assert.deepEqual(rest.map((i) => i.kind), ['notice', 'calendarLine']); assert.deepEqual(rest[1].lines.map((l) => l.text), ['Still on.', 'No end.'], 'a line at a time');
  assert.equal(q.ready(), false, 'what is left waits for the next exchange');
  assert.equal(q.exchanged(), true); assert.deepEqual(q.take(3).items.map((i) => i.kind), ['calendarLine', 'notice'], 'a notice last');
  // the line, worded here
  assert.equal(quietSummary({}), '');
  assert.equal(quietSummary({ stale: { calendarLine: 2 } }), 'Dropped as out of date: 2 calendar lines.');
  assert.equal(quietSummary({ stale: { review: 1, deadlineAtRisk: 2 } }), 'Dropped as out of date: the day\'s review line (the review is in the daily note) and 2 deadline warnings.');
  assert.equal(quietSummary({ stood: { lines: 0 }, stale: { calendarLine: 2 } }), 'While I stood down: 2 calendar lines went by, their blocks over.', 'stand down\'s wording, as before');
  assert.equal(quietSummary({ stood: {}, stale: { review: 1 } }), 'While I stood down: the day\'s review was written in the daily note.');
  // only the line: given, even with nothing else
  q.stoodDown({ pi: true }); q.exchanged();
  assert.deepEqual(q.take(3), { summary: 'While I stood down: pi was stopped.', items: [], left: 0, stood: true });
  // a stand down that stopped nothing, with nothing out of date: nothing to say
  q.stoodDown({}); assert.equal(q.exchanged(), true); assert.equal(q.take(3), null); assert.equal(q.state().stood, null); assert.equal(q.ready(), false);
  // lines caught while stood down: kept up to STAND_CAUGHT, all given with the line
  for (let i = 0; i < STAND_CAUGHT + 4; i++) q.hold({ kind: 'caught', text: `caught ${i}` }, 'stood');
  q.hold({ kind: 'notice', text: 'n' }, 'budget');
  assert.equal(q.count(), STAND_CAUGHT + 1); q.exchanged();
  const c = q.take(1, 'asked');
  assert.equal(c.items.filter((i) => i.kind === 'caught').length, STAND_CAUGHT); assert.equal(c.items.at(-1).text, 'n');
  assert.deepEqual(logs.at(-1), ['quiet_given', { by: 'asked', items: STAND_CAUGHT + 1, left: 0, stale: 0 }]);
  assert.deepEqual(readState(dir).quiet.items, [], 'kept in state.json');
}

// ---- sidekick.mjs: one gate for everything said unasked
{
  const side = read('sidekick.mjs');
  assert.match(side, /function unasked\(item\) \{ return queue\.offer\(item\) \? giveItem\(item\)/);
  for (const k of ['notice', 'calendarLine', 'review', 'briefing']) assert.ok(side.includes(`kind: '${k}'`), `${k} goes through it`);
  assert.match(side, /if \(due\.length\) \{ const item = dailyDo\('checkins', \(\) => checks\.mark\(due\[0\]\)\); if \(item\) \{ logLine\('checkin_due', \{ how: due\[0\]\.how \}\); unasked\(item\); return; \} \}/, 'a check-in');
  assert.match(side, /const risk = dailyDo\('checkins', \(\) => checks\.atRisk\(\)\);\n\s*if \(risk\) unasked\(risk\);/, 'a deadline at risk');
  // reminders the owner set: never through it, and given whatever the budget says (late after a stand down)
  const remind = side.slice(side.indexOf('async function remindTick()'), side.indexOf('function reminderRetry()'));
  assert.ok(!remind.includes('unasked(') && !remind.includes('queue.'), 'reminders don\'t count and never wait in the queue');
  assert.match(remind, /const due = \(await takeDueReminders\(\)\)\.filter\(\(c\) => c\.kind === 'reminder'\);/, 'a to-do gets a check-in instead (the owner, 2026-11-25)');
  // given at the end of the owner's next exchange: a typed request's reply, or a spoken exchange's end (flow.mjs)
  assert.match(side, /queue: \{ due: \(\) => !!queue\?\.ready\(\), run: \(\) => quietGive\('exchange'\) \}/);
  assert.match(side, /if \(own && !flow\.spoken\(\)\) queue\?\.exchanged\(\);/);
  assert.match(side, /if \(!area\?\.file && isWaitingAsk\(text\)\) \{ ui\(\{ kind: 'heard' \}\); waitingAsked\(true\); return; \}/, '"anything waiting?" spoken: the app answers');
  assert.match(side, /if \(isWaitingAsk\(text\)\) waitingAsked\(false\); else (?:if \(isLeftAsk\(text\)\) leftAsked\(\); else )?enqueue/, 'and typed');
  assert.match(side, /quietGive\('asked'\)\.then\(\(gave\) => \{ if \(!gave\) aloud\('Nothing is waiting\.', 'happy'\); \}/);
  // away and on a call: the shell's two numbers only; Roamies' own listening is not a call
  assert.match(side, /else if \(m\.type === 'presence'\) presenceSeen\(m\);/);
  assert.match(side, /presence = \{ idle: Number\.isFinite\(m\.idle\) \? Math\.max\(0, m\.idle\) : null, mic: m\.mic === true, at: Date\.now\(\) \};/, 'nothing else is read from it');
  assert.match(side, /const callNow = \(\) => speakingNow\(\)\.quietInCalls && [^\n]*voiceState === 'idle' && !micWindow && Date\.now\(\) - ownMicAt > OWN_MIC_MS;/);
  assert.match(side, /logLine\('presence', JSON\.parse\(now_\)\)/, 'logged as true/false when it changes');
  // the count on the character: a page setting, hidden while stood down
  assert.match(side, /const PAGE_SETTINGS = new Set\(\[[^\]]*'queue'\]\);/); assert.match(side, /ui\(\{ kind: 'queue', n: stood\?\.on\(\) \? 0 : queue\.count\(\) \}\)/);
  // nothing of it goes to the model
  for (const f of ['quiet.mjs', 'checkin.mjs']) assert.ok(!/enqueue|oneShot|fetch\(|http|agent\./.test(read(f)), `${f} makes no request`);
  const giving = side.slice(side.indexOf('async function giveItem('), side.indexOf('function checkTick()'));
  assert.ok(!/enqueue\(/.test(giving.replace('runBriefing(b)', '')), 'the queue is given by the app (a briefing is its own request, as always)');
  // the shell sends the two readings (presence.rs) and nothing else
  const rs = fs.readFileSync(path.join(SRC, '..', 'src-tauri', 'src', 'presence.rs'), 'utf8');
  assert.match(rs, /json!\(\{ "type": "presence", "idle": idle\.map\(\|s\| s\.floor\(\) as u64\), "mic": mic\.unwrap_or\(false\) \}\)/);
  assert.match(fs.readFileSync(path.join(SRC, '..', 'src-tauri', 'src', 'main.rs'), 'utf8'), /presence::start\(app\.handle\(\)\.clone\(\)\);/);
}

fs.rmSync(home, { recursive: true, force: true });
console.log('quiet queue tests: passed');
