# ControlCraft threat model

A living document. Update on every architectural change. Last
reviewed: at the same SHA as this commit.

## Scope

The system under analysis is **ControlCraft as deployed to Azure
under `rg-motion-forge-dev`** (the resource-group name predates the
brand and stays as-is for infra continuity), plus the local
developer workstation running the CLI + Python sidecars.

Out of scope:

- The user's brand-asset machines (we treat the input data as
  trusted; if it's malicious it's their problem)
- The Anthropic / OpenAI / Azure OpenAI back-ends (we trust their
  TLS + their auth)

## Architecture surface

```
            Internet
                │  HTTPS
                ▼
       Azure Front Door (Premium, WAF candidate)
                │  HTTPS
                ▼
       Azure Container Apps Ingress (ACA)
                │
                ▼
       axum HTTP service (ControlCraft api)
                │
                ▼  Managed Identity
       ┌────────┴───────────────────────────────┐
       │                                         │
       ▼                                         ▼
   Azure OpenAI                          Blob / Cosmos / Redis /
   (LLM completions)                     Key Vault / Queue
                                                 │
                                                 ▼ KEDA queue trigger
                                          ACA Render Job + Segment Job
                                          (Python sidecars, batch only)
```

## Trust boundaries

| # | Boundary | Trust delta |
|---:|---|---|
| 1 | Internet → Front Door | Anonymous; Front Door terminates TLS, runs WAF rules (Premium tier only) |
| 2 | Front Door → ACA ingress | Microsoft network, mTLS by default for the FD origin |
| 3 | ACA → Azure data plane (Blob/Cosmos/Redis/KV) | User-Assigned Managed Identity; no shared secrets cross this boundary |
| 4 | ACA → Azure OpenAI | Managed Identity again; `disableLocalAuth` so no key in the pod |
| 5 | ACA → Render Job (queue message) | Storage Queue with MI auth; messages are signed by the API at enqueue time |
| 6 | Render Job → Blob (output write) | MI-scoped Blob Data Contributor; only on `outputs/` and `workdirs/` containers |
| 7 | Developer workstation → GitHub / Azure | gh + az CLI auth; OIDC federation for Actions |

## Identified threats and mitigations

### T1 · Unauthenticated `/generate` invocation (cost bomb)
- **Threat**: An anonymous caller hits `/generate` in a loop, burning
  GPU + LLM credits on our Azure bill.
- **Likelihood × impact**: HIGH × HIGH = P0
- **Mitigation**: Entra JWKS bearer-token middleware in
  `engine/crates/http/src/auth.rs`. Static-key fallback for dev,
  gated behind `MOTION_FORGE_AUTH_FALLBACK_KEY` env. Per-tenant
  rate limit (Redis-backed leaky bucket) once we have tenants.

### T2 · CORS exposure
- **Threat**: With `allowedOrigins: ['*']`, any third-party page can
  trigger requests in a logged-in user's browser. Combined with T1,
  trivial CSRF.
- **Mitigation**: Tighten the Bicep CORS list to an explicit allowlist
  (`https://motion.ursly.io`, `http://localhost:3001`).

### T3 · Path traversal via `reference_video` / `work_dir`
- **Threat**: A POST body with `../../etc/passwd` reads files outside
  the intended directory.
- **Mitigation**: ✅ `validate_path()` in
  `engine/crates/http/src/lib.rs` rejects paths containing `..` or
  NUL bytes. Two unit tests cover the regression case.

### T4 · Container compromise → cloud takeover
- **Threat**: An attacker pops a shell in the API container and uses
  the Managed Identity to enumerate Blob / Cosmos / Key Vault.
- **Mitigation**: MI scope is narrow (Blob Data Contributor + Queue
  Data Contributor + Cognitive Services OpenAI User + KV Secrets
  User + Cosmos Data Contributor). No Subscription-level role. The
  container runs as `nonroot` user. Distroless image variant
  available (no shell). Future: pod-identity binding to a per-tenant
  MI when tenancy lands.

### T5 · Supply-chain compromise (Rust / npm / Python)
- **Threat**: A malicious dep ships an `unsafe { rce!() }` upstream.
- **Mitigation**: `cargo audit --deny warnings` + `npm audit
  --audit-level=moderate` + Trivy scan on container images + CodeQL
  on every PR. Dependabot opens upgrade PRs weekly. `Cargo.lock` and
  `package-lock.json` committed.

### T6 · CI/CD compromise
- **Threat**: An attacker pushes to `main` and the deploy workflow
  ships their image.
- **Mitigation**: Branch protection on `main`: ≥1 PR review, signed
  commits, no force-push, status checks required. Manual approval
  gate for prod via GitHub Environments. CODEOWNERS for
  `engine/infra/**`, `.github/workflows/**`, `engine/crates/http/**`.

### T7 · Secret leakage in logs
- **Threat**: Tracing prints a bearer token at debug.
- **Mitigation**: Custom `Debug` impl on auth-bearing structs;
  `tracing-subscriber` filter that strips `Authorization` headers
  from the HTTP span. Reviewed quarterly.

### T8 · Cost runaway via Azure OpenAI
- **Threat**: A flood of requests drives Azure OpenAI bills.
- **Mitigation**: Cost budgets + alerts in Azure Monitor. PTU cap
  on the Azure OpenAI deployment (currently `capacity: 50`).
  `MOTION_FORGE_LLM_TIMEOUT_SEC` caps wait time per call to
  short-circuit hung models.

### T9 · Data exfiltration via `/iterate`
- **Threat**: A caller passes `work_dir` referencing another tenant's
  directory and exfiltrates `style.json`.
- **Mitigation**: Until tenancy lands, work-dirs are local-FS only
  and there's exactly one tenant. Once a real multi-tenant model
  lands, `work_dir` becomes an opaque ID resolved through Cosmos
  with the caller's tenant claim.

### T10 · DR / data loss
- **Threat**: Storage account corrupted; outputs lost.
- **Mitigation**: Blob soft-delete (7 d) ✅. Versioning + 30-day
  point-in-time restore: pending. Cross-region replication for prod.

## Accepted risks

- **Private endpoints not yet enabled** on Storage / Cosmos / Redis /
  KV. We accept this because the MI auth model makes public-network
  reach largely defence-in-depth rather than the primary control.
  Will enable when we add a custom VNet to the ACA env.
- **No Customer-Managed Keys** on Blob / Cosmos. We accept Azure-
  managed keys until a customer requires CMK.
- **Single region (eastus)**. We accept the region-down risk for the
  dev tier; multi-region rolls in when we have prod customers.

## Review cadence

- On every PR touching `engine/crates/http/**`, `engine/infra/**`,
  `.github/workflows/**`
- Quarterly full re-review
- Immediately after any incident
