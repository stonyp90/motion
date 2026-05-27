'use client';

import type { ReactNode } from 'react';
import { MotionLogo } from '@/components/MotionLogo';

interface Props {
  children: ReactNode;
  /** Three short value-prop bullets shown on the left panel at lg+ breakpoints. */
  bullets?: readonly { title: string; body: string }[];
  /** Small label above the bullets — defaults to the product tagline. */
  eyebrow?: string;
}

const DEFAULT_BULLETS = [
  {
    title: 'Brand-grade motion in twenty minutes.',
    body: 'Same brand system. Same security posture. Without the agency timeline.',
  },
  {
    title: 'Local-first by default.',
    body: 'Your brief stays on your laptop. No cloud round-trip, no rate limits.',
  },
  {
    title: 'Real motion, not a slideshow.',
    body: 'Lottie · MP4 · GSAP · Theatre — every export your stack already accepts.',
  },
] as const;

/**
 * Two-column scaffold shared by every auth surface (login, signup,
 * verify-email pending/success/expired, forgot-password, reset-password).
 *
 * - Left panel (lg+): brand voice + three value-prop bullets, staggered
 *   reveal on mount. Sits above the grid background for visual depth.
 * - Right panel: the form card. Centered vertically.
 *
 * On mobile, the left panel collapses to a slim header with just the
 * logo so we never burn vertical space above the input fields.
 */
export function AuthSplitLayout({ children, bullets = DEFAULT_BULLETS, eyebrow }: Props) {
  return (
    <main className="flex min-h-screen flex-col bg-bg-primary lg:grid lg:grid-cols-[1fr_minmax(0,32rem)] lg:grid-rows-1">
      {/* Left brand panel — collapses to a slim header on mobile */}
      <section
        className="relative hidden overflow-hidden bg-hero-grid px-12 py-16 lg:flex lg:flex-col lg:justify-between"
        aria-hidden="true"
      >
        <div className="animate-reveal-up stagger-child" style={{ '--i': 0 } as React.CSSProperties}>
          <MotionLogo size="lg" />
        </div>

        <div className="relative z-10 flex max-w-md flex-col gap-8">
          <p
            className="animate-reveal-up stagger-child font-mono text-xs font-medium uppercase tracking-[0.22em] text-text-accent"
            style={{ '--i': 1 } as React.CSSProperties}
          >
            {eyebrow ?? 'ControlCraft · Motion'}
          </p>
          <ul className="flex flex-col gap-7">
            {bullets.map((b, i) => (
              <li
                key={b.title}
                className="animate-reveal-up stagger-child flex flex-col gap-2"
                style={{ '--i': 2 + i } as React.CSSProperties}
              >
                <span className="text-lg font-semibold leading-snug tracking-tight text-text-primary">
                  {b.title}
                </span>
                <span className="text-sm leading-relaxed text-text-secondary">{b.body}</span>
              </li>
            ))}
          </ul>
        </div>

        <p
          className="animate-reveal-up stagger-child relative z-10 text-xs text-text-tertiary"
          style={{ '--i': 2 + bullets.length } as React.CSSProperties}
        >
          Already secured · SOC 2 Type II in progress · GDPR-aligned
        </p>
      </section>

      {/* Mobile-only slim header */}
      <header className="flex items-center justify-between border-b border-border-light px-4 py-4 lg:hidden">
        <MotionLogo size="md" />
      </header>

      {/* Right form panel */}
      <section className="flex flex-1 items-center justify-center bg-bg-primary px-4 py-12 sm:py-16">
        <div className="w-full max-w-md">{children}</div>
      </section>
    </main>
  );
}
