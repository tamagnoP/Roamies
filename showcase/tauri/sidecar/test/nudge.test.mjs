// Local-only build (2026-11-19): the nudge for a to-do that has come due is worded by code and never goes through
// the model.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.ROAMIES_DATA_DIR = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nudge-')), 'data');
const { NUDGE, codeReference } = await import('../pi.mjs');
const { nudgeLine } = await import('../calendar.mjs');

const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
const now = at(19, 17);
// the pattern
assert.equal(nudgeLine([{ text: 'Write report', due: at(19, 17) }], now), 'Write report is due at 17:00.');
assert.equal(nudgeLine([{ text: 'Write report', due: at(19, 17) }], now + 4 * 60_000), 'Write report is due at 17:00.');
assert.equal(nudgeLine([{ text: 'Write report', due: at(19, 17) }], now + NUDGE.lateMinutes * 60_000), 'Write report was due at 17:00.', 'late: "was"');
assert.equal(nudgeLine([{ text: 'Grant draft', due: at(18, 12) }], now), 'Grant draft was due Wednesday 18 November at 12:00.', 'another day is said');
assert.equal(nudgeLine([{ text: '  Call Ana.  ', due: at(19, 17) }], now), 'Call Ana is due at 17:00.');
// the same for a plain reminder and for a to-do that came from Super Productivity: nothing but the title and time is used
assert.equal(nudgeLine([{ id: 'c1', text: 'Stretch', due: at(19, 17), kind: 'reminder', status: 'done' }], now), 'Stretch is due at 17:00.');
// several: soonest first, NUDGE.named named, the rest counted
assert.equal(NUDGE.named, 3);
const five = [5, 1, 3, 2, 4].map((n) => ({ text: `Task ${n}`, due: at(19, 16, 50 + n) }));
assert.equal(nudgeLine(five.slice(0, 2), now), 'Task 1 was due at 16:51. Task 5 was due at 16:55.');
assert.equal(nudgeLine(five.slice(0, 4), now), 'Task 1 was due at 16:51. Task 2 was due at 16:52. Task 3 was due at 16:53. And 1 more is due: the list shows it.');
assert.equal(nudgeLine(five, now), 'Task 1 was due at 16:51. Task 2 was due at 16:52. Task 3 was due at 16:53. And 2 more are due: the list shows them.');
assert.equal(nudgeLine([], now), ''); assert.equal(nudgeLine([{ text: ' ', due: now }, { text: 'No time', due: null }], now), '');
assert.deepEqual(codeReference().dueNudge, { for: 'reminders; a to-do whose due time passes gets a check-in instead (feature 25)', wording: '"<title> is due at <time>." ("was due" once it is late; with the day when that isn\'t today), built by the app, shown and spoken, whatever the speaking budget says', sentToTheModel: 'nothing', namedInOne: 3, thenCounted: 'and N more are due: the list shows them', wasDueAfterMinutes: 5 });

// sidekick.mjs: the nudge is shown and spoken, and no request is made for it
const side = fs.readFileSync(new URL('../sidekick.mjs', import.meta.url), 'utf8');
const tick = side.slice(side.indexOf('async function remindTick()'), side.indexOf('function reminderRetry()'));
assert.ok(tick.length > 100 && tick.includes('const line = nudgeLine(due);') && tick.includes("say(line, 'concerned');") && tick.includes('voiceLine(forVoice(line));'));
assert.ok(!tick.includes('enqueue') && !tick.includes('cal.state'), 'nothing is queued for the model, and where the to-do came from makes no difference');
assert.ok(tick.includes("logLine('nudge', { todos: due.length, chars: line.length });"), 'the log has how many, never a title');
assert.ok(!side.includes('these commitments are due now') && !side.includes('Nudge ${userName}'), 'the note that asked the model to word a nudge is gone');
assert.ok(tick.includes("voiceState !== 'idle' || Date.now() < lineUntil"), 'it waits while they talk or a reply is spoken');
console.log('nudge tests: passed');
