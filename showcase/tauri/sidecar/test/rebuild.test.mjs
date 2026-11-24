// Feature 24, fix 6: the overlay page rebuilt after a quiet stretch. Run: npm test
//  1. when (rebuild.mjs), with a clock moved by hand;
//  2. the page (host.js, agent.js, 10-dither.js) without a screen (page.mjs): when it says it is at rest, and how a new
//     page takes over (at home at once, no entrance, JARVIS's globe as it was);
//  3. the wiring in sidekick.mjs and in the shell (main.rs), read from the source.
// The sidecar itself, run with the setting at one minute: rebuild-run.test.mjs (npm run test:all).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPageRebuild } from '../rebuild.mjs';
import { HOME, atSpot, page } from './page.mjs';

// ---- 1. when
{
  let t = 0, minutes = 15, quiet = true;
  const asked = [], logged = [];
  const r = createPageRebuild({ minutes: () => minutes, quiet: () => quiet, rebuild: () => asked.push(t), log: (k, d) => logged.push([k, d]), now: () => t });
  const min = 60_000;
  // the sidecar checks every 15 s: → whether a rebuild was asked for in that time
  const tick = (ms) => { let any = false; for (const end = t + ms; t < end;) { t = Math.min(end, t + 15_000); any = r.tick() || any; } return any; };

  // nothing shown yet since start-up: never, however long it rests
  r.page(true, { spin: 2 });
  for (let i = 0; i < 200; i++) assert.equal(tick(min), false, 'nothing was shown or spoken since start-up');
  // something shown: from the moment it is at rest again, fifteen minutes
  r.shown(); r.page(false); tick(min); r.page(true, { spin: 2.5 });
  assert.equal(tick(14 * min + 45_000), false, 'fourteen and three quarter quiet minutes');
  assert.equal(tick(15_000), true, 'fifteen');
  assert.deepEqual(asked, [t]); assert.deepEqual(logged.at(-1), ['page_rebuild', { quietMinutes: 15 }]);
  assert.equal(r.rebuilding(), true);
  assert.equal(tick(5000), false, 'one at a time'); assert.equal(r.rebuilding(), true);
  // the new page reports ready: it takes over the globe's turn; the next page to start is not a rebuild's
  t = asked[0] + 120;
  assert.deepEqual(r.ready(), { spin: 2.5 }); assert.deepEqual(logged.at(-1), ['page_rebuilt', { ms: 120 }]);
  assert.equal(r.rebuilding(), false); assert.equal(r.ready(), null, 'an ordinary start is greeted');
  // the new page at rest, nothing shown since the rebuild: never again until something is
  r.page(true, { spin: 2.5 });
  for (let i = 0; i < 100; i++) assert.equal(tick(min), false, 'nothing shown since the last rebuild');

  // any break starts the count again: something shown, the page busy, the sidecar busy
  r.shown(); r.page(true);
  assert.equal(tick(10 * min), false); r.shown(); assert.equal(tick(10 * min), false, 'shown: the count starts again');
  assert.equal(tick(5 * min), true, 'and runs fifteen minutes from there');
  t += 100; r.ready(); r.shown(); r.page(true);
  assert.equal(tick(10 * min), false); r.page(false); r.page(true); assert.equal(tick(10 * min), false, 'the page busy: again');
  assert.equal(tick(5 * min), true); t += 100; r.ready(); r.shown(); r.page(true);
  assert.equal(tick(10 * min), false); quiet = false; assert.equal(tick(15_000), false, 'a check finds the sidecar busy'); quiet = true;
  assert.equal(tick(15 * min), false, 'the sidecar busy (a request, speech, a question on screen): again, from the next check that finds it quiet');
  assert.equal(tick(15_000), true); t += 100; r.ready();

  // the setting: 0 is never, a new value is read at the next check, a setting that can't be read is never
  r.shown(); r.page(true); minutes = 0;
  for (let i = 0; i < 100; i++) assert.equal(tick(min), false, '0: never');
  minutes = 1; assert.equal(tick(min), false, 'the count starts when the setting is on'); assert.equal(tick(min), true, 'one minute');
  t += 100; r.ready(); r.shown(); r.page(true);
  const broken = createPageRebuild({ minutes: () => { throw new Error('settings.json'); }, quiet: () => true, rebuild: () => assert.fail('never'), now: () => t });
  broken.shown(); broken.page(true); for (let i = 0; i < 100; i++) { t += min; assert.equal(broken.tick(), false); }

  // a new page that never reports ready: after the time allowed, the rebuild is over and the count can start again
  minutes = 1; r.shown(); r.page(true); assert.equal(tick(min), true);
  assert.equal(tick(14_000), false); assert.equal(r.rebuilding(), true);
  assert.equal(tick(2000), false); assert.equal(r.rebuilding(), false); assert.equal(logged.at(-1)[0], 'page_rebuild_late');
  assert.equal(r.ready(), null, 'a page that reports ready after that is an ordinary start');
  // a keep that is not an object is not handed over
  r.shown(); r.page(true, 'spin'); assert.equal(tick(min), true); assert.deepEqual(r.ready(), {});
}

// ---- 2. the page
const rests = (p) => p.sent.filter((s) => s.type === 'page_rest');
const lastRest = (p) => rests(p).at(-1)?.on ?? false;
/** Lets the page run until it says it is at rest, up to sec seconds (blinks and the wave's length vary). → whether it did. */
const restsWithin = async (p, sec) => { for (let t = 0; t < sec && !lastRest(p); t += 0.5) await p.tick(0.5); return lastRest(p); };
{
  const p = page();
  await p.tick(0.5);
  for (const m of [{ kind: 'size', size: 'default' }, { kind: 'home', home: 'bottom-left' }, { kind: 'look', look: 'jarvis' }]) p.host(m);
  assert.equal(await restsWithin(p, 15), true, 'at rest at home with nothing on screen: it says so');
  assert.equal(p.R.rested(), true);
  const said = rests(p).at(-1);
  assert.ok(Number.isFinite(said.keep.spin), 'with the turn of the globe');
  assert.equal(rests(p).length, 1, 'once, when it changes');
  await p.tick(30); assert.equal(rests(p).length, 1, 'and not again while nothing changes');

  // anything on screen, anything heard, anything waiting: not at rest; at rest again once it has gone
  const cases = [
    ['a reply', () => p.agent.say('Here is the answer.'), () => p.agent.hush()],
    ['a thought', () => p.host({ kind: 'agent', e: { type: 'start' } }), () => p.host({ kind: 'agent', e: { type: 'done' } })],
    ['a question with buttons', () => p.host({ kind: 'ask', id: 7, prompt: 'Book a block?', choices: ['Yes', 'No'] }), () => p.host({ kind: 'cancel_ask', id: 7 })],
    ['listening', () => p.host({ kind: 'voice', type: 'state', state: 'listening', mode: 'hold' }), () => p.host({ kind: 'voice', type: 'state', state: 'idle', cancelled: true })],
    ['the task tag of a tool', () => p.host({ kind: 'agent', e: { type: 'tool', id: 't1', anim: { tool: 'read', label: 'Reading' } } }), () => { p.host({ kind: 'agent', e: { type: 'tool_end', id: 't1' } }); p.host({ kind: 'agent', e: { type: 'done' } }); }],
    ['a wave', () => p.host({ kind: 'greet' }), () => {}],
  ];
  for (const [what, on, off] of cases) {
    on(); await p.tick(1);
    assert.equal(lastRest(p), false, `${what}: not at rest`);
    off();
    assert.equal(await restsWithin(p, 15), true, `${what}: at rest again once it has gone`);
  }
  // the character dragged off its home: not at rest there, however long it stays
  await p.drag(760, 420); await p.tick(20);
  assert.equal(p.R.rested(), true, 'it rests where it was dropped');
  assert.equal(lastRest(p), false, 'but that is not its home');
  // back home after its next drawing: at rest again
  const took = p.agent.pen.take(); await p.tick(2); await took;
  const back = p.agent.pen.release(); await p.tick(4); await back; await p.tick(4);
  atSpot(p, HOME['bottom-left'], 'home again'); assert.equal(await restsWithin(p, 15), true);
  // sent away with the summon key: not at rest (a new page would bring it back)
  p.host({ kind: 'summon' }); await p.tick(3); assert.equal(lastRest(p), false);
  p.host({ kind: 'summon' }); assert.equal(await restsWithin(p, 15), true);
  // while it changes screens, messages wait in the page: not at rest until they are handed on
  p.win.__roamieMoved(); await p.tick(0.2); assert.equal(lastRest(p), false);
}

// A new page taking over: the sidecar answers its ui_ready with the settings and "settle". It is at home at once,
// with no entrance, no wave, and the globe turned as it was; then it rests and says so.
{
  const p = page();
  await p.tick(0.5);
  assert.deepEqual(p.sent.map((s) => s.type), ['ui_ready']);
  assert.equal(p.agent.presence, 'hidden', 'a new page starts with the character hidden');
  for (const m of [{ kind: 'sound', on: true }, { kind: 'size', size: 'default' }, { kind: 'home', home: 'bottom-left' }, { kind: 'look', look: 'jarvis' }, { kind: 'settle', spin: 4.25 }]) p.host(m);
  assert.equal(p.agent.presence, 'shown', 'there at once: no entrance');
  atSpot(p, HOME['bottom-left'], 'on its home spot');
  assert.equal(p.creature.agent.keep.spin, 4.25, 'the globe turned as the old page had it');
  await p.tick(0.05);
  assert.equal(p.agent.presence, 'shown');
  await p.tick(3);
  atSpot(p, HOME['bottom-left'], 'and it stays there'); assert.equal(p.agent.keep.spin, 4.25, 'the globe has not turned');
  assert.equal(await restsWithin(p, 15), true, 'at rest, and says so');
  assert.equal(p.R.rested(), true);
  assert.equal(rests(p).at(-1).keep.spin, 4.25);

  // settle before the home has arrived: it comes on screen at home when it does, still without an entrance
  const q = page(); await q.tick(0.5);
  q.host({ kind: 'size', size: 'default' }); q.host({ kind: 'settle' });
  assert.equal(q.agent.presence, 'hidden', 'no home yet');
  q.host({ kind: 'home', home: 'top-right' }); await q.tick(0.3);
  assert.equal(q.agent.presence, 'hidden'); await q.tick(0.3);
  assert.equal(q.agent.presence, 'shown', 'on screen at once when it comes'); atSpot(q, HOME['top-right'], 'at the home it was given');

  // an ordinary start, for comparison: an entrance
  const o = page(); await o.tick(0.5);
  o.host({ kind: 'size', size: 'default' }); o.host({ kind: 'home', home: 'bottom-left' }); await o.tick(0.5);
  assert.equal(o.agent.presence, 'in', 'an ordinary start comes on with an entrance');
}

// ---- 3. the wiring, read from the source
{
  const side = fs.readFileSync(new URL('../sidekick.mjs', import.meta.url), 'utf8');
  const ready = side.slice(side.indexOf("else if (m.type === 'ui_ready')"), side.indexOf("else if (m.type?.startsWith('ob_')"));
  assert.match(ready, /const keep = pageRebuild\?\.ready\(\)/, 'ui_ready asks whether this page is a rebuild');
  assert.match(ready, /if \(keep\) ui\(\{ kind: 'settle'[^\n]*\n\s*else if \(config\.onboarded\) ui\(\{ kind: 'greet' \}\);/, 'a rebuilt page is settled, not greeted');
  assert.ok(ready.indexOf("kind: 'look'") < ready.indexOf("kind: 'settle'"), 'settle comes after the settings');
  assert.match(side, /if \(!PAGE_SETTINGS\.has\(msg\.kind\)\) pageRebuild\?\.shown\(\);\n\s*send\(\{ type: 'ui', msg \}\);/, 'everything the page is sent counts as shown, but its settings');
  assert.match(side, /minutes: \(\) => limitsFor\(HOME\)\.pageRebuildQuietMinutes,/, 'the setting is read at each check');
  const quiet = /quiet: \(\) => ([^\n]+),\n/.exec(side.slice(side.indexOf('pageRebuild = createPageRebuild(')))[1];
  for (const part of ['calQuiet()', '!pi.bubble()', '!answers.open()', '!micWindow', '!heldSpeech.length', '!turnVoice', '!cal.hasHeld()', '!flow.open()', '!flow.window()', '!intro', '!showcase']) assert.ok(quiet.includes(part), `quiet needs ${part}`);
  assert.ok(!/pending/.test(quiet), 'a question kept in state.json does not hold the rebuild off');
  assert.match(side, /rebuild: \(\) => send\(\{ type: 'rebuild_overlays' \}\)/);
  const shell = fs.readFileSync(new URL('../../src-tauri/src/main.rs', import.meta.url), 'utf8');
  assert.match(shell, /Some\("rebuild_overlays"\) => rebuild_overlays\(app\)/, 'the shell rebuilds when asked');
  assert.match(shell, /is_overlay\(&label\) && !retiring\(&label\)/, 'the old windows get nothing more');
}

console.log('page rebuild tests: passed');
