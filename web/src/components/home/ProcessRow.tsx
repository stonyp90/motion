'use client';

/**
 * ProcessRow — three-step "how it works" strip on the anonymous home.
 *
 * Each step is a numbered card that reads like a chapter from a
 * shooting script: chapter tag, step title, one-line sub, and a
 * stylized mini-illustration (pure CSS shapes — no Lottie, no SVG
 * imports). The cards stagger in on first view and the mini-art has
 * a perpetual ambient micro-motion so the row never freezes.
 *
 * Why CSS-only art: the engine's actual character pack is built for
 * the reel canvas (200×200 viewport per character, ink + emerald
 * register). Embedding seven of those Lotties here would re-hit the
 * lottie-web blank-square bug. The shapes below render the same
 * register — ink stroke + emerald accent — directly in HTML/CSS so
 * we keep the brand without re-introducing the risk.
 */

import type { ReactNode } from 'react';

interface Step {
  id: string;
  index: string;
  chapter: string;
  title: string;
  sub: string;
  Illustration: () => ReactNode;
}

const STEPS: ReadonlyArray<Step> = [
  {
    id: 'brief',
    index: '01',
    chapter: 'SCENE 01',
    title: 'Type the brief.',
    sub: 'Free-form text, dictation, or a Figma frame. Mention the brand and the pitch — that is the whole input.',
    Illustration: () => (
      <div className="pr-art relative grid h-full w-full place-items-center">
        <div className="pr-brief-stack relative w-44">
          <div className="pr-brief-line h-2.5 w-full rounded-full bg-white/35" />
          <div className="pr-brief-line mt-2 h-2.5 w-3/4 rounded-full bg-white/25" />
          <div className="pr-brief-line mt-2 h-2.5 w-5/6 rounded-full bg-white/30" />
          <div className="pr-brief-cursor mt-2 inline-block h-3 w-[2px] translate-y-0.5 bg-accent-400" />
        </div>
      </div>
    ),
  },
  {
    id: 'generate',
    index: '02',
    chapter: 'SCENE 02',
    title: 'Engine composes.',
    sub: 'Cast lands, scenes stack, kinetic typography snaps to your brand palette — under ninety seconds, every time.',
    Illustration: () => (
      <div className="pr-art relative grid h-full w-full place-items-center">
        <div className="pr-stage relative h-24 w-44 overflow-hidden rounded-lg border border-white/10 bg-black/40">
          {/* simulated scene strips lighting up left-to-right */}
          {Array.from({ length: 6 }).map((_, i) => (
            <span
              key={i}
              className="pr-strip absolute bottom-2 h-2 rounded-sm bg-accent-500"
              style={{
                left: `calc(${i} * 16% + 4%)`,
                width: '12%',
                animationDelay: `${i * 0.18}s`,
              }}
            />
          ))}
          <span className="pr-spot absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-400/35 blur-xl" />
        </div>
      </div>
    ),
  },
  {
    id: 'ship',
    index: '03',
    chapter: 'SCENE 03',
    title: 'Ship the cut.',
    sub: 'Lottie, MP4, WebM, SVG, GSAP, Motion, Theatre.js, Framer — the whole export sheet, on one tap.',
    Illustration: () => (
      <div className="pr-art relative grid h-full w-full place-items-center">
        <div className="relative flex items-center gap-2">
          {['MP4', '.LOTTIE', 'SVG', 'WEBM'].map((fmt, i) => (
            <span
              key={fmt}
              className="pr-chip rounded-full border border-white/15 bg-white/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/85"
              style={{ animationDelay: `${i * 0.12}s` }}
            >
              {fmt}
            </span>
          ))}
        </div>
      </div>
    ),
  },
] as const;

export function ProcessRow() {
  return (
    <section
      aria-label="How motion-forge works"
      className="relative mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 sm:pb-20"
    >
      <style jsx>{`
        @keyframes pr-card-up {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        :global(.pr-card-in) {
          animation: pr-card-up 0.7s var(--ease-out-quart) both;
        }

        /* mini-art micro-motion */
        @keyframes pr-cursor-blink {
          0%, 70%, 100% { opacity: 1; }
          80%           { opacity: 0; }
        }
        :global(.pr-brief-cursor) {
          animation: pr-cursor-blink 1.2s var(--ease-linear) infinite;
        }
        @keyframes pr-strip-grow {
          0%   { transform: scaleY(0.2); opacity: 0.35; transform-origin: bottom; }
          50%  { transform: scaleY(1);   opacity: 1;    transform-origin: bottom; }
          100% { transform: scaleY(0.4); opacity: 0.55; transform-origin: bottom; }
        }
        :global(.pr-strip) {
          animation: pr-strip-grow 1.8s var(--ease-out-quart) infinite;
          transform-origin: bottom;
        }
        @keyframes pr-spot-pulse {
          0%, 100% { opacity: 0.35; transform: translate(-50%, -50%) scale(1); }
          50%      { opacity: 0.6;  transform: translate(-50%, -50%) scale(1.1); }
        }
        :global(.pr-spot) {
          animation: pr-spot-pulse 2.6s var(--ease-out-quart) infinite;
        }
        @keyframes pr-chip-hop {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-3px); }
        }
        :global(.pr-chip) {
          animation: pr-chip-hop 2.4s var(--ease-out-quart) infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          :global(.pr-card-in),
          :global(.pr-brief-cursor),
          :global(.pr-strip),
          :global(.pr-spot),
          :global(.pr-chip) {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
          }
        }
      `}</style>

      <div className="mb-5 flex flex-col gap-1.5 px-1 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="flex flex-col gap-1.5">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-accent-700 dark:text-accent-400">
            Production  ·  Sheet 03
          </p>
          <h2 className="text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
            Three scenes. One finished spot.
          </h2>
        </div>
        <p className="max-w-md text-sm leading-snug text-text-secondary sm:text-right">
          Type. Generate. Ship. No timelines, no render farm, no week
          of back-and-forth with an agency.
        </p>
      </div>

      <ol className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {STEPS.map((step, i) => (
          <li
            key={step.id}
            className="pr-card-in flex flex-col overflow-hidden rounded-2xl border border-border-light bg-bg-secondary"
            style={{ animationDelay: `${i * 0.12}s` }}
          >
            {/* dark mini-canvas at the top */}
            <div className="relative aspect-[5/3] w-full overflow-hidden bg-[#0e1014]">
              <span className="pointer-events-none absolute left-3 top-3 font-mono text-[10px] uppercase tracking-[0.22em] text-white/55">
                {step.chapter}
              </span>
              <span className="pointer-events-none absolute right-3 top-3 font-mono text-[10px] uppercase tracking-[0.22em] text-accent-300">
                {step.index}
              </span>
              <step.Illustration />
            </div>

            <div className="flex flex-col gap-2 p-5">
              <h3 className="text-lg font-bold tracking-tight text-text-primary">
                {step.title}
              </h3>
              <p className="text-sm leading-snug text-text-secondary">
                {step.sub}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
