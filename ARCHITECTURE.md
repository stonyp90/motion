# motion-forge — architecture

This document describes the system as it is built and as it deploys. It does not include speculative work; for that, see the roadmap in [`README.md`](./README.md).

The document is organised top-down: components, then per-request data flows, then authentication, then storage, then the rationale behind each major dependency, then the deployment topology, then the local-dev story.

---

## 1. Component model

motion-forge is a single product split across two deployment units:

- **`engine/`** — the Rust workspace plus three Python sidecars (Whisper for streaming STT, the `lottie` package for MP4 rendering, scene-detection for the reference-video ingest path). The Rust workspace exposes an HTTP API and a CLI from the same set of crates.
- **`web/`** — a Next.js 15 App Router application. Single-screen studio. Server components by default; client components only where stateful interactivity is required (the live preview, the cast picker, the prompt textarea with mic capture).

### 1.1 Rust workspace

The engine is hexagonal. Every external integration sits behind a port (trait) in its own crate. Adapters live in the same crate but never leak across crate boundaries.

```
engine/crates/
  pipeline/                end-to-end DAG; orchestrates the other crates
  prompt-orchestrator/     LlmBackend port + Ollama / Azure OpenAI / Anthropic / OpenAI / Mock adapters
  lottie-gen/              Lottie JSON writer (Bodymovin v5.12)
  render/                  Renderer port + Python lottie sidecar adapter; future native adapter slot
  characters/              cast library + brand-recolour pipeline
  ingest/                  parses Lottie / Bodymovin / DotLottie / Rive / DragonBones / MoGRT into the internal scene IR
  figma/                   Figma OAuth + REST + frame round-trip
  stt/                     streaming Whisper (whisper-rs); WebSocket frame on top
  web-export/              SVG / CSS / GSAP / Motion / Theatre / Framer emitters
  http/                    axum HTTP service; JWT auth; OpenAPI 3.1 surface
  cli/                     clap entry point; same operations as the HTTP surface
```

Two architectural rules:

1. **No I/O in `pipeline`.** Pipeline composes ports. Adapters do I/O. This is what makes `run_iterate` a deterministic re-run of a single port (`LlmBackend::complete`) without re-touching disk for the segmentation cache.
2. **No HTTP concerns in `pipeline`.** Pipeline returns rich error types; `http` maps them to HTTP status codes and to OpenAPI-documented response schemas. This is what makes the CLI and the HTTP surface 1:1.

### 1.2 Web application

```
web/src/
  app/
    layout.tsx               root layout; theme attribute on <html>
    page.tsx                 single-screen studio
    api/                     thin proxy to the engine; only does auth-cookie → bearer translation
  components/
    PromptInput.tsx          text + mic + paste-script
    CastPicker.tsx           library + uploads + brand logos
    BrandPanel.tsx           palette / font / logo
    Preview.tsx              lottie-react live render; sub-second updates from the engine
  lib/
    keycloak.ts              browser-side OIDC client (next-auth)
    engine-client.ts         typed wrapper around engine OpenAPI
    transform/               client-side Lottie mutations (recolour, retime) for sub-second feel
```

The web app does **client-side** Lottie mutations for the iteration loop. Server round-trips only fire when the user changes the brief, the cast, or the brand identity. This is the source of the sub-second iterate feel.

---

## 2. Data flow per request type

### 2.1 Brief-paste flow (`POST /generate` with `brief.kind = "structured"`)

```
1. Browser POSTs the brief (scenes + lines + sfx + duration), the cast (character ids
   + uploaded asset ids), and the brand pack (palette + font + logo url) to /generate
   with a Keycloak-issued bearer token.
2. http verifies the JWT against the cached JWKS, extracts tenant + roles.
3. http checks the per-tenant Redis leaky bucket; rejects with 429 if exceeded.
4. http calls pipeline::run_full(input, work_dir).
5. pipeline writes the input to Blob under workdirs/<tenant>/<project>/<run>/input.json.
6. pipeline calls prompt-orchestrator with the brief, the cast manifest, and the brand pack.
   Orchestrator emits a LottieTimeline (typed struct, not raw JSON).
7. pipeline hands the LottieTimeline to characters::recolour and characters::compose
   (cast → instanced layers with brand palette applied).
8. pipeline hands the composed timeline to lottie-gen which emits Bodymovin v5.12 JSON.
9. pipeline hands the Lottie JSON to render which spawns the Python lottie sidecar.
   Renderer streams progress events back through a Redis pubsub channel.
10. http returns 202 + a project URL; subsequent /projects/<id>/events SSEs progress.
11. On render completion, MP4 lands in Blob under outputs/<tenant>/<project>/<run>.mp4
    and the project record in Cosmos gains a `renders[]` entry.
```

P50 budget on Azure (gpt-5 Standard, T4 GPU job, 60 s clip):

- prompt-orchestrator: 800 ms – 2.5 s
- lottie-gen: under 50 ms
- render: 35 s – 75 s
- end-to-end: ~90 s p50, 150 s p95

### 2.2 Free-form flow (`POST /generate` with `brief.kind = "freeform"`)

Identical except the orchestrator runs a two-step prompt: first a structuring pass that turns the free-form text into a script (scene / line / sfx), then the same Lottie-timeline generation step. The structuring pass is cached on the SHA of the free-form text — repeated runs with identical text skip it.

### 2.3 Voice flow (`WebSocket /transcribe`)

```
1. Browser opens a WebSocket to /transcribe with the Keycloak bearer token in the
   `Sec-WebSocket-Protocol` header (proxied through Next).
2. http upgrades; stt::WhisperStream spawns.
3. Browser captures audio via WebRTC, downsamples to 16 kHz mono, sends 1024-sample
   binary frames.
4. WhisperStream batches frames into 1-second windows, runs whisper-rs (CoreML on macOS,
   CUDA on the GPU profile, CPU otherwise), and emits partial + final transcripts as
   text frames.
5. Browser composes the final transcript into the free-form brief and POSTs /generate.
```

The STT stream is one-way auth (the JWT covers the initial handshake; no per-frame auth). The stream is hard-capped at 10 minutes of audio per session to keep cost bounded.

### 2.4 Ingest flow (`POST /ingest`)

```
1. Browser uploads a .lottie / .json / .riv / .skel / .mogrt to /ingest with the bearer
   token. Multipart, max 20 MB; rejected larger.
2. http streams the body into Blob and calls ingest::probe to detect the format.
3. ingest::probe dispatches to the format-specific adapter:
   - Lottie / Bodymovin: parse-validate-normalise
   - DotLottie: unzip, pick `animations/<first>.json`, then Lottie path
   - Rive: flatten the active state-machine via `rive-rs`
   - DragonBones: parse `.skel` + atlas, convert to shape layers
   - MoGRT: extract the embedded Lottie payload
4. ingest writes the normalised scene IR to Blob under uploads/<tenant>/<asset>.json
   and returns an `asset_id` the browser can drop into the cast picker.
```

The internal scene IR is a strict subset of Bodymovin v5.12. Anything the format-specific adapter can't represent in shape layers is rasterised at the source resolution and emitted as a still layer.

### 2.5 Export flow (`POST /export/{format}`)

```
1. Browser POSTs the project id and the target format (`svg`, `gsap`, `motion`,
   `theatre`, `framer`, `lottie`, `mp4`) with the bearer token.
2. http reads the project's latest Lottie JSON from Blob.
3. http calls web-export::emit(target, lottie) and streams the result back.
   Big targets (mp4, theatre) get a 202 + Blob URL when complete; small targets
   (svg, gsap, motion, framer) come back inline.
```

The web-export crate is pure-Rust except for the MP4 path which delegates to `render`.

---

## 3. Authentication

motion-forge uses Keycloak as the single identity provider. In production, Keycloak federates to whatever IdP the customer brings (Entra, Google Workspace, Okta, OneLogin); customers never need a motion-forge-only account.

### 3.1 Token flow

```
                     ┌──────────────────────────────┐
   User ───────────▶ │ Browser                      │
                     │  (next-auth, @keycloak/js)   │
                     └──────────────┬───────────────┘
                                    │ 1. OIDC authorization_code + PKCE
                                    ▼
                     ┌──────────────────────────────┐
                     │ Keycloak realm motion-forge  │
                     │  client: motion-forge-web    │
                     │  flow: authorization_code    │
                     │  pkce: S256                  │
                     └──────────────┬───────────────┘
                                    │ 2. access_token (JWT, RS256) + id_token + refresh_token
                                    ▼
                     ┌──────────────────────────────┐
                     │ Browser stores tokens in     │
                     │ HTTP-only secure cookies     │
                     │ (signed + encrypted via      │
                     │ next-auth)                   │
                     └──────────────┬───────────────┘
                                    │ 3. Authorization: Bearer <access_token>
                                    ▼
                     ┌──────────────────────────────┐
                     │ engine/crates/http auth.rs   │
                     │  - fetch JWKS (cached 12 h)  │
                     │  - verify signature          │
                     │  - verify iss / aud / exp    │
                     │  - extract tenant + roles    │
                     └──────────────────────────────┘
```

Cookies are HTTP-only, `SameSite=Lax`, `Secure` in prod, signed by a Next-managed secret in Key Vault. Refresh tokens never touch the browser JS; the rotation happens through the `/api/auth/session` server route.

### 3.2 Roles

The realm seeds three roles:

| Role | Capabilities |
| --- | --- |
| `owner` | Manage workspace, invite/remove members, manage billing, full read+write on every project, can rotate the Keycloak client secret. |
| `member` | Create + edit projects, upload assets, kick off renders. Cannot manage members or billing. |
| `viewer` | Read-only on every project in the workspace. Can download Lottie / MP4 / pack but cannot mutate. |

Role mapping is per-realm; the engine treats them as opaque claims and translates them through `http::auth::require_role(Role::Member)` guards on each route. Adding a fourth role is a one-line change in the Keycloak realm JSON plus a guard.

### 3.3 Service-to-service auth

In Azure: all engine-to-Azure-data-plane calls (Blob, Cosmos, Redis, Key Vault, Azure OpenAI) go through the engine's User-Assigned Managed Identity. There are no connection strings on the pod. The only secrets in Key Vault are third-party API keys (ElevenLabs, Anthropic, OpenAI) that the customer brings.

In local dev: each service has a fixed dev credential (`postgres / postgres`, `minio / minio12345`, etc.) materialised by `docker-compose.yml`. The `MOTION_FORGE_AUTH_FALLBACK_KEY` env var lets the engine accept a static bearer token in dev — required when running the engine outside docker against the docker-composed services.

---

## 4. Storage model

motion-forge stores three classes of data: large binary artifacts (Blob), small mutable metadata (Cosmos), and ephemeral coordination state (Redis).

### 4.1 Blob layout

The Blob container is partitioned by tenant. One container per environment.

```
mf-data-{env}/
  workdirs/<tenant>/<project>/<run>/
    input.json            the request body
    scene-ir.json         the normalised scene IR
    timeline.lottie.json  the emitted Lottie
    progress.log          newline-delimited render progress
  outputs/<tenant>/<project>/<run>.mp4
  outputs/<tenant>/<project>/<run>.pack.zip
  uploads/<tenant>/<asset_id>.{lottie,svg,png,...}
  cast/<style>/<character>.lottie.json
  brands/<tenant>/{logo.svg, palette.json, font.woff2}
```

Lifecycle policy:

- `workdirs/` — Hot 7 days → Cool 30 days → Archive 90 days → delete at 180 days
- `outputs/` — Hot 30 days → Cool 90 days → Archive 1 year (never delete)
- `uploads/` — Hot 30 days → Cool 1 year → Archive forever
- `cast/` and `brands/` — Hot always (small, hot-pathed by every generate)

Versioning on; soft-delete 7 days; point-in-time restore 30 days (prod only).

### 4.2 Cosmos containers

`mf-meta` database. Serverless billing, NoSQL API. Partition key is `/tenantId` everywhere.

| Container | Partition key | Contents |
| --- | --- | --- |
| `workspaces` | `/tenantId` | One doc per workspace; member list, plan, brand defaults. |
| `projects` | `/tenantId` | One doc per project; pointer to the latest run + render history. |
| `runs` | `/tenantId` | One doc per generate/iterate invocation; status, timings, error if any. |
| `assets` | `/tenantId` | One doc per uploaded asset; pointer to Blob, normalised metadata. |
| `audits` | `/tenantId` | Immutable audit log; row per privileged action (SOC 2 CC7). |

The audit container has a 7-year TTL and write-only access from the engine MI.

### 4.3 Redis

Two logical databases on the same instance.

`db0` — coordination:

- `q:render:{tenant}` — work queue for the render job
- `q:ingest:{tenant}` — work queue for the ingest job
- `pubsub:run:{run_id}` — progress events for SSE

`db1` — rate + idempotency:

- `rl:tenant:{tenant}` — leaky-bucket rate-limit state, 60 s TTL
- `idemp:{key}` — request idempotency keys, 24 h TTL
- `jwks:keycloak` — JWKS cache, 12 h TTL

Redis is sized at Basic C0 for dev (`docker-compose`) and Basic C1 for prod. Eviction policy `volatile-lru` so rate-limit + idempotency keys evict before active queue items.

---

## 5. Why each major dependency

| Dependency | Why this one |
| --- | --- |
| **Rust** (workspace, 2024 edition) | Deterministic performance for the hot path (lottie-gen is microsecond-scale per layer, segmentation runs on rayon). Zero-runtime panics in long-running services. Hexagonal-friendly trait system. The `rust-version = "1.85"` floor reflects let-chains and 2024-edition let-else patterns the codebase uses. |
| **`axum`** | Tower middleware composes cleanly with the JWT verifier and the rate-limiter. `tracing` integrates without adapters. The OpenAPI surface is hand-rolled (kept small), so `axum`'s rejection types map straight into our `ApiError`. Alternatives considered: `actix-web` (heavier macro magic, harder to compose middleware); `salvo` (smaller ecosystem). |
| **`whisper-rs`** | Bindings to whisper.cpp; native Metal acceleration on macOS, CUDA on Linux. Streaming-friendly (`whisper_full_with_state`). Alternatives considered: `openai-whisper` python (10× heavier, no streaming); cloud Whisper (latency floor of ~600 ms per request — incompatible with the conversational feel). |
| **`tokio`** + **`reqwest`** with `rustls-tls` | `rustls` keeps the image free of OpenSSL CVE noise. `reqwest` with the `json` feature is a tiny surface for the LLM clients. |
| **`palette` + `kmeans_colors`** | Pure-Rust Oklab palette extraction in `style-extract` and `characters::recolour`. No native deps; runs on any cargo target. |
| **`ffmpeg-sidecar`** | Cross-platform FFmpeg installer + runner. Avoids the FFI nightmare of `rsmpeg` while we wait for the project to stabilise. The `rsmpeg` adapter slot is reserved in `video-io` for the zero-copy path. |
| **Next.js 15 (App Router)** | Server components let the studio screen ship a 30 KB JS bundle; only the live-preview panel hydrates. Streaming SSR for the project list. Next-auth integration is the cleanest path to Keycloak in 2026. |
| **`next-auth`** | OIDC client with Keycloak provider built-in; encrypted cookie sessions; CSRF tokens out of the box. Alternatives considered: `@oslojs/oauth2` (lower-level, more glue code for the same outcome). |
| **`react-resizable-panels`** | The studio is a three-pane resizable layout. This is the only React library that handles the layout without `iframe` hacks and survives SSR. |
| **`lottie-react`** | The reference Lottie player from LottieFiles. Already the format owner; no fidelity gap with the engine. |
| **`zustand`** | Tiny state store for the studio. The brief / cast / brand panels are loosely coupled but share a single project draft — Zustand keeps the wiring under 100 LOC. |
| **PostgreSQL** (dev only) | The local docker-compose uses Postgres as a Cosmos stand-in for the metadata containers. The engine has no schema migrations against Postgres in prod — Cosmos is the prod store and is schemaless. |
| **Keycloak 26** | Self-hosted OIDC + SAML + federation. The "bring-your-own-IdP" story is what makes the enterprise SSO matrix one config screen. Alternatives considered: Auth0 (great DX, weak self-host story, cost scales badly per-MAU); Ory Kratos (more moving parts, no federation broker out of the box). |

---

## 6. Deployment topology

The production target is Azure. The same Bicep template (`engine/infra/main.bicep`) deploys to a developer subscription with `enableOpenAi=false` and `enableGpuProfile=false` so the stack stands up without the quota approvals that gate Azure OpenAI and the T4 GPU SKU.

```
                           Internet
                              │  HTTPS
                              ▼
                  ┌──────────────────────────────────┐
                  │  Azure Front Door Premium        │
                  │  - global anycast                │
                  │  - WAF (managed Microsoft rules) │
                  │  - private-link to ACR + Blob    │
                  └──────────────┬───────────────────┘
                                 │  HTTPS, FD-origin mTLS
                                 ▼
                  ┌──────────────────────────────────┐
                  │  Container Apps Environment      │
                  │  (Workload Profiles)             │
                  │                                  │
                  │  mf-web     Consumption  min=1   │  (Next.js)
                  │  mf-api     Consumption  min=1   │  (axum, always-warm)
                  │  mf-keycloak Dedicated D4 min=1  │  (single-region for v0.1)
                  │                                  │
                  │  mf-render-job  Job, D4 CPU      │  (KEDA Storage Queue trigger)
                  │  mf-segment-job Job, NC8as-T4    │  (KEDA Storage Queue trigger,
                  │                                  │   only with enableGpuProfile)
                  │  mf-ingest-job  Job, D2 CPU      │  (KEDA Storage Queue trigger)
                  └──────────────┬───────────────────┘
                                 │  User-Assigned Managed Identity
                ┌────────────────┼─────────────────────────┐
                ▼                ▼                          ▼
        Azure Blob       Azure Cosmos DB          Azure Cache for Redis
        Hot/Cool/Arch    Serverless NoSQL         Basic C1
        workdirs +       workspaces/projects/     queues, idemp.,
        outputs +        runs/assets/audits       JWKS cache, rate limit
        uploads + cast
                                 │
                                 ▼
                  ┌──────────────────────────────────┐
                  │  Azure OpenAI Service            │
                  │  gpt-5 Standard (or PTU)         │
                  │  disableLocalAuth = true (MI)    │
                  └──────────────────────────────────┘
```

Single-region (eastus) for v0.1. Multi-region failover is a roadmap item; the Bicep already exposes the parameters, but Cosmos and Blob need geo-replicated counterparts to flip on.

Keycloak runs as an always-on container app rather than as a managed service because there is no Azure-native managed Keycloak. Postgres for Keycloak is Azure Database for PostgreSQL Flexible Server, Burstable B1ms — the smallest tier; Keycloak is not on a hot path.

### 6.1 CI/CD path

Three GitHub Actions workflows under `.github/workflows/`:

- **`engine-ci.yml`** — `cargo fmt --check`, `cargo clippy --workspace -- -D warnings`, `cargo test --workspace --all-features`, release build. Runs on every push and PR.
- **`web-ci.yml`** — `npm ci`, `npm run type-check`, `npm run build`. Runs on every push and PR.
- **`azure-deploy.yml`** — Triggers on push to `main` touching `engine/**` or manual dispatch. OIDC federated login to Azure (no client secrets in the repo). Builds the image with `az acr build`, deploys with `az deployment group create`, then probes `https://<frontdoor>/healthz` to gate success.

Branch protection on `main`: ≥1 PR review, signed commits, all status checks green, no force-push, no direct push. CODEOWNERS routes infra + auth + workflow changes to the security group.

---

## 7. Local dev story

Goal: `docker compose up && cd web && npm run dev` and the studio works end-to-end on a laptop in under 5 minutes of cold-cache setup.

`docker-compose.yml` stands up:

| Service | Image | Local port | Notes |
| --- | --- | ---: | --- |
| Postgres 16 | `postgres:16-alpine` | 5435 | Keycloak + the metadata-stand-in store |
| Redis 7 | `redis:7-alpine` | 6379 | Identical role to prod |
| MinIO | `minio/minio:latest` | 9002 / 9003 | Blob stand-in; S3-API compatible; the engine uses `aws-sdk-s3` against it with `endpoint_url` overridden |
| Keycloak 26 | `quay.io/keycloak/keycloak:26.1` | 8080 | Imports `realm/motion-forge.json` on first boot; seeds the `demo` / `demo` user |
| Ollama | `ollama/ollama:latest` | 11434 | Default `MOTION_FORGE_LLM_BACKEND=ollama`; warm with `ollama pull llama3.2:3b` |
| Mailhog | `mailhog/mailhog:latest` | 1026 / 8026 | Catches Keycloak's outbound emails (verify-email flow) |

The engine binary auto-detects these services via standard env vars (`DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`, `KEYCLOAK_URL`, `OLLAMA_URL`). All defaults match the docker-compose ports.

For the Python sidecars (Whisper, lottie render, scene-detect), `engine/scripts/setup-python.sh` provisions a `.venv/` and `engine/scripts/fetch-whisper-model.sh <model>` downloads the requested Whisper weights to `engine/models/`. The engine probes for `.venv/bin/python` at start; if missing, it falls back to the system Python and logs a warning.

The runbook for spinning this up (and for debugging the common failure modes) lives at [`docs/runbooks/local-dev.md`](./docs/runbooks/local-dev.md).
