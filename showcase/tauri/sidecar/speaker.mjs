// Speaks replies and hands the audio to the overlay ({ kind: 'speech' } messages). Local-only build: the voice is the
// Mac's own (localvoice.mjs), or the natural one (kokorovoice.mjs) when sidekick.mjs's pickVoice gives it.
// - Each reply has its own id, so audio from one that was stopped can never play over the next.
// - A reply's voice that fails before any audio is opened again (the voice asked afresh, so a natural voice that went
//   down gives way to the Mac's) with everything said so far, up to TRIES times; one that fails after audio leaves
//   the rest as text only.
// - Beats: when something slow starts (a web search, a page, the screen) and the model hasn't said anything,
//   a short line ("One sec.", "On it." and 32 more, picked at random) plays so it's never silent. They're made once
//   in the voice and kept, so they play instantly.
import { LocalVoice, RATE } from './localvoice.mjs';

// One or two words each, so a beat never sounds canned; any of them must fit before a search, a page, the screen or a drawing.
export const BEATS = [
  'One sec.', 'On it.', 'Hang on.', 'Hold on.', 'Got it.', 'Okay.', 'Sure.', 'Right.', 'Alright.', 'Gotcha.',
  'Checking.', "Let's see.", 'Sure thing.', 'Coming up.', 'Sec.', 'One moment.', 'Bear with.', 'Hmm, okay.', 'Got you.', 'Right, sec.',
  'Sure, sec.', 'Okay, sec.', 'Roger.', 'Yep.', 'Yep, sec.', 'Two secs.', 'Hold tight.', 'Mm-hmm.', 'Will do.', 'Righto.',
  'Moment.', 'Okay, checking.', 'Sure, checking.', 'Okie-dokie.',
];
const RECENT = 8; // a beat isn't picked again until this many others have played
const TRIES = 3; // a reply's voice opened at most this many times before any audio

export function createSpeaker({ emit, onProblem = () => {}, log = () => {}, MacVoice: FixedVoice = LocalVoice, pickVoice = null, beatPhrases = BEATS }) {
  // Local-only build (feature 16): which voice a reply uses is asked when it is made (pickVoice: the natural voice
  // while its helper is up, else nothing, which means the macOS voice), and the audio's rate comes from the voice.
  const voiceImpl = (o) => pickVoice?.(o) ?? FixedVoice;
  const voiceName = (I) => (I === FixedVoice ? 'mac' : 'natural'); // for the log: which of this build's voices
  const beatRate = new Map(); // phrase → the rate its kept audio was made at
  const beatVoice = new Map(); // Local-only build (feature 24): phrase → the voice its kept audio was made in
  let on = false, voice = '', seq = 0, current = null;
  let beats = new Map(), recent = [], warming = null; // phrase → [base64 PCM chunks], for the current voice
  // A random beat, not one of the last few: one that's already made if there is one, so it plays instantly.
  const ready = (p) => beats.has(p);
  const pickBeat = () => {
    const fresh = beatPhrases.filter((p) => !recent.includes(p));
    const pool = [fresh.filter(ready), beatPhrases.filter(ready), fresh, beatPhrases].find((x) => x.length);
    const phrase = pool?.[Math.floor(Math.random() * pool.length)] ?? BEATS[0];
    recent = [...recent, phrase].slice(-Math.min(RECENT, Math.max(0, beatPhrases.length - 1)));
    return phrase;
  };

  // Make the beats once, one at a time. Failures just leave a gap: that beat is then spoken live instead.
  function warm() {
    const vo = voice, list = beatPhrases; // a list that was replaced (setBeats) is no longer made
    warming ??= (async () => {
      for (const phrase of list) {
        if (!on || voice !== vo || beatPhrases !== list) break;
        if (beats.has(phrase)) continue;
        const Impl = voiceImpl();
        const chunks = await new Promise((done) => {
          const got = [];
          const v = new Impl({ voice: vo, onAudio: (pcm) => { beatRate.set(phrase, v.rate ?? RATE); got.push(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString('base64')); }, onEnd: () => done(got), onError: () => done(null) }).open();
          v.say(phrase); v.end();
        });
        if (chunks?.length && on && voice === vo && beatPhrases === list) { beats.set(phrase, chunks); beatVoice.set(phrase, Impl); }
      }
    })().finally(() => { warming = null; });
    return warming;
  }

  // Local-only build (feature 22). A mark asks the overlay to say when everything handed over before it has finished
  // playing; the overlay answers with the mark's name (speech_mark). The microphone is opened on that answer only.
  let marks = 0;
  const markNow = (n) => emit({ kind: 'speech', mark: n });
  /** A mark with nothing new said: answered when whatever is playing now has finished. */
  function mark() { const n = `m${++marks}`; markNow(n); return n; }
  /** Stops what is playing and drops what the open reply had waiting, but leaves its voice usable: what the reply
   *  says next is spoken. (stop() ends the reply's voice for good.) */
  function hush() { current?.cut(); emit({ kind: 'speech', stop: true }); }

  function stopAll() {
    if (current) { current.abort(); current = null; }
    emit({ kind: 'speech', stop: true });
  }

  /** A new reply's voice, opened now. say(sentence) as they come, then end(). */
  function start() {
    if (!on) return null;
    stopAll();
    const id = `s${++seq}`, said = [];
    let ended = false, tries = 0, v = null, heard = false, done = false, beat = false, t0 = Date.now(), Impl = null;
    const me = {
      id,
      say(s) { if (done) return; said.push(s); v.say(s); },
      /** Something slow is starting: a short beat, unless it's already said something. */
      beat() {
        if (done || beat || said.length || heard) return false;
        beat = true;
        // Local-only build (feature 24): a beat kept in another voice than this reply's is said in this one instead.
        const phrase = pickBeat(), kept = beats.get(phrase), chunks = kept && (!beatVoice.has(phrase) || beatVoice.get(phrase) === Impl) ? kept : null;
        if (!chunks) { me.say(phrase); return true; }
        log('speech_beat', { id, ms: Date.now() - t0 });
        for (const pcm of chunks) emit({ kind: 'speech', id, rate: beatRate.get(phrase) ?? RATE, pcm });
        return true;
      },
      end() { if (done || ended) return; ended = true; v.end(); },
      // Local-only build: see mark() and hush() above. The mark comes after everything said on this voice so far.
      mark() { const n = `m${++marks}`; if (done || typeof v?.mark !== 'function') markNow(n); else v.mark(() => markNow(n)); return n; },
      cut() { if (!done) v?.cut?.(); },
      get done() { return done; },
      abort() { if (done) return; done = true; v?.abort(); if (current === me) current = null; },
    };
    // A reply that played to its end also says how much it said (without the voice cues), so the overlay can learn
    // how fast the voice talks and pace drawings to it.
    const finish = (whole = false) => {
      if (done) return;
      done = true;
      const chars = whole && heard ? said.join(' ').replace(/\[[^\]]*\]\s*/g, '').length : 0;
      emit({ kind: 'speech', id, end: true, ...(chars ? { chars } : {}) });
      if (current === me) current = null;
    };
    const connect = () => {
      tries++;
      Impl = voiceImpl({ reply: true });
      v = new Impl({
        voice,
        onAudio: (pcm) => {
          if (done) return;
          if (!heard) { heard = true; log('speech_first_audio', { id, voice: voiceName(Impl), ms: Date.now() - t0 }); }
          emit({ kind: 'speech', id, rate: v.rate ?? RATE, pcm: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString('base64') });
        },
        onEnd: () => finish(true),
        onError: async (err) => {
          if (done) return;
          log('speech_error', { id, voice: voiceName(Impl), heard: err.heard, message: err.message });
          if (!err.heard && !heard && tries < TRIES) {
            await Promise.resolve();
            if (done) return;
            connect();
            for (const s of said) v.say(s);
            if (ended) v.end();
            return;
          }
          if (!heard) onProblem(err.message);
          finish();
        },
      }).open();
    };
    connect();
    log('speech_start', { id, voice: voiceName(Impl) });
    current = me;
    return me;
  }

  return {
    /** Spoken replies can be made on this computer (macOS has the voice): the check is answered here, with no request
     *  (speech_ready), and the beats are made. */
    enable() { if (on) return; on = true; log('speech_ready', { ok: true }); warm(); },
    setVoice(v) { if ((v || '') !== voice) beats = new Map(); voice = v || ''; if (on) warm(); },
    get ready() { return beats.size; },
    get on() { return on; },
    start,
    stop: stopAll,
    mark, hush,
    // Local-only build (features 16 and 21a): the beats are the persona's, and are made again when they change or
    // when the voice that speaks them does (again = true).
    setBeats(list, again = false) {
      const same = Array.isArray(list) && list.length === beatPhrases.length && list.every((p, i) => p === beatPhrases[i]);
      if (!Array.isArray(list) || !list.length || (same && !again)) return;
      beatPhrases = [...list]; beats = new Map(); recent = [];
      if (on) (warming ?? Promise.resolve()).then(() => warm());
    },
  };
}
