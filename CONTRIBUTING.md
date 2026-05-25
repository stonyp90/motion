# Contributing to motion-forge

Thanks for considering a contribution. This document covers the
workflow, the local-dev setup, the code-quality bars CI enforces,
and how to navigate the monorepo.

## Repository layout

```
motion/
├── engine/   Rust workspace (10 crates) + Python sidecars + Bicep IaC
├── web/      Next.js 15 marketing site + /studio in-browser editor
├── sdks/     Generated language SDKs (JS, Python, Rust client)
├── .github/  Workflows, CODEOWNERS, Dependabot
├── SECURITY.md         Vuln disclosure policy
├── THREAT_MODEL.md     Attack surface + mitigations
└── CODE_OF_CONDUCT.md  Contributor Covenant 2.1
```

## Quickstart

### Engine

```bash
cd engine
cargo build --release
./scripts/setup-python.sh   # SAM 2 / scenedetect / lottie / Whisper
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
```

### Web

```bash
cd web
npm ci
npm run dev              # http://localhost:3001
npm run type-check
npm run build
```

## CI quality gates

Every PR runs:

| Workflow | Gate |
|---|---|
| `engine · CI` | `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, `cargo build --release` |
| `web · CI` | `npm ci`, `npm run type-check`, `npm run build` (Next's internal ESLint runs here) |
| `security` | `cargo audit --deny warnings`, `npm audit --audit-level=moderate`, Trivy on the API container image, CodeQL on Rust + TypeScript |
| `engine · Azure deploy` | (only on push to `main` touching `engine/**`) OIDC login → ACR image build → Bicep apply → live `/healthz` probe |

Branch protection on `main`:

- At least 1 PR review required
- All workflow status checks must pass
- Signed commits required (`git commit -S`)
- No force pushes
- No direct pushes to `main` — go through a PR

## Signing commits

You'll need a GPG or SSH signing key set up:

```bash
# GPG
gpg --full-generate-key
git config --global user.signingkey <KEY-ID>
git config --global commit.gpgsign true

# OR SSH (simpler in 2026)
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

Verify with `git log --show-signature`.

## CODEOWNERS

The `.github/CODEOWNERS` file requires review from the security team
for changes to:

- `engine/infra/**` (Bicep IaC)
- `engine/crates/http/**` (HTTP API + auth middleware)
- `engine/infra/docker/**` (container images)
- `.github/workflows/**` (CI/CD)

This is a SOC 2 CC5 control — sensitive changes are never merged on
the sole authority of the author.

## Coding conventions

### Rust

- `rustfmt` is enforced (see `rustfmt.toml` if it exists; otherwise defaults)
- `cargo clippy --all-targets --all-features -- -D warnings` — no
  warnings tolerated on `main`
- Hexagonal architecture: each crate exposes a **port** (trait) and
  one or more **adapters**. New external integrations go behind a
  new port; don't add raw I/O calls in the orchestration crate.
- Error handling: `anyhow::Result` at command boundaries,
  `thiserror` for library error types. Always `with_context` on
  failable I/O.

### TypeScript / Next.js

- No hardcoded hex colors anywhere in `web/src/components/**` — use
  the Tailwind utility classes that resolve to CSS variables. The
  exception is `web/src/lib/studio/palette.ts` which curates the
  user-facing colour-picker presets and is explicitly documented as
  not-a-brand-token.
- No `style={{ color: 'var(--...)' }}` inline — use Tailwind utilities.
- No arbitrary Tailwind values like `bg-[#abc]` or `text-[10px]` —
  extend `tailwind.config.ts` with a named utility instead.
- Components default to server components; add `'use client'` only
  when you need stateful interactivity.
- Dark theme is on for `/studio`, light on the marketing surfaces.
  All colour decisions ride the `data-theme` attribute on `<html>`.

### Commits

- Conventional Commits style: `feat:`, `fix:`, `docs:`, `ci:`,
  `refactor:`, `chore:`, `test:`
- Subject ≤ 72 chars; body explains *why* not *what*

## Releasing

```bash
# Tag a new release; cargo-dist + sdk-publish workflows do the rest.
git tag v0.X.Y
git push --tags
```

The `release.yml` workflow builds 5-platform binaries, signs them
with GitHub Artifact Attestations (SLSA 3+), publishes the SDKs to
npm + PyPI + crates.io, and creates a GitHub Release with the
generated CHANGELOG entry.

## Getting help

- File an issue at <https://github.com/stonyp90/motion/issues>
- For security issues: see [`SECURITY.md`](./SECURITY.md)
- Code of Conduct: [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)
