// Local-only build: spoken replies with the Mac's own voice (/usr/bin/say) instead of Fish Audio, so the text of a
// reply never leaves the computer. Same shape as FishVoice (fish.mjs), so speaker.mjs drives it unchanged:
// say() as many times as needed, then end(); abort() stops at once, silently. onAudio(Uint8Array) gets 16-bit mono
// PCM at 44.1 kHz; onEnd() once after the last audio; onError(err) instead when it fails (err.heard = whether any
// audio had been made).
// Each sentence is made by one `say` run, in order: the text goes in on stdin (never on the command line), the
// audio comes back as a WAV file in a private temp folder that's read and deleted straight away.
// The voice is the system one (System Settings > Accessibility > Spoken Content > System voice), or the one named
// in ROAMIES_SAY_VOICE (a name from `say -v '?'`).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SAY = '/usr/bin/say';
export const RATE = 44100;
const CHUNK = 44100; // bytes handed over at a time: half a second of 16-bit mono

let dir = null, seq = 0;
function tmpDir() {
  if (!dir) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roamies-voice-')); // mkdtemp: owner-only (0700)
    process.once('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });
  }
  return dir;
}

/** What's said: Fish's voice cues ("[warm]", "[chuckling]") and stray brackets are for Fish only, so they go. */
export const spoken = (text) => String(text ?? '').replace(/\[[^\]\n]{0,60}\]/g, ' ').replace(/\s+/g, ' ').trim();

/** The samples in a WAV file from `say`: 16-bit PCM, mono (the first channel of anything wider). */
export function wavPcm(buf) {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') throw new Error('The voice made no audio.');
  let channels = 1, bits = 16, data = null;
  for (let at = 12; at + 8 <= buf.length;) {
    const id = buf.toString('latin1', at, at + 4), size = buf.readUInt32LE(at + 4), from = at + 8;
    if (id === 'fmt ' && from + 16 <= buf.length) { channels = buf.readUInt16LE(from + 2) || 1; bits = buf.readUInt16LE(from + 14); }
    // A size of 0 (or past the end) is a header that was never filled in: the samples are the rest of the file.
    else if (id === 'data') { data = buf.subarray(from, size && from + size <= buf.length ? from + size : buf.length); break; }
    at = from + size + (size % 2);
  }
  if (!data || bits !== 16) throw new Error('The voice made audio in a form I can\'t play.');
  if (channels > 1) {
    const frames = Math.floor(data.length / (2 * channels)), mono = Buffer.alloc(frames * 2);
    for (let i = 0; i < frames; i++) mono.writeInt16LE(data.readInt16LE(i * 2 * channels), i * 2);
    data = mono;
  }
  return data.subarray(0, data.length - (data.length % 2));
}

export class LocalVoice {
  constructor({ onAudio, onEnd, onError, sayBin = SAY, spawnImpl = spawn, voiceName = process.env.ROAMIES_SAY_VOICE || null, platform = process.platform, timeout = 30_000 } = {}) {
    Object.assign(this, { onAudio, onEnd, onError, sayBin, spawnImpl, voiceName, platform, timeout });
    this.queue = []; // sentences waiting their turn
    this.state = 'open'; // open → ending → done
    this.heard = false;
    this.busy = false;
    this.child = null;
  }

  open() { return this; }

  say(text) {
    if (this.state !== 'open') return;
    const s = spoken(text);
    if (!s) return;
    this.queue.push(s);
    this.pump();
  }

  end() {
    if (this.state !== 'open') return;
    this.state = 'ending';
    this.pump();
  }

  abort() { this.close(); }

  close() {
    if (this.state === 'done') return;
    this.state = 'done';
    this.queue.length = 0;
    try { this.child?.kill(); } catch { /* already gone */ }
    this.child = null;
  }

  fail(err) {
    if (this.state === 'done') return;
    this.close();
    err.heard = this.heard;
    this.onError?.(err);
  }

  async pump() {
    if (this.busy || this.state === 'done') return;
    this.busy = true;
    try {
      while (this.queue.length && this.state !== 'done') {
        const pcm = await this.make(this.queue.shift());
        if (this.state === 'done') return;
        for (let at = 0; at < pcm.length; at += CHUNK) {
          this.heard = true;
          this.onAudio?.(pcm.subarray(at, Math.min(pcm.length, at + CHUNK)));
        }
      }
    } catch (e) {
      return this.fail(e instanceof Error ? e : new Error(String(e)));
    } finally {
      this.busy = false;
    }
    if (this.state === 'ending' && !this.queue.length) { this.close(); this.onEnd?.(); }
  }

  /** One sentence as PCM. */
  make(text) {
    return new Promise((resolve, reject) => {
      if (this.platform !== 'darwin') return reject(new Error('The built-in voice needs macOS.'));
      const file = path.join(tmpDir(), `${process.pid}-${++seq}.wav`);
      const gone = () => { try { fs.rmSync(file, { force: true }); } catch { /* best effort */ } };
      let child, settled = false;
      const done = (err, pcm) => { if (settled) return; settled = true; clearTimeout(timer); if (this.child === child) this.child = null; gone(); err ? reject(err) : resolve(pcm); };
      const timer = setTimeout(() => { try { child?.kill(); } catch { /* already gone */ } done(new Error('The built-in voice took too long.')); }, this.timeout);
      try {
        // No message and no -f: `say` reads what to speak from stdin.
        child = this.spawnImpl(this.sayBin, [...(this.voiceName ? ['-v', this.voiceName] : []), '-o', file, '--file-format=WAVE', `--data-format=LEI16@${RATE}`], { stdio: ['pipe', 'ignore', 'ignore'] });
      } catch (e) { return done(e); }
      this.child = child;
      child.on('error', (e) => done(new Error(`Couldn't start the built-in voice: ${e.message}`)));
      child.on('close', (code) => {
        if (code !== 0) return done(new Error(`The built-in voice stopped (${code ?? 'killed'}).`));
        try { done(null, wavPcm(fs.readFileSync(file))); } catch (e) { done(e); }
      });
      child.stdin.on('error', () => { /* it quit before reading: the close handler reports it */ });
      child.stdin.end(`${text}\n`);
    });
  }
}
