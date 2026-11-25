// Local-only build, feature 33: stand down (standdown.mjs), the parts that need no app: the phrase said alone (one
// table with the shell's matcher, stand.rs), the settings, the state that a restart keeps, the line said when it ends,
// the calendar lines whose block has ended, and how sidekick.mjs holds everything that is said or shown unasked.
// The questions it closes are in flow.test.mjs, the page in stand-page.test.mjs, the real sidecar in
// standdown-run.test.mjs (npm run test:all), the shell's matcher in cargo test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { STAND_CAUGHT, STAND_FILL, createStandDown, isStandDown, standFill, standSummary, standWords } from '../standdown.mjs';
import { STAND_DOWN, codeReference, loadSettings, readState, settingsDefaults } from '../pi.mjs';
import { createCalendar } from '../calendar.mjs';

const SRC = new URL('..', import.meta.url).pathname;
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

// ---- the phrase, said alone: one table for this matcher and the shell's
{
  const t = JSON.parse(read('test/stand-phrases.json'));
  assert.deepEqual(standFill({ name: 'Jarvis', address: 'sir' }), t.fill, 'the small words, as the sidecar sends them for the default persona');
  for (const s of ['Jarvis, stand down, please', 'okay Jarvis, stand down now please']) assert.ok(t.fires.includes(s), `the owner's case is in the table: ${s}`);
  for (const s of ['take a note: the committee will stand down in March', "that's enough for today, you can stand down"]) assert.ok(t.quiet.includes(s), `the owner's case is in the table: ${s}`);
  for (const s of t.fires) assert.ok(isStandDown(s, t.phrase, t.fill), `fires: ${s}`);
  for (const s of t.quiet) assert.ok(!isStandDown(s, t.phrase, t.fill), `does nothing: ${s}`);
  assert.deepEqual(standWords("Stand-down, JARVIS! ma'am"), ['stand', 'down', 'jarvis', 'maam']);
  assert.deepEqual(STAND_FILL, ['please', 'now', 'okay', 'ok']);
  assert.deepEqual(standFill({ name: 'Friday', address: '' }), ['please', 'now', 'okay', 'ok', 'friday'], 'another persona: its name, and no form of address');
  assert.ok(!isStandDown('jarvis stand down', 'stand down', standFill({ name: 'Friday', address: '' })), 'a name that is not the persona\'s is a word like any other');
  assert.ok(isStandDown('Friday, at ease', 'at ease', standFill({ name: 'Friday' })), 'another phrase');
  assert.ok(!isStandDown('stand down', [], STAND_FILL));
  // the shell has the same rule, the same wait, and the same table
  const rs = fs.readFileSync(path.join(SRC, '..', 'src-tauri', 'src', 'stand.rs'), 'utf8'), voice = fs.readFileSync(path.join(SRC, '..', 'src-tauri', 'src', 'voice.rs'), 'utf8');
  assert.ok(rs.includes('include_str!("../../sidecar/test/stand-phrases.json")'), 'cargo test reads this table');
  // the wait: the setting's default and bounds are the shell's, sent with the keys, read by the shell, used by the take
  const w = STAND_DOWN.waitSeconds, ms = (n) => Number(rs.match(new RegExp(`pub const ${n}: u64 = (\\d+);`))[1]);
  assert.deepEqual([ms('WAIT_MS'), ms('WAIT_MIN_MS'), ms('WAIT_MAX_MS')], [w.default * 1000, w.min * 1000, w.max * 1000], 'the same wait and bounds');
  assert.match(read('sidekick.mjs'), /return \{ shortcut: s\.shortcut, phrase, fill, wait: s\.waitSeconds \};/, 'sent with the keys');
  assert.ok(fs.readFileSync(path.join(SRC, '..', 'src-tauri', 'src', 'main.rs'), 'utf8').includes('set_stand(words("phrase"), words("fill"), st.get("wait").and_then(Value::as_f64));'), 'read by the shell');
  assert.match(voice, /s\.wait_ms = crate::stand::wait_ms\(wait_seconds\);/); assert.match(voice, /thread::sleep\(Duration::from_millis\(wait\)\);/, 'and waited for');
  // what was heard is never logged: the shell sends only who stood it down
  assert.match(voice, /to_sidecar\(app, &json!\(\{ "type": "stand_down", "by": by \}\)\);/);
  assert.match(voice, /if fired \{\n\s*return;\n\s*\}\n\s*if phrase \{\n\s*stand_down\(app, "phrase"\);\n\s*return;\n\s*\}/, 'the final words of a take that stood it down go nowhere');
}

// ---- the settings
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'stand-home-')));
const dir = path.join(home, 'Documents', 'roamies-pi'), file = path.join(dir, 'settings.json');
loadSettings(home);
const made = JSON.parse(fs.readFileSync(file, 'utf8'));
const put = (o) => fs.writeFileSync(file, JSON.stringify(o));
{
  assert.deepEqual(settingsDefaults(home).standDown, { phrase: 'stand down', shortcut: 'Control+Alt+Period', endsAtDayTurn: true, waitSeconds: 1.5 });
  assert.deepEqual(loadSettings(home).standDown, made.standDown);
  const ref = codeReference().standDown;
  assert.deepEqual(ref.smallWords, STAND_FILL); assert.equal(ref.caughtLinesKept, STAND_CAUGHT); assert.match(ref.heardFor, /standDown\.waitSeconds/); assert.deepEqual(ref.waitSeconds, { min: 0.5, max: 3 });
  const bad = { phrase: ['send', 'Yes', 'thanks', 'drop it', 'review my day', 'please now', 'jarvis', 'one two three four five', 'stand2', 'stand_down', '', ' ', 'x'.repeat(41), 7, null], shortcut: ['Escape', 'Period', 'Control+Alt', 'Control+Alt+', 'Hyper+KeyS', 'Control+Alt+Period+', 'Control+Alt+Shift', 3, ''], endsAtDayTurn: ['yes', 1, null], waitSeconds: [0.4, 3.1, 0, -1, '1.5', null, true] };
  for (const [name, list] of Object.entries(bad)) for (const v of list) {
    put({ ...made, standDown: { ...made.standDown, [name]: v } });
    const s = loadSettings(home);
    assert.deepEqual(s.invalid, [{ name: `standDown.${name}`, using: STAND_DOWN[name].default }], `standDown.${name}: ${JSON.stringify(v)} is out`);
    assert.equal(s.standDown[name], STAND_DOWN[name].default);
  }
  for (const [name, v] of [['phrase', 'At ease'], ['phrase', "that'll do"], ['shortcut', 'Command+Shift+KeyD'], ['shortcut', 'Control+Alt+Period'], ['endsAtDayTurn', false], ['waitSeconds', 0.5], ['waitSeconds', 3], ['waitSeconds', 2.25]]) {
    put({ ...made, standDown: { ...made.standDown, [name]: v } });
    const s = loadSettings(home);
    assert.deepEqual([s.missing, s.invalid], [[], []], `standDown.${name}: ${JSON.stringify(v)} is in`); assert.equal(s.standDown[name], v);
  }
  const { endsAtDayTurn, waitSeconds, ...two } = made.standDown;
  put({ ...made, standDown: two });
  assert.deepEqual(loadSettings(home).missing, ['standDown.endsAtDayTurn', 'standDown.waitSeconds'], 'the parts missing: named alone'); assert.equal(loadSettings(home).standDown.endsAtDayTurn, true); assert.equal(loadSettings(home).standDown.waitSeconds, 1.5);
  put(made);
}

// ---- the state: one log line when it starts and one when it ends, kept over a restart; at its end what it stopped is
// handed to the quiet queue (feature 31, quiet.test.mjs), which says it and gives what it held
{
  let t = new Date(2026, 10, 25, 22, 0).getTime();
  const logs = [];
  const make = () => createStandDown({ home, log: (k, d) => logs.push([k, d]), now: () => t });
  const sd = make();
  assert.equal(sd.on(), false);
  assert.equal(sd.start('key', { speech: true, request: 1, pi: false, window: 0, bubbles: 'yes' }), true);
  assert.deepEqual(logs, [['stand_down', { by: 'key', speech: true, request: true, pi: false, window: false, bubbles: true }]], 'true/false only');
  assert.equal(sd.start('phrase', { speech: true }), false, 'already stood down: nothing more'); assert.equal(logs.length, 1);
  sd.add({ pi: true, processes: 2 }); sd.add({ questions: 1 }); sd.add({ pi: false, processes: 1 });
  // a restart: it is still on, with what it had gathered
  const again = make();
  assert.equal(again.on(), true); assert.deepEqual(again.state().counts, { pi: true, processes: 3, questions: 1 });
  t += 95 * 60_000;
  assert.equal(again.turned(), false, 'the day has not turned');
  const ended = again.end('voice', 4);
  assert.deepEqual(ended, { by: 'voice', minutes: 95, counts: { pi: true, processes: 3, questions: 1 } }, 'what it stopped, for the queue');
  assert.deepEqual(logs.at(-1), ['stand_down_end', { by: 'voice', minutes: 95, held: 4 }]);
  assert.equal(again.end('voice'), null, 'once');
  assert.equal(readState(dir).standDown, undefined, 'ended: forgotten here'); assert.equal(make().on(), false);
  // the day turn ends it when the setting says so (calendar.dayTurnsAt, 04:00 by default)
  const sd2 = make(); t = new Date(2026, 10, 25, 23, 30).getTime();
  sd2.start('phrase');
  t = new Date(2026, 10, 26, 3, 59).getTime(); assert.equal(sd2.turned(), false, '03:59: still the same day');
  t = new Date(2026, 10, 26, 4, 0).getTime(); assert.equal(sd2.turned(), true, '04:00: the day has turned');
  put({ ...made, standDown: { ...made.standDown, endsAtDayTurn: false } }); assert.equal(sd2.turned(), false, 'endsAtDayTurn false: it lasts'); put(made);
  assert.deepEqual(sd2.end('day').counts, {});
  // an old state.json, from before the queue (ended, its line not given yet): not taken for a stand down that lasts
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ ...readState(dir), standDown: { on: false, since: new Date(t).toISOString(), counts: { lines: 1 }, caught: [], exchanged: false } }));
  assert.equal(make().on(), false);
  // the logs hold no words: only these two kinds, with true/false and numbers
  for (const [k, d] of logs) { assert.ok(['stand_down', 'stand_down_end'].includes(k)); for (const v of Object.values(d)) assert.ok(typeof v === 'boolean' || typeof v === 'number' || ['key', 'phrase', 'voice', 'typed', 'day'].includes(v)); }
}

// ---- the line said when it ends, worded here
assert.equal(standSummary({}), '');
assert.equal(standSummary({ pi: true }), 'While I stood down: pi was stopped.');
assert.equal(standSummary({ pi: true, processes: 1 }), 'While I stood down: pi was stopped and 1 process it had left running was ended.');
assert.equal(standSummary({ pi: true, processes: 3, questions: 2, lines: 1 }), 'While I stood down: pi was stopped and 3 processes it had left running were ended; 2 questions I had open were kept for later; 1 calendar line went by, its block over.');
assert.equal(standSummary({ questions: 1, lines: 4, review: true }), 'While I stood down: 1 question I had open was kept for later; 4 calendar lines went by, their blocks over; the day\'s review was written in the daily note.');

// ---- the calendar: stood down, its lines are taken for the quiet queue with the end of the block each is about (one
// whose block has ended is dropped there, and counted); its questions stay on the pile for a quiet moment
{
  let clock = new Date(2026, 10, 25, 12, 0).getTime();
  const logged = [];
  const cal = createCalendar({ home, todos: { all: () => [], update: async () => {}, rename: async () => {}, commit: async () => {}, add: async () => ({}), adopt: async () => ({}) }, port: 1, tokenFile: path.join(home, 'none'), log: (k, d) => logged.push([k, d]), now: () => clock });
  const h = clock - 3600_000, later = clock + 3600_000;
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ calendar: { started: true, held: [
    { text: 'A conflict line, about no block.' },
    { text: 'Placed, its block over.', until: h, say: 'Placed.' },
    { block: { todo: 'c2', title: 'y', start: later, minutes: 30, at: new Date(h).toISOString() } },
    { ask: { todo: 'c3', title: 'z' } },
  ], actions: [{ id: 'a1', at: new Date(clock - 7200_000).toISOString(), todo: 'c4', title: 'Kept', start: clock - 5400_000, minutes: 30 }] } }));
  assert.equal(cal.hasLines(), true);
  const got = cal.takeHeld({ linesOnly: true });
  assert.deepEqual(got.items, [{ text: 'A conflict line, about no block.' }, { text: 'Placed, its block over.', say: 'Placed.', until: h }]);
  assert.deepEqual([got.asks, got.blocks], [[], []], 'no question is taken');
  assert.deepEqual(cal.state().held.map((x) => x.block?.todo ?? x.ask?.todo), ['c2', 'c3'], 'they stay');
  assert.equal(cal.hasLines(), false); assert.equal(cal.hasHeld(), true);
  // a kept slot whose time has passed is said in a line that carries its block's end, so it can be dropped too
  await cal.sync('timer');
  const lost = cal.state().held.find((x) => /I had kept a slot/.test(x.text ?? ''));
  assert.equal(lost.until, clock - 5400_000 + 30 * 60_000);
  assert.equal(cal.takeHeld().items.find((x) => /I had kept a slot/.test(x.text)).until, lost.until);
}

// ---- sidekick.mjs: what waits while it lasts, and what goes through
{
  const side = read('sidekick.mjs');
  assert.match(side, /const calQuiet = \(\) => calQuietBase\(\) && !stood\?\.on\(\);/, 'never a quiet moment: calendar lines, questions and the review wait');
  assert.match(side, /if \(busy \|\| queued \|\| loggingIn \|\| onboarding \|\| voiceState !== 'idle' \|\| Date\.now\(\) < lineUntil \|\| stood\?\.on\(\)\) \{ reminderRetry\(\); return; \}/, 'reminders: given late, never dropped');
  // feature 31: what is said unasked goes to the quiet queue while stood down: briefings, the review's line, calendar
  // lines, notices (the queue's first rule, quiet.test.mjs)
  assert.match(side, /if \(queue\.offer\(\{ kind: 'briefing', data: \{ kind: b\.kind \} \}\)\) runBriefing\(b\);/, 'a briefing');
  assert.match(side, /stood: \(\) => !!stood\?\.on\(\), away: awayNow, call: callNow,/, 'the queue knows');
  assert.match(side, /async function prompt\([^)]*\) \{\n(?:\s*\/\/[^\n]*\n)*\s*if \(stood\?\.on\(\)\) \{ if \(briefing\) [^\n]*else logLine\('stand_down_dropped', \{ what: 'request' \}\); return; \}/, 'no request is made');
  assert.match(side, /const ui = \(msg\) => \{\n\s*if \(standCatch\(msg\)\) return;/, 'everything for the page goes through the catch');
  assert.match(side, /const STAND_PASS = new Set\(\['list', 'esc', 'cancel_ask', 'ask_text', 'heard', 'hands', 'summon'\]\);/, 'what the owner asks for goes through');
  assert.match(side, /settingsNotice\(uiReady && !onboarding && \(!!config\.onboarded \|\| guideClosed\)\)/); assert.match(side, /kokoroSaid\(uiReady && !onboarding && \(!!config\.onboarded \|\| guideClosed\)\)/); assert.match(side, /kokoroSaid = heldNotice\(text, \(t\) => unasked\(\{ kind: 'notice', text: t, mood: 'concerned', voice: true \}\)\);/, 'feature 31: notices wait in the quiet queue');
  assert.match(side, /if \(text\?\.trim\(\)\) \{ standUp\('typed'\); if \(isWaitingAsk\(text\)\) waitingAsked\(false\); else enqueue/, 'a typed request ends it'); assert.match(side, /if \(window == null\) standUp\('voice'\);/, 'and a spoken one');
  // questions are closed (and kept) before the request they belong to is cut off, which would take them down as no answer
  const body = side.slice(side.indexOf('function standDownNow('), side.indexOf('function standUp('));
  assert.ok(body.indexOf('flow.standDown()') < body.indexOf('interruptQuietly()') && body.indexOf('flow.standDown()') < body.indexOf('pending.delete(id)'), 'questions first');
  for (const part of ["send({ type: 'listen_cancel' })", 'pi.stop()', 'speech.stop()', 'ink.clear()', 'stopShowcase()', 'barAsk.abort()']) assert.ok(body.includes(part), `stops: ${part}`);
  assert.match(side, /if \(r\.status === 'stopped' && piStood\) \{ piStood = false; stood\.add\(\{ pi: true, processes: r\.ended \?\? 0 \}\); return; \}/, '"Stopped pi." waits for the line at the end');
  assert.match(side, /if \(stood\?\.on\(\)\) ui\(\{ kind: 'stand', on: true \}\);/, 'a new page keeps the look');
  // a briefing chosen just before, waiting behind a request (the owner, 2026-11-25): marked given only once its request
  // is made, so a stand down holds it like the others (given after while its window is open, skipped when not)
  const tick = side.slice(side.lastIndexOf('const b = pi.briefing();'), side.indexOf('// Local-only build: the to-do list and Super Productivity are synced on a timer'));
  assert.ok(!tick.includes('pi.briefing.done('), 'not marked given when chosen'); assert.ok(!tick.includes("logLine('briefing'"), 'nor logged');
  assert.match(tick, /const given = \{ kind: b\.kind, given: false \};\n\s*briefingWaiting = true;/);
  assert.match(tick, /, \{ briefing: given \}\)\.then\(\(\) => \(given\.given && b\.kind === 'morning' && !daily\.morningAsked\(\) \? dailyAsk\('morning'\) : null\)\)/, 'its questions only when it was given');
  assert.match(side, /if \(busy \|\| queued \|\| briefingWaiting \|\| loggingIn/, 'no second one chosen meanwhile');
  assert.match(side, /if \(stood\?\.on\(\)\) \{ if \(briefing\) logLine\('stand_down_held', \{ what: 'briefing', kind: briefing\.kind \}\); else logLine\('stand_down_dropped', \{ what: 'request' \}\); return; \}\n\s*if \(briefing\) \{ pi\.briefing\.done\(briefing\.kind\); briefing\.given = true; logLine\('briefing', \{ kind: briefing\.kind \}\); \}/, 'held while stood down, marked given when made');
  assert.match(side, /if \(briefing\) briefingWaiting = false;/, 'its turn over, the next minute may choose it again');
  // the line left by a stand down that ended at the day turn: after a typed request's reply, or a spoken exchange's end
  assert.match(side, /if \(own && !flow\.spoken\(\)\) queue\?\.exchanged\(\);/); assert.match(side, /ended: \(\) => queue\?\.exchanged\(\),/);
  assert.match(side, /const said = !!g\.summary && noticesOn\(\);/, 'said under the usual rule');
  assert.match(side, /queue\.prune\(\);[^\n]*\n\s*const ended = stood\.end\(by, queue\.count\(\) \+ due\);\n\s*ui\(\{ kind: 'stand', on: false \}\);\n\s*if \(ended\) queue\.stoodDown\(ended\.counts\);/, 'what it stopped goes to the queue');
  assert.match(side, /else if \(config\.onboarded && !stood\?\.on\(\)\) ui\(\{ kind: 'greet' \}\);/, 'and is not greeted');
}

fs.rmSync(home, { recursive: true, force: true });
console.log('stand down tests: passed');
