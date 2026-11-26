#!/bin/bash
# Feature 23: starts mlx_vlm.server for the bench exactly as Roamies would (serverCommand in localserver.mjs: the
# pinned files by path, 127.0.0.1 only, offline, the prefix cache in memory with 6 checkpoints), under /usr/bin/time.
# server.sh <e4b|e2b> <port> <log> [draft]   (APC_CHECKPOINT_ENTRIES=<n> overrides the 6, for a comparison only)
set -eu
here="$(cd "$(dirname "$0")/../.." && pwd)"
PY=${PY:-/opt/homebrew/anaconda3/envs/localai/bin/python}
CMD=$(cd "$here" && node --input-type=module -e "
  import { serverCommand, startProblems } from './localserver.mjs';
  const o = { python: '$PY', home: process.env.HOME, model: '$1', draft: '${4:-}' === 'draft' };
  const s = startProblems(o);
  for (const l of [...s.problems, ...s.notes]) console.error(l);
  if (s.problems.length) process.exit(1);
  const c = serverCommand({ ...o, draft: s.draft, port: $2 });
  const env = { ...c.env, ...(process.env.APC_CHECKPOINT_ENTRIES ? { APC_CHECKPOINT_ENTRIES: process.env.APC_CHECKPOINT_ENTRIES } : {}) };
  console.log([...Object.entries(env).map(([k, v]) => k + '=' + v), c.cmd, ...c.args].join('\n'));
")
IFS=$'\n' read -r -d '' -a PARTS <<< "$CMD" || true
ENVS=(); while [[ "${PARTS[0]}" == *=* ]]; do ENVS+=("${PARTS[0]}"); PARTS=("${PARTS[@]:1}"); done
exec env -i "${ENVS[@]}" /usr/bin/time -l "${PARTS[@]}" > "$3" 2>&1
