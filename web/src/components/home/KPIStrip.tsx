'use client';

/**
 * KPIStrip — above-the-fold proof band for the simplified home.
 *
 * Tablix-clean KPI register: four `<dl>` definition pairs in a row, each
 * a single big number + tiny label + a one-line supporting fact.
 *
 * Motion: when the strip scrolls into view, each KPI fades up with a
 * 90ms stagger, and any numeric value counts up from 0 to the target
 * over ~1.2s with an eased curve. Non-numeric values (∞) fade up only.
 * Reduced motion: the hook flips `inView` true immediately, so the
 * count-up math runs once with no animation and lands on the final
 * digit.
 *
 * Design rules:
 *  - Numbers: `tabular-nums` so digits don't jitter while counting up.
 *  - Accent color (emerald) is reserved for the eyebrow label and the
 *    trailing square dot — a single Tablix-signature device.
 *  - No icons. Tablix-clean = numbers speak for themselves.
 *  - Light + dark theme via design tokens (no hex literals).
 *  - Semantic HTML: `<section>` > `<dl>` > `<div role="group">` >
 *    `<dt>`/`<dd>`. Screen-readers announce each KPI as a definition
 *    pair AND see the final value (the `aria-label` on the dd carries
 *    the static text so screen readers never see "0 min ... 1 min ...
 *    20 min").
 */

import { useEffect, useRef, useState } from 'react';
import { useInViewOnce } from '@/lib/hooks/useInViewOnce';

const COUNT_UP_DURATION_MS = 1200;
const STAGGER_PER_KPI_MS = 90;

export function KPIStrip() {
  const sectionRef = useRef<HTMLElement>(null);
  const inView = useInViewOnce(sectionRef);

  return (
    <section
      ref={sectionRef}
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
          {KPIS.map((kpi, i) => (
            <Kpi key={kpi.label} kpi={kpi} active={inView} delayMs={i * STAGGER_PER_KPI_MS} />
          ))}
        </dl>
      </div>
    </section>
  );
}

/**
 * Single KPI. Stagger fade-up via inline transition + delay, count-up
 * via rAF interpolation. Both are CSS / native browser primitives —
 * no animation library.
 */
function Kpi({
  kpi,
  active,
  delayMs,
}: {
  kpi: KpiData;
  active: boolean;
  delayMs: number;
}) {
  return (
    <div
      role="group"
      aria-label={kpi.label}
      className="flex flex-col gap-2 transition-all duration-700 ease-out"
      style={{
        opacity: active ? 1 : 0,
        transform: active ? 'translateY(0)' : 'translateY(16px)',
        transitionDelay: active ? `${delayMs}ms` : '0ms',
      }}
    >
      <dt className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-accent-700 dark:text-accent-400">
        {kpi.label}
      </dt>
      <dd
        // The label carries the final, stable value so screen readers
        // never narrate the count-up sequence ("0 min, 1 min, 2 min, ...").
        aria-label={kpi.value}
        className="flex items-baseline gap-1.5 text-4xl font-bold text-text-primary tabular-nums sm:text-5xl"
        style={{ letterSpacing: '-0.025em' }}
      >
        <CountUpValue value={kpi.value} active={active} delayMs={delayMs} />
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
  );
}

/**
 * Renders a KPI value, animating any leading integer up from 0 to its
 * target when `active` flips true. Non-numeric prefixes (e.g. "∞") just
 * render statically. Suffix (e.g. " min", " day", " %") is preserved
 * verbatim.
 */
function CountUpValue({
  value,
  active,
  delayMs,
}: {
  value: string;
  active: boolean;
  delayMs: number;
}) {
  // Split into (leading number) + (rest). Examples:
  //   "20 min" → ["20", " min"]
  //   "90 %"   → ["90", " %"]
  //   "1 day"  → ["1",  " day"]
  //   "∞"      → [null, "∞"] — render static
  const match = value.match(/^(\d+)(.*)$/);
  const target = match ? parseInt(match[1]!, 10) : null;
  const suffix = match ? match[2] : value;

  const [displayed, setDisplayed] = useState(target === null ? null : 0);

  useEffect(() => {
    if (!active || target === null) return;
    const start = performance.now() + delayMs;
    let raf = 0;
    const step = (now: number) => {
      const elapsed = now - start;
      if (elapsed < 0) {
        raf = requestAnimationFrame(step);
        return;
      }
      const t = Math.min(1, elapsed / COUNT_UP_DURATION_MS);
      // Eased cubic-out — fast at the start, slows into the target.
      // Same curve as the brand-motion "Decelerate" easing.
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayed(Math.round(target * eased));
      if (t < 1) {
        raf = requestAnimationFrame(step);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [active, target, delayMs]);

  if (target === null) {
    // Non-numeric (∞) — just render verbatim.
    return <span>{value}</span>;
  }

  return (
    <span>
      {displayed}
      {suffix}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Data — kept colocated so the file is self-contained and reviewable */
/* in a single screen. Edit COPY.md if you change these.              */
/* ------------------------------------------------------------------ */

type KpiData = {
  /** Hero number. Keep <= 5 chars so the four columns visually balance. */
  value: string;
  /** Uppercase mono label. <= 28 chars, sentence-case for the unit. */
  label: string;
  /** One-line credible supporting fact. <= 70 chars. */
  detail: string;
};

const KPIS: ReadonlyArray<KpiData> = [
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
