// Feature 24, fix 6: the overlay page rebuilt after a quiet stretch. Run: npm test
//  1. when (rebuild.mjs), with a clock moved by hand;
//  2. the page (host.js, agent.js, 10-dither.js) without a screen (page.mjs): when it says it is at rest, and how a new
//     page takes over (at home at once, no entrance, JARVIS's globe as it was);
//  3. the wiring in sidekick.mjs and in the shell (main.rs), read from the source.
// The sidecar itself, run with the setting at one minute: rebuild-run.test.mjs (npm run test:all).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codeReference, loadSettings } from '../pi.mjs';
import { settingsReference } from '../reference.mjs';
import { MEASURE_SECONDS, SETTLE_HOLD_SECONDS, createPageRebuild, measureLine } from '../rebuild.mjs';
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
  assert.deepEqual(asked.length, logged.filter(([k]) => k === 'page_rebuild').length);
}

// ---- 1b. measuring ("measurePageRebuild"): asked of the shell with the rebuild, logged only while it lasts, numbers only
{
  let t = 0, on = false;
  const asked = [], logged = [];
  const r = createPageRebuild({ minutes: () => 1, quiet: () => true, measure: () => on, rebuild: (o) => asked.push(o), log: (k, d) => logged.push([k, d]), now: () => t });
  const row = { type: 'measure', src: 'page', label: 'overlay-3-0', rows: [[1764000000000.123, 'frame', 72, 763.25, 1, 'shown']] };
  const rest = () => { r.shown(); r.page(true); t += 60_000; return r.tick(); };
  assert.equal(rest(), true); assert.deepEqual(asked.at(-1), { measure: 0 }, 'off: the shell is not asked to measure');
  assert.deepEqual(logged.at(-1), ['page_rebuild', { quietMinutes: 1 }]);
  assert.equal(r.measured(row), false, 'off: nothing measured is logged'); r.ready();
  on = true; assert.equal(rest(), true); assert.deepEqual(asked.at(-1), { measure: MEASURE_SECONDS }, 'on: the shell measures');
  assert.deepEqual(logged.at(-1), ['page_rebuild', { quietMinutes: 1, measureSeconds: MEASURE_SECONDS }]);
  assert.equal(r.measured(row), true);
  assert.deepEqual(logged.at(-1), ['rebuild_measure', { src: 'page', label: 'overlay-3-0', rows: [[1764000000000.1, 'frame', 72, 763.3, 1, 'shown']] }]);
  r.ready(); t += 15_000 + 2 * MEASURE_SECONDS * 1000 + 1;
  assert.equal(r.measured(row), false, 'and only for as long as a rebuild can take, plus its seconds');
  const thrown = createPageRebuild({ minutes: () => 1, quiet: () => true, measure: () => { throw new Error('settings.json'); }, rebuild: (o) => asked.push(o), now: () => t });
  thrown.shown(); thrown.page(true); t += 60_000; assert.equal(thrown.tick(), true); assert.deepEqual(asked.at(-1), { measure: 0 }, 'a setting that cannot be read: off');
  // what is logged: the source, a window label, and rows of numbers, null and short words; nothing else
  assert.equal(measureLine(null), null); assert.equal(measureLine({ src: 'other', rows: [[1]] }), null); assert.equal(measureLine({ src: 'shell', rows: [] }), null);
  assert.deepEqual(measureLine({ src: 'shell', label: 'overlay-1-0', rows: [[1, 'moved', 'overlay-1-0', 0, 33.33, Infinity, true, { x: 1 }, 'a phrase with spaces', 'x'.repeat(41), [1]]], extra: 'text' }),
    { src: 'shell', label: 'overlay-1-0', rows: [[1, 'moved', 'overlay-1-0', 0, 33.3, null, 1, null, null, null, null]] });
  assert.equal(measureLine({ src: 'page', label: '../secret', rows: [[1]] }).label, undefined, 'a label that is not a window\'s is dropped');
  assert.equal(measureLine({ src: 'page', rows: Array.from({ length: 500 }, () => [1]) }).rows.length, 400, 'at most 400 rows a line');
  assert.equal(measureLine({ src: 'page', rows: [Array.from({ length: 30 }, () => 1)] }).rows[0].length, 16, 'at most 16 values a row');
  // the setting: off by default, shown in settings.default.json with what stays in code; true or false only
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rebuild-home-')));
  const file = path.join(home, 'Documents', 'roamies-pi', 'settings.json');
  assert.equal(loadSettings(home).measurePageRebuild, false);
  assert.equal(settingsReference(home).measurePageRebuild, false, 'in settings.default.json, off');
  assert.deepEqual([codeReference().pageRebuild.measureSeconds, codeReference().pageRebuild.settleHoldSeconds], [MEASURE_SECONDS, SETTLE_HOLD_SECONDS]);
  const file0 = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...file0, measurePageRebuild: true })); assert.equal(loadSettings(home).measurePageRebuild, true);
  fs.writeFileSync(file, JSON.stringify({ ...file0, measurePageRebuild: 'yes' })); assert.equal(loadSettings(home).measurePageRebuild, false); assert.ok(loadSettings(home).invalid.some((i) => i.name === 'measurePageRebuild'));
  { const f = { ...file0 }; delete f.measurePageRebuild; fs.writeFileSync(file, JSON.stringify(f)); assert.equal(loadSettings(home).measurePageRebuild, false, 'a settings.json from before it: off'); assert.ok(loadSettings(home).missing.includes('measurePageRebuild')); }
  fs.rmSync(home, { recursive: true, force: true });
}

// ---- 2. the page
const rests = (p) => p.sent.filter((s) => s.type === 'page_rest');
const lastRest = (p) => rests(p).at(-1)?.on ?? false;
/** Lets the page run until it says it is at rest, up to sec seconds (blinks and the wave's length vary). → whether it did. */
const restsWithin = async (p, sec) => { for (let t = 0; t < sec && !lastRest(p); t += 0.5) await p.tick(0.5); return lastRest(p); };
{
  const p = page();
  await p.tick(0.5);
  for (const m of [{ kind: 'orb', size: 100 }, { kind: 'home', home: 'bottom-left' }]) p.host(m);
  assert.equal(await restsWithin(p, 15), true, 'at rest at home with nothing on screen: it says so');
  assert.equal(p.R.rested(), true);
  const said = rests(p).at(-1);
  assert.ok(Number.isFinite(said.keep.spin), 'with the turn of the orb\'s particles');
  assert.equal(rests(p).length, 1, 'once, when it changes');
  await p.tick(30); assert.equal(rests(p).length, 1, 'and not again while nothing changes');

  // anything on screen, anything heard, anything waiting: not at rest; at rest again once it has gone
  const cases = [
    ['a reply', () => p.agent.say('Here is the answer.'), () => p.agent.hush()],
    ['a thought', () => p.host({ kind: 'agent', e: { type: 'start' } }), () => p.host({ kind: 'agent', e: { type: 'done' } })],
    ['a question with buttons', () => p.host({ kind: 'ask', id: 7, prompt: 'Book a block?', choices: ['Yes', 'No'] }), () => p.host({ kind: 'cancel_ask', id: 7 })],
    ['listening', () => p.host({ kind: 'voice', type: 'state', state: 'listening', mode: 'hold' }), () => p.host({ kind: 'voice', type: 'state', state: 'idle', cancelled: true })],
    ['the task tag of a tool', () => p.host({ kind: 'agent', e: { type: 'tool', id: 't1', anim: { tool: 'read', label: 'Reading' } } }), () => { p.host({ kind: 'agent', e: { type: 'tool_end', id: 't1' } }); p.host({ kind: 'agent', e: { type: 'done' } }); }],
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
// with no entrance and the particles turned as they were; then it rests and says so.
{
  const p = page();
  await p.tick(0.5);
  assert.deepEqual(p.sent.map((s) => s.type), ['ui_ready']);
  assert.equal(p.agent.presence, 'hidden', 'a new page starts with the character hidden');
  for (const m of [{ kind: 'orb', size: 100 }, { kind: 'home', home: 'bottom-left' }, { kind: 'settle', spin: 4.25 }]) p.host(m);
  assert.equal(p.agent.presence, 'shown', 'there at once: no entrance');
  atSpot(p, HOME['bottom-left'], 'on its home spot');
  assert.equal(p.creature.agent.keep.spin, 4.25, 'the particles turned as the old page had them');
  await p.tick(0.05);
  assert.equal(p.agent.presence, 'shown');
  await p.tick(3);
  atSpot(p, HOME['bottom-left'], 'and it stays there'); assert.equal(p.agent.keep.spin, 4.25, 'the particles have not turned');
  assert.equal(await restsWithin(p, 15), true, 'at rest, and says so');
  assert.equal(p.R.rested(), true);
  assert.equal(rests(p).at(-1).keep.spin, 4.25);

  // settle before the home has arrived: it comes on screen at home when it does, still without an entrance
  const q = page(); await q.tick(0.5);
  q.host({ kind: 'orb', size: 100 }); q.host({ kind: 'settle' });
  assert.equal(q.agent.presence, 'hidden', 'no home yet');
  q.host({ kind: 'home', home: 'top-right' }); await q.tick(0.3);
  assert.equal(q.agent.presence, 'hidden'); await q.tick(0.3);
  assert.equal(q.agent.presence, 'shown', 'on screen at once when it comes'); atSpot(q, HOME['top-right'], 'at the home it was given');

  // an ordinary start, for comparison: an entrance
  const o = page(); await o.tick(0.5);
  o.host({ kind: 'orb', size: 100 }); o.host({ kind: 'home', home: 'bottom-left' }); await o.tick(0.5);
  assert.equal(o.agent.presence, 'in', 'an ordinary start comes on with an entrance');
}

// The owner saw the orb hop up a little after a rebuild, then slide slowly to its place. In its small size, settle
// used the default size's radius for the home spot (the radius the page had kept from its last frame), then the next
// frame worked it out again with the small one and the character glided there. Now it is placed at the final spot
// at once, and stays exactly there; every position it is drawn at is that spot. Feature 21: sizes are orb.size.
const SMALL = [94, 746]; // bottom-left, at 80 points (radius 39.2)
const settled = async (size, more = {}) => {
  const p = page(); p.win.ROAMIE_LABEL = 'overlay-2-0'; await p.tick(0.5);
  p.win.__roamieMeasure(30_000);
  for (const m of [{ kind: 'orb', size: size === 'small' ? 80 : 100 }, { kind: 'home', home: 'bottom-left' }, { kind: 'settle', spin: 1, hold: SETTLE_HOLD_SECONDS, ...more }]) p.host(m);
  return p;
};
const rowsOf = (p) => p.sent.filter((s) => s.type === 'measure').flatMap((s) => s.rows);
for (const [size, spot] of [['small', SMALL], ['default', HOME['bottom-left'].map(Math.round)]]) {
  const p = await settled(size);
  assert.deepEqual(p.at().map(Math.round), spot, `${size}: on its final home spot at once`);
  const seen = new Set();
  for (let i = 0; i < 40; i++) { await p.tick(0.1); seen.add(p.at().map(Math.round).join()); }
  assert.deepEqual([...seen], [spot.join()], `${size}: and never anywhere else in its first four seconds`);
  const frames = rowsOf(p).filter((r) => r[1] === 'frame' && r[2] !== null);
  assert.ok(frames.length > 0 && frames.every((r) => Math.round(r[2]) === spot[0] && Math.round(r[3]) === spot[1]), `${size}: every frame draws it there`);
  // the page tells the shell once, two frames after the first frame that drew it, and where
  const drawn = p.invoked.filter(([c]) => c === 'page_drawn');
  assert.equal(drawn.length, 1, `${size}: drawn, said once`); assert.deepEqual([drawn[0][1].x, drawn[0][1].y].map(Math.round), spot);
}
{
  // corrections in the first seconds are made at once; after them, as before, it glides
  const p = await settled('default'), b0 = p.R.safe.bottom;
  await p.tick(1);
  p.win.__roamieSafe({ top: 33, left: 0, bottom: b0 + 40, right: 0, ox: 0, oy: 0 }); await p.tick(1 / 60); await p.tick(1 / 60);
  const [hx, hy] = HOME['bottom-left'].map(Math.round);
  assert.deepEqual(p.at().map(Math.round), [hx, hy - 40], 'the Dock grew in the first seconds: straight to the new spot');
  await p.tick(0.15); // rows go to the sidecar every 100 ms
  const rows = rowsOf(p);
  assert.ok(rows.some((r) => r[1] === 'home' && r[6] === 'bottom' && Math.round(r[5]) === hy - 40), 'the change is measured with its cause');
  assert.ok(rows.some((r) => r[1] === 'place' && r[4] === 'at_once'), 'and how it was applied');
  assert.ok(rows.some((r) => r[1] === 'safe' && r[4] === b0 + 40), 'with the edges the shell gave');
  await p.tick(SETTLE_HOLD_SECONDS);
  p.win.__roamieSafe({ top: 33, left: 0, bottom: b0, right: 0, ox: 0, oy: 0 }); await p.tick(0.1);
  const y = p.at()[1];
  assert.ok(y > hy - 40 && y < hy - 1, `after the first seconds it glides as before (at ${y.toFixed(1)} after 0.1 s)`);
  await p.tick(4); atSpot(p, HOME['bottom-left'], 'and gets there');
  // the measured rows are numbers and short words only, as the sidecar logs them
  assert.ok(rowsOf(p).every((r) => typeof r[0] === 'number' && typeof r[1] === 'string' && r.every((v) => v === null || ['number', 'string'].includes(typeof v))));
  assert.ok(rowsOf(p).every((r) => r.every((v) => typeof v !== 'string' || /^[a-z][a-z0-9_.+-]{0,39}$/i.test(v))), 'every word is one the sidecar keeps');
  assert.ok(p.sent.filter((s) => s.type === 'measure').every((s) => s.label === 'overlay-2-0'), 'with the window it came from');
}
{
  // measuring off (no ROAMIE_MEASURE, no __roamieMeasure): nothing is sent
  const p = page(); await p.tick(0.5);
  for (const m of [{ kind: 'orb', size: 80 }, { kind: 'home', home: 'bottom-left' }, { kind: 'settle' }]) p.host(m);
  await p.tick(2);
  assert.equal(p.sent.filter((s) => s.type === 'measure').length, 0, 'off: nothing measured');
  assert.deepEqual(p.at().map(Math.round), SMALL, 'and still placed at once (the hold is 3 s without one given)');
}

// ---- 3. the wiring, read from the source
{
  const side = fs.readFileSync(new URL('../sidekick.mjs', import.meta.url), 'utf8');
  const ready = side.slice(side.indexOf("else if (m.type === 'ui_ready')"), side.indexOf("else if (m.type?.startsWith('ob_')"));
  assert.match(ready, /const keep = pageRebuild\?\.ready\(\)/, 'ui_ready asks whether this page is a rebuild');
  assert.match(ready, /if \(keep\) ui\(\{ kind: 'settle'/, 'a rebuilt page is settled');
  assert.ok(!/kind: 'greet'/.test(side), 'feature 21: no greeting wave (the orb has no acts)');
  assert.ok(ready.indexOf("kind: 'orb'") >= 0 && ready.indexOf("kind: 'orb'") < ready.indexOf("kind: 'settle'"), 'settle comes after the settings');
  assert.match(side, /if \(!PAGE_SETTINGS\.has\(msg\.kind\)\) pageRebuild\?\.shown\(\);\n\s*send\(\{ type: 'ui', msg \}\);/, 'everything the page is sent counts as shown, but its settings');
  assert.match(side, /minutes: \(\) => limitsFor\(HOME\)\.pageRebuildQuietMinutes,/, 'the setting is read at each check');
  const quiet = /quiet: \(\) => ([^\n]+),\n/.exec(side.slice(side.indexOf('pageRebuild = createPageRebuild(')))[1];
  for (const part of ['calQuietBase()', '!pi.bubble()', '!answers.open()', '!micWindow', '!heldSpeech.length', '!turnVoice', '!cal.hasHeld()', '!flow.open()', '!flow.window()']) assert.ok(quiet.includes(part), `quiet needs ${part}`);
  assert.ok(!/pending/.test(quiet), 'a question kept in state.json does not hold the rebuild off');
  assert.ok(!/stood|calQuiet\(\)/.test(quiet), 'nor does stand down (feature 33): calQuietBase, not calQuiet');
  assert.match(side, /rebuild: \(\{ measure \}\) => send\(\{ type: 'rebuild_overlays', measure \}\),\n\s*measure: \(\) => loadSettings\(HOME\)\.measurePageRebuild,/, 'the shell is asked to measure when the setting is on');
  assert.match(ready, /ui\(\{ kind: 'settle', hold: SETTLE_HOLD_SECONDS,/, 'the new page is told how long it holds its spot');
  assert.match(side, /else if \(m\.type === 'measure'\) pageRebuild\?\.measured\(m\);/, 'what is measured goes through measured(), which logs only while it lasts');
  const shell = fs.readFileSync(new URL('../../src-tauri/src/main.rs', import.meta.url), 'utf8');
  assert.match(shell, /Some\("rebuild_overlays"\) => rebuild_overlays\(app, msg\.get\("measure"\)/, 'the shell rebuilds when asked');
  assert.match(shell, /is_overlay\(&label\) && !retiring\(&label\)/, 'the old windows get nothing more');
  assert.ok(!/RETIRE_AFTER/.test(shell), 'the old windows no longer go after a fixed time');
  const drawnFn = shell.slice(shell.indexOf('fn page_drawn('), shell.indexOf('fn to_overlays('));
  assert.match(drawnFn, /if retiring\(&label\) \|\| REBUILD\.lock\(\)\.unwrap\(\)\.is_some\(\) \|\| RETIRING\.lock\(\)\.unwrap\(\)\.is_empty\(\) \{\n\s*return;/, 'only a new page, once it has its settings, lets the old windows go');
  assert.match(drawnFn, /retire_old\(&app\)/);
  assert.match(shell, /generate_handler!\[[^\]]*page_drawn/, 'the page can report it');
  const endFn = shell.slice(shell.indexOf('fn end_rebuild('), shell.indexOf('fn retire_old('));
  assert.match(endFn, /thread::sleep\(DRAWN_WAIT\)/, 'and if it never reports, they go after DRAWN_WAIT');
}

console.log('page rebuild tests: passed');
