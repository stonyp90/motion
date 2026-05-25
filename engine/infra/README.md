# motion-forge — Azure serverless infrastructure

Cost-effective, performance-effective, **no-cold-start** Azure stack that
matches the motion-forge workload profile (latency-sensitive `iterate` +
async heavy `generate` / `panelize`).

```
                     Azure Front Door Premium (global L7, WAF, CDN)
                                      │
                ┌─────────────────────┼─────────────────────┐
                ▼                     ▼                     ▼
       static MP4 cache         /healthz, /themes      /generate, /iterate, /panelize
       (Blob via FD origin)     /openapi.json          ACA Ingress
                                                            │
                                                            ▼
                         ┌──────────────────────────────────────────┐
                         │ Container Apps Environment               │
                         │ (Workload Profiles)                      │
                         │                                          │
                         │ mf-api           min=1, Consumption      │ ← always warm
                         │  (axum binary)                           │
                         │                                          │
                         │ mf-segment-job   Job, NC8as-T4-v3 GPU    │ ← KEDA queue
                         │  (SAM 2 + YOLO via ultralytics)          │
                         │                                          │
                         │ mf-render-job    Job, D4 dedicated CPU   │ ← KEDA queue
                         │  (lottie Python sidecar)                 │
                         └──────────────────────────────────────────┘
                                            │
              ┌─────────────────┬───────────┴──────────┬────────────────┐
              ▼                 ▼                      ▼                ▼
       Azure Blob       Azure Cosmos DB        Azure Cache for     Azure Storage
       (Hot/Cool/Arch)  (Serverless)            Redis (Basic)      Queue
       work-dirs        project + job index     session, idemp.    job dispatch
       outputs (MP4)
              │
              │  Lifecycle: Hot 7d → Cool 30d → Archive 90d
              ▼
       Azure Files (NFSv4.1, mounted into ACA)
       model weights, theme presets, shared cache

                      ┌───────────────────────────┐
                      │ Azure OpenAI Service      │ ← always warm SaaS
                      │ gpt-5  (Standard or PTU)  │
                      │ + AI Foundry catalogue    │
                      │   (Phi-4, Llama 3.3 70B)  │
                      └───────────────────────────┘

  Auth: User-Assigned Managed Identity across the board. No connection
  strings. Key Vault holds only the few unavoidable bearer secrets
  (third-party LLM keys if used).

  Observability: Application Insights + Log Analytics + Azure Monitor;
  OpenTelemetry collector deployed as a sidecar app for unified ingest.
```

## Why this shape

| Constraint | Lever |
|---|---|
| **No cold start on `iterate`** | `mf-api` min_replicas = 1 → always-warm replica; Front Door keeps TCP warm globally; Azure OpenAI is SaaS-warm; LLM probe timeout 1.5s; iterate body reads cached Blob state in <1 RTT |
| **Cost-effective at idle** | Heavy work (SAM 2, render) runs as ACA Jobs that scale to zero when the queue is empty; only the API replica + Front Door + Redis pay baseline |
| **Performance-effective on `generate`** | SAM 2 runs on a T4 GPU workload profile (~10× faster than CPU on macOS dev box); pre-pulled image on the profile; KEDA wakes the job in ~15 s when the queue has a message |
| **Cutting edge 2026** | ACA serverless GPU (GA 2025, expanded SKUs 2026); Workload Profiles let you mix Consumption + Dedicated CPU + GPU in one env; Cosmos Serverless billing; Front Door Premium WAF |
| **Backend-agnostic LLM (preserved)** | App reads `MOTION_FORGE_LLM_BACKEND` env: `azure-openai` (default in cloud), `ollama` (local dev), `anthropic` / `openai` cloud fallbacks. Auto-detect order unchanged |

## What runs where

| Component | Service | SKU / size | Why |
|---|---|---|---|
| Edge / WAF / CDN | Azure Front Door | Premium | Global anycast, WAF, private-link origins, $0.022/GB after first TB free |
| API (axum) | Container Apps | Consumption, min=1 max=10 | Always-warm replica eliminates cold start; consumption scales up on demand |
| SAM 2 segment | ACA Jobs | Workload Profile `Consumption-GPU-NC8as-T4-v3` | Burstable GPU; ~$1.20/hr while running; $0 idle |
| MP4 render | ACA Jobs | Workload Profile `D4` dedicated CPU | Predictable CPU for ffmpeg/lottie sidecar; can also run on Consumption |
| Object storage | Blob Storage | StorageV2, Hot → lifecycle to Cool/Archive | Cheapest scaled storage; CDN-origin-ready |
| Shared FS | Azure Files | Premium NFSv4.1, 100 GiB | Model weights & themes accessible from any replica/job |
| Project DB | Cosmos DB | Serverless, NoSQL API | Per-request billing; ~10ms p50; no provisioned throughput to overspend on |
| Cache / rate limit | Azure Cache for Redis | Basic C0 | $16/mo; in-memory state, idempotency keys, /healthz cache |
| Queue | Azure Storage Queue | Standard | $0.0004/10k ops; KEDA-native scaler |
| LLM | Azure OpenAI Service | gpt-5 Standard (PTU for predictable load) | First-party; no rate-limit surprises; PII compliant |
| Backup LLM | Azure AI Foundry serverless catalogue | Phi-4 / Llama 3.3 70B | Pay-per-token, cheaper than gpt-5 for routine prompts |
| Secrets | Azure Key Vault | Standard | Only third-party API keys; everything Azure-native is Managed Identity |
| Registry | Azure Container Registry | Premium, geo-replicated | Image pulls into ACA from local region |
| Observability | App Insights + Log Analytics | Pay-per-GB | Single workspace for all components |

## Cold-start strategy in detail

The `iterate` path is the one users feel viscerally. It must be sub-second
even when the model service is misbehaving. Layered defenses:

1. **`mf-api` always-warm**: `min_replicas: 1`. ~$14/mo baseline cost. Worth it.
2. **Front Door global edge** keeps TCP/TLS sessions warm to every PoP, eliminating connection-setup latency for users in remote regions.
3. **Azure OpenAI is SaaS-warm**. The LLM call has p50 < 200 ms for short JSON outputs on Standard tier.
4. **LLM probe timeout**: code already enforces 1.5 s probe + `MOTION_FORGE_LLM_TIMEOUT_SEC` (default 90, recommended 30 in prod) on the actual call. A misbehaving model can't hold `iterate` hostage.
5. **Cached work-dir on Blob**: `iterate` reads `style.json`, `pipeline.json`, `theme.json` from Blob — 3 small reads, parallel — typically <50 ms total over the warm AAD-auth'd HTTP/2 connection.
6. **Mock fallback** is always reachable in code; if every backend fails, we still return a valid `LottieTimeline` in <5 ms.

Heavy phases (`generate`, `panelize`) are accepted to cold-start a few seconds — users are already paying tens of seconds of SAM 2 / render time, so a 15 s container start cost is invisible. The mitigation that matters there is the **pre-pulled image** on the workload profile, not min-replicas.

## Cost model

| Scale | Generates/day | Users | Monthly cost |
|---|---:|---:|---:|
| Dev / staging | 10 | 1-2 | ~$70 |
| Small | 50 | 10 | ~$180 |
| Medium | 1 000 | 100 | ~$1 800 |
| Large | 10 000 | 1 000 | ~$15 000-30 000 |

Top line items at the **medium** tier:
- Azure OpenAI gpt-5 (~300 M tokens/mo): **~$900**
- ACA segment job, ~10 GPU-hr/day: **~$360**
- ACA render job, ~25 CPU-hr/day: **~$150**
- Front Door Standard: **~$60**
- ACR Premium: **~$120**
- Cosmos / Redis / Blob / Files / observability: **~$200**

Cost-trimming options at scale:
- Move LLM to **PTU** once the load is predictable (~30 % cost reduction over Standard).
- Swap Azure OpenAI for **Phi-4 on AI Foundry serverless** for routine prompts (~70 % cheaper, slight quality drop).
- **Reserve** the `mf-api` baseline instance — 1-year RI ≈ 30 % off.
- **Lifecycle policies** auto-tier Blob to Cool after 7 d and Archive after 30 d — typically cuts storage cost by 70 % on past projects.

## Deploying

Prerequisites:
- `az` CLI ≥ 2.65 (or use Azure Cloud Shell)
- Subscription with these resource providers registered: `Microsoft.App`, `Microsoft.ContainerRegistry`, `Microsoft.CognitiveServices`, `Microsoft.DocumentDB`, `Microsoft.Cache`, `Microsoft.Storage`, `Microsoft.Cdn`, `Microsoft.OperationalInsights`, `Microsoft.Insights`, `Microsoft.KeyVault`
- Quota for the GPU SKU you choose (default `NC8as-T4-v3` in `eastus`)
- Azure OpenAI access (request access if you haven't yet)

One-shot deploy:
```bash
cd infra
./deploy.sh --env dev --location eastus
# or:
./deploy.sh --env prod --location westeurope
```

What `deploy.sh` does:
1. Creates the resource group `rg-motion-forge-<env>` if missing
2. Runs `az deployment group create` against `main.bicep` with the matching `parameters.<env>.bicepparam`
3. Pushes the local image to the new ACR (`docker push`) and bumps the ACA revision
4. Prints the Front Door endpoint URL when done

To **tear down**: `az group delete --name rg-motion-forge-<env> --yes` removes everything in the RG. The Cosmos account is set to `enableSoftDelete: false` for clean teardown — change in prod.

## What this doesn't include yet

Intentional omissions (each is a follow-on PR when needed):
- **Bring-your-own-domain + cert** via Front Door custom domains (1-line addition to `main.bicep`).
- **Defender for Cloud** workspace integration (one resource).
- **Private DNS zones** for the Storage / Cosmos / OpenAI private endpoints — added when you wire your own VNet.
- **GitHub Actions OIDC federated identity** so CI deploys without storing a client secret — see `.github/workflows/deploy.yml` (skeleton lives there).
- **Multi-region failover** — main.bicep is single-region; Front Door already supports adding more origins, but Cosmos + Blob need geo-replicated counterparts.
