#!/usr/bin/env bash
# Download a whisper.cpp GGUF model for the in-process streaming STT worker.
#
# Default model: ggml-large-v3-turbo-q5_0 — ~574 MB, q5_0 quantized,
# good quality and roughly 4-5x realtime on a modern laptop CPU.
#
# Override the model name with $WHISPER_MODEL. See
# https://huggingface.co/ggerganov/whisper.cpp for the full catalogue.
#
# Usage:
#   scripts/fetch-whisper-model.sh                       # default model
#   WHISPER_MODEL=ggml-base.en scripts/fetch-whisper-model.sh
#   WHISPER_MODELS_DIR=/data/models scripts/fetch-whisper-model.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODELS_DIR="${WHISPER_MODELS_DIR:-$REPO_ROOT/models/whisper}"
MODEL_NAME="${WHISPER_MODEL:-ggml-large-v3-turbo-q5_0}"

mkdir -p "$MODELS_DIR"
TARGET="$MODELS_DIR/$MODEL_NAME.bin"
URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$MODEL_NAME.bin"

if [[ -f "$TARGET" ]]; then
  echo "model already present: $TARGET"
else
  echo "downloading $MODEL_NAME from $URL"
  echo "  → $TARGET"
  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --progress-bar "$URL" -o "$TARGET.partial"
  elif command -v wget >/dev/null 2>&1; then
    wget --show-progress -O "$TARGET.partial" "$URL"
  else
    echo "error: neither curl nor wget is installed" >&2
    exit 1
  fi
  mv "$TARGET.partial" "$TARGET"
fi

SIZE_BYTES="$(stat -f%z "$TARGET" 2>/dev/null || stat -c%s "$TARGET" 2>/dev/null || echo 0)"
SIZE_MB=$(( SIZE_BYTES / 1024 / 1024 ))
echo
echo "ready: $TARGET ($SIZE_MB MB)"
echo
echo "export MOTION_FORGE_STT_MODEL_PATH=\"$TARGET\""
echo "then start the server: cargo run -p motion-forge-cli -- serve"
