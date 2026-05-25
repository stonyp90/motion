import { Check, X } from 'lucide-react';

const rows = [
  {
    label: '30-second branded spot',
    agency: { v: '$5k – $25k', good: false },
    inhouse: { v: '$3k – $8k loaded cost', good: false },
    forge: { v: '$0.18 marginal · 90s', good: true },
  },
  {
    label: 'Time to first draft',
    agency: { v: '5 – 15 business days', good: false },
    inhouse: { v: '1 – 3 days', good: false },
    forge: { v: '90 seconds', good: true },
  },
  {
    label: 'Cost per iteration',
    agency: { v: '$500 – $2k revision fee', good: false },
    inhouse: { v: '4 – 8 hours of designer time', good: false },
    forge: { v: '~150 ms · ~$0.001', good: true },
  },
  {
    label: 'Stays on-brand at scale',
    agency: { v: 'depends on the day', good: false },
    inhouse: { v: 'yes (one designer)', good: true },
    forge: { v: 'enforced by theme presets', good: true },
  },
  {
    label: 'Your data leaves your network',
    agency: { v: 'always', good: false },
    inhouse: { v: 'rarely', good: true },
    forge: { v: 'never (local-first)', good: true },
  },
  {
    label: 'Editable output (Lottie / AE-compatible)',
    agency: { v: 'when invoiced', good: false },
    inhouse: { v: 'yes', good: true },
    forge: { v: 'yes — default', good: true },
  },
  {
    label: 'CI / CMS integration',
    agency: { v: 'email + Dropbox', good: false },
    inhouse: { v: 'manual', good: false },
    forge: { v: 'REST API + OpenAPI spec', good: true },
  },
  {
    label: 'Scales with launches, not headcount',
    agency: { v: 'no', good: false },
    inhouse: { v: 'no', good: false },
    forge: { v: 'yes', good: true },
  },
];

export function ComparisonSection() {
  return (
    <section id="compare" className="section">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow">For the decision-maker</p>
          <h2 className="h-section mt-3">
            Honest comparison. We&apos;d rather you choose us with eyes open.
          </h2>
          <p className="mt-5 text-lg text-text-secondary">
            motion-forge replaces the recurring spend, not the rare cinematic project.
            Use an agency when you need a hero film once a year. Use us for the other 50.
          </p>
        </div>

        <div className="mt-14 overflow-hidden rounded-2xl border border-border-light bg-bg-primary shadow-soft">
          <div className="hidden lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-bg-tertiary text-left">
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                    Capability
                  </th>
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                    Agency
                  </th>
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                    In-house designer
                  </th>
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-text-accent">
                    motion-forge
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.label} className={i % 2 === 0 ? 'bg-bg-primary' : 'bg-bg-secondary'}>
                    <td className="px-6 py-4 font-medium text-text-primary">{row.label}</td>
                    <Cell c={row.agency} />
                    <Cell c={row.inhouse} />
                    <Cell c={row.forge} highlight />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: stacked cards */}
          <div className="lg:hidden divide-y divide-border-light">
            {rows.map((row) => (
              <div key={row.label} className="px-5 py-5">
                <p className="text-sm font-semibold text-text-primary">{row.label}</p>
                <dl className="mt-3 grid grid-cols-1 gap-2 text-sm">
                  <MobileCell label="Agency" c={row.agency} />
                  <MobileCell label="In-house" c={row.inhouse} />
                  <MobileCell label="motion-forge" c={row.forge} highlight />
                </dl>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

type CellShape = { v: string; good: boolean };

function Cell({ c, highlight = false }: { c: CellShape; highlight?: boolean }) {
  return (
    <td className={`px-6 py-4 ${highlight ? 'bg-accent-50/40' : ''}`}>
      <div className="flex items-center gap-2">
        {c.good ? (
          <Check className="h-4 w-4 shrink-0 text-accent-600" />
        ) : (
          <X className="h-4 w-4 shrink-0 text-neutral-400" />
        )}
        <span className={highlight ? 'font-semibold text-text-primary' : 'text-text-secondary'}>
          {c.v}
        </span>
      </div>
    </td>
  );
}

function MobileCell({
  label,
  c,
  highlight = false,
}: {
  label: string;
  c: CellShape;
  highlight?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 ${highlight ? 'bg-accent-50' : ''}`}>
      <dt className="text-xs font-medium uppercase tracking-wider text-text-tertiary">
        {label}
      </dt>
      <dd
        className={`flex items-center gap-1.5 text-right text-sm ${highlight ? 'font-semibold text-text-primary' : 'text-text-secondary'}`}
      >
        {c.good ? (
          <Check className="h-3.5 w-3.5 text-accent-600" />
        ) : (
          <X className="h-3.5 w-3.5 text-neutral-400" />
        )}
        {c.v}
      </dd>
    </div>
  );
}
