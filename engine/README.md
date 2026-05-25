# motion-forge

Local-first Rust pipeline that segments every frame of a motion-design
reference video and re-animates it from a text prompt (or voice note,
or theme preset). Iteration is sub-30s once the reference has been
processed — the LLM round-trip and Lottie write are the only steps
that re-run when you tweak a prompt.

## Why

You hand it a reference clip + an intent ("punchy product reveal in
playful style, 15 seconds") and you get back:

- a **Lottie JSON** timeline you can edit in any Lottie tool, and
- a **rendered MP4** at the composition you asked for.

Backends are agnostic. Local-first by default:

- **LLM** — Ollama (default) → LM Studio → Anthropic → OpenAI → Mock fallback
- **Segmentation** — Python sidecar with `ultralytics` (YOLO11n-seg + tracker, or SAM 2 Tiny)
- **Video I/O** — FFmpeg via the `ffmpeg-sidecar` adapter (zero-copy `rsmpeg` slot reserved)
- **Whisper** — local PyTorch (MPS-enabled on Apple Silicon)

Every adapter is swappable — the architecture is hexagonal (port / adapter per crate).

## Architecture

```
crates/
  video-io/             port: Decoder, Encoder        adapter: ffmpeg-sidecar (default), rsmpeg (reserved)
  segment/              port: Segmenter               adapter: python_sidecar (YOLO + SAM 2), sam2_adapter (reserved)
  decompose/            port: SceneSplitter, SpriteDecomposer
                                                      adapter: python_sidecar (PySceneDetect + bbox crop)
  style-extract/        port: StyleExtractor          adapter: Oklab palette + motion-curve fitting
                        + Theme presets (corporate / playful / tech-reveal / minimalist / explainer)
  prompt-orchestrator/  port: LlmBackend              adapter: Ollama, LMStudio, Anthropic, OpenAI, Mock
  lottie-gen/           Lottie JSON writer (Rect, Ellipse, Text placeholders)
  render/               port: Renderer                adapter: python_sidecar (`lottie` package)
  pipeline/             end-to-end DAG (generate / iterate)
  http/                 axum HTTP server + hand-written OpenAPI 3.1 spec
  cli/                  clap entry point
```

## Pipeline

```
reference.mp4 ──▶ segment ──▶ scenes  ──▶ sprites ──▶ style.json ─┐
                                                                  │
                          prompt ──▶ orchestrator ◄── theme.json ─┤
                            duration ──┤                          │
                                       ▼                          ▼
                                Lottie timeline ──▶ out.lottie.json
                                                     │
                                                     ▼
                                                  out.mp4
```

A successful `generate` persists every intermediate under `--work-dir`.
`iterate` reuses that work-dir and only re-runs the prompt step — no
re-segmentation, no re-decomposition.

## CLI

```text
motion-forge transcode <in> <out>                   # Phase 1: round-trip fidelity (SSIM)
motion-forge segment <in> --out <dir>               # Phase 2: per-frame masks
motion-forge decompose <in> --out <dir>             # Phase 3: scenes + sprites
motion-forge style-card <in> --out <style.json>     # Phase 4: style descriptor

motion-forge generate                               # Phases 2-6 from a reference video
    --reference <video>
    --prompt <str>
    [--theme <slug|path>]                           # corporate, playful, tech-reveal, ...
    [--duration <secs>]
    [--width <px>] [--height <px>] [--fps <num>]
    [--work-dir <dir>]
    --out <out.lottie.json>
    [--out-video <out.mp4>]

motion-forge iterate                                # Fast re-prompt against a cached work-dir
    --work-dir <dir>
    --prompt <str>
    [--theme <slug|path>] [--duration ...] [--width / --height / --fps ...]
    --out <out.lottie.json>
    [--out-video <out.mp4>]

motion-forge render <in.lottie> <out.mp4>           # Phase 6 standalone
motion-forge pipeline ...                           # generate + always-render MP4
motion-forge transcribe <audio> [--model tiny]      # Whisper voice → text on stdout
motion-forge themes                                 # List bundled themes
motion-forge serve [--bind 127.0.0.1:7755]          # HTTP + OpenAPI surface
```

### Adobe-style iteration

```bash
# 1. First run: heavy, ~2 min on a 2-second 640x360 fixture.
motion-forge generate \
    --reference fixtures/sample.mp4 \
    --prompt "Pulsing emerald square with HELLO outro" \
    --theme corporate \
    --duration 12 \
    --work-dir /tmp/mf/work \
    --out /tmp/mf/v1.lottie.json \
    --out-video /tmp/mf/v1.mp4

# 2. Iterate by voice — Whisper writes text to stdout.
motion-forge transcribe note.wav --model tiny > /tmp/note.txt

# 3. Re-prompt in <30s — segmentation is reused from the work-dir.
motion-forge iterate \
    --work-dir /tmp/mf/work \
    --prompt "$(cat /tmp/note.txt)" \
    --theme playful \
    --duration 8 \
    --out /tmp/mf/v2.lottie.json \
    --out-video /tmp/mf/v2.mp4
```

## HTTP surface

`motion-forge serve` exposes the same operations as JSON endpoints:

```
GET  /healthz
GET  /openapi.json        OpenAPI 3.1 schema
GET  /themes              [{ slug, name, description, default_duration_seconds, ... }]
POST /generate            { reference_video, prompt, theme?, duration_seconds?, ... }
POST /iterate             { work_dir, prompt, theme?, duration_seconds?, ... }
```

The OpenAPI spec is hand-written to keep the dep tree small; the
schemas mirror the Rust request/response structs in `crates/http/src/lib.rs`.

## Local infrastructure

```bash
docker compose up    # FFmpeg builder, Postgres (job state), static model server
```

Python sidecars (SAM 2, scene split, lottie render, Whisper) live in
the workspace `.venv/`:

```bash
./scripts/setup-python.sh
```

## CI

`.github/workflows/ci.yml` gates merges on:

- `cargo fmt --all --check`
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`
- `cargo test --workspace --all-features`

Verification fixtures live under `fixtures/` (small enough for git).

## Status

| Phase | Status | Notes |
|-------|--------|-------|
| 0     | ✅     | Workspace skeleton |
| 1     | ✅     | ffmpeg-sidecar round-trip — SSIM ≥ 0.99 gate hit |
| 2     | ✅     | YOLO11n-seg / SAM 2 via Python sidecar |
| 3     | ✅     | PySceneDetect + bbox-crop sprites |
| 4     | ✅     | Oklab palette + easing + rhythm — pure Rust |
| 5     | ✅     | Local-first LLM (Ollama default) with deterministic fallback |
| 6     | ✅     | Python `lottie` package → MP4 |
| 7     | ✅     | End-to-end `Pipeline::run_full` + `run_iterate` + axum HTTP + OpenAPI |
