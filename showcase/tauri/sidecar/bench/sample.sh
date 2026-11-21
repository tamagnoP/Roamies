#!/bin/bash
# Starts the memory sampler (sample.swift) on a running Roamies. Time, process and size only.
# usage: bench/sample.sh <out.jsonl> [seconds, default 5] [app, default /Applications/Roamies.app]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bin="${TMPDIR:-/tmp}/roamies-bench-sample"
[ "$bin" -nt "$here/sample.swift" ] || swiftc -O -o "$bin" "$here/sample.swift"
exec "$bin" "$@"
