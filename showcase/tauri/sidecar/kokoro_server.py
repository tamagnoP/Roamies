# Local-only build: the natural voice (feature 16). Started by Roamies (kokorovoice.mjs) with the Python named in
# settings.json, inside a sandbox with no network. It loads Kokoro once and then turns sentences into audio.
#
# In, on standard input, one JSON object per line:  {"id": 7, "text": "...", "voice": "bm_george", "speed": 1.05}
# Out, on the pipe that was standard output, one block per answer:
#   4 bytes (big-endian length of the header), the header as JSON, then `bytes` bytes of 16-bit mono samples.
#   {"ready": true, "rate": 24000, "voices": 54}        once, when the model is loaded
#   {"id": 7, "rate": 24000, "bytes": 123456}           a sentence's audio
#   {"id": 7, "error": "ValueError"}                    a sentence that failed: the kind of failure, never its text
#   {"ready": false, "error": "..."}                    the model couldn't be loaded; the process then ends
#
# Rules this file keeps (test/kokorovoice.test.mjs reads it):
# - It never writes, prints or logs the text it is given, and no failure message carries it.
# - It opens no socket and listens on nothing. It starts no other process.
# - A voice is used only if a file of that name ships in the model's own "voices" folder. Nothing here takes a
#   recording of a voice or a voice file from anywhere else.
# - It ends when its input closes or its parent is gone.
# - MLX's cache and memory limits are set from the settings before the model is loaded.
import glob
import json
import os
import re
import struct
import sys
import threading
import time

PARENT = os.getppid()
VOICE_NAME = re.compile(r"^[a-z]{2}_[a-z0-9]{1,32}$")

# Whatever a library prints goes to the error stream, so it can't land among the audio.
out = os.fdopen(os.dup(1), "wb")
os.dup2(2, 1)


def send(header, payload=b""):
    head = json.dumps(header).encode("utf-8")
    out.write(struct.pack(">I", len(head)) + head + payload)
    out.flush()


def watch_parent():
    while True:
        time.sleep(3)
        if os.getppid() != PARENT:
            os._exit(0)


def voices_in(model_dir):
    names = set()
    for pattern in ("voices/*.safetensors", "snapshots/*/voices/*.safetensors"):
        for f in glob.glob(os.path.join(model_dir, pattern)):
            names.add(os.path.splitext(os.path.basename(f))[0])
    return names


def main():
    model_name, model_dir, lang = sys.argv[1], sys.argv[2], sys.argv[3]
    threading.Thread(target=watch_parent, daemon=True).start()
    try:
        import numpy as np
        import mlx.core as mx
        from mlx_audio.tts.utils import load

        # Feature 24: MLX's memory, bounded before anything is loaded (kokoro.cacheMB, kokoro.memoryMB). Without
        # these MLX keeps every freed block for reuse and a sentence takes the helper to several GB for a moment.
        mx.set_cache_limit(int(sys.argv[5]) * 1024 * 1024)
        mx.set_memory_limit(int(sys.argv[6]) * 1024 * 1024)

        voices = voices_in(model_dir)
        if not voices:
            raise RuntimeError("the model's folder has no voices")
        model = load(model_name)
        rate = int(model.sample_rate)
        # One short line made now, so the first real sentence doesn't pay for the warm-up.
        warm = sys.argv[4] if len(sys.argv) > 4 and VOICE_NAME.match(sys.argv[4]) and sys.argv[4] in voices else sorted(voices)[0]
        for _ in model.generate(text="Ready.", voice=warm, speed=1.0, lang_code=lang):
            pass
    except BaseException as e:  # nothing has been given to say yet, so the message can't hold a sentence
        send({"ready": False, "error": f"{type(e).__name__}: {str(e)[:200]}"})
        return 1
    send({"ready": True, "rate": rate, "voices": len(voices)})

    for line in sys.stdin:
        rid = None
        try:
            req = json.loads(line)
            rid = req.get("id")
            voice = req.get("voice")
            if not isinstance(voice, str) or not VOICE_NAME.match(voice) or voice not in voices:
                send({"id": rid, "error": "UnknownVoice"})
                continue
            speed = min(2.0, max(0.5, float(req.get("speed", 1.0))))
            parts = []
            for result in model.generate(text=req["text"], voice=voice, speed=speed, lang_code=lang):
                parts.append(np.asarray(result.audio, dtype=np.float32).reshape(-1))
            audio = np.concatenate(parts) if parts else np.zeros(0, dtype=np.float32)
            pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
            send({"id": rid, "rate": rate, "bytes": len(pcm)}, pcm)
        except BaseException as e:
            if isinstance(e, (KeyboardInterrupt, SystemExit, BrokenPipeError)):
                return 0
            send({"id": rid, "error": type(e).__name__})  # the kind only: a message could quote the sentence
    return 0


if __name__ == "__main__":
    try:
        code = main()
    except BaseException:
        code = 1
    os._exit(code)
