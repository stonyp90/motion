#!/usr/bin/env bash
# Fetch the pinned Ollama release for a given Rust target triple and
# stage the binary inside desktop/src-tauri/binaries/ under the name
# Tauri's `externalBin` resolution expects:
#
#   ollama-<target-triple>(.exe?)
#
# Tauri co-signs every externalBin under the Mach-O / PE / ELF rules
# for the matrix leg's platform, so we deliberately drop the binary
# next to motion-forge-<target>, NOT the canonical `ollama` name.
#
# Usage:
#   desktop/scripts/fetch-ollama.sh <target-triple>
#
# Examples:
#   ./fetch-ollama.sh aarch64-apple-darwin
#   ./fetch-ollama.sh x86_64-pc-windows-msvc
#
# Reads:  desktop/ollama-pins.json
# Writes: desktop/src-tauri/binaries/ollama-<target>(.exe)
#
# Network-only; no Rust toolchain dependency. CI step calls this once
# per matrix leg before `npx tauri build`.

set -euo pipefail

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "usage: $0 <rust-target-triple>" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
PINS_FILE="$DESKTOP_DIR/ollama-pins.json"
BINARIES_DIR="$DESKTOP_DIR/src-tauri/binaries"
mkdir -p "$BINARIES_DIR"

if [ ! -f "$PINS_FILE" ]; then
  echo "error: pins file missing at $PINS_FILE" >&2
  exit 1
fi

# Pipe the file in via stdin so we don't pass a path argument to
# node's require(). On Windows runners (Git Bash) the POSIX-style
# `$PINS_FILE` ("/d/a/motion/...") gets handed to Node which expects a
# Windows path; require() errors with `Cannot find module`.
# Reading from fd 0 sidesteps the whole conversion dance.
PINS_JSON=$(cat "$PINS_FILE")
OLLAMA_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).version)" <<< "$PINS_JSON")
ASSET=$(node -e "
  const j = JSON.parse(require('fs').readFileSync(0,'utf8'));
  const t = j.targets['$TARGET'];
  if (!t) { console.error('unknown target: $TARGET'); process.exit(1); }
  console.log(t.asset);
" <<< "$PINS_JSON")
EXTRACT_PATH=$(node -e "
  const j = JSON.parse(require('fs').readFileSync(0,'utf8'));
  console.log(j.targets['$TARGET'].extract_path);
" <<< "$PINS_JSON")
EXPECTED_SHA=$(node -e "
  const j = JSON.parse(require('fs').readFileSync(0,'utf8'));
  console.log(j.targets['$TARGET'].sha256);
" <<< "$PINS_JSON")

URL="https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}/${ASSET}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "→ fetching Ollama v${OLLAMA_VERSION} for ${TARGET}"
echo "  asset: ${ASSET}"
echo "  url:   ${URL}"
curl -sSfL -o "$TMP_DIR/$ASSET" "$URL"

# SHA verification — `TODO_FILL_IN_FROM_OLLAMA_RELEASE_PAGE` is the
# placeholder for the first time the pins file is edited. We refuse to
# proceed without a real hash so a typo or registry compromise can't
# slip in unnoticed.
if [ "$EXPECTED_SHA" = "TODO_FILL_IN_FROM_OLLAMA_RELEASE_PAGE" ]; then
  echo "error: ollama-pins.json has placeholder SHA for ${TARGET}." >&2
  echo "       Fetch the real hash from https://github.com/ollama/ollama/releases/tag/v${OLLAMA_VERSION}/" >&2
  echo "       and commit it before this script can pass." >&2
  exit 3
fi
# Cross-OS sha256: macOS + most Linux ship `shasum -a 256`; Windows
# Git Bash on GitHub Actions runners does NOT (no Perl), but it does
# ship openssl. Pick whichever is available.
if command -v shasum >/dev/null 2>&1; then
  ACTUAL_SHA=$(shasum -a 256 "$TMP_DIR/$ASSET" | awk '{print $1}')
else
  ACTUAL_SHA=$(openssl dgst -sha256 "$TMP_DIR/$ASSET" | awk '{print $NF}')
fi
if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
  echo "error: SHA-256 mismatch for ${ASSET}" >&2
  echo "  expected: $EXPECTED_SHA" >&2
  echo "  actual:   $ACTUAL_SHA" >&2
  exit 4
fi

# Extract by format.
case "$ASSET" in
  *.zip)
    unzip -q "$TMP_DIR/$ASSET" -d "$TMP_DIR/extract"
    ;;
  *.tgz|*.tar.gz)
    mkdir -p "$TMP_DIR/extract"
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
  DEST="$BINARIES_DIR/ollama-${TARGET}.exe"
else
  DEST="$BINARIES_DIR/ollama-${TARGET}"
fi
install -m 0755 "$SRC" "$DEST"
echo "→ staged: $DEST ($(du -h "$DEST" | awk '{print $1}'))"
