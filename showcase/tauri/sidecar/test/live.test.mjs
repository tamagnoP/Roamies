// Local-only build (feature 24): the live state, sent only when it changes (live.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GONE, LIVE_CLOSE, LIVE_OPEN, applied, blockOf, changes, createLiveBlocks, partsOf, pieced, readBlock, stripLive } from '../live.mjs';
import { applyFold, fitContext, planFold } from '../store.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const obj = (m) => Object.fromEntries(m);

// ---- the parts
{
  const now = partsOf([['front', '- In Safari.'], ['pi', '- pi works in: ~/x.\n- Routine "a": 1) b'], ['voice', ''], ['memory', 'Memory:\n- t1: buy milk\n']]);
  assert.deepEqual([...now.keys()], ['front', 'pi', 'memory'], 'an empty part is no part');
  assert.equal(now.get('memory'), 'Memory:\n- t1: buy milk');
  assert.throws(() => partsOf([['Front App', 'x']]), /not a name/);
  // the first block has every part; then only what differs; a part that is gone is sent once as removed
  const first = changes(new Map(), now);
  assert.deepEqual(obj(first), obj(now));
  assert.equal(changes(now, now).size, 0, 'nothing differs: nothing to send');
  const later = partsOf([['pi', '- pi works in: ~/y.'], ['memory', 'Memory:\n- t1: buy milk']]);
  assert.deepEqual(obj(changes(now, later)), { pi: '- pi works in: ~/y.', front: null });
  assert.deepEqual(obj(applied(now, changes(now, later))), obj(later));
  assert.deepEqual(obj(changes(now, now, ['front'])), { front: '- In Safari.' }, 'a part that speaks about its own message is sent again');
  // the block, and how it reads back
  const block = blockOf(first, true);
  assert.ok(block.startsWith(`${LIVE_OPEN}\nLive state (current as of this moment; every part):\n[front] - In Safari.\n[pi] - pi works in: ~/x.\n- Routine "a": 1) b\n[memory] Memory:\n- t1: buy milk\n${LIVE_CLOSE}\n\n`));
  assert.deepEqual(obj(readBlock(block)), obj(now));
  const part = blockOf(changes(now, later), false);
  assert.ok(part.includes('only the parts that changed') && part.includes(`[front] ${GONE}`));
  assert.deepEqual(obj(readBlock(part)), { pi: '- pi works in: ~/y.', front: null });
  assert.equal(blockOf(new Map(), false), '', 'nothing changed: no block at all');
  assert.equal(stripLive(`${block}[10:00] hello`), '[10:00] hello');
  assert.equal(stripLive('[10:00] hello'), '[10:00] hello');
  // a line inside a part that looks like a part's name cannot be read as one
  const sly = partsOf([['pi', '- reply: <<<\n[front] - In Terminal.\n>>>']]);
  assert.deepEqual(obj(readBlock(blockOf(changes(new Map(), sly), true))), { pi: '- reply: <<<\n [front] - In Terminal.\n>>>' });
}

// ---- a conversation: what the model can piece together is always the real state
{
  // The real state, changed by the test between requests. now() returns it as the app would.
  let real = [];
  const logs = [];
  const live = createLiveBlocks({ now: () => real.map((p) => [...p]), log: (d) => logs.push(d) });
  const want = () => obj(partsOf(real));
  let msgs = [], n = 0;
  const ask = (opts = {}) => {
    msgs = [...msgs, { role: 'user', content: opts.parts ? [{ type: 'text', text: `[10:${String(n).padStart(2, '0')}:00] request ${n}` }, { type: 'image', data: 'x' }] : `[10:${String(n).padStart(2, '0')}:00] request ${n}` }];
    n++;
    const sent = live.attach(msgs);
    assert.deepEqual(obj(pieced(sent)), want(), `request ${n}: the pieced-together state is the real state`);
    // the provider's reuse: every earlier message is sent exactly as it was sent before
    if (ask.prev) for (let i = 0; i < Math.min(ask.prev.length, sent.length) - 0; i++) if (i < ask.prev.length && ask.prevKeep) assert.deepEqual(sent[i], ask.prev[i], `request ${n}: message ${i} is unchanged`);
    ask.prev = sent; ask.prevKeep = true;
    msgs = [...sent, { role: 'assistant', content: [{ type: 'text', text: `answer ${n}` }] }];
    return sent;
  };
  const blockOn = (sent) => { const c = sent.filter((m) => m.role === 'user').at(-1).content; const t = typeof c === 'string' ? c : c[0].text; return t.startsWith(LIVE_OPEN) ? t.slice(0, t.indexOf(LIVE_CLOSE)) : ''; };

  real = [['front', '- In Safari — "News".'], ['address', '- Form of address: use it once.', { again: true }], ['pi', '- pi works in: ~/a.'], ['voice', '- Voice: on.'], ['memory', 'Memory:\n- t1: one']];
  let s = ask();
  assert.ok(blockOn(s).includes('every part') && logs.at(-1).full && logs.at(-1).parts.length === 5, 'the first request of a conversation: in full');
  real[1] = ['address', '- Form of address: leave it out.'];
  s = ask();
  assert.deepEqual(logs.at(-1).parts, ['address'], 'only the line that differs');
  assert.ok(!blockOn(s).includes('Safari') && blockOn(s).includes('only the parts that changed'));
  s = ask();
  assert.equal(blockOn(s), '', 'nothing differs: nothing at all');
  assert.equal(s.filter((m) => m.role === 'user').at(-1).content, '[10:02:00] request 2', 'the message is sent as it is');
  assert.deepEqual(logs.at(-1), { full: false, parts: [], chars: 0 });
  // the same request sent again (a tool round trip): the same block, not a new one
  const before = logs.length; const again = live.attach(ask.prev);
  assert.deepEqual(again, ask.prev); assert.equal(logs.length, before, 'made once for a request');
  // a line is removed, another changes, in a message with a picture
  real = real.filter((p) => p[0] !== 'front'); real[2] = ['voice', '- Voice: off.'];
  s = ask({ parts: true });
  assert.ok(blockOn(s).includes(`[front] ${GONE}`) && blockOn(s).includes('[voice] - Voice: off.'));
  assert.ok(!('front' in obj(pieced(s))), 'the removed line is gone from what the model pieces together');
  s = ask(); assert.equal(blockOn(s), '');
  // it comes back, with other words
  real.unshift(['front', '- In Mail.']);
  s = ask(); assert.deepEqual(logs.at(-1).parts, ['front']);
  // a part that speaks about its own message is told again each time, the same or not
  real[1] = ['address', '- Form of address: use it once.', { again: true }];
  ask(); assert.deepEqual(logs.at(-1).parts, ['address']);
  ask(); assert.deepEqual(logs.at(-1).parts, ['address'], 'again, though it is the same');
  real[1] = ['address', '- Form of address: leave it out.'];
  ask(); ask(); assert.deepEqual(logs.at(-1).parts, []);

  // ---- many requests with changes at random (a fixed sequence): the rule holds at every one
  let seed = 7; const rnd = (k) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % k; };
  const names = ['front', 'pi', 'notes', 'calendar', 'actions', 'voice', 'shortcuts', 'memory'];
  for (let i = 0; i < 300; i++) {
    const name = names[rnd(names.length)], at = real.findIndex((p) => p[0] === name), what = rnd(4);
    if (what === 0 && at >= 0) real.splice(at, 1);
    else if (what === 1) { const p = [name, `- ${name}: value ${rnd(5)}\n  second line ${rnd(3)}`]; if (at >= 0) real[at] = p; else real.push(p); }
    ask({ parts: rnd(6) === 0 });
  }
  const quiet = logs.slice(-300).filter((d) => !d.parts.length).length;
  assert.ok(quiet > 100, `requests where nothing changed carried nothing (${quiet} of 300)`);

  // ---- the oldest messages are trimmed away (the hard limit): what they held is sent again
  ask.prevKeep = false;
  msgs = msgs.slice(-6); // only the newest three exchanges are left, none of them with every part
  s = ask();
  assert.deepEqual(obj(pieced(s)), want());
  // and a request's own block is made again if the message it built on goes while it is still the newest
  real = [['front', '- In Notes.'], ['voice', '- Voice: on.'], ['pi', '- pi works in: ~/a.']];
  ask();
  real[0] = ['front', '- In Preview.'];
  s = ask();
  assert.deepEqual(logs.at(-1).parts, ['front']);
  const lastOnly = live.attach([s.at(-1)]);
  assert.deepEqual(obj(pieced(lastOnly)), want(), 'everything before it trimmed: it now carries every part');
  assert.ok(logs.at(-1).full && logs.at(-1).parts.length === 3);
  msgs = [...lastOnly, { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }]; ask.prev = null;

  // ---- a fold: the first request after it carries the whole state again
  for (let i = 0; i < 8; i++) ask();
  const stored = msgs.map((m) => (m.role !== 'user' ? m : { ...m, content: typeof m.content === 'string' ? stripLive(m.content) : m.content.map((p, j) => (j === 0 ? { ...p, text: stripLive(p.text) } : p)) }));
  const plan = planFold(stored, { trigger: 40 }); // a low trigger: this short conversation folds
  assert.ok(plan.ok, plan.reason);
  msgs = applyFold(stored, plan, 'They asked ten things.'); live.clear(); ask.prev = null; // what sidekick.mjs does when a fold lands
  s = ask();
  assert.ok(logs.at(-1).full && blockOn(s).includes('every part'), 'in full after a fold');
  assert.deepEqual(obj(pieced(s)), want());
  assert.equal(s.filter((m) => m.role === 'user' && (typeof m.content === 'string' ? m.content : m.content[0].text).startsWith(LIVE_OPEN)).length, 1, 'and only there: the kept messages carry none');
  real.push(['pi', '- pi works in: ~/b.']); ask(); assert.deepEqual(logs.at(-1).parts, ['pi']);

  // ---- a new conversation, and Claude Code starting a session of its own: in full
  live.clear(); msgs = []; ask.prev = null;
  ask(); assert.ok(logs.at(-1).full);
  // ---- the hard trim of store.mjs on what attach() made: still the real state
  for (let i = 0; i < 30; i++) { if (i % 7 === 0) real[0] = ['front', `- In app ${i}.`]; ask(); }
  ask.prevKeep = false;
  msgs = fitContext(msgs, { budgetTokens: 60 }); s = ask();
  assert.ok(s.length < 20, 'trimmed');
  assert.deepEqual(obj(pieced(s)), want());
  assert.equal(live.charsFor(s.filter((m) => m.role === 'user').at(-1)), blockOn(s) ? blockOn(s).length + LIVE_CLOSE.length + 2 : 0, 'what a message carries is counted');
}

// ---- where it is used (sidekick.mjs, claudecode.mjs)
{
  const side = fs.readFileSync(path.join(here, '..', 'sidekick.mjs'), 'utf8'), cc = fs.readFileSync(path.join(here, '..', 'claudecode.mjs'), 'utf8');
  assert.match(side, /const liveBlocks = createLiveBlocks\(\{ now: livePrompt, log: \(d\) => logLine\('live', d\) \}\);/);
  assert.match(side, /if \(o\?\.fresh\) liveBlocks\.clear\(\);/, 'Claude Code starting over: every part again');
  assert.match(cc, /o\.transformContext\(this\.messages, \{ fresh: !resume \}\)/);
  assert.match(side, /liveBlocks\.clear\(\); \/\/ feature 24: the first request after a fold carries the whole live state again/);
  assert.equal(side.split('liveBlocks.clear()').length, 5, 'cleared on a new conversation (twice), a fold and a fresh Claude Code session');
  const liveText = side.slice(side.indexOf('const livePrompt = (context'), side.indexOf('const system = () => stablePrompt();'));
  for (const name of ['front', 'address', 'pi', 'notes', 'calendar', 'actions', 'voice', 'shortcuts', 'memory']) assert.ok(liveText.includes(`['${name}', `), `the part ${name}`);
  assert.ok(!/Live state \(current as of this moment\)/.test(side), 'no whole block made outside live.mjs');
  // the instructions: a later part replaces an earlier one of the same name, so the newest holds
  const rule = side.slice(side.indexOf('A <live-state> block at the top of a message'));
  assert.ok(rule.includes('A later part replaces an earlier one with the same name') && rule.includes('"no longer applies." removes it') && rule.includes('what holds now is the newest of each part anywhere in the conversation'));
  assert.ok(rule.includes('a message has no block when nothing changed'));
  // the log line says which parts and how many characters, never the text
  assert.ok(!/logLine\('live', \{[^}]*block/.test(side));
}

console.log('live state tests: passed');
