# Feature 24: the natural voice's helper, as shipped (../kokoro_server.py), with the real model. Makes the sentences
# of N scripted replies (cut the way the app cuts them) and one sentence at the length limit after every reply,
# reading the helper's size every 10 ms. Prints numbers only; ends with code 1 if the helper goes over 1.5 GB or
# does not come back to its resting size between sentences.
#   <python with mlx_audio> kokorocheck.py <model folder, named as the model: .../Kokoro-82M-bf16> [replies, default 40] [cacheMB, default 0] [memoryMB, default 400]
#   WAV=<file>: also keeps the first reply's audio, to listen to.   GAP=<seconds between replies> (default 0.6)
import array, ctypes, json, math, os, struct, subprocess, sys, threading, time, wave
here = os.path.dirname(os.path.abspath(__file__))
LIMIT_MB, REST_SLACK_MB, CHARS = 1500, 60, 120

class RU(ctypes.Structure):
    _fields_ = [("pad", ctypes.c_uint8 * 72), ("phys_footprint", ctypes.c_uint64), ("rest", ctypes.c_uint8 * 400)]
libc = ctypes.CDLL(None)
def footprint(pid):
    r = RU(); return r.phys_footprint / 1048576 if libc.proc_pid_rusage(pid, 4, ctypes.byref(r)) == 0 else 0.0

def main():
    model = os.path.abspath(sys.argv[1]); n = int(sys.argv[2]) if len(sys.argv) > 2 else 40
    cache, memory = (sys.argv[3] if len(sys.argv) > 3 else "0"), (sys.argv[4] if len(sys.argv) > 4 else "400")
    gap = float(os.environ.get("GAP", "0.6"))
    js = ("import { REPLIES } from './script.mjs'; import { splitLong } from '../kokorovoice.mjs';"
          f"const out = []; for (let i = 0; i < {n}; i++) out.push((REPLIES[i % REPLIES.length].match(/[^.!?]+[.!?]+/g) ?? []).flatMap((s) => splitLong(s.trim(), {CHARS})));"
          "console.log(JSON.stringify(out));")
    replies = json.loads(subprocess.run(["node", "--input-type=module", "-e", js], cwd=here, capture_output=True, text=True, check=True).stdout)
    words = "The report block ends at half past three and the next one starts at four so there is time for a short walk before it".split()
    def longest(seed):
        out = []; i = seed
        while len(" ".join(out)) < CHARS: out.append(words[i % len(words)]); i += 1
        return " ".join(out)[:CHARS - 1].strip() + "."
    env = {"HF_HUB_OFFLINE": "1", "PATH": "/usr/bin:/bin", "HOME": os.environ["HOME"], "TMPDIR": os.environ.get("TMPDIR", "/tmp")}
    p = subprocess.Popen([sys.executable, "-u", os.path.join(here, "..", "kokoro_server.py"), model, model, "b", "bm_george", cache, memory],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
    peak = [0.0]; going = [True]
    def watch():
        while going[0]: peak[0] = max(peak[0], footprint(p.pid)); time.sleep(0.01)
    threading.Thread(target=watch, daemon=True).start()
    def block():
        head = json.loads(p.stdout.read(struct.unpack(">I", p.stdout.read(4))[0]))
        return head, (p.stdout.read(head["bytes"]) if head.get("bytes") else b"")
    t0 = time.time(); head, _ = block()
    if not head.get("ready"): print(json.dumps({"started": False, "error": head.get("error", "")[:200]})); return 1
    time.sleep(2); rest0 = footprint(p.pid)
    print(json.dumps({"started_s": round(time.time() - t0, 1), "highest_while_starting_mb": round(peak[0]), "resting_mb": round(rest0), "cacheMB": int(cache), "memoryMB": int(memory)}), flush=True)
    peak[0] = 0.0; rid = 0; highest = 0.0; highest_long = 0.0; rests = []; times = []; times_long = []; audio_s = 0.0; sentences = 0; first = []
    level = {"peak": 0, "squares": 0, "n": 0, "full": 0}
    def say(text):
        nonlocal rid, audio_s, sentences
        rid += 1; t = time.time()
        p.stdin.write((json.dumps({"id": rid, "text": text, "voice": "bm_george", "speed": 1.05}) + "\n").encode()); p.stdin.flush()
        head, pcm = block()
        if "error" in head: raise RuntimeError(head["error"])
        audio_s += len(pcm) / 48000; sentences += 1
        a = array.array("h"); a.frombytes(pcm)  # the level of what was made: highest sample, sum of squares, samples at full scale
        if len(a):
            level["peak"] = max(level["peak"], max(a), -min(a)); level["squares"] += sum(x * x for x in a); level["n"] += len(a); level["full"] += sum(1 for x in a if x >= 32767 or x <= -32767)
        return time.time() - t, pcm
    for i, pieces in enumerate(replies):
        for s in pieces:
            dt, pcm = say(s); times.append(dt)
            if i == 0: first.append(pcm)
        highest = max(highest, peak[0]); peak[0] = 0.0
        dt, _ = say(longest(i)); times_long.append(dt)
        time.sleep(0.05); highest_long = max(highest_long, peak[0])
        time.sleep(gap); rests.append(footprint(p.pid)); peak[0] = 0.0
        if (i + 1) % 10 == 0:
            print(json.dumps({"replies": i + 1, "highest_mb": round(max(highest, highest_long)), "resting_mb": round(rests[-1])}), flush=True)
    going[0] = False; p.stdin.close(); p.wait(timeout=10)
    if os.environ.get("WAV"):
        with wave.open(os.environ["WAV"], "wb") as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes(b"".join(first))
    top = max(highest, highest_long); ok = top < LIMIT_MB and max(rests) < rest0 + REST_SLACK_MB
    print(json.dumps({"replies": len(replies), "sentences": sentences, "audio_s": round(audio_s), "highest_mb": round(top), "highest_at_length_limit_mb": round(highest_long),
                      "resting_mb": {"first": round(rest0), "lowest": round(min(rests)), "highest": round(max(rests)), "last": round(rests[-1])},
                      "peak_dbfs": round(20 * math.log10(max(level["peak"], 1) / 32768), 2), "average_dbfs": round(20 * math.log10(max(math.sqrt(level["squares"] / max(level["n"], 1)), 1) / 32768), 2), "samples_at_full_scale": level["full"],
                      "seconds_per_sentence": round(sum(times) / len(times), 3), "seconds_per_sentence_at_length_limit": round(sum(times_long) / len(times_long), 3),
                      "under_1500_mb": top < LIMIT_MB, "back_to_rest": max(rests) < rest0 + REST_SLACK_MB}), flush=True)
    return 0 if ok else 1
sys.exit(main())
