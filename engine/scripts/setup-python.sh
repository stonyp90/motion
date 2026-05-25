#!/usr/bin/env bash
# Bootstraps the Python venv used by the ML sidecars (Phase 2 segment,
# Phase 3 scene-split / sprite decomp).
#
# Idempotent. Safe to re-run.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$REPO_ROOT/.venv"

if [[ ! -d "$VENV" ]]; then
  echo "creating venv at $VENV"
  python3 -m venv "$VENV"
fi

"$VENV/bin/pip" install --quiet --upgrade pip

"$VENV/bin/pip" install --quiet \
  numpy \
  opencv-python-headless \
  pillow \
  torch \
  ultralytics \
  scenedetect \
  lottie \
  cairosvg

echo "python sidecar deps installed:"
"$VENV/bin/python" - <<'PY'
import sys
import importlib

for name in ("numpy", "cv2", "PIL", "torch", "ultralytics",
             "scenedetect", "lottie", "cairosvg"):
    try:
        m = importlib.import_module(name)
        print(f"  {name:<14} {getattr(m, '__version__', '?')}")
    except ImportError as e:
        print(f"  {name:<14} MISSING — {e}", file=sys.stderr)
        sys.exit(1)
PY

echo
echo "speech-to-text (whisper.cpp) moved in-process — no python deps needed."
echo "Run scripts/fetch-whisper-model.sh to download the GGUF model on demand,"
echo "then export MOTION_FORGE_STT_MODEL_PATH=<path/to/ggml-large-v3-turbo-q5_0.bin>."
