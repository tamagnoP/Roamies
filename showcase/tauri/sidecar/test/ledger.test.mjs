// Local-only build, feature 32: the ledger (ledger.mjs). Numbers, names and kinds only; "what left the Mac today?"
// answered by code from it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KINDS, UNSEEN, countTools, createLedger, isLeftAsk, leftLine, ledgerLine, shortModel, signInFailed } from '../ledger.mjs';

const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
// A line holds numbers, names and the kind; whatever else a caller passes is not kept.
const l = ledgerLine({ t: at(26, 9), kind: 'request', provider: 'anthropic', model: 'claude-x', tokens: { new: 1200, cacheRead: 14000, cacheWrite: 0, out: 80 }, marked: 1, screenshots: 1, windowTexts: 2, text: 'my secret request', prompt: 'x', said: 'y' });
assert.deepEqual(l, { t: at(26, 9), kind: 'request', where: 'provider', provider: 'anthropic', model: 'claude-x', tokens: { new: 1200, cacheRead: 14000, cacheWrite: 0, out: 80 }, captures: { marked: 1, screenshots: 1, photos: 0 }, windowTexts: 2, private: false });
assert.ok(!JSON.stringify(l).includes('secret'));
assert.throws(() => ledgerLine({ kind: 'chat' }), /no ledger kind/);
assert.deepEqual(KINDS, ['request', 'briefing', 'piSummary', 'fold', 'memory', 'handover', 'warmup', 'pi', 'own', 'signInFailed']);
// the model's name, never a folder of the owner's (the owner, 2026-11-26)
for (const [m, want] of [['/Users/office/.cache/huggingface/hub/models--mlx-community--gemma-4-e4b-it-4bit/snapshots/475b9088', 'gemma-4-e4b-it-4bit'], ['/Users/office/models/my-gemma', 'my-gemma'], ['~/m/x', 'x'], ['C:\\Users\\o\\m', 'm'], ['e4b', 'e4b'], ['mlx-community/gemma-4-e4b-it-4bit', 'mlx-community/gemma-4-e4b-it-4bit'], ['claude-sonnet-5-5', 'claude-sonnet-5-5']]) assert.equal(shortModel(m), want, m);
assert.equal(ledgerLine({ kind: 'warmup', where: 'mac', model: '/Users/office/models/my-gemma' }).model, 'my-gemma');
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
assert.equal(ledger.left(), 'Sent to anthropic today: 2 requests, 1 fold of the conversation; 35,000 tokens sent (30,500 of them read from its cache) and 500 answered. Screen captures: 1 marked area, 1 screenshot. Window texts: 1. 1 request stayed on this Mac, with the local model. 1 hand-off to pi. ' + UNSEEN);
// the local model's warm-ups are told apart from the requests that stayed on this Mac
{
  const f2 = path.join(path.dirname(file), 'ledger-warm.jsonl'), l2 = createLedger({ file: f2, keepDays: () => 90, now: () => clock });
  l2.record({ kind: 'warmup', where: 'mac', provider: 'local', model: 'm' });
  assert.match(l2.left(), /Nothing was asked of the local model on this Mac, apart from 1 warm-up checking it\./);
  l2.record({ kind: 'request', where: 'mac', provider: 'local', model: 'm' }); l2.record({ kind: 'request', where: 'mac', provider: 'local', model: 'm' });
  assert.match(l2.left(), /2 requests stayed on this Mac, with the local model, besides 1 warm-up checking it\./);
}
assert.equal(UNSEEN, 'Not counted, because Roamies can\'t see them: what the claude program sends to Anthropic by itself without reporting it (it connects when it starts, and makes small checks such as counting tokens), and pi\'s own requests.');
// A failed sign-in: its own kind, named apart, not among what was sent (the owner, 2026-11-26)
for (const e of ['Not logged in · Please run /login', 'Invalid API key · Please run /login', 'HTTP 401 Unauthorized', new Error('authentication_error')]) assert.ok(signInFailed(e), String(e));
for (const e of ['fetch failed', 'Request 4011 failed', 'rate limit']) assert.ok(!signInFailed(e), e);
{
  const fail = (t) => ledgerLine({ t, kind: 'signInFailed', provider: 'claude-code', model: 'claude-x' });
  assert.equal(leftLine([fail(at(26, 9)), fail(at(26, 9, 5))], at(26, 10)), `No request to the provider was answered today. 2 requests to claude-code failed at sign-in and got no answer; what they sent before failing, if anything, isn't known. ${UNSEEN}`);
  const both = leftLine([fail(at(26, 9)), ledgerLine({ t: at(26, 9), kind: 'request', provider: 'claude-code', tokens: { new: 10, out: 5 } })], at(26, 10));
  assert.match(both, /^Sent to claude-code today: 1 request; 10 tokens sent .* 1 request to claude-code failed at sign-in and got no answer; what it sent before failing, if anything, isn't known\./);
}
assert.match(fs.readFileSync(new URL('../sidekick.mjs', import.meta.url), 'utf8'), /recordRequest\(err\); \/\/ feature 32/, 'a failed request is recorded with its error');
// Yesterday's lines are not today's.
assert.equal(leftLine(ledger.lines(), at(27, 9)), `Nothing went to the provider today. ${UNSEEN}`);
// What the claude program reported making by itself: in the totals, and said.
assert.equal(leftLine([ledgerLine({ t: at(26, 9), kind: 'request', provider: 'claude-code', tokens: { new: 10, cacheRead: 1000, out: 5 } }), ledgerLine({ t: at(26, 9), kind: 'own', provider: 'claude-code', model: 'claude-haiku-5-5', tokens: { new: 500, out: 40 } })], at(26, 10)), `Sent to claude-code today: 1 request; 1,510 tokens sent (1,000 of them read from its cache) and 45 answered. Of these, 500 tokens were requests the claude program reported making by itself. No screen captures. No window texts. ${UNSEEN}`);
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
const brainSrc = fs.readFileSync(new URL('../brain.mjs', import.meta.url), 'utf8'), sideSrc = fs.readFileSync(new URL('../sidekick.mjs', import.meta.url), 'utf8'), docs = fs.readFileSync(new URL('../../../../LOCAL-ONLY.md', import.meta.url), 'utf8');
assert.match(brainSrc, /else if \(e\.type === 'own_usage'\) for \(const \[m, tokens\] of Object\.entries\(e\.byModel\)\) \{ try \{ onUsage\?\.\(\{ provider: 'claude-code', model: m, tokens, own: true \}\);/, 'side calls: the program\'s own requests too');
assert.match(sideSrc, /const sideUse = \(kind\) => \(u\) => ledger\.record\(\{ kind: u\.own \? 'own' : kind,/);
assert.ok(docs.replace(/\s+/g, ' ').includes(UNSEEN.replace("Roamies can't", "Roamies can't")), 'LOCAL-ONLY.md says the same sentence');
console.log('ledger tests passed');
