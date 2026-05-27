#!/usr/bin/env bash
# Re-render every platform-specific desktop icon from the single
# source SVG. Outputs land alongside the source in
# `desktop/src-tauri/icons/`. Idempotent — safe to re-run after any
# edit to `source.svg`.
#
# Produces:
#   · icon.png            — 1024×1024 master PNG
#   · 32x32.png           — Linux launcher
#   · 64x64.png           — Linux launcher
#   · 128x128.png         — Linux launcher
#   · 128x128@2x.png      — macOS Retina launcher (256×256)
#   · icon.icns           — macOS multi-resolution bundle (via iconutil)
#   · icon.ico            — Windows multi-resolution bundle (via magick)
#   · Square{30,44,71,89,107,142,150,284,310}x{...}Logo.png — UWP tiles
#   · StoreLogo.png       — Microsoft Store entry tile (50×50)
#
# Requirements (Homebrew on macOS):
#   brew install librsvg imagemagick
#   iconutil ships with Xcode command-line tools.
#
# Wire it into a build step? Don't. Icon regeneration is a manual,
# deliberate act — tying it to `cargo build` would silently overwrite
# in-progress design work. Re-run by hand after editing source.svg.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ICONS_DIR="$(cd "$SCRIPT_DIR/../src-tauri/icons" && pwd)"
SOURCE="$ICONS_DIR/source.svg"

if [[ ! -f "$SOURCE" ]]; then
  echo "[generate-icons] source missing: $SOURCE" >&2
  exit 2
fi

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[generate-icons] required tool '$1' not on PATH ($2)" >&2
    exit 3
  fi
}
require rsvg-convert "brew install librsvg"
require magick "brew install imagemagick"
require iconutil "Xcode command line tools (xcode-select --install)"

WORK="$(mktemp -d -t controlcraft-icons.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

render() {
  local size="$1"
  local out="$2"
  rsvg-convert -w "$size" -h "$size" "$SOURCE" -o "$out"
}

echo "[generate-icons] source: $SOURCE"
echo "[generate-icons] work:   $WORK"

# ─── Linux / generic PNGs ───────────────────────────────────────────
render 32   "$ICONS_DIR/32x32.png"
render 64   "$ICONS_DIR/64x64.png"
render 128  "$ICONS_DIR/128x128.png"
render 256  "$ICONS_DIR/128x128@2x.png"
render 1024 "$ICONS_DIR/icon.png"
echo "[generate-icons] wrote Linux/generic PNGs"

# ─── Windows Store / UWP tiles ──────────────────────────────────────
declare -a TILES=(
  "30:Square30x30Logo.png"
  "44:Square44x44Logo.png"
  "50:StoreLogo.png"
  "71:Square71x71Logo.png"
  "89:Square89x89Logo.png"
  "107:Square107x107Logo.png"
  "142:Square142x142Logo.png"
  "150:Square150x150Logo.png"
  "284:Square284x284Logo.png"
  "310:Square310x310Logo.png"
)
for entry in "${TILES[@]}"; do
  size="${entry%%:*}"
  name="${entry##*:}"
  render "$size" "$ICONS_DIR/$name"
done
echo "[generate-icons] wrote UWP tile PNGs"

# ─── macOS icon.icns ────────────────────────────────────────────────
# iconutil requires an `.iconset` directory with a specific naming
# convention: icon_<size>x<size>.png and icon_<size>x<size>@2x.png.
ICONSET="$WORK/AppIcon.iconset"
mkdir -p "$ICONSET"
render 16   "$ICONSET/icon_16x16.png"
render 32   "$ICONSET/icon_16x16@2x.png"
render 32   "$ICONSET/icon_32x32.png"
render 64   "$ICONSET/icon_32x32@2x.png"
render 128  "$ICONSET/icon_128x128.png"
render 256  "$ICONSET/icon_128x128@2x.png"
render 256  "$ICONSET/icon_256x256.png"
render 512  "$ICONSET/icon_256x256@2x.png"
render 512  "$ICONSET/icon_512x512.png"
render 1024 "$ICONSET/icon_512x512@2x.png"
iconutil --convert icns --output "$ICONS_DIR/icon.icns" "$ICONSET"
echo "[generate-icons] wrote icon.icns ($(du -k "$ICONS_DIR/icon.icns" | awk '{print $1}') KB)"

# ─── Windows icon.ico ───────────────────────────────────────────────
# Pack 16/32/48/64/128/256 into a single .ico — explorer + taskbar
# both consume from the same file at different sizes.
WIN_TMP="$WORK/ico"
mkdir -p "$WIN_TMP"
for s in 16 32 48 64 128 256; do
  render "$s" "$WIN_TMP/$s.png"
done
magick \
  "$WIN_TMP/16.png" "$WIN_TMP/32.png" "$WIN_TMP/48.png" \
  "$WIN_TMP/64.png" "$WIN_TMP/128.png" "$WIN_TMP/256.png" \
  "$ICONS_DIR/icon.ico"
echo "[generate-icons] wrote icon.ico ($(du -k "$ICONS_DIR/icon.ico" | awk '{print $1}') KB)"

echo "[generate-icons] done."
