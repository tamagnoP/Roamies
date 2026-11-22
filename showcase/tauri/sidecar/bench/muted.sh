#!/bin/bash
# Runs a command with the Mac's sound output muted, and puts the mute switch back as it was.
was=$(osascript -e 'output muted of (get volume settings)')
restore() { osascript -e "set volume output muted $was" >/dev/null; }
trap restore EXIT
osascript -e 'set volume output muted true' >/dev/null
"$@"
