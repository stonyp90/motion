import { Clock, DollarSign, Repeat2, ShieldCheck } from 'lucide-react';

const stats = [
  {
    icon: Clock,
    value: '90s',
    label: 'Reference video → final MP4',
    sub: 'Including segmentation, style extraction, LLM + render.',
  },
  {
    icon: Repeat2,
    value: '<1s',
    label: 'Re-prompt iteration latency',
    sub: 'Cached work-dir; only the LLM + Lottie write runs.',
  },
  {
    icon: DollarSign,
    value: '$0.18',
    label: 'Marginal cost per 30s spot',
    sub: 'On Azure, medium tier. Compare to $5k+ agency invoice.',
  },
  {
    icon: ShieldCheck,
    value: '100%',
    label: 'Local-first by default',
    sub: 'Brand assets never leave your network unless you opt in.',
  },
];

export function ProofSection() {
  return (
    <section id="proof" className="section-tight section-subtle border-y border-border-light">
      <div className="container">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col gap-2 p-2">
              <div className="flex items-center gap-2.5 text-motion">
                <s.icon className="h-4 w-4" />
                <span className="label">{s.label}</span>
              </div>
              <p className="text-4xl font-semibold tracking-tight text-text-primary">{s.value}</p>
              <p className="text-sm text-text-tertiary">{s.sub}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
