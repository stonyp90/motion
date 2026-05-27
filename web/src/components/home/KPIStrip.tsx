/**
 * KPIStrip — above-the-fold proof band for the simplified home.
 *
 * Replaces the old `ProofSection` (icon-decorated marketing band) with a
 * Tablix-clean KPI register: four `<dl>` definition pairs in a row, each
 * one a single big number + tiny label + a one-line supporting fact. A
 * single OKR statement sits below the strip as the value promise the
 * product makes to the buyer.
 *
 * Design rules (see DESIGN_NOTES.md for full rationale):
 *  - Numbers: `h-display`-style weight + `tabular-nums` so the digits line up
 *    across the four columns even when the strings are mixed-width.
 *  - Accent color (emerald) is reserved for the eyebrow label and a 1.5px
 *    square dot trailing each KPI value — a single Tablix-signature device.
 *  - No icons. Tablix-clean = numbers speak for themselves.
 *  - Light + dark theme work without modification because every color is
 *    a design-token utility (no hex literals).
 *  - Semantic HTML: `<section>` > `<dl>` > `<div role="group">` > `<dt>`/`<dd>`.
 *    Screen-readers announce each KPI as a definition pair.
 */
export function KPIStrip() {
  return (
    <section
      id="kpi"
      aria-labelledby="kpi-heading"
      className="section-tight border-y border-border-light bg-bg-secondary"
    >
      <div className="container">
        {/* Visually-hidden heading — keeps the strip a real landmark without
            stealing visual hierarchy from the hero above. */}
        <h2 id="kpi-heading" className="sr-only">
          Motion-forge by the numbers
        </h2>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-x-8">
          {KPIS.map((kpi) => (
            <div
              key={kpi.label}
              role="group"
              aria-label={kpi.label}
              className="flex flex-col gap-2"
            >
              <dt className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-accent-700 dark:text-accent-400">
                {kpi.label}
              </dt>
              <dd className="flex items-baseline gap-1.5 text-4xl font-bold text-text-primary tabular-nums sm:text-5xl" style={{ letterSpacing: '-0.025em' }}>
                {kpi.value}
                {/* Tablix-signature trailing square dot — emerald accent. */}
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 rounded-[2px] bg-accent-600 dark:bg-accent-400"
                />
              </dd>
              <dd className="text-sm leading-snug text-text-secondary">
                {kpi.detail}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Data — kept colocated so the file is self-contained and reviewable */
/* in a single screen. Edit COPY.md if you change these.              */
/* ------------------------------------------------------------------ */

type Kpi = {
  /** Hero number. Keep <= 5 chars so the four columns visually balance. */
  value: string;
  /** Uppercase mono label. <= 28 chars, sentence-case for the unit. */
  label: string;
  /** One-line credible supporting fact. <= 70 chars. */
  detail: string;
};

const KPIS: ReadonlyArray<Kpi> = [
  {
    value: '20 min',
    label: 'Brief to finished spot',
    detail: 'A polished 60-second explainer, same day. Agencies quote 20 days.',
  },
  {
    value: '1 day',
    label: 'Pilot to first launch',
    detail: 'Onboarding, brand setup, first three motion graphics shipped in 24 hours.',
  },
  {
    value: '90 %',
    label: 'Lower production cost',
    detail: 'Per-spot spend in dollars, not the four-figure agency invoice.',
  },
  {
    value: '∞',
    label: 'Iterations per campaign',
    detail: 'Re-cut to a new tagline, new audience, new market in seconds.',
  },
] as const;
