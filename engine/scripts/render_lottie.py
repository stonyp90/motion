#!/usr/bin/env python3
"""Sidecar: render a Lottie JSON file to MP4 via the `lottie` Python
package (cairo for rasterization, opencv for video assembly).

Args:
  --input INPUT.json   Lottie JSON file
  --output OUTPUT.mp4  Target video path
  --width / --height   Override composition size (optional)
  --fps                Override frame rate (optional)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from lottie.exporters.video import export_video
from lottie.objects.animation import Animation
from lottie.objects.text import TextDocument

# python-lottie ships with an internal API mismatch: TextDocument stores its
# fill colour on `fill_color`, but lottie/parsers/svg/builder.py:250 reads
# `doc.color`. With any text-bearing Lottie this blows up the raster pipeline
# (and therefore every video/raster export format) with
# `AttributeError: 'TextDocument' object has no attribute 'color'`.
# Alias `color` -> `fill_color` so the SVG path resolves cleanly.
if not hasattr(TextDocument, "color"):
    TextDocument.color = property(lambda self: self.fill_color)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    p.add_argument("--width", type=int, default=None)
    p.add_argument("--height", type=int, default=None)
    p.add_argument("--fps", type=float, default=None)
    args = p.parse_args()

    if not args.input.exists():
        print(f"lottie input not found: {args.input}", file=sys.stderr)
        return 2

    raw = json.loads(args.input.read_text())
    animation = Animation.load(raw)
    if args.width:
        animation.width = args.width
    if args.height:
        animation.height = args.height
    if args.fps:
        animation.frame_rate = args.fps

    args.output.parent.mkdir(parents=True, exist_ok=True)
    export_video(animation, str(args.output))
    print(f"wrote {args.output}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
