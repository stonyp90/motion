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
  ultralytics

echo "python sidecar deps installed:"
"$VENV/bin/python" - <<'PY'
import sys
import importlib

for name in ("numpy", "cv2", "PIL", "torch", "ultralytics"):
    m = importlib.import_module(name)
    print(f"  {name:<14} {getattr(m, '__version__', '?')}")
PY
