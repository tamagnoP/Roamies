// Local-only build: the Mac's own voice (localvoice.mjs) and the switched-off web lookups (draw.mjs).
// `say` is stood in for by a small script that writes the kind of WAV file `say` does.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalVoice, spoken, wavPcm } from '../localvoice.mjs';
import { createSpeaker } from '../speaker.mjs';
import { faviconFor, photoFor } from '../draw.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-test-'));
// Writes RIFF/WAVE with a filler chunk before the samples (as CoreAudio does): one sample per character said, each
// the character's code, so a test can read back what was spoken. "FAIL" exits 1; "STEREO" writes two channels.
const fake = path.join(dir, 'say');
fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require('node:fs');
const out = process.argv[process.argv.indexOf('-o') + 1];
let text = '';
process.stdin.on('data', (d) => { text += d; }).on('end', () => {
  text = text.trim();
  if (text === 'FAIL') process.exit(1);
  fs.appendFileSync(${JSON.stringify(path.join(dir, 'args.log'))}, JSON.stringify(process.argv.slice(2)) + '\\n');
  const ch = text.startsWith('STEREO') ? 2 : 1;
  const data = Buffer.alloc(text.length * 2 * ch);
  for (let i = 0; i < text.length; i++) for (let c = 0; c < ch; c++) data.writeInt16LE(c ? -1 : text.charCodeAt(i), (i * ch + c) * 2);
  const fmt = Buffer.alloc(24); fmt.write('fmt '); fmt.writeUInt32LE(16, 4); fmt.writeUInt16LE(1, 8); fmt.writeUInt16LE(ch, 10); fmt.writeUInt32LE(44100, 12); fmt.writeUInt32LE(88200 * ch, 16); fmt.writeUInt16LE(2 * ch, 20); fmt.writeUInt16LE(16, 22);
  const fill = Buffer.alloc(8 + 10); fill.write('FLLR'); fill.writeUInt32LE(10, 4);
  const head = Buffer.alloc(8); head.write('data'); head.writeUInt32LE(data.length, 4);
  const body = Buffer.concat([Buffer.from('WAVE'), fmt, fill, head, data]);
  const riff = Buffer.alloc(8); riff.write('RIFF'); riff.writeUInt32LE(body.length, 4);
  fs.writeFileSync(out, Buffer.concat([riff, body]));
});
`, { mode: 0o755 });
const heardText = (chunks) => { const b = Buffer.concat(chunks.map((c) => Buffer.from(c))); let s = ''; for (let i = 0; i < b.length; i += 2) s += String.fromCharCode(b.readInt16LE(i)); return s; };
const run = (lines, opts = {}) => new Promise((done) => {
  const got = [];
  const v = new LocalVoice({ sayBin: fake, platform: 'darwin', onAudio: (a) => got.push(a), onEnd: () => done({ got, v }), onError: (err) => done({ got, v, err }), ...opts }).open();
  for (const l of lines) v.say(l);
  v.end();
});

// Voice cues are Fish's: never read out.
assert.equal(spoken('[warm] Hello there. [chuckling] Ha!'), 'Hello there. Ha!');
assert.equal(spoken('[break]'), '');

{ // sentences come out in order, cues dropped, text on stdin (never an argument)
  const { got, err } = await run(['[excited] One.', 'Two!', '[break]', 'Three?']);
  assert.equal(err, undefined);
  assert.equal(heardText(got), 'One.Two!Three?');
  const args = fs.readFileSync(path.join(dir, 'args.log'), 'utf8');
  assert.ok(!/One|Two|Three/.test(args), 'the text is not on the command line');
  assert.match(args, /--data-format=LEI16@44100/);
}
{ // nothing said: ends straight away, no process
  const { got, err } = await run([]);
  assert.equal(err, undefined); assert.equal(got.length, 0);
}
{ // long audio is handed over in whole-sample chunks
  const { got } = await run(['x'.repeat(50_000)]);
  assert.ok(got.length > 1 && got.every((c) => c.length % 2 === 0));
  assert.equal(heardText(got).length, 50_000);
}
{ // stereo: the first channel only
  const { got } = await run(['STEREO ok']);
  assert.equal(heardText(got), 'STEREO ok');
}
{ // a failure is reported once, with whether anything was heard
  const a = await run(['FAIL']);
  assert.ok(a.err && a.err.heard === false);
  const b = await run(['Fine.', 'FAIL']);
  assert.ok(b.err && b.err.heard === true);
  const c = await run(['Hi.'], { platform: 'linux' });
  assert.match(c.err.message, /macOS/);
  const d = await run(['Hi.'], { sayBin: path.join(dir, 'missing') });
  assert.ok(d.err && d.err.heard === false);
}
{ // abort: silent, and nothing after it
  let ended = 0, errors = 0; const got = [];
  const v = new LocalVoice({ sayBin: fake, platform: 'darwin', onAudio: (a) => got.push(a), onEnd: () => ended++, onError: () => errors++ });
  v.say('One.'); v.say('Two.'); v.abort(); v.say('Three.'); v.end();
  await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual([got.length, ended, errors], [0, 0, 0]);
}
assert.throws(() => wavPcm(Buffer.from('not a wav file at all')), /no audio/);
// No temp audio left behind.
const left = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('roamies-voice-')).flatMap((n) => fs.readdirSync(path.join(os.tmpdir(), n)));
assert.deepEqual(left, []);

{ // the speaker, with its defaults, is the local voice: on without a Fish key, and a reply plays through it
  const out = [];
  const sp = createSpeaker({ emit: (m) => out.push(m), beatPhrases: [], FishVoiceImpl: class extends LocalVoice { constructor(o) { super({ ...o, sayBin: fake, platform: 'darwin' }); } } });
  assert.equal(sp.on, false);
  sp.setKey('local');
  assert.deepEqual(await sp.check(), { ok: true, credit: null });
  const v = sp.start(); v.say('Hello.'); v.end();
  await new Promise((r) => { const t = setInterval(() => { if (out.some((m) => m.end)) { clearInterval(t); r(); } }, 20); });
  const pcm = out.filter((m) => m.pcm);
  assert.equal(heardText(pcm.map((m) => Buffer.from(m.pcm, 'base64'))), 'Hello.');
  assert.equal(pcm[0].rate, 44100);
}

// Cards: no web lookups unless a test passes its own fetch.
await assert.rejects(photoFor({ query: 'Mount Everest' }), /switched off in this build/);
await assert.rejects(photoFor({ url: 'https://example.com/a.png' }), /switched off in this build/);
assert.equal(await faviconFor('https://example.org/story'), null);

fs.rmSync(dir, { recursive: true, force: true });
console.log('local voice tests: passed');
