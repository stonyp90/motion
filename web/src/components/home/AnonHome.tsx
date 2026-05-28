'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, PlayCircle } from 'lucide-react';
import { BrandMotionShowcase } from './BrandMotionShowcase';
import { FormatShowcase } from './FormatShowcase';
import { ProcessRow } from './ProcessRow';
import { LogoMarquee } from './LogoMarquee';
import { TrustStrip } from './TrustStrip';
import { KPIStrip } from './KPIStrip';

/**
 * Anonymous (logged-out) marketing surface. The signed-in build UI
 * lives in the desktop shell only (StudioApp); the web's authenticated
 * landing is WelcomeDashboard. So this component renders only when
 * the visitor has no session.
 *
 * Layout: cinematic hero band → reel card (BrandMotionShowcase) →
 * Format / Process / LogoMarquee / Trust / KPI strips.
 */
export function AnonHome() {
  const router = useRouter();
  return (
    <div className="relative flex w-full flex-col bg-bg-primary">
      <section
        aria-label="ControlCraft hero"
        className="relative isolate overflow-hidden px-4 pt-10 pb-20 sm:px-6 sm:pt-14 sm:pb-24 lg:pt-20 lg:pb-32"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            backgroundImage:
              'radial-gradient(circle at 18% 12%, color-mix(in srgb, var(--color-accent-500) 14%, transparent), transparent 55%),' +
              'radial-gradient(circle at 88% 92%, color-mix(in srgb, var(--color-secondary-500) 10%, transparent), transparent 60%)',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(to right, var(--color-text-primary) 1px, transparent 1px), linear-gradient(to bottom, var(--color-text-primary) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />

        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-7 text-center">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.32em] text-accent-700 dark:text-accent-400">
            ControlCraft  ·  Brand-grade motion, on tap
          </p>
          <h1 className="h-display max-w-4xl">
            From brief to broadcast,
            <br className="hidden sm:inline" />{' '}
            <span className="text-accent-700 dark:text-accent-400">
              in twenty minutes.
            </span>
          </h1>
          <p className="max-w-2xl text-lg leading-[1.55] text-text-secondary sm:text-xl">
            Marketing, product, and creative teams turn a brief into a
            finished animated explainer the same day &mdash; without an
            agency timeline or an agency invoice.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => router.push('/signup')}
              className="btn-accent group px-8 py-3.5 text-base"
              data-testid="hero-signup"
            >
              Get started &mdash; it&apos;s free
              <ArrowRight
                className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
                aria-hidden
              />
            </button>
            <a
              href="#reel"
              className="btn-ghost group px-6 py-3.5 text-base"
              data-testid="hero-watch-reel"
            >
              <PlayCircle className="h-5 w-5" aria-hidden />
              Watch the reel
            </a>
          </div>
        </div>
      </section>

      <section
        id="reel"
        aria-label="ControlCraft sample reel"
        className="relative mx-auto -mt-8 w-full max-w-6xl px-4 pb-16 sm:px-6 sm:pb-24"
      >
        <ReelHeader />

        <div className="group relative">
          <div className="relative aspect-video w-full overflow-hidden rounded-3xl border border-white/10 bg-[#0e1014] shadow-lift">
            <BrandMotionShowcase />

            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/50 to-transparent"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/40 to-transparent"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-[0.18] mix-blend-overlay"
              style={{
                backgroundImage:
                  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.55 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
                backgroundSize: '160px 160px',
              }}
            />

            <Link
              href="/signup"
              aria-label="Sign up to start a reel"
              className="absolute inset-0 z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
            />

            <div className="pointer-events-none absolute right-3 top-3 z-20 sm:right-5 sm:top-5">
              <Link
                href="/signup"
                className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white shadow-card backdrop-blur-md transition-colors hover:bg-white/20"
              >
                Sign up free
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>
          </div>

          <ReelFooter />
        </div>
      </section>

      <FormatShowcase />

      <ProcessRow />

      <LogoMarquee />

      <TrustStrip />

      <KPIStrip />
    </div>
  );
}

function ReelHeader() {
  return (
    <div className="mb-3 flex items-end justify-between gap-3 px-1 font-mono text-[10px] uppercase tracking-[0.22em] text-text-tertiary sm:text-[11px]">
      <span className="inline-flex items-center gap-2">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-500" aria-hidden />
        Reel 001  ·  auto-play
      </span>
      <span className="hidden sm:inline">
        4 scenes  ·  17s loop  ·  16:9  ·  H.264
      </span>
      <span>Ctrl 01 / 04</span>
    </div>
  );
}

function ReelFooter() {
  return (
    <div className="mt-3 grid grid-cols-1 gap-1 px-1 font-mono text-[10px] uppercase tracking-[0.22em] text-text-tertiary sm:grid-cols-3 sm:text-[11px]">
      <span className="inline-flex items-center gap-2">
        <span className="h-px w-6 bg-accent-500/60" aria-hidden />
        Brief  →  Lottie  in 46.4s
      </span>
      <span className="sm:text-center">
        12 characters  ·  ink + emerald  ·  Inter Bold
      </span>
      <span className="sm:text-right">
        Iterate in &lt; 1s  ·  MP4 / .lottie / SVG
      </span>
    </div>
  );
}
