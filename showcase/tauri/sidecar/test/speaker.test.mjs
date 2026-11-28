import assert from 'node:assert/strict';
import { createSpeaker, BEATS } from '../speaker.mjs';

// A voice stand-in the test drives by hand.
const made = [];
class FakeVoice {
  constructor(o) { Object.assign(this, o); this.said = []; this.ended = false; this.aborted = false; made.push(this); }
  open() { return this; }
  say(s) { this.said.push(s); }
  end() { this.ended = true; }
  abort() { this.aborted = true; }
}
class OtherVoice extends FakeVoice {}
const setup = (beatPhrases = [], pickVoice = null) => {
  made.length = 0;
  const out = [], problems = [], logs = [];
  const sp = createSpeaker({ emit: (m) => out.push(m), onProblem: (p) => problems.push(p), log: (k, d) => logs.push([k, d]), MacVoice: FakeVoice, beatPhrases, pickVoice });
  return { sp, out, problems, logs };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

{ // Not enabled (a computer that can't speak): no voice.
  const { sp } = setup();
  assert.equal(sp.on, false);
  assert.equal(sp.start(), null);
}
{ // Enabled: the check is answered here (no request); audio goes out as base64 with the reply's id; end marks the end.
  const { sp, out, logs } = setup();
  sp.enable(); await tick();
  assert.equal(sp.on, true);
  assert.deepEqual(logs.find(([k]) => k === 'speech_ready'), ['speech_ready', { ok: true }]);
  const r = sp.start();
  assert.deepEqual(out.at(-1), { kind: 'speech', stop: true }, 'a new reply stops whatever was playing');
  r.say('Hi.'); r.end();
  const v = made[0];
  assert.deepEqual(v.said, ['Hi.']); assert.ok(v.ended);
  assert.equal('key' in v || 'model' in v, false, 'a voice is given no key and no model');
  v.onAudio(new Uint8Array([1, 0, 2, 0]));
  assert.deepEqual(out.at(-1), { kind: 'speech', id: r.id, rate: 44100, pcm: Buffer.from([1, 0, 2, 0]).toString('base64') });
  v.onEnd();
  assert.deepEqual(out.at(-1), { kind: 'speech', id: r.id, end: true, chars: 3 }, 'a whole reply says how much it said');
}
{ // Fails before any audio → opened again with everything said so far, the voice asked afresh (a natural voice that
  // went down gives way to the Mac's), and ended again.
  let natural = true;
  const { sp, out, problems } = setup([], () => (natural ? OtherVoice : null));
  sp.enable();
  const r = sp.start();
  r.say('One.'); r.say('Two.'); r.end();
  assert.ok(made[0] instanceof OtherVoice);
  natural = false;
  await made[0].onError(Object.assign(new Error('the helper stopped'), { heard: false }));
  assert.equal(made.length, 2); assert.ok(!(made[1] instanceof OtherVoice), 'the Mac\'s voice this time');
  assert.deepEqual(made[1].said, ['One.', 'Two.']); assert.ok(made[1].ended);
  made[1].onAudio(new Uint8Array([0, 0])); made[1].onEnd();
  assert.deepEqual(out.at(-1), { kind: 'speech', id: r.id, end: true, chars: 9 }); assert.deepEqual(problems, []);
}
{ // Fails before audio every time → opened three times in all, then one problem report, and the reply ends.
  const { sp, out, problems } = setup();
  sp.enable();
  const r = sp.start(); r.say('Hi.');
  for (let i = 0; i < 3; i++) await made.at(-1).onError(Object.assign(new Error('The voice made no audio.'), { heard: false }));
  assert.equal(made.length, 3, 'no fourth try');
  assert.deepEqual(problems, ['The voice made no audio.']);
  assert.deepEqual(out.at(-1), { kind: 'speech', id: r.id, end: true });
}
{ // Fails after audio started: no retry (it would repeat itself), no problem shown, just ends.
  const { sp, problems, out } = setup();
  sp.enable();
  const r = sp.start(); r.say('Hi.');
  made[0].onAudio(new Uint8Array([0, 0]));
  await made[0].onError(Object.assign(new Error('dropped'), { heard: true }));
  assert.equal(made.length, 1); assert.deepEqual(problems, []);
  assert.deepEqual(out.at(-1), { kind: 'speech', id: r.id, end: true });
}
{ // A new reply aborts the old one; the old one's late audio and end are ignored.
  const { sp, out } = setup();
  sp.enable();
  const a = sp.start(); a.say('Old.');
  const b = sp.start();
  assert.ok(made[0].aborted);
  const n = out.length;
  made[0].onAudio(new Uint8Array([0, 0])); made[0].onEnd();
  assert.equal(out.length, n, 'nothing from the stopped reply');
  b.say('New.'); assert.deepEqual(made[1].said, ['New.']);
}
{ // stop() (Stop, barge-in): aborts and tells the overlay to go quiet.
  const { sp, out } = setup();
  sp.enable();
  sp.start().say('Hi.');
  sp.stop();
  assert.ok(made[0].aborted); assert.deepEqual(out.at(-1), { kind: 'speech', stop: true });
}
{ // Beats are made once in the voice; a slow tool with nothing said plays one instantly, only once per reply.
  const { sp, out } = setup(BEATS);
  sp.enable(); await tick();
  for (let i = 0; i < BEATS.length; i++) { const w = made.at(-1); assert.deepEqual(w.said, [BEATS[i]]); w.onAudio(new Uint8Array([i, 0])); w.onEnd(); await tick(); await tick(); }
  assert.equal(sp.ready, BEATS.length);
  const r = sp.start(), n = made.length;
  assert.equal(r.beat(), true);
  const played = out.at(-1);
  assert.deepEqual({ ...played, pcm: undefined }, { kind: 'speech', id: r.id, rate: 44100, pcm: undefined });
  assert.ok(BEATS.some((_, i) => played.pcm === Buffer.from([i, 0]).toString('base64')), 'one of the made beats');
  assert.equal(made.length, n, 'no extra voice for the beat');
  assert.deepEqual(made.at(-1).said, [], 'the beat came from the cache, not the live voice');
  assert.equal(r.beat(), false, 'once per reply');
  const r2 = sp.start(); r2.say('Already talking.');
  assert.equal(r2.beat(), false, 'not when it already said something');
}
{ // No beats made yet (or making them failed): the beat is spoken live instead.
  const { sp } = setup(BEATS);
  sp.enable();
  const r = sp.start(); const live = made.at(-1);
  assert.equal(r.beat(), true);
  assert.ok(BEATS.includes(live.said[0]));
}
console.log('speaker tests: passed');
{ // Voice cues aren't counted as spoken text.
  const { sp, out } = setup();
  sp.enable();
  const r = sp.start(); r.say('[warm] Hello there.'); r.end();
  made.at(-1).onAudio(new Uint8Array([0, 0])); made.at(-1).onEnd();
  assert.deepEqual(out.at(-1), { kind: 'speech', id: r.id, end: true, chars: 12 });
  console.log('speech pacing tests: passed');
}

{ // At least 30 short beats, one or two words each, picked at random with no repeat among the last few.
  assert.ok(BEATS.length >= 30, 'plenty of beats');
  assert.equal(new Set(BEATS).size, BEATS.length, 'no duplicates');
  for (const b of BEATS) assert.ok(b.replace(/[.,!]/g, '').trim().split(/\s+/).length <= 2, `${b} is one or two words`);
  const { sp, out } = setup(BEATS);
  sp.enable(); await tick();
  for (let i = 0; i < BEATS.length; i++) { const w = made.at(-1); w.onAudio(new Uint8Array([i, 1])); w.onEnd(); await tick(); await tick(); }
  const seen = [];
  for (let i = 0; i < 40; i++) { const r = sp.start(); r.beat(); seen.push(out.at(-1).pcm); r.abort(); }
  for (let i = 0; i < seen.length; i++) assert.ok(!seen.slice(Math.max(0, i - 8), i).includes(seen[i]), 'no repeat within 8');
  assert.ok(new Set(seen).size > 12, 'they vary');
}
console.log('speaker beat variety: passed');
