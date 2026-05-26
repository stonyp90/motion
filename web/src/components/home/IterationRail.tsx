'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { LottieJson } from '@/lib/lottie/transform';

// Defer the lottie-react runtime to the client + only when a tile
// actually mounts. PreviewFrame uses the same pattern so the chunk
// is shared and the home's first-load doesn't grow by ~310 kB just
// because the rail might render.
const Lottie = dynamic(() => import('lottie-react').then((m) => m.default), {
  ssr: false,
});

/**
 * Horizontal strip of past generations within the current session.
 *
 * Pattern: Midjourney's history dock + Krea's "Variations" rail +
 * Runway's generation strip. Each tile autoplays a tiny copy of the
 * animation; clicking restores it to the main preview and refills
 * the prompt with the brief that produced it. The active tile gets
 * an accent ring so the user knows which generation is on stage.
 *
 * Scrolls horizontally on overflow with snap-x to keep tiles aligned.
 * Hidden entirely when there are zero entries to keep the empty-state
 * layout clean.
 */

export interface IterationEntry {
  /** Client-side uuid, used as the React key + click target. */
  id: string;
  /** Brief that produced this animation. */
  prompt: string;
  /** Rendered Lottie body. */
  animation: LottieJson;
  /** `Date.now()` at generate-time, used for the tooltip. */
  ts: number;
}

interface Props {
  iterations: ReadonlyArray<IterationEntry>;
  /**
   * The id of the iteration currently shown in the main preview, or
   * `null` if the preview is mounted from somewhere else (e.g. the
   * user just generated and we haven't synced yet — the rail still
   * highlights the latest entry).
   */
  activeId: string | null;
  onSelect: (entry: IterationEntry) => void;
}

export function IterationRail({ iterations, activeId, onSelect }: Props) {
  if (iterations.length === 0) return null;

  return (
    <section
      aria-label="Previous generations in this session"
      className="-mt-2"
    >
      <header className="mb-2 flex items-baseline justify-between px-1">
        <h3 className="font-mono text-2xs uppercase tracking-[0.16em] text-text-tertiary">
          Iterations · this session
        </h3>
        <span className="font-mono text-2xs text-text-tertiary">
          {iterations.length}
        </span>
      </header>

      <ul
        role="list"
        className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-2"
      >
        {iterations
          .slice()
          // newest first — matches Midjourney + Krea muscle memory.
          .reverse()
          .map((entry, idx) => {
            const isActive = entry.id === activeId;
            const isLatest = idx === 0;
            return (
              <li key={entry.id} className="snap-start">
                <button
                  type="button"
                  onClick={() => onSelect(entry)}
                  // Truncated prompt + relative time give a tooltip that
                  // tells the user what the tile is without making them
                  // click in.
                  title={`${entry.prompt.slice(0, 80)}${entry.prompt.length > 80 ? '…' : ''}\n${relativeTime(entry.ts)}`}
                  className={`group relative overflow-hidden rounded-lg border bg-bg-secondary transition ${
                    isActive
                      ? 'border-accent-500 shadow-glow'
                      : 'border-border-light hover:border-accent-300'
                  }`}
                >
                  <div className="h-[60px] w-[108px]">
                    {/* 16:9 thumbnail. Lottie autoplays + loops at low
                        size; the cost is bounded by tile count, which
                        is bounded by session length. */}
                    <ThumbnailLottie animation={entry.animation} />
                  </div>
                  {/* Latest-generation badge — handy when the user has
                      cycled through several and lost track. */}
                  {isLatest && (
                    <span
                      aria-hidden
                      className="absolute right-1 top-1 rounded-sm bg-accent-600 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-white"
                    >
                      latest
                    </span>
                  )}
                </button>
              </li>
            );
          })}
      </ul>
    </section>
  );
}

/**
 * Tiny isolated Lottie player. Kept as a separate component so each
 * tile mounts with its own ref + autoplay loop — sharing a single
 * `Lottie` across the rail would only show the last animation.
 *
 * `key` is the JSON identity itself, so swapping the animation prop
 * remounts the player without stale frame state.
 */
function ThumbnailLottie({ animation }: { animation: LottieJson }) {
  // SSR safety — Lottie touches `window` on mount. Defer until client.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return <div className="h-full w-full bg-bg-primary" aria-hidden />;
  }
  return (
    <Lottie
      animationData={animation}
      loop
      autoplay
      style={{ width: '100%', height: '100%' }}
      // Disable pointer events on the SVG so the parent button
      // captures the click — Lottie's root svg eats clicks otherwise.
      rendererSettings={{ preserveAspectRatio: 'xMidYMid slice' }}
    />
  );
}

/**
 * "5s ago", "12m ago", "2h ago" — best-effort, no i18n. Returns a
 * fresh value each call (no memoisation) so a re-render after a tick
 * picks up the new relative time naturally.
 */
function relativeTime(ts: number): string {
  const delta = Math.max(0, Date.now() - ts);
  const s = Math.floor(delta / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
