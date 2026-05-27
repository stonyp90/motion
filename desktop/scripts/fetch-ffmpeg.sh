#!/usr/bin/env bash
# Fetch a pinned ffmpeg build for a given Rust target triple and stage
# the binary inside desktop/src-tauri/binaries/ under the Tauri
# externalBin naming convention:
#
#   ffmpeg-<target-triple>(.exe?)
#
# Usage:
#   desktop/scripts/fetch-ffmpeg.sh <target-triple>
#
# Reads:  desktop/ffmpeg-pins.json
# Writes: desktop/src-tauri/binaries/ffmpeg-<target>(.exe)
#
# Differs from fetch-ollama.sh in two ways:
#   - URL is read whole from the pins JSON (per-target source, not a
#     constructed URL from a single version) — because ffmpeg builds
#     come from different providers per OS (evermeet for mac, BtbN for
#     win/linux).
#   - Handles `.tar.xz` extraction (the BtbN Linux build) in addition
#     to the .zip + .tar.gz / .tgz formats fetch-ollama.sh covers.
#
# Network-only; no Rust toolchain dependency. CI step calls this once
# per matrix leg before `npx tauri build`. The Tauri shell's
# spawn_engine() then prepends the binaries dir to the engine's PATH
# so the engine's bare `Command::new("ffmpeg")` calls hit this binary
# instead of whatever the host happens to have installed.

set -euo pipefail

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "usage: $0 <rust-target-triple>" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
PINS_FILE="$DESKTOP_DIR/ffmpeg-pins.json"
BINARIES_DIR="$DESKTOP_DIR/src-tauri/binaries"
mkdir -p "$BINARIES_DIR"

if [ ! -f "$PINS_FILE" ]; then
  echo "error: pins file missing at $PINS_FILE" >&2
  exit 1
fi

URL=$(node -e "
  const j = require('$PINS_FILE');
  const t = j.targets['$TARGET'];
  if (!t) { console.error('unknown target: $TARGET'); process.exit(1); }
  console.log(t.url);
")
ASSET=$(node -e "console.log(require('$PINS_FILE').targets['$TARGET'].asset)")
EXTRACT_PATH=$(node -e "console.log(require('$PINS_FILE').targets['$TARGET'].extract_path)")
EXPECTED_SHA=$(node -e "console.log(require('$PINS_FILE').targets['$TARGET'].sha256)")

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "→ fetching ffmpeg for ${TARGET}"
echo "  url: ${URL}"
curl -sSfL -o "$TMP_DIR/$ASSET" "$URL"

# Refuse to proceed on placeholder SHA or mismatch — a typo or
# upstream-build rotation can't slip in unnoticed.
if [ "$EXPECTED_SHA" = "TODO_FILL_IN" ]; then
  echo "error: ffmpeg-pins.json has placeholder SHA for ${TARGET}." >&2
  exit 3
fi
ACTUAL_SHA=$(shasum -a 256 "$TMP_DIR/$ASSET" | awk '{print $1}')
if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
  echo "error: SHA-256 mismatch for ${ASSET}" >&2
  echo "  expected: $EXPECTED_SHA" >&2
  echo "  actual:   $ACTUAL_SHA" >&2
  echo "  note: BtbN ships LGPL builds at the 'latest' tag which rotates" >&2
  echo "        daily. If this is a CI run weeks after the pin was set," >&2
  echo "        re-fetch the SHA via:" >&2
  echo "          gh api repos/BtbN/FFmpeg-Builds/releases/tags/latest \\" >&2
  echo "            --jq \".assets[] | select(.name == \\\"\$ASSET\\\") | .digest\"" >&2
  exit 4
fi

# Extract by format.
mkdir -p "$TMP_DIR/extract"
case "$ASSET" in
  *.zip)
    unzip -q "$TMP_DIR/$ASSET" -d "$TMP_DIR/extract"
    ;;
  *.tar.xz)
    tar -xJf "$TMP_DIR/$ASSET" -C "$TMP_DIR/extract"
    ;;
  *.tgz|*.tar.gz)
    tar -xzf "$TMP_DIR/$ASSET" -C "$TMP_DIR/extract"
    ;;
  *)
    echo "error: unsupported archive format: $ASSET" >&2
    exit 5
    ;;
esac

SRC="$TMP_DIR/extract/$EXTRACT_PATH"
if [ ! -f "$SRC" ]; then
  echo "error: expected file not found after extraction: $SRC" >&2
  ls -R "$TMP_DIR/extract" >&2
  exit 6
fi

# Drop into binaries/ with the Tauri externalBin filename convention.
if [[ "$TARGET" == *-windows-* ]]; then
  DEST="$BINARIES_DIR/ffmpeg-${TARGET}.exe"
else
  DEST="$BINARIES_DIR/ffmpeg-${TARGET}"
fi
install -m 0755 "$SRC" "$DEST"
echo "→ staged: $DEST ($(du -h "$DEST" | awk '{print $1}'))"
