'use client';

/**
 * FormatShowcase — three-up grid of {@link FormatReel} tiles that
 * sits under the anonymous-home primary reel. Each tile demonstrates
 * one delivery format the engine can ship: wide explainer (16:9),
 * vertical social (9:16), square feed (1:1). Communicates range
 * without rendering three competing scene cycles.
 *
 * Layout: a 3-column CSS grid on lg+ where the wide tile spans two
 * columns (mirrors how an actual reel sheet is laid out — the hero
 * cut + the cutdowns underneath). Mobile collapses to a single
 * column stack with the wide tile leading.
 */

import { FormatReel, type FormatReelScene } from './FormatReel';

const SCENES: ReadonlyArray<FormatReelScene> = [
  {
    aspect: '16:9',
    eyebrow: 'WIDE  ·  EXPLAINER',
    title: ['How Chrono', 'pays you back.'],
    sub: 'Sixty seconds. Five beats. One brand system.',
    meta: 'CORPORATE  ·  1920×1080',
    accent: 'var(--color-accent-400)',
  },
  {
    aspect: '9:16',
    eyebrow: 'VERTICAL  ·  SOCIAL',
    title: ['Stop the', 'thumb mid-scroll.'],
    sub: 'Eight-second hooks for IG, TikTok, Shorts.',
    meta: 'PLAYFUL  ·  1080×1920',
    accent: 'var(--color-secondary-400)',
  },
  {
    aspect: '1:1',
    eyebrow: 'SQUARE  ·  FEED',
    title: ['Ship a', 'feed ad by lunch.'],
    sub: 'Fifteen-second cutdown, ready for paid.',
    meta: 'MINIMALIST  ·  1080×1080',
    accent: 'var(--color-accent-300)',
  },
] as const;

export function FormatShowcase() {
  return (
    <section
      aria-label="Delivery formats"
      className="relative mx-auto w-full max-w-6xl px-4 pt-2 pb-16 sm:px-6 sm:pb-20"
    >
      <SectionHeader />

      {/* Layout: a top "hero cut" row (16:9, full width) and a second
          row that pairs the square cutdown with the vertical poster.
          The widths in row 2 (2/3 + 1/3 of max-w-6xl) put the square
          at ~768px × 768px and the vertical at ~384px × 683px, which
          balances the row without a row-span trick. */}
      <div className="flex flex-col gap-4 lg:gap-5">
        <FormatReel scene={SCENES[0]!} delayMs={0} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:gap-5">
          <div className="sm:col-span-2">
            <FormatReel scene={SCENES[2]!} delayMs={120} />
          </div>
          <FormatReel scene={SCENES[1]!} delayMs={240} />
        </div>
      </div>
    </section>
  );
}

/**
 * Local section header so the showcase reads as a chapter — same
 * mono / accent eyebrow register the reel chrome uses, with a tight
 * h2 and a single-sentence lede.
 */
function SectionHeader() {
  return (
    <div className="mb-5 flex flex-col gap-1.5 px-1 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
      <div className="flex flex-col gap-1.5">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-accent-700 dark:text-accent-400">
          Format  ·  Sheet 02
        </p>
        <h2 className="text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
          Same brief, every format.
        </h2>
      </div>
      <p className="max-w-md text-sm leading-snug text-text-secondary sm:text-right">
        One generate, then cut down to wide, vertical, and square
        without touching the timeline.
      </p>
    </div>
  );
}
