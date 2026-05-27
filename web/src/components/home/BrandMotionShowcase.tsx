'use client';

/**
 * BrandMotionShowcase — the alive empty-state demo on the home preview.
 *
 * Replaces the previous Lottie-based player (lottie-web silently dropped
 * our shape groups → blank square on most visitors). Pure CSS keyframes
 * + React state — no animation library — so it works in every browser
 * and React/Next combo the app supports.
 *
 * Design rules:
 * - Theme-aware: every color resolves through CSS variables, so light
 *   + dark themes look intentional.
 * - 4 scenes × ~4.2s each = ~17s loop. Auto-advances.
 * - SSR-safe: no `Math.random`, no `Date.now`, no window access at
 *   render time. The first scene is deterministic.
 * - Reduced motion: respects `prefers-reduced-motion` via CSS
 *   `@media` rule on the keyframes — falls back to a static
 *   composite of the active scene with no entrance animation.
 *
 * Edit the SCENES array below to change copy, palette, or eyebrow.
 * No animation code needs to be touched.
 */

import { useEffect, useState } from 'react';

interface Scene {
  id: string;
  eyebrow: string;
  headline: string;
  sub: string;
  /** CSS color (token) for the scene-specific accent ring + chip dot. */
  accent: string;
  /** Tagline shown bottom-right ("playful · 1920×1080" style). */
  meta: string;
}

const SCENES: ReadonlyArray<Scene> = [
  {
    id: 'corporate',
    eyebrow: 'BRIEF',
    headline: 'Brand-grade motion design',
    sub: 'Same day. Same brand system. Same security posture.',
    accent: 'var(--color-accent-400)',
    meta: 'corporate · 1920×1080',
  },
  {
    // Animation-feature scene — animation studios are the canonical
    // motion-design buyer, so the example reads as native to the
    // product instead of leaking a one-vertical pitch.
    id: 'animation',
    eyebrow: 'FESTIVAL TEASER',
    headline: 'From storyboard to broadcast in twenty minutes.',
    sub: 'Animated-feature teasers, festival cuts, distributor reels — every market, every format.',
    accent: 'var(--color-secondary-400)',
    meta: 'animation · 1920×1080',
  },
  {
    id: 'playful',
    eyebrow: 'CAMPAIGN',
    headline: 'From brief to broadcast in minutes',
    sub: 'Iterate to a new tagline, market, or persona in seconds.',
    accent: 'var(--color-accent-300)',
    meta: 'playful · 1920×1080',
  },
  {
    id: 'minimalist',
    eyebrow: 'PRINCIPLE',
    headline: 'Less waiting. More making.',
    sub: 'Calm motion. Tight typography. Numbers that count up.',
    accent: 'var(--color-accent-500)',
    meta: 'minimalist · 1920×1080',
  },
] as const;

const CHIPS = ['Brief', 'Cast', 'Generate', 'Preview', 'Export'] as const;
const SCENE_DURATION_MS = 4_200;

export function BrandMotionShowcase() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setActive((i) => (i + 1) % SCENES.length);
    }, SCENE_DURATION_MS);
    return () => window.clearInterval(id);
  }, []);

  const scene = SCENES[active]!;
  const words = scene.headline.split(' ');

  return (
    <div
      aria-label="ControlCraft motion-design demo"
      className="bms-root relative h-full w-full overflow-hidden rounded-2xl"
      style={
        {
          '--bms-accent': scene.accent,
        } as React.CSSProperties
      }
    >
      <style jsx>{`
        /* Fixed dark surface — the showcase represents a "video
           canvas" (the thing a user plays back), and video canvases
           are always dark regardless of the surrounding theme. Same
           convention as Stripe's hero demo + Apple's Mac mini page.
           Hard-coded colors so the white text on top stays legible
           in both light and dark page themes. */
        .bms-root {
          background-image:
            radial-gradient(
              circle at 25% 20%,
              color-mix(in srgb, var(--bms-accent) 28%, transparent),
              transparent 55%
            ),
            radial-gradient(
              circle at 75% 80%,
              color-mix(in srgb, #f59e0b 14%, transparent),
              transparent 55%
            ),
            linear-gradient(to bottom right, #0e1014, #1a1e25);
        }

        /* Animation primitives — pure @keyframes, no JS library. */
        @keyframes bms-fade-up {
          from {
            opacity: 0;
            transform: translateY(14px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes bms-fade-in {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes bms-spring-in {
          0% {
            opacity: 0;
            transform: translateY(20px) scale(0.94);
          }
          60% {
            opacity: 1;
            transform: translateY(-2px) scale(1.02);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes bms-slide-from-left {
          from {
            opacity: 0;
            transform: translateX(-36px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        @keyframes bms-slide-from-right {
          from {
            opacity: 0;
            transform: translateX(36px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        @keyframes bms-slide-from-bottom {
          from {
            opacity: 0;
            transform: translateY(24px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes bms-slide-from-top {
          from {
            opacity: 0;
            transform: translateY(-24px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        /* Scene container — fades in as a whole. Brand Decelerate token. */
        .bms-scene {
          animation: bms-fade-in var(--dur-slow) var(--ease-out-quart) both;
        }

        /* Eyebrow appears first. */
        .bms-eyebrow {
          animation: bms-fade-up var(--dur-slow) var(--ease-out-quart) both;
        }

        /* Headline words stagger in with a spring overshoot. The only
           place on the home licensed to use --ease-spring — it's the
           moment-of-arrival punctuation. */
        .bms-word {
          display: inline-block;
          opacity: 0;
          animation: bms-spring-in var(--dur-spring) var(--ease-spring) both;
        }

        /* Sub appears after all words have landed. */
        .bms-sub {
          animation: bms-fade-up var(--dur-slow) var(--ease-out-quart) 0.6s both;
        }

        /* Process chips — each slides in from a different direction. */
        .bms-chip {
          opacity: 0;
          animation-duration: var(--dur-slow);
          animation-timing-function: var(--ease-spring);
          animation-fill-mode: both;
        }
        .bms-chip-0 { animation-name: bms-slide-from-left;  animation-delay: 0.85s; }
        .bms-chip-1 { animation-name: bms-slide-from-bottom; animation-delay: 0.95s; }
        .bms-chip-2 { animation-name: bms-slide-from-top;   animation-delay: 1.05s; }
        .bms-chip-3 { animation-name: bms-slide-from-bottom; animation-delay: 1.15s; }
        .bms-chip-4 { animation-name: bms-slide-from-right; animation-delay: 1.25s; }

        /* Pulsing accent dot on the SAMPLE badge. Long-pulse + Decelerate
           for ambient breathing — never attention-grabbing. */
        @keyframes bms-pulse {
          0%, 100% { opacity: 0.9; transform: scale(1); }
          50%      { opacity: 0.5; transform: scale(0.85); }
        }
        .bms-sample-dot {
          animation: bms-pulse var(--dur-long-pulse) var(--ease-out-quart) infinite;
        }

        /* Reduced-motion: kill every entrance + the pulse. */
        @media (prefers-reduced-motion: reduce) {
          .bms-scene,
          .bms-eyebrow,
          .bms-word,
          .bms-sub,
          .bms-chip,
          .bms-sample-dot {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
          }
        }
      `}</style>

      {/* Subtle grid texture — "this is a motion-design canvas". */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(to right, var(--color-text-primary) 1px, transparent 1px), linear-gradient(to bottom, var(--color-text-primary) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* Scene composition — keyed so it re-runs entrance animations
          on every scene change. */}
      <div key={scene.id} className="bms-scene relative h-full w-full">
        <SceneComposition scene={scene} words={words} />
      </div>

      {/* SAMPLE pill — top-left */}
      <div className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/45 px-2.5 py-1 backdrop-blur-sm">
        <span
          aria-hidden
          className="bms-sample-dot h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: scene.accent }}
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/95">
          Sample
        </span>
      </div>

      {/* Meta — bottom-right */}
      <div className="pointer-events-none absolute bottom-3 right-3 font-mono text-[10px] uppercase tracking-[0.16em] text-white/60">
        {scene.meta}
      </div>

      {/* Scene-progress dots — clickable for skip-ahead */}
      <div className="absolute bottom-3 left-3 flex gap-1.5">
        {SCENES.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActive(i)}
            aria-label={`Show scene ${i + 1}: ${s.headline}`}
            className={
              'h-1.5 rounded-full transition-all ' +
              (i === active
                ? 'w-6 bg-accent-300'
                : 'w-1.5 bg-white/35 hover:bg-white/60')
            }
          />
        ))}
      </div>
    </div>
  );
}

function SceneComposition({
  scene,
  words,
}: {
  scene: Scene;
  words: string[];
}) {
  return (
    <div className="grid h-full w-full place-items-center px-8 sm:px-12 md:px-16">
      <div className="flex w-full flex-col items-center gap-5 text-center">
        <p
          className="bms-eyebrow font-mono text-[11px] font-semibold uppercase tracking-[0.18em]"
          style={{ color: scene.accent }}
        >
          {scene.eyebrow}
        </p>

        <h2
          className="flex max-w-2xl flex-wrap justify-center gap-x-[0.35em] gap-y-1 text-2xl font-bold leading-[1.05] tracking-tight text-white sm:text-3xl md:text-4xl"
          style={{ textWrap: 'balance' } as React.CSSProperties}
        >
          {words.map((word, i) => (
            <span
              key={`${word}-${i}`}
              className="bms-word"
              style={{ animationDelay: `${0.08 + i * 0.07}s` }}
            >
              {word}
            </span>
          ))}
        </h2>

        <p className="bms-sub max-w-xl text-sm leading-snug text-white/70 sm:text-base">
          {scene.sub}
        </p>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          {CHIPS.map((label, i) => (
            <div
              key={label}
              className={`bms-chip bms-chip-${i} inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium text-white/90 backdrop-blur-sm`}
              style={{
                borderColor: 'color-mix(in srgb, white 18%, transparent)',
                backgroundColor: 'color-mix(in srgb, black 30%, transparent)',
              }}
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: scene.accent }}
              />
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
