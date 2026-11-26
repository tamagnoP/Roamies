// Local-only build, feature 23 stage 3: a request to the local model made by the app (localroute.mjs), against a
// stand-in server: the warm-up and live check first, the real tools by name with code's arguments, the yes/no bubble
// for a change the model chose, its own history, a ledger line per call ("this Mac").
import assert from 'node:assert/strict';
import { NOT_ANSWERING, createLocalRoute, liteFacts } from '../localroute.mjs';
import { settingsDefaults } from '../pi.mjs';
import { startFakeLocal } from './fakelocal.mjs';

const NOW = new Date(2026, 10, 25, 14, 5).getTime(), at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
const TODOS = [{ id: 'k3f9', title: 'Budget review', due: at(25, 10) }, { id: 'p2x7', title: 'Grant report draft', due: at(27, 10) }, { id: 't5', title: 'Thesis chapter 2', due: null }];
const BLOCKS = { k3f9: { start: at(25, 10), minutes: 60 }, p2x7: { start: at(25, 15), minutes: 60 } };
assert.deepEqual(liteFacts(TODOS, BLOCKS, NOW), { open: 3, today: 1, week: 2, overdue: 1, none: 1, plan: [{ todo: 'k3f9', title: 'Budget review', start: at(25, 10), minutes: 60 }, { todo: 'p2x7', title: 'Grant report draft', start: at(25, 15), minutes: 60 }] });

const fake = await startFakeLocal();
const settings = (o = {}) => { const d = settingsDefaults('/tmp/x'); return { ...d, calendar: { ...d.calendar, dayStart: 540, dayEnd: 1080 }, local: { ...d.local, address: fake.address, ...o } }; };
let s = settings();
const ran = [], lines = [], asked = [];
let answer = null;
const tool = (name) => ({ execute: async (a) => { ran.push([name, a]); return name === 'show_day' ? 'friday:\n09:00 to 10:00 (60 min): Lab meeting [m1]' : `done ${name} [x1]`; } });
const route = createLocalRoute({ settings: () => s, userName: 'Office', tool, todos: () => TODOS, blocks: () => BLOCKS, readDaily: async () => '## Plan', confirm: async (p) => { asked.push(p.question); return answer; }, record: (l) => lines.push(l), now: () => NOW });

// a reminder code reads whole: no model request at all, and still the live check first
let out = await route.request('Remind me at half past four to pick up the parcel.');
assert.deepEqual([out.by, out.reply], ['code', 'I\'ll remind you to pick up the parcel at 16:30.']);
assert.deepEqual(ran.pop(), ['remember_commitment', { text: 'pick up the parcel', due: '2026-11-25T16:30:00', kind: 'reminder' }]);
assert.equal(fake.requests.length, 0); assert.deepEqual(lines.map((l) => [l.kind, l.where]), [['warmup', 'mac']], 'the warm-up is in the ledger');
// a change the model chose: shown, and with no answer nothing is saved
fake.answers.push({ calls: [['move_block', { todo: 'Budget review' }]] });
out = await route.request('Move the budget review to tomorrow at 10.');
assert.deepEqual([out.by, out.reply, asked.pop(), ran.length], ['unanswered', 'Nothing was changed.', 'Move the block for "Budget review" to tomorrow at 10:00?', 0]);
assert.deepEqual(lines.at(-1).kind, 'request'); assert.equal(lines.at(-1).where, 'mac'); assert.ok(lines.at(-1).tokens.cacheRead > 0);
assert.ok(!JSON.stringify(lines).includes('Budget'), 'no content in the ledger');
// with a yes: saved through the real tool, and the calendar's own line without its ids
answer = true; fake.answers.push({ calls: [['move_block', { todo: 'Budget review' }]] });
out = await route.request('Move the budget review to tomorrow at 10.');
assert.deepEqual(ran.pop(), ['move_block', { todo: 'k3f9', date: 'tomorrow', start: '10:00' }]); assert.equal(out.reply, 'done move_block');
// a read: never asked; the model's answer after it
asked.length = 0; fake.answers.push({ calls: [['show_day', {}]] }, { content: 'On Friday you have the lab meeting at nine.' });
out = await route.request('What have I got on Friday?');
assert.deepEqual([out.reply, asked.length], ['On Friday you have the lab meeting at nine.', 0]); assert.deepEqual(ran.pop(), ['show_day', { date: 'friday' }]);
// its own history goes with the next request, as text after the fixed opening
fake.answers.push({ content: 'Hello.' });
await route.request('Hi.');
assert.match(fake.requests.at(-1).transient_context, /^Earlier in this conversation:\nOffice: Remind me at half past four/); assert.equal(fake.requests.at(-1).transient_context.match(/^Office: /gm).length, 5, 'its last 4 exchanges (local.historyExchanges), then what he said');
assert.ok(!fake.requests.some((b) => JSON.stringify(b.messages[0]).includes('Earlier')), 'the opening never changes');
// local.confirmChanges false: saved at once
s = settings({ confirmChanges: false }); answer = null; asked.length = 0;
fake.answers.push({ calls: [['move_block', { todo: 'Budget review' }]] });
await route.request('Move the budget review to tomorrow at 10.');
assert.equal(asked.length, 0); assert.equal(ran.pop()[0], 'move_block');
// a tool-less request (part two, a briefing, a private summary): no tools, its own ledger kind, private when it is
fake.answers.push({ content: 'You have three to-dos and two blocks today.' });
assert.equal(await route.oneShot({ kind: 'briefing', system: 'Word the briefing.', text: 'the outline', maxTokens: 120 }), 'You have three to-dos and two blocks today.');
assert.equal(fake.requests.at(-1).tools, undefined); assert.equal(fake.requests.at(-1).max_tokens, 120);
assert.deepEqual([lines.at(-1).kind, lines.at(-1).where], ['briefing', 'mac']);
fake.answers.push({ content: 'Asked about the results.' });
await route.oneShot({ kind: 'handover', private: true, system: 's', text: 't' });
assert.equal(lines.at(-1).private, true);
assert.deepEqual(route.privateSince(0), [], 'no private exchange in this route yet');
await fake.close();
// the server gone: a code-worded line, nothing sent anywhere else
out = await createLocalRoute({ settings: () => s, tool, todos: () => TODOS, now: () => NOW }).request('Hi.');
assert.deepEqual(out, { problem: NOT_ANSWERING });
// off
s = settings({ address: '' });
assert.match((await route.request('Hi.')).problem, /off/);
// a server that doesn't reuse the opening fails the live check: not used, said in a line
const bad = await startFakeLocal({ reuse: false });
s = settings({ address: bad.address });
out = await createLocalRoute({ settings: () => s, tool, todos: () => TODOS, now: () => NOW }).request('Hi.');
assert.match(out.problem, /transient_context/); assert.equal(bad.requests.length, 0, 'no request of his was sent');
await bad.close();
console.log('local route tests passed');
