#!/usr/bin/env bash
# Generate the test fixtures used by `cargo test` and the local
# end-to-end smoke (`motion-forge transcode`, `motion-forge generate`).
#
# We don't ship the MP4 in git (~500KB but binary, and easy to
# regenerate). This script re-creates it from FFmpeg's built-in
# `testsrc2` generator so it's byte-deterministic across machines.
#
# Idempotent. Safe to re-run.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURES="$REPO_ROOT/fixtures"
SAMPLE="$FIXTURES/sample.mp4"

mkdir -p "$FIXTURES"

if [[ -f "$SAMPLE" ]]; then
  echo "fixture already present: $SAMPLE"
  ffprobe -v error -show_entries stream=width,height,r_frame_rate \
    -show_entries format=duration -of default=nw=1 "$SAMPLE" 2>&1
  exit 0
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not on PATH; install via 'brew install ffmpeg' (macOS) or 'apt-get install ffmpeg' (Debian/Ubuntu)" >&2
  exit 1
fi

echo "generating 2-second 640x360@30 fixture at $SAMPLE"
ffmpeg -hide_banner -y \
  -f lavfi -i 'testsrc2=size=640x360:rate=30:duration=2' \
  -f lavfi -i 'sine=frequency=440:duration=2' \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p \
  -c:a aac -shortest \
  "$SAMPLE" 2>&1 | tail -3

ls -la "$SAMPLE"
ffprobe -v error -show_entries stream=width,height,r_frame_rate \
  -show_entries format=duration -of default=nw=1 "$SAMPLE"

echo "done"
