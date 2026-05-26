# Contributing to IMTN

Thanks for opening a PR. This document is the operational contract: prerequisites, bootstrap, conventions, the PR checklist CI enforces. Read it once, then keep it open the first time you push.

## Prerequisites

| Tool | Version | Why |
| --- | --- | --- |
| Rust | 1.85 or newer (stable) | Workspace edition is 2024; let-chains and 2024 let-else patterns are in use |
| Node.js | 20.x LTS or newer | Next.js 15 requires 18.18+ but we floor at 20 for `node --watch` parity in scripts |
| npm | bundled with Node 20 | The `web/` workspace uses npm; do not `pnpm install` here |
| Docker | 24 or newer | `docker compose` (V2) syntax; the V1 `docker-compose` binary will not work |
| Python | 3.11 or 3.12 | Whisper + lottie sidecars; matched by `engine/scripts/setup-python.sh` |
| `az` CLI | 2.65 or newer | Only required if you deploy to Azure |
| `gh` CLI | 2.40 or newer | Only required if you push branches that touch `.github/workflows/**` (needs the `workflow` scope) |

macOS-specific: install `ffmpeg` and `cmake` through Homebrew. `whisper-rs` needs `cmake` to build the bundled whisper.cpp; the build will fail without it.

Linux: install `ffmpeg`, `cmake`, `pkg-config`, `libssl-dev`. The CI image is `ubuntu-24.04`.

## Bootstrap

From a fresh clone, in this order:

```bash
# 1. Engine: build the Rust workspace and the Python sidecar venv.
cd engine
cargo build --release
./scripts/setup-python.sh
./scripts/fetch-whisper-model.sh tiny   # ~75 MB; bumps to `base` or `small` on demand
cd ..

# 2. Web: install JS deps.
cd web && npm ci && cd ..

# 3. Infra: bring up the local services.
docker compose up -d

# 4. Wait for Keycloak to import the realm (about 30 s on a cold image).
#    `docker logs -f imtn-keycloak` exits when the import is done.

# 5. Run the web app.
cd web && npm run dev
```

The studio is now live at `http://localhost:3001`. Sign in as `demo / demo`. Hit **Generate** with the seeded sample brief; first render takes ~90 s.

For the runbook (common failure modes, what to grep for in the logs), see [`docs/runbooks/local-dev.md`](./docs/runbooks/local-dev.md).

## Commit conventions

We use Conventional Commits. The format is enforced by `commitlint` in CI and gates PR titles too.

| Prefix | When to use |
| --- | --- |
| `feat:` | A user-facing feature lands or grows. |
| `fix:` | A bug is fixed. Mention the GitHub issue in the body. |
| `docs:` | Documentation only. |
| `refactor:` | Internal change with no user-facing behaviour change. |
| `perf:` | Measurable performance improvement; include the before/after number in the body. |
| `test:` | Tests added or restructured; no production code change. |
| `ci:` | Workflow file changes. |
| `chore:` | Dependency bumps, lockfile rotations, formatting drift. |
| `revert:` | Reverts a previous commit; reference the SHA. |

Subject ≤ 72 chars. Body explains the **why**, not the **what** (the diff already tells you the what). Footer with `Refs:` / `Closes:` / `Breaks:` as appropriate.

Sign every commit. We require both DCO and a real signature:

```bash
# Set up an SSH signing key (simpler than GPG in 2026):
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true

# DCO is `-s` on commit:
git commit -s -m "feat(web): add cast-picker keyboard nav"

# Verify:
git log --show-signature -1
```

CI rejects unsigned commits on `main` and on any branch protected by the workflow.

## Branch protection rules

Enforced on `main` via the GitHub repo settings, mirrored in `.github/CODEOWNERS`:

- ≥ 1 PR review from a maintainer required before merge.
- All status checks must be green: `engine · CI`, `web · CI`, `security`, plus the file-touched-specific `azure-deploy · plan`.
- Signed commits required (`require_signed_commits = true`).
- Force-push disabled. Linear history required (squash or rebase merge only; no merge commits).
- Direct push to `main` blocked for everyone including maintainers.
- "Dismiss stale approvals when new commits are pushed" is on.

CODEOWNERS routes review for the sensitive surface:

```
engine/crates/http/**           @stonyp90/security
engine/infra/**                 @stonyp90/security
.github/workflows/**            @stonyp90/security
keycloak/realm/**               @stonyp90/security
SECURITY.md THREAT_MODEL.md     @stonyp90/security
```

This is a SOC 2 CC5 control; do not bypass it.

## PR checklist

A PR is ready to merge when every box is ticked:

- [ ] Conventional Commits on every commit; subject ≤ 72 chars.
- [ ] `cargo fmt --all --check` clean.
- [ ] `cargo clippy --workspace --all-targets --all-features -- -D warnings` clean.
- [ ] `cargo test --workspace --all-features` green; new tests for new behaviour.
- [ ] `npm run type-check` and `npm run build` green in `web/`.
- [ ] No new `unsafe` block without a `// SAFETY:` comment that names the invariant.
- [ ] No hardcoded colours, fonts, or LLM prompts in `web/src/components/**` — extract to design tokens or `web/src/lib/prompts/`.
- [ ] If you touched the HTTP surface: the OpenAPI 3.1 schema in `engine/crates/http/src/openapi.rs` updates accordingly and the snapshot test passes.
- [ ] If you touched auth or infra: a [`THREAT_MODEL.md`](./THREAT_MODEL.md) entry exists for the change, and CODEOWNERS review is requested.
- [ ] If you touched anything user-visible: docs in [`README.md`](./README.md) or [`ARCHITECTURE.md`](./ARCHITECTURE.md) update accordingly.
- [ ] PR description explains the **why**, calls out the architectural shape (which port/adapter changed), and references the linked issue.

The CI workflow `pr-checklist.yml` parses these and posts a sticky comment listing the items that are unchecked. The merge button stays grey until every required check is green.

## Getting help

- Issues: `https://github.com/stonyp90/motion/issues`. Tag with `area:web`, `area:engine`, `area:infra`, or `area:docs`.
- Security disclosures: see [`SECURITY.md`](./SECURITY.md). Do **not** open public issues for vulnerabilities.
- Code of conduct: [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md). Enforcement contact is the maintainers group at the email in that file.
