'use client';

/**
 * EmptyPreview — onboarding-aware placeholder for the PreviewFrame
 * before the user has generated their first clip.
 *
 * Differences from the plain W19 EmptyPreview:
 *  - Reads `useWelcomeTour().isOpen` to suppress the example chips
 *    row while the tour overlay is on top of the page (chips would
 *    compete visually with the tour callout).
 *  - When `cast` is empty, the secondary tip nudges towards Cmd+K
 *    (open command palette) to add a character first.
 *  - Renders a static SVG illustration of a generic "first frame":
 *    a stage with a centered glyph and the brand emerald outline,
 *    so the frame doesn't sit visually empty.
 *
 * Slot it inside <PreviewFrame data-testid="mf-preview-frame"> when
 * there is no animationData yet. Once the first generate completes,
 * the parent swaps this for the Lottie player.
 *
 * i18n keys (W18):
 *  onboarding.preview.empty.title
 *  onboarding.preview.empty.tipCast
 *  onboarding.preview.empty.tipPrompt
 *  onboarding.preview.examples.logo
 *  onboarding.preview.examples.api
 *  onboarding.preview.examples.social
 *  onboarding.preview.examples.script
 */

import { useMemo } from 'react';
import { Sparkles, Wand2 } from 'lucide-react';
import { useWelcomeTourOptional } from './WelcomeTour';

export interface EmptyPreviewProps {
  /** True if the cast row has no characters yet. */
  hasCast: boolean;
  /**
   * Called when an example chip is clicked. Host applies the example
   * to the prompt textarea (and optionally moves focus there).
   */
  onPickExample: (example: ExamplePrompt) => void;
  /** Optional aspect-ratio hint. Defaults to 16:9 to mirror the preset stage. */
  aspect?: '16:9' | '9:16' | '1:1';
}

export interface ExamplePrompt {
  key: string;
  label: string;
  /** What actually lands in the textarea when the chip is clicked. */
  prompt: string;
  /** Optional brief tag rendered in mono on the chip. */
  meta?: string;
}

const DEFAULT_EXAMPLES: readonly ExamplePrompt[] = [
  {
    key: 'logo',
    label: 'a 15s logo reveal',
    prompt:
      'A 15-second logo reveal: brand wordmark fades up over a soft particle field, accent emerald sweep across the M, settles with a subtle bounce.',
    meta: '15s · 1:1',
  },
  {
    key: 'api',
    label: 'explainer for our API',
    prompt:
      'Explainer for our API in 30 seconds: cold open with a problem statement, three labelled steps with animated arrows, ends on the docs URL.',
    meta: '30s · 16:9',
  },
  {
    key: 'social',
    label: 'social ad, 9:16, 8s',
    prompt:
      'Social ad, 9:16, 8 seconds, punchy quick-cut typography over moving emerald gradients, ends on the wordmark with a tap-to-shop CTA.',
    meta: '8s · 9:16',
  },
  {
    key: 'script',
    label: 'Paste a motion-design script',
    prompt:
      '# Scene 1 (0–4s)\nWide on logo, particles drift in from the left.\n\n# Scene 2 (4–10s)\nWordmark settles, three feature pills slide up in sequence.\n\n# Scene 3 (10–15s)\nCTA "Try it now" pulses once, end card holds for 2s.',
    meta: 'Sample · paste',
  },
];

export function EmptyPreview({
  hasCast,
  onPickExample,
  aspect = '16:9',
}: EmptyPreviewProps) {
  // Live tour state — hide example chips while the tour is on screen
  // so they don't visually compete with the callout.
  const tour = useWelcomeTourOptional();
  const tourIsOpen = tour?.isOpen ?? false;

  const aspectClass = useMemo(() => {
    switch (aspect) {
      case '9:16':
        return 'aspect-[9/16]';
      case '1:1':
        return 'aspect-square';
      case '16:9':
      default:
        return 'aspect-video';
    }
  }, [aspect]);

  return (
    <div
      className="flex w-full flex-col items-center gap-6"
      data-testid="mf-empty-preview"
    >
      {/* Outlined frame */}
      <div
        className={[
          'relative w-full max-w-[940px] overflow-hidden rounded-2xl border-2 border-dashed border-accent-300/70 bg-bg-secondary',
          aspectClass,
        ].join(' ')}
      >
        {/* Subtle radial glow so the frame doesn't read as inert. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60 motion-reduce:opacity-50"
          style={{
            background:
              'radial-gradient(ellipse at center, var(--color-accent-50) 0%, transparent 60%)',
          }}
        />

        {/* Static "first-frame" illustration — pure SVG, no asset fetch. */}
        <FirstFrameGlyph />

        {/* Label + tip stacked centered */}
        <div className="absolute inset-0 grid place-items-center px-6 text-center">
          <div className="max-w-sm">
            <p className="text-sm font-semibold text-text-primary">
              Your motion graphic will appear here.
            </p>
            <p className="mt-2 inline-flex items-start gap-1.5 text-xs leading-relaxed text-text-secondary">
              <Sparkles
                aria-hidden
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-600"
              />
              {hasCast ? (
                <span>
                  Tip: paste a script or describe the scene — Motion Forge will draft
                  the first cut in seconds.
                </span>
              ) : (
                <span>
                  Tip: cast a character (
                  <kbd className="rounded border border-border-light bg-bg-primary px-1 font-mono text-[10px] text-text-primary">
                    {modKey()}K
                  </kbd>
                  ) to make your prompt richer.
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Example chips — suppressed while the tour overlay is on screen. */}
      {!tourIsOpen && (
        <div
          className="flex w-full max-w-[940px] flex-wrap items-center justify-center gap-2"
          data-testid="mf-empty-examples"
        >
          <span className="mr-1 inline-flex items-center gap-1.5 text-xs font-medium text-text-tertiary">
            <Wand2 className="h-3.5 w-3.5" aria-hidden />
            Try one:
          </span>
          {DEFAULT_EXAMPLES.map((ex) => (
            <button
              key={ex.key}
              type="button"
              onClick={() => onPickExample(ex)}
              className="group inline-flex items-center gap-2 rounded-full border border-border-light bg-bg-primary px-3 py-1.5 text-xs text-text-secondary shadow-soft transition hover:border-accent-300 hover:bg-accent-50 hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent-500"
              data-testid={`mf-example-chip-${ex.key}`}
            >
              <span className="font-medium">{ex.label}</span>
              {ex.meta && (
                <span className="font-mono text-[10px] text-text-tertiary group-hover:text-accent-700">
                  {ex.meta}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FirstFrameGlyph — a stylised, brand-emerald "stage with character" glyph
// rendered as inline SVG so the empty state never shows a loading spinner.
// Uses CSS variables for fill colors so it follows the theme.
// ---------------------------------------------------------------------------
function FirstFrameGlyph() {
  return (
    <svg
      viewBox="0 0 320 180"
      className="absolute inset-0 m-auto h-3/5 w-3/5 text-accent-500 opacity-70 motion-reduce:opacity-60"
      role="img"
      aria-label="A placeholder still of a centered figure on stage."
      data-testid="mf-empty-glyph"
    >
      {/* Stage floor */}
      <rect
        x="20"
        y="120"
        width="280"
        height="30"
        rx="3"
        fill="var(--color-accent-100)"
        stroke="var(--color-accent-300)"
        strokeWidth="1.5"
      />
      {/* Spotlight cone */}
      <path
        d="M160 30 L100 140 L220 140 Z"
        fill="var(--color-accent-50)"
        opacity="0.7"
      />
      {/* Character — a friendly mascot circle + body */}
      <circle
        cx="160"
        cy="80"
        r="18"
        fill="var(--color-bg-primary)"
        stroke="currentColor"
        strokeWidth="2"
      />
      <rect
        x="142"
        y="100"
        width="36"
        height="32"
        rx="6"
        fill="var(--color-bg-primary)"
        stroke="currentColor"
        strokeWidth="2"
      />
      {/* Two simple eyes */}
      <circle cx="154" cy="78" r="2" fill="currentColor" />
      <circle cx="166" cy="78" r="2" fill="currentColor" />
      {/* Smile */}
      <path
        d="M154 87 Q160 92 166 87"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Sparkles */}
      <g fill="var(--color-accent-500)">
        <circle cx="100" cy="50" r="2" />
        <circle cx="220" cy="60" r="1.5" />
        <circle cx="240" cy="100" r="2" />
        <circle cx="80" cy="90" r="1.5" />
      </g>
    </svg>
  );
}

function modKey(): string {
  if (typeof navigator === 'undefined') return '⌘';
  return /Mac|iPod|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
}
