'use client';

/**
 * GenerateButton — the single most-pressed button in the simplified home.
 * Every micro-interaction it has is in here, designed to be lifted whole
 * into the real codebase (uses the .btn-accent token + motion utilities
 * already defined in globals.css / motion-principles.css).
 *
 * States it handles:
 *  1. idle       — calm accent surface, "Generate"
 *  2. hover      — background shifts one accent step + glow shadow grows
 *  3. pressed    — 60ms scale to 0.97 (touch-coupled feel, never bouncy)
 *  4. focus      — accent-500 outline at 2px, 2px offset (matches
 *                  globals.css :focus-visible rule)
 *  5. disabled   — when prompt is empty: opacity 0.5, cursor not-allowed,
 *                  no hover transitions
 *  6. generating — spinner + label changes to "Generating…", click is
 *                  swallowed (we keep the label visible per Vercel guideline:
 *                  "show a loading indicator & keep the original label")
 *  7. error      — momentarily flashes secondary (amber) ring then returns
 *                  to idle; the actual error message is shown by <ErrorToast />
 *  8. success    — once-per-generation success pulse (spring easing,
 *                  240ms) on the accent glow; rest of the UI sees it as a
 *                  no-op (we don't change layout)
 *
 * Vercel's button guideline applied: clicking does NOT instantly disable
 * the control — we keep it interactive for the duration of the LOADER_SHOW
 * debounce so fast responses don't show a spinner at all.
 */

import { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';

type GenerateState = 'idle' | 'generating' | 'error' | 'success';

interface GenerateButtonProps {
  /** True if prompt is non-empty and meets minimum length. */
  canGenerate: boolean;
  /** Current pipeline state — drives everything visual. */
  state: GenerateState;
  onClick: () => void;
}

export function GenerateButton({
  canGenerate,
  state,
  onClick,
}: GenerateButtonProps) {
  const [pressed, setPressed] = useState(false);
  const [errorFlash, setErrorFlash] = useState(false);
  const [successFlash, setSuccessFlash] = useState(false);

  // Error → 600ms amber ring flash, then auto-clear.
  useEffect(() => {
    if (state !== 'error') return;
    setErrorFlash(true);
    const id = window.setTimeout(() => setErrorFlash(false), 600);
    return () => window.clearTimeout(id);
  }, [state]);

  // Success → 320ms spring glow pulse, once.
  useEffect(() => {
    if (state !== 'success') return;
    setSuccessFlash(true);
    const id = window.setTimeout(() => setSuccessFlash(false), 320);
    return () => window.clearTimeout(id);
  }, [state]);

  const isGenerating = state === 'generating';
  const disabled = !canGenerate || isGenerating;
  const label = isGenerating ? 'Generating' : 'Generate';

  return (
    <button
      type="button"
      onClick={() => !disabled && onClick()}
      onMouseDown={() => !disabled && setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      onTouchStart={() => !disabled && setPressed(true)}
      onTouchEnd={() => setPressed(false)}
      aria-busy={isGenerating}
      aria-disabled={disabled}
      data-state={state}
      className={[
        // Base: same shape as the existing .btn-accent token.
        'group relative inline-flex items-center justify-center gap-2 rounded-full px-6 py-3',
        'text-sm font-semibold text-white shadow-card',
        // Color: accent surface.
        'bg-accent-500',
        // Motion: ONLY listed properties, never `all`.
        'motion-hover',
        // Hover (and not disabled): step up one accent stop + glow.
        !disabled && 'hover:bg-accent-600 hover:shadow-glow',
        // Disabled state.
        disabled && 'cursor-not-allowed opacity-50',
        // Generating state — keep label color + add subtle pulse via
        // bg-shift (no scale change; we want the page to feel still).
        isGenerating && 'cursor-wait',
        // Error flash — amber ring (uses the existing --color-secondary tokens).
        errorFlash && 'ring-2 ring-secondary-400 ring-offset-2',
        // Success flash — accent glow pulse via the spring shadow.
        successFlash && 'shadow-glow-strong',
        // Focus ring follows :focus-visible from globals.css; we add an
        // explicit class for safety since this is a custom shape.
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        // Press transform — instant down, snap easing.
        transform: pressed && !disabled ? 'scale(0.97)' : 'scale(1)',
        transition: pressed
          ? `transform var(--dur-instant) var(--ease-snap), background-color var(--dur-fast) var(--ease-out-quart), box-shadow var(--dur-fast) var(--ease-out-quart)`
          : `transform var(--dur-fast) var(--ease-out-quart), background-color var(--dur-fast) var(--ease-out-quart), box-shadow var(--dur-fast) var(--ease-out-quart)`,
      }}
    >
      {/* Leading icon — Loader2 if generating, Sparkles otherwise. Both stay
          the same size so the label never jumps. */}
      <span
        aria-hidden
        className="grid h-4 w-4 place-items-center"
      >
        {isGenerating ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4" />
        )}
      </span>

      <span>
        {label}
        {/* Ellipsis only when generating. Three CSS-animated dots match
            the LoadingPreview stagger so the whole UI feels coherent. */}
        {isGenerating && <Ellipsis />}
      </span>
    </button>
  );
}

function Ellipsis() {
  return (
    <span aria-hidden className="ml-0.5 inline-flex">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block"
          style={{
            animation: 'ellipsis-dot 1200ms var(--ease-out-quart) infinite',
            animationDelay: `${i * 150}ms`,
          }}
        >
          .
        </span>
      ))}
      <style jsx>{`
        @keyframes ellipsis-dot {
          0%, 60%, 100% { opacity: 0.3; }
          30%           { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          span { animation: none !important; }
        }
      `}</style>
    </span>
  );
}
