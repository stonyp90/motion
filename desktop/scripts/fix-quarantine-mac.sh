#!/usr/bin/env bash
# Strip the macOS quarantine attribute from a downloaded ControlCraft
# build so Gatekeeper stops blocking it.
#
# Background: macOS marks every downloaded file with the
# `com.apple.quarantine` extended attribute. When the file is a .app
# (or a .app extracted from a .dmg), Gatekeeper consults that bit
# before letting the binary run. For Apple-Developer-ID-signed,
# notarised apps Gatekeeper checks the staple and lets them through;
# unsigned or ad-hoc-signed binaries get the "Apple cannot verify…"
# wall.
#
# Stripping the quarantine bit is the documented Apple-sanctioned
# bypass — it's exactly what `right-click → Open` does under the hood,
# but it works on .dmg / .pkg downloads BEFORE you mount them, which
# the right-click path doesn't.
#
# Usage:
#   ./scripts/fix-quarantine-mac.sh                     # auto-detects ControlCraft.app
#   ./scripts/fix-quarantine-mac.sh ~/Downloads/foo.dmg # explicit path
#
# Safe to run multiple times.

set -euo pipefail

TARGET="${1:-}"

if [ -z "$TARGET" ]; then
  # Try the standard Applications path first, then ~/Downloads/.
  for candidate in \
    "/Applications/ControlCraft.app" \
    "$HOME/Applications/ControlCraft.app" \
    "$HOME/Downloads/ControlCraft.app" \
    "$HOME/Downloads/ControlCraft.dmg" \
    "$HOME/Downloads/ControlCraft"*.dmg \
    "$HOME/Downloads/ControlCraft"*.app; do
    if [ -e "$candidate" ]; then
      TARGET="$candidate"
      break
    fi
  done
fi

if [ -z "$TARGET" ] || [ ! -e "$TARGET" ]; then
  echo "error: ControlCraft installer not found." >&2
  echo "       Pass the path explicitly: $0 /path/to/ControlCraft.app" >&2
  exit 1
fi

echo "→ stripping quarantine from: $TARGET"
xattr -dr com.apple.quarantine "$TARGET"
echo "✓ done."

if [[ "$TARGET" == *.app ]]; then
  echo
  echo "Open with: open \"$TARGET\""
elif [[ "$TARGET" == *.dmg ]]; then
  echo
  echo "Mount with: open \"$TARGET\"  (then drag ControlCraft.app to /Applications)"
fi
