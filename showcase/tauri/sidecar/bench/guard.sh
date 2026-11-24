#!/bin/bash
# Runs a command with the Mac's sound output muted and its display kept awake, and puts the sound back as it was
# however the command ends: finished, interrupted (Ctrl-C, a signal) or killed outright. Runs that overlap share
# it: the first one notes the sound as it was, the last one to end puts it back.
# The display is kept awake by caffeinate, which ends with the run and changes no setting.
#   guard.sh <command> [args...]      guard.sh --release <pid> (used by the watcher)      guard.sh --state
# The bench's tools that make a sound start themselves under it (guarded.mjs, and the scripts' first lines).
set -u
D=/tmp/roamies-bench-guard
mkdir -p "$D/holders"

lock() {
  local n=0
  until mkdir "$D/lock" 2>/dev/null; do
    # A lock left by a run killed while it held it: nothing holds one for more than a second.
    n=$((n + 1)); if [ $n -gt 100 ]; then rmdir "$D/lock" 2>/dev/null; n=0; fi
    sleep 0.05
  done
}
unlock() { rmdir "$D/lock" 2>/dev/null; }
sound() { osascript -e 'set s to get volume settings' -e 'return ((output volume of s) as text) & " " & ((output muted of s) as text)'; }
put_sound() { osascript -e "set volume output volume $1" -e "set volume output muted $2" >/dev/null; }
# Runs that have ended without saying so (killed outright) are taken off the list.
prune() { local f; for f in "$D"/holders/*; do [ -e "$f" ] || continue; kill -0 "$(basename "$f")" 2>/dev/null || rm -f "$f"; done; }
live() { local f n=0; for f in "$D"/holders/*; do [ -e "$f" ] && n=$((n + 1)); done; echo $n; }

release() {
  lock
  rm -f "$D/holders/$1"; prune
  if [ "$(live)" -eq 0 ] && [ -f "$D/saved" ]; then put_sound $(cat "$D/saved"); rm -f "$D/saved"; fi
  unlock
}

case "${1:-}" in
  --release) release "$2"; exit 0 ;;
  --state) echo "sound now: $(sound)"; echo "saved: $(cat "$D/saved" 2>/dev/null || echo none)"; echo "runs: $(ls "$D/holders" | tr '\n' ' ')"; exit 0 ;;
  '') echo "usage: guard.sh <command> [args...]" >&2; exit 2 ;;
esac

ME=$$
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
lock
prune
if [ "$(live)" -eq 0 ]; then
  # The first run of a batch notes the sound as it is. If a note is already there, an earlier run was killed before it
  # could put the sound back: that note is the sound as it was before, and stays.
  [ -f "$D/saved" ] || sound > "$D/saved"
fi
touch "$D/holders/$ME"
osascript -e 'set volume output muted true' >/dev/null
unlock

# Put back when this script ends in any way it can see; a watcher of its own does it if it is killed outright.
trap 'release $ME' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
( trap '' INT TERM HUP; while kill -0 $ME 2>/dev/null; do sleep 1; done; "$SELF" --release $ME ) </dev/null >/dev/null 2>&1 &
/usr/bin/caffeinate -d -w $ME &

export BENCH_GUARD=$ME
"$@"
