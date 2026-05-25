'use client';

/**
 * LoadingPreview — skeleton shown in the preview frame while generation is
 * in flight. Mirrors the final 16:9 preview layout exactly so the reveal of
 * the real lottie causes zero layout shift.
 *
 * Three things this does that a naive spinner would not:
 *  1. Echoes the user's brief as faint placeholder copy so the wait feels
 *     "your prompt is the one being worked on" rather than generic.
 *  2. Stages dots step through three labels in sync with Suno's text → first
 *     → complete callback pattern. We don't know which stage we're in yet,
 *     so we cycle through them on a soft cadence.
 *  3. Honors the LOADER_SHOW_DELAY pattern (caller mounts this only after
 *     the debounce, not on every keystroke).
 *
 * The shimmer animation, durations, and easing all come from motion-principles.css.
 * If prefers-reduced-motion is on, the shimmer animation is suppressed (the
 * skeleton becomes a solid tertiary surface) while the stage label still
 * cycles, so screen readers still announce progress.
 */

import { useEffect, useState } from 'react';

interface LoadingPreviewProps {
  /** First sentence of the prompt — echoed as faint placeholder copy. */
  briefSnippet?: string;
  /**
   * Optional pipeline stage. If provided, we display it. If omitted, we
   * cycle through reasonable defaults on a soft cadence so the wait never
   * feels frozen.
   */
  stage?: 'text' | 'first' | 'complete';
}

const STAGES: Record<NonNullable<LoadingPreviewProps['stage']>, string> = {
  text:     'Reading the brief',
  first:    'Composing the first frame',
  complete: 'Polishing motion',
};

const STAGE_ORDER: Array<NonNullable<LoadingPreviewProps['stage']>> = [
  'text',
  'first',
  'complete',
];

export function LoadingPreview({ briefSnippet, stage }: LoadingPreviewProps) {
  // Cycle through stages every 1.6s when caller doesn't drive us.
  const [autoStageIdx, setAutoStageIdx] = useState(0);
  useEffect(() => {
    if (stage) return;
    const id = setInterval(() => {
      setAutoStageIdx((i) => (i + 1) % STAGE_ORDER.length);
    }, 1600);
    return () => clearInterval(id);
  }, [stage]);

  const resolvedStage = stage ?? STAGE_ORDER[autoStageIdx];
  const label = STAGES[resolvedStage];

  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label={`${label}${briefSnippet ? ` — ${briefSnippet}` : ''}`}
      className="relative aspect-video w-full overflow-hidden rounded-2xl border border-border-light bg-bg-secondary"
    >
      {/* Shimmer plate — fills the canvas. No content underneath; we layer
          text over the top. */}
      <div
        aria-hidden
        className="absolute inset-0 animate-skeleton-shimmer"
      />

      {/* Brief echo — the user's first sentence, faintly. Anchored low so it
          feels like a caption, not a placeholder for the visual. */}
      {briefSnippet && (
        <p
          aria-hidden
          className="absolute inset-x-0 bottom-8 px-10 text-center font-mono text-xs text-text-tertiary opacity-70"
        >
          &ldquo;{briefSnippet}&rdquo;
        </p>
      )}

      {/* Live stage label — center-bottom, paired with three subtle pulsing
          dots. The dots are decorative; the label carries the meaning. */}
      <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-2 text-sm text-text-secondary">
        <span className="font-medium">{label}</span>
        <StagedDots />
      </div>
    </div>
  );
}

/**
 * Three dots that fade in sequence. Pure CSS, no JS animation.
 * Stagger uses the design system's --dur-stagger token via the CSS variable.
 */
function StagedDots() {
  return (
    <span className="inline-flex gap-0.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-1 w-1 rounded-full bg-text-tertiary"
          style={{
            animation: 'staged-dots 1200ms var(--ease-out-quart) infinite',
            animationDelay: `${i * 150}ms`,
          }}
        />
      ))}
      <style jsx>{`
        @keyframes staged-dots {
          0%, 60%, 100% { opacity: 0.25; transform: translateY(0); }
          30%           { opacity: 1;    transform: translateY(-1px); }
        }
        @media (prefers-reduced-motion: reduce) {
          span { animation: none !important; opacity: 0.5; }
        }
      `}</style>
    </span>
  );
}
