# Feature 24: where the natural voice's memory goes. Loads Kokoro the way kokoro_server.py does and makes fixed
# sentences, reading the process's size every 10 ms and MLX's own counters after each. Prints numbers only.
#   python kokoromem.py <model folder> [mode]     modes, joined by commas: plain,
#   clear (cache emptied after each sentence), cache<MB> (cache limit), mem<MB> (memory limit), wired<MB>
#   LENGTHS='[120,60]' sentence lengths in characters; GAP=2 seconds between sentences, with the size every 0.25 s
import ctypes, json, os, sys, threading, time
os.environ.setdefault("HF_HUB_OFFLINE", "1")

class RU(ctypes.Structure):
    _fields_ = [("pad", ctypes.c_uint8 * 72), ("phys_footprint", ctypes.c_uint64), ("rest", ctypes.c_uint8 * 400)]
libc = ctypes.CDLL(None)
def footprint():
    r = RU(); libc.proc_pid_rusage(os.getpid(), 4, ctypes.byref(r)); return r.phys_footprint / 1048576

peak = 0.0
def watch():
    global peak
    while True:
        peak = max(peak, footprint()); time.sleep(0.01)
threading.Thread(target=watch, daemon=True).start()

W = "The report block ends at half past three and the next one starts at four, so there is time for a short walk before it".split()
def sentence(chars, seed):
    out = []; i = seed
    while len(" ".join(out)) < chars: out.append(W[i % len(W)]); i += 1
    return " ".join(out)[:chars].strip() + "."

def main():
    global peak
    model_dir, mode = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else "plain")
    lengths = json.loads(os.environ.get("LENGTHS", "[20,60,120,120,60,20,120,119,118,90,120,200,400,120]"))
    import numpy as np, mlx.core as mx
    from mlx_audio.tts.utils import load
    for m in mode.split(","):
        if m.startswith("cache"): mx.set_cache_limit(int(m[5:]) * 1048576)
        elif m.startswith("mem"): mx.set_memory_limit(int(m[3:]) * 1048576)
        elif m.startswith("wired"): mx.set_wired_limit(int(m[5:]) * 1048576)
    print("limits MB: memory", round(mx.get_memory_limit() / 1048576) if hasattr(mx, "get_memory_limit") else "?", flush=True)
    rows = []
    def row(what, t0, audio=0.0):
        global peak
        rows.append({"what": what, "s": round(time.time() - t0, 2), "audio_s": round(audio, 1), "peak_mb": round(peak), "now_mb": round(footprint()),
                     "mlx_active": round(mx.get_active_memory() / 1048576), "mlx_cache": round(mx.get_cache_memory() / 1048576), "mlx_peak": round(mx.get_peak_memory() / 1048576)})
        print(json.dumps(rows[-1]), flush=True); peak = 0.0; mx.reset_peak_memory()
    t0 = time.time(); model = load(model_dir); row("load", t0)
    t0 = time.time()
    for _ in model.generate(text="Ready.", voice="bm_george", speed=1.0, lang_code="b"): pass
    row("warm-up", t0)
    for n, chars in enumerate(lengths):
        t0 = time.time(); parts = []
        for r in model.generate(text=sentence(chars, n), voice="bm_george", speed=1.05, lang_code="b"):
            parts.append(np.asarray(r.audio, dtype=np.float32).reshape(-1))
        a = sum(len(p) for p in parts) / 24000
        if "clear" in mode: mx.clear_cache()
        row(f"{chars} chars", t0, a)
        if os.environ.get("GAP"):
            g = float(os.environ["GAP"]); marks = []
            for k in range(int(g / 0.25)): time.sleep(0.25); marks.append(round(footprint()))
            print("   every 0.25 s after:", marks, flush=True); peak = 0.0
main()
