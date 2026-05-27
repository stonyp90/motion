'use client';

import type { ReactNode } from 'react';
import { MotionLogo } from '@/components/MotionLogo';

interface Props {
  children: ReactNode;
  /** Three short value-prop bullets shown on the left panel at lg+ breakpoints. */
  bullets?: readonly { title: string; body: string }[];
  /** Small label above the bullets — defaults to the product tagline. */
  eyebrow?: string;
  /** Film-strip register on the right column above the form card. */
  rightChapter?: string;
}

const DEFAULT_BULLETS = [
  {
    title: 'Brand-grade motion, in twenty minutes.',
    body: 'Same brand system. Same security posture. Without the agency timeline or the agency invoice.',
  },
  {
    title: 'Local-first by default.',
    body: 'Your brief stays on your laptop. No cloud round-trip, no rate limits, no surprise compute bill.',
  },
  {
    title: 'Real motion, not a slideshow.',
    body: 'Lottie · MP4 · WebM · SVG · GSAP · Motion · Theatre.js · Framer — every export your stack already accepts.',
  },
] as const;

const TRUST_PILLS = [
  'SOC 2 Type II in progress',
  'GDPR-aligned',
  'SSO / SAML',
  'Self-host or cloud',
] as const;

/**
 * Two-column scaffold shared by every auth surface (login, signup,
 * verify-email pending/success/expired, forgot-password, reset-password).
 *
 * Visual register matches the new anonymous home: ambient emerald +
 * amber glow, faint 48px grid texture, film-strip mono rules top and
 * bottom. The left panel reads as a "stage" (the surrounding theatre)
 * and the right panel is the lit "booth" where the form actually lives.
 *
 * - Left stage (lg+): film-strip top rule, brand voice, three numbered
 *   "scene cards" instead of plain bullets, trust pill row at the
 *   bottom. Sits above the grid background for visual depth.
 * - Right booth: mono chapter tag above the form card, the form
 *   itself, then a "next take" footnote below.
 *
 * On mobile the left stage collapses to a slim header with just the
 * logo so we never burn vertical space above the input fields.
 */
export function AuthSplitLayout({
  children,
  bullets = DEFAULT_BULLETS,
  eyebrow,
  rightChapter,
}: Props) {
  const chapter = rightChapter ?? 'ACT 01  ·  ONBOARDING';

  return (
    <main className="relative flex min-h-screen flex-col bg-bg-primary lg:grid lg:grid-cols-[1fr_minmax(0,34rem)] lg:grid-rows-1">
      {/* ────────────────── left "stage" ────────────────── */}
      <section
        className="relative hidden overflow-hidden bg-bg-primary px-12 py-12 lg:flex lg:flex-col lg:justify-between"
        aria-hidden="true"
      >
        {/* Ambient glow — same emerald + amber tune as the home hero so
            the page reads as one continuous canvas. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle at 18% 12%, color-mix(in srgb, var(--color-accent-500) 16%, transparent), transparent 55%),' +
              'radial-gradient(circle at 88% 92%, color-mix(in srgb, var(--color-secondary-500) 10%, transparent), transparent 60%)',
          }}
        />
        {/* 48px grid texture */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              'linear-gradient(to right, var(--color-text-primary) 1px, transparent 1px), linear-gradient(to bottom, var(--color-text-primary) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />

        {/* Film-strip top rule */}
        <div className="relative z-10 flex items-center justify-between">
          <div
            className="animate-reveal-up stagger-child"
            style={{ '--i': 0 } as React.CSSProperties}
          >
            <MotionLogo size="lg" />
          </div>
          <div
            className="animate-reveal-up stagger-child flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-text-tertiary"
            style={{ '--i': 0 } as React.CSSProperties}
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-500" aria-hidden />
            Reel 000  ·  Onboarding
          </div>
        </div>

        {/* Center stack: eyebrow + display headline + scene cards */}
        <div className="relative z-10 flex max-w-xl flex-col gap-9">
          <div className="flex flex-col gap-3">
            <p
              className="animate-reveal-up stagger-child font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-accent-700 dark:text-accent-400"
              style={{ '--i': 1 } as React.CSSProperties}
            >
              {eyebrow ?? 'ControlCraft  ·  Motion'}
            </p>
            <h2
              className="animate-reveal-up stagger-child text-3xl font-bold leading-[1.05] tracking-tight text-text-primary sm:text-4xl"
              style={{ '--i': 2 } as React.CSSProperties}
            >
              The studio in your{' '}
              <span className="text-accent-700 dark:text-accent-400">
                command bar.
              </span>
            </h2>
          </div>

          <ol className="flex flex-col gap-5">
            {bullets.map((b, i) => (
              <li
                key={b.title}
                className="animate-reveal-up stagger-child flex gap-4"
                style={{ '--i': 3 + i } as React.CSSProperties}
              >
                <span
                  aria-hidden
                  className="mt-[2px] inline-flex h-7 w-7 flex-none items-center justify-center rounded-md border border-border-light bg-bg-secondary font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-text-accent"
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="flex flex-col gap-1">
                  <span className="text-base font-semibold leading-snug tracking-tight text-text-primary">
                    {b.title}
                  </span>
                  <span className="text-sm leading-relaxed text-text-secondary">
                    {b.body}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Trust pill row — film-strip footer */}
        <div
          className="animate-reveal-up stagger-child relative z-10 flex flex-wrap items-center gap-2"
          style={{ '--i': 3 + bullets.length } as React.CSSProperties}
        >
          {TRUST_PILLS.map((label) => (
            <span
              key={label}
              className="inline-flex items-center gap-1.5 rounded-full border border-border-light bg-bg-secondary px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary"
            >
              <span className="h-1 w-1 rounded-full bg-accent-500" aria-hidden />
              {label}
            </span>
          ))}
        </div>
      </section>

      {/* ────────────────── mobile slim header ────────────────── */}
      <header className="flex items-center justify-between border-b border-border-light px-4 py-4 lg:hidden">
        <MotionLogo size="md" />
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-tertiary">
          <span className="h-1 w-1 animate-pulse rounded-full bg-accent-500" aria-hidden />
          Reel 000
        </span>
      </header>

      {/* ────────────────── right "booth" (form panel) ────────────────── */}
      <section className="relative flex flex-1 flex-col items-stretch justify-center bg-bg-secondary px-4 py-12 sm:px-8 sm:py-16">
        {/* Subtle ambient glow on the booth side too so the right pane
            doesn't read as a flat slab next to the left stage. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle at 100% 0%, color-mix(in srgb, var(--color-accent-500) 6%, transparent), transparent 50%)',
          }}
        />

        <div className="relative z-10 mx-auto flex w-full max-w-md flex-col gap-3">
          <div className="flex items-end justify-between gap-3 px-1 font-mono text-[10px] uppercase tracking-[0.22em] text-text-tertiary">
            <span className="inline-flex items-center gap-2">
              <span className="h-px w-6 bg-accent-500/60" aria-hidden />
              {chapter}
            </span>
            <span>Take 01</span>
          </div>

          {children}

          <p className="px-1 text-center text-[11px] text-text-tertiary">
            Next take  ·  confirm email  ·  pick your brand palette  ·  ship your first reel.
          </p>
        </div>
      </section>
    </main>
  );
}
