# motion

Monorepo for **motion** — the motion-design engine and the marketing /
in-browser studio that wraps it.

> License the engine instead of paying per video.
> 90 seconds from brand pack to broadcast. Sub-second iteration thereafter.

```
motion/
├── engine/   Rust workspace + Python sidecars: the CLI, axum API, the
│             Lottie writer, the FFmpeg / SAM 2 / YOLO sidecars, Bicep
│             infra for Azure, and the docker images.
└── web/      Next.js 15 marketing site + /studio in-browser editor.
              Ships an interactive Lottie player that mutates JSON
              client-side — zero server round-trip per edit.
```

## Two pieces, one product

```
                  ┌──────────────────────────────────────┐
                  │  web/  (Next.js 15 + Tailwind)       │
                  │                                      │
                  │  /              Marketing site       │
                  │  /studio        Edge editor          │
                  │  /pricing,/faq  one-page anchors     │
                  │                                      │
                  │  Self-contained Lottie demo files    │
                  │  shipped from /public/lottie/        │
                  └──────────────┬───────────────────────┘
                                 │
                                 │  POST /generate, /iterate
                                 │  (only on real renders)
                                 ▼
                  ┌──────────────────────────────────────┐
                  │  engine/  (Rust workspace + Python)  │
                  │                                      │
                  │  CLI: motion-forge {generate,        │
                  │       iterate, panelize, render,     │
                  │       transcribe, serve, themes}     │
                  │                                      │
                  │  HTTP: axum at /generate, /iterate,  │
                  │        /themes, /healthz,            │
                  │        /openapi.json                 │
                  │                                      │
                  │  Sidecars: ultralytics (SAM 2/YOLO), │
                  │  PySceneDetect, lottie py, Whisper   │
                  │                                      │
                  │  Infra: Bicep for Azure              │
                  │  (ACA Workload Profiles + Front      │
                  │   Door + Cosmos + Blob + ACR)        │
                  └──────────────────────────────────────┘
```

## Quickstart

### Engine
```bash
cd engine

# build the Rust workspace
cargo build --release

# Python sidecars (SAM 2, scene detection, Lottie rasterizer, Whisper)
./scripts/setup-python.sh

# end-to-end on the bundled fixture (~90s on a 2s reference clip)
./target/release/motion-forge generate \
    --reference fixtures/sample.mp4 \
    --prompt "Pulsing brand intro with HELLO outro" \
    --theme corporate --duration 12 \
    --work-dir /tmp/mf-work \
    --out /tmp/mf-out.lottie.json \
    --out-video /tmp/mf-out.mp4

# panelize a directory of illustrations into a Lottie + MP4
./target/release/motion-forge panelize \
    --dir illustrations/ \
    --theme corporate --headline "My Brand" \
    --out /tmp/brand.lottie.json --out-video /tmp/brand.mp4

# fast iteration against the cached work-dir (~150 ms when fallback fires)
./target/release/motion-forge iterate \
    --work-dir /tmp/mf-work --prompt "Bouncier, playful version" \
    --theme playful --duration 6 --out /tmp/mf-v2.lottie.json

# HTTP server with OpenAPI 3.1
./target/release/motion-forge serve --bind 127.0.0.1:7755
```

### Web
```bash
cd web
npm install
npm run dev          # http://localhost:3001
npm run build && npm run start
```

The marketing site embeds a demo MP4 from `web/public/demos/chrono.mp4`
which is **gitignored** because of size — regenerate locally with:

```bash
cd engine
./target/release/motion-forge panelize \
    --dir <illustrations_dir> --theme corporate \
    --headline "Chrono Innovation" \
    --out /tmp/chrono.lottie.json --out-video ../web/public/demos/chrono.mp4
```

## What's deployed today

`engine/infra/` is single-file Bicep that brings up a complete
production stack on Azure with one command:

```bash
cd engine/infra
./deploy.sh --env dev --location eastus
```

Cost-effective, performance-effective, no-cold-start architecture:
Front Door at the edge, Container Apps with min_replicas=1 for the API
(no cold start on iterate), KEDA-triggered ACA Jobs for the heavy
SAM 2 / render workloads (scale to zero), Cosmos serverless, Redis
basic, Azure OpenAI for the LLM. All service-to-service auth via
User-Assigned Managed Identity.

Three `enable*` Bicep params (`enableOpenAi`, `enableGpuProfile`,
`enableCosmos`, `enableNfsModelMount`) make the same template deployable
on a personal sub without those Azure quotas approved.

## CI/CD

Three workflows under `.github/workflows/`:

| Workflow | Trigger | What it does |
|---|---|---|
| `engine-ci.yml` | push to main, PR | `cargo fmt --check` + `cargo clippy -D warnings` + `cargo test` + release build |
| `web-ci.yml` | push to main, PR | `npm install` + `npm run lint` + `npm run type-check` + `npm run build` |
| `azure-deploy.yml` | manual + push to main (engine paths) | OIDC-federated `az` login, `az acr build` + `az deployment group create` against `engine/infra/main.bicep`, prints Front Door URL |

OIDC: no client secrets in the repo. Set three secrets on the repo:
`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` — bound
to a federated credential on the user-assigned Managed Identity in your
target subscription. See [Azure docs](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect).

## Status

| Piece | Status |
|---|---|
| Rust engine (Phases 0–7) | ✅ shipping |
| Themes (corporate / playful / tech-reveal / minimalist / explainer) | ✅ |
| Iteration controls (--theme / --duration / --width / --height / --fps) | ✅ |
| `iterate` fast path with composition precedence | ✅ |
| `panelize` illustration sequencer | ✅ |
| `transcribe` Whisper sidecar | ✅ |
| HTTP server + OpenAPI 3.1 spec | ✅ |
| Marketing site | ✅ |
| `/studio` edge editor | ✅ |
| Azure Bicep (personal-sub deployable) | ✅ |
| Live deploy on Azure | in progress |
| AzureOpenAi `LlmBackend` adapter | next |
| Blob-backed work-dir adapter | next |

## License

Apache-2.0. Use it, vendor it, ship it.
