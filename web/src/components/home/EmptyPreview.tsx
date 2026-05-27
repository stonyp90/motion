'use client';

/**
 * EmptyPreview — first-run state of the preview frame, before any Generate.
 *
 * Design intent (Linear-style restraint): the empty state is not an
 * empty-state illustration. No icon-blob, no friendly mascot. It is the
 * future canvas, dimmed out, with a single sentence telling you what will
 * happen here and one example chip to seed the prompt input.
 *
 * The chip is the only interactive element — click to autofill. We do not
 * show "your motion appears here" as a button; the button is the chip.
 *
 * The dashed border + tertiary surface signals "container for content not
 * yet there". The aspect ratio matches the real preview frame exactly, so
 * the moment we swap in <PreviewFrame />, nothing shifts.
 */

import { Sparkles } from 'lucide-react';

interface EmptyPreviewProps {
  /** Example brief the chip will paste into the prompt input. */
  exampleBrief?: string;
  /** Called with the example brief when the chip is clicked. */
  onUseExample?: (brief: string) => void;
}

/**
 * Default example brief — animation-feature teaser. The product's
 * sweet spot is exactly this: a studio with a finished animated short
 * needs a festival-circuit promo cut, then a distributor pitch reel,
 * then a market-specific version — same source, three deliverables,
 * one afternoon. Reads as native to the product instead of a generic
 * SaaS pitch.
 */
const DEFAULT_EXAMPLE =
  'A 60-second festival teaser for our animated short. Cinematic palette, kinetic typography, three-scene arc: cold open · hero shot · festival CTA.';

export function EmptyPreview({
  exampleBrief = DEFAULT_EXAMPLE,
  onUseExample,
}: EmptyPreviewProps) {
  return (
    <div
      className="relative grid aspect-video w-full place-items-center overflow-hidden rounded-2xl border border-dashed border-border-default bg-bg-secondary"
      role="region"
      aria-label="Preview will appear here after you generate"
    >
      {/* Faint accent halo behind the text. Only thing that says "this is
          where the spark happens". CSS-only, no motion. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--color-accent-500) 4%, transparent), transparent 60%)',
        }}
      />

      <div className="relative flex flex-col items-center gap-4 px-6 text-center">
        <Sparkles
          aria-hidden
          className="h-5 w-5 text-text-tertiary"
        />
        <p className="text-sm text-text-secondary">
          Your motion graphic appears here.
        </p>

        <button
          type="button"
          onClick={() => onUseExample?.(exampleBrief)}
          className="motion-hover group inline-flex max-w-md items-center gap-2 rounded-full border border-border-light bg-bg-primary px-3 py-1.5 text-xs text-text-secondary shadow-soft hover:border-accent-300 hover:text-text-primary"
        >
          <span className="font-mono text-[10px] uppercase tracking-wider text-accent-600">
            try
          </span>
          <span className="truncate">{exampleBrief}</span>
        </button>
      </div>
    </div>
  );
}
