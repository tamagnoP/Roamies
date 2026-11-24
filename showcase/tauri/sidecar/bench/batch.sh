#!/bin/bash
[ -n "${BENCH_GUARD:-}" ] || exec "$(dirname "$0")/guard.sh" "$0" "$@" # the sound is put back however the run ends
cd "$(dirname "$0")"
for mode in ${MODES:-kokoro system text bubbles}; do
  echo "== $mode $(date +%H:%M:%S)"
  node run.mjs $mode 40 300 2>&1 | grep -v "^$"
done
echo "== done $(date +%H:%M:%S)"
