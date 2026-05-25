'use client';

/**
 * PlaceholderRotator — cycles through example prompt openings with a
 * low-speed typewriter effect, used as a "ghost placeholder" inside
 * the PromptInput textarea.
 *
 * Why a separate component?
 *  - Textareas do not natively render styled placeholders, and a real
 *    HTML placeholder cannot animate. We render an absolutely positioned
 *    overlay <span> that mirrors the textarea's typography and lets the
 *    user's actual input cover it once they start typing.
 *
 * Behavior
 *  - Types ~24 chars/second by default, pauses 1.8 s on the full
 *    phrase, then erases at ~36 chars/second.
 *  - Skips animation entirely when `prefers-reduced-motion: reduce` —
 *    falls back to the first phrase as a static placeholder.
 *  - Pauses (and hides itself) the moment the host textarea has a value.
 *  - Resumes from the start when the textarea is cleared.
 *
 * i18n keys (W18):
 *  onboarding.placeholder.phrase1
 *  onboarding.placeholder.phrase2
 *  onboarding.placeholder.phrase3
 */

import { useEffect, useRef, useState } from 'react';

export const DEFAULT_PHRASES: readonly string[] = [
  'A 15-second logo reveal with our brand emerald and a soft chime…',
  'Explainer for our API — 30 s, one main character, animated stickers…',
  'Social ad, 9:16, 8 s, punchy cuts, ends on the wordmark…',
];

export interface PlaceholderRotatorProps {
  /** Phrases to cycle through. Defaults to DEFAULT_PHRASES. */
  phrases?: readonly string[];
  /** Whether the host textarea is currently empty. When false, the rotator hides. */
  isEmpty: boolean;
  /** Typing speed (characters per second). */
  typingCps?: number;
  /** Erasing speed (characters per second). */
  erasingCps?: number;
  /** Pause at the end of each phrase (ms). */
  fullPauseMs?: number;
  /** Optional className passed through for layout (positioning, padding). */
  className?: string;
}

export function PlaceholderRotator({
  phrases = DEFAULT_PHRASES,
  isEmpty,
  typingCps = 24,
  erasingCps = 36,
  fullPauseMs = 1800,
  className,
}: PlaceholderRotatorProps) {
  const prefersReduced = usePrefersReducedMotion();

  const [phraseIdx, setPhraseIdx] = useState(0);
  const [displayed, setDisplayed] = useState('');
  const [phase, setPhase] = useState<'typing' | 'pausing' | 'erasing'>('typing');

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset to the start whenever the user clears the textarea.
  useEffect(() => {
    if (!isEmpty) return;
    setPhraseIdx(0);
    setDisplayed('');
    setPhase('typing');
  }, [isEmpty]);

  // Drive the typewriter unless the user is typing, OR reduced motion is on.
  useEffect(() => {
    if (!isEmpty) return;
    if (prefersReduced) {
      // Static placeholder — show the first phrase, no animation.
      setDisplayed(phrases[0] ?? '');
      return;
    }

    const phrase = phrases[phraseIdx] ?? '';

    if (phase === 'typing') {
      if (displayed.length < phrase.length) {
        const ms = 1000 / Math.max(1, typingCps);
        timeoutRef.current = setTimeout(() => {
          setDisplayed(phrase.slice(0, displayed.length + 1));
        }, ms);
      } else {
        // Done typing — pause.
        timeoutRef.current = setTimeout(() => setPhase('erasing'), fullPauseMs);
      }
    } else if (phase === 'erasing') {
      if (displayed.length > 0) {
        const ms = 1000 / Math.max(1, erasingCps);
        timeoutRef.current = setTimeout(() => {
          setDisplayed(phrase.slice(0, displayed.length - 1));
        }, ms);
      } else {
        // Done erasing — advance to the next phrase, type again.
        setPhraseIdx((i) => (i + 1) % phrases.length);
        setPhase('typing');
      }
    }

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [
    isEmpty,
    prefersReduced,
    phraseIdx,
    displayed,
    phase,
    phrases,
    typingCps,
    erasingCps,
    fullPauseMs,
  ]);

  if (!isEmpty) return null;

  return (
    <span
      // pointer-events-none so the user can still click into the textarea through us.
      // select-none so a double-click on the placeholder doesn't highlight text.
      aria-hidden="true"
      data-testid="mf-placeholder-rotator"
      className={[
        'pointer-events-none absolute left-0 top-0 select-none whitespace-pre-wrap font-mono text-sm leading-relaxed text-text-tertiary',
        className ?? '',
      ].join(' ')}
    >
      {displayed}
      {!prefersReduced && (
        <span
          className="ml-px inline-block w-px animate-pulse bg-text-tertiary align-middle motion-reduce:animate-none"
          style={{ height: '1em' }}
          aria-hidden="true"
        />
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Reduced-motion media query — re-usable hook, kept local to avoid pulling
// a util module in just yet. Promote to `@/lib/hooks` if more consumers appear.
// ---------------------------------------------------------------------------
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  return reduced;
}
