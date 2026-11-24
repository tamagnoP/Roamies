#!/bin/bash
# usage: rate.sh <what> <dist> [times]  : the page's size every 4 s while <what> runs, and its rate of growth over the stretches where it grew
[ -n "${BENCH_GUARD:-}" ] || exec "$(dirname "$0")/guard.sh" "$0" "$@" # the sound is put back however the run ends
EVERY=1 node inject.mjs $1 ${3:-20} $2 2>/dev/null | python3 -c "
import sys,json
S=[json.loads(l) for l in sys.stdin if l.startswith('{')]
run=[s for s in S if s['label'].startswith('$1')]
up=[((b['web']-a['web']),(b['t']-a['t'])) for a,b in zip(run,run[1:]) if b['web']-a['web']>0.5]
drops=[round(b['web']-a['web']) for a,b in zip(run,run[1:]) if b['web']-a['web']<-10]
a,b=run[0],run[-1]
print('%-10s %-14s start %.0f | %s | 20s later %.0f | growing %.1f MB/s over %.0f of %.0f s | drops %s | %.0f fps' % ('$1','$(basename $2)',S[0]['web'],' '.join('%.0f'%s['web'] for s in run),S[-1]['web'],sum(d for d,_ in up)/max(1,sum(t for _,t in up)),sum(t for _,t in up),b['t']-a['t'],drops,(b['frames']-a['frames'])/(b['t']-a['t'])))"
