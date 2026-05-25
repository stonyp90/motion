#!/usr/bin/env python3
"""Sidecar: read a video, write per-frame instance masks + manifest JSON.

Two backends behind a single CLI so the Rust adapter doesn't care:
  --backend yolo  → YOLO11n-seg + BoT-SORT tracker (fast, multi-class,
                    stable track IDs across frames). Default.
  --backend sam2  → SAM 2 Tiny via ultralytics. Slower but task-agnostic;
                    we drive it with a coarse point-prompt grid per frame.

Output layout:
  <out_dir>/
    masks/frame_000123_obj_0007.png   # uint8 binary mask (0/255)
    manifest.json                     # { width, height, frame_rate, frames: [...] }
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import cv2
import numpy as np


@dataclass
class FrameRecord:
    index: int
    masks: list[dict[str, Any]] = field(default_factory=list)


def write_mask_png(mask: np.ndarray, path: Path) -> None:
    if mask.dtype != np.uint8:
        mask = (mask.astype(np.uint8) * 255)
    elif mask.max() <= 1:
        mask = mask * 255
    cv2.imwrite(str(path), mask)


def bbox_from_mask(mask: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.where(mask > 0)
    if ys.size == 0:
        return (0, 0, 0, 0)
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    return (x0, y0, x1 - x0 + 1, y1 - y0 + 1)


def run_yolo(input_video: Path, out_dir: Path, model_name: str) -> dict[str, Any]:
    from ultralytics import YOLO

    model = YOLO(model_name)
    cap = cv2.VideoCapture(str(input_video))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frame_rate = float(cap.get(cv2.CAP_PROP_FPS)) or 30.0
    cap.release()

    masks_dir = out_dir / "masks"
    masks_dir.mkdir(parents=True, exist_ok=True)

    frames: list[FrameRecord] = []
    results = model.track(source=str(input_video), stream=True, persist=True, verbose=False)
    for frame_idx, result in enumerate(results):
        record = FrameRecord(index=frame_idx)
        if result.masks is None or result.boxes is None:
            frames.append(record)
            continue

        ids = result.boxes.id
        if ids is None:
            ids = list(range(len(result.boxes)))
        else:
            ids = [int(x) for x in ids.cpu().tolist()]

        confidences = result.boxes.conf.cpu().tolist() if result.boxes.conf is not None else [1.0] * len(ids)
        classes = result.boxes.cls.cpu().tolist() if result.boxes.cls is not None else [0] * len(ids)
        class_names = result.names

        for k, mask_t in enumerate(result.masks.data):
            mask_np = mask_t.cpu().numpy().astype(np.uint8)
            if mask_np.shape != (height, width):
                mask_np = cv2.resize(mask_np, (width, height), interpolation=cv2.INTER_NEAREST)
            obj_id = ids[k]
            mask_path = masks_dir / f"frame_{frame_idx:06d}_obj_{obj_id:04d}.png"
            write_mask_png(mask_np, mask_path)
            bbox = bbox_from_mask(mask_np)
            record.masks.append({
                "object_id": int(obj_id),
                "bbox": list(bbox),
                "mask_path": str(mask_path.relative_to(out_dir)),
                "confidence": float(confidences[k]),
                "class_name": str(class_names.get(int(classes[k]), "object")) if isinstance(class_names, dict) else "object",
            })
        frames.append(record)

    return {
        "backend": "yolo",
        "model": model_name,
        "width": width,
        "height": height,
        "frame_rate": frame_rate,
        "frames": [{"index": f.index, "masks": f.masks} for f in frames],
    }


def run_sam2(input_video: Path, out_dir: Path, model_name: str, point_grid: int) -> dict[str, Any]:
    from ultralytics import SAM

    model = SAM(model_name)
    cap = cv2.VideoCapture(str(input_video))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frame_rate = float(cap.get(cv2.CAP_PROP_FPS)) or 30.0

    xs = np.linspace(0, width - 1, point_grid, dtype=int)
    ys = np.linspace(0, height - 1, point_grid, dtype=int)
    grid_points = np.array([[x, y] for y in ys for x in xs])

    masks_dir = out_dir / "masks"
    masks_dir.mkdir(parents=True, exist_ok=True)

    frames: list[FrameRecord] = []
    frame_idx = 0
    while True:
        ok, frame_bgr = cap.read()
        if not ok:
            break
        record = FrameRecord(index=frame_idx)
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        result = model.predict(source=frame_rgb, points=grid_points.tolist(), labels=[1] * len(grid_points), verbose=False)[0]
        if result.masks is not None:
            for k, mask_t in enumerate(result.masks.data):
                mask_np = mask_t.cpu().numpy().astype(np.uint8)
                if mask_np.shape != (height, width):
                    mask_np = cv2.resize(mask_np, (width, height), interpolation=cv2.INTER_NEAREST)
                mask_path = masks_dir / f"frame_{frame_idx:06d}_obj_{k:04d}.png"
                write_mask_png(mask_np, mask_path)
                bbox = bbox_from_mask(mask_np)
                record.masks.append({
                    "object_id": int(k),
                    "bbox": list(bbox),
                    "mask_path": str(mask_path.relative_to(out_dir)),
                    "confidence": 1.0,
                    "class_name": "anonymous",
                })
        frames.append(record)
        frame_idx += 1
    cap.release()

    return {
        "backend": "sam2",
        "model": model_name,
        "width": width,
        "height": height,
        "frame_rate": frame_rate,
        "frames": [{"index": f.index, "masks": f.masks} for f in frames],
    }


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", required=True, type=Path, help="Input video file")
    p.add_argument("--out-dir", required=True, type=Path, help="Output directory")
    p.add_argument("--backend", choices=["yolo", "sam2"], default="yolo")
    p.add_argument(
        "--model",
        default=None,
        help="Model name. Defaults to yolo11n-seg.pt (yolo) or sam2.1_t.pt (sam2).",
    )
    p.add_argument("--point-grid", type=int, default=16, help="SAM 2 grid density. Only used when --backend sam2.")
    args = p.parse_args()

    if not args.input.exists():
        print(f"input not found: {args.input}", file=sys.stderr)
        return 2

    args.out_dir.mkdir(parents=True, exist_ok=True)

    if args.backend == "yolo":
        model = args.model or "yolo11n-seg.pt"
        manifest = run_yolo(args.input, args.out_dir, model)
    else:
        model = args.model or "sam2.1_t.pt"
        manifest = run_sam2(args.input, args.out_dir, model, args.point_grid)

    manifest_path = args.out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f"wrote {manifest_path} with {len(manifest['frames'])} frames", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
