# Runbook: incident response

Scope: a production incident on `motion.ursly.io` or the underlying `rg-motion-forge-prod` resource group. SOC 2 CC7 maps to this document; revisions are tracked in git, the audit container in Cosmos captures every executed action, and the post-mortem is required for any Sev 1 or Sev 2.

If you are reading this because the page is on fire, jump to [Sev 1 fast-path](#sev-1-fast-path) and come back later.

---

## 1. Severity definitions

| Sev | Definition | Examples | Response time |
| --- | --- | --- | ---: |
| 1 | Production is down or data is at risk. | API returns 5xx > 5 % over 5 min; Keycloak unreachable; Blob outage; private data leak. | Page primary + secondary within 5 min |
| 2 | Major degradation, no data loss. | p95 latency > 10 s on `/generate`; render success rate < 80 %; STT WebSocket disconnects > 30 %. | Acknowledge within 15 min |
| 3 | Minor degradation. | Cast library 404s; web-export beta formats failing; metrics gap. | Next business day |
| 4 | Cosmetic / non-prod. | Dev cluster failure; doc typo; stale dashboard. | Tracked in issues; no on-call action |

The pager rules in `infra/monitoring/` translate Application Insights alerts directly to these levels — the alert that fires names its severity in the title.

---

## 2. Sev 1 fast-path

You have 30 minutes to stabilise. Do these, in order, until the page clears:

1. **Acknowledge** the page. The on-call rotation auto-acks if you don't, but explicit ack stops the secondary from being woken up.
2. **Open the incident channel.** `#inc-<yyyymmdd-hhmm>` on the team chat. Post the alert link and pin the alert.
3. **Identify scope.** Open `https://portal.azure.com → Application Insights → mf-prod-ai → Failures` and confirm the failure surface. Web, API, render job, or external dependency?
4. **Apply the mitigation tier matching the surface** (see [section 4](#4-mitigation-playbooks)).
5. **Communicate.** Post a single-line status update to the incident channel every 15 minutes until resolved.
6. **Resolve the alert** when synthetic monitors pass for 10 consecutive minutes.
7. **Schedule the post-mortem** before you close your laptop. Template in [section 6](#6-post-mortem).

---

## 3. Diagnostic kit

The on-call laptop should have these ready before the page hits. The first time you go on call, run them once to confirm they all work.

```bash
# Azure context
az account set --subscription "<motion-forge-prod-sub-id>"
az group show -n rg-motion-forge-prod -o table

# Tail the API logs
az containerapp logs show -g rg-motion-forge-prod -n mf-api --tail 200 --follow

# Tail the render job logs (last run)
az containerapp job execution list -g rg-motion-forge-prod -n mf-render-job \
  --query "[0].name" -o tsv | xargs -I{} \
  az containerapp job logs show -g rg-motion-forge-prod -n mf-render-job --execution {}

# Front Door synthetic
curl -fsS https://motion.ursly.io/healthz
curl -fsS https://motion.ursly.io/openapi.json | jq '.info'

# Keycloak liveness
curl -fsS https://motion.ursly.io/auth/realms/motion-forge/.well-known/openid-configuration | jq '.issuer'

# Cosmos query — is the audit log writing?
az cosmosdb sql query --account-name mf-prod-cosmos \
  -g rg-motion-forge-prod --database-name mf-meta \
  --container-name audits \
  --query-text "SELECT TOP 5 c.timestamp, c.action, c.tenantId FROM c ORDER BY c.timestamp DESC"

# Redis depth (rate-limit + queue health)
az redis show -n mf-prod-redis -g rg-motion-forge-prod --query "hostName" -o tsv
# Then redis-cli -h <host> -p 6380 --tls -a <key> XLEN q:render:default
```

All commands assume `az login` with the on-call's account, which is granted `Reader` + `Container Apps Operator` on the prod RG. The on-call does **not** have write access to Cosmos, Blob, or Key Vault — write actions go through a JIT elevation (`az pim`) and are audited.

---

## 4. Mitigation playbooks

### 4.1 API 5xx surge

Symptoms: Application Insights `requests` segmented by `resultCode` shows 500/502/503 spikes.

Triage:
1. Tail the API logs. Look for repeated panic messages or `tower_http::trace` 500 lines.
2. If the surge correlates with a deploy in the last 30 min, **roll back**:
   ```bash
   az containerapp revision list -g rg-motion-forge-prod -n mf-api -o table
   az containerapp ingress traffic set -g rg-motion-forge-prod -n mf-api \
     --revision-weight <previous-stable-revision>=100 <current-revision>=0
   ```
3. If not a deploy, check Azure status (`https://status.azure.com` — pin this) and Azure OpenAI status (separate page). If a dependency is degraded, switch the LLM backend:
   ```bash
   az containerapp update -g rg-motion-forge-prod -n mf-api \
     --set-env-vars MOTION_FORGE_LLM_BACKEND=anthropic
   ```
   The Anthropic key is in Key Vault under `MotionForgeAnthropicKey`.
4. If neither: scale up. The API min-replicas is 1; bump to 3 to absorb load while diagnosing.

### 4.2 Render queue backlog

Symptoms: `mf-render-job` execution count flat, queue depth growing, users see "queued" indefinitely.

Triage:
1. Confirm KEDA scaler health: `az containerapp job execution list -g rg-motion-forge-prod -n mf-render-job -o table`.
2. If executions are running but slow: bump `max-executions` in the job spec.
3. If executions are not starting: confirm the job has image-pull credentials and that ACR is healthy. The MI must have `AcrPull` on the registry.
4. If a poison message is killing the worker: list the queue with `az storage queue message peek` and **move the offending message to the DLQ** before re-enabling. Do not delete user data.

### 4.3 Keycloak outage

Symptoms: every sign-in fails; `/api/auth/callback/keycloak` returns 502.

Triage:
1. `az containerapp show -g rg-motion-forge-prod -n mf-keycloak --query "properties.runningStatus"`.
2. If down: roll back to the previous revision. Keycloak is intentionally a single-region single-replica for v0.1; outages here block all sign-ins.
3. If the underlying Postgres is the cause: `az postgres flexible-server show -g rg-motion-forge-prod -n mf-prod-kc-pg --query "state"`. Restart with `az postgres flexible-server restart`.
4. While Keycloak is down: existing sessions continue to work (the JWKS cache on the API holds for 12 h). Communicate the impact: new sign-ins blocked, in-flight users unaffected.

### 4.4 Suspected data leak

Symptoms: an external party reports they can read another tenant's output; a security scan flags an open Blob container; the audit log shows cross-tenant reads.

Triage:
1. **Page the security lead first**, then the primary on-call. Both must be in the channel before any mitigation runs.
2. Snapshot the audit log: `az cosmosdb sql container show -g rg-motion-forge-prod --account-name mf-prod-cosmos --database-name mf-meta --name audits`, then export to Blob.
3. If the leak is a Blob container ACL: revoke public access on every container in the storage account:
   ```bash
   az storage account update -g rg-motion-forge-prod -n mfprodstor \
     --allow-blob-public-access false
   ```
4. If the leak is a code bug in a tenant filter: pull the offending revision (see 4.1 rollback). Do not deploy a forward fix until the root cause is in the post-mortem.
5. Disclosure: notify affected tenants within 72 hours per the customer DPA. The legal contact is in the secrets vault under `legal-contact.json`.

---

## 5. Communication template

Post in the incident channel. Update every 15 minutes for Sev 1, every 30 for Sev 2.

```
INC-<YYYYMMDD-HHMM> | SEV-<n> | <component>

Status: <investigating | mitigating | monitoring | resolved>
Impact: <single sentence; numbers if you have them>
Timeline:
  HH:MM  <event>
  HH:MM  <event>

Owner: @<incident-commander>
Next update: <HH:MM in the same TZ>
```

Public-facing status: post to `https://status.motion-forge.io` for Sev 1 within 30 min, Sev 2 within 60 min. The status page is a static site under `web/status/` with a small admin tool; the on-call has write access through Key Vault.

---

## 6. Post-mortem

Required for Sev 1 and Sev 2 within 5 business days of resolution. The template lives at `.github/ISSUE_TEMPLATE/post-mortem.md`. Headings:

- **Summary** — three sentences. What broke, who was affected, how it was fixed.
- **Timeline** — UTC timestamps from alert to resolution.
- **Detection** — what fired, what didn't fire (and should have).
- **Mitigation** — what you did, why it worked.
- **Root cause** — 5-whys analysis; cite the offending code path / config / dependency.
- **Customer impact** — number of tenants, number of failed requests, data exposed if any.
- **Action items** — each one a tracked issue with an owner and a deadline. Categorise as `prevent`, `detect`, `mitigate`.
- **Lessons learned** — not blame, not platitudes; one or two sentences of actual learning.

The post-mortem is reviewed in the next weekly engineering meeting. Action items with a deadline > 30 days require a follow-up review.

---

## 7. Escalation contacts

The on-call doc in `engineering/oncall.md` (internal repo) lists the rotation. Out-of-band channels:

| Role | Channel | When to escalate |
| --- | --- | --- |
| Engineering lead | direct phone | Sev 1 lasting > 60 min |
| Security lead | direct phone + email | Suspected breach; any data-leak playbook step |
| Customer success | shared inbox | Communications to affected customers |
| Legal | escalation form | Breach notification > 100 affected tenants |
| Azure premier support | severity-A ticket | Azure-side outage confirmed; auto-attaches the deployment subscription |

Names and numbers are intentionally not in this repo. They live in the secrets vault under `oncall-contacts.json` and rotate quarterly.
