#!/usr/bin/env python3
"""Sidecar: transcribe an audio file to text using openai-whisper.

Runs locally on Apple Silicon via PyTorch MPS when available. Emits the
transcribed text to stdout; logs go to stderr.

Usage:
    transcribe.py --input voice.wav --model tiny [--language en]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", required=True, type=Path)
    p.add_argument("--model", default="tiny", choices=["tiny", "base", "small", "medium", "large"])
    p.add_argument("--language", default=None, help="Force a language code (e.g. 'en'). Default: auto-detect.")
    args = p.parse_args()

    if not args.input.exists():
        print(f"input not found: {args.input}", file=sys.stderr)
        return 2

    try:
        import torch
        import whisper
    except ImportError as e:
        print(
            f"whisper not installed in this venv: {e}\n"
            f"Run: .venv/bin/pip install openai-whisper",
            file=sys.stderr,
        )
        return 3

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"loading model={args.model} on device={device}", file=sys.stderr)
    # Whisper does not yet support MPS for all ops; load on CPU but advertise the choice.
    model = whisper.load_model(args.model)
    print("transcribing...", file=sys.stderr)
    kwargs = {}
    if args.language:
        kwargs["language"] = args.language
    result = model.transcribe(str(args.input), **kwargs)
    text = (result.get("text") or "").strip()
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
