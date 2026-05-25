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
              <dt className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-text-tertiary">
                {kpi.label}
              </dt>
              <dd className="flex items-baseline gap-1 text-4xl font-semibold tracking-tight text-text-primary tabular-nums sm:text-5xl">
                {kpi.value}
                {/* Tablix-signature trailing square dot — emerald accent. */}
                <span
                  aria-hidden="true"
                  className="inline-block h-1.5 w-1.5 rounded-[1px] bg-accent-500"
                />
              </dd>
              <dd className="text-sm leading-snug text-text-secondary">
                {kpi.detail}
              </dd>
            </div>
          ))}
        </dl>

        {/* OKR strip — three single-line promises stacked on mobile, inline
            with vertical dividers on desktop. Plain text only; the KPI grid
            already carries the visual weight. */}
        <ul
          aria-label="What motion-forge promises"
          className="mt-14 flex flex-col items-center justify-center gap-3 text-center text-lg font-medium text-text-primary sm:text-xl lg:mt-16 lg:flex-row lg:flex-wrap lg:gap-x-8 lg:gap-y-2"
        >
          {OKRS.map((okr, i) => (
            <li
              key={okr}
              className={
                'flex items-center gap-3 lg:gap-8 ' +
                (i > 0
                  ? 'lg:before:inline-block lg:before:h-1 lg:before:w-1 lg:before:rounded-[1px] lg:before:bg-accent-500'
                  : '')
              }
            >
              {okr}
            </li>
          ))}
        </ul>
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
    detail: 'A 60-second explainer, end-to-end. Agencies quote 20 days.',
  },
  {
    value: '90 s',
    label: 'First render latency',
    detail: 'Script segmentation, casting, Lottie compose, MP4 export.',
  },
  {
    value: '<1 s',
    label: 'Iteration after a change',
    detail: 'Only the touched scene re-renders; the rest is cached.',
  },
  {
    value: '$0.18',
    label: 'Cost per finished spot',
    detail: 'Marginal compute on a mid-tier GPU. Down from $5k+ at an agency.',
  },
] as const;

const OKRS: ReadonlyArray<string> = [
  'Cut explainer-video turnaround from weeks to hours.',
  'Make every iteration cheaper than a Slack thread.',
  'Keep brand assets on your network, never on a vendor cloud.',
] as const;
