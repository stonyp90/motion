# IMTN Security Runbook

How we authenticate, what we log, how secrets enter the system,
and what to do when a credential leaks. Engineer-facing; the
external-facing summary lives in `/SECURITY.md`.

## Threat model in one paragraph

The engine accepts uploads + prompts from any authenticated
principal and runs LLM + render sidecars on the host. We trust
the LLM provider, the OS, and the operator; we do **not** trust
the network or the principal. Each request enters via TLS,
through CORS, through auth (JWT or API key), through rate limit,
and finally into a handler that writes only to a per-session
workspace. No principal can read another principal's session,
issue an API key for someone else, or reach the host filesystem
outside the workspace.

## What we ship to harden the surface

| Layer | Control |
|---|---|
| Transport | HSTS preload-eligible 2-year max-age, includeSubDomains. |
| Browser-side | CSP `default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, Permissions-Policy denies camera / geolocation / payment / USB / bluetooth. |
| CORS | Engine accepts only loopback origins by default; prod hosts opt-in via `MOTION_FORGE_ALLOWED_ORIGINS`. |
| Auth | Keycloak JWT (RS256, JWKS-validated) **or** `mf_live_…` API key (SHA-256-hashed, file-backed, atomic writes). |
| Rate limit | Sliding window per principal — free 60 / pro 600 / enterprise 6000 rpm. |
| Body limit | 256 MiB per request (`tower_http::limit::RequestBodyLimitLayer`). |
| Path validation | `..` and NUL byte traversal blocked on every path field. |
| Privilege gate | API keys can never mint API keys (JWT-only path). |
| Dependencies | Dependabot weekly, `cargo audit`, `npm audit`, Trivy, CodeQL (enable in repo Settings → Code security). |

## Required environment variables

```bash
# Engine
KEYCLOAK_ISSUER=https://auth.imtn.io/realms/motion-forge
KEYCLOAK_AUDIENCE=motion-forge-web,motion-forge-engine
MOTION_FORGE_ALLOWED_ORIGINS=https://imtn.io,https://app.imtn.io
MOTION_FORGE_DATA_DIR=/var/lib/imtn
MOTION_FORGE_EMAIL_BACKEND=ses        # or sendgrid / azure / stub

# Engine — DEV ONLY, do NOT set in prod
MOTION_FORGE_AUTH_FALLBACK_KEY=<32-char secret used by Tauri desktop>
```

## Setting up secrets in GitHub Actions

We use OIDC federated identity for Azure (no long-lived secrets)
and short-scoped PATs for the third-party providers. Names + how
they're consumed:

| Secret | Used by | Source |
|---|---|---|
| `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` | `azure-deploy.yml` | Entra app registration → see "Federated identity" below |
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | `web-deploy.yml` | `vercel link` then `cat .vercel/project.json` |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | `desktop-release.yml` | Apple Developer Program → Certificates + App-specific password |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | `desktop-release.yml` | `cd desktop && npx tauri signer generate -w ~/.tauri/imtn.key` |
| `KEYCLOAK_*` | `azure-deploy.yml` smoke step | Realm export from prod Keycloak |

### Azure federated identity (one-time setup)

GitHub Actions authenticates to Azure via OIDC — no static client
secret stored in GH. The flow:

```bash
# 1. Pick a service principal (or create one).
APP_ID=$(az ad app list --display-name imtn-github-deploy --query "[0].appId" -o tsv)
[ -z "$APP_ID" ] && APP_ID=$(az ad app create --display-name imtn-github-deploy --query appId -o tsv)
az ad sp create --id "$APP_ID" 2>/dev/null || true

# 2. Federate it against this repo + the `dev` environment.
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "github-dev",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:stonyp90/motion:environment:dev",
  "audiences": ["api://AzureADTokenExchange"]
}'

# 3. Grant the SP rights on the target resource group.
az role assignment create \
  --assignee "$APP_ID" \
  --role "Contributor" \
  --scope "/subscriptions/$AZURE_SUBSCRIPTION_ID/resourceGroups/rg-motion-forge-dev"

# 4. Push the IDs into GH secrets.
gh secret set AZURE_CLIENT_ID --body "$APP_ID"
gh secret set AZURE_TENANT_ID --body "$(az account show --query tenantId -o tsv)"
gh secret set AZURE_SUBSCRIPTION_ID --body "$AZURE_SUBSCRIPTION_ID"
```

Same flow for `:environment:prod` once you cut a prod environment
in GitHub Settings → Environments.

**Troubleshooting** — when `azure/login` fails with:

> `AADSTS700213: No matching federated identity record found for presented assertion subject 'repo:stonyp90/motion:environment:dev'`

…it's exactly the missing-credential case. Re-run step 2 above with
the `environment:dev` subject (or `environment:prod` for the prod
job). `azure-deploy.yml` pre-flights this and emits a warning + sets
`skip=true` on subsequent steps so the workflow stays amber rather
than red — but the deploy doesn't happen until the credential exists.

### Tauri Updater keypair (one-time setup)

```bash
cd desktop
npx tauri signer generate -w ~/.tauri/imtn.key
# → prints public key + writes private key to ~/.tauri/imtn.key
# Public key goes into `tauri.conf.json` → plugins.updater.pubkey.
# Private key + password go into GH Secrets:
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/imtn.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --body "<the password you set>"
```

## When a credential leaks

1. **Rotate immediately.** Don't wait to investigate — kill the
   compromised credential first, ask questions second.
   - AWS keys → `aws iam delete-access-key --access-key-id <ID>`
   - Azure SP secret → `az ad app credential delete --id <APP_ID> --key-id <ID>`
   - Vercel token → vercel.com/account/tokens → Delete
   - Apple certificate → Apple Developer Portal → Revoke
   - Tauri updater key → generate a new pair, ship in next release
2. **Audit usage.** Pull the access logs for the leaked credential's
   window:
   - Azure: `az monitor activity-log list --offset 24h --caller <APP_ID>`
   - GitHub: Settings → Audit log → filter on the actor
3. **Notify.** If customer data may have been touched, file an
   incident under `incidents/YYYY-MM-DD-<slug>.md` and email
   `security@imtn.io`.

## Why we don't accept credentials over chat / email / Slack

Anything pasted into a chat tool persists in the transcript, the
provider's training pipeline, browser history, screenshots, and
sometimes server logs. The only safe place for a token to land is
the system that consumes it (your terminal, the GitHub Secrets
store, the Azure Key Vault). If you find yourself about to paste a
secret somewhere it doesn't belong: stop, rotate, route through
the right channel.

## Logs + retention

| Sink | Retention | What's there |
|---|---|---|
| Log Analytics (Azure) | dev 90d / prod 180d | Engine request logs, traces, errors. |
| `usage.jsonl` (engine data dir) | indefinite | One line per generate / iterate / export — principal, route, model, tokens, cost. |
| `api_keys.json` (engine data dir) | indefinite | Key id + hash + owner + tier + last-used. Never the secret. |
| `notifications/<sub>.json` | per-user lifetime | Notification preferences. |
| Sentry (planned) | 90d | Frontend + engine exceptions. |

## Open hardening items

- [ ] WAF rules on Front Door Premium (OWASP Top 10) — currently
      Standard tier; requires SKU bump.
- [ ] Private endpoints for Storage / Cosmos / Redis / Key Vault
      (needs custom VNet on the ACA env).
- [ ] Customer-Managed Keys on Blob + Cosmos (regulated workloads).
- [ ] Centralised deployment audit log via GitHub Deployments API.
- [ ] CSP nonce strategy for Next 15 (drop `'unsafe-inline'` on
      script-src).
- [ ] CodeQL — enable in repo Settings → Code security.
