# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The project is pre-1.0; minor versions can ship breaking changes. Every breaking change is called out in the **Changed** or **Removed** sections with a `BREAKING:` prefix.

## [Unreleased]

### Added
- *(nothing yet — first PR after the pivot lands here)*

### Changed
- *(nothing yet)*

### Fixed
- *(nothing yet)*

## [0.1.0] — pivot to the explainer-video factory

This is the first tagged release after the product pivot from "license the motion-design engine" to "B2B explainer-video factory". The Rust workspace, the Bicep IaC, the OpenAPI surface, and the WAF + CORS posture all survive intact; the web app is rewritten as a single-screen studio, Keycloak replaces the previous static auth, and the ingest + characters + figma + stt + web-export crates are net-new.

### Added

- **Web — single-screen studio.** `web/src/app/page.tsx` is now the only entry point. Three-pane resizable layout (`react-resizable-panels`): prompt + cast picker (left), live Lottie preview (centre), brand panel + download (right). Server components by default; only `Preview`, `PromptInput`, and `CastPicker` are client components.
- **Keycloak realm `motion-forge`.** Realm JSON committed under `keycloak/realm/motion-forge.json`. Three roles (`owner`, `member`, `viewer`). Federation broker pre-wired for Entra, Google, Okta, OneLogin. Seeded `demo / demo` user for local dev.
- **`next-auth` integration.** Keycloak provider; HTTP-only secure cookie sessions; CSRF tokens; refresh-token rotation through `/api/auth/session`. Replaces the previous `studio` token model.
- **`engine/crates/characters`.** Cast library (~120 characters across 8 art styles), brand-recolour (HSL pass with Oklab fallback for low-saturation logos), and composition helpers that instance a character into a `LottieTimeline` scene.
- **`engine/crates/ingest`.** Format probes for Lottie, Bodymovin, DotLottie, Rive (`rive-rs`), DragonBones, and MoGRT. Normalises everything to the internal scene IR (a strict Bodymovin v5.12 subset). 20 MB upload cap; multipart-streamed into Blob.
- **`engine/crates/figma`.** Figma OAuth handshake, REST client, frame round-trip. `figma::pull(node_id)` returns a normalised scene IR; `figma::push(node_id, lottie)` writes a frame back. Token storage is per-tenant in Key Vault.
- **`engine/crates/stt`.** Streaming Whisper via `whisper-rs` (Metal on macOS, CUDA on the GPU profile, CPU otherwise). WebSocket frame on top with 1-second batching, partial + final transcript events, 10-minute session cap.
- **`engine/crates/web-export`.** Exporters for SVG (with `@keyframes`), CSS animations, GSAP timelines, `motion.dev` timelines, Theatre.js projects (beta), and Framer Motion components (beta). Pure-Rust except for the MP4 path which still delegates to `render`.
- **Per-tenant rate limiting.** Redis-backed leaky bucket in `engine/crates/http`. Default 60 requests per minute per tenant; per-tenant override in Cosmos. Burst tolerance configurable through `MOTION_FORGE_RATE_LIMIT_BURST`.
- **SOC 2 governance bundle.** `SECURITY.md`, `THREAT_MODEL.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, CODEOWNERS rules. Dependabot weekly. CORS allowlist (no `*` in prod). Log retention 90 days hot / 180 days cold.
- **Signed-commits enforcement.** Branch protection on `main` now requires `require_signed_commits = true`. CODEOWNERS routes infra, auth, and workflow changes to the security group.
- **OpenAPI 3.1 surface.** Hand-rolled spec in `engine/crates/http/src/openapi.rs`; snapshot test fails the build if a route exists without a schema entry. Served at `/openapi.json`.
- **Three GitHub Actions workflows** under `.github/workflows/`:
  - `engine-ci.yml` — fmt, clippy `-D warnings`, test, release build.
  - `web-ci.yml` — type-check, build, internal ESLint.
  - `azure-deploy.yml` — OIDC federated login, `az acr build`, `az deployment group create`, post-deploy `/healthz` probe.
- **`docker-compose.yml` at the repo root.** Postgres 16 (port 5435), Redis 7 (6379), MinIO (9002/9003), Keycloak 26 (8080), Ollama (11434), Mailhog (1026/8026). All defaults match the engine's env-var probes.
- **Mermaid diagrams** under `docs/architecture/` for data flow, auth, and deployment.
- **Runbooks** under `docs/runbooks/` for local dev and incident response.

### Changed

- **BREAKING:** the `/generate` request body is reshaped. `brief` is now a tagged union (`structured | freeform | reference`); `cast` is now a `CharacterRef[]` with explicit instancing; `brand` is now a typed `BrandPack`. Old request bodies (with a flat `prompt: string`) return 400 with a deprecation note for one minor release before the codepath is removed.
- **BREAKING:** the `/iterate` endpoint now takes a `run_id` instead of a `work_dir`. The work-dir is resolved server-side from the project record in Cosmos; clients no longer need to know about filesystem paths.
- The web app's marketing pages (`/pricing`, `/faq`, `/about`) move to a separate `marketing/` directory and are deployed independently to Vercel. The `web/` Next app is now studio-only.
- `engine/crates/prompt-orchestrator` no longer auto-detects the LLM backend at startup. `MOTION_FORGE_LLM_BACKEND` is now required and explicit (`ollama | azure-openai | anthropic | openai | mock`).
- The Bicep template now defaults to `enableOpenAi=true` and `enableGpuProfile=false` for `parameters.prod.bicepparam`. Dev parameters left at the personal-sub-friendly defaults.
- CORS allowlist hard-coded to `https://motion.ursly.io` and `http://localhost:3001`. The `*` wildcard is removed.

### Removed

- **BREAKING:** the `/studio` Next.js route, the `cmdk` command palette wired to the old studio, and the client-side Lottie transform library (`web/src/lib/lottie/transform.ts`). The same primitives now live in `engine/crates/lottie-gen` and are exercised through the server round-trip.
- The Vercel deploy for `web/` is removed; the studio runs on Azure Container Apps alongside the API.
- The `panelize` CLI subcommand and the corresponding `/panelize` HTTP route. The cast library and the structured-brief flow subsume the panelize use case; existing panelize callers are migrated by the upgrade-guide doc.
- The `MOTION_FORGE_AUTH_FALLBACK_KEY` env var is removed from prod builds (build-time `cfg(feature = "static-auth")` gate). It remains available in dev for the engine-standalone workflow.

### Fixed

- The render job no longer leaks its temp directory when the Python sidecar panics; cleanup is now in a `Drop` impl on `RenderJobGuard`.
- The `ApiError::IntoResponse` branch for `validate_path` rejections now returns `400` instead of `500` (regression from before the pivot).
- The Front Door transport setting in `engine/infra/main.bicep` is `auto`, not `http2`; the latter broke long-poll endpoints on some browsers.

### Security

- Container image now runs as the `nonroot` user (UID 65532); distroless variant available for prod.
- `cargo audit --deny warnings` and `npm audit --audit-level=moderate` gate the `security.yml` workflow.
- Trivy scan on the API container image, CodeQL on Rust + TypeScript. Both fail the build on `high` or `critical`.
- Refresh tokens never reach the browser JavaScript; the rotation is server-side through `/api/auth/session`.
- All Azure data-plane access is through the engine's User-Assigned Managed Identity; no connection strings on the pod.

---

[Unreleased]: https://github.com/stonyp90/motion/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/stonyp90/motion/releases/tag/v0.1.0
