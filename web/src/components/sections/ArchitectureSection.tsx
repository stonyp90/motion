import { Cloud, Cpu, Database, Globe, Lock, ServerCog } from 'lucide-react';

const layers = [
  {
    icon: Globe,
    label: 'Edge',
    detail: 'Azure Front Door (Premium WAF) → terminates TLS, caches static, keeps the API warm globally.',
  },
  {
    icon: ServerCog,
    label: 'API',
    detail: 'Rust axum binary on Azure Container Apps. min_replicas = 1. Sub-200ms response, no cold start.',
  },
  {
    icon: Cpu,
    label: 'Heavy jobs',
    detail: 'GPU (T4/A100) ACA Jobs for SAM 2 segmentation. CPU dedicated for Lottie → MP4 render. KEDA scales to zero when idle.',
  },
  {
    icon: Database,
    label: 'State',
    detail: 'Blob Storage for work-dirs + outputs (Hot → Cool → Archive lifecycle). Cosmos DB serverless for projects + job index. Redis for cache.',
  },
  {
    icon: Lock,
    label: 'Auth + secrets',
    detail: 'User-Assigned Managed Identity across the board. Key Vault holds only the unavoidable third-party keys.',
  },
  {
    icon: Cloud,
    label: 'LLM',
    detail: 'Azure OpenAI (gpt-5 / Phi-4) — or Ollama on your own GPU, or Anthropic, or OpenAI direct. Backend-agnostic.',
  },
];

export function ArchitectureSection() {
  return (
    <section id="architecture" className="section bg-primary-900 text-text-inverse">
      <div className="container">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:items-start">
          <div>
            <p className="eyebrow text-accent-400">Architecture</p>
            <h2 className="h-section mt-3 text-text-inverse">
              Built for the operator who&apos;ll have to run it for the next five years.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-primary-200">
              Hexagonal Rust workspace. Single-file Bicep IaC. OIDC-federated
              GitHub Actions deploy. Every backend is a port-and-adapter, so
              swapping our SAM 2 segmenter for an in-house model — or our
              Azure OpenAI dependency for an air-gapped Ollama — is a
              one-file change, not a rewrite.
            </p>

            <ul className="mt-8 space-y-3 text-sm text-primary-100">
              <li className="flex items-start gap-3">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400" />
                <span>
                  <strong className="text-text-inverse">Three deployment shapes:</strong>{' '}
                  CLI on your laptop · Docker on your homelab · Azure (Bicep template included)
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400" />
                <span>
                  <strong className="text-text-inverse">No cold start on iterate:</strong>{' '}
                  warm replica + Front Door edge + LLM probe with 1.5s timeout
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400" />
                <span>
                  <strong className="text-text-inverse">OpenAPI 3.1 spec</strong> at{' '}
                  <code className="font-mono text-accent-300">/openapi.json</code> — generate clients
                  in any language, wire into your existing platform
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400" />
                <span>
                  <strong className="text-text-inverse">Cost transparency:</strong>{' '}
                  ~$180/mo at small scale, ~$1.8k at 1,000 spots/day. No per-seat surprises.
                </span>
              </li>
            </ul>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {layers.map((l) => (
              <div
                key={l.label}
                className="rounded-2xl border border-primary-700/50 bg-primary-800/50 p-5 backdrop-blur transition hover:border-accent-400/40 hover:bg-primary-800"
              >
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-500/20 text-accent-300">
                    <l.icon className="h-4 w-4" />
                  </span>
                  <p className="text-sm font-semibold text-text-inverse">{l.label}</p>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-primary-200">{l.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
