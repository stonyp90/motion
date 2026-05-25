# motion-forge

A B2B explainer-video factory. Hand it a brief, a cast of characters, and a brand identity. Get back a broadcast-ready 60-second motion graphic as Lottie JSON, a render-grade MP4, and a per-scene asset pack. Iteration is sub-second once the first generation lands. Self-host the engine on Azure or run it on a laptop with `docker-compose up`.

> Live demo: `https://motion-forge.io` *(placeholder — fill in once `motion.ursly.io` is fronting the production stack)*.

---

## Why motion-forge

| You are evaluating | What that costs today | What motion-forge changes |
| --- | --- | --- |
| **An agency** | 4–8 weeks per 60-second deliverable; USD 8k–25k per video; rev-cycle is email + a deck. | First cut ships in under 90 seconds. Each iteration round-trips in under a second. You own the timeline JSON forever. |
| **An in-house motion designer** | One person, one render queue, a backlog measured in months. Hiring a second takes a quarter. | The designer becomes the brief-author and the QA. The factory is the production line — they handle the volume the designer cannot. |
| **A Lottie-only template store** | Pretty animations, generic characters, no brand fidelity, no voiceover wiring, no MP4 export. | Brand palette + font + logo are first-class. Voice dictation pipes through a streaming Whisper sidecar into a structured brief. Output ships as Lottie *and* MP4 *and* a per-scene web-export pack (SVG/CSS/GSAP/Motion/Theatre/Framer). |
| **A bespoke generative-video stack** | Hours per render, opaque diffusion latents, no editability. | Deterministic shape-based timeline. Every layer is named, every keyframe is editable in any Lottie tool, and the JSON round-trips losslessly back into the engine for re-render. |

motion-forge is **not** an LLM video generator. It is a deterministic motion-design pipeline whose orchestration step happens to be LLM-driven. That distinction is why iteration is fast and why your output is editable instead of regenerated.

---

## Quick start

Three commands. No accounts, no API keys, no GPU required for the first run (it falls back to a CPU-only sidecar).

```bash
# 1. Bring up Postgres, Redis, MinIO, Keycloak, Ollama
docker compose up -d

# 2. Start the web app on http://localhost:3001
cd web && npm install && npm run dev

# 3. Open the browser
open http://localhost:3001
```

The first visit redirects you through Keycloak (`http://localhost:8080`, realm `motion-forge`, seeded user `demo / demo`). You land on the single-screen studio: prompt on the left, cast picker in the middle, live preview on the right. Type a brief, pick three characters, hit **Generate**. First render takes ~90 s on a laptop; each subsequent iterate is sub-second.

For the Rust engine standalone (no web):

```bash
cd engine
./scripts/setup-python.sh             # Whisper + lottie sidecars in .venv
./scripts/fetch-whisper-model.sh tiny # ~75 MB
cargo run --release --bin motion-forge -- serve --bind 127.0.0.1:7755
```

`http://127.0.0.1:7755/openapi.json` is the live OpenAPI 3.1 surface. `http://127.0.0.1:7755/healthz` is the liveness probe.

---

## Architecture in one picture

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│   Browser  ──▶  Next.js 15 (App Router)  ──▶  Keycloak (OIDC)        │
│                          │                                           │
│                          │  POST /generate, /iterate, /transcribe    │
│                          │  Bearer <JWT issued by Keycloak>          │
│                          ▼                                           │
│              ┌─────────────────────────────────┐                     │
│              │  engine/crates/http  (axum)     │                     │
│              │  JWT verify (JWKS-cached)       │                     │
│              │  Per-tenant rate limit (Redis)  │                     │
│              └────────────────┬────────────────┘                     │
│                               │                                      │
│             ┌─────────────────┼────────────────┐                     │
│             ▼                 ▼                ▼                     │
│      pipeline DAG       prompt-orchestrator   stt                    │
│      (run_full /        (Ollama / Azure       (streaming Whisper)    │
│       run_iterate)       OpenAI / Anthropic)                         │
│             │                                                        │
│             ▼                                                        │
│      ┌──────────────────────────────────────────────┐                │
│      │  Renderers and exporters                     │                │
│      │  lottie-gen  ──▶  render  ──▶  out.mp4       │                │
│      │  ingest     ◀──  user uploads (.lottie,      │                │
│      │                  .json, .riv, .skel, .mogrt) │                │
│      │  characters  ──▶ cast library + brand recolour│               │
│      │  figma       ──▶ frame pull / push           │                │
│      │  web-export  ──▶ SVG / CSS / GSAP / Motion / │                │
│      │                  Theatre.js / Framer         │                │
│      └──────────────────────────────────────────────┘                │
│             │                                                        │
│             ▼                                                        │
│      Blob (workdirs, outputs)  +  Cosmos (project metadata)  +       │
│      Redis (queues, idempotency, rate limit)                         │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

For the long-form version, see [`ARCHITECTURE.md`](./ARCHITECTURE.md). Mermaid renderings live under [`docs/architecture/`](./docs/architecture/).

---

## Feature matrix

### Inputs

| Format | Source | Status |
| --- | --- | --- |
| Free-form text brief | textarea | shipping |
| Structured script (scene / line / SFX) | paste or upload `.json` | shipping |
| Voice dictation | browser mic → streaming Whisper | shipping (English; multilingual on roadmap) |
| Reference video | `.mp4` / `.mov` | shipping (frame-segment + style-extract) |
| Lottie / Bodymovin / DotLottie | upload | shipping via `ingest` crate |
| Rive | `.riv` upload | shipping (state-machine flattened to Lottie) |
| DragonBones | `.skel + .png` | beta |
| MoGRT (Premiere graphics templates) | upload | beta |
| Figma frame | OAuth + frame URL | shipping via `figma` crate |

### Outputs

| Format | Channel | Status |
| --- | --- | --- |
| Lottie JSON (Bodymovin v5.12) | download / API | shipping |
| MP4 (H.264, configurable bitrate) | download / Blob | shipping |
| Per-scene PNG sequence | download | shipping |
| SVG + CSS animations | `web-export` | shipping |
| GSAP timeline | `web-export` | shipping |
| Motion (`motion.dev`) timeline | `web-export` | shipping |
| Theatre.js project | `web-export` | beta |
| Framer Motion component | `web-export` | beta |
| WebM (VP9) | `render` | roadmap |
| ProRes (broadcast) | `render` | roadmap |

### Characters

| Source | Volume | Notes |
| --- | --- | --- |
| Built-in cast library | ~120 characters across 8 art styles | every character is rigged in Lottie; brand-recolour is one HSL pass |
| User uploads | unlimited | accepts the same set of formats as the inputs table; auto-trims, auto-rigs simple shapes, falls back to static cutouts for complex art |
| Brand logos | unlimited | SVG preferred; raster auto-vectorised through `style-extract` when needed |

### Brand identity

| Token | Where it ships | Editable in studio |
| --- | --- | --- |
| Palette (primary / secondary / accent / neutral 1–5) | every layer fill, character recolour, background | yes |
| Font (Google Fonts + self-host) | every text layer | yes |
| Logo (with safe-zone) | bumper, lower-third, end card | yes |
| Voice style (LLM tone) | every generated copy line | yes |

### SSO

| Provider | Status |
| --- | --- |
| Keycloak (self-hosted realm `motion-forge`) | shipping; roles `owner` / `member` / `viewer` |
| Microsoft Entra (federated through Keycloak) | shipping |
| Google Workspace (federated through Keycloak) | shipping |
| Okta / OneLogin (SAML through Keycloak) | shipping |

---

## Roadmap

### Now (v0.1.x)

- ACA + Front Door deploy stabilised on `motion.ursly.io`
- Streaming Whisper sidecar GA across all browser languages
- Cast library v1 (120 characters, 8 styles)
- Figma frame round-trip GA

### Next (v0.2)

- Multi-tenant: project + workspace + per-tenant rate limiting
- Render-farm autoscaling: KEDA-triggered ACA Jobs for MP4 jobs over 60 s
- WebM + ProRes output formats
- Per-scene voiceover with ElevenLabs (BYO key) and Azure Neural TTS

### Later (v0.3+)

- Frame-by-frame timeline editor (parity with After Effects basics)
- "Brand snapshot": one-click brand extraction from a marketing site
- Plugin SDK (TypeScript) so customers can ship their own exporters
- Per-customer fine-tuned orchestrator (LoRA over the prompt → Lottie schema)

---

## License and contributing

Apache-2.0. Vendor it, ship it, fork it.

Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before you open a PR. Security disclosures: [`SECURITY.md`](./SECURITY.md). Architecture deep-dive: [`ARCHITECTURE.md`](./ARCHITECTURE.md). Threat model: [`THREAT_MODEL.md`](./THREAT_MODEL.md).
