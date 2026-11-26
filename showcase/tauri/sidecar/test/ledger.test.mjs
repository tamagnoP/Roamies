// Local-only build, feature 32: the ledger (ledger.mjs). Numbers, names and kinds only; "what left the Mac today?"
// answered by code from it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KINDS, countTools, createLedger, isLeftAsk, leftLine, ledgerLine } from '../ledger.mjs';

const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
// A line holds numbers, names and the kind; whatever else a caller passes is not kept.
const l = ledgerLine({ t: at(26, 9), kind: 'request', provider: 'anthropic', model: 'claude-x', tokens: { new: 1200, cacheRead: 14000, cacheWrite: 0, out: 80 }, marked: 1, screenshots: 1, windowTexts: 2, text: 'my secret request', prompt: 'x', said: 'y' });
assert.deepEqual(l, { t: at(26, 9), kind: 'request', where: 'provider', provider: 'anthropic', model: 'claude-x', tokens: { new: 1200, cacheRead: 14000, cacheWrite: 0, out: 80 }, captures: { marked: 1, screenshots: 1, photos: 0 }, windowTexts: 2, private: false });
assert.ok(!JSON.stringify(l).includes('secret'));
assert.throws(() => ledgerLine({ kind: 'chat' }), /no ledger kind/);
assert.deepEqual(KINDS, ['request', 'briefing', 'piSummary', 'fold', 'memory', 'handover', 'warmup', 'pi']);
assert.deepEqual(countTools(['take_screenshot', 'read_window', 'see_photo', 'read_window', 'write_note']), { screenshots: 1, photos: 1, windowTexts: 2 });

// The file: appended, read back, pruned after limits.ledgerDays, never with content.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-')), file = path.join(dir, 'ledger.jsonl');
let clock = at(26, 10);
const ledger = createLedger({ file, keepDays: () => 90, now: () => clock });
ledger.record({ kind: 'request', provider: 'anthropic', model: 'claude-x', tokens: { new: 1000, cacheRead: 15000, out: 60 }, screenshots: 1, text: 'never kept' });
ledger.record({ kind: 'fold', provider: 'anthropic', model: 'claude-h', tokens: { new: 3000, out: 400 } });
ledger.record({ kind: 'request', where: 'mac', provider: 'local', model: 'gemma-4-e4b', tokens: { new: 200, cacheRead: 900, out: 30 } });
ledger.record({ kind: 'pi', where: 'provider' });
ledger.record({ kind: 'request', provider: 'anthropic', model: 'claude-x', tokens: { new: 500, cacheRead: 15500, out: 40 }, marked: 1, windowTexts: 1 });
assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600');
assert.ok(!fs.readFileSync(file, 'utf8').includes('never kept'));
assert.equal(ledger.lines().length, 5);
assert.equal(ledger.left(), 'Sent to anthropic today: 2 requests, 1 fold of the conversation; 35,000 tokens sent (30,500 of them read from its cache) and 500 answered. Screen captures: 1 marked area, 1 screenshot. Window texts: 1. 1 request stayed on this Mac, with the local model. 1 hand-off to pi; pi\'s own requests are not counted.');
// Yesterday's lines are not today's.
assert.equal(leftLine(ledger.lines(), at(27, 9)), 'Nothing went to the provider today.');
// A private request that reached the provider would be said (stage 4 makes sure none does).
assert.match(leftLine([ledgerLine({ t: at(26, 9), kind: 'request', provider: 'anthropic', private: true })], at(26, 10)), /1 private request went to the provider\./);
clock = at(26, 10) + 91 * 864e5;
ledger.record({ kind: 'briefing', provider: 'anthropic', model: 'claude-x', tokens: { new: 10 } });
assert.equal(ledger.prune(), 0, 'pruned already, when the line was recorded');
assert.deepEqual(ledger.lines().map((x) => x.kind), ['briefing'], 'older than 90 days: gone');
fs.rmSync(dir, { recursive: true, force: true });

// The question, said alone, is the app's: never sent to a model.
for (const t of ['What left the Mac today?', 'um, what has left the Mac today', 'What did you send today?', 'what left this mac today']) assert.ok(isLeftAsk(t), t);
for (const t of ['What left the room?', 'What left the Mac today and why?', 'Tell me what left the Mac today in detail']) assert.ok(!isLeftAsk(t), t);
console.log('ledger tests passed');
