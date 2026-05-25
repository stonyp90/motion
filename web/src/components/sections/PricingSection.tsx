import { Check } from 'lucide-react';

const tiers = [
  {
    name: 'Self-hosted',
    price: 'Free',
    cadence: 'Apache-2.0',
    pitch: 'Run the whole pipeline on your laptop, your homelab, your VPC. Forever.',
    cta: { label: 'Get the binary', href: 'https://github.com/' },
    features: [
      'Full CLI + HTTP server',
      'All five theme presets',
      'Local SAM 2 + Whisper sidecars',
      'Bring-your-own LLM (Ollama / OpenAI / Anthropic / Azure)',
      'No usage limits — it&apos;s your hardware',
      'Community Discord support',
    ],
    highlighted: false,
  },
  {
    name: 'Cloud-managed',
    price: '$0.18',
    cadence: 'per 30s render · no seat fees',
    pitch: 'We run the Azure stack. You hit the API. Your bill scales with what you actually render.',
    cta: { label: 'Start a free trial', href: '#cta' },
    features: [
      'Everything in Self-hosted',
      'Managed Azure deployment (no Ops on your side)',
      'Front Door + WAF + CDN included',
      'Azure OpenAI gpt-5 LLM with PTU option',
      'p99 < 30s for iterate path',
      '99.9% SLA · email + Slack support',
    ],
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: 'Talk to us',
    cadence: 'private deployment',
    pitch: 'Your tenant, your model, your VPN. We deploy + support inside your perimeter.',
    cta: { label: 'Book exec demo', href: '#cta' },
    features: [
      'Everything in Cloud-managed',
      'Single-tenant deployment in your Azure / AWS / on-prem',
      'Bring your own fine-tuned model (LoRA / full)',
      'SAML / SCIM / RBAC, audit logs to your SIEM',
      'Dedicated solutions engineer for onboarding',
      '24/7 priority support · custom SLA',
    ],
    highlighted: false,
  },
];

export function PricingSection() {
  return (
    <section id="pricing" className="section">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow">Pricing</p>
          <h2 className="h-section mt-3">
            Pay for the rendering you do. Or don&apos;t pay at all.
          </h2>
          <p className="mt-5 text-lg text-text-secondary">
            Same engine across all three tiers. The difference is who runs it.
          </p>
        </div>

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {tiers.map((t) => (
            <article
              key={t.name}
              className={`relative flex flex-col rounded-2xl border bg-bg-primary p-7 transition ${
                t.highlighted
                  ? 'border-accent-300 shadow-glow ring-1 ring-accent-200'
                  : 'border-border-light shadow-soft hover:shadow-card'
              }`}
            >
              {t.highlighted && (
                <span className="absolute -top-3 left-7 chip border-accent-300 bg-accent-500 text-white">
                  Most teams pick this
                </span>
              )}
              <h3 className="text-lg font-semibold text-text-primary">{t.name}</h3>
              <p className="mt-2 text-sm text-text-tertiary">{t.pitch}</p>

              <div className="mt-6 flex items-baseline gap-2">
                <span className="text-4xl font-semibold tracking-tight text-text-primary">
                  {t.price}
                </span>
                <span className="text-sm text-text-tertiary">{t.cadence}</span>
              </div>

              <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" />
                    <span
                      className="text-text-secondary"
                      dangerouslySetInnerHTML={{ __html: f }}
                    />
                  </li>
                ))}
              </ul>

              <a
                href={t.cta.href}
                className={`mt-7 ${t.highlighted ? 'btn-accent' : 'btn-primary'}`}
              >
                {t.cta.label}
              </a>
            </article>
          ))}
        </div>

        <p className="mt-10 text-center text-xs text-text-tertiary">
          No per-seat licensing. No per-export. No surprise revision fees.
        </p>
      </div>
    </section>
  );
}
