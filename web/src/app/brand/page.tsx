'use client';

/* /brand — source of truth for the motion-forge design system.
 *
 * What this page is: a visual catalog of every brand primitive that lives
 * in globals.css + tailwind.config.ts. Open it side-by-side with those
 * files and use the global ThemeToggle (top-right) to confirm dark-mode
 * re-tunes hold up.
 *
 * What this page is NOT: a marketing page. It uses the real type/spacing
 * tokens, but its job is documentation, not persuasion.
 *
 * Philosophy (verbatim from globals.css):
 *
 *   "Calm authority. Linear-style restraint. Tablix-clean. Never bouncy.
 *    Motion always communicates state. It never decorates."
 *
 * Allocation rule for easings: 60% out-quart, 30% snap, 10% in-quart.
 */

import { useState, type ReactNode, type CSSProperties } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Check,
  Github,
  Loader2,
  Mic,
  Sparkles,
  Square,
} from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useTheme } from '@/components/ThemeProvider';
import { MotionLogo } from '@/components/MotionLogo';

export default function BrandPage() {
  return (
    <main className="min-h-screen bg-bg-primary text-text-primary">
      <BrandHeader />

      <LogoSection />
      <PaletteSection />
      <SurfacesSection />
      <ShadowsSection />
      <GradientSection />
      <TypographySection />
      <ChromeSection />
      <ButtonsSection />
      <MotionPrinciplesSection />
      <MotionTokensSection />
      <MotionUtilitiesSection />
      <NamedAnimationsSection />
      <UsageNotesSection />
    </main>
  );
}

/* ------------------------------------------------------------------ header */

function BrandHeader() {
  const { resolved } = useTheme();
  return (
    <header className="sticky top-0 z-40 border-b border-border-light bg-bg-primary/85 backdrop-blur-md">
      <div className="container flex h-14 items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group" aria-label="motion-forge home">
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-lg bg-primary-900 text-text-inverse motion-hover group-hover:bg-accent-500"
          >
            <span className="text-sm font-bold tracking-tight">M</span>
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-tight text-text-primary">
              motion-forge
            </span>
            <span className="text-2xs text-text-tertiary">brand kit · resolved: {resolved}</span>
          </span>
        </Link>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <a
            href="https://github.com/stonyp90/motion"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-text-secondary motion-hover hover:bg-bg-tertiary hover:text-text-primary"
            aria-label="GitHub repository"
          >
            <Github className="h-4 w-4" />
            <span className="hidden sm:inline">Source</span>
          </a>
        </div>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------- logo */

function LogoSection() {
  return (
    <BrandSection
      eyebrow="Logo"
      title="motion-forge mark"
      lead="The wordmark is the primary brand surface. Use the icon-only variant when space is tight; the horizontal lockup everywhere else."
    >
      <div className="flex flex-wrap items-center gap-10">
        <div className="flex flex-col items-start gap-3">
          <MotionLogo size="lg" />
          <span className="font-mono text-2xs text-text-tertiary">size=&quot;lg&quot;</span>
        </div>
        <div className="flex flex-col items-start gap-3">
          <MotionLogo size="md" />
          <span className="font-mono text-2xs text-text-tertiary">size=&quot;md&quot; (default)</span>
        </div>
        <div className="flex flex-col items-start gap-3">
          <MotionLogo size="sm" />
          <span className="font-mono text-2xs text-text-tertiary">size=&quot;sm&quot;</span>
        </div>
      </div>
    </BrandSection>
  );
}

/* ----------------------------------------------------------------- palette */

/* Layer 1: static brand palette. Hex values, theme-independent. Reference
   via `bg-primary-900`, `text-accent-600`, etc. */
function PaletteSection() {
  return (
    <BrandSection
      eyebrow="Palette · layer 1"
      title="Static brand scales"
      lead="Hex CSS vars under --color-{name}-{stop}. Theme-independent — these are the same color in light and dark mode. Use scale stops directly (e.g. text-primary-900) when you need a specific shade; reach for the semantic surface tokens (next section) when you want something that flips with the theme."
    >
      <div className="space-y-7">
        <Palette
          name="primary"
          family="deep ink"
          purpose="Default text. Inverse surfaces. The authority register."
        />
        <Palette
          name="accent"
          family="emerald"
          purpose="Motion spark. CTAs. Focus rings. The brand color."
        />
        <Palette
          name="secondary"
          family="warm amber"
          purpose="Pricing emphasis, secondary CTAs. Used sparingly."
        />
        <Palette
          name="neutral"
          family="cool grey"
          purpose="Borders, dividers, fills with no brand weight."
        />
      </div>
    </BrandSection>
  );
}

function Palette({
  name,
  family,
  purpose,
}: {
  name: 'primary' | 'accent' | 'secondary' | 'neutral';
  family: string;
  purpose: string;
}) {
  const stops = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h3 className="text-lg font-semibold text-text-primary">
          {name}{' '}
          <span className="text-sm font-normal text-text-tertiary">· {family}</span>
        </h3>
        <p className="hidden text-xs text-text-tertiary sm:block">{purpose}</p>
      </div>
      <div className="grid grid-cols-5 gap-2 sm:grid-cols-10">
        {stops.map((s) => (
          <PaletteSwatch key={s} name={name} stop={s} />
        ))}
      </div>
      <p className="mt-3 text-xs text-text-tertiary sm:hidden">{purpose}</p>
    </div>
  );
}

function PaletteSwatch({ name, stop }: { name: string; stop: number }) {
  // Stop ≥500 has high enough contrast that white text reads on top of it.
  const lightOnDark = stop >= 500;
  const cls = `bg-${name}-${stop}`;
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={`${cls} grid aspect-[5/4] place-items-end rounded-lg border border-border-light p-1.5`}
        aria-hidden
      >
        <span
          className={`font-mono text-2xs leading-none ${lightOnDark ? 'text-white/85' : 'text-text-tertiary'}`}
        >
          {stop}
        </span>
      </div>
      <span className="font-mono text-2xs text-text-tertiary">
        {name}-{stop}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------- semantic flips */

function SurfacesSection() {
  const surfaces: { token: string; cls: string; cssVar: string; note: string }[] = [
    {
      token: 'bg-primary',
      cls: 'bg-bg-primary',
      cssVar: '--color-bg-primary',
      note: 'Page surface. White / #0e1014.',
    },
    {
      token: 'bg-secondary',
      cls: 'bg-bg-secondary',
      cssVar: '--color-bg-secondary',
      note: 'Card surface, sticky header tint.',
    },
    {
      token: 'bg-tertiary',
      cls: 'bg-bg-tertiary',
      cssVar: '--color-bg-tertiary',
      note: 'Hover states, nested panels.',
    },
    {
      token: 'bg-inverse',
      cls: 'bg-bg-inverse',
      cssVar: '--color-bg-inverse',
      note: 'Inverted pill / badge surface.',
    },
  ];
  const textTokens: { token: string; cls: string; cssVar: string }[] = [
    { token: 'text-primary', cls: 'text-text-primary', cssVar: '--color-text-primary' },
    { token: 'text-secondary', cls: 'text-text-secondary', cssVar: '--color-text-secondary' },
    { token: 'text-tertiary', cls: 'text-text-tertiary', cssVar: '--color-text-tertiary' },
    { token: 'text-accent', cls: 'text-text-accent', cssVar: '--color-text-accent' },
  ];
  const borderTokens: { token: string; cls: string; cssVar: string }[] = [
    { token: 'border-light', cls: 'border-border-light', cssVar: '--color-border-light' },
    { token: 'border', cls: 'border-border', cssVar: '--color-border-default' },
    { token: 'border-dark', cls: 'border-border-dark', cssVar: '--color-border-dark' },
  ];
  return (
    <BrandSection
      eyebrow="Palette · layer 2"
      title="Themed semantic surfaces"
      lead="Hex CSS vars under --color-{bg|text|border}-*. Flip on [data-theme=&quot;dark&quot;]. Component code never branches on theme — it always uses the named token, and the var resolves to the right hex per theme. Toggle the theme above and the swatches below all retune."
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Subsection title="Surfaces">
          <div className="grid grid-cols-2 gap-3">
            {surfaces.map((s) => (
              <div key={s.token} className="card">
                <div
                  className={`${s.cls} h-20 w-full rounded-md border border-border-light`}
                  aria-hidden
                />
                <div className="mt-3 space-y-0.5">
                  <p className="font-mono text-xs font-semibold text-text-primary">{s.token}</p>
                  <p className="font-mono text-2xs text-text-tertiary">{s.cssVar}</p>
                  <p className="text-xs text-text-secondary">{s.note}</p>
                </div>
              </div>
            ))}
          </div>
        </Subsection>

        <Subsection title="Text + borders">
          <div className="space-y-3">
            <div className="card">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                Text
              </p>
              <ul className="mt-3 space-y-2 text-sm">
                {textTokens.map((t) => (
                  <li key={t.token} className="flex items-baseline justify-between gap-3">
                    <span className={`${t.cls} font-semibold`}>Aa · the quick brown fox</span>
                    <span className="font-mono text-2xs text-text-tertiary">{t.token}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="card">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                Borders
              </p>
              <ul className="mt-3 space-y-2">
                {borderTokens.map((b) => (
                  <li
                    key={b.token}
                    className={`${b.cls} flex items-center justify-between rounded-md border-2 bg-bg-primary px-3 py-2`}
                  >
                    <span className="text-xs text-text-secondary">{b.cssVar}</span>
                    <span className="font-mono text-2xs text-text-tertiary">{b.token}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Subsection>
      </div>
    </BrandSection>
  );
}

/* --------------------------------------------------------------- shadows */

function ShadowsSection() {
  const shadows = [
    { name: 'shadow-soft', cssVar: '--shadow-soft', purpose: 'baseline card lift' },
    { name: 'shadow-card', cssVar: '--shadow-card', purpose: 'card on hover' },
    { name: 'shadow-lift', cssVar: '--shadow-lift', purpose: 'modal / overlay' },
    { name: 'shadow-glow', cssVar: '--shadow-glow', purpose: 'focus / featured CTA' },
  ];
  return (
    <BrandSection
      eyebrow="Elevation"
      title="Themed shadow scale"
      lead="The Tailwind tokens shadow-{soft,card,lift,glow} resolve through CSS vars in globals.css, so dark mode automatically re-tunes them with deeper rgba so cards still lift off the surface. Toggle the theme to confirm — the shadow under each card visibly changes."
    >
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        {shadows.map((s) => (
          <div key={s.name} className="flex flex-col items-center gap-3">
            <div
              className={`${s.name} grid h-28 w-full place-items-center rounded-xl border border-border-light bg-bg-primary`}
            >
              <span className="text-xs text-text-tertiary">elevation</span>
            </div>
            <div className="text-center">
              <p className="font-mono text-xs text-text-primary">{s.name}</p>
              <p className="font-mono text-2xs text-text-tertiary">{s.cssVar}</p>
              <p className="mt-1 text-2xs text-text-tertiary">{s.purpose}</p>
            </div>
          </div>
        ))}
      </div>
    </BrandSection>
  );
}

/* --------------------------------------------------------- hero gradient */

function GradientSection() {
  return (
    <BrandSection
      eyebrow="Backgrounds"
      title="Hero gradient"
      lead="bg-hero-grid is the only branded gradient in the system. It layers two radial glows (emerald top-left, amber bottom-right) over the bg-primary → bg-secondary base. Dark mode bumps the emerald to 12% and the amber to 8% so the page doesn't read as a flat slab of black."
    >
      <div className="bg-hero-grid relative h-64 overflow-hidden rounded-2xl border border-border-light">
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-xs font-mono text-text-tertiary">bg-hero-grid</p>
            <p className="mt-1 text-xs text-text-secondary">
              --gradient-hero-grid · light / dark variants in globals.css
            </p>
          </div>
        </div>
      </div>
    </BrandSection>
  );
}

/* -------------------------------------------------------------- typography */

function TypographySection() {
  return (
    <BrandSection
      eyebrow="Typography"
      title="Three voices"
      lead="The system ships three named scales: h-display (the hero h1), h-section (page h2), and eyebrow (the small uppercase accent above headings). Body text isn't a named utility — compose it with text-* + leading-relaxed and the text-secondary token."
    >
      <div className="space-y-10">
        <TypeRow label=".h-display" usage="hero h1, 4xl/5xl/6xl">
          <h1 className="h-display">
            Type a prompt, get a motion graphic.
          </h1>
        </TypeRow>
        <TypeRow label=".h-section" usage="page h2, 3xl/4xl">
          <h2 className="h-section">Iteration is the product.</h2>
        </TypeRow>
        <TypeRow label=".eyebrow" usage="accent label above a heading">
          <p className="eyebrow">How it works</p>
        </TypeRow>
        <TypeRow label="body (lead)" usage="text-lg leading-relaxed text-text-secondary">
          <p className="text-lg leading-relaxed text-text-secondary">
            Drop your illustration pack, type a prompt, get a broadcast-ready MP4 and editable
            Lottie in 90 seconds. Iteration thereafter is sub-second.
          </p>
        </TypeRow>
        <TypeRow label="body (base)" usage="text-sm leading-relaxed text-text-secondary">
          <p className="text-sm leading-relaxed text-text-secondary">
            Same engine across all three tiers. The difference is who runs it.
          </p>
        </TypeRow>
        <TypeRow label="caption" usage="text-xs text-text-tertiary">
          <p className="text-xs text-text-tertiary">
            Used by brand, growth and product teams that would rather ship than wait on an agency.
          </p>
        </TypeRow>
        <TypeRow label="mono caption" usage="font-mono text-2xs / text-3xs">
          <p className="font-mono text-2xs text-text-tertiary">
            v0.1.0 · local-first · cloud-optional
          </p>
        </TypeRow>
      </div>
    </BrandSection>
  );
}

function TypeRow({
  label,
  usage,
  children,
}: {
  label: string;
  usage: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-3 border-t border-border-light pt-6 sm:grid-cols-[200px_1fr] sm:gap-8">
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-xs text-text-primary">{label}</span>
        <span className="font-mono text-2xs text-text-tertiary">{usage}</span>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------- chrome */

function ChromeSection() {
  return (
    <BrandSection
      eyebrow="Chrome"
      title="Card · chip · section"
      lead="The three named container classes. Reach for them before composing new ones."
    >
      <div className="grid gap-5 lg:grid-cols-3">
        <article className="card">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-50 text-accent-600">
            <Sparkles className="h-4 w-4" />
          </span>
          <h3 className="mt-3 text-sm font-semibold text-text-primary">.card</h3>
          <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
            Default container. Rounded-2xl, border-border-light, shadow-soft, hovers to shadow-card.
            Wraps grid items, list items, anything that needs a visible edge.
          </p>
        </article>
        <article className="card">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="chip">.chip</span>
            <span className="chip border-accent-200 bg-accent-50 text-accent-700">
              <Check className="h-3 w-3" /> success
            </span>
            <span className="chip border-secondary-200 bg-secondary-50 text-secondary-700">
              warning
            </span>
          </div>
          <h3 className="mt-3 text-sm font-semibold text-text-primary">.chip</h3>
          <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
            Tiny pill — status, count, label. Override the border / bg utility classes
            inline when you need a semantic tint.
          </p>
        </article>
        <article className="card">
          <div className="space-y-1.5">
            <div className="rounded border border-dashed border-border-light px-2 py-1 text-2xs text-text-tertiary">
              .section · py-20 sm:py-24 lg:py-28
            </div>
            <div className="rounded border border-dashed border-border-light px-2 py-1 text-2xs text-text-tertiary">
              .section-tight · py-14 sm:py-16 lg:py-20
            </div>
          </div>
          <h3 className="mt-3 text-sm font-semibold text-text-primary">.section</h3>
          <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
            Vertical rhythm. Two tiers — the standard section is the default, the tight one
            for short stat rows or proof bars.
          </p>
        </article>
      </div>
    </BrandSection>
  );
}

/* -------------------------------------------------------------- buttons */

function ButtonsSection() {
  return (
    <BrandSection
      eyebrow="Actions"
      title="Three buttons, three jobs"
      lead="The whole site uses these three classes. btn-primary is the ink-on-light authoritative CTA; btn-accent is the emerald spark for the brand action; btn-ghost is the bordered tertiary."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <ButtonCard
          name=".btn-primary"
          purpose="Authority. The primary CTA on most surfaces — deep ink reads as the most serious choice."
        >
          <button type="button" className="btn-primary text-sm">
            Book a demo <ArrowRight className="h-4 w-4" />
          </button>
        </ButtonCard>
        <ButtonCard
          name=".btn-accent"
          purpose="The brand spark. Use for the one action you want the eye to land on first (top tier on /pricing, the generate button)."
        >
          <button type="button" className="btn-accent text-sm">
            <Sparkles className="h-4 w-4" /> Generate
          </button>
        </ButtonCard>
        <ButtonCard
          name=".btn-ghost"
          purpose="Tertiary. Pairs with btn-primary or btn-accent — don't use two of these next to each other."
        >
          <button type="button" className="btn-ghost text-sm">
            Cancel
          </button>
        </ButtonCard>
      </div>
    </BrandSection>
  );
}

function ButtonCard({
  name,
  purpose,
  children,
}: {
  name: string;
  purpose: string;
  children: ReactNode;
}) {
  return (
    <div className="card flex flex-col gap-4">
      <div className="grid h-16 place-items-center rounded-lg bg-bg-tertiary p-3">{children}</div>
      <div>
        <p className="font-mono text-xs text-text-primary">{name}</p>
        <p className="mt-1 text-xs leading-relaxed text-text-secondary">{purpose}</p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------- motion principles */

function MotionPrinciplesSection() {
  return (
    <BrandSection
      eyebrow="Motion"
      title="Calm authority. Linear-style restraint. Tablix-clean."
      lead="Motion always communicates state. It never decorates. The system enforces this with named easing/duration tokens — never inline cubic-bezier or arbitrary ms values."
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <PrincipleCard
          headline="60%"
          name="--ease-out-quart"
          rule="Workhorse. Fast start, gentle landing. Use for hover, focus, reveal, enter — anything responding to user input."
        />
        <PrincipleCard
          headline="30%"
          name="--ease-snap"
          rule="Snap. Near-instant with a hairline tail. Toggles, checkboxes, tab switches — anything that should feel decisive."
        />
        <PrincipleCard
          headline="10%"
          name="--ease-in-quart"
          rule="Exit. Slow start, fast finish. Drawer close, toast dismiss — conveys departure."
        />
      </div>
      <p className="mt-6 text-xs text-text-tertiary">
        Spring (--ease-spring) is reserved for one moment per session (the generate-success punctuation).
        Linear (--ease-linear) is for indeterminate progress only — skeleton shimmer, spinner.
      </p>
    </BrandSection>
  );
}

function PrincipleCard({
  headline,
  name,
  rule,
}: {
  headline: string;
  name: string;
  rule: string;
}) {
  return (
    <div className="card">
      <p className="text-3xl font-semibold tracking-tight text-text-primary">{headline}</p>
      <p className="mt-1 font-mono text-xs text-text-accent">{name}</p>
      <p className="mt-3 text-xs leading-relaxed text-text-secondary">{rule}</p>
    </div>
  );
}

/* -------------------------------------------------------- motion tokens */

function MotionTokensSection() {
  return (
    <BrandSection
      eyebrow="Motion · tokens"
      title="Durations & easings"
      lead="Every token below is exposed to Tailwind too (duration-base, ease-out-quart, etc.) so you rarely need to reach for arbitrary values."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Subsection title="Durations">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-light text-left text-xs uppercase tracking-wider text-text-tertiary">
                <th className="py-2 font-medium">Token</th>
                <th className="py-2 font-medium">Value</th>
                <th className="py-2 font-medium">Use</th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              <TokenRow t="--dur-instant" v="90ms" u="press, color shift" />
              <TokenRow t="--dur-fast" v="180ms" u="hover, focus ring, chip toggle" />
              <TokenRow t="--dur-base" v="240ms" u="drawer slide, panel reveal (default)" />
              <TokenRow t="--dur-slow" v="320ms" u="preview reveal, large surface entry" />
              <TokenRow t="--dur-stagger" v="30ms" u="× index for sibling sequences" />
            </tbody>
          </table>
        </Subsection>
        <Subsection title="Easings">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-light text-left text-xs uppercase tracking-wider text-text-tertiary">
                <th className="py-2 font-medium">Token</th>
                <th className="py-2 font-medium">Value</th>
                <th className="py-2 font-medium">Use</th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              <TokenRow t="--ease-out-quart" v="0.2 0.8 0.2 1" u="60% — workhorse" />
              <TokenRow t="--ease-snap" v="0.12 0 0.08 1" u="30% — toggles" />
              <TokenRow t="--ease-in-quart" v="0.55 0 0.85 0.3" u="10% — exits" />
              <TokenRow t="--ease-spring" v="0.34 1.56 0.64 1" u="once per session" />
              <TokenRow t="--ease-linear" v="linear" u="indeterminate progress only" />
            </tbody>
          </table>
        </Subsection>
      </div>
      <p className="mt-6 text-xs text-text-tertiary">
        Two more delay tokens worth knowing: --delay-loader-show (200ms) is how long to wait before
        showing a spinner so fast responses don&apos;t flash one, and --delay-loader-min (400ms) is
        how long to keep a visible loader so it doesn&apos;t jitter.
      </p>
    </BrandSection>
  );
}

function TokenRow({ t, v, u }: { t: string; v: string; u: string }) {
  return (
    <tr className="border-b border-border-light/60 last:border-0">
      <td className="py-2 pr-3 text-text-primary">{t}</td>
      <td className="py-2 pr-3 text-text-accent">{v}</td>
      <td className="py-2 font-sans text-xs text-text-secondary">{u}</td>
    </tr>
  );
}

/* ---------------------------------------------------- motion utilities */

function MotionUtilitiesSection() {
  return (
    <BrandSection
      eyebrow="Motion · utilities"
      title="Reach for these instead of writing transition-*"
      lead="Each utility binds a transition to a named token pair so you stay inside the design system. Hover the demos to see them fire — toggle to dark to confirm they hold up."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MotionDemo
          name=".motion-hover"
          purpose="Background, border, color, shadow on hover. The default."
        >
          <button
            type="button"
            className="motion-hover rounded-lg border border-border-light bg-bg-primary px-4 py-2 text-sm text-text-primary hover:border-border-dark hover:bg-bg-tertiary"
          >
            Hover me
          </button>
        </MotionDemo>
        <MotionDemo
          name=".motion-press"
          purpose="Instant scale on active. Pairs with motion-hover for buttons."
        >
          <button
            type="button"
            className="motion-press rounded-lg bg-primary-900 px-4 py-2 text-sm text-text-inverse active:scale-95"
          >
            Press me
          </button>
        </MotionDemo>
        <MotionDemo
          name=".motion-reveal"
          purpose="Transform + opacity. For elements that enter the viewport."
        >
          <ToggleReveal />
        </MotionDemo>
        <MotionDemo name=".motion-snap" purpose="Tabs, segmented controls. Snappy.">
          <SnapToggle />
        </MotionDemo>
        <MotionDemo
          name=".motion-drawer"
          purpose="Side drawer slide. Transform only, base duration."
        >
          <DrawerDemo />
        </MotionDemo>
        <MotionDemo
          name=".motion-exit"
          purpose="Exit transition — slow start, fast finish."
        >
          <ExitDemo />
        </MotionDemo>
      </div>
    </BrandSection>
  );
}

function MotionDemo({
  name,
  purpose,
  children,
}: {
  name: string;
  purpose: string;
  children: ReactNode;
}) {
  return (
    <div className="card">
      <div className="grid min-h-[88px] place-items-center rounded-md bg-bg-tertiary p-4">
        {children}
      </div>
      <p className="mt-3 font-mono text-xs text-text-primary">{name}</p>
      <p className="mt-1 text-xs leading-relaxed text-text-secondary">{purpose}</p>
    </div>
  );
}

function ToggleReveal() {
  const [on, setOn] = useState(true);
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="motion-reveal grid h-10 w-10 place-items-center rounded-full bg-accent-500 text-white"
        style={{
          opacity: on ? 1 : 0,
          transform: on ? 'translateY(0) scale(1)' : 'translateY(8px) scale(0.95)',
        }}
        aria-hidden
      >
        <Check className="h-4 w-4" />
      </div>
      <button
        type="button"
        onClick={() => setOn((v) => !v)}
        className="motion-hover text-xs text-text-tertiary hover:text-text-primary"
      >
        Toggle
      </button>
    </div>
  );
}

function SnapToggle() {
  const [on, setOn] = useState(false);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => setOn((v) => !v)}
      className={`motion-snap relative inline-flex h-6 w-11 items-center rounded-full ${on ? 'bg-accent-500' : 'bg-bg-tertiary'}`}
    >
      <span
        className="motion-snap inline-block h-5 w-5 rounded-full bg-white shadow-soft"
        style={{ transform: on ? 'translateX(22px)' : 'translateX(2px)' }}
        aria-hidden
      />
    </button>
  );
}

function DrawerDemo() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative h-14 w-full overflow-hidden rounded-md border border-border-light bg-bg-primary">
      <div
        className="motion-drawer absolute inset-y-0 right-0 grid w-24 place-items-center border-l border-border-light bg-accent-50 text-xs text-accent-700"
        style={{ transform: open ? 'translateX(0)' : 'translateX(100%)' }}
        aria-hidden
      >
        Open
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="motion-hover absolute inset-y-0 left-3 my-auto text-xs text-text-tertiary hover:text-text-primary"
      >
        Toggle drawer
      </button>
    </div>
  );
}

function ExitDemo() {
  const [shown, setShown] = useState(true);
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="motion-exit grid h-10 w-24 place-items-center rounded-md bg-primary-900 text-xs text-text-inverse"
        style={{ opacity: shown ? 1 : 0, transform: shown ? 'translateY(0)' : 'translateY(4px)' }}
      >
        Toast
      </div>
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        className="motion-hover text-xs text-text-tertiary hover:text-text-primary"
      >
        Dismiss
      </button>
    </div>
  );
}

/* ----------------------------------------------------- named animations */

function NamedAnimationsSection() {
  return (
    <BrandSection
      eyebrow="Motion · keyframes"
      title="Named animations"
      lead="A tight catalog. Skeleton shimmer + mic-listening pulse + toast in/out are the only ones the production app ships."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <AnimCard
          name=".animate-skeleton-shimmer"
          purpose="The only background animation we ship. Linear-easing — it's indeterminate progress."
        >
          <div
            className="animate-skeleton-shimmer h-3 w-full rounded-full"
            style={{ minHeight: '12px' }}
          />
          <div
            className="animate-skeleton-shimmer mt-2 h-3 w-3/4 rounded-full"
            style={{ minHeight: '12px' }}
          />
        </AnimCard>
        <AnimCard
          name=".animate-pulse-accent"
          purpose="Mic-listening ring. Subtle accent expansion — never a color flash."
        >
          <button
            type="button"
            className="animate-pulse-accent grid h-12 w-12 place-items-center rounded-full bg-accent-500 text-white"
            aria-label="Listening"
          >
            <Mic className="h-5 w-5" />
          </button>
        </AnimCard>
        <AnimCard
          name=".animate-toast-in / -out"
          purpose="Toast enter (base, out-quart) and dismiss (fast, in-quart)."
        >
          <ToastDemo />
        </AnimCard>
        <AnimCard
          name="loader pattern"
          purpose="--delay-loader-show 200ms before spinner, --delay-loader-min 400ms once visible. Demo spins on click."
        >
          <LoaderDemo />
        </AnimCard>
        <AnimCard
          name=".stagger-child"
          purpose="Set style={{ '--i': index }} on each child to space sibling animations by --dur-stagger."
        >
          <StaggerDemo />
        </AnimCard>
        <AnimCard
          name="Tailwind escape hatch"
          purpose="When you really need a one-off, use the duration-* / ease-* tokens — never raw ms / cubic-bezier."
        >
          <code className="block font-mono text-2xs leading-relaxed text-text-secondary">
            transition-transform
            <br />
            duration-fast ease-out-quart
          </code>
        </AnimCard>
      </div>
    </BrandSection>
  );
}

function AnimCard({
  name,
  purpose,
  children,
}: {
  name: string;
  purpose: string;
  children: ReactNode;
}) {
  return (
    <div className="card">
      <div className="grid min-h-[88px] place-items-center rounded-md bg-bg-tertiary p-4">
        {children}
      </div>
      <p className="mt-3 font-mono text-xs text-text-primary">{name}</p>
      <p className="mt-1 text-xs leading-relaxed text-text-secondary">{purpose}</p>
    </div>
  );
}

function ToastDemo() {
  // Toggle a key so the toast remounts each click — exercising both keyframes.
  const [n, setN] = useState(0);
  const visible = n % 2 === 0;
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        key={n}
        className={`${visible ? 'animate-toast-in' : 'animate-toast-out'} rounded-md bg-primary-900 px-3 py-2 text-2xs text-text-inverse`}
      >
        Generated 22 panels
      </div>
      <button
        type="button"
        onClick={() => setN((v) => v + 1)}
        className="motion-hover text-xs text-text-tertiary hover:text-text-primary"
      >
        {visible ? 'Dismiss' : 'Show again'}
      </button>
    </div>
  );
}

function LoaderDemo() {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-3">
      {busy ? (
        <Loader2 className="h-5 w-5 animate-spin text-accent-500" />
      ) : (
        <Square className="h-5 w-5 text-text-tertiary" aria-hidden />
      )}
      <button
        type="button"
        onClick={() => {
          setBusy(true);
          setTimeout(() => setBusy(false), 1200);
        }}
        className="motion-hover rounded-md border border-border-light bg-bg-primary px-3 py-1 text-xs text-text-primary hover:bg-bg-tertiary"
      >
        Run
      </button>
    </div>
  );
}

function StaggerDemo() {
  const items = [0, 1, 2, 3];
  return (
    <div className="flex items-end gap-1.5">
      {items.map((i) => (
        <div
          key={i}
          className="stagger-child animate-toast-in h-8 w-3 rounded-sm bg-accent-500"
          style={{ ['--i' as keyof CSSProperties]: i } as CSSProperties}
        />
      ))}
    </div>
  );
}

/* ----------------------------------------------------------- usage notes */

function UsageNotesSection() {
  return (
    <BrandSection eyebrow="When in doubt" title="Style decisions, encoded">
      <div className="grid gap-5 lg:grid-cols-2">
        <article className="card">
          <h3 className="text-sm font-semibold text-text-primary">Picking a color</h3>
          <ul className="mt-3 space-y-2 text-sm text-text-secondary">
            <li className="flex items-start gap-2.5">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent-500" />
              Does it need to flip with the theme? &rarr; use a <code className="font-mono text-text-primary">bg-bg-*</code>, <code className="font-mono text-text-primary">text-text-*</code>, <code className="font-mono text-text-primary">border-border-*</code> token.
            </li>
            <li className="flex items-start gap-2.5">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent-500" />
              Is it a specific brand shade (e.g. a button bg)? &rarr; use the palette directly (<code className="font-mono text-text-primary">bg-primary-900</code>).
            </li>
            <li className="flex items-start gap-2.5">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent-500" />
              Need a focus ring? &rarr; default is <code className="font-mono text-text-primary">focus-visible:ring-accent-500</code>; <code className="font-mono text-text-primary">:focus-visible</code> is already handled at the base layer.
            </li>
          </ul>
        </article>
        <article className="card">
          <h3 className="text-sm font-semibold text-text-primary">Picking a motion</h3>
          <ul className="mt-3 space-y-2 text-sm text-text-secondary">
            <li className="flex items-start gap-2.5">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent-500" />
              Hover / focus state? &rarr; <code className="font-mono text-text-primary">.motion-hover</code>.
            </li>
            <li className="flex items-start gap-2.5">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent-500" />
              Snappy toggle or tab? &rarr; <code className="font-mono text-text-primary">.motion-snap</code>.
            </li>
            <li className="flex items-start gap-2.5">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent-500" />
              Element entering view? &rarr; <code className="font-mono text-text-primary">.motion-reveal</code>.
            </li>
            <li className="flex items-start gap-2.5">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent-500" />
              Drawer / panel slide? &rarr; <code className="font-mono text-text-primary">.motion-drawer</code>.
            </li>
            <li className="flex items-start gap-2.5">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent-500" />
              Dismiss / exit? &rarr; <code className="font-mono text-text-primary">.motion-exit</code>.
            </li>
          </ul>
        </article>
      </div>
    </BrandSection>
  );
}

/* ------------------------------------------------------------- primitives */

function BrandSection({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <section className="section-tight border-b border-border-light">
      <div className="container">
        <div className="max-w-3xl">
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="h-section mt-2">{title}</h2>
          {lead && (
            <p className="mt-4 text-base leading-relaxed text-text-secondary">{lead}</p>
          )}
        </div>
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

function Subsection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
        {title}
      </h3>
      {children}
    </div>
  );
}

