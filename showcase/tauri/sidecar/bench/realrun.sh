#!/bin/bash
# The real app (a copy of the built bundle, without its voice and hands helpers so nothing asks for a permission),
# in a throwaway home folder, with relay.mjs in the sidecar's place. usage: realrun.sh <mode> <replies> <quiet> [name] [quitWhen: end|speaking]
[ -n "${BENCH_GUARD:-}" ] || exec "$(dirname "$0")/guard.sh" "$0" "$@" # the sound is put back however the run ends
set -u
cd "$(dirname "$0")"
MODE=$1; N=$2; QUIET=$3; NAME=${4:-real-$MODE}
SRC=../../src-tauri/target/release/bundle/macos/Roamies.app
APP=/private/tmp/lean/app/Roamies.app
if [ ! -d "$APP" ]; then
  mkdir -p /tmp/lean/app && cp -R "$SRC" "$APP" && rm -f "$APP/Contents/MacOS/roamies-voice" "$APP/Contents/MacOS/roamies-hands"
  codesign --force --deep -s - "$APP" >/dev/null 2>&1
fi
printf '#!/bin/bash\nexec /opt/homebrew/bin/node %s/relay.mjs "$@"\n' "$PWD" > /tmp/lean/node-wrap.sh; chmod +x /tmp/lean/node-wrap.sh
H=/tmp/lean/home-$NAME; rm -rf "$H"; mkdir -p "$H" /tmp/lean/out; rm -f /tmp/lean/out/$NAME.done
BEFORE=$(pgrep -f 'com.apple.WebKit' | tr '\n' ',')
env -i HOME="$H" PATH="$PATH" TMPDIR="$TMPDIR" LANG=en_US.UTF-8 ROAMIES_NODE=/tmp/lean/node-wrap.sh MEASURE_MODE=$MODE MEASURE_N=$N MEASURE_QUIET=$QUIET MEASURE_NAME=$NAME MEASURE_BEFORE="$BEFORE" MEASURE_NODE="$APP/Contents/MacOS/node" MEASURE_LOOK=${LOOK:-jarvis} MEASURE_REBUILD=${REBUILD:-0} "$APP/Contents/MacOS/roamies" >/tmp/lean/out/$NAME.app.log 2>&1 &
PID=$!
echo "app pid $PID"
while [ ! -f /tmp/lean/out/$NAME.done ]; do kill -0 $PID 2>/dev/null || { echo "the app went away"; exit 1; }; sleep 2; done
# the quit request, as an Apple event to this copy, and how long the app takes to go
START=$(python3 -c 'import time;print(time.time())')
osascript -e "tell application \"$APP\" to quit" >/dev/null 2>&1 &
for i in $(seq 1 100); do kill -0 $PID 2>/dev/null || break; sleep 0.1; done
END=$(python3 -c 'import time;print(time.time())')
if kill -0 $PID 2>/dev/null; then echo "quit: not answered within 10 s"; else python3 -c "print('quit: the app was gone after %.1f s' % ($END-$START))"; fi
sleep 5
python3 - "$NAME" "$PID" <<'PY'
import json,sys,os
d=json.load(open(f'/tmp/lean/out/{sys.argv[1]}.done'))
def alive(p):
    try: os.kill(p,0); return True
    except OSError: return False
left=[(n,p) for n,p in [('app',int(sys.argv[2])),('relay',d['relay']),('sidecar',d['sidecar'])]+[(k[1],k[0]) for k in d['kids']] if alive(p)]
print('5 s after the quit request, still there:', left)
for n,p in left:
    try: os.kill(p,9)
    except OSError: pass
PY
