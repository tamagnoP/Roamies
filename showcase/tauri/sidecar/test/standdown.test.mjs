// Local-only build, feature 33: stand down (standdown.mjs), the parts that need no app: the phrase said alone (one
// table with the shell's matcher, stand.rs), the settings, the state that a restart keeps, the line said when it ends,
// the calendar lines whose block has ended, and how sidekick.mjs holds everything that is said or shown unasked.
// The questions it closes are in flow.test.mjs, the page in stand-page.test.mjs, the real sidecar in
// standdown-run.test.mjs (npm run test:all), the shell's matcher in cargo test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { STAND_CAUGHT, STAND_FILL, STAND_SETTLE_MS, createStandDown, isStandDown, standFill, standSummary, standWords } from '../standdown.mjs';
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
  assert.ok(voice.includes(`const STAND_SETTLE_MS: u64 = ${STAND_SETTLE_MS};`), 'the wait is the same');
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
  assert.deepEqual(settingsDefaults(home).standDown, { phrase: 'stand down', shortcut: 'Control+Alt+Period', endsAtDayTurn: true });
  assert.deepEqual(loadSettings(home).standDown, made.standDown);
  const ref = codeReference().standDown;
  assert.deepEqual(ref.smallWords, STAND_FILL); assert.equal(ref.caughtLinesKept, STAND_CAUGHT); assert.match(ref.heardFor, new RegExp(`${STAND_SETTLE_MS} ms`));
  const bad = { phrase: ['send', 'Yes', 'thanks', 'drop it', 'review my day', 'please now', 'jarvis', 'one two three four five', 'stand2', 'stand_down', '', ' ', 'x'.repeat(41), 7, null], shortcut: ['Escape', 'Period', 'Control+Alt', 'Control+Alt+', 'Hyper+KeyS', 'Control+Alt+Period+', 'Control+Alt+Shift', 3, ''], endsAtDayTurn: ['yes', 1, null] };
  for (const [name, list] of Object.entries(bad)) for (const v of list) {
    put({ ...made, standDown: { ...made.standDown, [name]: v } });
    const s = loadSettings(home);
    assert.deepEqual(s.invalid, [{ name: `standDown.${name}`, using: STAND_DOWN[name].default }], `standDown.${name}: ${JSON.stringify(v)} is out`);
    assert.equal(s.standDown[name], STAND_DOWN[name].default);
  }
  for (const [name, v] of [['phrase', 'At ease'], ['phrase', "that'll do"], ['shortcut', 'Command+Shift+KeyD'], ['shortcut', 'Control+Alt+Period'], ['endsAtDayTurn', false]]) {
    put({ ...made, standDown: { ...made.standDown, [name]: v } });
    const s = loadSettings(home);
    assert.deepEqual([s.missing, s.invalid], [[], []], `standDown.${name}: ${JSON.stringify(v)} is in`); assert.equal(s.standDown[name], v);
  }
  const { endsAtDayTurn, ...two } = made.standDown;
  put({ ...made, standDown: two });
  assert.deepEqual(loadSettings(home).missing, ['standDown.endsAtDayTurn'], 'one part missing: named alone'); assert.equal(loadSettings(home).standDown.endsAtDayTurn, true);
  put(made);
}

// ---- the state: one log line when it starts and one when it ends, kept over a restart, and the line said at the end
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
  assert.equal(sd.caught('A line on its way.', 'concerned'), true);
  for (let i = 0; i < STAND_CAUGHT + 5; i++) sd.caught(`line ${i}`);
  // a restart: it is still on, with what it had gathered
  const again = make();
  assert.equal(again.on(), true); assert.deepEqual(again.state().counts, { pi: true, processes: 3, questions: 1 }); assert.equal(again.state().caught.length, STAND_CAUGHT);
  assert.equal(again.give(), null, 'nothing is given while it lasts');
  t += 95 * 60_000;
  assert.equal(again.turned(), false, 'the day has not turned');
  const ended = again.end('voice', 4);
  assert.equal(ended.endedBy, 'voice'); assert.deepEqual(logs.at(-1), ['stand_down_end', { by: 'voice', minutes: 95, held: 4 }]);
  assert.equal(again.end('voice'), null, 'once');
  const g = again.give();
  assert.deepEqual(g.counts, { pi: true, processes: 3, questions: 1 }); assert.equal(g.caught[0].text, 'A line on its way.'); assert.equal(g.caught[0].mood, 'concerned'); assert.equal(g.quiet, false);
  again.given();
  assert.equal(readState(dir).standDown, undefined, 'given: forgotten'); assert.equal(make().give(), null);
  // the day turn ends it when the setting says so (calendar.dayTurnsAt, 04:00 by default)
  const sd2 = make(); t = new Date(2026, 10, 25, 23, 30).getTime();
  sd2.start('phrase');
  t = new Date(2026, 10, 26, 3, 59).getTime(); assert.equal(sd2.turned(), false, '03:59: still the same day');
  t = new Date(2026, 10, 26, 4, 0).getTime(); assert.equal(sd2.turned(), true, '04:00: the day has turned');
  put({ ...made, standDown: { ...made.standDown, endsAtDayTurn: false } }); assert.equal(sd2.turned(), false, 'endsAtDayTurn false: it lasts'); put(made);
  sd2.add({ lines: 2 }); sd2.end('day');
  assert.equal(sd2.give().quiet, true, 'ended at the day turn: shown, not said'); sd2.given();
  // nothing happened meanwhile: nothing to give
  const sd3 = make(); sd3.start('key'); sd3.end('typed'); assert.equal(sd3.give(), null);
  // the review written meanwhile waits with its day
  const sd4 = make(); sd4.start('key'); sd4.reviewed('2026-11-26', 'Today: 2 done, 1 missed.'); sd4.end('voice');
  assert.deepEqual(sd4.give().review, { key: '2026-11-26', line: 'Today: 2 done, 1 missed.' }); sd4.given();
  // the logs hold no words: only these two kinds, with true/false and numbers
  for (const [k, d] of logs) { assert.ok(['stand_down', 'stand_down_end'].includes(k)); for (const v of Object.values(d)) assert.ok(typeof v === 'boolean' || typeof v === 'number' || ['key', 'phrase', 'voice', 'typed', 'day'].includes(v), `${k}: ${v}`); }
}

// ---- the line said when it ends, worded here
assert.equal(standSummary({}), '');
assert.equal(standSummary({ pi: true }), 'While I stood down: pi was stopped.');
assert.equal(standSummary({ pi: true, processes: 1 }), 'While I stood down: pi was stopped and 1 process it had left running was ended.');
assert.equal(standSummary({ pi: true, processes: 3, questions: 2, lines: 1 }), 'While I stood down: pi was stopped and 3 processes it had left running were ended; 2 questions I had open were kept for later; 1 calendar line went by, its block over.');
assert.equal(standSummary({ questions: 1, lines: 4, review: true }), 'While I stood down: 1 question I had open was kept for later; 4 calendar lines went by, their blocks over; the day\'s review was written in the daily note.');

// ---- the calendar: what is waiting about a block that has ended is dropped and counted; the rest stays
{
  let clock = new Date(2026, 10, 25, 12, 0).getTime();
  const logged = [];
  const cal = createCalendar({ home, todos: { all: () => [], update: async () => {}, rename: async () => {}, commit: async () => {}, add: async () => ({}), adopt: async () => ({}) }, port: 1, tokenFile: path.join(home, 'no-token'), now: () => clock, log: (kind, data) => logged.push([kind, data]) });
  const h = clock - 3600_000, later = clock + 3600_000;
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ calendar: { started: true, held: [
    { text: 'A conflict line, about no block.' },
    { text: 'Placed, its block over.', until: h },
    { text: 'Placed, its block still to come.', until: later },
    { block: { todo: 'c1', title: 'x', start: h - 1800_000, minutes: 30, at: new Date(h).toISOString() } },
    { block: { todo: 'c2', title: 'y', start: later, minutes: 30, at: new Date(h).toISOString() } },
    { ask: { todo: 'c3', title: 'z' } },
  ], actions: [{ id: 'a1', at: new Date(clock - 7200_000).toISOString(), todo: 'c4', title: 'Kept', start: clock - 5400_000, minutes: 30 }] } }));
  assert.equal(cal.heldCount(), 4, 'what would stay');
  assert.equal(await cal.dropPassed(), 2);
  assert.deepEqual(cal.state().held.map((x) => x.text ?? x.block?.todo ?? x.ask?.todo), ['A conflict line, about no block.', 'Placed, its block still to come.', 'c2', 'c3']);
  assert.deepEqual(logged.at(-1), ['calendar_held_passed', { lines: 2 }]);
  // a kept slot whose time has passed is said in a line that carries its block's end, so it can be dropped too
  await cal.sync('timer');
  const lost = cal.state().held.find((x) => /I had kept a slot/.test(x.text ?? ''));
  assert.equal(lost.until, clock - 5400_000 + 30 * 60_000);
  assert.equal(await cal.dropPassed(), 1);
}

// ---- sidekick.mjs: what waits while it lasts, and what goes through
{
  const side = read('sidekick.mjs');
  assert.match(side, /const calQuiet = \(\) => calQuietBase\(\) && !stood\?\.on\(\);/, 'never a quiet moment: calendar lines, questions and the review wait');
  assert.match(side, /if \(busy \|\| queued \|\| loggingIn \|\| onboarding \|\| voiceState !== 'idle' \|\| Date\.now\(\) < lineUntil \|\| stood\?\.on\(\)\) \{ reminderRetry\(\); return; \}/, 'reminders: given late, never dropped');
  assert.match(side, /setInterval\(\(\) => \{\n(?:\s*\/\/[^\n]*\n)*\s*if \(stood\?\.on\(\)\) \{ standReview\(\); return; \}/, 'no briefing');
  assert.match(side, /async function prompt\([^)]*\) \{\n(?:\s*\/\/[^\n]*\n)*\s*if \(stood\?\.on\(\)\) \{ logLine\('stand_down_dropped', \{ what: 'request' \}\); return; \}/, 'no request is made');
  assert.match(side, /const ui = \(msg\) => \{\n\s*if \(standCatch\(msg\)\) return;/, 'everything for the page goes through the catch');
  assert.match(side, /const STAND_PASS = new Set\(\['list', 'esc', 'cancel_ask', 'ask_text', 'heard', 'hands', 'summon'\]\);/, 'what the owner asks for goes through');
  assert.match(side, /settingsNotice\(uiReady && !onboarding && \(!!config\.onboarded \|\| guideClosed\) && !stood\?\.on\(\)\)/); assert.match(side, /kokoroSaid\(uiReady && !onboarding && \(!!config\.onboarded \|\| guideClosed\) && !stood\?\.on\(\)\)/);
  assert.match(side, /if \(text\?\.trim\(\)\) \{ standUp\('typed'\); enqueue/, 'a typed request ends it'); assert.match(side, /if \(window == null\) standUp\('voice'\);/, 'and a spoken one');
  // questions are closed (and kept) before the request they belong to is cut off, which would take them down as no answer
  const body = side.slice(side.indexOf('function standDownNow('), side.indexOf('function standUp('));
  assert.ok(body.indexOf('flow.standDown()') < body.indexOf('interruptQuietly()') && body.indexOf('flow.standDown()') < body.indexOf('pending.delete(id)'), 'questions first');
  for (const part of ["send({ type: 'listen_cancel' })", 'pi.stop()', 'speech.stop()', 'ink.clear()', 'stopShowcase()', 'barAsk.abort()']) assert.ok(body.includes(part), `stops: ${part}`);
  assert.match(side, /if \(r\.status === 'stopped' && piStood\) \{ piStood = false; stood\.add\(\{ pi: true, processes: r\.ended \?\? 0 \}\); return; \}/, '"Stopped pi." waits for the line at the end');
  assert.match(side, /if \(stood\?\.on\(\)\) ui\(\{ kind: 'stand', on: true \}\);/, 'a new page keeps the look');
  assert.match(side, /else if \(config\.onboarded && !stood\?\.on\(\)\) ui\(\{ kind: 'greet' \}\);/, 'and is not greeted');
}

fs.rmSync(home, { recursive: true, force: true });
console.log('stand down tests: passed');
