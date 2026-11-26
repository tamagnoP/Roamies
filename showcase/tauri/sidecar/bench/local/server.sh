#!/bin/bash
# Feature 23: starts mlx_vlm.server for the bench, on 127.0.0.1 only, offline, with the prefix cache in memory only.
# server.sh <e4b|e2b> <port> <log> [draft]   (draft: the Gemma 4 MTP drafter for that model, block size 4)
set -eu
PY=${PY:-/opt/homebrew/anaconda3/envs/localai/bin/python}
case "$1" in
  e4b) M=$(ls -d ~/.cache/huggingface/hub/models--mlx-community--gemma-4-e4b-it-4bit/snapshots/*/ | head -1); D=$(ls -d ~/.cache/huggingface/hub/models--mlx-community--gemma-4-E4B-it-assistant-bf16/snapshots/*/ 2>/dev/null | head -1) ;;
  e2b) M=$(ls -d ~/.cache/huggingface/hub/models--mlx-community--gemma-4-e2b-it-4bit/snapshots/*/ | head -1); D=$(ls -d ~/.cache/huggingface/hub/models--mlx-community--gemma-4-E2B-it-assistant-bf16/snapshots/*/ 2>/dev/null | head -1) ;;
  *) echo "e4b or e2b" >&2; exit 2 ;;
esac
EXTRA=()
if [ "${4:-}" = draft ]; then EXTRA=(--draft-model "$D" --draft-kind mtp --draft-block-size 4); fi
exec env -i HOME="$HOME" PATH=/usr/bin:/bin HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1 APC_ENABLED=1 APC_DISK_ENABLED=0 APC_CHECKPOINT_ENTRIES=${APC_CHECKPOINT_ENTRIES:-6} \
  /usr/bin/time -l "$PY" -m mlx_vlm.server --host 127.0.0.1 --port "$2" --model "$M" --log-level INFO ${EXTRA[@]+"${EXTRA[@]}"} > "$3" 2>&1
