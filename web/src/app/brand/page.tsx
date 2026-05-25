'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun, Sparkles, Play, ArrowRight, Check, Cpu } from 'lucide-react';

/* The /brand route is the source of truth for what's available in the
   motion design system. It catalogs every brand utility, palette stop,
   surface, shadow, button, card, type style, animation, and pattern in
   the system — and lets you flip the page between light + dark to see
   how the motion-emerald scale shifts.

   This page deliberately sets `data-theme` on <html> itself (without
   touching localStorage) so it can be previewed independently of the
   studio's persisted theme preference.                                  */

type Mode = 'light' | 'dark';

export default function BrandPage() {
  const [mode, setMode] = useState<Mode>('light');

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const prev = document.documentElement.getAttribute('data-theme');
    document.documentElement.setAttribute('data-theme', mode);
    document.documentElement.style.colorScheme = mode;
    return () => {
      if (prev) document.documentElement.setAttribute('data-theme', prev);
      else document.documentElement.removeAttribute('data-theme');
    };
  }, [mode]);

  return (
    <main className="min-h-screen bg-bg-primary text-text-primary">
      <BrandHeader mode={mode} onToggle={() => setMode((m) => (m === 'light' ? 'dark' : 'light'))} />

      <PaletteSection />
      <SurfacesSection />
      <TypographySection />
      <ButtonsSection />
      <CardsSection />
      <ShadowsSection />
      <SectionsBackgroundsSection />
      <PatternsSection />
      <AnimationsSection />
      <UsageNotesSection />
    </main>
  );
}

/* -------------------------------------------------------------------------- */

function BrandHeader({ mode, onToggle }: { mode: Mode; onToggle: () => void }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border-light bg-bg-primary/85 backdrop-blur-md">
      <div className="container-wide flex h-16 items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid h-9 w-9 place-items-center rounded-xl bg-motion text-white shadow-motion"
          >
            <span className="font-bold tracking-tight">M</span>
          </span>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold text-text-primary">motion · brand kit</span>
            <span className="text-xs text-text-tertiary">v0.1 · tokens, surfaces, components, motion</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a href="/" className="btn-motion-outline py-2 text-sm">
            Back to site
          </a>
          <button
            onClick={onToggle}
            aria-label={`Switch to ${mode === 'light' ? 'dark' : 'light'} mode`}
            className="btn-motion py-2 text-sm"
          >
            {mode === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            {mode === 'light' ? 'Dark' : 'Light'} preview
          </button>
        </div>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------------- */

function PaletteSection() {
  const motionScale = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
  return (
    <BrandSection
      eyebrow="Palette"
      title="Motion-emerald scale"
      description="The signature brand color. Shifts brighter in dark mode so contrast holds. The 500 stop is the primary surface, 600 the hover surface, 50 / 950 the subtle washes."
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-11">
        {motionScale.map((stop) => (
          <Swatch key={stop} label={`motion-${stop}`} className={`bg-motion-${stop}`} stop={stop} />
        ))}
      </div>

      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <NamedSwatchGroup
          title="Brand · primary (deep ink)"
          stops={[100, 300, 500, 700, 900]}
          format={(s) => `primary-${s}`}
          classer={(s) => `bg-primary-${s}`}
        />
        <NamedSwatchGroup
          title="Brand · accent (emerald, hex)"
          stops={[100, 300, 500, 700, 900]}
          format={(s) => `accent-${s}`}
          classer={(s) => `bg-accent-${s}`}
        />
        <NamedSwatchGroup
          title="Brand · secondary (warm amber)"
          stops={[100, 300, 500, 700, 900]}
          format={(s) => `secondary-${s}`}
          classer={(s) => `bg-secondary-${s}`}
        />
      </div>
    </BrandSection>
  );
}

function Swatch({ label, className, stop }: { label: string; className: string; stop: number }) {
  return (
    <div className="flex flex-col gap-2">
      <div
        className={`${className} aspect-[5/4] rounded-xl border border-border-light shadow-soft`}
        aria-hidden
      />
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-mono text-text-primary">{label}</span>
        <span className="text-text-tertiary">{stop}</span>
      </div>
    </div>
  );
}

function NamedSwatchGroup({
  title,
  stops,
  format,
  classer,
}: {
  title: string;
  stops: number[];
  format: (stop: number) => string;
  classer: (stop: number) => string;
}) {
  return (
    <div className="card-motion">
      <h3 className="heading-md text-base">{title}</h3>
      <div className="mt-4 grid grid-cols-5 gap-2">
        {stops.map((s) => (
          <div key={s} className="flex flex-col items-center gap-1.5">
            <div
              className={`${classer(s)} aspect-square w-full rounded-lg border border-border-light`}
              aria-hidden
            />
            <span className="font-mono text-2xs text-text-tertiary">{s}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-text-tertiary">
        <span className="font-mono text-text-secondary">{format(500)}</span> is the default stop.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function SurfacesSection() {
  const tokens: { name: string; cssVar: string; sample: string }[] = [
    { name: 'bg', cssVar: '--background', sample: 'bg-[hsl(var(--background))]' },
    { name: 'card', cssVar: '--card', sample: 'bg-[hsl(var(--card))]' },
    { name: 'muted', cssVar: '--muted', sample: 'bg-[hsl(var(--muted))]' },
    { name: 'surface-inset', cssVar: '--surface-inset', sample: 'bg-surface-inset' },
    { name: 'surface-overlay', cssVar: '--surface-overlay', sample: 'bg-surface-overlay' },
    { name: 'border', cssVar: '--border-default', sample: 'bg-[hsl(var(--border-default))]' },
    { name: 'border-hover', cssVar: '--border-hover', sample: 'bg-border-hover' },
    { name: 'ring', cssVar: '--ring', sample: 'bg-[hsl(var(--ring))]' },
  ];
  return (
    <BrandSection
      eyebrow="Surfaces"
      title="Semantic tokens"
      description="Backgrounds, cards, muted fills, borders, focus ring — all themed. Reference via HSL CSS vars or the named Tailwind colors (`bg-surface-inset`, `border-border-hover`)."
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tokens.map((t) => (
          <div key={t.name} className="card-motion">
            <div
              className={`${t.sample} h-20 w-full rounded-lg border border-border-light`}
              aria-hidden
            />
            <div className="mt-3 space-y-1 text-xs">
              <p className="font-mono font-semibold text-text-primary">{t.name}</p>
              <p className="font-mono text-text-tertiary">{t.cssVar}</p>
            </div>
          </div>
        ))}
      </div>
    </BrandSection>
  );
}

/* -------------------------------------------------------------------------- */

function TypographySection() {
  return (
    <BrandSection
      eyebrow="Typography"
      title="Heading + body scale"
      description="`heading-xl` for hero pages, `heading-lg` for section heads, `heading-md` for card titles. Body sizes pair with each. `eyebrow` and `label` sit above headings — the difference is just colour + tracking."
    >
      <div className="space-y-10">
        <TypeSpec name="heading-xl" tag="h1">
          <h1 className="heading-xl">Motion design at the speed of your roadmap.</h1>
        </TypeSpec>
        <TypeSpec name="heading-lg" tag="h2">
          <h2 className="heading-lg">Engineered for shipping motion, not for charging by the hour.</h2>
        </TypeSpec>
        <TypeSpec name="heading-md" tag="h3">
          <h3 className="heading-md">Iteration is the product.</h3>
        </TypeSpec>
        <TypeSpec name="body-lg" tag="p">
          <p className="body-lg">
            Drop your illustration pack, type a prompt, get a broadcast-ready MP4 and editable
            Lottie in 90 seconds. Iteration thereafter is sub-second.
          </p>
        </TypeSpec>
        <TypeSpec name="body-md" tag="p">
          <p className="body-md">
            Same engine across all three tiers. The difference is who runs it.
          </p>
        </TypeSpec>
        <TypeSpec name="eyebrow / label">
          <div className="flex flex-wrap items-center gap-6">
            <span className="eyebrow">Why operators pick this</span>
            <span className="label">Pricing</span>
          </div>
        </TypeSpec>
      </div>
    </BrandSection>
  );
}

function TypeSpec({ name, tag, children }: { name: string; tag?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-3 border-t border-border-light pt-6 sm:grid-cols-[140px_1fr] sm:gap-8">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-xs text-text-secondary">{name}</span>
        {tag && <span className="font-mono text-2xs text-text-tertiary">&lt;{tag}&gt;</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ButtonsSection() {
  return (
    <BrandSection
      eyebrow="Buttons"
      title="Action surfaces"
      description="Two families coexist. The original (`btn-primary`, `btn-accent`, `btn-ghost`) drives existing marketing CTAs. The new (`btn-motion`, `btn-motion-outline`) uses themed HSL vars and follows the dark-mode flip."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card-motion">
          <h3 className="heading-md text-base">New motion buttons</h3>
          <p className="mt-1 text-sm text-text-tertiary">Themed, dark-mode aware.</p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button className="btn-motion">
              <Sparkles className="h-4 w-4" />
              Primary action
            </button>
            <button className="btn-motion-outline">
              <ArrowRight className="h-4 w-4" />
              Secondary action
            </button>
          </div>
        </div>
        <div className="card-motion">
          <h3 className="heading-md text-base">Original site buttons</h3>
          <p className="mt-1 text-sm text-text-tertiary">Preserved for the marketing pages.</p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button className="btn-primary">btn-primary</button>
            <button className="btn-accent">btn-accent</button>
            <button className="btn-ghost">btn-ghost</button>
          </div>
        </div>
      </div>
    </BrandSection>
  );
}

/* -------------------------------------------------------------------------- */

function CardsSection() {
  return (
    <BrandSection
      eyebrow="Cards"
      title="Container surfaces"
      description="`card-motion` for grid lists, `card-motion-elevated` for the focal item on a page (e.g. featured pricing tier). Both follow the dark-mode flip."
    >
      <div className="grid gap-6 lg:grid-cols-3">
        <article className="card-motion">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-motion-50 text-motion">
            <Cpu className="h-5 w-5" />
          </span>
          <h3 className="heading-md mt-4 text-base">card-motion</h3>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            Default container surface. Soft shadow at rest, lifts on hover, border darkens.
          </p>
        </article>
        <article className="card-motion-elevated">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-motion text-white shadow-motion">
            <Sparkles className="h-5 w-5" />
          </span>
          <h3 className="heading-md mt-4 text-base">card-motion-elevated</h3>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            Focal card — uses the lifted shadow, soft border, more padding. Reach for it when
            something on the page needs to read as &quot;pick this&quot;.
          </p>
        </article>
        <article className="card">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-50 text-accent-600">
            <Check className="h-5 w-5" />
          </span>
          <h3 className="heading-md mt-4 text-base">card (original)</h3>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            Pre-rebrand card surface. Behaviorally identical to `card-motion`; both are kept so
            the existing marketing copy lands unchanged during the transition.
          </p>
        </article>
      </div>
    </BrandSection>
  );
}

/* -------------------------------------------------------------------------- */

function ShadowsSection() {
  const shadows = [
    { name: 'shadow-soft', cls: 'shadow-soft' },
    { name: 'shadow-card', cls: 'shadow-card' },
    { name: 'shadow-lift', cls: 'shadow-lift' },
    { name: 'shadow-glow', cls: 'shadow-glow' },
    { name: 'shadow-motion', cls: 'shadow-motion' },
    { name: 'shadow-motion-lg', cls: 'shadow-motion-lg' },
    { name: 'shadow-motion-glow', cls: 'shadow-motion-glow' },
  ];
  return (
    <BrandSection
      eyebrow="Shadows"
      title="Elevation"
      description="The `motion-*` variants use the brand emerald color and follow the dark-mode flip; the others are neutral ink shadows."
    >
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
        {shadows.map((s) => (
          <div key={s.name} className="flex flex-col items-center gap-3">
            <div
              className={`${s.cls} grid h-28 w-full place-items-center rounded-2xl bg-bg-primary border border-border-light`}
            >
              <span className="text-2xs text-text-tertiary">elevation</span>
            </div>
            <span className="font-mono text-xs text-text-secondary">{s.name}</span>
          </div>
        ))}
      </div>
    </BrandSection>
  );
}

/* -------------------------------------------------------------------------- */

function SectionsBackgroundsSection() {
  const sections = [
    { name: 'section-light', cls: 'section-light', invert: false },
    { name: 'section-subtle', cls: 'section-subtle', invert: false },
    { name: 'section-accent', cls: 'section-accent', invert: false },
    { name: 'section-dark', cls: 'section-dark', invert: true },
  ];
  return (
    <BrandSection
      eyebrow="Page rhythm"
      title="Section backgrounds"
      description="Alternating these creates visual rhythm down a long page. The `section-dark` is the only one that flips foreground color — always pair it with light text."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {sections.map((s) => (
          <div
            key={s.name}
            className={`${s.cls} flex h-40 flex-col justify-end gap-1 rounded-2xl border border-border-light p-5`}
          >
            <span className={`font-mono text-xs ${s.invert ? 'text-white' : 'text-text-secondary'}`}>
              {s.name}
            </span>
            <span className={`text-2xs ${s.invert ? 'text-white/70' : 'text-text-tertiary'}`}>
              .{s.cls}
            </span>
          </div>
        ))}
      </div>
    </BrandSection>
  );
}

/* -------------------------------------------------------------------------- */

function PatternsSection() {
  return (
    <BrandSection
      eyebrow="Patterns"
      title="Background textures"
      description="Use sparingly to break up large flat surfaces — a hero or a feature section, not every card."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="bg-grid relative h-40 overflow-hidden rounded-2xl border border-border-light bg-bg-primary p-5">
          <span className="font-mono text-xs text-text-secondary">bg-grid</span>
        </div>
        <div className="bg-dot-grid relative h-40 overflow-hidden rounded-2xl border border-border-light bg-bg-primary p-5">
          <span className="font-mono text-xs text-text-secondary">bg-dot-grid</span>
        </div>
        <div className="bg-motion-subtle relative h-40 overflow-hidden rounded-2xl border border-border-light p-5 sm:col-span-2">
          <span className="font-mono text-xs text-text-secondary">bg-motion-subtle</span>
          <span className="absolute right-4 bottom-4 text-2xs text-text-tertiary">
            soft gradient wash from motion-50 / motion-950
          </span>
        </div>
      </div>
    </BrandSection>
  );
}

/* -------------------------------------------------------------------------- */

function AnimationsSection() {
  const items = [
    { name: 'animate-float', body: 'idle-state badge or icon' },
    { name: 'animate-pulse-ring', body: 'attention ring on live status' },
    { name: 'animate-slide-up', body: 'reveal on scroll-into-view' },
    { name: 'animate-scale-in', body: 'modal / dropdown enter' },
    { name: 'animate-gradient', body: 'CTA background drift' },
    { name: 'animate-blob', body: 'background ambient blobs' },
    { name: 'progress-shimmer', body: 'progress bar sweep' },
    { name: 'animate-panel-drift', body: 'marquee strip behind hero' },
  ];
  return (
    <BrandSection
      eyebrow="Motion"
      title="Animation primitives"
      description="A small catalog. All disabled under `prefers-reduced-motion: reduce`, so use them freely."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((i) => (
          <div
            key={i.name}
            className="flex items-center justify-between gap-4 rounded-xl border border-border-light bg-bg-primary px-4 py-3"
          >
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-xs text-text-primary">{i.name}</span>
              <span className="text-2xs text-text-tertiary">{i.body}</span>
            </div>
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-motion-50 text-motion">
              <Play className="h-3.5 w-3.5" />
            </span>
          </div>
        ))}
      </div>
    </BrandSection>
  );
}

/* -------------------------------------------------------------------------- */

function UsageNotesSection() {
  return (
    <BrandSection
      eyebrow="Notes"
      title="When in doubt"
      description={null}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card-motion">
          <h3 className="heading-md text-base">Which palette do I use?</h3>
          <ul className="mt-4 space-y-2.5 text-sm text-text-secondary">
            <li className="flex items-start gap-2.5">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-motion" />
              New surfaces &rarr; `motion-*` and the themed semantic tokens.
            </li>
            <li className="flex items-start gap-2.5">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-motion" />
              Existing marketing copy &rarr; keep `primary-*` / `accent-*` for now.
            </li>
            <li className="flex items-start gap-2.5">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-motion" />
              Need a dark mode? Use `dark:` &mdash; it&apos;s wired to `[data-theme=&quot;dark&quot;]`.
            </li>
          </ul>
        </div>
        <div className="card-motion">
          <h3 className="heading-md text-base">Naming conventions</h3>
          <ul className="mt-4 space-y-2.5 text-sm text-text-secondary">
            <li>
              <span className="font-mono text-text-primary">bg-motion</span> &mdash; the brand
              emerald (motion-500), full opacity.
            </li>
            <li>
              <span className="font-mono text-text-primary">bg-motion-{'{50..950}'}</span> &mdash;
              the full themed scale, alpha-value supported.
            </li>
            <li>
              <span className="font-mono text-text-primary">text-motion</span> /
              <span className="font-mono text-text-primary"> border-motion</span> /
              <span className="font-mono text-text-primary"> shadow-motion</span> &mdash; brand-colored
              text, borders, shadows.
            </li>
          </ul>
        </div>
      </div>
    </BrandSection>
  );
}

/* -------------------------------------------------------------------------- */

function BrandSection({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string | null;
  children: React.ReactNode;
}) {
  return (
    <section className="section-tight border-b border-border-light">
      <div className="container-wide">
        <div className="max-w-3xl">
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="heading-lg mt-3">{title}</h2>
          {description && <p className="mt-4 body-lg">{description}</p>}
        </div>
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}
