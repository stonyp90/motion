#!/usr/bin/env python3
"""Sidecar: scene-split + sprite decomposition for the decompose crate.

Two operations packaged in one script (different --op):

  --op scenes    Detect shot boundaries using PySceneDetect's
                 ContentDetector. Writes boundaries.json:
                 { width, height, frame_rate, boundaries: [...] }

  --op sprites   Extract per-object sprite atlases + per-frame affine
                 transforms from an existing segmentation manifest.
                 Writes sprites.json + atlases/*.png.

Why combine: same venv, same I/O contract, single sidecar process is
faster than two for short clips.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import cv2
import numpy as np


def detect_scenes(video_path: Path, threshold: float) -> dict[str, Any]:
    from scenedetect import detect, ContentDetector

    scene_list = detect(str(video_path), ContentDetector(threshold=threshold))

    cap = cv2.VideoCapture(str(video_path))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frame_rate = float(cap.get(cv2.CAP_PROP_FPS)) or 30.0
    cap.release()

    boundaries = []
    for i, (start, end) in enumerate(scene_list):
        boundaries.append({
            "shot_index": i,
            "start_frame": int(start.frame_num),
            "end_frame": int(end.frame_num),
            "start_seconds": float(start.get_seconds()),
            "end_seconds": float(end.get_seconds()),
        })

    return {
        "width": width,
        "height": height,
        "frame_rate": frame_rate,
        "boundaries": boundaries,
    }


def extract_sprites(video_path: Path, seg_manifest_path: Path, out_dir: Path) -> dict[str, Any]:
    """Read frames + segmentation masks; for each tracked object_id, build
    an RGBA atlas (the bbox crop of the first frame it appears in) plus a
    per-frame affine track. This is a deliberately simple decomposition
    that mirrors the Fast Sprite Decomposition output shape; the adapter
    can be swapped without changing the schema."""
    seg = json.loads(seg_manifest_path.read_text())
    seg_work_dir = seg_manifest_path.parent

    cap = cv2.VideoCapture(str(video_path))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frame_rate = float(cap.get(cv2.CAP_PROP_FPS)) or 30.0

    sprites: dict[int, dict[str, Any]] = {}
    tracks: dict[int, list[dict[str, Any]]] = defaultdict(list)

    atlases_dir = out_dir / "atlases"
    atlases_dir.mkdir(parents=True, exist_ok=True)

    seg_by_idx = {f["index"]: f for f in seg["frames"]}

    frame_idx = 0
    while True:
        ok, frame_bgr = cap.read()
        if not ok:
            break
        frame_record = seg_by_idx.get(frame_idx)
        if frame_record:
            for m in frame_record["masks"]:
                obj_id = int(m["object_id"])
                x, y, w, h = m["bbox"]
                if w <= 0 or h <= 0:
                    continue

                if obj_id not in sprites:
                    mask_path = seg_work_dir / m["mask_path"]
                    mask = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
                    if mask is None:
                        continue
                    rgba = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2BGRA)
                    rgba[..., 3] = mask
                    atlas = rgba[y:y + h, x:x + w]
                    atlas_path = atlases_dir / f"obj_{obj_id:06d}.png"
                    cv2.imwrite(str(atlas_path), atlas)
                    sprites[obj_id] = {
                        "object_id": obj_id,
                        "atlas_path": str(atlas_path.relative_to(out_dir)),
                        "atlas_width": int(w),
                        "atlas_height": int(h),
                        "anchor": [int(x), int(y)],
                        "class_name": m.get("class_name", "object"),
                    }

                origin = sprites[obj_id]["anchor"]
                aw = sprites[obj_id]["atlas_width"]
                ah = sprites[obj_id]["atlas_height"]
                tracks[obj_id].append({
                    "frame_index": frame_idx,
                    "tx": float(x - origin[0]),
                    "ty": float(y - origin[1]),
                    "sx": float(w / aw) if aw else 1.0,
                    "sy": float(h / ah) if ah else 1.0,
                    "rotation_deg": 0.0,
                })
        frame_idx += 1
    cap.release()

    sprite_records = []
    for obj_id, sprite in sprites.items():
        sprite["track"] = tracks[obj_id]
        sprite_records.append(sprite)
    sprite_records.sort(key=lambda s: s["object_id"])

    return {
        "width": width,
        "height": height,
        "frame_rate": frame_rate,
        "sprite_count": len(sprite_records),
        "sprites": sprite_records,
    }


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--op", choices=["scenes", "sprites"], required=True)
    p.add_argument("--input", required=True, type=Path, help="Input video")
    p.add_argument("--out-dir", required=True, type=Path, help="Output directory")
    p.add_argument("--seg-manifest", type=Path, default=None, help="Required for --op sprites")
    p.add_argument("--threshold", type=float, default=27.0, help="ContentDetector threshold (scenes)")
    args = p.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)

    if args.op == "scenes":
        manifest = detect_scenes(args.input, args.threshold)
        path = args.out_dir / "boundaries.json"
        path.write_text(json.dumps(manifest, indent=2))
        print(f"wrote {path} with {len(manifest['boundaries'])} shots", file=sys.stderr)
    else:
        if args.seg_manifest is None:
            print("--seg-manifest is required for --op sprites", file=sys.stderr)
            return 2
        manifest = extract_sprites(args.input, args.seg_manifest, args.out_dir)
        path = args.out_dir / "sprites.json"
        path.write_text(json.dumps(manifest, indent=2))
        print(f"wrote {path} with {manifest['sprite_count']} sprites", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
