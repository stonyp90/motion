'use client';

/**
 * FormatReel — small cinematic "format poster" used inside the
 * {@link FormatShowcase} strip on the anonymous home. Each tile is a
 * single-scene, CSS-only mini-reel that demonstrates how a brief
 * lands in a specific delivery format (wide / vertical / square).
 *
 * Why not reuse {@link BrandMotionShowcase}: BMS owns the 4-scene
 * cycle that anchors the primary reel. Embedding it three more times
 * would mean three competing animation loops on the same page (and a
 * lot of duplicate Brief/Cast/Generate/Preview/Export chips). The
 * format showcase needs one frozen "hero shot" per format with a
 * subtle entrance + a perpetual scene-accent shimmer — that's what
 * FormatReel provides.
 *
 * Pure CSS keyframes + React for hover-pause; no animation library;
 * `prefers-reduced-motion` neutralises every entrance + the shimmer.
 */

import type { CSSProperties } from 'react';

export interface FormatReelScene {
  /** Aspect-ratio token. Controls both the card box ratio and the
   *  meta tag that reads in the bottom-right. */
  aspect: '16:9' | '9:16' | '1:1';
  /** Small mono eyebrow above the headline (e.g. "WIDE  ·  EXPLAINER"). */
  eyebrow: string;
  /** Two-word kinetic title; both words appear, second one accent-coloured. */
  title: [string, string];
  /** Sub-line under the title — kept short, sub-1.5 lines. */
  sub: string;
  /** Bottom-right meta string ("CORPORATE · 1920×1080"). */
  meta: string;
  /** Accent color token used for the eyebrow, accent word, and dot. */
  accent: string;
}

const ASPECT_CLASS: Record<FormatReelScene['aspect'], string> = {
  '16:9': 'aspect-video',
  '9:16': 'aspect-[9/16]',
  '1:1': 'aspect-square',
};

interface Props {
  scene: FormatReelScene;
  /** Animation offset so cards in a row don't enter/shimmer in lockstep. */
  delayMs?: number;
}

export function FormatReel({ scene, delayMs = 0 }: Props) {
  const [accentWord, restWord] = scene.title;

  return (
    <div
      className={`format-reel relative w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0e1014] shadow-card transition-transform duration-300 hover:-translate-y-1 hover:shadow-lift ${ASPECT_CLASS[scene.aspect]}`}
      style={
        {
          '--fr-accent': scene.accent,
          '--fr-delay': `${delayMs}ms`,
        } as CSSProperties
      }
    >
      <style jsx>{`
        .format-reel {
          background-image:
            radial-gradient(circle at 22% 18%, color-mix(in srgb, var(--fr-accent) 22%, transparent), transparent 55%),
            radial-gradient(circle at 78% 82%, color-mix(in srgb, #f59e0b 10%, transparent), transparent 60%),
            linear-gradient(to bottom right, #0e1014, #1a1e25);
        }

        /* Faint 32px grid texture, scaled per tile so a square card
           reads the same density as a vertical one. */
        .format-reel::before {
          content: '';
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(to right, rgba(255, 255, 255, 0.04) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255, 255, 255, 0.04) 1px, transparent 1px);
          background-size: 32px 32px;
          pointer-events: none;
        }

        /* Slow shimmer band that sweeps from top-left to bottom-right
           every ~7s. Lifts the static composition without flashing. */
        @keyframes fr-shimmer {
          0%   { transform: translate(-30%, -30%); opacity: 0; }
          25%  { opacity: 0.5; }
          75%  { opacity: 0.5; }
          100% { transform: translate(30%, 30%); opacity: 0; }
        }
        .fr-shimmer {
          position: absolute;
          inset: -25% -25%;
          background: linear-gradient(
            120deg,
            transparent 35%,
            color-mix(in srgb, var(--fr-accent) 16%, transparent) 50%,
            transparent 65%
          );
          animation: fr-shimmer 7s var(--ease-out-quart) infinite;
          animation-delay: var(--fr-delay);
          pointer-events: none;
          mix-blend-mode: screen;
        }

        @keyframes fr-fade-up {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .fr-eyebrow,
        .fr-title,
        .fr-sub {
          opacity: 0;
          animation: fr-fade-up 0.8s var(--ease-out-quart) both;
        }
        .fr-eyebrow { animation-delay: calc(var(--fr-delay) + 0.1s); }
        .fr-title   { animation-delay: calc(var(--fr-delay) + 0.25s); }
        .fr-sub     { animation-delay: calc(var(--fr-delay) + 0.45s); }

        @keyframes fr-dot-pulse {
          0%, 100% { opacity: 0.9; transform: scale(1); }
          50%      { opacity: 0.45; transform: scale(0.85); }
        }
        .fr-pip { animation: fr-dot-pulse 2.4s var(--ease-out-quart) infinite; }

        @media (prefers-reduced-motion: reduce) {
          .fr-shimmer,
          .fr-eyebrow,
          .fr-title,
          .fr-sub,
          .fr-pip {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
          }
        }
      `}</style>

      {/* Sweeping shimmer band */}
      <div className="fr-shimmer" aria-hidden />

      {/* Aspect-ratio chip — top-left */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/45 px-2.5 py-1 backdrop-blur-sm">
        <span
          aria-hidden
          className="fr-pip h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: scene.accent }}
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/95">
          {scene.aspect}
        </span>
      </div>

      {/* Centred scene composition */}
      <div className="relative grid h-full w-full place-items-center px-4 sm:px-6">
        <div className="flex w-full max-w-[80%] flex-col items-center gap-2.5 text-center">
          <p
            className="fr-eyebrow font-mono text-[10px] font-semibold uppercase tracking-[0.22em]"
            style={{ color: scene.accent }}
          >
            {scene.eyebrow}
          </p>
          <h3 className="fr-title text-balance flex flex-wrap justify-center gap-x-2 text-xl font-bold leading-[1.05] tracking-tight text-white sm:text-2xl">
            <span>{accentWord}</span>
            <span style={{ color: scene.accent }}>{restWord}</span>
          </h3>
          <p className="fr-sub max-w-[24ch] text-[11px] leading-snug text-white/65 sm:text-xs">
            {scene.sub}
          </p>
        </div>
      </div>

      {/* Bottom-right meta */}
      <div className="pointer-events-none absolute bottom-3 right-3 z-10 font-mono text-[9px] uppercase tracking-[0.16em] text-white/55 sm:text-[10px]">
        {scene.meta}
      </div>
    </div>
  );
}
