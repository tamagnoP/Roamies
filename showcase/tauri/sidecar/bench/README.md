# Measuring tools (feature 24, lean running)

Not run by `npm test`, not in the app bundle (`bundle.sh` copies none of this). Everything that starts the sidecar
does it in a throwaway home folder under `/tmp/lean`, with a stand-in for the AI provider on the loopback address.
Nothing said or shown is recorded: the tools count and time.

Build the two helper programs once: `./build.sh`. A copy of the page to measure goes in a folder, for example
`mkdir -p /tmp/lean/ours && cp -R ../../../desktop.html ../../../roamies ../../../panel ../../../onboarding /tmp/lean/ours/`.

| Tool | What it does |
| --- | --- |
| `sample.sh <out.jsonl>` | Every 5 s, the memory of each process of a running Roamies: time, kind, size. |
| `align.mjs <samples> <activity log>` | Lines the samples up with the activity log by time and kind of event. |
| `run.mjs <kokoro\|system\|text\|bubbles> [replies] [quiet s]` (`CARD=5`: the list card up in every fifth exchange) | A fixed script of replies through the real sidecar and the page in `host`; memory after each, request sizes. |
| `replay.mjs <tape> <dist> <name>` | Plays the messages recorded by a run into another copy of the page. |
| `inject.mjs <what> <times> [dist]` | One kind of thing shown over and over (`list`, `say`, `active`: a card up and the character thinking, `saycard`, ...). |
| `rate.sh <what> <dist> [times]` | `inject.mjs` with a reading every 4 s and the rate of growth. |
| `heapcheck.sh <dist>` | A card up and the character thinking for 45 s, then the blocks that hold most of the page's heap, by size. |
| `realrun.sh <mode> <replies> <quiet>` | The real built app (a copy, without its voice and hands helpers) with `relay.mjs` in the sidecar's place; times the quit. |
| `pitest.mjs` | Whether pi and what it starts end after a hand-off, `stop_pi` and the time limit, with a stand-in for pi. |
| `muted.sh <command>` | Runs a command with the sound output muted and puts it back. |
