// Local-only build, feature 22: conversation flow (flow.mjs), with the real answers.mjs and pi.mjs wired to it the
// way sidekick.mjs wires them. The clock and the timers are made up, the overlay (which says when speech has finished
// playing) and the voice helper (the microphone) are stand-ins, and pi is a script. No model is called.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { Unanswered, CLOSING_PHRASES, FILLER_WORDS, createAnswers, heardLine, isClosing, unfilled } from '../answers.mjs';
import { createFlow, SAME, sameKey } from '../flow.mjs';
import { HANDS_FREE_SEND, LIMITS, WINDOW, briefly, codeReference, createPi, isHandsFreeSend, loadSettings, readState, settingsDefaults } from '../pi.mjs';
import { createSpeaker } from '../speaker.mjs';
import { LocalVoice } from '../localvoice.mjs';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flow-home-')));
const dir = path.join(home, 'Documents', 'roamies-pi'), work = path.join(dir, 'workspace');
const bin = path.join(home, 'bin'); fs.mkdirSync(bin);
const fakePi = path.join(bin, 'pi');
fs.writeFileSync(fakePi, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(path.join(home, 'calls.log'))}, JSON.stringify({ args }) + '\\n');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
out({ type: 'session', version: 3, id: 'sess-1', cwd: process.cwd() });
out({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }], stopReason: 'stop' } });
out({ type: 'agent_settled', aborted: false });
`, { mode: 0o755 });
process.env.PATH = `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`;
loadSettings(home);
const settingsFile = path.join(dir, 'settings.json');
const writeSettings = (more = {}) => fs.writeFileSync(settingsFile, JSON.stringify({ pi: fakePi, sandbox: false, autoSendReadOnly: 0, progressSeconds: 0, ...more }));
writeSettings();
const calls = () => (fs.existsSync(path.join(home, 'calls.log')) ? fs.readFileSync(path.join(home, 'calls.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);

// ---- a made-up clock; timers run only when the test moves it
let t = Date.parse('2026-11-16T10:00:00Z');
const due = [];
const timers = { set: (fn, ms) => { const x = { fn, at: t + ms }; due.push(x); return x; }, clear: (x) => { const i = due.indexOf(x); if (i >= 0) due.splice(i, 1); } };
const tick = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
async function advance(ms) {
  const end = t + ms;
  for (;;) {
    const next = due.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
    if (!next) break;
    t = next.at; timers.clear(next); next.fn(); await tick();
  }
  t = end; await tick();
}
const until = async (ok, what) => { for (let i = 0; i < 600 && !ok(); i++) await new Promise((r) => setTimeout(r, 5)); assert.ok(ok(), what); };

// ---- the stand-ins
const overlay = { bubbles: [], speaking: [], said: [], retexts: [], shown: [] };
const ask = (opts, signal) => new Promise((resolve) => {
  const b = { opts, open: true, takenDown: false, resolve: (a) => { b.open = false; resolve(a); } };
  overlay.bubbles.push(b);
  signal?.addEventListener('abort', () => { if (b.open) { b.takenDown = true; b.resolve(null); } }, { once: true });
});
const bubble = () => overlay.bubbles.at(-1);
const click = (first) => bubble().resolve(first ? 'yes' : null);
// speak: the line is "playing" until the test says the overlay reported its end
const speak = (text) => new Promise((resolve) => { if (text) overlay.said.push(text); overlay.speaking.push(resolve); });
const played = async () => { for (const done of overlay.speaking.splice(0)) done(); await tick(); };
const mic = { listens: [], cancels: [], windows: [] };
const logs = [], hooks = [], told = [], enqueued = [], keptBlocks = [];
let busy = false;
const flow = createFlow({
  home, speak, timers, now: () => t,
  announce: (text) => { overlay.shown.push(text); return speak(text); },
  listen: (o) => mic.listens.push({ ...o, at: t }), cancel: () => mic.cancels.push(t),
  bubbles: () => [pi, answers],
  idle: () => !busy && !pi.bubble() && !answers.open(),
  onWindow: (open, by) => mic.windows.push([open, by]),
  onPending: (event, q) => hooks.push([event, q.kind]),
  actions: () => keptBlocks,
  log: (k, d) => logs.push([k, d]),
});
const answers = createAnswers({ ask, log: (k, d) => logs.push([k, d]), question: (q) => flow.question(q), retext: (text) => overlay.retexts.push(text) });
const pi = createPi({ home, userName: 'Tiago', shell: '/bin/sh', ask, askYesNo: (o, s) => answers.ask(o, s), question: (q) => flow.question(q), retext: (text) => overlay.retexts.push(text), tell: (shown, v) => told.push({ shown, v }), log: (k, d) => logs.push([k, d]) });
for (const [kind, run] of Object.entries(pi.resume)) flow.resume(kind, run);
const tool = (n) => pi.tools.find((x) => x.name === n);
const settled = (p) => p.then((value) => ({ value }), (error) => ({ error }));
const piDone = () => until(() => !pi.busy(), 'pi finished');

// What sidekick.mjs's onSpoken does with words, in the same order. Only 'request' reaches the model.
function spoken(text, window = null) {
  if (window != null) { if (flow.windowPhrase(text, window) !== 'request') return 'heard'; }
  else if (!pi.bubble() && !answers.open() && flow.closing(text)) return 'heard';
  if (pi.heard(text) || answers.heard(text)) return 'heard';
  flow.start(); enqueued.push(text);
  return 'request';
}
// The voice helper: a phrase heard in the open answer window, and a phrase said after a key press.
async function inWindow(text) { const id = flow.window().id; flow.voice('processing', id); const r = spoken(text, id); flow.voice('idle', id); await tick(); return r; }
async function byKey(text) { flow.voice('listening', null); if (!pi.listening()) answers.listening(); flow.voice('processing', null); const r = spoken(text); flow.voice('idle', null); await tick(); return r; }
// A request made by voice and its reply, said and finished: the exchange is open and quiet.
async function exchange(text = 'what is on today') { busy = true; flow.voice('listening', null); assert.equal(spoken(text), 'request'); flow.activity(); busy = false; const done = speak('reply'); flow.settle(done); await played(); }
// The exchange that is open ends: what was said has finished playing, and the quiet time passes.
const quiet = async () => { await played(); await advance(20_000); await tick(); };
const reset = async () => { await played(); await advance(3_600_000); fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ ...readState(dir), pending: [] })); mic.listens.length = 0; mic.cancels.length = 0; mic.windows.length = 0; overlay.said.length = 0; overlay.retexts.length = 0; overlay.shown.length = 0; logs.length = 0; hooks.length = 0; enqueued.length = 0; told.length = 0; };
const pendingNow = () => readState(dir).pending ?? [];

// ================= rule 5: the settings and the word lists are in the reference
{
  const d = settingsDefaults(home), ref = codeReference();
  assert.deepEqual([d.limits.answerWindowSeconds, d.limits.exchangeEndSeconds, d.limits.pendingKeepHours, d.autoListenQuestions, d.closingReply], [10, 20, 24, true, 'Any time.']);
  assert.deepEqual([LIMITS.answerWindowSeconds.min, LIMITS.answerWindowSeconds.max], [3, 30]);
  assert.ok(d.limits.spokenQuestionChars > 0 && d.limits.heardLineChars > 0);
  assert.deepEqual(ref.fillerWords, ['and', 'um', 'uh', 'now', 'so', 'well', 'just', 'please', 'then', 'sir', 'jarvis', 'roamies']); assert.deepEqual(ref.fillerWords, FILLER_WORDS);
  assert.deepEqual(ref.closingPhrases, ['thanks', 'thank you', 'thanks mate', "that's all"]); assert.deepEqual(ref.closingPhrases, CLOSING_PHRASES);
  assert.deepEqual(ref.handsFreeSendWords.edit, ['send', 'send it']); assert.deepEqual(ref.handsFreeSendWords.edit, HANDS_FREE_SEND);
  assert.equal(ref.answerWindow.judgedAfterTheEndSeconds, WINDOW.graceSeconds); assert.equal(ref.pendingQuestions.keptIn, 'state.json');
  assert.deepEqual(ref.limitRanges.answerWindowSeconds, { min: 3, max: 30 });
  // out of range: the default is used, and the setting is named at start-up
  for (const bad of [2, 31, '10']) { writeSettings({ limits: { answerWindowSeconds: bad } }); const s = loadSettings(home); assert.equal(s.limits.answerWindowSeconds, 10); assert.ok(s.invalid.some((i) => i.name === 'limits.answerWindowSeconds')); }
  writeSettings({ limits: { answerWindowSeconds: 3 }, autoListenQuestions: 'no', closingReply: '  ' });
  const s = loadSettings(home);
  assert.equal(s.limits.answerWindowSeconds, 3); assert.equal(s.autoListenQuestions, true); assert.equal(s.closingReply, 'Any time.');
  assert.deepEqual(s.invalid.map((i) => i.name).sort(), ['autoListenQuestions', 'closingReply']);
  writeSettings();
}

// ================= the words
{
  // hands-free, a hand-off that can edit: "send" or "send it", alone, "please" allowed; nothing else
  for (const w of ['send', 'Send.', 'send it', 'Send it!', 'please send', 'send it please', 'Send it, please.']) assert.ok(isHandsFreeSend(w), w);
  for (const w of ['ok', 'yes', 'okay', 'go ahead', 'do it', 'send now', 'ok send it', 'yes send', 'send send', 'um send', 'and send it', 'send it now', 'jarvis send it', 'sent', 'send it later', '', null]) assert.ok(!isHandsFreeSend(w), `"${w}"`);
  // filler words: only at the start and the end
  assert.equal(unfilled('Um, and now send it, please.'), 'send it'); assert.equal(unfilled('Well, yes then, sir.'), 'yes'); assert.equal(unfilled('Jarvis, no.'), 'no');
  assert.equal(unfilled('yes and no'), 'yes and no'); assert.equal(unfilled('send it and then stop'), 'send it and then stop'); assert.equal(unfilled('please'), ''); assert.equal(unfilled('um, so, well'), '');
  // closing phrases: alone (filler words around them don't count)
  for (const w of ['thanks', 'Thanks.', 'Thank you!', 'thanks mate', "That's all.", 'Thanks, Jarvis.', 'thank you, that’s all', 'so, thanks']) assert.ok(isClosing(w), w);
  for (const w of ['thanks for that, now open Zotero', 'thank you for the note', 'no thanks', 'that is all I need from pi', 'thanks but', '', 'please']) assert.ok(!isClosing(w), w);
  assert.equal(heardLine('And send it.', 'send or no'), 'Heard "And send it.". Say send or no.');
  assert.equal(heardLine('x'.repeat(200), 'yes or no', 20).length, 'Heard "". Say yes or no.'.length + 20);
  assert.equal(briefly('Count the functions in segment.py', 200), 'Count the functions in segment.py');
  assert.equal(briefly('Fix the bug in a.py. Then run the tests, and tell me which ones fail and why.', 200), 'Fix the bug in a.py. The rest is on screen.');
  assert.ok(briefly('word '.repeat(200), 60).length < 90);
}

// ================= rule 1: a question is said, briefly, in an exchange started by voice; silent outside one
{
  // not in an exchange (a typed request, a sync): a yes/no bubble opens, nothing is said, the microphone stays closed
  const p = settled(answers.ask({ placeholder: 'Sort these to-dos like this?\nUrgent: a; b', choices: ['Sort them', "Don't"] }));
  await tick(); await played(); await advance(60_000);
  assert.deepEqual(overlay.said, []); assert.deepEqual(mic.listens, []); assert.equal(bubble().open, true, 'and it waits, however long');
  click(true); assert.equal((await p).value, 'yes');
  await reset();

  // in an exchange started by voice: the question is said (its first line, not the whole bubble)
  await exchange();
  const q = settled(answers.ask({ placeholder: 'Sort these to-dos like this?\nUrgent: a; b', choices: ['Sort them', "Don't"] }));
  await tick();
  assert.deepEqual(overlay.said, ['reply', 'Sort these to-dos like this?']);
  click(false); await q; await reset();

  // a hand-off: what it is and the prompt's first sentence, never the whole prompt; the bubble has all of it
  await exchange();
  const long = `Rename the helper in util.py. ${'Then check every caller and update the tests. '.repeat(20)}`;
  const h = settled(tool('ask_pi').execute({ prompt: long, mode: 'edit' }, {}));
  await until(() => pi.bubble(), 'the Send bubble');
  assert.equal(overlay.said.at(-1), 'For pi, with editing allowed. Rename the helper in util.py. The rest is on screen. Say send to send it.');
  assert.ok(bubble().opts.placeholder.includes(long.trim().slice(0, 300)));
  click(false); await h; await reset();
}
{ // rule 1: talking to an open bubble silences what is playing but doesn't end the reply's voice (the cause of the
  // silent replies): hush() against stop(). What the reply says afterwards still comes out.
  const out = [];
  class V { constructor(o) { this.o = o; this.cuts = 0; } open() { return this; } say(s) { this.o.onAudio(new Uint8Array([s.length, 0])); } end() { this.o.onEnd(); } abort() {} mark(fn) { fn(); } cut() { this.cuts++; } }
  const sp = createSpeaker({ emit: (m) => out.push(m), FishVoiceImpl: V });
  sp.setKey('local');
  let r = sp.start(); r.say('For pi. Say send.');
  sp.hush();
  assert.deepEqual(out.at(-1), { kind: 'speech', stop: true }); assert.equal(r.done, false);
  out.length = 0; r.say('Pi is on it.');
  assert.equal(out.filter((m) => m.pcm).length, 1, 'after hush the reply still speaks');
  const name = r.mark(); assert.deepEqual(out.at(-1), { kind: 'speech', mark: name });
  sp.stop(); assert.equal(r.done, true); out.length = 0; r.say('lost');
  assert.equal(out.filter((m) => m.pcm).length, 0, 'after stop it does not (as before)');
  assert.notEqual(sp.mark(), name, 'every mark has its own name');
  // the Mac voice: a mark is called after the audio before it; cut drops what was waiting and calls its marks
  const order = [];
  const lv = new LocalVoice({ onAudio: () => order.push('audio'), onEnd: () => order.push('end'), platform: 'darwin' });
  lv.synth = async (text) => { await new Promise((res) => setTimeout(res, 5)); return Buffer.alloc(4); };
  lv.say('one'); lv.mark(() => order.push('mark 1')); lv.say('two'); lv.say('three'); lv.mark(() => order.push('mark 2'));
  await until(() => order.includes('mark 1'), 'the first mark');
  assert.deepEqual(order, ['audio', 'mark 1']);
  lv.cut(); assert.deepEqual(order, ['audio', 'mark 1', 'mark 2'], 'cut: the waiting mark is answered at once');
  lv.say('four'); lv.end();
  await until(() => order.includes('end'), 'the end');
  assert.deepEqual(order, ['audio', 'mark 1', 'mark 2', 'audio', 'end'], 'what was cut is never said; what comes after is');
  const side = fs.readFileSync(new URL('../sidekick.mjs', import.meta.url), 'utf8');
  assert.match(side, /if \(problem\) return aloud\(problem, 'concerned'\)/); assert.match(side, /if \(flow\.spoken\(\)\) voice\?\.say\(forVoice\(msg\)\)/, 'a failed request is said as well as shown');
  assert.match(side, /const aloud = \(text, mood\) => \{ say\(text, mood\); if \(flow\.spoken\(\)\) voiceLine\(forVoice\(text\)\); \};/);
  assert.match(side, /say\(lines\.join\('\\n'\), 'concerned'\); if \(flow\.spoken\(\)\) await lineDone\(/, 'what a sync has to say is said too, inside an exchange');
}

// ================= rule 2: the answer window
{ // it opens only when the overlay has reported the end of speech, with the usual listening (the helper's), for the set time
  await exchange();
  const p = settled(answers.ask({ placeholder: 'Put it there anyway?', choices: ['Put it there', "Don't"], pending: { kind: 'test', brief: 'Put it there anyway?', data: { n: 1 } } }));
  await tick();
  assert.equal(overlay.said.at(-1), 'Put it there anyway?');
  await advance(120_000);
  assert.deepEqual(mic.listens, [], 'still speaking, as far as the overlay has said: the microphone stays closed, however long it takes');
  assert.equal(flow.window(), null);
  await played();
  assert.equal(mic.listens.length, 1); assert.deepEqual({ ...mic.listens[0], at: 0 }, { seconds: 10, window: flow.window().id, again: false, at: 0 });
  assert.deepEqual(mic.windows, [[true, 'open']], 'and from now on nothing is played (sidekick.mjs holds speech)');
  // only answers count: anything else is dropped, logged by its shape, and the window stays open
  await advance(2000);
  assert.equal(await inWindow('Hang on, what was the second one again?'), 'heard');
  assert.deepEqual(enqueued.slice(1), [], 'not a request: it never reaches the model');
  assert.equal(bubble().open, true); assert.notEqual(flow.window(), null);
  const heard = logs.filter(([k]) => k === 'bubble_heard').at(-1)[1];
  assert.deepEqual(heard, { taken: false, chars: 39, words: 8, yesWord: false, noWord: false, handsFree: true });
  assert.ok(!JSON.stringify(logs).includes('second one'), 'the words are in no log');
  // ...the microphone opens again for what is left of the window, without a second sound
  assert.equal(mic.listens.length, 2); assert.deepEqual([mic.listens[1].seconds, mic.listens[1].again, mic.listens[1].window], [8, true, mic.listens[0].window]);
  // hands-free, filler words don't make an answer; the plain word does
  assert.equal(await inWindow('well, yes'), 'heard'); assert.equal(bubble().open, true);
  await advance(1000);
  assert.equal(await inWindow('Yes.'), 'heard');
  assert.equal((await p).value, 'yes'); assert.equal(flow.window(), null);
  assert.deepEqual(mic.windows.at(-1), [false, 'answered']);
  assert.deepEqual(pendingNow(), [], 'answered: nothing is kept');
  await reset();
}
{ // the setting is the window's length
  writeSettings({ limits: { answerWindowSeconds: 4 } });
  await exchange();
  const p = settled(answers.ask({ placeholder: 'Q?', choices: ['Yes', 'No'] }));
  await tick(); await played();
  assert.equal(mic.listens[0].seconds, 4);
  await advance(3999); assert.notEqual(flow.window(), null);
  await advance(1); assert.equal(flow.window(), null); assert.deepEqual(mic.cancels, [mic.listens[0].at + 4000]);
  assert.ok((await p).error instanceof Unanswered);
  writeSettings(); await reset();
}
{ // a key press works at any time and takes the window over: the microphone is not closed under it, the window's
  // timer is gone, and what is said then is judged the wider way (filler words allowed)
  await exchange();
  const p = settled(answers.ask({ placeholder: 'Q?', choices: ['Yes', 'No'], pending: { kind: 'test', brief: 'Q?', data: {} } }));
  await tick(); await played();
  assert.equal(await byKey('Um, well, yes please, Jarvis.'), 'heard');
  assert.equal((await p).value, 'yes'); assert.deepEqual(mic.cancels, [], 'no cancel was sent under the key press');
  assert.ok(mic.windows.some(([open, by]) => !open && by === 'key'));
  await advance(60_000); assert.deepEqual(pendingNow(), []);
  await reset();
  // ...and a click always works, and closes the microphone
  await exchange();
  const c = settled(answers.ask({ placeholder: 'Q?', choices: ['Yes', 'No'] }));
  await tick(); await played(); await advance(1500);
  click(false); assert.equal((await c).value, null);
  assert.equal(flow.window(), null); assert.deepEqual(mic.cancels, [t]);
  await reset();
}
{ // the microphone is closed at the window's end: the cancel goes out at exactly that time, and a phrase that arrives
  // for a window that is over is discarded
  await exchange();
  const p = settled(answers.ask({ placeholder: 'Q?', choices: ['Yes', 'No'], pending: { kind: 'test', brief: 'Q?', data: {} } }));
  await tick(); await played();
  const opened = t, id = flow.window().id;
  await advance(9999); assert.deepEqual(mic.cancels, []);
  await advance(1);
  assert.deepEqual(mic.cancels, [opened + 10_000], 'closed on time');
  assert.equal(flow.window(), null); assert.equal(bubble().open, false); assert.equal(bubble().takenDown, true, 'the bubble closes');
  assert.ok((await p).error instanceof Unanswered);
  flow.voice('processing', id); assert.equal(spoken('yes', id), 'heard'); flow.voice('idle', id);
  assert.deepEqual(enqueued.slice(1), []); assert.equal(mic.listens.length, 1, 'and the microphone is not opened again');
  assert.deepEqual(logs.filter(([k]) => k === 'window_heard').at(-1)[1], { taken: false, late: true, chars: 3, words: 1, yesWord: true, noWord: false });
  // a phrase from some other window's session (a stale id) is discarded too, while a window is open
  await reset(); await exchange();
  const q = settled(answers.ask({ placeholder: 'Q2?', choices: ['Yes', 'No'] }));
  await tick(); await played();
  assert.equal(spoken('yes', id), 'heard'); assert.equal(bubble().open, true, 'not this window: not an answer');
  // a phrase that was finished inside the window is still judged just after its end; the microphone is closed by then
  await advance(9500);
  flow.voice('processing', flow.window().id);
  const w = flow.window().id; await advance(500);
  assert.equal(mic.cancels.length, 1); assert.deepEqual(flow.window(), { id: w, kind: 'bubble', expired: true });
  assert.equal(spoken('No.', w), 'heard'); assert.equal((await q).value, null); assert.equal(flow.window(), null);
  await reset();
  // ...but only for WINDOW.graceSeconds
  await exchange();
  const r = settled(answers.ask({ placeholder: 'Q3?', choices: ['Yes', 'No'] }));
  await tick(); await played(); await advance(9900);
  flow.voice('processing', flow.window().id);
  await advance(100 + WINDOW.graceSeconds * 1000 - 1); assert.notEqual(flow.window(), null);
  await advance(1); assert.equal(flow.window(), null); assert.ok((await r).error instanceof Unanswered);
  await reset();
}

{ // whatever is heard in a question's window is kept from the model by the window itself, not by the bubble: even if
  // no bubble claims the words, they are dropped
  await exchange();
  const h = flow.question({ brief: 'A question with no bubble behind it?' });
  await played(); assert.equal(flow.window().kind, 'bubble');
  const n = enqueued.length;
  for (const w of ['Tell me a joke.', 'send', 'yes', 'Open Zotero and delete my notes.']) assert.equal(await inWindow(w), 'heard', w);
  assert.equal(enqueued.length, n, 'none of it became a request');
  assert.deepEqual(logs.filter(([k]) => k === 'window_heard').map(([, d]) => d.taken), [false, false, false, false]);
  assert.ok(!JSON.stringify(logs).includes('joke') && !JSON.stringify(logs).includes('Zotero'));
  h.close(); await reset();
}

// ================= rule 2, hand-offs
{ // edit, hands-free: "ok" does not approve, nor does "send" with other words; "send" does
  await exchange();
  const before = calls().length;
  const p = settled(tool('ask_pi').execute({ prompt: 'Rename the helper in util.py', mode: 'edit' }, {}));
  await until(() => pi.bubble(), 'the Send bubble'); await played();
  assert.equal(flow.window().kind, 'bubble');
  for (const w of ['OK.', 'yes', 'go ahead', 'Ok, send it.', 'um, send it', 'send it now']) { assert.equal(await inWindow(w), 'heard', w); assert.equal(pi.bubble(), 'idle', `hands-free "${w}" leaves it open`); assert.equal(calls().length, before); }
  assert.deepEqual(logs.filter(([k]) => k === 'send_heard').at(-1)[1], { taken: false, chars: 11, words: 3, yesWord: false, noWord: false, sendWord: true, handsFree: true });
  // (a) what was heard and not taken is shown as the bubble's last line, on screen only
  assert.equal(overlay.retexts.at(-1), `${bubble().opts.placeholder}\nHeard "send it now". Say send or no.`);
  assert.ok(!JSON.stringify(logs).includes('send it now') && !JSON.stringify(logs).includes('go ahead'), 'never logged');
  assert.ok(!JSON.stringify(readState(dir)).includes('send it now'), 'never kept');
  assert.equal(await inWindow('Send it, please.'), 'heard');
  assert.match((await p).value, /^Sent to pi \(editing allowed/);
  await piDone(); assert.equal(calls().length, before + 1); assert.deepEqual(enqueued.slice(1), []);
  await reset();
}
{ // fault (a): an unclear phrase, then "send", in one window, with no key press
  await exchange();
  const before = calls().length;
  const p = settled(tool('ask_pi').execute({ prompt: 'Add a docstring to main()', mode: 'edit' }, {}));
  await until(() => pi.bubble(), 'the Send bubble'); await played();
  await advance(1500); assert.equal(await inWindow('OK, wait.'), 'heard');
  assert.equal(pi.bubble(), 'idle'); assert.equal(overlay.retexts.at(-1).split('\n').at(-1), 'Heard "OK, wait.". Say send or no.');
  assert.equal(mic.listens.at(-1).again, true);
  await advance(2000); assert.equal(await inWindow('Send.'), 'heard');
  assert.match((await p).value, /^Sent to pi/); await piDone(); assert.equal(calls().length, before + 1);
  await reset();
}
{ // after a key press the wider send words work, and (b) filler words before or after them don't spoil the answer
  for (const w of ['OK.', 'And send it.', 'Um, now send it, please.', 'Jarvis, go ahead then.']) {
    await exchange();
    const before = calls().length;
    const p = settled(tool('ask_pi').execute({ prompt: `keyed: ${w}`, mode: 'edit' }, {}));
    await until(() => pi.bubble(), 'the Send bubble'); await played();
    assert.equal(await byKey(w), 'heard');
    assert.match((await p).value, /^Sent to pi \(editing allowed/, w); await piDone(); assert.equal(calls().length, before + 1, w);
    await reset();
  }
  // ...but not in the middle, and a filler word alone is no answer
  await exchange();
  const p = settled(tool('ask_pi').execute({ prompt: 'keyed, not an answer', mode: 'edit' }, {}));
  await until(() => pi.bubble(), 'the Send bubble'); await played();
  for (const w of ['send it and then stop', 'please', 'yes and no', 'ok wait']) { assert.equal(await byKey(w), 'heard'); assert.equal(pi.bubble(), 'idle', w); }
  assert.equal(await byKey('so, no'), 'heard'); assert.match((await p).error.message, /didn't say send/);
  await reset();
}
{ // read only, hands-free: the existing send words; and a countdown still sends itself when nothing is said
  await exchange();
  let before = calls().length;
  const p = settled(tool('ask_pi').execute({ prompt: 'Count the functions', mode: 'read' }, {}));
  await until(() => pi.bubble(), 'the Send bubble'); await played();
  assert.equal(await inWindow('well ok'), 'heard'); assert.equal(pi.bubble(), 'idle', 'hands-free: no filler words');
  assert.equal(await inWindow('OK.'), 'heard'); assert.match((await p).value, /^Sent to pi \(read only/); await piDone(); assert.equal(calls().length, before + 1);
  await reset();
  writeSettings({ autoSendReadOnly: 0.2 });
  await exchange(); before = calls().length;
  const a = settled(tool('ask_pi').execute({ prompt: 'auto, nothing said', mode: 'read' }, {}));
  await until(() => pi.bubble(), 'the countdown bubble');
  assert.equal(overlay.said.at(-1), 'Asking pi: auto, nothing said');
  await played(); assert.notEqual(flow.window(), null, 'the microphone opening by itself does not stop the countdown');
  assert.match((await a).value, /^Sent to pi/); await piDone(); assert.equal(calls().length, before + 1);
  assert.equal(flow.window(), null); assert.equal(mic.cancels.length, 1, 'sent: the window closes');
  await reset();
  // anything said stops it; then with no answer the window runs out and it is kept, not sent
  await exchange(); before = calls().length;
  const b = settled(tool('ask_pi').execute({ prompt: 'auto, then hmm', mode: 'read' }, {}));
  await until(() => pi.bubble(), 'the countdown bubble'); await played();
  assert.equal(await inWindow('Hmm.'), 'heard');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(pi.bubble(), 'idle', 'well past the countdown: not sent'); assert.equal(calls().length, before);
  await advance(10_000);
  assert.ok((await b).error instanceof Unanswered); assert.equal(calls().length, before);
  assert.deepEqual(pendingNow().map((q) => [q.kind, q.data.mode, q.data.prompt]), [['handoff', 'read', 'auto, then hmm']]);
  // not at the end of the exchange it went unanswered in: at the end of the next one. It has no countdown then: it is
  // never sent because it was pending
  await quiet(); assert.equal(pi.bubble(), null);
  await exchange('what else is there'); await advance(20_000);
  await until(() => pi.bubble(), 'asked again');
  assert.match(bubble().opts.placeholder, /^Send to pi\? {2}Read only/); assert.deepEqual(bubble().opts.choices, ['Send', "Don't send"]);
  await played(); await new Promise((r) => setTimeout(r, 400)); assert.equal(calls().length, before, 'no countdown');
  click(false); await until(() => !pi.bubble(), 'closed'); await tick();
  assert.deepEqual(pendingNow(), []); assert.equal(calls().length, before);
  writeSettings(); await reset();
}

// ================= rules 3 and 4: no answer, pending, and coming back
{
  const settingsBefore = fs.readFileSync(settingsFile, 'utf8');
  await exchange();
  const before = calls().length, prompt = `Rewrite the README. ${'Keep every heading and example as it is. '.repeat(12)}`.trim();
  const p = settled(tool('ask_pi').execute({ prompt, mode: 'edit' }, {}));
  await until(() => pi.bubble(), 'the Send bubble'); await played();
  const first = bubble();
  await advance(10_000);
  // rule 3: the bubble closes, the question is pending in state.json, nothing is sent or changed
  const r = await p;
  assert.ok(r.error instanceof Unanswered); assert.match(r.error.message, /nothing went to pi.*kept the question.*don't ask it again/s);
  assert.equal(first.open, false); assert.equal(first.takenDown, true); assert.equal(pi.bubble(), null);
  assert.equal(calls().length, before); assert.ok(!pi.busy());
  const kept = pendingNow();
  assert.equal(kept.length, 1); assert.deepEqual([kept[0].kind, kept[0].data.mode, kept[0].data.prompt, kept[0].data.project], ['handoff', 'edit', prompt, work]);
  assert.equal(kept[0].at, new Date(t).toISOString()); assert.match(kept[0].brief, /^For pi, with editing allowed: Rewrite the README\./);
  assert.deepEqual(hooks, [['pending', 'handoff']], 'the daily note\'s hook: it became pending');
  assert.equal(fs.readFileSync(settingsFile, 'utf8'), settingsBefore, 'settings.json is untouched');
  assert.ok(!fs.existsSync(path.join(home, 'Documents', 'roamies-vault')), 'nothing is written to the notes vault');
  // show_pending reads the list out; the morning briefing mentions it
  assert.match(await flow.tools.find((x) => x.name === 'show_pending').execute({}), /^1 question is waiting for an answer, oldest first:\n- For pi, with editing allowed: Rewrite the README\. .*\(asked \d\d:\d\d\)$/);
  assert.match(flow.note(), /still waiting for their answer.*\n- For pi, with editing allowed: Rewrite the README\./s);
  assert.ok(codeReference().tools.allowedWhilePiWorks.includes('show_pending'));

  // rule 4: it does not come back in the exchange it went unanswered in, not even when that one ends...
  await quiet(); await advance(300_000);
  assert.equal(pi.bubble(), null); assert.equal(pendingNow().length, 1);
  // ...nor while the next exchange goes on...
  await exchange('and what about tomorrow'); await advance(19_999);
  assert.equal(pi.bubble(), null);
  // ...but when it ends: a quiet time after the last reply has finished playing
  await advance(1);
  await until(() => pi.bubble(), 'asked again');
  assert.ok(logs.some(([k, d]) => k === 'exchange_end' && d.by === 'quiet'));
  // asked again in full: a new Send bubble with the whole prompt, said, with its window, and no countdown
  assert.notEqual(bubble(), first); assert.ok(bubble().opts.placeholder.includes(prompt.slice(0, 400))); assert.match(bubble().opts.placeholder, /^Send to pi\? {2}CAN EDIT/);
  assert.match(overlay.said.at(-1), /^For pi, with editing allowed\. Rewrite the README\. The rest is on screen\. Say send to send it\.$/);
  assert.deepEqual(pendingNow().map((q) => q.id), [kept[0].id], 'it stays kept while it is asked, once');
  await played(); assert.equal(flow.window().kind, 'bubble');
  // never sent because it was pending: unanswered again, it is kept again, with its first age
  await advance(10_000); await until(() => !pi.bubble(), 'closed again'); await tick();
  assert.equal(calls().length, before);
  assert.deepEqual(pendingNow().map((q) => [q.id, q.at]), [[kept[0].id, kept[0].at]], 'kept again, as old as it was');
  assert.deepEqual(hooks, [['pending', 'handoff']], 'no second "became pending"');
  // one at a time, and only at the end of an exchange: nothing happens by itself meanwhile
  await advance(300_000); assert.equal(pi.bubble(), null);
  // the next exchange ends on a closing phrase: handled here, with the acknowledgement from the setting (c)
  writeSettings({ closingReply: 'At your service.' });
  await exchange('one more thing');
  const n = enqueued.length;
  assert.equal(await byKey('Thanks, Jarvis.'), 'heard');
  assert.equal(enqueued.length, n, 'a closing phrase is not sent to the model');
  assert.deepEqual(overlay.shown.at(-1), 'At your service.'); assert.equal(overlay.said.at(-1), 'At your service.');
  assert.ok(logs.some(([k, d]) => k === 'exchange_end' && d.by === 'phrase'));
  assert.equal(pi.bubble(), null, 'the question waits until the acknowledgement has been said');
  await played();
  await until(() => pi.bubble(), 'asked again after the closing phrase'); await played();
  // "ok" hands-free still does not send it; "send" does, and only then does pi start
  assert.equal(await inWindow('ok'), 'heard'); assert.equal(calls().length, before);
  assert.equal(await inWindow('send'), 'heard');
  await until(() => calls().length === before + 1, 'sent on send'); await piDone(); await tick();
  assert.deepEqual(calls().at(-1).args.at(-1), prompt); assert.deepEqual(pendingNow(), []);
  assert.deepEqual(hooks, [['pending', 'handoff'], ['answered', 'handoff']]);
  assert.ok(told.some((x) => x.shown === 'Sent to pi.'));
  writeSettings(); await reset();
}
{ // a closing phrase is one only when said alone, and only when no question is open
  await exchange();
  assert.equal(await byKey('Thanks for that, now open Zotero.'), 'request', 'more than a closing phrase: a request');
  flow.activity(); const done = speak('ok'); flow.settle(done); await played();
  const p = settled(answers.ask({ placeholder: 'Q?', choices: ['Yes', 'No'] }));
  await tick(); await played();
  assert.equal(await byKey('thanks'), 'heard'); assert.equal(bubble().open, true, 'said to an open question it is just not an answer');
  assert.equal(overlay.shown.length, 0);
  click(true); await p; await reset();
}
{ // the oldest first, one per exchange; one that no longer applies is dropped with one line; an old one is dropped
  const asked = [];
  flow.resume('test', async (q) => { asked.push(q.data.n); if (q.data.stale) return { dropped: `Question ${q.data.n} no longer applies, so I dropped it.` }; return { ask: async () => { const yes = await answers.ask({ placeholder: `Question ${q.data.n}?`, choices: ['Yes', 'No'], pending: q }); return { say: yes ? `Did ${q.data.n}.` : '' }; } }; });
  await exchange();
  for (const [n, stale] of [[1, false], [2, true], [3, false]]) {
    const p = settled(answers.ask({ placeholder: `Question ${n}?`, choices: ['Yes', 'No'], pending: { kind: 'test', brief: `Question ${n}?`, data: { n, stale } } }));
    await tick(); await played(); await advance(10_000);
    assert.ok((await p).error instanceof Unanswered);
    await advance(1000);
  }
  await quiet(); await advance(300_000);
  assert.deepEqual(pendingNow().map((q) => q.data.n), [1, 2, 3]); assert.deepEqual(asked, [], 'none of them at the end of the exchange they went unanswered in');
  hooks.length = 0; overlay.shown.length = 0;
  // the first exchange to end: question 1 only, said, with its window; a spoken yes answers it
  await exchange(); await advance(20_000); await tick();
  assert.deepEqual(asked, [1]); assert.equal(overlay.said.at(-1), 'Question 1?');
  await played(); assert.equal(await inWindow('yes'), 'heard'); await tick();
  assert.deepEqual(overlay.shown, ['Did 1.']); await played();
  await advance(300_000); assert.deepEqual(asked, [1], 'the next one waits for the next exchange to end');
  // the second: question 2 no longer applies: dropped, and said in one line
  await exchange(); await advance(20_000); await tick();
  assert.deepEqual(asked, [1, 2]); assert.deepEqual(overlay.shown.at(-1), 'Question 2 no longer applies, so I dropped it.'); assert.equal(answers.open(), false);
  await played();
  assert.deepEqual(pendingNow().map((q) => q.data.n), [3]);
  assert.deepEqual(hooks, [['answered', 'test'], ['dropped', 'test']]);
  // question 3 is now older than pendingKeepHours: dropped without being asked
  await advance(24 * 3_600_000);
  assert.match(flow.note(), /^$/); assert.deepEqual(pendingNow(), []);
  assert.deepEqual(hooks.at(-1), ['dropped', 'test']); assert.ok(logs.some(([k, d]) => k === 'pending_dropped' && d.why === 'old'));
  await exchange(); await advance(20_000); await tick(); assert.deepEqual(asked, [1, 2]);
  assert.equal(await flow.tools[0].execute({}), 'No question is waiting for an answer.');
  // a shorter keeping time is the setting's
  await exchange();
  const p = settled(answers.ask({ placeholder: 'Question 4?', choices: ['Yes', 'No'], pending: { kind: 'test', brief: 'Question 4?', data: { n: 4 } } }));
  await tick(); await played(); await advance(10_000); await p; await quiet();
  writeSettings({ limits: { pendingKeepHours: 2 } });
  await advance(2 * 3_600_000 - 20_000); assert.equal(flow.pending().length, 1); await advance(20_001); assert.equal(flow.pending().length, 0);
  writeSettings(); await reset();
}
{ // the folder question: said, answered by a spoken yes, kept when unanswered, and dropped when it no longer applies
  const cells = path.join(home, 'Documents', 'cells'); fs.mkdirSync(cells);
  writeSettings({ projects: ['~/Documents/roamies-pi/workspace', '~/Documents/cells'] });
  await exchange();
  const p = settled(tool('switch_project').execute({ name: 'cells' }, {}));
  await until(() => answers.open(), 'the folder question');
  assert.equal(overlay.said.at(-1), 'Have pi work in cells (~/Documents/cells) from now on?');
  await played(); await advance(10_000);
  assert.ok((await p).error instanceof Unanswered); assert.equal(loadSettings(home).project, work);
  assert.deepEqual(pendingNow().map((q) => [q.kind, q.data]), [['project', { name: 'cells' }]]);
  await quiet(); await exchange(); await advance(20_000);
  await until(() => answers.open(), 'asked again'); await played();
  assert.equal(await inWindow('Yes, please.'), 'heard');
  await until(() => loadSettings(home).project === cells, 'switched on the yes');
  assert.deepEqual(pendingNow(), []);
  // back, unanswered again, and then the project is taken off the list: one line, no question
  await played(); await reset(); await exchange();
  const q = settled(tool('switch_project').execute({ name: 'workspace' }, {}));
  await until(() => answers.open(), 'the folder question'); await played(); await advance(10_000); await q; await quiet();
  writeSettings({ project: '~/Documents/cells', projects: ['~/Documents/cells'] });
  overlay.shown.length = 0;
  await exchange(); await advance(20_000); await tick(); await tick();
  assert.equal(answers.open(), false); assert.match(overlay.shown.at(-1), /^You hadn't answered whether pi should work in workspace\. That project can no longer be used, so pi stays where it is\.$/);
  assert.deepEqual(pendingNow(), []);
  writeSettings(); await played(); await reset();
}

// ================= fault 1 (found on 4916c04): a question is pending once; an answer clears every copy without a
// word; one whose thing was done is dropped without a word; only what is lost is said
{
  // what makes two questions the same, for each kind
  const K = (kind, data) => sameKey({ kind, data });
  assert.equal(K('sort', { proposals: [{ todo: 'a' }] }), K('sort', { proposals: [{ todo: 'b' }, { todo: 'c' }] }), 'sort: there is one');
  assert.equal(K('start', {}), K('start', { x: 1 }));
  assert.equal(K('overlap', { todo: 'a', start: 1 }), K('overlap', { todo: 'a', start: 2 }), 'overlap: the same to-do'); assert.notEqual(K('overlap', { todo: 'a' }), K('overlap', { todo: 'b' }));
  assert.equal(K('deleted', { todo: 'a', title: 'x' }), K('deleted', { todo: 'a', title: 'y' })); assert.notEqual(K('deleted', { todo: 'a' }), K('deleted', { todo: 'b' }));
  assert.equal(K('plan', { date: '2026-11-20', placed: [1] }), K('plan', { date: '2026-11-20', placed: [2] })); assert.notEqual(K('plan', { date: '2026-11-20' }), K('plan', { date: '2026-11-21' }));
  assert.equal(K('project', { name: 'Cells' }), K('project', { name: 'cells' })); assert.notEqual(K('project', { name: 'cells' }), K('project', { name: 'notes' }));
  assert.equal(K('handoff', { project: '/p', mode: 'edit', prompt: 'Do it. ', followUp: true }), K('handoff', { project: '/p', mode: 'edit', prompt: 'Do it.' }));
  for (const other of [{ project: '/q', mode: 'edit', prompt: 'Do it.' }, { project: '/p', mode: 'read', prompt: 'Do it.' }, { project: '/p', mode: 'edit', prompt: 'Do that.' }]) assert.notEqual(K('handoff', other), K('handoff', { project: '/p', mode: 'edit', prompt: 'Do it.' }));
  assert.notEqual(K('sort', {}), K('start', {})); assert.notEqual(K('other', { n: 1 }), K('other', { n: 2 })); assert.equal(K('other', { n: 1 }), K('other', { n: 1 }));
  assert.deepEqual(Object.keys(SAME).sort(), [...codeReference().pendingQuestions.kinds].sort(), 'every kind of question says what makes it the same');
  assert.deepEqual(Object.keys(codeReference().pendingQuestions.sameQuestion).sort(), Object.keys(SAME).sort(), 'and settings.default.json says it in words');

  // what happened on 18 November, replayed: "sort my tasks" unanswered four times, then asked again and answered yes
  const sorted = { yes: false }, asked = [];
  const proposal = { proposals: [{ todo: 'c1', urgent: true, important: true }] };
  const askSort = (kept = null) => answers.ask({ placeholder: 'Sort these to-dos like this?', choices: ['Sort them', 'Don\'t'], pending: { ...(kept ? { id: kept.id, at: kept.at } : {}), kind: 'sort', brief: 'Sort 1 to-do into the matrix as proposed?', data: proposal } });
  flow.resume('sort', async (q) => { asked.push(q.id); if (sorted.yes) return { done: true }; return { ask: async () => { if (await askSort(q)) sorted.yes = true; return { say: sorted.yes ? 'Sorted 1 to-do.' : '' }; } }; });
  hooks.length = 0; logs.length = 0;
  for (let i = 0; i < 4; i++) {
    await exchange('sort my tasks');
    const p = settled(askSort());
    await tick(); await played(); await advance(10_000);
    assert.ok((await p).error instanceof Unanswered);
    assert.equal(pendingNow().length, 1, `asked ${i + 1} time${i ? 's' : ''}, pending once`);
    assert.equal(pendingNow()[0].at, new Date(t).toISOString(), 'the newest takes the older one\'s place');
    await played(); await advance(5_000);
  }
  assert.deepEqual(logs.filter(([k]) => k === 'pending_kept').map(([, d]) => d.replaced), [0, 1, 1, 1]);
  assert.deepEqual(hooks.filter(([e]) => e === 'pending').length, 4);
  // the next exchange ends: asked again, a spoken yes sorts them, and every copy is gone
  await quiet(); overlay.shown.length = 0; overlay.said.length = 0;
  await exchange('how are you'); await advance(20_000);
  await until(() => answers.open(), 'asked again'); await played();
  assert.equal(await inWindow('yes'), 'heard'); await tick(); await played();
  assert.equal(sorted.yes, true); assert.deepEqual(pendingNow(), []); assert.deepEqual(overlay.shown, ['Sorted 1 to-do.']);
  // ...and at the end of the exchange after that, nothing is said about a dropped question (it was, on 18 November)
  overlay.shown.length = 0; overlay.said.length = 0; logs.length = 0;
  await exchange('book a slot on friday'); await advance(20_000); await tick(); await played();
  assert.deepEqual(overlay.shown, []); assert.deepEqual(overlay.said, ['reply']); assert.ok(!logs.some(([k]) => k === 'pending_dropped' || k === 'pending_raised'));
  await reset();

  // a state.json left by 4916c04 with the same question twice: one stays (the newest), and since the to-dos are
  // sorted it goes without a word, and the next question behind it is asked in the same breath
  const iso = (ms) => new Date(ms).toISOString();
  flow.resume('test', async (q) => ({ ask: async () => { const yes = await answers.ask({ placeholder: `Question ${q.data.n}?`, choices: ['Yes', 'No'], pending: q }); return { say: yes ? `Did ${q.data.n}.` : '' }; } }));
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ ...readState(dir), pending: [
    { id: 'qold1', at: iso(t - 3000), kind: 'sort', brief: 'Sort 5 to-dos into the matrix as proposed?', data: proposal },
    { id: 'qold2', at: iso(t - 2000), kind: 'sort', brief: 'Sort 5 to-dos into the matrix as proposed?', data: proposal },
    { id: 'qnext', at: iso(t - 1000), kind: 'test', brief: 'Question 7?', data: { n: 7 } },
  ] }));
  assert.deepEqual(flow.pending().map((q) => q.id), ['qold2', 'qnext']); assert.deepEqual(pendingNow().map((q) => q.id), ['qold2', 'qnext']);
  asked.length = 0; overlay.shown.length = 0; overlay.said.length = 0; logs.length = 0;
  await exchange(); await advance(20_000);
  await until(() => answers.open(), 'the next question'); 
  assert.deepEqual(asked, ['qold2']); assert.deepEqual(overlay.shown, [], 'not a word about the sorted one'); assert.equal(overlay.said.at(-1), 'Question 7?');
  assert.deepEqual(logs.filter(([k]) => k === 'pending_dropped').map(([, d]) => [d.kind, d.why]), [['sort', 'done']]);
  assert.deepEqual(pendingNow().map((q) => q.id), ['qnext']);
  // answered by a click this time: cleared, and said only what was done
  await played(); click(true); await tick(); await played();
  assert.deepEqual(pendingNow(), []); assert.deepEqual(overlay.shown, ['Did 7.']);
  await reset();

  // a later request that asks the same thing, answered there: the pending copy is cleared without a word, by a yes
  // and by a no alike, by voice and by click; a bubble taken down with its request (not an answer) leaves it
  sorted.yes = false;
  for (const [how, cleared] of [['voice-yes', true], ['voice-no', true], ['click-no', true], ['stopped', false]]) {
    await exchange('sort my tasks');
    let p = settled(askSort()); await tick(); await played(); await advance(10_000); await p;
    assert.equal(pendingNow().length, 1, how);
    overlay.shown.length = 0; logs.length = 0;
    const stop = new AbortController();
    p = settled(answers.ask({ placeholder: 'Sort these to-dos like this?', choices: ['Sort them', 'Don\'t'], pending: { kind: 'sort', brief: 'x', data: { proposals: [{ todo: 'c9', urgent: false, important: false }] } } }, stop.signal));
    await tick(); await played();
    if (how === 'voice-yes') await byKey('um, yes please'); else if (how === 'voice-no') await inWindow('no'); else if (how === 'click-no') click(false); else stop.abort();
    await p; await tick();
    assert.equal(pendingNow().length, cleared ? 0 : 1, how); assert.deepEqual(overlay.shown, [], `${how}: without a word`);
    assert.equal(logs.some(([k, d]) => k === 'pending_cleared' && d.kind === 'sort' && d.copies === 1), cleared, how);
    await reset();
  }

  // show_pending and the morning briefing's note don't list one whose thing was done
  sorted.yes = false;
  await exchange('sort my tasks');
  const p = settled(askSort()); await tick(); await played(); await advance(10_000); await p;
  assert.match(await flow.tools[0].execute({}), /^1 question is waiting/);
  sorted.yes = true;
  assert.equal(await flow.tools[0].execute({}), 'No question is waiting for an answer.'); assert.deepEqual(pendingNow(), []);
  await reset();
}

// ================= fault 2: what is kept until Super Productivity is open (calendar.mjs) is listed with the pending
// questions, as not done yet, and is never asked or run from here
{
  const show = () => flow.tools[0].execute({});
  keptBlocks.push({ at: new Date(2026, 10, 18, 22, 16).toISOString(), brief: 'Put "Flow test" on the calendar Thursday 19 November, 10:00 to 10:30' });
  assert.equal(await show(), '1 request is kept until Super Productivity is open. Not done yet: the app does it by itself then.\n- Put "Flow test" on the calendar Thursday 19 November, 10:00 to 10:30 (asked 22:16)');
  assert.match(flow.note(), /^\nKept until Super Productivity is open, and not on the calendar yet \(the app places them itself then; mention them in one sentence, and don't say they are booked\):\n- Put "Flow test" on the calendar Thursday 19 November, 10:00 to 10:30$/);
  await exchange();
  const p = settled(answers.ask({ placeholder: 'Question 8?', choices: ['Yes', 'No'], pending: { kind: 'other', brief: 'Question 8?', data: { n: 8 } } }));
  await tick(); await played(); await advance(10_000); await p;
  assert.match(await show(), /^1 question is waiting for an answer, oldest first:\n- Question 8\? \(asked \d\d:\d\d\)\n1 request is kept until Super Productivity is open\./);
  assert.match(flow.note(), /still waiting for their answer.*\n- Question 8\?\nKept until Super Productivity is open/s);
  // the exchanges end: nothing is raised for a kept block, and the list is untouched
  overlay.shown.length = 0; await quiet(); await exchange(); await advance(20_000); await tick(); await played();
  assert.equal(keptBlocks.length, 1); assert.equal(answers.open(), false);
  keptBlocks.length = 0;
  assert.equal(await show(), 'No question is waiting for an answer.');
  await reset();
}

// ================= Q2: the model's own question (Auto Listen), bounded by the same window
{
  await exchange('which file do you mean');
  busy = true; flow.activity(); busy = false;
  const done = speak('Which file do you mean?');
  flow.settle(done);
  assert.equal(flow.replyWindow(done), true);
  await advance(120_000);
  assert.deepEqual(mic.listens, [], 'it opens only when the overlay has reported the reply has finished playing');
  await played();
  assert.equal(mic.listens.length, 1); assert.deepEqual([mic.listens[0].seconds, mic.listens[0].again], [10, false]); assert.equal(flow.window().kind, 'reply');
  // what is said goes to the model as the answer, and the window is over
  const n = enqueued.length;
  assert.equal(await inWindow('The one in the cells folder.'), 'request');
  assert.deepEqual(enqueued.slice(n), ['The one in the cells folder.']); assert.equal(flow.window(), null);
  await reset();
  // nothing said: it closes on time, by the same stops, and nothing is kept
  await exchange();
  let d = speak('Shall I go on?'); flow.settle(d); flow.replyWindow(d); await played();
  const opened = t; await advance(10_000);
  assert.deepEqual(mic.cancels, [opened + 10_000]); assert.equal(flow.window(), null); assert.deepEqual(pendingNow(), []);
  const late = mic.listens[0].window;
  assert.equal(spoken('yes go on', late), 'heard'); assert.equal(enqueued.length, 1, 'a phrase after the end is discarded, not sent');
  await reset();
  // a closing phrase there is still handled here
  await exchange();
  d = speak('Anything else?'); flow.settle(d); flow.replyWindow(d); await played();
  assert.equal(await inWindow('Thanks.'), 'heard'); assert.equal(enqueued.length, 1); assert.equal(overlay.shown.at(-1), 'Any time.');
  await played(); await reset();
  // something else started before the reply finished playing: it does not open
  await exchange();
  d = speak('And then?'); flow.settle(d); flow.replyWindow(d);
  flow.voice('listening', null); await played();
  assert.deepEqual(mic.listens, []);
  await reset();
  // autoListenQuestions: false switches it off
  writeSettings({ autoListenQuestions: false });
  await exchange();
  d = speak('Which one?'); flow.settle(d);
  assert.equal(flow.replyWindow(d), false); await played(); await advance(5000);
  assert.deepEqual(mic.listens, []);
  writeSettings(); await reset();
  const side = fs.readFileSync(new URL('../sidekick.mjs', import.meta.url), 'utf8');
  assert.match(side, /autoListenOn\(\) && endsWithQuestion\(lastReply\) && flow\.replyWindow\(replyDone\)/);
  assert.match(side, /\{ type: 'done' \} \}\);/); assert.ok(!/type: 'done', \.\.\.\(listen/.test(side), 'the overlay\'s own timer is no longer asked to open the microphone');
  // Where the microphone is opened without the talk keys: flow.mjs's window; the area snap (the owner's own shortcut,
  // upstream's); and the old auto_listen message, which nothing sends any more (autoTurn is never set).
  assert.equal(side.match(/send\(\{ type: 'listen'/g).length, 3);
  assert.equal(side.match(/autoTurn = (?!null)/g), null, 'the old way in is closed');
}

// ================= the wiring that isn't run here
{
  const side = fs.readFileSync(new URL('../sidekick.mjs', import.meta.url), 'utf8');
  // words from an answer window are judged by flow.mjs before anything else, and only 'request' goes on
  assert.match(side, /async function onSpoken\(text, area, window = null\) \{\n(?:\s*\/\/[^\n]*\n)*\s*if \(window != null\) \{ if \(flow\.windowPhrase\(text, window\) !== 'request'\) \{ ui\(\{ kind: 'heard' \}\); return; \} \}\n(?:\s*\/\/[^\n]*\n)*\s*else if \(!pi\.bubble\(\) && !answers\.open\(\) && flow\.closing\(text\)\) \{ ui\(\{ kind: 'heard' \}\); return; \}\n\s*(?:\/\/[^\n]*\n\s*)*if \(pi\.heard\(text\) \|\| answers\.heard\(text\)\)/);
  assert.match(side, /onSpoken\(m\.text\.trim\(\), m\.area, m\.window \?\? null\)/);
  assert.match(side, /if \(m\.type === 'voice_state'\) flow\.voice\(voiceState, m\.window \?\? null\);/);
  assert.match(side, /m\.state === 'listening' && m\.window != null\) \{ \/\*/, 'the window\'s own listening interrupts nothing');
  // speech is held while the window is open, and the end of speech comes from the overlay
  assert.match(side, /if \(micWindow && !msg\.stop\) \{ heldSpeech\.push\(msg\); return; \}/);
  assert.match(side, /else if \(m\.type === 'speech_mark'\) \{ const done = played\.get\(m\.mark\); played\.delete\(m\.mark\); done\?\.\(\); \}/);
  assert.match(side, /speak: \(text\) => lineDone\(text\),/); assert.match(side, /const lineDone = \(text\) => whenPlayed\(\(text && voiceLine\(text, true\)\) \|\| speech\.mark\(\)\);/);
  assert.match(side, /cancel: \(\) => send\(\{ type: 'listen_cancel' \}\),/);
  assert.match(side, /if \(interrupt && byVoice\) flow\.start\(\);/);
  assert.match(side, /\$\{b\.kind === 'morning' \? flow\.note\(\) : ''\}/, 'the morning briefing mentions what is pending');
  assert.match(side, /\[\.\.\.notes\.tools, \.\.\.cal\.tools, \.\.\.flow\.tools\]/);
  const shell = fs.readFileSync(new URL('../../src-tauri/src/voice.rs', import.meta.url), 'utf8');
  assert.match(shell, /"type": "voice_state", "state": msg\.get\("state"\), "window": msg\.get\("window"\)/); assert.match(shell, /"via": msg\.get\("via"\), "window": msg\.get\("window"\)/);
  const helper = fs.readFileSync(new URL('../../src-tauri/voice/main.swift', import.meta.url), 'utf8');
  assert.match(helper, /if AnswerWindow\.over\(now: now, end: windowEnd\) \{ end\("answer window over"\); cancel\(\); return \}/, 'the helper closes the microphone at the window\'s end itself');
  assert.ok(!/AVAudioFile|\.write\(to:|createFile/.test(helper), 'the helper writes no audio to disk');
  assert.match(helper, /SpeechTranscriber\(locale: locale, preset: \.progressiveTranscription\)/); assert.match(helper, /if rec\.supportsOnDeviceRecognition \{ req\.requiresOnDeviceRecognition = true \}/);
}

// ================= the overlay's player: a mark is answered only when what was handed over has finished playing
{
  const sources = [], timeouts = [];
  class Ctx {
    constructor() { this.currentTime = 0; this.state = 'running'; this.destination = {}; this.outputLatency = 0.2; this.baseLatency = 0.01; }
    createGain() { return { gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} }; }
    createAnalyser() { return { fftSize: 0, connect() {}, getFloatTimeDomainData() {} }; }
    createBuffer(_c, n, rate) { return { duration: n / rate, getChannelData: () => ({ set() {} }) }; }
    createBufferSource() { const s = { listeners: [], connect() {}, start() {}, stop() { s.stopped = true; }, addEventListener(_e, fn) { s.listeners.push(fn); }, end() { s.onended?.(); for (const fn of s.listeners) fn(); } }; sources.push(s); return s; }
    resume() {}
  }
  const window = { Roamie: {} };
  const ctx = vm.createContext({ window, AudioContext: Ctx, Float32Array, Math, Set, atob: (b) => Buffer.from(b, 'base64').toString('latin1'), setTimeout: (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; } });
  vm.runInContext(fs.readFileSync(new URL('../../../roamies/voice-out.js', import.meta.url), 'utf8'), ctx);
  const out = window.Roamie.voiceOut, reported = [];
  out.onMark = (n) => reported.push(n);
  const fire = () => { for (const x of timeouts.splice(0)) x.fn(); };
  const pcm = Buffer.alloc(8).toString('base64');
  // nothing playing: answered after the quiet margin, not at once
  out.handle({ mark: 'm1' }); assert.deepEqual(reported, []); assert.equal(timeouts.length, 1);
  fire(); assert.deepEqual(reported, ['m1']);
  // two chunks handed over, then the mark: not while either is still playing
  out.handle({ id: 's1', rate: 44100, pcm }); out.handle({ id: 's1', rate: 44100, pcm }); out.handle({ mark: 'm2' });
  fire(); assert.deepEqual(reported, ['m1']);
  sources[0].end(); fire(); assert.deepEqual(reported, ['m1'], 'one chunk is still playing');
  sources[1].end(); assert.deepEqual(reported, ['m1'], 'ended, but not yet silent for the margin');
  assert.ok(timeouts[0].ms >= 400 && timeouts[0].ms >= (0.2 + 0.01 + 0.25) * 1000 - 1e-6, 'the margin covers the output delay the device reports');
  fire(); assert.deepEqual(reported, ['m1', 'm2']);
  // audio handed over after a mark doesn't hold that mark back; stopped audio counts as over once it is silent
  out.handle({ id: 's2', rate: 44100, pcm }); out.handle({ mark: 'm3' }); out.handle({ id: 's2', rate: 44100, pcm });
  out.handle({ stop: true });
  assert.equal(sources[2].stopped, true); fire(); fire();
  assert.deepEqual(reported, ['m1', 'm2', 'm3']);
  const host = fs.readFileSync(new URL('../../../roamies/host.js', import.meta.url), 'utf8');
  assert.match(host, /Roamie\.voiceOut\.onMark = \(mark\) => send\(\{ type: 'speech_mark', mark \}\)/);
  assert.match(host, /else if \(m\.kind === 'ask_text'\) \{ if \(ask && !ask\.bar && ask\.choices\) ask\.h\.placeholder\?\.\(m\.text\); \}/);
  assert.match(host, /if \(ask\?\.choices && m\.again\) return;/, 'a reopened window makes no second listening sound');
}

fs.rmSync(home, { recursive: true, force: true });
console.log('conversation flow tests: passed');
