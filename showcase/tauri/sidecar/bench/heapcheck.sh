#!/bin/bash
# usage: heapcheck.sh <dist>  : a card up and the character thinking for 45 s, then the blocks that hold most of the page's heap, by size
[ -n "${BENCH_GUARD:-}" ] || exec "$(dirname "$0")/guard.sh" "$0" "$@" # the sound is put back however the run ends
pkill -f bench/host; sleep 1; B=$(pgrep -f com.apple.WebKit.WebContent | tr '\n' ' ')
(sleep 3; for m in '{"kind":"size","size":"default"}' '{"kind":"home","home":"bottom-left"}' '{"kind":"look","look":"jarvis"}' '{"kind":"greet"}'; do echo "{\"host\":$m}"; done; sleep 6
 echo '{"host":{"kind":"list","today":[{"id":"a","text":"One task","done":false},{"id":"b","text":"Two","done":false}],"later":[],"seconds":900,"flash":null,"toggle":false}}'; sleep 4; echo '{"host":{"kind":"agent","e":{"type":"start"}}}'; sleep 60; echo '{"quit":1}') | ./host $1 > /dev/null 2>&1 &
sleep 58; P=""; for p in $(pgrep -f com.apple.WebKit.WebContent); do echo " $B " | grep -q " $p " || P=$p; done
echo "$1: page $(./fp $P | awk '{printf "%.0f MB", $2/1048576}')"
heap -s $P 2>/dev/null | grep "^All zones: .*Sizes" | tr ' ' '\n' | grep "\[" | python3 -c "
import sys,re
rows=[]
for l in sys.stdin:
    m=re.match(r'([\d.]+)(KB)?\[(\d+)\]',l.strip())
    if m:
        sz=float(m.group(1))*(1024 if m.group(2) else 1); n=int(m.group(3)); rows.append((sz*n,sz,n))
rows.sort(reverse=True)
for tot,sz,n in rows[:4]: print(f'   {tot/1048576:8.1f} MB in {n} blocks of {sz:.0f} bytes')"
wait
